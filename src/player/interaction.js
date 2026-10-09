// Block interaction: targeting, breaking with progress, placing, using.

import { REACH_DISTANCE, GAMEMODE_CREATIVE } from '../core/constants.js';
import { raycastBlocks } from '../world/raycast.js';
import { B, BLOCKS, blockInfo, R_CROSS, isSolid } from '../blocks/blocks.js';
import { itemInfo, isBlockItem } from '../items/items.js';
import { I } from '../items/itemIds.js';
import { growCrop, cropTime } from '../world/saplings.js';
import { mulberry32 } from '../core/rng.js';

// Blocks that open a UI instead of being a normal placement target.
const USABLE = new Set([B.CRAFTING_TABLE, B.FURNACE, B.FURNACE_LIT, B.CHEST, B.BED]);
const SAPLINGS = new Set([B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING]);
const SOIL = new Set([B.GRASS, B.DIRT, B.SNOWY_GRASS]);
const CROPS = new Set([B.WHEAT_0, B.WHEAT_1, B.WHEAT_2, B.WHEAT_3]);
// Cross plants require solid ground below.
const NEEDS_GROUND = new Set([B.TALL_GRASS, B.DANDELION, B.POPPY, B.SUGAR_CANE, B.DEAD_BUSH, B.MUSHROOM_BROWN, B.MUSHROOM_RED, B.CACTUS, B.TORCH, ...SAPLINGS, ...CROPS]);

// item stacks stored in a block entity (furnace slots, chest slots)
export function entityContents(st) {
  if (!st) return [];
  if (st.kind === 'furnace') return [st.input, st.fuel, st.output].filter(Boolean);
  if (st.kind === 'chest') return st.slots.filter(Boolean);
  return [];
}

export class Interaction {
  constructor(world, player, callbacks) {
    this.world = world;
    this.player = player;
    this.cb = callbacks; // { spawnDrops(x,y,z,drops), openUI(kind, pos), playSound(name, opts), attackRay(origin, dir) }

    this.target = null;         // current raycast hit
    this.breakTarget = null;    // block being broken
    this.breakProgress = 0;     // 0..1
    this.breakTime = 0;         // seconds needed
    this.placeCooldown = 0;
    this.breakCooldown = 0;
    this.useCooldown = 0;
    this.dropRng = mulberry32((Math.random() * 2 ** 31) | 0);
  }

  update(input, dt, uiOpen) {
    const p = this.player;
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.useCooldown = Math.max(0, this.useCooldown - dt);

    if (uiOpen || p.dead) {
      this.target = null;
      this.resetBreaking();
      return;
    }

    const origin = { x: p.x, y: p.eyeY, z: p.z };
    const dir = p.lookDir();
    this.target = raycastBlocks(this.world, origin, dir, REACH_DISTANCE);

    // ---- breaking (left mouse) ----
    if (input.mouseDown(0) && this.target) {
      const t = this.target;
      if (!this.breakTarget || this.breakTarget.x !== t.x || this.breakTarget.y !== t.y || this.breakTarget.z !== t.z) {
        this.startBreaking(t);
      }
      if (this.breakTarget) {
        const info = blockInfo(this.breakTarget.id);
        if (info.hardness < 0) {
          // unbreakable
        } else if (p.mode === GAMEMODE_CREATIVE) {
          if (this.breakCooldown <= 0) {
            this.finishBreak(true);
            this.breakCooldown = 0.22;
          }
        } else {
          this.breakProgress += dt / this.breakTime;
          if (this.breakProgress >= 1) this.finishBreak(false);
          else if (Math.random() < dt * 6) {
            this.cb.playSound('hit', { block: info.sound });
          }
        }
      }
    } else {
      this.resetBreaking();
    }

    // ---- using / placing (right mouse, button 2) ----
    if (input.mouseDown(2) && this.placeCooldown <= 0 && this.useCooldown <= 0) {
      this.useOrPlace();
      this.placeCooldown = 0.24;
    }
  }

