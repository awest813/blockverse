// Deterministic, seed-driven terrain generation. This module is pure
// (no DOM, no THREE) so it can run inside Web Workers.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, blockIndex } from '../core/constants.js';
import { Noise } from '../core/noise.js';
import { coordRng } from '../core/rng.js';
import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { makeStack } from '../items/items.js';

// dungeon chest loot: [id, min, max, chance]
const LOOT = [
  [I.BREAD, 1, 3, 0.6], [I.WHEAT, 2, 5, 0.4], [I.WHEAT_SEEDS, 2, 6, 0.4], [I.APPLE, 1, 3, 0.4],
  [I.COAL, 3, 8, 0.6], [I.IRON_INGOT, 1, 4, 0.5], [I.GOLD_INGOT, 1, 3, 0.3],
  [I.STRING, 1, 4, 0.4], [I.BONE, 2, 5, 0.5], [I.ARROW, 4, 12, 0.4], [I.GUNPOWDER, 1, 3, 0.3],
  [I.BOOK, 1, 2, 0.25], [I.DIAMOND, 1, 2, 0.15],
  [I.IRON_PICKAXE, 1, 1, 0.12], [I.IRON_SWORD, 1, 1, 0.12], [I.BOW, 1, 1, 0.15],
  [I.IRON_HELMET, 1, 1, 0.1], [I.LEATHER_CHESTPLATE, 1, 1, 0.15],
];

function dungeonLoot(rng) {
  const slots = new Array(27).fill(null);
  for (const [id, lo, hi, chance] of LOOT) {
    if (rng() > chance) continue;
    const stack = makeStack(id, lo + ((rng() * (hi - lo + 1)) | 0));
    let i = (rng() * 27) | 0;
    while (slots[i]) i = (i + 1) % 27;
    slots[i] = stack;
  }
  return slots;
}

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4,
  DESERT: 5, SNOWY: 6, SNOWY_FOREST: 7, SWAMP: 8, MOUNTAINS: 9, RIVER: 10,
};

export const BIOME_NAMES = [
  'Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest',
  'Desert', 'Snowy Tundra', 'Snowy Forest', 'Swamp', 'Mountains', 'River',
];

