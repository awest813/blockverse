// What a ranch makes of its animals:
//
//   Nest   {kind:'nest', eggs, duck}       hens and ducks lay in one nearby; use it to collect (a collector empties it too)
//   Churn  {kind:'churn', milk, work}      pour in milk, then churn (use it empty-handed): butter
//   Press  {kind:'press', batches:[t...]}  put in milk; it's cheese once the world's clock reaches t
//   Hive   {kind:'hive', bees, honey, work, at}   bees move in by flowers and make honey; take it with a bowl
//
// The press keeps deadlines on the world's clock, so cheese goes on ripening
// while you're away or asleep (and its chunk is unloaded).
// The nest's meta shows how many eggs are in it (0-3); the churn's, whether
// the dasher is down; the press's, whether anything's in it.

import { B, isSolid } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { worldClock } from '../core/clock.js';
import { isBlockItem } from '../items/items.js';
import { tally } from './market.js';

export const NEST_MAX = 16;
const CHURN_MAX = 4, CHURNS = 6;     // buckets a churn holds; turns of the dasher per bucket
const PRESS_MAX = 4, PRESS_TIME = 300;   // seconds of the world's clock to press a cheese
const MILKS = new Set([I.MILK_BUCKET, I.GOAT_MILK_BUCKET]);

const count = (v, max) => (Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0);

function state(w, x, y, z, kind, fresh) {
  let st = w.blockEntityAt(x, y, z);
  if (!st || st.kind !== kind) { st = fresh(); w.setBlockEntity(x, y, z, st); }
  return st;
}
const nestState = (w, x, y, z) => {
  const st = state(w, x, y, z, 'nest', () => ({ kind: 'nest', eggs: 0, duck: 0 }));
  st.eggs = count(st.eggs, NEST_MAX); st.duck = count(st.duck, NEST_MAX);
  return st;
};
const churnState = (w, x, y, z) => {
  const st = state(w, x, y, z, 'churn', () => ({ kind: 'churn', milk: 0, work: 0 }));
  st.milk = count(st.milk, CHURN_MAX); st.work = count(st.work, CHURNS);
  return st;
};
const pressState = (w, x, y, z) => {
  const st = state(w, x, y, z, 'press', () => ({ kind: 'press', batches: [] }));
  st.batches = (Array.isArray(st.batches) ? st.batches : []).filter(Number.isFinite).slice(0, PRESS_MAX);
  return st;
};

// the block keeps its look in step with what's in it (setBlock clears the block entity: put it back)
function setMeta(w, x, y, z, id, meta, st) {
  if (w.getMetaW(x, y, z) === meta) return;
  w.setBlock(x, y, z, id, meta);
  w.setBlockEntity(x, y, z, st);
}
const nestMeta = (st) => Math.min(3, st.eggs + st.duck);

// into the pack (what doesn't fit drops at your feet)
function give(it, id, n) {
  const p = it.player;
  if (n <= 0) return;
  const left = p.give(id, n);
  if (left > 0) it.cb.spawnDrops(p.x, p.y + 1, p.z, [{ id, count: left }]);
  p.events.dispatchEvent(new CustomEvent('inventory'));
}

// the held bucket of milk goes in: an empty bucket comes back
function emptyBucket(it) {
  const p = it.player;
  if (p.mode === GAMEMODE_CREATIVE) return;
  p.inventory[p.selected] = { id: I.BUCKET, count: 1 };
  p.events.dispatchEvent(new CustomEvent('inventory'));
}

// ---- nests ----

// what a nest gives up when it's broken
export function nestContents(st) {
  return [{ id: I.EGG, count: count(st.eggs, NEST_MAX) }, { id: I.DUCK_EGG, count: count(st.duck, NEST_MAX) }].filter((s) => s.count);
}

// A hen (or duck) about to lay: the nearest nest it could walk to, with
// room, within a few blocks, or null.
function nestFor(world, m) {
  const x0 = Math.floor(m.x), y0 = Math.floor(m.y + 0.2), z0 = Math.floor(m.z);
  let best = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
    const x = x0 + dx, y = y0 + dy, z = z0 + dz;
    if (world.getBlockW(x, y, z) !== B.NEST) continue;
    const d = dx * dx + dz * dz + dy * dy * 4;
    if (d >= bd) continue;
    const st = world.blockEntityAt(x, y, z);
    if (st?.kind === 'nest' && count(st.eggs, NEST_MAX) + count(st.duck, NEST_MAX) >= NEST_MAX) continue;
    if (!walkable(world, m, x + 0.5, z + 0.5)) continue;
    best = { x, y, z }; bd = d;
  }
  return best;
}

// no wall or fence between the animal and (x, z) at knee height
function walkable(world, m, x, z) {
  const dx = x - m.x, dz = z - m.z, steps = Math.ceil(Math.hypot(dx, dz) * 3), y = Math.floor(m.y + 0.3);
  for (let i = 1; i < steps; i++) {
    const id = world.getBlockW(Math.floor(m.x + (dx * i) / steps), y, Math.floor(m.z + (dz * i) / steps));
    if (isSolid(id) || id === B.OAK_FENCE || id === B.OAK_FENCE_GATE) return false;
  }
  return true;
}

