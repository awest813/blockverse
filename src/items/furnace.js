// Furnace block-entity logic. State lives in chunk.blockEntities:
// { input, fuel, output, burnLeft, burnTotal, cook }

import { B } from '../blocks/blocks.js';
import { SMELTING, SMELT_TIME } from './recipes.js';
import { itemInfo, maxStack } from './items.js';
import { blockIndex, CHUNK_Y } from '../core/constants.js';

export function furnaceState(world, x, y, z) {
  let st = world.blockEntityAt(x, y, z);
  if (!st) {
    st = { kind: 'furnace', input: null, fuel: null, output: null, burnLeft: 0, burnTotal: 0, cook: 0 };
    world.setBlockEntity(x, y, z, st);
  }
  return st;
}

function canSmelt(st) {
  if (!st.input) return null;
  const out = SMELTING.get(st.input.id);
  if (!out) return null;
  if (st.output) {
    if (st.output.id !== out.id) return null;
    if (st.output.count + out.count > maxStack(out.id)) return null;
  }
  return out;
}

// Tick every loaded furnace. Returns true if any UI-visible state changed.
export function tickFurnaces(world, dt) {
  let changed = false;
  const litSwaps = []; // apply after iteration: setBlock mutates blockEntities
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of [...chunk.blockEntities]) {
      if (st.kind !== 'furnace') continue;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16;
      const lx = (rest - lz) / 16;
      const wx = chunk.cx * 16 + lx, wz = chunk.cz * 16 + lz;

      const smeltable = canSmelt(st);

      // consume fuel when needed
      if (st.burnLeft <= 0 && smeltable && st.fuel) {
        const burn = itemInfo(st.fuel.id)?.burnTime ?? 0;
        if (burn > 0) {
          st.burnLeft = burn;
          st.burnTotal = burn;
          st.fuel.count--;
          if (st.fuel.count <= 0) st.fuel = null;
          chunk.modified = true;
          changed = true;
        }
      }

      const lit = st.burnLeft > 0;
      if (lit) {
        st.burnLeft = Math.max(0, st.burnLeft - dt);
        if (smeltable) {
          st.cook += dt;
          if (st.cook >= SMELT_TIME) {
            st.cook = 0;
            st.input.count--;
            if (st.input.count <= 0) st.input = null;
            if (st.output) st.output.count += smeltable.count;
            else st.output = { id: smeltable.id, count: smeltable.count };
            chunk.modified = true;
            changed = true;
          }
        } else {
          st.cook = 0;
        }
        changed = changed || true;
      } else if (st.cook > 0) {
        st.cook = Math.max(0, st.cook - dt * 2);
        changed = true;
      }

      // keep the block's lit variant in sync
      const blockId = world.getBlockW(wx, y, wz);
      if (lit && blockId === B.FURNACE) litSwaps.push([wx, y, wz, B.FURNACE_LIT, st]);
      else if (!lit && blockId === B.FURNACE_LIT) litSwaps.push([wx, y, wz, B.FURNACE, st]);
    }
  }
  for (const [wx, wy, wz, id, st] of litSwaps) {
    const meta = world.getMetaW(wx, wy, wz);
    world.setBlock(wx, wy, wz, id, meta);
    world.setBlockEntity(wx, wy, wz, st); // setBlock cleared it
  }
  return changed;
}
