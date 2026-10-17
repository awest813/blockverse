// The Scorchlands: a burnt forest under a night that never ends. Rolling
// ash hills thick with charred trees and glowing stumps, open ash wastes
// with lava lakes and spires of charred stone. Pure and deterministic like
// worldgen.js (it runs in the generation workers), with its own version
// numbers: the overworld's generators never change for it.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, blockIndex } from '../core/constants.js';
import { Noise } from '../core/noise.js';
import { coordRng } from '../core/rng.js';
import { B } from '../blocks/blocks.js';
import { WorldGen, BIOME } from './worldgen.js';

export const SCORCH_LATEST = 1;
export const LAVA_LEVEL = 38;   // lava lakes fill up to here

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class ScorchGen {
  constructor(seed, version = SCORCH_LATEST) {
    // offset from the overworld's noise: the same seed, a different land
    this.seed = (seed ^ 0x5c0c4a11) >>> 0;
    this.version = version;
    const s = this.seed;
    this.hills = new Noise(s + 1);
    this.detail = new Noise(s + 2);
    this.wastes = new Noise(s + 3);
    this.basin = new Noise(s + 4);
    this.cave1 = new Noise(s + 5);
    this.cave2 = new Noise(s + 6);
    this.overworld = null;   // for a sapling someone plants here
  }

  // {h, t, m, wastes (0..1), lava} for a column
  columnAt(wx, wz) {
    const wastes = smoothstep(0.1, 0.35, this.wastes.fbm2(wx / 260, wz / 260, 2));
    let h = 50 + this.hills.fbm2(wx / 120, wz / 120, 3) * 12 * (1 - wastes * 0.5)
      + this.detail.fbm2(wx / 30, wz / 30, 2) * 3;
    // lava lakes sink into the wastes (and the odd forest hollow)
    const b = this.basin.fbm2(wx / 70, wz / 70, 2);
    const lake = smoothstep(0.18, 0.34, b) * (0.35 + wastes * 0.65);
    if (lake > 0) h += (LAVA_LEVEL - 3 - h) * lake;
    return { h: Math.max(6, Math.min(CHUNK_Y - 20, h)), t: 0.95, m: 0.05, wastes, lava: h < LAVA_LEVEL, mMask: 0, river: 0, pool: false };
  }

  heightAt(wx, wz) { return this.columnAt(wx, wz).h; }
  biomeOf(col) { return col.wastes > 0.5 ? BIOME.ASH_WASTES : BIOME.SCORCHED_FOREST; }
  biomeAt(wx, wz) { return this.biomeOf(this.columnAt(wx, wz)); }
  // hot and dry everywhere (no frost here, and the grass tint doesn't matter)
  climateAt() { return { t: 0.95, m: 0.05 }; }

  isCave(wx, wy, wz, surface) {
    if (wy < 6 || wy > surface - 3) return false;
    const n1 = this.cave1.fbm3(wx / 30, wy / 22, wz / 30, 2);
    const n2 = this.cave2.fbm3(wx / 30, wy / 22, wz / 30, 2);
    return Math.abs(n1) < 0.08 && Math.abs(n2) < 0.08;
  }
  groundOk(wx, h, wz) { return !this.isCave(wx, h, wz, h) && !this.isCave(wx, h - 1, wz, h); }

  // a sapling planted here grows as it would at home
  buildTree(put, f) {
    this.overworld ??= new WorldGen(this.seed);
    this.overworld.buildTree(put, f);
  }

  generateChunk(cx, cz) {
    const blocks = new Uint16Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    const heightMap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const biomeMap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const rockRng = coordRng(this.seed, cx, cz, 1);
    for (let x = 0; x < CHUNK_X; x++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        const wx = cx * CHUNK_X + x, wz = cz * CHUNK_Z + z;
        const col = this.columnAt(wx, wz);
        const h = Math.floor(col.h);
        heightMap[x * CHUNK_Z + z] = h;
        biomeMap[x * CHUNK_Z + z] = this.biomeOf(col);
        const top = Math.max(h, LAVA_LEVEL);
        for (let y = 0; y <= top; y++) {
          let id;
          if (y === 0 || (y < 3 && rockRng() < 0.5)) id = B.BEDROCK;
          else if (y > h) id = B.LAVA;                               // a lava lake
          else if (this.isCave(wx, y, wz, h)) id = y < 10 ? B.LAVA : B.AIR;   // deep tunnels run with lava
          else if (y === h) id = col.lava || h <= LAVA_LEVEL ? B.SCORCHED_STONE : col.wastes > 0.6 ? B.ASH : B.ASHEN_GRASS;
          else if (y > h - 4) id = col.lava ? B.SCORCHED_STONE : B.ASH;
          else id = B.SCORCHED_STONE;
          blocks[blockIndex(x, y, z)] = id;
        }
      }
    }
    // trees, stumps and spires reach a few blocks out: take them from this
    // chunk and its neighbours, each written where it falls in this one
    for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
      for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
        for (const f of this.features(ncx, ncz)) this.applyFeature(blocks, cx, cz, f);
      }
    }
    return { blocks, heightMap, biomeMap, entities: [] };
  }

  // the features rooted in one chunk (decided by that chunk alone)
  features(cx, cz) {
    const rng = coordRng(this.seed, cx, cz, 901);
    const out = [];
    const spot = () => {
      const wx = cx * CHUNK_X + ((rng() * 16) | 0), wz = cz * CHUNK_Z + ((rng() * 16) | 0);
      const col = this.columnAt(wx, wz);
      const h = Math.floor(col.h);
      if (col.lava || h <= LAVA_LEVEL || !this.groundOk(wx, h, wz)) return null;
      return { wx, wz, h, col };
    };
    const centre = this.columnAt(cx * CHUNK_X + 8, cz * CHUNK_Z + 8);
    const forest = 1 - centre.wastes;
    // dead trees: thick in the forest, a few out on the wastes
    const trees = Math.floor(forest * 7 + 0.6 + rng());
    for (let i = 0; i < trees; i++) {
      const s = spot();
      if (s) out.push({ type: 'tree', wx: s.wx, wy: s.h + 1, wz: s.wz, size: 4 + ((rng() * 4) | 0), seed: (rng() * 1e9) | 0 });
    }
    for (let i = 0, n = (rng() * (1 + forest * 2)) | 0; i < n; i++) {
      const s = spot();
      if (s) out.push({ type: 'stump', wx: s.wx, wy: s.h + 1, wz: s.wz, tall: rng() < 0.4 ? 2 : 1 });
    }
    // charred-stone spires and outcrops, mostly on the wastes
    if (rng() < 0.15 + centre.wastes * 0.4) {
      const s = spot();
      if (s) out.push({ type: 'spire', wx: s.wx, wy: s.h, wz: s.wz, size: 3 + ((rng() * 7) | 0), seed: (rng() * 1e9) | 0 });
    }
    return out;
  }

  applyFeature(blocks, cx, cz, f) {
    const put = (wx, wy, wz, id, onlyAir = true) => {
      const x = wx - cx * CHUNK_X, z = wz - cz * CHUNK_Z;
      if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || wy < 1 || wy >= CHUNK_Y) return;
      const i = blockIndex(x, wy, z);
      if (onlyAir && blocks[i] !== B.AIR) return;
      blocks[i] = id;
    };
    const rng = coordRng(this.seed, f.wx, f.wz, f.seed ?? 7);
    if (f.type === 'tree') {
      // a bare black trunk with a few crooked branches and the odd clump of
      // dead leaves; some have snapped off short
      const h = rng() < 0.2 ? 2 + ((rng() * 2) | 0) : f.size;
      for (let i = 0; i < h; i++) put(f.wx, f.wy + i, f.wz, B.CHARRED_LOG, false);
      if (h < 4) return;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let b = 0; b < 2 + ((rng() * 2) | 0); b++) {
        const [dx, dz] = dirs[(rng() * 4) | 0];
        const by = f.wy + h - 1 - ((rng() * 3) | 0);
        const len = 1 + ((rng() * 2) | 0);
        for (let k = 1; k <= len; k++) put(f.wx + dx * k, by + (k > 1 ? 1 : 0), f.wz + dz * k, B.CHARRED_LOG);
        // a few leaves clinging to the branch end
        if (rng() < 0.7) {
          const ex = f.wx + dx * len, ey = by + (len > 1 ? 1 : 0) + 1, ez = f.wz + dz * len;
          for (const [ox, oy, oz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) if (rng() < 0.65) put(ex + ox, ey + oy, ez + oz, B.CHARRED_LEAVES);
        }
      }
      if (rng() < 0.5) put(f.wx, f.wy + h, f.wz, B.CHARRED_LEAVES);
    } else if (f.type === 'stump') {
      for (let i = 0; i < f.tall; i++) put(f.wx, f.wy + i, f.wz, i === f.tall - 1 ? B.SMOULDERING_STUMP : B.CHARRED_LOG, false);
    } else if (f.type === 'spire') {
      // a jagged column of charred stone, wide at the foot
      for (let i = -1; i < f.size; i++) {
        const r = i < f.size * 0.35 ? 1 : 0;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (r && Math.abs(dx) + Math.abs(dz) > 1 + (i < 1 ? 1 : 0) && rng() < 0.5) continue;
            put(f.wx + dx, f.wy + i, f.wz + dz, B.CHARRED_STONE, i < 1);
          }
        }
      }
    }
  }
}