  startBreaking(t) {
    const p = this.player;
    const info = blockInfo(t.id);
    this.breakTarget = { x: t.x, y: t.y, z: t.z, id: t.id };
    this.breakProgress = 0;

    // Break time: hardness * 1.5 when properly tooled (or no tool needed),
    // *5 when the right tool class is missing or tier too low.
    const held = p.heldStack();
    const tool = held ? itemInfo(held.id)?.tool : null;
    let mult = 1;
    let effective = !info.tool; // blocks with no preferred tool are always "effective"
    if (info.tool && tool && tool.class === info.tool) {
      mult = tool.speed;
      effective = tool.tier >= (info.minTier > 0 ? info.minTier : 0);
    }
    const canHarvest = info.minTier === 0 || (tool && tool.class === info.tool && tool.tier >= info.minTier);
    this.breakCanHarvest = canHarvest;
    const base = info.hardness * (canHarvest || !info.tool ? 1.5 : 5);
    this.breakTime = Math.max(0.05, base / mult);
  }

  resetBreaking() {
    this.breakTarget = null;
    this.breakProgress = 0;
  }

  finishBreak(creative) {
    const t = this.breakTarget;
    if (!t) return;
    const p = this.player;
    const info = blockInfo(t.id);

    // spill a container's contents before setBlock clears its block entity
    const contents = entityContents(this.world.blockEntityAt(t.x, t.y, t.z));
    if (contents.length) this.cb.spawnDrops(t.x + 0.5, t.y + 0.5, t.z + 0.5, contents.map((s) => ({ ...s })));

    this.world.setBlock(t.x, t.y, t.z, B.AIR);
    this.cb.playSound('break', { block: info.sound });

    // cascade: break unsupported plants above
    const above = this.world.getBlockW(t.x, t.y + 1, t.z);
    if (NEEDS_GROUND.has(above)) {
      const ainfo = blockInfo(above);
      this.world.setBlock(t.x, t.y + 1, t.z, B.AIR);
      if (!creative) this.spawnBlockDrops(t.x, t.y + 1, t.z, ainfo, true);
    }

    if (!creative) {
      if (this.breakCanHarvest) this.spawnBlockDrops(t.x, t.y, t.z, info, true);
      p.damageHeldTool(1);
      p.addExhaustion(0.03);
    }
    this.resetBreaking();
  }

  spawnBlockDrops(x, y, z, info, harvest) {
    if (!harvest) return;
    let drops = [];
    if (info.drop === null) drops = [];
    else if (info.drop === undefined) drops = [{ id: info.id, count: 1 }];
    else if (typeof info.drop === 'number') drops = [{ id: info.drop, count: 1 }];
    else if (typeof info.drop === 'function') drops = info.drop(this.dropRng) ?? [];
    if (drops.length) this.cb.spawnDrops(x + 0.5, y + 0.3, z + 0.5, drops);
  }

