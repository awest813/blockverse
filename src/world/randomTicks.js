// Slow natural growth around the player: sugar cane and cactus grow up to
// three blocks tall, grass creeps back over bare dirt beside it, and bare
// farmland left dry turns back to dirt. Each tick samples a few random columns per nearby chunk
// (only columns are sampled, so it costs the same however much is planted).

import { B, BLOCKS } from '../blocks/blocks.js';
import { hydrated } from './saplings.js';
import { CHUNK_X, CHUNK_Z, CHUNK_Y } from '../core/constants.js';

const RADIUS = 3;          // chunks around the player
const COLUMNS = 2;         // columns sampled per chunk per tick
const INTERVAL = 0.5;      // seconds between ticks
const GROW_CHANCE = 0.5;   // per sampled stack
const MAX_HEIGHT = 3;
const GROWS = new Set([B.SUGAR_CANE, B.CACTUS]);
const SPREAD_CHANCE = 0.5;   // bare dirt next to grass, per sample

// Dirt open to the sky (or under a plant or torch) next to grass, a block
// up or down included, turns to grass - snowy grass where that's what's
// beside it - so a dug-out patch greens over and seeds keep coming.
function spreadGrass(world, wx, y, wz) {
  if (world.getBlockW(wx, y, wz) !== B.DIRT) return false;
  const above = BLOCKS[world.getBlockW(wx, y + 1, wz)];
  if (!above || above.opacity > 0 || above.fluid) return false;
  // and needs light: not under a roof in the dark
  if (Math.max(world.getSkyW(wx, y + 1, wz), world.getBlockLightW(wx, y + 1, wz)) < 9) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let dy = -1; dy <= 1; dy++) {
      const n = world.getBlockW(wx + dx, y + dy, wz + dz);
      if (n === B.GRASS || n === B.SNOWY_GRASS) {
        if (Math.random() < SPREAD_CHANCE) world.setBlock(wx, y, wz, n);
        return true;
      }
    }
  }
  return false;
}

function sprinklerNear(world, x, y, z) {
  for (let dy = -1; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (world.getBlockW(x + dx, y + dy, z + dz) === B.SPRINKLER) return true;
  return false;
}

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
        // the top solid block of the column (it may sit below the generated
        // ground where someone has dug)
        let top = Math.min(CHUNK_Y - 2, ground + 16);   // (or built up a little)
        while (top > 1 && BLOCKS[world.getBlockW(wx, top, wz)]?.solid !== true) top--;
        const was = chunk.modified;   // (natural growth alone isn't worth a save)
        spreadGrass(world, wx, top, wz);
        chunk.modified = was;
        // bare farmland with no water (or sprinkler) near dries back to dirt
        if (!world.raining && world.getBlockW(wx, top, wz) === B.FARMLAND && world.getBlockW(wx, top + 1, wz) === B.AIR
          && !hydrated(world, wx, top + 1, wz) && !sprinklerNear(world, wx, top, wz) && Math.random() < 0.25) world.setBlock(wx, top, wz, B.DIRT);
        // find a cane/cactus stack on the ground as it is now (planted on a
        // build or down a dug-out pit, not just at the generated height)
        for (let y = Math.max(1, top - 3); y < Math.min(CHUNK_Y - 1, top + 2); y++) {
          const id = world.getBlockW(wx, y, wz);
          if (!GROWS.has(id)) continue;
          let top = y;
          while (top + 1 < CHUNK_Y && world.getBlockW(wx, top + 1, wz) === id) top++;
          if (top - y + 1 < MAX_HEIGHT && world.getBlockW(wx, top + 1, wz) === B.AIR && Math.random() < GROW_CHANCE) {
            // natural growth alone doesn't make an untouched chunk worth saving
            const was = chunk.modified;
            world.setBlock(wx, top + 1, wz, id);
            chunk.modified = was;
          }
          break;
        }
      }
    }
  }
}
