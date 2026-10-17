// Farming and husbandry machines (block entities, ticked in loaded chunks):
//
//   Composter  {kind:'composter', level 0..7}  plant scraps in, bone meal out
//   Sprinkler  {kind:'sprinkler'}              waters crops within 4 blocks (see saplings.js cropTime)
//   Harvester  {kind:'harvester', t}           reaps ripe crops within 4 blocks, replants, fills a chest beside it
//   Collector  {kind:'collector'}              draws in items lying within 4 blocks and puts them in a chest beside it
//   Trough     {kind:'trough', slots:[3]}      animal feed; animals nearby eat, breed in pairs, babies grow faster
//
// Chests "beside" a machine are any of its six neighbours.

import { B, blockInfo } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { CHUNK_Y, GAMEMODE_CREATIVE } from '../core/constants.js';
import { maxStack, itemInfo } from '../items/items.js';
import { cropFamily, isRipe, cropTime } from './saplings.js';

const REACH = 4;
const NEIGHBOURS = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

// ---- composter ----

// chance that one item raises the level (crunchier scraps compost slower)
const COMPOST = new Map([
  [I.WHEAT_SEEDS, 0.3], [B.OAK_LEAVES, 0.3], [B.BIRCH_LEAVES, 0.3], [B.SPRUCE_LEAVES, 0.3], [B.TALL_GRASS, 0.3],
  [B.OAK_SAPLING, 0.3], [B.BIRCH_SAPLING, 0.3], [B.SPRUCE_SAPLING, 0.3], [B.PALM_SAPLING, 0.3], [B.PALM_LEAVES, 0.3], [I.COCONUT, 0.65], [B.KELP, 0.3], [B.SEAGRASS, 0.3], [B.DEAD_BUSH, 0.3],
  [B.SUGAR_CANE, 0.5], [B.CACTUS, 0.5], [I.DRIED_KELP, 0.5],
  [I.WHEAT, 0.65], [I.CARROT, 0.65], [I.POTATO, 0.65], [I.APPLE, 0.65], [B.PUMPKIN, 0.65], [B.LILY_PAD, 0.65],
  [B.DANDELION, 0.65], [B.POPPY, 0.65], [B.MUSHROOM_BROWN, 0.65], [B.MUSHROOM_RED, 0.65],
  [I.BREAD, 0.85], [I.BAKED_POTATO, 0.85], [B.HAY_BALE, 0.85],
]);
const FULL = 7;

export function useComposter(it, t, held) {
  const w = it.world, p = it.player;
  const st = w.blockEntityAt(t.x, t.y, t.z) ?? { kind: 'composter', level: 0 };
  if (st.level >= FULL) {
    st.level = 0;
    w.setBlockEntity(t.x, t.y, t.z, st);
    it.cb.spawnDrops(t.x + 0.5, t.y + 1.1, t.z + 0.5, [{ id: I.BONE_MEAL, count: 1 }]);
    it.cb.playSound('place', { block: 'dirt' });
    return true;
  }
  const chance = held ? COMPOST.get(held.id) : undefined;
  if (chance === undefined) {
    if (held && itemInfo(held.id)?.food) { it.cb.notify?.(`${itemInfo(held.id).display} won't compost — try seeds, crops, leaves or flowers`); return true; }
    if (held) return false;   // something else in hand: place it, use it...
    it.cb.notify?.(`Composter: ${st.level}/${FULL} — add seeds, crops, leaves or flowers`);
    return true;
  }
  if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(1);
  if (Math.random() < chance) {
    st.level++;
    it.cb.sparkle?.(t.x + 0.5, t.y + 1, t.z + 0.5);
    if (st.level >= FULL) it.cb.notify?.('The composter is full — use it to collect bone meal');
  }
  w.setBlockEntity(t.x, t.y, t.z, st);
  it.cb.playSound('place', { block: 'leaf' });
  return true;
}

// ---- trough ----

// what goes in (a hay bale goes in as nine wheat)
// (every farm animal's food: pandas' cane, camels' cactus, bears' and pelicans' fish, crabs' kelp)
export const FEEDS = new Set([I.WHEAT, I.WHEAT_SEEDS, I.CARROT, I.POTATO, I.APPLE, B.SUGAR_CANE, B.CACTUS, I.FISH_RAW, B.KELP, I.DRIED_KELP]);

function troughState(w, x, y, z) {
  let st = w.blockEntityAt(x, y, z);
  if (!st || st.kind !== 'trough') { st = { kind: 'trough', slots: [null, null, null] }; w.setBlockEntity(x, y, z, st); }
  return st;
}

