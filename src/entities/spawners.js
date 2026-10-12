// Monster spawners in dungeons and temples: while a player is near, each cage
// keeps conjuring its monster, ignoring light, until it's broken.
// A dungeon's cage (buried, not a surface temple) also has a guardian: the
// first time a player walks into the room it wakes a mini boss (bosses.js).
// Block entity: {kind: 'spawner', mob: 'zombie' | 'skeleton' | 'spider', t,
//                boss?: 'awake' | 'defeated'}.

import { B, isSolid } from '../blocks/blocks.js';
import { CHUNK_Y, GAMEMODE_CREATIVE } from '../core/constants.js';
import { Zombie, Skeleton, Spider } from './mobs.js';
import { DUNGEON_BOSSES } from './bosses.js';

const MOBS = { zombie: Zombie, skeleton: Skeleton, spider: Spider };
const ACTIVE_RANGE = 16;   // player must be this close
const NEARBY_CAP = 4;      // stop while this many of its mobs linger nearby
const BOSS_RANGE = 7;      // how far into the room before the guardian wakes
const BURIED = 8;          // a cage this far under the original ground is a dungeon's

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
      if (st.boss !== 'defeated' && chunk.heightMap?.[lx * 16 + lz] - y >= BURIED) wakeGuardian(game, st, x, y, z);
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

// The dungeon's guardian: summoned when a player comes into the room, unless
// it's already up (or beaten). If you left and it despawned, it's back.
function wakeGuardian(game, st, x, y, z) {
  const { player, world } = game;
  if (player.mode === GAMEMODE_CREATIVE || Math.hypot(x + 0.5 - player.x, z + 0.5 - player.z) > BOSS_RANGE || Math.abs(player.y - y) > 4) return;
  const Cls = DUNGEON_BOSSES[st.mob];
  if (!Cls) return;
  const up = game.entities.mobs.some((m) => m.boss && !m.dead && m.dying === undefined && m.home?.cage === `${x},${y},${z}`);
  if (up) return;
  // a free spot beside the cage, tall enough for it
  for (let r = 1; r <= 3; r++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sx = Math.round(x + Math.cos(a) * r), sz = Math.round(z + Math.sin(a) * r);
      for (const sy of [y, y - 1, y + 1]) {
        if (!isSolid(world.getBlockW(sx, sy - 1, sz))) continue;
        if ([0, 1, 2].some((h) => world.getBlockW(sx, sy + h, sz) !== B.AIR)) continue;
        const boss = new Cls(game.scene, world, sx + 0.5, sy, sz + 0.5).setDifficulty(game.mobSpawner.difficulty);
        boss.home = { x: x + 0.5, y, z: z + 0.5, cage: `${x},${y},${z}` };
        boss.fromSpawner = true;
        game.entities.addMob(boss);
        const first = st.boss !== 'awake';
        st.boss = 'awake';
        world.markModified(x, z);
        game.sparks?.(sx + 0.5, sy + 1, sz + 0.5, 0x5a2a20, 24);
        game.sfx?.play('roar', { pos: boss });
        game.hud?.showLabel(first ? `A ${boss.boss.name} guards this dungeon!` : `The ${boss.boss.name} is waiting.`, true);
        return;
      }
    }
  }
}

