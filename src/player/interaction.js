// Block interaction: targeting, breaking with progress, placing, using.

import { REACH_DISTANCE, GAMEMODE_CREATIVE } from '../core/constants.js';
import { raycastBlocks } from '../world/raycast.js';
import { B, BLOCKS, blockInfo, R_CROSS, R_SHAPE, isSolid } from '../blocks/blocks.js';
import { worldBoxes } from '../blocks/shapes.js';
import { itemInfo, isBlockItem } from '../items/items.js';
import { I } from '../items/itemIds.js';
import { growCrop, cropTime } from '../world/saplings.js';
import { campfireCookable, addToCampfire, campfireState } from '../items/campfire.js';
import { mulberry32 } from '../core/rng.js';

// Blocks that open a UI instead of being a normal placement target.
const USABLE = new Set([B.CRAFTING_TABLE, B.FURNACE, B.FURNACE_LIT, B.CHEST, B.BED]);
const SAPLINGS = new Set([B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING]);
const SOIL = new Set([B.GRASS, B.DIRT, B.SNOWY_GRASS]);
const BOW_DRAW_TIME = 1;     // seconds to full draw
const CROPS = new Set([B.WHEAT_0, B.WHEAT_1, B.WHEAT_2, B.WHEAT_3]);
// Cross plants require solid ground below.
const NEEDS_GROUND = new Set([B.FIRE, B.KELP, B.SEAGRASS, B.LILY_PAD, B.SNOW_LAYER, B.TALL_GRASS, B.DANDELION, B.POPPY, B.SUGAR_CANE, B.DEAD_BUSH, B.MUSHROOM_BROWN, B.MUSHROOM_RED, B.CACTUS, B.TORCH, ...SAPLINGS, ...CROPS, B.CAMPFIRE, B.CAMPFIRE_OFF]);
const CAMPFIRES = new Set([B.CAMPFIRE, B.CAMPFIRE_OFF]);
const DOORS = new Set([B.OAK_DOOR, B.OAK_DOOR_TOP]);
const SLABS = new Set([B.OAK_SLAB, B.COBBLE_SLAB, B.STONE_BRICK_SLAB]);
const STAIRS = new Set([B.OAK_STAIRS, B.COBBLE_STAIRS, B.STONE_BRICK_STAIRS]);
// ladder meta from the face clicked: the wall is behind the ladder
const wallMeta = (nx, nz) => (nz === 1 ? 0 : nx === -1 ? 1 : nz === -1 ? 2 : 3);

// Water and lava meeting: lava turns to obsidian. Call after placing either.
export function fluidContact(world, x, y, z, onFizz) {
  const id = world.getBlockW(x, y, z);
  if (id !== B.WATER && id !== B.LAVA) return;
  let fizz = false;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const n = world.getBlockW(x + dx, y + dy, z + dz);
    if (id === B.WATER && n === B.LAVA) { world.setBlock(x + dx, y + dy, z + dz, B.OBSIDIAN); fizz = true; }
    if (id === B.LAVA && (n === B.WATER || BLOCKS[n]?.waterlogged)) { world.setBlock(x, y, z, B.OBSIDIAN); fizz = true; break; }
  }
  if (fizz) onFizz?.();
}

// item stacks stored in a block entity (furnace slots, chest slots)
export function entityContents(st) {
  if (!st) return [];
  if (st.kind === 'furnace') return [st.input, st.fuel, st.output].filter(Boolean);
  if (st.kind === 'chest') return st.slots.filter(Boolean);
  if (st.kind === 'campfire') return st.slots.filter(Boolean).map((s) => ({ id: s.id, count: 1 }));
  return [];
}

