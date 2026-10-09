// Campfires cook up to four raw foods at once, without fuel, while lit.
// Block entity: {kind: 'campfire', slots: [{id, t} | null x4]}.

import { B } from '../blocks/blocks.js';
import { CHUNK_Y } from '../core/constants.js';
import { SMELTING, CAMPFIRE_TIME } from './recipes.js';
import { itemInfo } from './items.js';

export const CAMPFIRE_SLOTS = 4;

// raw foods the furnace can cook
export function campfireCookable(id) {
  return SMELTING.has(id) && (itemInfo(id)?.food ?? 0) > 0;
}

export function campfireState(world, x, y, z) {
  let st = world.blockEntityAt(x, y, z);
  if (!st || st.kind !== 'campfire') {
    st = { kind: 'campfire', slots: new Array(CAMPFIRE_SLOTS).fill(null) };
    world.setBlockEntity(x, y, z, st);
  }
  return st;
}

// put one food item on the fire; false if it's full
export function addToCampfire(world, x, y, z, id) {
  const st = campfireState(world, x, y, z);
  const i = st.slots.findIndex((s) => !s);
  if (i < 0) return false;
  st.slots[i] = { id, t: 0 };
  world.setBlockEntity(x, y, z, st);   // marks the chunk modified
  return true;
}

// Call fn(x, y, z, state) for every campfire in loaded chunks.
export function forEachCampfire(world, fn) {
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of chunk.blockEntities) {
      if (st.kind !== 'campfire') continue;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16, lx = (rest - lz) / 16;
      fn(chunk.cx * 16 + lx, y, chunk.cz * 16 + lz, st);
    }
  }
}

// Advance cooking on lit fires; finished food pops off via spawnDrops.
export function tickCampfires(world, dt, spawnDrops) {
  forEachCampfire(world, (x, y, z, st) => {
    if (world.getBlockW(x, y, z) !== B.CAMPFIRE) return;   // unlit: food just sits there
    st.slots.forEach((s, i) => {
      if (!s) return;
      s.t += dt;
      if (s.t < CAMPFIRE_TIME) return;
      const out = SMELTING.get(s.id);
      st.slots[i] = null;
      world.markModified(x, z);
      spawnDrops(x + 0.5, y + 0.6, z + 0.5, [{ id: out.id, count: out.count }]);
    });
  });
}
