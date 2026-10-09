// Small fires (from flint and steel) burn for a few seconds, then go out.
// Block entity: {kind: 'fire', t: seconds left}.

import { B } from '../blocks/blocks.js';
import { CHUNK_Y } from '../core/constants.js';

export function tickFires(world, dt) {
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    for (const [idx, st] of chunk.blockEntities) {
      if (st.kind !== 'fire') continue;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16, lx = (rest - lz) / 16;
      const x = chunk.cx * 16 + lx, z = chunk.cz * 16 + lz;
      st.t -= dt;
      if (world.getBlockW(x, y, z) !== B.FIRE) chunk.blockEntities.delete(idx);
      else if (st.t <= 0) world.setBlock(x, y, z, B.AIR);   // also clears the entity
    }
  }
}
