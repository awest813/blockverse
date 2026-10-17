// Plant growth in loaded chunks. Saplings grow into trees after a few
// minutes; crops (wheat, carrots, potatoes) advance one stage at a time,
// twice as fast on farmland with water nearby and faster still by a sprinkler. Each plant has a block entity {kind, grow: seconds}.

import { B, blockInfo } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { CHUNK_Y } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';

const LEAVES = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.PALM_LEAVES, B.CHARRED_LEAVES]);
const KIND = { [B.OAK_SAPLING]: 'oak', [B.BIRCH_SAPLING]: 'birch', [B.SPRUCE_SAPLING]: 'spruce', [B.PALM_SAPLING]: 'palm' };

export function tickSaplings(world, dt) {
  const ready = [];
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of chunk.blockEntities) {
      if (st.kind !== 'sapling' && st.kind !== 'crop') continue;
      // (progress survives a reload, not just the last stage: marked every
      // ten seconds of growth, so an autosave writes it)
      if (Math.floor(st.grow / 10) !== Math.floor((st.grow - dt) / 10)) chunk.modified = true;
      st.grow -= dt;
      if (st.grow > 0) continue;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16, lx = (rest - lz) / 16;
      ready.push([chunk.cx * 16 + lx, y, chunk.cz * 16 + lz, st]);
    }
  }
  // grow after iterating: building a tree rewrites block entities
  for (const [x, y, z, st] of ready) {
    if (st.kind === 'crop') growCrop(world, x, y, z, 1, Math.random);
    else growTree(world, x, y, z, st);
  }
}

// A saved chunk loaded again: its crops grow as they would have since it was
// saved (up to two days' worth), a stage at a time; saplings count down and
// grow on the next tick (a tree needs its neighbours loaded).
const CATCH_UP_MAX = 2 * 1200;
export function catchUpChunk(world, chunk, savedAt, now) {
  let secs = Math.min(CATCH_UP_MAX, now - savedAt);
  if (!(secs > 1) || !chunk.blockEntities.size) return;
  const crops = [];
  for (const [idx, st] of chunk.blockEntities) {
    if (st.kind === 'sapling') st.grow = Math.max(0, st.grow - secs);
    else if (st.kind === 'crop') {
      const y = idx % CHUNK_Y, rest = (idx - y) / CHUNK_Y, lz = rest % 16, lx = (rest - lz) / 16;
      crops.push([chunk.cx * 16 + lx, y, chunk.cz * 16 + lz]);
    }
  }
  for (const [x, y, z] of crops) {
    let left = secs;
    for (let n = 0; n < 4; n++) {
      const st = world.blockEntityAt(x, y, z);
      if (st?.kind !== 'crop') break;
      if (st.grow > left) { st.grow -= left; break; }
      left -= Math.max(0, st.grow);
      growCrop(world, x, y, z, 1, Math.random);
    }
  }
  chunk.modified = true;
}

// Crops: four stages each, planted from seeds or the vegetable itself.
// [first stage, ripe stage, what replanting it costs, (the fruit a grown stem sets beside it)]
export const CROP_FAMILIES = [
  [B.WHEAT_0, B.WHEAT_3, I.WHEAT_SEEDS],
  [B.CARROTS_0, B.CARROTS_3, I.CARROT],
  [B.POTATOES_0, B.POTATOES_3, I.POTATO],
  [B.BEETROOTS_0, B.BEETROOTS_3, I.BEETROOT_SEEDS],
  [B.PEPPERS_0, B.PEPPERS_3, I.SCORCH_PEPPER],
  [B.PUMPKIN_STEM_0, B.PUMPKIN_STEM_3, I.PUMPKIN_SEEDS, B.PUMPKIN],
];
export const cropFamily = (id) => CROP_FAMILIES.find(([a, b]) => id >= a && id <= b) ?? null;
// (a grown stem isn't ripe: its pumpkins are what's picked)
export const isRipe = (id) => CROP_FAMILIES.some(([, ripe, , fruit]) => id === ripe && !fruit);

// A grown stem sets a pumpkin on open ground beside it (one at a time).
const FRUIT_GROUND = new Set([B.DIRT, B.GRASS, B.FARMLAND, B.SNOWY_GRASS, B.ASH, B.ASHEN_GRASS]);
function setFruit(world, x, y, z, fruit, rng) {
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (sides.some(([dx, dz]) => world.getBlockW(x + dx, y, z + dz) === fruit)) return;
  const [dx, dz] = sides[(rng() * 4) | 0];
  if (world.getBlockW(x + dx, y, z + dz) !== B.AIR || !FRUIT_GROUND.has(world.getBlockW(x + dx, y - 1, z + dz))) return;
  world.setBlock(x + dx, y, z + dz, fruit);
}

