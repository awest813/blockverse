// Pens, homes and how the animals feel about them.
//
// A pen is found by walking the ground an animal could walk from where it
// stands: fences, closed gates, walls, troughs and drops of more than three
// blocks hem it in; open gates and doors let it out. If the walk stays within
// 33 blocks across, the animal is penned. Pens are found a few at
// a time and kept a few seconds (every animal in one shares it).
//
// Each penned animal's mood (0..100) comes from the pen: room per animal,
// food (a trough with something it eats, grass to graze, or a meal not long
// ago), water (a pond or a water trough), shelter at night and in the rain,
// and no monsters prowling near. Happy animals give wool, eggs and milk
// sooner and their young grow faster; miserable ones won't breed.

import { B, BLOCKS, R_SHAPE, isSolid, isWater } from '../blocks/blocks.js';
import { worldBoxes } from '../blocks/shapes.js';
import { worldClock } from '../core/clock.js';
import { newFrame } from './pathing.js';

const SPAN_MAX = 32;       // how far across a pen may run
const MAX_CELLS = 1089;    // (33 × 33)
const MAX_DROP = 3;        // a longer drop is a wall: animals won't jump it
const KEEP = 10;           // seconds a found pen (or open ground) is trusted
const ROOF = 8;            // how high a roof may be and still shelter

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// what a rancher builds: a pen needs at least one of these in its bounds
// (a cow in a hollow of the hills isn't anyone's)
const BUILT = new Set([B.OAK_FENCE, B.OAK_FENCE_GATE, B.TROUGH, B.OAK_DOOR, B.OAK_DOOR_TOP]);
const SPAN = 1 << 20;
const cellKey = (x, z) => x * SPAN + z;

// how high a block's collision reaches (0: walk through; over 1: a fence's height)
function top(world, x, y, z) {
  const id = world.getBlockW(x, y, z);
  if (!isSolid(id)) return 0;
  if (BLOCKS[id].render !== R_SHAPE) return 1;
  if ((id === B.OAK_DOOR || id === B.OAK_DOOR_TOP) && (world.getMetaW(x, y, z) & 4)) return 0;   // an open door: a way out
  let t = 0;
  for (const b of worldBoxes(world, x, y, z, id, true)) t = Math.max(t, b[4]);
  return t;
}

// From a cell at feet level y, the feet level of the neighbouring column
// (x, z), or null if an animal can't get there.
export function stepTo(world, x, y, z) {
  const id = world.getBlockW(x, y, z);
  if (id === B.TROUGH || id === B.LAVA || world.getBlockW(x, y - 1, z) === B.LAVA) return null;
  if (top(world, x, y - 1, z) > 1) return null;          // a fence standing a level down still reaches up here
  const t0 = top(world, x, y, z);
  if (t0 > 1) return null;                                // a fence, a closed gate
  if (t0 > 0.6) {                                         // a block: hop up onto it
    if (top(world, x, y + 1, z) > 0 || top(world, x, y + 2, z) > 0) return null;
    return y + 1;
  }
  if (top(world, x, y + 1, z) > 0) return null;           // no headroom
  if (t0 > 0 || top(world, x, y - 1, z) > 0 || isWater(world.getBlockW(x, y - 1, z)) || isWater(id)) return y;
  for (let k = 1; k <= MAX_DROP; k++) {                   // step down (or fall)
    const below = world.getBlockW(x, y - 1 - k, z);
    if (below === B.LAVA) return null;
    if (top(world, x, y - 1 - k, z) > 0 || isWater(below)) return y - k;
  }
  return null;                                            // a cliff: as good as a wall
}