// Lay an egg: in a nest close by if there's one (a hen likes a nest), or
// on the ground.
export function layEgg(m, id) {
  tally('eggs');
  const n = nestFor(m.world, m);
  if (!n) { m.dropFn?.([{ id, count: 1 }]); return false; }
  const w = m.world, st = nestState(w, n.x, n.y, n.z);
  if (id === I.DUCK_EGG) st.duck++; else st.eggs++;
  w.setBlockEntity(n.x, n.y, n.z, st);
  setMeta(w, n.x, n.y, n.z, B.NEST, nestMeta(st), st);
  return true;
}

function useNest(it, t, held) {
  const w = it.world, st = nestState(w, t.x, t.y, t.z);
  if (held && isBlockItem(held.id)) return false;   // (set a block down beside it)
  if (!st.eggs && !st.duck) { it.cb.notify?.('An empty nest: hens and ducks nearby lay their eggs in it'); return true; }
  give(it, I.EGG, st.eggs);
  give(it, I.DUCK_EGG, st.duck);
  st.eggs = st.duck = 0;
  w.setBlockEntity(t.x, t.y, t.z, st);
  setMeta(w, t.x, t.y, t.z, B.NEST, 0, st);
  it.cb.playSound('pickup', {});
  return true;
}

// A collector takes eggs from the nests within reach into its chest
// (`store(stack)` returns how many didn't fit).
export function emptyNests(world, x, y, z, reach, store) {
  let took = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (world.getBlockW(nx, ny, nz) !== B.NEST) continue;
    const st = world.blockEntityAt(nx, ny, nz);
    if (st?.kind !== 'nest') continue;
    const eggs = count(st.eggs, NEST_MAX), duck = count(st.duck, NEST_MAX);
    if (!eggs && !duck) continue;
    st.eggs = eggs ? store({ id: I.EGG, count: eggs }) : 0;
    st.duck = duck ? store({ id: I.DUCK_EGG, count: duck }) : 0;
    took ||= st.eggs !== eggs || st.duck !== duck;
    world.setBlockEntity(nx, ny, nz, st);
    setMeta(world, nx, ny, nz, B.NEST, nestMeta(st), st);
  }
  return took;
}

// ---- the churn ----

function useChurn(it, t, held) {
  const w = it.world, st = churnState(w, t.x, t.y, t.z);
  if (held && MILKS.has(held.id)) {
    if (st.milk >= CHURN_MAX) { it.cb.notify?.('The churn is full: churn it (use it with an empty hand)'); return true; }
    st.milk++;
    w.setBlockEntity(t.x, t.y, t.z, st);
    emptyBucket(it);
    it.cb.playSound('splash', {});
    it.cb.notify?.(`Milk in the churn: ${st.milk} bucket${st.milk > 1 ? 's' : ''} — now churn it`);
    return true;
  }
  if (held && isBlockItem(held.id)) return false;
  if (!st.milk) { it.cb.notify?.('A butter churn: pour in milk, then churn it (use it with an empty hand)'); return true; }
  // a turn of the dasher
  st.work++;
  setMeta(w, t.x, t.y, t.z, B.CHURN, st.work & 1, st);
  it.cb.playSound('place', { block: 'wood', vol: 0.5 });
  if (st.work >= CHURNS) {
    st.work = 0;
    st.milk--;
    give(it, I.BUTTER, 2);
    tally('butter', 2);
    it.cb.notify?.(st.milk ? `Butter! (${st.milk} more bucket${st.milk > 1 ? 's' : ''} to churn)` : 'Butter!');
  } else it.cb.notify?.(`Churning… ${st.work}/${CHURNS}`);
  w.setBlockEntity(t.x, t.y, t.z, st);
  return true;
}

// ---- the cheese press ----

export function pressContents(st) {
  const ready = (Array.isArray(st.batches) ? st.batches : []).filter((t) => Number.isFinite(t) && t <= worldClock.now).length;
  return ready ? [{ id: I.CHEESE, count: ready }] : [];
}

const mins = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

function usePress(it, t, held) {
  const w = it.world, st = pressState(w, t.x, t.y, t.z), now = worldClock.now;
  if (held && MILKS.has(held.id)) {
    if (st.batches.length >= PRESS_MAX) { it.cb.notify?.('The press is full'); return true; }
    st.batches.push(now + PRESS_TIME);
    setMeta(w, t.x, t.y, t.z, B.CHEESE_PRESS, 1, st);
    w.setBlockEntity(t.x, t.y, t.z, st);
    emptyBucket(it);
    it.cb.playSound('splash', {});
    it.cb.notify?.(`Pressing: a cheese in ${mins(PRESS_TIME)}`);
    return true;
  }
  if (held && isBlockItem(held.id)) return false;
  const ready = st.batches.filter((b) => b <= now).length;
  if (ready) {
    st.batches = st.batches.filter((b) => b > now);
    give(it, I.CHEESE, ready);
    tally('cheese', ready);
    setMeta(w, t.x, t.y, t.z, B.CHEESE_PRESS, st.batches.length ? 1 : 0, st);
    w.setBlockEntity(t.x, t.y, t.z, st);
    it.cb.playSound('pickup', {});
    return true;
  }
  if (!st.batches.length) it.cb.notify?.('A cheese press: put in a bucket of milk, and in five minutes it’s cheese');
  else it.cb.notify?.(`${st.batches.length} cheese pressing: the next is ready in ${mins(Math.min(...st.batches) - now)}`);
  return true;
}