// is there water within 4 blocks of the farmland under this crop?
export function hydrated(world, x, y, z) {
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (world.getBlockW(x + dx, y - 1, z + dz) === B.WATER) return true;
    }
  }
  return false;
}

// a sprinkler within 4 blocks (from a level below to two above)
export function nearSprinkler(world, x, y, z) {
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) if (world.getBlockW(x + dx, y + dy, z + dz) === B.SPRINKLER) return true;
    }
  }
  return false;
}

// bees at work: a hive with bees within 4 blocks
export function nearBees(world, x, y, z) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        if (world.getBlockW(x + dx, y + dy, z + dz) === B.BEEHIVE && world.blockEntityAt(x + dx, y + dy, z + dz)?.bees > 0) return true;
      }
    }
  }
  return false;
}

// seconds until the next growth stage: halved by water nearby, and a
// sprinkler (which counts as water) speeds it up further; bees nearby,
// a little more
export function cropTime(world, x, y, z, rng) {
  const base = (40 + rng() * 40) / (nearBees(world, x, y, z) ? 1.3 : 1);
  if (nearSprinkler(world, x, y, z)) return base / 3.5;
  return hydrated(world, x, y, z) ? base / 2 : base;
}

// advance a crop by `steps` stages (bone meal uses 2)
export function growCrop(world, x, y, z, steps, rng) {
  const id = world.getBlockW(x, y, z);
  const fam = cropFamily(id);
  if (!fam) { world.setBlockEntity(x, y, z, null); return; }
  // a grown stem: sets a pumpkin, and goes on growing them
  if (id === fam[1] && fam[3]) {
    setFruit(world, x, y, z, fam[3], rng);
    world.setBlockEntity(x, y, z, { kind: 'crop', grow: cropTime(world, x, y, z, rng) * 2 });
    return;
  }
  const next = Math.min(fam[1], id + steps);
  world.setBlock(x, y, z, next);   // clears the block entity
  if (next < fam[1] || fam[3]) world.setBlockEntity(x, y, z, { kind: 'crop', grow: cropTime(world, x, y, z, rng) });
}

// is there air above a sapling for at least its smallest tree? (bone meal
// isn't wasted on one under a roof)
export function saplingHasRoom(world, x, y, z) {
  const kind = KIND[world.getBlockW(x, y, z)];
  if (!kind) return false;
  const height = 4 + (kind === 'birch' ? 2 : kind === 'spruce' ? 4 : kind === 'palm' ? 3 : 0) + 1;
  for (let i = 1; i <= height; i++) {
    const b = blockInfo(world.getBlockW(x, y + i, z));
    if (!(y + i < CHUNK_Y && (b.id === B.AIR || b.replaceable || LEAVES.has(b.id)))) return false;
  }
  return true;
}

function growTree(world, x, y, z, st) {
  const kind = KIND[world.getBlockW(x, y, z)];
  if (!kind) { world.setBlockEntity(x, y, z, null); return; }
  const rng = mulberry32((x * 73856093) ^ (z * 19349663) ^ (Date.now() & 0xffff));
  const size = 4 + ((rng() * 3) | 0);
  const height = size + (kind === 'birch' ? 2 : kind === 'spruce' ? 4 : kind === 'palm' ? 3 : 0) + 1;
  // the whole canopy must be in loaded chunks (no half-tree at a border); a
  // palm's fronds reach further, from a trunk that may lean two blocks over
  const reach = kind === 'palm' ? 6 : 3;
  for (const [dx, dz] of [[-reach, -reach], [reach, -reach], [-reach, reach], [reach, reach]]) {
    if (!world.isLoaded(x + dx, z + dz)) { st.grow = 30; return; }
  }
  // need open air (or leaves) for the trunk; otherwise try again a little later
  // (a palm's leaning trunk could go up to two blocks any way: all of that too,
  // so it never grows through a wall or a chest)
  const open = (wx, wy, wz) => {
    const b = blockInfo(world.getBlockW(wx, wy, wz));
    return wy < CHUNK_Y && (b.id === B.AIR || b.replaceable || LEAVES.has(b.id));
  };
  for (let i = 1; i <= height; i++) {
    let ok = open(x, y + i, z);
    if (kind === 'palm' && i >= 3) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let d = 1; d <= 2; d++) ok &&= open(x + dx * d, y + i, z + dz * d);
    }
    if (!ok) { st.grow = 30; return; }
  }
  const put = (wx, wy, wz, id, onlyAir = true) => {
    const cur = blockInfo(world.getBlockW(wx, wy, wz));
    if (onlyAir && cur.id !== B.AIR && !cur.replaceable) return;
    world.setBlock(wx, wy, wz, id);
  };
  world.gen.buildTree(put, { kind, wx: x, wy: y, wz: z, size, rng });
}