// Walk the pen from (x, y, z) (feet level). Null if the ground runs on (or
// nothing built hems it in).
export function findPen(world, x, y, z) {
  const cells = new Map([[cellKey(x, z), y]]);
  const stack = [[x, y, z]];
  const troughs = [];
  let water = false, grass = 0, roofed = 0, built = false;
  let x0 = x, x1 = x, z0 = z, z1 = z;
  while (stack.length) {
    const [cx, cy, cz] = stack.pop();
    const floor = world.getBlockW(cx, cy - 1, cz);
    if (isWater(floor) || isWater(world.getBlockW(cx, cy, cz))) water = true;
    else if (floor === B.GRASS) grass++;
    for (let k = 1; k <= ROOF; k++) if (isSolid(world.getBlockW(cx, cy + k, cz)) || BLOCKS[world.getBlockW(cx, cy + k, cz)]?.opacity > 0) { roofed++; break; }
    for (const [dx, dz] of SIDES) {
      const nx = cx + dx, nz = cz + dz, key = cellKey(nx, nz);
      if (cells.has(key)) continue;
      // a trough on the pen's edge feeds (or waters) it
      for (const ty of [cy, cy - 1]) {
        if (world.getBlockW(nx, ty, nz) === B.TROUGH && !troughs.some((t) => t.x === nx && t.y === ty && t.z === nz)) troughs.push({ x: nx, y: ty, z: nz });
      }
      if (!world.isLoaded(nx, nz)) return null;   // (the edge of the loaded world isn't a wall)
      const ny = stepTo(world, nx, cy, nz);
      if (ny === null) {
        built ||= BUILT.has(world.getBlockW(nx, cy, nz)) || BUILT.has(world.getBlockW(nx, cy + 1, nz)) || BUILT.has(world.getBlockW(nx, cy - 1, nz));
        continue;
      }
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); z0 = Math.min(z0, nz); z1 = Math.max(z1, nz);
      if (x1 - x0 > SPAN_MAX || z1 - z0 > SPAN_MAX) return null;   // out it goes
      cells.set(key, ny);
      if (cells.size > MAX_CELLS) return null;
      stack.push([nx, ny, nz]);
    }
  }
  if (!built) return null;
  for (const t of troughs) {
    if (world.getMetaW(t.x, t.y, t.z) & 1) water = true;
    else t.feed = world.blockEntityAt(t.x, t.y, t.z)?.slots ?? null;
  }
  return { cells, size: cells.size, x0, x1, z0, z1, water, grass, roofed, troughs: troughs.filter((t) => t.feed), animals: 0, threats: 0, at: 0 };
}

// ---- the pens of the loaded world, kept a few seconds ----

const cache = new WeakMap();   // world -> { pens: [], open: Map(cellKey -> time) }

function penOf(world, x, y, z, now) {
  let c = cache.get(world);
  if (!c) cache.set(world, c = { pens: [], open: new Map() });
  c.pens = c.pens.filter((p) => now - p.at < KEEP);
  const key = cellKey(x, z);
  for (const p of c.pens) {
    const py = p.cells.get(key);
    if (py !== undefined && Math.abs(py - y) <= 1) return p;
  }
  const seen = c.open.get(key);
  if (seen !== undefined && now - seen < KEEP) return null;
  const p = findPen(world, x, y, z);
  if (!p) {
    if (c.open.size > 4096) c.open.clear();
    c.open.set(key, now);
    return null;
  }
  p.at = now;
  c.pens.push(p);
  return p;
}

// forget what's known about pens near an edit (a fence put up or knocked down)
export function penEdited(world, x, z) {
  const c = cache.get(world);
  if (!c) return;
  c.pens = c.pens.filter((p) => x < p.x0 - 1 || x > p.x1 + 1 || z < p.z0 - 1 || z > p.z1 + 1);
  c.open.clear();   // (open ground may be fenced in now)
}

// ---- mood ----

export const HAPPY = 70, UNHAPPY = 30, NO_BREEDING = 25;

// how much faster (or slower) a contented (or miserable) animal produces
export function moodRate(m) {
  if (!m.pen || !Number.isFinite(m.mood)) return 1;   // (only a penned animal's mood counts)
  return m.mood >= HAPPY ? 1.5 : m.mood < UNHAPPY ? 0.6 : 1;
}