const SHEARABLE = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.TALL_GRASS, B.DEAD_BUSH]);

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
    this.bowCharge = 0;         // 0..1 while drawing a bow
    this.eating = null;         // {id, slot, t, need, auto} while eating or drinking
  }

  update(input, dt, uiOpen) {
    const p = this.player;
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.useCooldown = Math.max(0, this.useCooldown - dt);

    if (uiOpen || p.dead) {
      this.target = null;
      this.bowCharge = 0;   // menus/pauses cancel a draw instead of firing on resume
      this.eating = null;
      p.usingItem = false;
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
          // digging underwater or while airborne is slow going
          const slow = (p.headInWater ? 5 : 1) * (!p.onGround && !p.flying && !p.onLadder ? 5 : 1);
          this.breakProgress += dt / (this.breakTime * slow);
          if (this.breakProgress >= 1) this.finishBreak(false);
          else if (Math.random() < dt * 6) {
            this.cb.playSound('hit', { block: info.sound });
          }
        }
      }
    } else {
      this.resetBreaking();
    }

    // ---- eating: hold use (touch: one tap) until the food is gone ----
    const held = p.heldStack();
    this.inputMode = input.altInput;
    if (this.eating) {
      const e = this.eating;
      if (!held || held.id !== e.id || p.selected !== e.slot || (!e.auto && !input.mouseDown(2))) {
        this.eating = null;   // let go, or switched items: stop
      } else {
        e.t += dt;
        if (Math.floor(e.t / 0.27) !== Math.floor((e.t - dt) / 0.27)) this.cb.playSound('eat', {});
        if (e.t >= e.need) {
          this.finishEating(held);
          this.eating = null;
          this.useCooldown = 0.35;
        }
        p.usingItem = !!this.eating;
        return;
      }
    }
    p.usingItem = false;

    // ---- bow: hold right mouse to draw, release to shoot ----
    // a bow still opens chests, tables, furnaces and beds (unless already drawing)
    const aimingAtUsable = this.target && USABLE.has(this.target.id) && !p.sneaking && this.bowCharge === 0;
    if (held && itemInfo(held.id)?.bow && !aimingAtUsable) {
      const hasArrows = p.mode === GAMEMODE_CREATIVE || p.countOf(I.ARROW) > 0;
      if (input.mouseDown(2) && hasArrows) {
        this.bowCharge = Math.min(1, this.bowCharge + dt / BOW_DRAW_TIME);
      } else if (this.bowCharge > 0) {
        this.cb.fireBow?.(this.bowCharge);
        this.bowCharge = 0;
      }
      return;
    }
    this.bowCharge = 0;

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

    this.world.setBlock(t.x, t.y, t.z, info.waterlogged ? B.WATER : B.AIR);
    this.cb.playSound('break', { block: info.sound });
    // a door's other half goes with it
    if (t.id === B.OAK_DOOR && this.world.getBlockW(t.x, t.y + 1, t.z) === B.OAK_DOOR_TOP) this.world.setBlock(t.x, t.y + 1, t.z, B.AIR);
    if (t.id === B.OAK_DOOR_TOP && this.world.getBlockW(t.x, t.y - 1, t.z) === B.OAK_DOOR) {
      this.world.setBlock(t.x, t.y - 1, t.z, B.AIR);
      if (!creative) this.cb.spawnDrops(t.x + 0.5, t.y - 0.7, t.z + 0.5, [{ id: B.OAK_DOOR, count: 1 }]);
    }

    // cascade: break unsupported plants above (a whole kelp stalk, a door on a broken floor)
    for (let y = t.y + 1; y < t.y + 32; y++) {
      const above = this.world.getBlockW(t.x, y, t.z);
      if (!NEEDS_GROUND.has(above) && above !== B.OAK_DOOR) break;
      const ainfo = blockInfo(above);
      if (above === B.OAK_DOOR) this.world.setBlock(t.x, y + 1, t.z, B.AIR);
      this.world.setBlock(t.x, y, t.z, ainfo.waterlogged ? B.WATER : B.AIR);
      if (!creative) this.spawnBlockDrops(t.x, y, t.z, ainfo, true);
      if (above !== B.KELP) break;
    }

    if (!creative) {
      // shears snip leaves, grass and bushes off whole
      if (p.heldStack()?.id === I.SHEARS && SHEARABLE.has(t.id)) this.cb.spawnDrops(t.x + 0.5, t.y + 0.3, t.z + 0.5, [{ id: t.id, count: 1 }]);
      else if (this.breakCanHarvest) this.spawnBlockDrops(t.x, t.y, t.z, info, true);
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

    // right-click a sign to change what it says
    if (t && t.id === B.OAK_SIGN && !p.sneaking) {
      this.cb.editSign?.(t.x, t.y, t.z);
      this.useCooldown = 0.3;
      return;
    }

    // fence gates swing open and shut
    if (t && t.id === B.OAK_FENCE_GATE && !p.sneaking) {
      this.world.setBlock(t.x, t.y, t.z, B.OAK_FENCE_GATE, this.world.getMetaW(t.x, t.y, t.z) ^ 4);
      this.cb.playSound('place', { block: 'wood' });
      this.useCooldown = 0.25;
      return;
    }

    // doors open and shut (both halves)
    if (t && DOORS.has(t.id) && !p.sneaking) {
      const lowerY = t.id === B.OAK_DOOR_TOP ? t.y - 1 : t.y;
      if (this.world.getBlockW(t.x, lowerY, t.z) !== B.OAK_DOOR) return;   // a stray top half (blown off its base)
      const meta = this.world.getMetaW(t.x, lowerY, t.z) ^ 4;
      this.world.setBlock(t.x, lowerY, t.z, B.OAK_DOOR, meta);
      if (this.world.getBlockW(t.x, lowerY + 1, t.z) === B.OAK_DOOR_TOP) this.world.setBlock(t.x, lowerY + 1, t.z, B.OAK_DOOR_TOP, meta);
      this.cb.playSound('place', { block: 'wood' });
      this.useCooldown = 0.25;
      return;
    }

    // 1) use a block (crafting table, furnace) — unless sneaking
    if (t && USABLE.has(t.id) && !p.sneaking) {
      const kind = { [B.CRAFTING_TABLE]: 'crafting', [B.CHEST]: 'chest', [B.BED]: 'bed' }[t.id] ?? 'furnace';
      this.cb.openUI(kind, t);
      return;
    }

    // 2) start eating (or drinking) — it takes a moment
    if (held) {
      const info = itemInfo(held.id);
      const wantsIt = info?.drink || p.hunger < 20 || (info?.heal && p.health < p.maxHealth);
      if ((info?.food || info?.drink) && wantsIt && p.mode !== GAMEMODE_CREATIVE) {
        this.eating = { id: held.id, slot: p.selected, t: 0, need: info.eatTime, auto: this.inputMode === 'touch' };
        this.cb.playSound('eat', {});
        return;
      }
    }

    // 3) item actions: equip armour, till, plant, fertilise, light TNT
    if (held && this.useItem(held, t)) return;
    if (held?.id === B.LILY_PAD) return;   // only ever floats on water (handled above)

    // 4) place a block
    if (!t || !held || !isBlockItem(held.id)) return;
    const info = blockInfo(held.id);

    // a slab on its matching half-slab completes the full block
    if (SLABS.has(info.id) && t.id === info.id) {
      const top = this.world.getMetaW(t.x, t.y, t.z) & 1;
      if (((t.ny === 1 && !top) || (t.ny === -1 && top)) && !this.intersectsPlayer(t.x, t.y, t.z)) {
        this.world.setBlock(t.x, t.y, t.z, info.full);
        this.cb.playSound('place', { block: info.sound });
        if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(1);
        return;
      }
    }

    // target position: replaceable blocks are overwritten in place
    let px = t.x, py = t.y, pz = t.z;
    const targetInfo = blockInfo(t.id);
    if (!targetInfo.replaceable) {
      px += t.nx; py += t.ny; pz += t.nz;
    }
    const existing = this.world.getBlockW(px, py, pz);
    // ...or into the empty half of a slab of the same kind
    if (SLABS.has(info.id) && existing === info.id) {
      if (this.intersectsPlayer(px, py, pz)) return;
      this.world.setBlock(px, py, pz, info.full);
      this.cb.playSound('place', { block: info.sound });
      if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(1);
      return;
    }
    if (!blockInfo(existing).replaceable) return;
    // underwater plants need water; nothing else floats on it
    if (info.waterlogged && existing !== B.WATER) return;
    if (info.id === B.LADDER && (t.ny !== 0 || !isSolid(t.id))) return;

    // support requirement for plants/torches
    if (NEEDS_GROUND.has(info.id)) {
      const below = this.world.getBlockW(px, py - 1, pz);
      if (!this.supportsTop(px, py - 1, pz) && !(info.id === B.KELP && below === B.KELP)) return;
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

    if (info.id === B.LADDER) meta = wallMeta(t.nx, t.nz);
    const yawQuad = Math.round((((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
    if (STAIRS.has(info.id)) {
      // climb away from the player; upside down against a ceiling or a block's upper half
      const fy = (t.point?.y ?? py) - Math.floor(t.point?.y ?? py);
      meta = [0, 3, 2, 1][yawQuad] | (t.ny === -1 || (t.ny === 0 && fy > 0.5) ? 4 : 0);
    }
    if (info.id === B.OAK_FENCE_GATE) meta = yawQuad & 1 ? 1 : 0;
    if (info.id === B.OAK_SIGN) {
      if (t.ny === 0) {
        // on a wall: text faces out, away from it
        if (!isSolid(t.id)) return;
        meta = (t.nz === -1 ? 0 : t.nx === 1 ? 1 : t.nz === 1 ? 2 : 3) | 4;
      } else {
        if (t.ny !== 1) return;
        meta = [2, 1, 0, 3][yawQuad];   // standing: text faces the player
      }
    }
    if (SLABS.has(info.id)) {
      // top half when placed against a ceiling or the upper half of a side
      const fy = (t.point?.y ?? py) - Math.floor(t.point?.y ?? py);
      meta = t.ny === -1 || (t.ny === 0 && fy > 0.5) ? 1 : 0;
    }
    if (info.id === B.OAK_DOOR) {
      // two blocks tall, standing on something, panel on the far edge
      if (!isSolid(this.world.getBlockW(px, py - 1, pz))) return;
      if (!blockInfo(this.world.getBlockW(px, py + 1, pz)).replaceable) return;
      if (this.intersectsPlayer(px, py, pz) || this.intersectsPlayer(px, py + 1, pz)) return;
      const yaw = ((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      meta = [0, 3, 2, 1][Math.round(yaw / (Math.PI / 2)) % 4];
      this.world.setBlock(px, py + 1, pz, B.OAK_DOOR_TOP, meta);
    }

    const old = this.world.setBlock(px, py, pz, info.id, meta);
    if (old === -1) return;
    if (info.id === B.FURNACE) this.world.setBlockEntity(px, py, pz, null);
    // saplings remember when to grow (seconds of loaded time)
    if (SAPLINGS.has(info.id)) this.world.setBlockEntity(px, py, pz, { kind: 'sapling', grow: 60 + this.dropRng() * 120 });
    if (info.id === B.FIRE) this.world.setBlockEntity(px, py, pz, { kind: 'fire', t: 8 });   // fire always burns out
    if (info.id === B.OAK_SIGN) {
      this.world.setBlockEntity(px, py, pz, { kind: 'sign', lines: ['', '', '', ''], rev: 0 });
      this.cb.editSign?.(px, py, pz);
    }
    this.cb.playSound('place', { block: info.sound });
    if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(1);
  }

  finishEating(held) {
    const p = this.player;
    const info = itemInfo(held.id);
    if (info.food) p.eat(info.food, info.sat);
    // some food doesn't sit well: you get hungry again fast
    if (info.sickly && this.dropRng() < info.sickly) { p.addExhaustion(10); this.cb.notify?.('That didn\'t agree with you…'); }
    if (info.heal) p.health = Math.min(p.maxHealth, p.health + info.heal);
    if (held.id === I.MILK_BUCKET) p.fireTime = 0;   // cools you right down
    p.consumeHeld(1);
    // stew and milk leave their container behind
    if (info.returns) {
      if (!p.inventory[p.selected]) p.inventory[p.selected] = { id: info.returns, count: 1 };
      else p.give(info.returns, 1);
    }
    p.events.dispatchEvent(new CustomEvent('inventory'));
    this.cb.playSound('pickup', {});
  }

  // Can something sit on top of this block? Solid, and (for part-blocks)
  // with a box reaching the top: a top slab yes, a bottom slab no.
  supportsTop(x, y, z) {
    const id = this.world.getBlockW(x, y, z);
    if (!isSolid(id)) return false;
    if (BLOCKS[id].render !== R_SHAPE) return true;
    return worldBoxes(this.world, x, y, z, id).some((b) => b[4] >= 1 && b[0] <= 0.25 && b[3] >= 0.75 && b[2] <= 0.25 && b[5] >= 0.75);
  }

  // Buckets scoop and pour water and lava; lily pads go on a water surface.
  useFluidItem(held) {
    const p = this.player;
    const creative = p.mode === GAMEMODE_CREATIVE;
    const ft = raycastBlocks(this.world, { x: p.x, y: p.eyeY, z: p.z }, p.lookDir(), REACH_DISTANCE, true);
    if (!ft) return false;
    const swapHeld = (id) => {
      if (creative) return;
      if (held.count > 1) {
        p.consumeHeld(1);
        // no room: drop the filled bucket rather than lose it
        if (p.give(id, 1) > 0) this.cb.spawnDrops(p.x, p.y + 1, p.z, [{ id, count: 1 }]);
      } else p.inventory[p.selected] = { id, count: 1 };
      p.events.dispatchEvent(new CustomEvent('inventory'));
    };
    this.useCooldown = 0.3;
    if (held.id === B.LILY_PAD) {
      if (ft.id !== B.WATER || this.world.getBlockW(ft.x, ft.y + 1, ft.z) !== B.AIR) return false;
      this.world.setBlock(ft.x, ft.y + 1, ft.z, B.LILY_PAD);
      if (!creative) p.consumeHeld(1);
      this.cb.playSound('place', { block: 'leaf' });
      return true;
    }
    if (held.id === I.BUCKET) {
      if (ft.id !== B.WATER && ft.id !== B.LAVA) return false;
      this.world.setBlock(ft.x, ft.y, ft.z, B.AIR);
      swapHeld(ft.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET);
      this.cb.playSound('splash', {});
      return true;
    }
    // pour: into the fluid cell itself, or the cell in front of the face we hit
    let x = ft.x, y = ft.y, z = ft.z;
    if (!blockInfo(ft.id).replaceable) { x += ft.nx; y += ft.ny; z += ft.nz; }
    const here = this.world.getBlockW(x, y, z);
    if (!blockInfo(here).replaceable) return false;
    const fluid = held.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
    this.world.setBlock(x, y, z, fluid);
    fluidContact(this.world, x, y, z, () => this.cb.playSound('splash', {}));
    swapHeld(I.BUCKET);
    this.cb.playSound('splash', {});
    return true;
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
    if (held.id === I.BUCKET || held.id === I.WATER_BUCKET || held.id === I.LAVA_BUCKET || held.id === B.LILY_PAD) {
      return this.useFluidItem(held);
    }
    // snowballs and eggs are for throwing
    if (held.id === I.SNOWBALL || held.id === I.EGG) {
      this.cb.throwItem?.(held.id === I.EGG ? 'egg' : 'snowball');
      if (!creative) p.consumeHeld(1);
      this.useCooldown = 0.25;
      return true;
    }
    if (held.id === I.FISHING_ROD) {
      this.cb.castRod?.();
      this.useCooldown = 0.35;
      return true;
    }
    if (!t) return false;

    // flint and steel: light TNT and campfires, or start a small fire
    if (held.id === I.FLINT_AND_STEEL) {
      if (t.id === B.TNT) {
        this.world.setBlock(t.x, t.y, t.z, B.AIR);
        this.cb.primeTnt?.(t.x + 0.5, t.y, t.z + 0.5);
      } else if (t.id === B.CAMPFIRE_OFF) {
        const st = campfireState(this.world, t.x, t.y, t.z);
        this.world.setBlock(t.x, t.y, t.z, B.CAMPFIRE);
        this.world.setBlockEntity(t.x, t.y, t.z, st);
      } else {
        const fx = t.x + t.nx, fy = t.y + t.ny, fz = t.z + t.nz;
        if (this.world.getBlockW(fx, fy, fz) !== B.AIR || !this.supportsTop(fx, fy - 1, fz)) return false;
        this.world.setBlock(fx, fy, fz, B.FIRE);
        this.world.setBlockEntity(fx, fy, fz, { kind: 'fire', t: 5 + this.dropRng() * 5 });
      }
      this.cb.playSound('place', { block: 'stone' });
      if (!creative) p.damageHeldTool(1);
      this.useCooldown = 0.3;
      return true;
    }

    // campfires: cook food on them, put them out with a shovel, relight with a torch
    if (CAMPFIRES.has(t.id)) {
      if (campfireCookable(held.id)) {
        if (addToCampfire(this.world, t.x, t.y, t.z, held.id)) {
          if (!creative) p.consumeHeld(1);
          this.cb.playSound('place', { block: 'wood' });
        } else {
          this.cb.notify?.('The campfire is full — wait for something to finish cooking.');
        }
        this.useCooldown = 0.25;
        return true;
      }
      const lit = t.id === B.CAMPFIRE;
      if ((lit && info?.tool?.class === 'shovel') || (!lit && held.id === B.TORCH)) {
        const st = campfireState(this.world, t.x, t.y, t.z);
        this.world.setBlock(t.x, t.y, t.z, lit ? B.CAMPFIRE_OFF : B.CAMPFIRE);
        this.world.setBlockEntity(t.x, t.y, t.z, st);   // setBlock cleared it; keep the food
        this.cb.playSound(lit ? 'splash' : 'place', { block: 'wood' });
        if (lit && !creative) p.damageHeldTool(1);
        return true;
      }
    }
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
      } else if (t.id === B.GRASS) {
        // scatter tall grass and the odd flower on open grass nearby
        let grew = 0;
        for (let i = 0; i < 24; i++) {
          const x = t.x + Math.round((this.dropRng() - 0.5) * 6), z = t.z + Math.round((this.dropRng() - 0.5) * 6);
          for (let y = t.y + 2; y >= t.y - 2; y--) {
            if (this.world.getBlockW(x, y, z) !== B.GRASS) continue;
            if (this.world.getBlockW(x, y + 1, z) !== B.AIR) break;
            const r = this.dropRng();
            this.world.setBlock(x, y + 1, z, r < 0.1 ? B.DANDELION : r < 0.2 ? B.POPPY : B.TALL_GRASS);
            grew++;
            break;
          }
        }
        if (!grew) return false;
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
