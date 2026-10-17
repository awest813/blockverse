// The Scorchlands: a burnt forest under a night that never ends. Rolling
// ash hills thick with charred trees and glowing stumps, open ash wastes
// with lava lakes and spires of charred stone, here and there the ruin of
// a castle, held by skeleton knights, and somewhere not far from the middle
// the Scorch Dragon's roost. Pure and deterministic like
// worldgen.js (it runs in the generation workers), with its own version
// numbers: the overworld's generators never change for it.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, blockIndex } from '../core/constants.js';
import { Noise } from '../core/noise.js';
import { coordRng } from '../core/rng.js';
import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { makeStack } from '../items/items.js';
import { WorldGen, BIOME } from './worldgen.js';

export const SCORCH_LATEST = 1;
export const LAVA_LEVEL = 38;   // lava lakes fill up to here

// castles: at most one per CELL×CELL chunks, its middle kept well inside
// the cell (so it never reaches the next), and nothing grows inside it
const CELL = 6;
const CASTLE_R = 11;     // half its width
const CLEAR_R = 20;      // trees keep this far from its middle (and its causeway)
const ROOST_R = 21;      // the roost's mesa reaches this far out
const STAIR_END = 23;    // and its stair (a step down a block from the rim at 14)

// [id, min, max, chance]
const CASTLE_LOOT = [
  [I.GOLD_INGOT, 2, 6, 0.6], [I.IRON_INGOT, 2, 6, 0.6], [I.DIAMOND, 1, 3, 0.35], [I.GOLDEN_APPLE, 1, 2, 0.3],
  [I.ARROW, 6, 16, 0.4], [I.BONE, 2, 6, 0.5], [I.CHARCOAL, 2, 6, 0.4], [B.CHARRED_STONE, 2, 6, 0.4],
  [I.BREAD, 1, 3, 0.3], [I.BOOK, 1, 2, 0.25],
  [I.IRON_SWORD, 1, 1, 0.25], [I.IRON_CHESTPLATE, 1, 1, 0.15], [I.IRON_HELMET, 1, 1, 0.15],
  [I.DIAMOND_SWORD, 1, 1, 0.08], [I.DIAMOND_CHESTPLATE, 1, 1, 0.05], [I.ANCIENT_SWORD, 1, 1, 0.1],
];