// add `count` of `id` to a few slots; returns how many didn't fit
function addTo(slots, id, count) {
  const max = maxStack(id);
  for (const s of slots) {
    if (count <= 0) break;
    if (s && s.id === id && s.dur === undefined && s.count < max) { const n = Math.min(count, max - s.count); s.count += n; count -= n; }
  }
  for (let i = 0; i < slots.length && count > 0; i++) {
    if (slots[i]) continue;
    const n = Math.min(count, max);
    slots[i] = { id, count: n };
    count -= n;
  }
  return count;
}

// how many of `id` the slots could still take
function roomFor(slots, id) {
  const max = maxStack(id);
  return slots.reduce((n, s) => n + (!s ? max : s.id === id && s.dur === undefined ? max - s.count : 0), 0);
}

export function useTrough(it, t, held) {
  const w = it.world, p = it.player;
  const st = troughState(w, t.x, t.y, t.z);
  // a water trough: a bucket of water fills an empty one (and a bucket takes it back)
  const watered = (w.getMetaW(t.x, t.y, t.z) & 1) === 1;
  if (held?.id === I.WATER_BUCKET && !watered) {
    if (st.slots.some(Boolean)) { it.cb.notify?.('Empty the feed out first: a trough holds feed or water, not both'); return true; }
    if (w.dimension === 'scorch') return false;   // (it'd only boil away: the bucket's own hiss)
    w.setBlock(t.x, t.y, t.z, B.TROUGH, 1);
    w.setBlockEntity(t.x, t.y, t.z, st);
    swapBucket(it, held, I.BUCKET);
    it.cb.playSound('splash', {});
    it.cb.notify?.('A water trough: animals in a pen with water are happier');
    return true;
  }
  if (watered) {
    if (held?.id === I.BUCKET) {
      w.setBlock(t.x, t.y, t.z, B.TROUGH, 0);
      w.setBlockEntity(t.x, t.y, t.z, st);
      swapBucket(it, held, I.WATER_BUCKET);
      it.cb.playSound('splash', {});
      return true;
    }
    if (held && !FEEDS.has(held.id) && held.id !== B.HAY_BALE) return false;
    it.cb.notify?.('A water trough — it holds water, not feed');
    return true;
  }
  const bale = held?.id === B.HAY_BALE;
  if (!held || (!FEEDS.has(held.id) && !bale)) {
    if (held && itemInfo(held.id)?.food) {
      it.cb.notify?.(held.id === I.GOLDEN_CARROT ? 'Golden carrots are too good for the trough — feed them by hand' : `Animals won't eat ${itemInfo(held.id).display} from a trough`);
      return true;
    }
    if (held) return false;
    const what = st.slots.filter(Boolean).map((s) => `${s.count} ${blockInfoName(s.id)}`).join(', ');
    it.cb.notify?.(what ? `Trough: ${what}` : 'Trough: empty — fill it with wheat, seeds, carrots, potatoes, apples or hay');
    return true;
  }
  // the whole stack goes in (a hay bale counts as nine wheat)
  const id = bale ? I.WHEAT : held.id, per = bale ? 9 : 1;
  const room = roomFor(st.slots, id);
  const put = Math.min(held.count, Math.floor(room / per));
  if (put) addTo(st.slots, id, put * per);
  if (!put) { it.cb.notify?.('The trough is full'); return true; }
  if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(put);
  w.setBlockEntity(t.x, t.y, t.z, st);
  it.cb.playSound('place', { block: 'leaf' });
  return true;
}

// the held bucket becomes `id` (one of a stack: the filled one goes in the pack)
function swapBucket(it, held, id) {
  const p = it.player;
  if (p.mode === GAMEMODE_CREATIVE) return;
  if (held.count > 1) {
    p.consumeHeld(1);
    if (p.give(id, 1) > 0) it.cb.spawnDrops(p.x, p.y + 1, p.z, [{ id, count: 1 }]);
  } else p.inventory[p.selected] = { id, count: 1 };
  p.events.dispatchEvent(new CustomEvent('inventory'));
}

function blockInfoName(id) {
  return (id < 256 ? blockInfo(id)?.display : ITEM_NAMES[id]) ?? 'feed';
}
const ITEM_NAMES = { [I.WHEAT]: 'wheat', [I.WHEAT_SEEDS]: 'seeds', [I.CARROT]: 'carrots', [I.POTATO]: 'potatoes', [I.APPLE]: 'apples' };