const FROZEN = 0.28;        // below this temperature water freezes and snow falls
const RIVER_WIDTH = 0.03;   // river noise band half-width (channel)
const BANK_WIDTH = 0.065;   // ... and the gently sloping banks around it

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Generator versions: 1 = the original terrain (kept so existing worlds don't
// grow seams); 2 = full-range climate, rolling terrain and rivers.
export const LATEST_GEN = 2;

// climate noise only spans ~0.36..0.64; stretch it to use the whole 0..1 range
const stretch = (v) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * 3.2));
// cheap per-column hash in [0, 1): dithers biome borders so they aren't ruler-straight
function colHash(x, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class WorldGen {
  constructor(seed, version = LATEST_GEN) {
    this.seed = seed >>> 0;
    this.version = version;
    this.continent = new Noise(seed + 1);
    this.erosion = new Noise(seed + 2);
    this.peaks = new Noise(seed + 3);
    this.detail = new Noise(seed + 4);
    this.temp = new Noise(seed + 5);
    this.moist = new Noise(seed + 6);
    this.cave1 = new Noise(seed + 7);
    this.cave2 = new Noise(seed + 8);
    this.mountainMask = new Noise(seed + 9);
    this.cavern = new Noise(seed + 10);
    this.river = new Noise(seed + 11);
  }

  // Everything about a column that depends only on (x, z), computed once:
  // {h (terrain height before caves), t, m, mMask, river (0..1 channel depth)}.
  columnAt(wx, wz) {
    const c = this.continent.fbm2(wx / 700, wz / 700, 4);
    const e = (this.erosion.fbm2(wx / 400, wz / 400, 3) + 1) / 2;
    const mMask = smoothstep(0.15, 0.55, this.mountainMask.noise2(wx / 520, wz / 520));
    const ridge = this.peaks.ridge2(wx / 230, wz / 230, 4);
    const v2 = this.version >= 2;
    const jitter = v2 ? (colHash(wx, wz) - 0.5) * 0.05 : 0;
    const t = v2 ? stretch(this.tempAt(wx, wz)) + jitter : this.tempAt(wx, wz);
    const m = v2 ? stretch(this.moistAt(wx, wz)) - jitter : this.moistAt(wx, wz);

    let h;
    if (v2) {
      // continents with real lowlands and uplands, rolling hills where erosion is low
      const cs = Math.max(-1, Math.min(1, c * 2.4));
      const hills = this.detail.fbm2(wx / 150, wz / 150, 2) * 9 * (1 - e);
      h = 44 + cs * 18 + hills + this.detail.fbm2(wx / 60, wz / 60, 3) * (5 - e * 3);
    } else {
      h = 42 + c * 16 + this.detail.fbm2(wx / 60, wz / 60, 3) * (4 - e * 2.5);
    }
    // mountain ranges (taller in v2, where the old ones never reached the mountain biome)
    h += v2 ? Math.pow(Math.max(0, ridge - 0.3), 1.4) * 72 * mMask
      : Math.pow(Math.max(0, ridge - 0.35), 1.6) * 52 * mMask;

    // Swamps flatten terrain toward the waterline.
    if (m > 0.72 && t > 0.35 && t < 0.7 && mMask < 0.3 && h > SEA_LEVEL - 1 && h < SEA_LEVEL + 8) {
      h = SEA_LEVEL + 1 + (h - SEA_LEVEL - 1) * 0.25;
    }

    // Rivers: a thin band of noise carves a channel below sea level, with
    // banks easing down to it. They fade out in mountains and at sea.
    let river = 0;
    const r = Math.abs(this.river.fbm2(wx / 380, wz / 380, 2));
    if (v2 && r < BANK_WIDTH && h > SEA_LEVEL - 2 && mMask < 0.5) {
      const fade = 1 - smoothstep(0.25, 0.5, mMask);
      if (r < RIVER_WIDTH) {
        river = (1 - r / RIVER_WIDTH) * fade;
        h += (SEA_LEVEL - 3 - h) * smoothstep(0, 0.6, river);
      } else {
        const bank = (1 - (r - RIVER_WIDTH) / (BANK_WIDTH - RIVER_WIDTH)) * fade;
        h += (Math.min(h, SEA_LEVEL + 2.2) - h) * smoothstep(0, 1, bank);   // grassy banks
      }
    }

    return { h: Math.max(4, Math.min(CHUNK_Y - 10, h)), t, m, mMask, river };
  }

  // Terrain height (pre-cave, pre-decoration). Pure function of (x, z).
  heightAt(wx, wz) {
    return this.columnAt(wx, wz).h;
  }

  tempAt(wx, wz) {
    return (this.temp.fbm2(wx / 900, wz / 900, 3) + 1) / 2;
  }

  moistAt(wx, wz) {
    return (this.moist.fbm2(wx / 640, wz / 640, 3) + 1) / 2;
  }

  biomeAt(wx, wz) {
    return this.biomeOf(this.columnAt(wx, wz));
  }

  biomeOf({ h, t, m, mMask, river }) {
    if (river > 0.2 && h < SEA_LEVEL) return BIOME.RIVER;
    if (h < SEA_LEVEL - 2) return BIOME.OCEAN;
    if (h > (this.version >= 2 ? 66 : 74) && mMask > 0.35) return BIOME.MOUNTAINS;
    if (h <= SEA_LEVEL + (this.version >= 2 ? 0.9 : 1.5) && t > 0.3) return BIOME.BEACH;
    if (t < 0.28) return m > 0.55 ? BIOME.SNOWY_FOREST : BIOME.SNOWY;
    if (t > 0.68 && m < 0.38) return BIOME.DESERT;
    if (m > 0.72 && t > 0.35 && t < 0.7) return BIOME.SWAMP;
    if (m > 0.52) return t > 0.42 && t < 0.62 && m < 0.64 ? BIOME.BIRCH_FOREST : BIOME.FOREST;
    return BIOME.PLAINS;
  }

  isCave(wx, wy, wz, surface) {
    if (wy < 6 || wy > surface + 1) return false;
    // never breach a seabed, river bed or shoreline: water can't flow into the hole
    if (surface < SEA_LEVEL + 2 && wy > surface - 4) return false;
    // Spaghetti tunnels: intersection of two noise bands.
    const n1 = this.cave1.fbm3(wx / 26, wy / 20, wz / 26, 2);
    const n2 = this.cave2.fbm3(wx / 26, wy / 20, wz / 26, 2);
    // v2: tunnels pinch in near the surface so hillsides aren't riddled with holes
    const w = this.version >= 2 && wy > surface - 6 ? 0.055 : 0.09;
    if (Math.abs(n1) < w && Math.abs(n2) < w) return true;
    // Cheese caverns deep down.
    if (wy < 34) {
      const c = this.cavern.fbm3(wx / 46, wy / 30, wz / 46, 2);
      if (c > 0.44 + (wy / 34) * 0.18) return true;
    }
    return false;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint16Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    const heightMap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const biomeMap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const bedrockRng = coordRng(this.seed, cx, cz, 1);

    for (let x = 0; x < CHUNK_X; x++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        const wx = cx * CHUNK_X + x;
        const wz = cz * CHUNK_Z + z;
        const col = this.columnAt(wx, wz);
        const h = Math.floor(col.h);
        const biome = this.biomeOf(col);
        const frozen = col.t < FROZEN;
        heightMap[x * CHUNK_Z + z] = h;
        biomeMap[x * CHUNK_Z + z] = biome;

        const snowy = biome === BIOME.SNOWY || biome === BIOME.SNOWY_FOREST ||
          (biome === BIOME.MOUNTAINS && (h > (this.version >= 2 ? 78 : 86) ||   // snow-capped peaks
            (this.version >= 2 && frozen)));                                  // cold ranges snow all over
        const sandy = biome === BIOME.DESERT || biome === BIOME.BEACH || biome === BIOME.RIVER ||
          (biome === BIOME.OCEAN && h > SEA_LEVEL - 8);

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          const idx = blockIndex(x, y, z);
          let id = B.AIR;

          if (y > h) {
            id = y <= SEA_LEVEL ? B.WATER : B.AIR;
            // cold water freezes over, whatever the biome (oceans, rivers, lakes)
            if (id === B.WATER && y === SEA_LEVEL && frozen) id = B.ICE;
          } else if (y === 0 || (y === 1 && bedrockRng() < 0.5)) {
            id = B.BEDROCK;
          } else if (this.isCave(wx, y, wz, h)) {
            id = y <= 9 ? B.WATER : B.AIR; // lava would go here; use water pools deep down
          } else if (y === h) {
            // surface block
            if (y < SEA_LEVEL - 1) id = sandy ? B.SAND : (biome === BIOME.OCEAN ? B.GRAVEL : B.DIRT);
            else if (sandy) id = B.SAND;
            else if (snowy) id = B.SNOWY_GRASS;
            else if (biome === BIOME.MOUNTAINS && h > 68) id = B.STONE;
            else id = B.GRASS;
          } else if (y > h - 4) {
            // subsurface strata
            if (sandy) id = y > h - 3 ? B.SAND : B.SANDSTONE;
            else if (biome === BIOME.MOUNTAINS && h > 68) id = B.STONE;
            else id = B.DIRT;
          } else {
            id = B.STONE;
          }
          blocks[idx] = id;
        }

        // occasional clay pockets under water
        if (biome === BIOME.OCEAN || biome === BIOME.SWAMP || biome === BIOME.RIVER) {
          const r = coordRng(this.seed, wx, wz, 33)();
          if (r < 0.06 && h > 4) blocks[blockIndex(x, h, z)] = B.CLAY;
        }
      }
    }

    this.placeOres(blocks, cx, cz, heightMap);
    this.decorateCaves(blocks, cx, cz, heightMap);
    const entities = this.placeDungeon(blocks, cx, cz, heightMap);
    this.decorate(blocks, cx, cz);

    return { blocks, heightMap, biomeMap, entities };
  }

  // Is the ground at a feature's spot real (not carved away by a cave mouth)?
  groundOk(wx, h, wz) {
    return !this.isCave(wx, h, wz, h) && !this.isCave(wx, h - 1, wz, h);
  }

  // Mushrooms and mossy patches on cave floors (within this chunk only).
  decorateCaves(blocks, cx, cz, heightMap) {
    const rng = coordRng(this.seed, cx, cz, 900);
    for (let i = 0; i < 40; i++) {
      const x = (rng() * CHUNK_X) | 0, z = (rng() * CHUNK_Z) | 0;
      const top = heightMap[x * CHUNK_Z + z] - 6;
      if (top < 10) continue;
      const y = 8 + ((rng() * (top - 8)) | 0);
      const here = blocks[blockIndex(x, y, z)], below = blocks[blockIndex(x, y - 1, z)];
      if (here !== B.AIR || (below !== B.STONE && below !== B.DIRT && below !== B.GRAVEL)) continue;
      const r = rng();
      if (r < 0.35) blocks[blockIndex(x, y, z)] = rng() < 0.5 ? B.MUSHROOM_BROWN : B.MUSHROOM_RED;
      else if (r < 0.7) {
        // a small mossy patch on the floor
        for (let k = 0; k < 6; k++) {
          const px = x + ((rng() * 3) | 0) - 1, pz = z + ((rng() * 3) | 0) - 1;
          if (px < 0 || px >= CHUNK_X || pz < 0 || pz >= CHUNK_Z) continue;
          const idx = blockIndex(px, y - 1, pz);
          if (blocks[idx] === B.STONE && blocks[blockIndex(px, y, pz)] === B.AIR) blocks[idx] = B.MOSSY_COBBLE;
        }
      }
    }
  }

  // A rare buried room of (mossy) cobblestone with a loot chest. Built
  // entirely inside one chunk. Returns block entities as [index, data].
  placeDungeon(blocks, cx, cz, heightMap) {
    const rng = coordRng(this.seed, cx, cz, 4242);
    if (rng() > 0.045) return [];
    let minTop = CHUNK_Y;
    for (let x = 3; x <= 12; x++) for (let z = 3; z <= 12; z++) minTop = Math.min(minTop, heightMap[x * CHUNK_Z + z]);
    const hiY = Math.min(40, minTop - 8);
    if (hiY < 12) return [];
    const y0 = 10 + ((rng() * (hiY - 10)) | 0);   // floor level
    const x0 = 4 + ((rng() * 2) | 0), z0 = 4 + ((rng() * 2) | 0);
    const W = 7, H = 5;                           // outer size: 7 x 5 x 7
    for (let dx = 0; dx < W; dx++) {
      for (let dz = 0; dz < W; dz++) {
        for (let dy = 0; dy < H; dy++) {
          const edge = dx === 0 || dz === 0 || dx === W - 1 || dz === W - 1 || dy === 0 || dy === H - 1;
          const idx = blockIndex(x0 + dx, y0 + dy, z0 + dz);
          blocks[idx] = edge ? (rng() < 0.4 ? B.MOSSY_COBBLE : B.COBBLESTONE) : B.AIR;
        }
      }
    }
    // a doorway on one side so caves can connect
    const side = (rng() * 4) | 0;
    const door = [[3, 0], [3, W - 1], [0, 3], [W - 1, 3]][side];
    for (const dy of [1, 2]) blocks[blockIndex(x0 + door[0], y0 + dy, z0 + door[1])] = B.AIR;

    // the chest, against the wall opposite the door
    const cpos = [[3, W - 2], [3, 1], [W - 2, 3], [1, 3]][side];
    const cidx = blockIndex(x0 + cpos[0], y0 + 1, z0 + cpos[1]);
    blocks[cidx] = B.CHEST;
    blocks[blockIndex(x0 + 1, y0 + 1, z0 + 1)] = B.TORCH;   // a guttering torch in the corner
    return [[cidx, { kind: 'chest', slots: dungeonLoot(rng) }]];
  }

  placeOres(blocks, cx, cz, heightMap) {
    // [block, attempts per chunk, blob size, minY, maxY]
    const ORES = [
      [B.COAL_ORE, 14, 10, 6, 96],
      [B.IRON_ORE, 10, 6, 4, 54],
      [B.GOLD_ORE, 3, 5, 4, 30],
      [B.REDSTONE_ORE, 6, 6, 4, 16],
      [B.DIAMOND_ORE, 2, 5, 4, 14],
      [B.GRAVEL, 6, 14, 8, 60],
      [B.DIRT, 8, 14, 8, 70],
    ];
    for (let o = 0; o < ORES.length; o++) {
      const [id, attempts, size, minY, maxY] = ORES[o];
      const rng = coordRng(this.seed, cx, cz, 100 + o);
      for (let a = 0; a < attempts; a++) {
        let x = (rng() * CHUNK_X) | 0;
        let y = minY + ((rng() * (maxY - minY)) | 0);
        let z = (rng() * CHUNK_Z) | 0;
        for (let s = 0; s < size; s++) {
          if (x >= 0 && x < CHUNK_X && y > 1 && y < CHUNK_Y && z >= 0 && z < CHUNK_Z) {
            const idx = blockIndex(x, y, z);
            if (blocks[idx] === B.STONE) blocks[idx] = id;
          }
          const dir = (rng() * 6) | 0;
          if (dir === 0) x++; else if (dir === 1) x--;
          else if (dir === 2) y++; else if (dir === 3) y--;
          else if (dir === 4) z++; else z--;
        }
      }
    }
  }

  // Features from the 3x3 chunk neighbourhood may reach into this chunk.
  // Each feature is fully determined by its origin chunk's seed, so every
  // chunk that overlaps it generates the exact same blocks.
  decorate(blocks, cx, cz) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const f of this.chunkFeatures(cx + dx, cz + dz)) {
          this.applyFeature(blocks, cx, cz, f);
        }
      }
    }
  }

  chunkFeatures(cx, cz) {
    const rng = coordRng(this.seed, cx, cz, 777);
    const features = [];
    const baseX = cx * CHUNK_X;
    const baseZ = cz * CHUNK_Z;

    // sample biome at chunk centre to decide densities
    const biome = this.biomeAt(baseX + 8, baseZ + 8);

    let trees = 0, treeKind = 'oak';
    switch (biome) {
      case BIOME.FOREST: trees = 6 + ((rng() * 4) | 0); treeKind = 'oak'; break;
      case BIOME.BIRCH_FOREST: trees = 5 + ((rng() * 4) | 0); treeKind = 'birch'; break;
      case BIOME.SNOWY_FOREST: trees = 4 + ((rng() * 3) | 0); treeKind = 'spruce'; break;
      case BIOME.PLAINS: trees = rng() < 0.25 ? 1 : 0; treeKind = 'oak'; break;
      case BIOME.SWAMP: trees = 2 + ((rng() * 2) | 0); treeKind = 'oak'; break;
      case BIOME.MOUNTAINS: trees = rng() < 0.4 ? 1 : 0; treeKind = 'spruce'; break;
      default: trees = 0;
    }

    for (let i = 0; i < trees; i++) {
      const wx = baseX + ((rng() * CHUNK_X) | 0);
      const wz = baseZ + ((rng() * CHUNK_Z) | 0);
      const h = Math.floor(this.heightAt(wx, wz));
      if (h <= SEA_LEVEL || !this.groundOk(wx, h, wz)) continue;
      const kind = treeKind === 'oak' && rng() < 0.12 ? 'birch' : treeKind;
      features.push({ type: 'tree', kind, wx, wy: h + 1, wz, size: 4 + ((rng() * 3) | 0), rng: coordRng(this.seed, wx, wz, 555) });
    }

    if (biome === BIOME.DESERT) {
      const n = (rng() * 3) | 0;
      for (let i = 0; i < n; i++) {
        const wx = baseX + ((rng() * CHUNK_X) | 0);
        const wz = baseZ + ((rng() * CHUNK_Z) | 0);
        const h = Math.floor(this.heightAt(wx, wz));
        if (h <= SEA_LEVEL || !this.groundOk(wx, h, wz)) continue;
        features.push({ type: 'cactus', wx, wy: h + 1, wz, size: 1 + ((rng() * 3) | 0) });
      }
      if (rng() < 0.3) {
        const wx = baseX + ((rng() * CHUNK_X) | 0);
        const wz = baseZ + ((rng() * CHUNK_Z) | 0);
        const h = Math.floor(this.heightAt(wx, wz));
        if (h > SEA_LEVEL && this.groundOk(wx, h, wz)) features.push({ type: 'plant', block: B.DEAD_BUSH, wx, wy: h + 1, wz });
      }
    }

    // grass, flowers, pumpkins, mushrooms, sugar cane
    const grassCount = biome === BIOME.PLAINS ? 24 : biome === BIOME.FOREST || biome === BIOME.BIRCH_FOREST ? 12 : biome === BIOME.SWAMP ? 10 : 0;
    for (let i = 0; i < grassCount; i++) {
      const wx = baseX + ((rng() * CHUNK_X) | 0);
      const wz = baseZ + ((rng() * CHUNK_Z) | 0);
      const h = Math.floor(this.heightAt(wx, wz));
      if (h <= SEA_LEVEL || !this.groundOk(wx, h, wz)) continue;
      let block = B.TALL_GRASS;
      const r = rng();
      if (r < 0.08) block = B.DANDELION;
      else if (r < 0.16) block = B.POPPY;
      features.push({ type: 'plant', block, wx, wy: h + 1, wz });
    }
    if (biome === BIOME.SWAMP) {
      for (let i = 0; i < 4; i++) {
        const wx = baseX + ((rng() * CHUNK_X) | 0);
        const wz = baseZ + ((rng() * CHUNK_Z) | 0);
        const h = Math.floor(this.heightAt(wx, wz));
        if (h > SEA_LEVEL && this.groundOk(wx, h, wz)) features.push({ type: 'plant', block: rng() < 0.5 ? B.MUSHROOM_BROWN : B.MUSHROOM_RED, wx, wy: h + 1, wz });
      }
    }
    if ((biome === BIOME.PLAINS || biome === BIOME.FOREST) && rng() < 0.06) {
      const wx = baseX + ((rng() * CHUNK_X) | 0);
      const wz = baseZ + ((rng() * CHUNK_Z) | 0);
      const h = Math.floor(this.heightAt(wx, wz));
      if (h > SEA_LEVEL && this.groundOk(wx, h, wz)) features.push({ type: 'plant', block: B.PUMPKIN, wx, wy: h + 1, wz });
    }
    // sugar cane at the waterline
    if (biome === BIOME.BEACH || biome === BIOME.SWAMP || biome === BIOME.PLAINS) {
      for (let i = 0; i < 3; i++) {
        const wx = baseX + ((rng() * CHUNK_X) | 0);
        const wz = baseZ + ((rng() * CHUNK_Z) | 0);
        const h = Math.floor(this.heightAt(wx, wz));
        if ((h === SEA_LEVEL || h === SEA_LEVEL + 1) && this.groundOk(wx, h, wz)) {
          features.push({ type: 'cane', wx, wy: h + 1, wz, size: 2 + ((rng() * 2) | 0) });
        }
      }
    }
    return features;
  }

  applyFeature(blocks, cx, cz, f) {
    const put = (wx, wy, wz, id, onlyAir = true) => {
      const x = wx - cx * CHUNK_X;
      const z = wz - cz * CHUNK_Z;
      if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || wy < 0 || wy >= CHUNK_Y) return;
      const idx = blockIndex(x, wy, z);
      if (onlyAir && blocks[idx] !== B.AIR) return;
      blocks[idx] = id;
    };

    switch (f.type) {
      case 'tree': this.buildTree(put, f); break;
      case 'cactus':
        for (let i = 0; i < f.size; i++) put(f.wx, f.wy + i, f.wz, B.CACTUS);
        break;
      case 'cane':
        for (let i = 0; i < f.size; i++) put(f.wx, f.wy + i, f.wz, B.SUGAR_CANE);
        break;
      case 'plant':
        put(f.wx, f.wy, f.wz, f.block);
        break;
    }
  }

  buildTree(put, f) {
    const { kind, wx, wy, wz } = f;
    const rng = f.rng ?? coordRng(this.seed, wx, wz, 555);
    if (kind === 'spruce') {
      const h = f.size + 3;
      for (let i = 0; i < h; i++) put(wx, wy + i, wz, B.SPRUCE_LOG, false);
      // conical leaf layers
      let radius = 2;
      for (let layer = h; layer >= 2; layer -= 1) {
        const r = layer === h ? 0 : radius;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > r + (layer % 2 ? 0 : 1)) continue;
            if (dx === 0 && dz === 0 && layer < h) continue;
            put(wx + dx, wy + layer, wz + dz, B.SPRUCE_LEAVES);
          }
        }
        put(wx, wy + h + 1, wz, B.SPRUCE_LEAVES);
        radius = layer % 2 ? 1 : 2;
      }
      return;
    }

    const log = kind === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
    const leaf = kind === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const h = f.size + (kind === 'birch' ? 2 : 0);
    for (let i = 0; i < h; i++) put(wx, wy + i, wz, log, false);
    // canopy: two wide layers + cap
    for (let dy = h - 3; dy <= h - 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && rng() < 0.4) continue;
          put(wx + dx, wy + dy, wz + dz, leaf);
        }
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && rng() < 0.5) continue;
        put(wx + dx, wy + h - 1, wz + dz, leaf);
      }
    }
    put(wx, wy + h, wz, leaf);
    put(wx + 1, wy + h, wz, leaf);
    put(wx - 1, wy + h, wz, leaf);
    put(wx, wy + h, wz + 1, leaf);
    put(wx, wy + h, wz - 1, leaf);
  }
}