// ---- the beehive ----

const HIVE_BEES = 3, HIVE_HONEY = 5;
const HONEY_WORK = 240;   // bee-seconds of the world's clock (with flowers about) to a bowl of honey
const FLOWERS = new Set([B.DANDELION, B.POPPY, B.CORNFLOWER]);

function flowersNear(w, x, y, z) {
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) if (FLOWERS.has(w.getBlockW(x + dx, y + dy, z + dz))) n++;
  return n;
}

// Every few seconds a hive is loaded: bees move in (by flowers, by day),
// honey is made for the time that's passed (while it was unloaded too, up
// to a limit), and its bees fly about while you're near.
export function tickHive(game, st, x, y, z, makeBee) {
  const w = game.world, now = worldClock.now;
  st.bees = count(st.bees, HIVE_BEES); st.honey = count(st.honey, HIVE_HONEY);
  const away = Number.isFinite(st.at) ? Math.min(2400, Math.max(0, now - st.at)) : 0;
  st.at = Math.round(now);
  if (w.dimension === 'scorch') return;   // (no bees in that heat)
  const flowers = flowersNear(w, x, y, z), day = !game.isNight?.();
  if (st.bees && flowers) {
    st.work = (Number.isFinite(st.work) ? st.work : 0) + away * st.bees;
    while (st.work >= HONEY_WORK && st.honey < HIVE_HONEY) { st.work -= HONEY_WORK; st.honey++; }
    if (st.honey >= HIVE_HONEY) st.work = 0;
  }
  if (flowers >= 2 && st.bees < HIVE_BEES && day && Math.random() < 0.06) st.bees++;
  w.markModified(x, z);
  // out and about by day while you're near
  const p = game.player;
  if (!st.bees || !day || Math.hypot(p.x - x, p.z - z) > 24) return;
  const out = game.entities.mobs.filter((m) => m.kind === 'bee' && m.hive?.x === x && m.hive.y === y && m.hive.z === z).length;
  if (out < st.bees) makeBee(x, y, z);
}

function useHive(it, t, held) {
  const w = it.world, st = state(w, t.x, t.y, t.z, 'hive', () => ({ kind: 'hive', bees: 0, honey: 0 }));
  st.bees = count(st.bees, HIVE_BEES); st.honey = count(st.honey, HIVE_HONEY);
  if (held?.id === I.BOWL) {
    if (!st.honey) { it.cb.notify?.(st.bees ? 'No honey yet: the bees are still at work' : 'No bees, no honey: set the hive by flowers'); return true; }
    st.honey--;
    tally('honey');
    w.setBlockEntity(t.x, t.y, t.z, st);
    const p = it.player;
    if (p.mode !== GAMEMODE_CREATIVE) {
      p.consumeHeld(1);
      if (!p.inventory[p.selected]) p.inventory[p.selected] = { id: I.HONEY_BOWL, count: 1 };
      else give(it, I.HONEY_BOWL, 1);
      p.events.dispatchEvent(new CustomEvent('inventory'));
    }
    it.cb.playSound('pickup', {});
    return true;
  }
  // shears: the comb from a full hive
  if (held?.id === I.SHEARS) {
    if (st.honey < HIVE_HONEY) { it.cb.notify?.(`The comb isn\u2019t full yet (honey ${st.honey}/${HIVE_HONEY})`); return true; }
    st.honey = 0;
    w.setBlockEntity(t.x, t.y, t.z, st);
    give(it, I.HONEYCOMB, 3);
    if (it.player.mode !== GAMEMODE_CREATIVE) it.player.damageHeldTool(1);
    it.cb.playSound('shear', {});
    return true;
  }
  if (held && isBlockItem(held.id)) return false;
  if (!st.bees) it.cb.notify?.('An empty hive: bees move in when there are flowers close by (two or more)');
  else it.cb.notify?.(`Beehive: ${st.bees} bee${st.bees > 1 ? 's' : ''}, honey ${st.honey}/${HIVE_HONEY}${st.honey >= HIVE_HONEY ? ' — a bowl takes honey, shears the comb' : st.honey ? ' — take it with a bowl' : ''}`);
  return true;
}

// right-click on a nest, churn, press or hive; false lets the click do what it otherwise would
export function useProduce(it, t, held) {
  if (t.id === B.BEEHIVE) return useHive(it, t, held);
  if (t.id === B.NEST) return useNest(it, t, held);
  if (t.id === B.CHURN) return useChurn(it, t, held);
  if (t.id === B.CHEESE_PRESS) return usePress(it, t, held);
  return false;
}
