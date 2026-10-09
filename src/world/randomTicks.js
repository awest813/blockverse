// Slow natural growth around the player: sugar cane and cactus grow up to
// three blocks tall. Each tick samples a few random columns per nearby chunk
// (only columns are sampled, so it costs the same however much is planted).

import { B } from '../blocks/blocks.js';
import { CHUNK_X, CHUNK_Z, CHUNK_Y } from '../core/constants.js';

const RADIUS = 3;          // chunks around the player
const COLUMNS = 2;         // columns sampled per chunk per tick
const INTERVAL = 0.5;      // seconds between ticks
const GROW_CHANCE = 0.5;   // per sampled stack
const MAX_HEIGHT = 3;
const GROWS = new Set([B.SUGAR_CANE, B.CACTUS]);

let timer = 0;

export function tickRandomGrowth(world, player, dt) {
  timer -= dt;
  if (timer > 0) return;
  timer = INTERVAL;
  const pcx = Math.floor(player.x / CHUNK_X), pcz = Math.floor(player.z / CHUNK_Z);
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      const chunk = world.getChunk(pcx + dx, pcz + dz);
      if (!chunk?.hasBlocks || !chunk.heightMap) continue;
      for (let i = 0; i < COLUMNS; i++) {
        const lx = (Math.random() * CHUNK_X) | 0, lz = (Math.random() * CHUNK_Z) | 0;
        const ground = chunk.heightMap[lx * CHUNK_Z + lz];
        const wx = chunk.cx * CHUNK_X + lx, wz = chunk.cz * CHUNK_Z + lz;
        // find a cane/cactus stack just above the terrain
        for (let y = ground + 1; y < Math.min(CHUNK_Y - 1, ground + 4); y++) {
          const id = world.getBlockW(wx, y, wz);
          if (!GROWS.has(id)) continue;
          let top = y;
          while (top + 1 < CHUNK_Y && world.getBlockW(wx, top + 1, wz) === id) top++;
          if (top - y + 1 < MAX_HEIGHT && world.getBlockW(wx, top + 1, wz) === B.AIR && Math.random() < GROW_CHANCE) {
            world.setBlock(wx, top + 1, wz, id);
          }
          break;
        }
      }
    }
  }
}