// take one item an animal likes from the trough
function takeFor(st, mob) {
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    if (!s || !mob.likes(s.id)) continue;
    const id = s.id;
    if (--s.count <= 0) st.slots[i] = null;
    return id;
  }
  return null;
}
const hasFor = (st, mob, n) => st.slots.reduce((k, s) => k + (s && mob.likes(s.id) ? s.count : 0), 0) >= n;

// an animal only eats from a trough it can walk to: no feeding through a fence or wall
function canReach(w, x, y, z, m) {
  const cx = x + 0.5, cz = z + 0.5, dx = m.x - cx, dz = m.z - cz;
  const steps = Math.ceil(Math.hypot(dx, dz) * 2);
  const ty = Math.floor(m.y + 0.2);
  for (let i = 1; i < steps - 1; i++) {   // (not the animal's own spot: it may be pressed into a fence)
    const bx = Math.floor(cx + (dx * i) / steps), bz = Math.floor(cz + (dz * i) / steps);
    if (bx === x && bz === z) continue;
    if (blockInfo(w.getBlockW(bx, ty, bz))?.solid) return false;
  }
  return true;
}

// a trough stops pairing animals up once this many of a kind crowd round it
// (a pen of hundreds would grind a Chromebook to a halt)
const CROWDED = 16;

function tickTrough(game, st, x, y, z) {
  const near = game.entities.mobs.filter((m) => m.breedItem && !m.tamed && !m.dead && m.dying === undefined
    && Math.hypot(m.x - x - 0.5, m.z - z - 0.5) <= 6 && Math.abs(m.y - y) < 3 && canReach(game.world, x, y, z, m));
  let fed = false;
  // babies first: a mouthful each helps them grow
  for (const m of near) {
    if (!m.baby || !hasFor(st, m, 1)) continue;
    const id = takeFor(st, m);
    if (id && m.feed(id, 15)) fed = true;   // (a mouthful a visit: a trough-fed baby grows up in about two minutes, not twenty-five seconds)
  }
  // then adults, two at a time of the same kind, so they pair up
  const ready = near.filter((m) => !m.baby && !(m.love > 0) && !((m.breedCooldown ?? 0) > 0) && !m.unhappy());
  const byKind = new Map();
  for (const m of ready) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
  for (const group of byKind.values()) {
    // each pair makes one baby, up to the crowding limit (counting the whole pen, not just those at the trough)
    const pen = game.entities.mobs.filter((m) => m.kind === group[0].kind && !m.dead && m.dying === undefined && Math.hypot(m.x - x - 0.5, m.z - z - 0.5) <= 10).length;
    const pairs = Math.max(0, CROWDED - pen);
    for (let i = 0; i + 1 < group.length && i / 2 < pairs; i += 2) {
      const [a, b] = [group[i], group[i + 1]];
      if (!hasFor(st, a, 2)) break;
      a.feed(takeFor(st, a));
      b.feed(takeFor(st, b));
      fed = true;
    }
  }
  if (fed) game.world.markModified(x, z);
}

// ---- chests beside a machine ----

function chestBeside(w, x, y, z) {
  for (const [dx, dy, dz] of NEIGHBOURS) {
    const cx = x + dx, cy = y + dy, cz = z + dz;
    if (w.getBlockW(cx, cy, cz) !== B.CHEST) continue;
    let st = w.blockEntityAt(cx, cy, cz);
    if (!st || st.kind !== 'chest') { st = { kind: 'chest', slots: new Array(27).fill(null) }; w.setBlockEntity(cx, cy, cz, st); }
    return { st, x: cx, y: cy, z: cz };
  }
  return null;
}

// put a stack in a chest; returns how many didn't fit
function store(w, chest, stack) {
  let left = stack.count;
  if (stack.dur !== undefined) {   // worn tools don't stack
    const i = chest.st.slots.indexOf(null);
    if (i < 0) return left;
    chest.st.slots[i] = { ...stack };
    left = 0;
  } else {
    left = addTo(chest.st.slots, stack.id, left);
  }
  if (left !== stack.count) w.markModified(chest.x, chest.z);
  return left;
}

// ---- harvester ----

// a chest with no room left for anything
const chestFull = (chest) => chest.st.slots.every((s) => s && s.count >= maxStack(s.id));

