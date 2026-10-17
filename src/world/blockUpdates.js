// Blocks reacting to their neighbours changing (World.setBlock queues every
// change in world.blockChanges; Game drains it each frame):
//  - sand and gravel with nothing under them fall
//  - leaves cut off from any trunk (no log within 4 steps through leaves)
//    wither away a few seconds later, dropping what leaves drop. Leaves a
//    player placed (meta 1) stay.

import { B, blockInfo, isSolid, isWater } from '../blocks/blocks.js';
import { penEdited } from './ranch.js';
import { FallingBlock } from '../entities/fallingBlock.js';

export const FALLS = new Set([B.SAND, B.GRAVEL]);
const LOGS = new Set([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.PALM_LOG, B.CHARRED_LOG]);
export const LEAVES = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.PALM_LEAVES, B.CHARRED_LEAVES]);
const REACH = 5;   // a leaf this many steps (through leaves) from a log stays (generated trees need 4)
// (diagonals count: palm fronds and charred branches join at their edges)
const N26 = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) N26.push([dx, dy, dz]);

// nothing to hold a block up (air, water, plants, a torch...)
const unsupported = (id) => !isSolid(id) && (blockInfo(id).replaceable || id === B.AIR || blockInfo(id).fluid);
// a cell near (x, y, z) as one number (offsets stay within +-64)
const rel = (dx, dy, dz) => ((dx + 64) * 128 + (dy + 64)) * 128 + (dz + 64);

// Walk out through leaves from (x, y, z), up to REACH steps: calls leaf(x,
// y, z) for each leaf reached; stops early (returning true) at a log if
// stopAtLog.
function walkLeaves(world, x, y, z, stopAtLog, leaf) {
  const seen = new Set([rel(0, 0, 0)]);
  let frontier = [[x, y, z]];
  for (let d = 0; d < REACH && frontier.length; d++) {
    const next = [];
    for (const [cx, cy, cz] of frontier) {
      for (const [dx, dy, dz] of N26) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz, k = rel(nx - x, ny - y, nz - z);
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlockW(nx, ny, nz);
        if (stopAtLog && LOGS.has(id)) return true;
        if (LEAVES.has(id)) { next.push([nx, ny, nz]); leaf?.(nx, ny, nz); }
      }
    }
    frontier = next;
  }
  return false;
}

// does this leaf still reach a trunk?
const attached = (world, x, y, z) => walkLeaves(world, x, y, z, true);

export class BlockUpdates {
  constructor(game) {
    this.game = game;
    this.decay = [];   // [x, y, z, at]
    this.queued = new Set();   // (each leaf once)
    this.t = 0;
  }

  update(dt) {
    const g = this.game, w = g.world, q = w.blockChanges;
    this.t += dt;
    if (q.length) {
      const cells = q.splice(0, Math.min(q.length, 5 * 600));
      for (let i = 0; i < cells.length; i += 5) {
        const x = cells[i], y = cells[i + 1], z = cells[i + 2], old = cells[i + 3], now = cells[i + 4];
        // a fence, gate or trough changed: the pens about it are looked at again
        if (isSolid(old) || isSolid(now) || isWater(old) !== isWater(now)) penEdited(w, x, z);
        // something gone from under sand or gravel (or sand set down on nothing)
        if (FALLS.has(now)) this.tryFall(x, y, z);
        if (unsupported(now)) this.tryFall(x, y + 1, z);
        // a trunk cut: the leaves round it may be left hanging
        // (only the leaves joined to it through leaves: not a neighbour's)
        if (LOGS.has(old) && !LOGS.has(now)) {
          walkLeaves(w, x, y, z, false, (lx, ly, lz) => {
            const k = `${lx},${ly},${lz}`;
            if (this.queued.has(k) || w.getMetaW(lx, ly, lz) !== 0) return;
            this.queued.add(k);
            this.decay.push([lx, ly, lz, this.t + 1 + Math.random() * 7]);
          });
        }
      }
    }
    // leaves due to go: a few at a time, each after its own pause
    if (this.decay.length) {
      let n = 0;
      this.decay = this.decay.filter(([x, y, z, at]) => {
        if (at > this.t || n > 8) return true;
        n++;
        this.queued.delete(`${x},${y},${z}`);
        const id = w.getBlockW(x, y, z);
        if (!LEAVES.has(id) || w.getMetaW(x, y, z) !== 0 || attached(w, x, y, z)) return false;
        w.setBlock(x, y, z, B.AIR);
        g.interaction.spawnBlockDrops(x, y, z, blockInfo(id), true);
        return false;
      });
    }
  }

  tryFall(x, y, z) {
    const w = this.game.world, id = w.getBlockW(x, y, z);
    if (!FALLS.has(id) || !unsupported(w.getBlockW(x, y - 1, z))) return;
    w.setBlock(x, y, z, B.AIR);
    const fb = new FallingBlock(this.game.scene, w, x + 0.5, y, z + 0.5, id);
    this.game.entities.addMob(fb);
  }
}
