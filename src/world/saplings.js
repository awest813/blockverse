// Plant growth in loaded chunks. Saplings grow into trees after a few
// minutes; crops (wheat, carrots, potatoes) advance one stage at a time,
// twice as fast on farmland with water nearby and faster still by a sprinkler. Each plant has a block entity {kind, grow: seconds}.

import { B, blockInfo } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { CHUNK_Y } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';

const LEAVES = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.PALM_LEAVES]);
const KIND = { [B.OAK_SAPLING]: 'oak', [B.BIRCH_SAPLING]: 'birch', [B.SPRUCE_SAPLING]: 'spruce', [B.PALM_SAPLING]: 'palm' };

export function tickSaplings(world, dt) {
  const ready = [];
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of chunk.blockEntities) {
      if (st.kind !== 'sapling' && st.kind !== 'crop') continue;
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

// Crops: four stages each, planted from seeds or the vegetable itself.
// [first stage, ripe stage, what replanting it costs]
export const CROP_FAMILIES = [
  [B.WHEAT_0, B.WHEAT_3, I.WHEAT_SEEDS],
  [B.CARROTS_0, B.CARROTS_3, I.CARROT],
  [B.POTATOES_0, B.POTATOES_3, I.POTATO],
];
export const cropFamily = (id) => CROP_FAMILIES.find(([a, b]) => id >= a && id <= b) ?? null;
export const isRipe = (id) => CROP_FAMILIES.some(([, ripe]) => id === ripe);

// is there water within 4 blocks of the farmland under this crop?
function hydrated(world, x, y, z) {
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

// seconds until the next growth stage: halved by water nearby, and a
// sprinkler (which counts as water) speeds it up further
export function cropTime(world, x, y, z, rng) {
  const base = 40 + rng() * 40;
  if (nearSprinkler(world, x, y, z)) return base / 3.5;
  return hydrated(world, x, y, z) ? base / 2 : base;
}

// advance a crop by `steps` stages (bone meal uses 2)
export function growCrop(world, x, y, z, steps, rng) {
  const id = world.getBlockW(x, y, z);
  const fam = cropFamily(id);
  if (!fam) { world.setBlockEntity(x, y, z, null); return; }
  const next = Math.min(fam[1], id + steps);
  world.setBlock(x, y, z, next);   // clears the block entity
  if (next < fam[1]) world.setBlockEntity(x, y, z, { kind: 'crop', grow: cropTime(world, x, y, z, rng) });
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
