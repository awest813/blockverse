// Monster spawners in dungeons and temples: while a player is near, each cage
// keeps conjuring its monster, ignoring light, until it's broken.
// Block entity: {kind: 'spawner', mob: 'zombie' | 'skeleton' | 'spider', t}.

import { B, isSolid } from '../blocks/blocks.js';
import { CHUNK_Y } from '../core/constants.js';
import { Zombie, Skeleton, Spider } from './mobs.js';

const MOBS = { zombie: Zombie, skeleton: Skeleton, spider: Spider };
const ACTIVE_RANGE = 16;   // player must be this close
const NEARBY_CAP = 4;      // stop while this many of its mobs linger nearby

export function tickSpawners(game, dt) {
  const { world, player, mobSpawner } = game;
  if (mobSpawner.difficulty === 0 || player.dead) return;
  for (const chunk of world.chunks.values()) {
    if (!chunk.blockEntities.size) continue;
    if (Math.abs(chunk.cx * 16 + 8 - player.x) > ACTIVE_RANGE + 8 || Math.abs(chunk.cz * 16 + 8 - player.z) > ACTIVE_RANGE + 8) continue;
    for (const [idx, st] of chunk.blockEntities) {
      if (st.kind !== 'spawner') continue;
      const y = idx % CHUNK_Y;
      const rest = (idx - y) / CHUNK_Y;
      const lz = rest % 16, lx = (rest - lz) / 16;
      const x = chunk.cx * 16 + lx, z = chunk.cz * 16 + lz;
      if (Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y, z + 0.5 - player.z) > ACTIVE_RANGE) continue;
      if (world.getBlockW(x, y, z) !== B.SPAWNER) continue;
      st.t = (st.t ?? 2) - dt;
      if (st.t > 0) continue;
      st.t = 8 + Math.random() * 14;
      spawnAround(game, x, y, z, MOBS[st.mob] ?? Zombie);
    }
  }
}

function spawnAround(game, x, y, z, Cls) {
  const mobs = game.entities.mobs;
  const near = mobs.filter((m) => m instanceof Cls && !m.dead && m.dying === undefined && Math.hypot(m.x - x, m.y - y, m.z - z) < 9).length;
  if (near >= NEARBY_CAP) return;
  const want = Math.min(NEARBY_CAP - near, 1 + (Math.random() < 0.5 ? 1 : 0));
  let made = 0;
  for (let attempt = 0; attempt < 10 && made < want; attempt++) {
    const sx = x + Math.round((Math.random() - 0.5) * 6);
    const sz = z + Math.round((Math.random() - 0.5) * 6);
    const sy = y + ((Math.random() * 3) | 0) - 1;
    const w = game.world;
    if (w.getBlockW(sx, sy, sz) !== B.AIR || w.getBlockW(sx, sy + 1, sz) !== B.AIR) continue;
    if (!isSolid(w.getBlockW(sx, sy - 1, sz))) continue;
    const mob = game.mobSpawner.spawnMob(Cls, sx + 0.5, sy, sz + 0.5);
    mob.fromSpawner = true;
    made++;
  }
  if (made) {
    game.sparks?.(x + 0.5, y + 0.5, z + 0.5, 0x5a2a20, 10);
    game.sfx?.play('spawner', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
  }
}