export function moodWord(mood) {
  return mood >= 85 ? 'Very happy' : mood >= HAPPY ? 'Happy' : mood >= UNHAPPY + 10 ? 'Content' : mood >= UNHAPPY ? 'Unsettled' : 'Unhappy';
}

const farmAnimal = (m) => m.breedItem && !m.tamed && !m.dead && m.dying === undefined;
const cellOf = (m) => [Math.floor(m.x), Math.floor(m.y + 0.2), Math.floor(m.z)];

// The pen's head count and the monsters about it (once per pen per round).
function census(p, mobs, now) {
  if (p.counted === now) return;
  p.counted = now;
  p.animals = 0; p.threats = 0;
  for (const m of mobs) {
    if (m.dead || m.dying !== undefined) continue;
    if (m.hostile) {
      if (m.x > p.x0 - 8 && m.x < p.x1 + 9 && m.z > p.z0 - 8 && m.z < p.z1 + 9) p.threats++;
    } else if (farmAnimal(m)) {
      const [x, y, z] = cellOf(m), py = p.cells.get(cellKey(x, z));
      if (py !== undefined && Math.abs(py - y) <= 1) p.animals++;
    }
  }
}

// What the animal's pen does for it: [target mood, reasons]
function judge(m, p, game) {
  let mood = 50;
  const why = [];
  const room = p.size / Math.max(1, p.animals);
  if (room >= 10) { mood += 15; why.push('roomy'); }
  else if (room >= 5) why.push('enough room');
  else if (room >= 2.5) { mood -= 15; why.push('crowded'); }
  else { mood -= 30; why.push('cramped'); }
  const trough = p.troughs.some((t) => t.feed?.some((s) => s && m.likes(s.id)));
  const fedLately = worldClock.now - (m.fedAt ?? -1e9) < 600;
  if (trough || fedLately || p.grass >= 2 * p.animals) { mood += 15; why.push('well fed'); }
  else { mood -= 25; why.push('hungry'); }
  if (p.water) { mood += 10; why.push('water'); }
  else { mood -= 15; why.push('thirsty'); }
  const exposed = game.isNight?.() || game.weather?.kind === 'rain' || game.weather?.kind === 'storm';
  if (exposed) {
    if (p.roofed >= Math.min(p.size, p.animals)) { mood += 5; why.push('sheltered'); }
    else { mood -= 10; why.push(game.weather?.kind === 'rain' || game.weather?.kind === 'storm' ? 'out in the rain' : 'cold at night'); }
  }
  if (p.threats) { mood -= 20; why.push('frightened'); }
  return [Math.max(0, Math.min(100, mood)), why];
}

// A few animals a frame: find their pens, set their homes, nudge their moods.
const EVERY = 3;   // seconds between looks at one animal
export function tickRanch(game, dt) {
  newFrame();   // (the path searches this frame may make)
  const mobs = game.entities?.mobs;
  if (!mobs?.length) return;
  const now = worldClock.now;
  let budget = 6;
  for (const m of mobs) {
    if (!farmAnimal(m)) continue;
    m.ranchT = (m.ranchT ?? Math.random() * EVERY) - dt;
    if (m.ranchT > 0 || budget <= 0) continue;
    m.ranchT = EVERY;
    budget--;
    const [x, y, z] = cellOf(m);
    if (!game.world.isLoaded(x, z) || !m.onGround && !m.inWater) continue;
    const p = penOf(game.world, x, y, z, now);
    m.pen = p;
    if (!p) { m.moodWhy = null; continue; }
    census(p, mobs, now);
    m.persistent = true;   // a penned animal is someone's
    m.home = { x, y, z };
    const [target, why] = judge(m, p, game);
    // moods change gradually (a cloud passing doesn't break its heart)
    m.mood = Number.isFinite(m.mood) ? m.mood + Math.max(-8, Math.min(8, target - m.mood)) : target;
    m.moodWhy = why;
  }
}