function tickHarvester(game, st, x, y, z) {
  const w = game.world;
  const chest = chestBeside(w, x, y, z);
  // its chest full: it waits, rather than strewing the crops to rot
  if (chest && chestFull(chest)) return;
  let reaped = 0;
  for (let dy = -1; dy <= 1 && reaped < 6; dy++) {
    for (let dx = -REACH; dx <= REACH && reaped < 6; dx++) {
      for (let dz = -REACH; dz <= REACH && reaped < 6; dz++) {
        const cx = x + dx, cy = y + dy, cz = z + dz;
        const id = w.getBlockW(cx, cy, cz);
        if (!isRipe(id)) continue;
        const fam = cropFamily(id);
        const drops = blockInfo(id).drop?.(Math.random) ?? [];
        // keep one seed (carrot, potato) back to replant
        const seed = drops.find((d) => d.id === fam[2] && d.count > 0);
        if (seed) seed.count--;
        w.setBlock(cx, cy, cz, seed ? fam[0] : B.AIR);
        if (seed) w.setBlockEntity(cx, cy, cz, { kind: 'crop', grow: cropTime(w, cx, cy, cz, Math.random) });
        for (const d of drops) {
          if (d.count <= 0) continue;
          const left = chest ? store(w, chest, d) : d.count;
          if (left > 0) game.entities.spawnDrops(cx + 0.5, cy + 0.3, cz + 0.5, [{ ...d, count: left }]);
        }
        game.sparks?.(cx + 0.5, cy + 0.5, cz + 0.5, 0x8fcf5a, 4);
        reaped++;
      }
    }
  }
  if (reaped) game.sfx?.play('break', { block: 'leaf', pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, vol: 0.6 });
}

// ---- collector ----

function tickCollector(game, x, y, z) {
  const w = game.world;
  const chest = chestBeside(w, x, y, z);
  if (!chest) return;
  let took = false;
  for (const d of game.entities.drops) {
    if (d.dead || d.pickupDelay > 0.2) continue;
    if (Math.hypot(d.x - x - 0.5, d.z - z - 0.5) > REACH || Math.abs(d.y - y - 0.5) > 2.5) continue;
    const left = store(w, chest, { id: d.id, count: d.count, dur: d.dur });
    if (left === d.count) continue;   // chest full
    took = true;
    if (left > 0) d.count = left;
    else d.kill();
  }
  if (took) game.sfx?.play('pickup', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, vol: 0.4 });
}

// ---- the tick ----

const PERIOD = { harvester: 3, collector: 0.5, trough: 5, sprinkler: 1.2 };

export function tickFarmTech(game, dt) {
  const { world, player } = game;
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of chunk.blockEntities) {
      const period = PERIOD[st.kind];
      if (!period) continue;
      st.t = (st.t ?? Math.random() * period) - dt;
      if (st.t > 0) continue;
      st.t = period;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16, lx = (rest - lz) / 16;
      const x = chunk.cx * 16 + lx, z = chunk.cz * 16 + lz;
      if (st.kind === 'harvester') { if (world.getBlockW(x, y, z) === B.HARVESTER) tickHarvester(game, st, x, y, z); }
      else if (st.kind === 'collector') { if (world.getBlockW(x, y, z) === B.COLLECTOR) tickCollector(game, x, y, z); }
      else if (st.kind === 'trough') { if (world.getBlockW(x, y, z) === B.TROUGH && !(world.getMetaW(x, y, z) & 1)) tickTrough(game, st, x, y, z); }
      else if (st.kind === 'sprinkler' && Math.hypot(x - player.x, z - player.z) < 24 && world.getBlockW(x, y, z) === B.SPRINKLER) {
        game.sparks?.(x + 0.5, y + 0.7, z + 0.5, 0x7ab8f0, 5);   // a little spray
      }
    }
  }
}

// what a machine is up to, for a right-click
export function describeMachine(w, t) {
  if (t.id === B.SPRINKLER) {
    let n = 0;
    for (let dy = -2; dy <= 1; dy++) for (let dx = -REACH; dx <= REACH; dx++) for (let dz = -REACH; dz <= REACH; dz++) if (cropFamily(w.getBlockW(t.x + dx, t.y + dy, t.z + dz))) n++;
    return `Sprinkler: watering ${n} crop${n === 1 ? '' : 's'} within ${REACH} blocks`;
  }
  const chest = chestBeside(w, t.x, t.y, t.z);
  if (t.id === B.COLLECTOR) return chest ? `Collector: gathering items within ${REACH} blocks into the chest beside it` : 'Collector: put a chest next to it to collect into';
  let ripe = 0, growing = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -REACH; dx <= REACH; dx++) for (let dz = -REACH; dz <= REACH; dz++) {
    const id = w.getBlockW(t.x + dx, t.y + dy, t.z + dz);
    if (isRipe(id)) ripe++; else if (cropFamily(id)) growing++;
  }
  return `Harvester: ${ripe} ripe, ${growing} growing — ${chest ? (chestFull(chest) ? 'its chest is full, so it waits' : 'filling the chest beside it') : 'no chest beside it, so the crops pop out where they grew'}`;
}