  useOrPlace() {
    const p = this.player;
    const t = this.target;
    const held = p.heldStack();

    // 1) use a block (crafting table, furnace) — unless sneaking
    if (t && USABLE.has(t.id) && !p.sneaking) {
      const kind = { [B.CRAFTING_TABLE]: 'crafting', [B.CHEST]: 'chest', [B.BED]: 'bed' }[t.id] ?? 'furnace';
      this.cb.openUI(kind, t);
      return;
    }

    // 2) eat food
    if (held) {
      const info = itemInfo(held.id);
      if (info?.food && p.hunger < 20 && p.mode !== GAMEMODE_CREATIVE) {
        p.eat(info.food);
        p.consumeHeld(1);
        this.cb.playSound('eat', {});
        this.useCooldown = 0.4;
        return;
      }
    }

    // 3) item actions: equip armour, till, plant, fertilise, light TNT
    if (held && this.useItem(held, t)) return;

    // 4) place a block
    if (!t || !held || !isBlockItem(held.id)) return;
    const info = blockInfo(held.id);

    // target position: replaceable blocks are overwritten in place
    let px = t.x, py = t.y, pz = t.z;
    const targetInfo = blockInfo(t.id);
    if (!targetInfo.replaceable) {
      px += t.nx; py += t.ny; pz += t.nz;
    }
    const existing = this.world.getBlockW(px, py, pz);
    if (!blockInfo(existing).replaceable) return;

    // support requirement for plants/torches
    if (NEEDS_GROUND.has(info.id)) {
      const below = this.world.getBlockW(px, py - 1, pz);
      if (!isSolid(below)) return;
      if (SAPLINGS.has(info.id) && !SOIL.has(below)) return;
    }

    // don't place a solid block inside the player
    if (info.solid && this.intersectsPlayer(px, py, pz)) return;

    // orientation for blocks with a "front" face: face the player
    let meta = 0;
    const tex = info.textures;
    if (typeof tex === 'object' && tex.front) {
      // yaw quadrant: which way the player looks; block front faces back at them
      const yaw = ((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const quad = Math.round(yaw / (Math.PI / 2)) % 4;
      // player looks -z at yaw 0 -> front should face +z... map: quad 0 (-z look) => front=+z(2)
      meta = [2, 1, 0, 3][quad];
    }

    const old = this.world.setBlock(px, py, pz, info.id, meta);
    if (old === -1) return;
    if (info.id === B.FURNACE) this.world.setBlockEntity(px, py, pz, null);
    // saplings remember when to grow (seconds of loaded time)
    if (SAPLINGS.has(info.id)) this.world.setBlockEntity(px, py, pz, { kind: 'sapling', grow: 60 + this.dropRng() * 120 });
    this.cb.playSound('place', { block: info.sound });
    if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(1);
  }

  // Returns true if the held item did something special.
  useItem(held, t) {
    const p = this.player;
    const info = itemInfo(held.id);
    const creative = p.mode === GAMEMODE_CREATIVE;

    // armour: put it on (swapping with what's worn)
    if (info?.armor) {
      const slot = info.armor.slot;
      const worn = p.armor[slot];
      p.armor[slot] = held;
      p.inventory[p.selected] = worn;
      p.events.dispatchEvent(new CustomEvent('inventory'));
      this.cb.playSound('equip', {});
      this.useCooldown = 0.3;
      return true;
    }
    if (!t) return false;
    const above = this.world.getBlockW(t.x, t.y + 1, t.z);
    const aboveFree = above === B.AIR || blockInfo(above).replaceable;

    // hoe: grass / dirt -> farmland
    if (info?.tool?.class === 'hoe') {
      if (!SOIL.has(t.id) || !aboveFree || t.ny < 0) return false;
      if (above !== B.AIR) this.world.setBlock(t.x, t.y + 1, t.z, B.AIR);
      this.world.setBlock(t.x, t.y, t.z, B.FARMLAND);
      this.cb.playSound('place', { block: 'dirt' });
      if (!creative) p.damageHeldTool(1);
      return true;
    }

    // seeds: plant on top of farmland
    if (info?.places) {
      if (t.id !== B.FARMLAND || t.ny !== 1 || above !== B.AIR) return true;
      this.world.setBlock(t.x, t.y + 1, t.z, info.places);
      this.world.setBlockEntity(t.x, t.y + 1, t.z, { kind: 'crop', grow: cropTime(this.world, t.x, t.y + 1, t.z, this.dropRng) });
      this.cb.playSound('place', { block: 'leaf' });
      if (!creative) p.consumeHeld(1);
      return true;
    }

    // bone meal: ripen a crop, or make a sapling grow right away
    if (held.id === I.BONE_MEAL) {
      if (CROPS.has(t.id) && t.id !== B.WHEAT_3) {
        growCrop(this.world, t.x, t.y, t.z, 2, this.dropRng);
      } else if (SAPLINGS.has(t.id)) {
        const st = this.world.blockEntityAt(t.x, t.y, t.z);
        if (st) st.grow = 0;
        else this.world.setBlockEntity(t.x, t.y, t.z, { kind: 'sapling', grow: 0 });
      } else {
        return false;
      }
      this.cb.playSound('place', { block: 'leaf' });
      this.cb.sparkle?.(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      if (!creative) p.consumeHeld(1);
      return true;
    }

    // torch on TNT: light the fuse
    if (held.id === B.TORCH && t.id === B.TNT) {
      this.world.setBlock(t.x, t.y, t.z, B.AIR);
      this.cb.primeTnt?.(t.x + 0.5, t.y, t.z + 0.5);
      return true;
    }
    return false;
  }

  intersectsPlayer(bx, by, bz) {
    const p = this.player;
    const hw = p.w / 2;
    return bx + 1 > p.x - hw && bx < p.x + hw &&
      by + 1 > p.y && by < p.y + p.h &&
      bz + 1 > p.z - hw && bz < p.z + hw;
  }
}