function castleLoot(rng) {
  const slots = new Array(27).fill(null);
  for (const [id, lo, hi, chance] of CASTLE_LOOT) {
    if (rng() > chance) continue;
    let i = (rng() * 27) | 0;
    while (slots[i]) i = (i + 1) % 27;
    slots[i] = makeStack(id, lo + ((rng() * (hi - lo + 1)) | 0));
  }
  if (slots.every((s) => !s)) slots[13] = makeStack(I.GOLD_INGOT, 2);
  return slots;
}

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
    // sampled off the noise lattice (where it's pinned to zero)
    const orng = coordRng(s, 3, 7, 77);
    this.o = [0.25 + orng() * 0.5, 0.25 + orng() * 0.5];
    this.overworld = null;   // for a sapling someone plants here
    this.castles = new Map();
  }

  // The castle of the cell holding chunk (cx, cz), or null:
  // {ox, oz, y, gate (0 -z, 1 +x, 2 +z, 3 -x), cx, cz}
  castleIn(cx, cz) {
    const gx = Math.floor(cx / CELL), gz = Math.floor(cz / CELL);
    const key = `${gx},${gz}`;
    if (this.castles.has(key)) return this.castles.get(key);
    if (this.castles.size > 512) this.castles.clear();
    let plan = null;
    const rng = coordRng(this.seed, gx, gz, 1717);
    if (rng() < 0.6) {
      const ccx = gx * CELL + 1 + ((rng() * (CELL - 2)) | 0), ccz = gz * CELL + 1 + ((rng() * (CELL - 2)) | 0);
      const ox = ccx * CHUNK_X + 8, oz = ccz * CHUNK_Z + 8;
      // somewhere fairly level and dry
      const hs = [];
      let wet = 0;
      for (let dx = -CASTLE_R; dx <= CASTLE_R; dx += 3) {
        for (let dz = -CASTLE_R; dz <= CASTLE_R; dz += 3) {
          const col = this.columnAt(ox + dx, oz + dz);
          if (col.lava || col.h <= LAVA_LEVEL + 1) wet++;
          hs.push(Math.floor(col.h));
        }
      }
      hs.sort((a, b) => a - b);
      const y = hs[hs.length >> 1] + 1;
      const r = this.roost();
      const clearOfRoost = Math.max(Math.abs(ox - r.x), Math.abs(oz - r.z)) > 48;
      if (clearOfRoost && wet <= hs.length * 0.15 && hs[hs.length - 1] - hs[0] <= 12 && y + 16 < CHUNK_Y) {
        plan = { ox, oz, y, gate: (rng() * 4) | 0, cx: ccx, cz: ccz };
      }
    }
    this.castles.set(key, plan);
    return plan;
  }

  // inside a castle's grounds or on the roost (where nothing else is built)
  nearStructure(wx, wz) {
    const r = this.roost();
    if (Math.max(Math.abs(wx - r.x), Math.abs(wz - r.z)) <= STAIR_END + 3) return true;
    const c = this.castleIn(Math.floor(wx / CHUNK_X), Math.floor(wz / CHUNK_Z));
    return !!c && Math.max(Math.abs(wx - c.ox), Math.abs(wz - c.oz)) <= CLEAR_R;
  }

  // The Scorch Dragon's roost: a mesa crowned with spires, 100-140 blocks
  // from the middle, standing a few blocks over the land round it.
  // {x, z, y (standing on top), cx, cz}
  roost() {
    if (this._roost) return this._roost;
    const rng = coordRng(this.seed, 0, 0, 2024);
    const a = rng() * Math.PI * 2, d = 100 + rng() * 40;
    const cx = Math.floor((Math.cos(a) * d) / CHUNK_X), cz = Math.floor((Math.sin(a) * d) / CHUNK_Z);
    const x = cx * CHUNK_X + 8, z = cz * CHUNK_Z + 8;
    const hs = [];
    for (let dx = -ROOST_R; dx <= ROOST_R; dx += 4) for (let dz = -ROOST_R; dz <= ROOST_R; dz += 4) hs.push(Math.floor(this.columnAt(x + dx, z + dz).h));
    hs.sort((p, q) => p - q);
    const median = hs[hs.length >> 1];
    // the stair goes down the side where the land at its foot is nearest
    // the land round about, and the top is set so the stair meets it there
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let side = 0, foot = median, best = Infinity;
    DIRS.forEach(([sx, sz], i) => {
      const h = Math.floor(this.columnAt(x + sx * (STAIR_END + 1), z + sz * (STAIR_END + 1)).h);
      const cost = Math.abs(h - median) + (h <= LAVA_LEVEL ? 20 : 0);
      if (cost < best) { best = cost; side = i; foot = h; }
    });
    const rise = STAIR_END - 13;
    const top = Math.min(CHUNK_Y - 30, Math.max(LAVA_LEVEL + 8, median + 3, Math.min(median + 10, foot + rise)));
    this._roost = { x, z, y: top + 1, cx, cz, side };
    return this._roost;
  }

  // {h, t, m, wastes (0..1), lava} for a column
  columnAt(wx, wz) {
    const [ox, oz] = this.o;
    const wastes = smoothstep(0.1, 0.35, this.wastes.fbm2(wx / 260 + ox, wz / 260 + oz, 2));
    let h = 51 + this.hills.fbm2(wx / 120 + ox, wz / 120 + oz, 3) * 22 * (1 - wastes * 0.5)
      + this.detail.fbm2(wx / 30 + ox, wz / 30 + oz, 2) * 3.5;
    // lava lakes sink into the wastes (and forest hollows)
    const b = this.basin.fbm2(wx / 70 + ox, wz / 70 + oz, 2);
    const lake = smoothstep(0.0, 0.2, b) * (0.7 + wastes * 0.3);
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
    const [ox, oz] = this.o;
    return Math.abs(this.cave1.fbm3(wx / 30 + ox, wy / 22, wz / 30 + oz, 2)) < 0.08
      && Math.abs(this.cave2.fbm3(wx / 30 + oz, wy / 22, wz / 30 + ox, 2)) < 0.08;
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
    // trees, stumps, spires and castles reach out of the chunk they're
    // rooted in: take them from this chunk and its neighbours, each written
    // where it falls in this one
    const entities = [];
    for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
      for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
        for (const f of this.features(ncx, ncz)) this.applyFeature(blocks, cx, cz, f, entities);
      }
    }
    return { blocks, heightMap, biomeMap, entities };
  }

  // the features rooted in one chunk (decided by that chunk alone)
  features(cx, cz) {
    const rng = coordRng(this.seed, cx, cz, 901);
    const out = [];
    const spot = () => {
      const wx = cx * CHUNK_X + ((rng() * 16) | 0), wz = cz * CHUNK_Z + ((rng() * 16) | 0);
      const col = this.columnAt(wx, wz);
      const h = Math.floor(col.h);
      if (col.lava || h <= LAVA_LEVEL || !this.groundOk(wx, h, wz) || this.nearStructure(wx, wz)) return null;
      return { wx, wz, h, col };
    };
    const castle = this.castleIn(cx, cz);
    if (castle && castle.cx === cx && castle.cz === cz) out.push({ type: 'castle', ...castle, wx: castle.ox, wz: castle.oz });
    const roost = this.roost();
    if (roost.cx === cx && roost.cz === cz) out.push({ type: 'roost', ...roost, wx: roost.x, wz: roost.z });
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

  // A ruined castle: a curtain wall with a gate and four corner towers,
  // broken down in places, round a courtyard of rubble and a keep. In the
  // keep: a cage of skeleton knights, its Knight Captain, and the hoard.
  // (Built a chunk at a time: every chunk replays the same rolls, and put
  // writes only what falls in its own.)
  buildCastle(put, f, rng, entities, get) {
    const { ox, oz, y } = f;
    const W = 10;   // the curtain wall stands this far out
    // gate-relative (a across, b out toward the gate) to world offsets
    const turn = [(a, b) => [a, -b], (a, b) => [b, a], (a, b) => [-a, b], (a, b) => [-b, -a]][f.gate];
    const at = (a, b) => { const [dx, dz] = turn(a, b); return [ox + dx, oz + dz]; };
    const brick = () => (rng() < 0.12 ? B.CHARRED_STONE : B.SCORCHED_BRICKS);
    const set = (dx, yy, dz, id) => put(ox + dx, yy, oz + dz, id, false);
    // the ground: cleared above, filled in below (over lava or a hollow)
    for (let dx = -CASTLE_R; dx <= CASTLE_R; dx++) {
      for (let dz = -CASTLE_R; dz <= CASTLE_R; dz++) {
        for (let yy = y; yy < y + 16; yy++) set(dx, yy, dz, B.AIR);
        // (all the way down to the land: no floor overhanging a drop)
        for (let yy = y - 2; yy > 1; yy--) {
          const cur = get(ox + dx, yy, oz + dz);
          if (cur !== B.AIR && cur !== B.LAVA) break;
          set(dx, yy, dz, B.SCORCHED_STONE);
        }
        set(dx, y - 1, dz, rng() < 0.3 ? B.ASH : B.SCORCHED_STONE);
      }
    }
    // the land round about eased toward the castle's level over a few blocks
    // (not a castle sunk in a pit behind walls of earth, nor perched on a cliff)
    for (let dx = -CASTLE_R - 5; dx <= CASTLE_R + 5; dx++) {
      for (let dz = -CASTLE_R - 5; dz <= CASTLE_R + 5; dz++) {
        const r = Math.max(Math.abs(dx), Math.abs(dz)) - CASTLE_R;
        if (r <= 0) continue;
        const wx = ox + dx, wz = oz + dz;
        if (get(wx, y, wz) === -1) continue;   // (not in this chunk)
        const hi = y - 1 + Math.round(r * 1.2), lo = y - 1 - Math.round(r * 1.2);
        for (let yy = hi + 1; yy < hi + 14; yy++) { const cur = get(wx, yy, wz); if (cur === B.SCORCHED_STONE || cur === B.ASH || cur === B.ASHEN_GRASS) set(dx, yy, dz, B.AIR); }
        for (let yy = lo; yy > lo - 10 && yy > 1; yy--) { const cur = get(wx, yy, wz); if (cur !== B.AIR && cur !== B.LAVA) break; set(dx, yy, dz, B.SCORCHED_STONE); }
      }
    }
    // the curtain wall: six high with merlons, broken down in two or three places
    const breaches = [];
    for (let i = 0, n = 2 + ((rng() * 2) | 0); i < n; i++) breaches.push({ side: (rng() * 4) | 0, at: -6 + ((rng() * 12) | 0), w: 2 + ((rng() * 3) | 0), h: (rng() * 2) | 0 });
    for (let side = 0; side < 4; side++) {
      for (let t = -W; t <= W; t++) {
        const [dx, dz] = [[t, -W], [W, t], [t, W], [-W, t]][side];
        let h = 6 - (rng() < 0.25 ? 1 + ((rng() * 2) | 0) : 0);
        for (const br of breaches) if (br.side === side && t >= br.at && t < br.at + br.w) h = br.h;
        for (let k = 0; k < h; k++) set(dx, y + k, dz, brick());
        if (h === 6 && (t & 1) === 0) set(dx, y + 6, dz, brick());
      }
    }
    // the gate: a three-wide arch in the wall facing f.gate
    for (let a = -1; a <= 1; a++) for (let k = 0; k < 4; k++) { const [wx, wz] = at(a, W); put(wx, y + k, wz, B.AIR, false); }
    // the way in: a causeway from the gate to the land outside, sloping no
    // more than a block a step (a castle on a rise, or in a hollow, is still
    // walked into)
    {
      const [ex, ez] = at(0, W + 9);
      const outside = Math.floor(this.columnAt(ex, ez).h) + 1;
      for (let b = W + 1; b <= W + 8; b++) {
        const hy = Math.round(y + ((outside - y) * (b - W)) / 9);
        for (let a = -2; a <= 2; a++) {
          const [wx, wz] = at(a, b);
          for (let yy = hy - 6; yy < hy; yy++) {
            const cur = get(wx, yy, wz);
            if (yy === hy - 1) put(wx, yy, wz, Math.abs(a) === 2 ? B.SCORCHED_BRICKS : B.SCORCHED_STONE, false);
            else if (cur === B.AIR || cur === B.LAVA) put(wx, yy, wz, B.SCORCHED_STONE, false);
          }
          for (let yy = hy; yy < hy + 4; yy++) put(wx, yy, wz, B.AIR, false);
        }
      }
    }
    // corner towers: hollow, five across, one fallen to a stump
    const fallen = (rng() * 4) | 0;
    [[-W, -W], [W, -W], [W, W], [-W, W]].forEach(([tx, tz], i) => {
      const top = i === fallen ? 3 + ((rng() * 3) | 0) : 9 + ((rng() * 4) | 0);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          for (let k = 0; k < top; k++) set(tx + dx, y + k, tz + dz, edge ? (Math.abs(dx) === 2 && Math.abs(dz) === 2 ? B.CHARRED_STONE : brick()) : B.AIR);
          if (edge && i !== fallen && ((dx + dz) & 1) === 0) set(tx + dx, y + top, tz + dz, brick());
        }
      }
      // a way in from the courtyard (beside where the wall meets it)
      const sx = -Math.sign(tx), sz = -Math.sign(tz);
      set(tx + sx * 2, y, tz + sz, B.AIR); set(tx + sx * 2, y + 1, tz + sz, B.AIR);
    });
    // the keep: nine across, two storeys, its upper floor half fallen in
    const K = 4, KH = 9;
    for (let dx = -K; dx <= K; dx++) {
      for (let dz = -K; dz <= K; dz++) {
        const edge = Math.abs(dx) === K || Math.abs(dz) === K;
        const corner = Math.abs(dx) === K && Math.abs(dz) === K;
        const top = KH - (edge && rng() < 0.3 ? 1 + ((rng() * 3) | 0) : 0);
        if (edge) {
          for (let k = 0; k < top; k++) set(dx, y + k, dz, corner ? B.CHARRED_STONE : brick());
          if (top === KH && ((dx + dz) & 1) === 0) set(dx, y + KH, dz, brick());
        } else {
          set(dx, y - 1, dz, B.CHARRED_PLANKS);
          if (rng() < 0.55) set(dx, y + 4, dz, B.CHARRED_PLANKS);   // what's left of the upper floor
        }
      }
    }
    // its door, toward the gate, and windows high up
    for (let k = 0; k < 3; k++) { const [wx, wz] = at(0, K); put(wx, y + k, wz, B.AIR, false); }
    for (const [a, b] of [[-K, 0], [K, 0], [0, -K]]) { const [wx, wz] = at(a, b); put(wx, y + 6, wz, B.AIR, false); }
    // the cage in the middle, the hoard against the back wall, lanterns
    const cage = put(ox, y, oz, B.SPAWNER, false);
    if (cage >= 0) entities.push([cage, { kind: 'spawner', mob: 'knight', guardian: true }]);
    const chests = [[-2, -(K - 1)], [2, -(K - 1)]];
    for (const [a, b] of chests) {
      const [wx, wz] = at(a, b);
      const loot = castleLoot(rng);   // (rolled whether or not this chunk holds it)
      const i = put(wx, y, wz, B.CHEST, false);
      if (i >= 0) entities.push([i, { kind: 'chest', slots: loot }]);
    }
    for (const [a, b] of [[-(K - 1), K - 1], [K - 1, K - 1], [-(K - 1), -(K - 1)], [K - 1, -(K - 1)]]) {
      const [wx, wz] = at(a, b);
      put(wx, y, wz, B.LANTERN, false);
    }
    // rubble and dead wood across the courtyard
    for (let i = 0; i < 40; i++) {
      const dx = -W + 1 + ((rng() * (2 * W - 1)) | 0), dz = -W + 1 + ((rng() * (2 * W - 1)) | 0);
      const id = rng() < 0.7 ? brick() : B.CHARRED_LOG;
      if (Math.max(Math.abs(dx), Math.abs(dz)) <= K + 1) continue;   // (the keep's doorstep stays clear)
      if (Math.abs(f.gate & 1 ? dz : dx) <= 1) continue;               // (and the way from the gate to its door)
      put(ox + dx, y, oz + dz, id);
      if (rng() < 0.3) put(ox + dx, y + 1, oz + dz, brick());
    }
  }

  // The roost: a flat-topped mesa of scorched stone with a stair up one
  // side, a crown of tall spires round its rim, each smouldering at the
  // tip, and a ring of burnt logs for a nest in the middle.
  buildRoost(put, f, rng, get) {
    const { x: ox, z: oz } = f, top = f.y - 1;
    for (let dx = -ROOST_R; dx <= ROOST_R; dx++) {
      for (let dz = -ROOST_R; dz <= ROOST_R; dz++) {
        const r = Math.hypot(dx, dz);
        const surface = rng() < 0.35 ? B.ASH : B.SCORCHED_STONE;
        if (r > ROOST_R + 0.5) continue;
        const h = r <= 14 ? top : Math.round(top - (r - 14) * 1.6);
        const wx = ox + dx, wz = oz + dz;
        for (let y = h + 1; y < top + 24; y++) put(wx, y, wz, B.AIR, false);
        // down to the land (through any lava or hollow under it)
        for (let y = h; y > 0; y--) {
          const cur = get(wx, y, wz);
          if (cur === -1 || (y < h && cur !== B.AIR && cur !== B.LAVA)) break;
          put(wx, y, wz, y === h && r <= 14 ? surface : B.SCORCHED_STONE, false);
        }
      }
    }
    // the stair: a step down per block from the rim, out over the skirt
    const [sx, sz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f.side];
    for (let k = 0; k <= STAIR_END - 14; k++) {
      for (let w = -1; w <= 1; w++) {
        const wx = ox + sx * (14 + k) + sz * w, wz = oz + sz * (14 + k) + sx * w;
        const sy = top - k;
        for (let y = sy - 3; y <= sy; y++) put(wx, y, wz, B.SCORCHED_BRICKS, false);
        for (let y = sy + 1; y <= sy + 3; y++) put(wx, y, wz, B.AIR, false);
      }
    }
    // the crown: eight spires round the rim, smouldering at their tips
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const bx = ox + Math.round(Math.cos(a) * 12), bz = oz + Math.round(Math.sin(a) * 12);
      const tall = 10 + ((rng() * 8) | 0);
      for (let k = 0; k < tall; k++) {
        const wide = k < tall * 0.4 ? 1 : 0;
        for (let dx = -wide; dx <= wide; dx++) for (let dz = -wide; dz <= wide; dz++) put(bx + dx, top + 1 + k, bz + dz, B.CHARRED_STONE, false);
      }
      put(bx, top + 1 + tall, bz, B.SMOULDERING_STUMP, false);
    }
    // the nest
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const nx = ox + Math.round(Math.cos(a) * 4.5), nz = oz + Math.round(Math.sin(a) * 4.5);
      put(nx, top + 1, nz, B.CHARRED_LOG, false);
      if (rng() < 0.4) put(nx, top + 2, nz, B.CHARRED_LOG, false);
    }
  }

  applyFeature(blocks, cx, cz, f, entities) {
    const put = (wx, wy, wz, id, onlyAir = true) => {
      const x = wx - cx * CHUNK_X, z = wz - cz * CHUNK_Z;
      if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || wy < 1 || wy >= CHUNK_Y) return -1;
      const i = blockIndex(x, wy, z);
      // ('leaves': over air or another tree's dead leaves)
      if (onlyAir === 'leaves' ? blocks[i] !== B.AIR && blocks[i] !== B.CHARRED_LEAVES : onlyAir && blocks[i] !== B.AIR) return -1;
      blocks[i] = id;
      return i;
    };
    const rng = coordRng(this.seed, f.wx, f.wz, f.seed ?? 7);
    const get = (wx, wy, wz) => {
      const x = wx - cx * CHUNK_X, z = wz - cz * CHUNK_Z;
      return x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || wy < 0 || wy >= CHUNK_Y ? -1 : blocks[blockIndex(x, wy, z)];
    };
    if (f.type === 'castle') this.buildCastle(put, f, rng, entities, get);
    else if (f.type === 'roost') this.buildRoost(put, f, rng, get);
    else if (f.type === 'tree') {
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
        // out one, and (a longer one) up and out again: every log touches the last by a face
        put(f.wx + dx, by, f.wz + dz, B.CHARRED_LOG, 'leaves');
        if (len > 1) { put(f.wx + dx, by + 1, f.wz + dz, B.CHARRED_LOG, 'leaves'); put(f.wx + dx * 2, by + 1, f.wz + dz * 2, B.CHARRED_LOG, 'leaves'); }
        // a few leaves clinging round the branch end (touching it)
        if (rng() < 0.7) {
          const ex = f.wx + dx * len, ey = by + (len > 1 ? 1 : 0), ez = f.wz + dz * len;
          for (const [ox, oy, oz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 2, 0]]) if (rng() < 0.65) put(ex + ox, ey + oy, ez + oz, B.CHARRED_LEAVES);
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
