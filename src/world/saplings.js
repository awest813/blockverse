// Saplings grow into trees after a few minutes of being in a loaded chunk.
// Each planted sapling has a block entity {kind: 'sapling', grow: seconds}.

import { B, blockInfo } from '../blocks/blocks.js';
import { CHUNK_Y } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';

const LEAVES = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES]);
const KIND = { [B.OAK_SAPLING]: 'oak', [B.BIRCH_SAPLING]: 'birch', [B.SPRUCE_SAPLING]: 'spruce' };

export function tickSaplings(world, dt) {
  const ready = [];
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of chunk.blockEntities) {
      if (st.kind !== 'sapling') continue;
      st.grow -= dt;
      if (st.grow > 0) continue;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16, lx = (rest - lz) / 16;
      ready.push([chunk.cx * 16 + lx, y, chunk.cz * 16 + lz, st]);
    }
  }
  // grow after iterating: building a tree rewrites block entities
  for (const [x, y, z, st] of ready) growTree(world, x, y, z, st);
}

function growTree(world, x, y, z, st) {
  const kind = KIND[world.getBlockW(x, y, z)];
  if (!kind) { world.setBlockEntity(x, y, z, null); return; }
  const rng = mulberry32((x * 73856093) ^ (z * 19349663) ^ (Date.now() & 0xffff));
  const size = 4 + ((rng() * 3) | 0);
  const height = size + (kind === 'birch' ? 2 : kind === 'spruce' ? 4 : 0) + 1;
  // need open air (or leaves) for the trunk; otherwise try again a little later
  for (let i = 1; i <= height; i++) {
    const b = blockInfo(world.getBlockW(x, y + i, z));
    if (y + i >= CHUNK_Y || (b.id !== B.AIR && !b.replaceable && !LEAVES.has(b.id))) {
      st.grow = 30;
      return;
    }
  }
  const put = (wx, wy, wz, id, onlyAir = true) => {
    const cur = blockInfo(world.getBlockW(wx, wy, wz));
    if (onlyAir && cur.id !== B.AIR && !cur.replaceable) return;
    world.setBlock(wx, wy, wz, id);
  };
  world.gen.buildTree(put, { kind, wx: x, wy: y, wz: z, size, rng });
}
