// Deterministic, seed-driven terrain generation. This module is pure
// (no DOM, no THREE) so it can run inside Web Workers.

import { buildVillageSlice } from './villages.js';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, blockIndex } from '../core/constants.js';
import { Noise } from '../core/noise.js';
import { coordRng, hashCoords, mulberry32 } from '../core/rng.js';
import { B } from '../blocks/blocks.js';
import { placeDungeon, structurePlan, nearStructure, buildStructure, placeFossil } from './structures.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4,
  DESERT: 5, SNOWY: 6, SNOWY_FOREST: 7, SWAMP: 8, MOUNTAINS: 9, RIVER: 10,
  // the Scorchlands (scorchgen.js)
  SCORCHED_FOREST: 11, ASH_WASTES: 12,
};

export const BIOME_NAMES = [
  'Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest',
  'Desert', 'Snowy Tundra', 'Snowy Forest', 'Swamp', 'Mountains', 'River',
  'Scorched Forest', 'Ash Wastes',
];

export const FROZEN = 0.28; // below this temperature water freezes and snow falls
const RIVER_WIDTH = 0.03;   // river noise band half-width (channel)
const BANK_WIDTH = 0.065;   // ... and the gently sloping banks around it
const RAVINE_MASK = 0.3;    // (generator 13) where the ravine mask noise passes this, ravines can run
// (generator 13) natural rock a cave can be dressed on, and the floor each
// biome gives the caves under it
const CAVE_ROCK = new Set([B.STONE, B.DIRT, B.GRAVEL, B.SANDSTONE, B.CLAY, B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.REDSTONE_ORE, B.DIAMOND_ORE]);
const CAVE_FLOORS = { [BIOME.FOREST]: B.MOSSY_COBBLE, [BIOME.BIRCH_FOREST]: B.MOSSY_COBBLE, [BIOME.SWAMP]: B.MOSSY_COBBLE, [BIOME.SNOWY]: B.ICE, [BIOME.SNOWY_FOREST]: B.ICE, [BIOME.DESERT]: B.SAND };

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Generator versions: 1 = the original terrain (kept so existing worlds don't
// grow seams); 2 = full-range climate, rolling terrain and rivers;
// 3 = surface structures (temples, shrines); 4 = per-quadrant decoration
// (river-bank trees, cane by any water, boulders, sparse tundra spruce);
// 5 = lava in deep caves, swamp pools + lily pads, kelp/seagrass, snow;
// 6 = desert wells and shipwrecks; 7 = ocean ruins and fossils;
// 8 = farming loot in chests (carrots, potatoes, golden carrots);
// 9 = larger biomes (climate twice as broad, wider mountain ranges and continents),
//     ore veins that follow the ground (coal up into hills and mountains),
//     wavy biome borders instead of speckled ones, swamps that blend in at
//     the edges, wider birch woods, no trees on bare mountain rock, no clay
//     specks on dry land or grass under water and ice.
//  10 - every noise channel sampled off its lattice (gradient noise is zero
//     on whole-number coordinates: rivers met in a grid, and every world's
//     spawn had the same climate), no single-column biome specks, ore veins
//     that cross chunk borders, flower meadows and bushes, structures kept
//     apart without losing desert temples and wells, and a clear way in to
//     every temple and shrine.
//  11 - cornflowers, berry bushes and wild rice.
//  12 - villages (world/villages.js): a square and well, roads, houses, a
//     smithy, a kitchen, a library, fields and stables, styled by biome.
//  13 - caves: tunnels that widen and narrow, big caverns held up by
//     pillars, ravines open to the sky, flooded caves (underground lakes
//     in place of lava in places), and cave floors and ceilings dressed by
//     depth and the biome above (stalactites and stalagmites, glowcaps,
//     moss, ice, sand, clay and gravel under the lakes).
//  14 - the seed stirred before it's hashed with a chunk (featureSeed):
//     trees, plants, ores, bedrock, dungeons, structures, fossils and cave
//     dressing no longer repeat, a few chunks over, in worlds whose seeds
//     differ only in their low bits (seeds 1 and 3 were two chunks apart).
export const LATEST_GEN = 14;

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
    // what every per-chunk / per-block roll is seeded from. coordRng xors the
    // seed straight into the first coordinate, so on older generators seed
    // s ^ d rolled at x ^ d what seed s rolled at x (seeds 1 and 3: two chunks
    // apart); generator 14 stirs it first (its own stir, not villages.js's
    // mixedSeed, so a chunk's rolls don't echo the village of the region with
    // the same number)
    this.featureSeed = version >= 14 ? hashCoords(this.seed, 0x68e31da4, 0xb5297a4d, 0x1b56c4e9) : this.seed;
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
    // generator 9 spreads climate, ranges and continents out (bigger biomes)
    const big = version >= 9;
    this.climateScale = big ? 2 : 1;
    this.rangeScale = big ? 1.5 : 1;
    this.continentScale = big ? 1.4 : 1;
    // generator 10: each channel's own offset, so no lattice point (where the
    // noise is pinned to zero) lines up with anything; older generators add 0
    const v10 = version >= 10;
    const orng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    const off = () => (v10 ? 0.25 + orng() * 0.5 : 0);
    this.off = {};
    for (const k of ['c', 'e', 'm', 'p', 'd', 't', 'w', 'r', 'k1', 'k2', 'kc']) this.off[k] = [off(), off()];
    // generator 13's cave channels (drawn after the others, so their offsets stay put)
    for (const k of ['rv', 'rm', 'aq', 'th', 'bg']) this.off[k] = [off(), off()];
    this.ravine = new Noise(seed + 12);
    this.ravineMask = new Noise(seed + 13);
    this.aquifer = new Noise(seed + 14);
    this.caveShape = new Noise(seed + 15);
  }

  // Everything about a column that depends only on (x, z), computed once:
  // {h (terrain height before caves), t, m, mMask, river (0..1 channel depth)}.
  columnAt(wx, wz) {
    const cs0 = 700 * this.continentScale, ms = 520 * this.rangeScale;
    const O = this.off;
    const c = this.continent.fbm2(wx / cs0 + O.c[0], wz / cs0 + O.c[1], 4);
    const e = (this.erosion.fbm2(wx / 400 + O.e[0], wz / 400 + O.e[1], 3) + 1) / 2;
    const mMask = smoothstep(0.15, 0.55, this.mountainMask.noise2(wx / ms + O.m[0], wz / ms + O.m[1]));
    const ridge = this.peaks.ridge2(wx / 230 + O.p[0], wz / 230 + O.p[1], 4);
    const v2 = this.version >= 2;
    const v9 = this.version >= 9;
    const [dox, doz] = O.d;
    // borders: v2-8 dither each column (a speckled band that v9's broader
    // climate would double); v9 wiggles them with smooth noise instead (and
    // v10 without the last speck of dither)
    const jitter = v9 ? this.detail.noise2(wx / 22 + dox, wz / 22 + doz) * 0.035 + (this.version >= 10 ? 0 : (colHash(wx, wz) - 0.5) * 0.008)
      : v2 ? (colHash(wx, wz) - 0.5) * 0.05 : 0;
    const t = v2 ? stretch(this.tempAt(wx, wz)) + jitter : this.tempAt(wx, wz);
    const m = v2 ? stretch(this.moistAt(wx, wz)) - jitter : this.moistAt(wx, wz);

    let h;
    if (v2) {
      // continents with real lowlands and uplands, rolling hills where erosion is low
      const cs = Math.max(-1, Math.min(1, c * 2.4));
      const hills = this.detail.fbm2(wx / 150 + dox, wz / 150 + doz, 2) * 9 * (1 - e);
      h = 44 + cs * 18 + hills + this.detail.fbm2(wx / 60 + dox, wz / 60 + doz, 3) * (5 - e * 3);
    } else {
      h = 42 + c * 16 + this.detail.fbm2(wx / 60, wz / 60, 3) * (4 - e * 2.5);
    }
    // mountain ranges (taller in v2, where the old ones never reached the mountain biome)
    h += v2 ? Math.pow(Math.max(0, ridge - 0.3), 1.4) * 72 * mMask
      : Math.pow(Math.max(0, ridge - 0.35), 1.6) * 52 * mMask;

    // Swamps flatten terrain toward the waterline (v5: with shallow pools).
    let pool = false;
    if (v9) {
      // v9: ease the flattening in across the swamp's edge, so it doesn't
      // end in a ragged wall of pillars where the old hard test flipped
      const w = smoothstep(0.68, 0.76, m) * smoothstep(0.33, 0.37, t) * (1 - smoothstep(0.68, 0.72, t))
        * (1 - smoothstep(0.25, 0.3, mMask)) * (1 - smoothstep(SEA_LEVEL + 5, SEA_LEVEL + 8, h)) * (h > SEA_LEVEL - 1 ? 1 : 0);
      if (w > 0) {
        h += (SEA_LEVEL + 1 + (h - SEA_LEVEL - 1) * 0.25 - h) * w;
        const p = this.detail.fbm2(wx / 19 + dox, wz / 19 + doz, 2);
        if (p > 0.12 && w > 0.6) { h = Math.max(SEA_LEVEL - 1.9, SEA_LEVEL - 0.4 - (p - 0.12) * 6); pool = true; }
      }
    } else if (m > 0.72 && t > 0.35 && t < 0.7 && mMask < 0.3 && h > SEA_LEVEL - 1 && h < SEA_LEVEL + 8) {
      h = SEA_LEVEL + 1 + (h - SEA_LEVEL - 1) * 0.25;
      if (this.version >= 5) {
        const p = this.detail.fbm2(wx / 19, wz / 19, 2);
        if (p > 0.12) { h = Math.max(SEA_LEVEL - 1.9, SEA_LEVEL - 0.4 - (p - 0.12) * 6); pool = true; }
      }
    }

    // Rivers: a thin band of noise carves a channel below sea level, with
    // banks easing down to it. They fade out in mountains and at sea.
    let river = 0;
    const r = Math.abs(this.river.fbm2(wx / 380 + O.r[0], wz / 380 + O.r[1], 2));
    if (v2 && r < BANK_WIDTH && h > SEA_LEVEL - 2 && mMask < 0.5) {
      const fade = 1 - smoothstep(0.25, 0.5, mMask);
      if (r < RIVER_WIDTH) {
        river = (1 - r / RIVER_WIDTH) * fade;
        // v9: the channel starts from the bank's height (where the banks
        // end), not the land's: older versions left a cliff along the water
        if (v9) h += (Math.min(h, SEA_LEVEL + 2.2) - h) * smoothstep(0, 1, fade);
        h += (SEA_LEVEL - 3 - h) * smoothstep(0, 0.6, river);
      } else {
        const bank = (1 - (r - RIVER_WIDTH) / (BANK_WIDTH - RIVER_WIDTH)) * fade;
        h += (Math.min(h, SEA_LEVEL + 2.2) - h) * smoothstep(0, 1, bank);   // grassy banks
      }
    }

    return { h: Math.max(4, Math.min(CHUNK_Y - 10, h)), t, m, mMask, river, pool };
  }

  // Terrain height (pre-cave, pre-decoration). Pure function of (x, z).
  heightAt(wx, wz) {
    return this.columnAt(wx, wz).h;
  }

  tempAt(wx, wz) {
    const k = 900 * this.climateScale;
    return (this.temp.fbm2(wx / k + this.off.t[0], wz / k + this.off.t[1], 3) + 1) / 2;
  }

  moistAt(wx, wz) {
    const k = 640 * this.climateScale;
    return (this.moist.fbm2(wx / k + this.off.w[0], wz / k + this.off.w[1], 3) + 1) / 2;
  }

  biomeAt(wx, wz) {
    return this.biomeOf(this.columnAt(wx, wz));
  }

  // Smooth climate for colouring (grass, leaves, water): temperature and
  // moisture as biomes use them, without the per-column border dither.
  climateAt(wx, wz) {
    if (this.version < 2) return { t: this.tempAt(wx, wz), m: this.moistAt(wx, wz) };
    return { t: stretch(this.tempAt(wx, wz)), m: stretch(this.moistAt(wx, wz)) };
  }

  biomeOf({ h, t, m, mMask, river, pool }) {
    if (pool) return BIOME.SWAMP;
    if (river > 0.2 && h < SEA_LEVEL) return BIOME.RIVER;
    if (h < SEA_LEVEL - 2) return BIOME.OCEAN;
    if (h > (this.version >= 2 ? 66 : 74) && mMask > 0.35) return BIOME.MOUNTAINS;
    if (h <= SEA_LEVEL + (this.version >= 2 ? 0.9 : 1.5) && t > 0.3) return BIOME.BEACH;
    if (t < 0.28) return m > 0.55 ? BIOME.SNOWY_FOREST : BIOME.SNOWY;
    if (t > 0.68 && m < 0.38) return BIOME.DESERT;
    if (m > 0.72 && t > 0.35 && t < 0.7) return BIOME.SWAMP;
    // (v9 widens the birch woods: they were a thin band between forest and plains)
    if (m > 0.52) return (this.version >= 9 ? t > 0.4 && t < 0.64 && m < 0.68 : t > 0.42 && t < 0.62 && m < 0.64) ? BIOME.BIRCH_FOREST : BIOME.FOREST;
    return BIOME.PLAINS;
  }

  // (generator 13 passes the column's caveColumn; anything else that asks
  // works it out)
  isCave(wx, wy, wz, surface, cc) {
    if (wy < 6 || wy > surface + 1) return false;
    // never breach a seabed, river bed or shoreline: water can't flow into the hole
    if (this.version >= 2 && surface < SEA_LEVEL + 2 && wy > surface - 4) return false;
    const O = this.off, v13 = this.version >= 13;
    if (v13) {
      cc ??= this.caveColumn(wx, wz, surface);
      if (wy >= cc.ravine && wy >= this.ravineFloor(cc, surface, cc.rt + this.caveShape.noise3(wx / 6 + O.rv[1], wy / 5, wz / 6 + O.rm[1]) * 0.2)) return true;
    }
    // Spaghetti tunnels: intersection of two noise bands.
    // (the second band is only worth sampling where the first is near zero)
    const n1 = this.cave1.fbm3(wx / 26 + O.k1[0], wy / 20, wz / 26 + O.k1[1], 2);
    // v2: tunnels pinch in near the surface so hillsides aren't riddled with holes
    // (v13: and swell and narrow as they go)
    const w = (this.version >= 2 && wy > surface - 6 ? 0.055 : 0.09) * (v13 ? cc.thick : 1);
    if (Math.abs(n1) < w && Math.abs(this.cave2.fbm3(wx / 26 + O.k2[0], wy / 20, wz / 26 + O.k2[1], 2)) < w) return true;
    // Cheese caverns deep down (v13: some far bigger, reaching higher, with
    // pillars of rock left standing in them)
    const top = v13 ? 34 + cc.big * 8 : 34;
    if (wy < top) {
      const c = this.cavern.fbm3(wx / 46 + O.kc[0], wy / 30, wz / 46 + O.kc[1], 2);
      if (c > (v13 ? 0.44 - cc.big * 0.12 + (wy / top) * 0.2 : 0.44 + (wy / 34) * 0.18)) return !(v13 && cc.pillar);
    }
    return false;
  }

  // Generator 13: the caves of one column, worked out once for all its
  // cells: where a ravine's floor is (CHUNK_Y: no ravine), how wide its
  // tunnels run, whether its caverns are big ones (and a pillar stands
  // here), and how high the water stands in flooded caves (wet: 0 dry,
  // up to 1 well flooded; the band at its edge is walled off).
  caveColumn(wx, wz, h) {
    const O = this.off;
    const cc = { ravine: CHUNK_Y, rt: 2, rdepth: 0, rlow: 0, thick: 1, big: 0, pillar: false, wet: 0, water: 0 };
    cc.thick = 0.8 + 0.55 * smoothstep(-0.3, 0.5, this.caveShape.noise2(wx / 90 + O.th[0], wz / 90 + O.th[1]));
    cc.big = smoothstep(0.25, 0.55, this.caveShape.noise2(wx / 160 + O.bg[0], wz / 160 + O.bg[1]));
    if (cc.big > 0) cc.pillar = this.caveShape.noise2(wx / 5 + O.bg[1], wz / 5 + O.bg[0]) > 0.42 - cc.big * 0.08;
    cc.wet = smoothstep(0.2, 0.42, this.aquifer.noise2(wx / 190 + O.aq[0], wz / 190 + O.aq[1]));
    // (a water table that's level for a hundred blocks and more: a lake's
    // surface is flat)
    if (cc.wet > 0) cc.water = Math.floor(18 + 8 * this.aquifer.noise2(wx / 1100 + O.aq[1], wz / 1100 + O.aq[0]));
    // Ravines: long cracks open to the sky, along the zero line of one noise
    // where a slower one allows, deepest down their middle
    const m = this.ravineMask.noise2(wx / 340 + O.rm[0], wz / 340 + O.rm[1]);
    if (m > RAVINE_MASK && h > SEA_LEVEL + 3) {
      const half = 0.038 * smoothstep(RAVINE_MASK, RAVINE_MASK + 0.15, m);
      const a = Math.abs(this.ravine.noise2(wx / 120 + O.rv[0], wz / 120 + O.rv[1]) + this.detail.noise2(wx / 7 + O.d[1], wz / 7 + O.d[0]) * 0.004);
      // (out to 1.2 of the way: the walls bulge and recede as they go down)
      if (a < half * 1.2 && !nearStructure(this, wx, wz, 4)) {
        cc.rt = a / half;
        cc.rdepth = 12 + 32 * smoothstep(RAVINE_MASK, RAVINE_MASK + 0.3, m);
        // never down past the waterline near open water (a hole below it
        // beside a lake, river or the sea would hold up a wall of water);
        // ground that high is a few blocks from any
        cc.rlow = Math.max(SEA_LEVEL + 1 - Math.max(0, h - SEA_LEVEL - 6) * 6, 7);
        cc.ravine = this.ravineFloor(cc, h, cc.rt - 0.2);   // (no cell below this can be in it)
      }
    }
    return cc;
  }

  // the floor of a ravine where the column is t of the way out from its
  // middle to its rim (CHUNK_Y: past the rim)
  ravineFloor(cc, h, t) {
    if (t >= 1) return CHUNK_Y;
    const floor = Math.max(h - cc.rdepth * Math.sqrt(1 - Math.max(0, t)), cc.rlow);
    return floor < h - 1 ? Math.floor(floor) : CHUNK_Y;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint16Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
    const heightMap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const biomeMap = new Uint8Array(CHUNK_X * CHUNK_Z);
    const bedrockRng = coordRng(this.featureSeed, cx, cz, 1);
    const v5 = this.version >= 5;
    const v13 = this.version >= 13;

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
        const cc = v13 ? this.caveColumn(wx, wz, h) : null;

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          const idx = blockIndex(x, y, z);
          let id = B.AIR;

          if (y > h) {
            id = y <= SEA_LEVEL ? B.WATER : B.AIR;
            // cold water freezes over, whatever the biome (oceans, rivers, lakes)
            // (generator 1: only snowy biomes, mountains excepted)
            if (id === B.WATER && y === SEA_LEVEL && (this.version >= 2 ? frozen : snowy && biome !== BIOME.MOUNTAINS)) id = B.ICE;
          } else if (y === 0 || (y === 1 && bedrockRng() < 0.5)) {
            id = B.BEDROCK;
          } else if (this.isCave(wx, y, wz, h, cc)) {
            // the deepest caves flood: lava from generator 5, water before
            // (generator 13: where the caves are wet, water stands in them
            // instead, up to its level; rock walls off the edge of the wet,
            // so lava and water never meet and no wall of water stands in
            // a dry tunnel)
            if (!v13 || cc.wet === 0) id = y <= 9 ? (v5 ? B.LAVA : B.WATER) : B.AIR;
            else if (y > cc.water) id = B.AIR;
            else id = cc.wet < 0.12 ? B.STONE : B.WATER;
          } else if (y === h) {
            // surface block
            if (col.pool) id = B.DIRT;   // swamp pool beds
            else if (v5 && h > 84 && (snowy || biome === BIOME.MOUNTAINS)) id = B.SNOW_BLOCK;   // snowfields on high peaks
            else if (y < (this.version >= 9 ? SEA_LEVEL : SEA_LEVEL - 1)) id = sandy ? B.SAND : (biome === BIOME.OCEAN ? B.GRAVEL : B.DIRT);   // (v9: no grass under water)
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
          const r = coordRng(this.featureSeed, wx, wz, 33)();
          if (r < 0.06 && h > 4 && (this.version < 9 || h < SEA_LEVEL)) blocks[blockIndex(x, h, z)] = B.CLAY;   // (v9: only under water)
        }
        if (v5) this.columnLife(blocks, x, z, wx, wz, h, biome, col, snowy);
      }
    }

    this.placeOres(blocks, cx, cz, heightMap);
    if (v13) this.decorateCaves13(blocks, cx, cz, heightMap, biomeMap);
    else if (this.version >= 2) this.decorateCaves(blocks, cx, cz, heightMap);
    placeFossil(this, blocks, cx, cz, heightMap, biomeMap[8 * CHUNK_Z + 8]);
    const plan = structurePlan(this, cx, cz);
    const entities = plan || this.version < 2 ? [] : placeDungeon(this, blocks, cx, cz, heightMap);
    this.decorate(blocks, cx, cz);
    if (plan) entities.push(...buildStructure(this, blocks, cx, cz));
    // generator 12: this chunk's slice of a village (and the facings of its doors and stairs)
    const holder = {};
    if (this.version >= 12) entities.push(...buildVillageSlice(this, blocks, cx, cz, holder));

    return { blocks, heightMap, biomeMap, entities, meta: holder.meta ?? null };
  }

  // Generator 5: things that live on one column (so they never cross a chunk
  // edge): kelp and seagrass underwater, lily pads on swamp pools, snow layers.
  columnLife(blocks, x, z, wx, wz, h, biome, col, snowy) {
    const r = colHash(wx * 3 + 7, wz - 11), r2 = colHash(wx - 5, wz * 7 + 3);
    const ground = blocks[blockIndex(x, h, z)];
    if (ground === B.AIR || ground === B.WATER || ground === B.LAVA) return;   // a cave mouth
    const depth = SEA_LEVEL - h;
    if (depth >= 2 && blocks[blockIndex(x, h + 1, z)] === B.WATER) {
      if (biome === BIOME.OCEAN && depth >= 5 && r < 0.07) {
        // a kelp stalk that stops short of the surface
        const len = 2 + Math.floor(r2 * (depth - 3));
        for (let y = h + 1; y <= h + len && y < SEA_LEVEL - 1; y++) blocks[blockIndex(x, y, z)] = B.KELP;
      } else if (r < 0.3 && (biome === BIOME.OCEAN || biome === BIOME.RIVER || col.pool)) {
        blocks[blockIndex(x, h + 1, z)] = B.SEAGRASS;
      }
    }
    // lily pads float on swamp pools
    if (col.pool && r2 < 0.14 && blocks[blockIndex(x, SEA_LEVEL, z)] === B.WATER) blocks[blockIndex(x, SEA_LEVEL + 1, z)] = B.LILY_PAD;
    // a blanket of snow on the tundra
    if (snowy && biome !== BIOME.MOUNTAINS && h >= SEA_LEVEL && ground === B.SNOWY_GRASS && r < 0.8 && h + 1 < CHUNK_Y) {
      blocks[blockIndex(x, h + 1, z)] = B.SNOW_LAYER;
    }
  }

  // Is the ground at a feature's spot real (not carved away by a cave mouth)?
  groundOk(wx, h, wz) {
    if (this.version < 2) return true;   // generator 1 didn't check
    return !this.isCave(wx, h, wz, h) && !this.isCave(wx, h - 1, wz, h);
  }

  // Mushrooms and mossy patches on cave floors (within this chunk only).
  decorateCaves(blocks, cx, cz, heightMap) {
    const rng = coordRng(this.featureSeed, cx, cz, 900);
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

  // Generator 13: cave floors and ceilings dressed, column by column (so
  // nothing reaches over a chunk edge): stalactites and stalagmites,
  // mushrooms, glowcaps deep down, and floors to suit the land above (moss
  // under the woods and swamps, ice under the snow, sand under the desert);
  // the lakes get beds of clay and gravel.
  decorateCaves13(blocks, cx, cz, heightMap, biomeMap) {
    for (let x = 0; x < CHUNK_X; x++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        const wx = cx * CHUNK_X + x, wz = cz * CHUNK_Z + z;
        const biome = biomeMap[x * CHUNK_Z + z];
        const floorOf = CAVE_FLOORS[biome] ?? 0;
        const base = blockIndex(x, 0, z);   // (a column's cells run on up from here)
        const top = heightMap[x * CHUNK_Z + z] - 3;
        // floors change in patches, not speckles; and the spikes crowd
        // together in some caves
        const patch = floorOf && this.caveShape.noise2(wx / 7 + 0.37, wz / 7 + 0.61) > -0.05;
        const spikes = this.caveShape.noise2(wx / 40 + 0.71, wz / 40 + 0.13) > 0.25 ? 4 : 1;
        for (let y = 7; y < top; y++) {
          const id = blocks[base + y];
          if (id !== B.AIR && id !== B.WATER) continue;
          const below = blocks[base + y - 1], above = blocks[base + y + 1];
          const r = colHash(wx * 31 + y * 7, wz * 17 - y * 13);
          if (id === B.WATER) {
            if (CAVE_ROCK.has(below) && y < SEA_LEVEL - 8) blocks[base + y - 1] = r < 0.3 ? B.CLAY : r < 0.65 ? B.GRAVEL : below;
            continue;
          }
          if (CAVE_ROCK.has(below)) {
            if (patch && below !== B.GRAVEL) blocks[base + y - 1] = floorOf;
            if (above !== B.AIR) continue;
            if (y < 30 && r < 0.03) blocks[base + y] = B.GLOWCAP;
            else if (r < 0.02) { if (floorOf !== B.ICE && y >= 30) blocks[base + y] = r < 0.01 ? B.MUSHROOM_BROWN : B.MUSHROOM_RED; }
            else if (r < 0.02 + 0.025 * spikes) blocks[base + y] = B.STALAGMITE;
          } else if (CAVE_ROCK.has(above) && blocks[base + y - 1] === B.AIR && r < 0.04 * spikes) {
            blocks[base + y] = B.STALACTITE;
          }
        }
      }
    }
  }

  placeOres(blocks, cx, cz, heightMap) {
    // [block, attempts per chunk, blob size, minY, maxY]
    // Generator 9 picks each vein's height under the ground at its column,
    // rather than anywhere up to maxY (most of which was sky, so coal all but
    // vanished above y 48 and mountains had little); counts are retuned so the
    // totals stay much the same, with diamonds a little scarcer.
    const v9 = this.version >= 9;
    const ORES = v9 ? [
      [B.COAL_ORE, 6, 10, 6, 110],
      [B.IRON_ORE, 8, 6, 4, 64],
      [B.GOLD_ORE, 3, 5, 4, 30],
      [B.REDSTONE_ORE, 5, 6, 4, 16],
      [B.DIAMOND_ORE, 1, 6, 4, 14],
      [B.GRAVEL, 6, 14, 8, 70],
      [B.DIRT, 8, 14, 8, 80],
    ] : [
      [B.COAL_ORE, 14, 10, 6, 96],
      [B.IRON_ORE, 10, 6, 4, 54],
      [B.GOLD_ORE, 3, 5, 4, 30],
      [B.REDSTONE_ORE, 6, 6, 4, 16],
      [B.DIAMOND_ORE, 2, 5, 4, 14],
      [B.GRAVEL, 6, 14, 8, 60],
      [B.DIRT, 8, 14, 8, 70],
    ];
    if (this.version >= 10) { this.placeOresV10(blocks, cx, cz, ORES); return; }
    for (let o = 0; o < ORES.length; o++) {
      const [id, attempts, size, minY, maxY] = ORES[o];
      const rng = coordRng(this.featureSeed, cx, cz, 100 + o);
      for (let a = 0; a < attempts; a++) {
        let x = (rng() * CHUNK_X) | 0;
        let y, z;
        if (v9) {
          z = (rng() * CHUNK_Z) | 0;
          const top = Math.min(maxY, heightMap[x * CHUNK_Z + z] - 3);
          if (top <= minY) { rng(); continue; }
          y = minY + ((rng() * (top - minY)) | 0);
        } else {
          // older generators: the original draw order (x, y, z), so existing
          // worlds keep their ores exactly where they were
          y = minY + ((rng() * (maxY - minY)) | 0);
          z = (rng() * CHUNK_Z) | 0;
        }
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

  // Generator 10: the same veins, but each one is drawn whole by every chunk
  // it reaches (from its own chunk's seed, its start height from the ground
  // there), so a vein running over a border carries on instead of stopping
  // in a straight line.
  placeOresV10(blocks, cx, cz, ORES) {
    for (let o = 0; o < ORES.length; o++) {
      const [id, attempts, size, minY, maxY] = ORES[o];
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
        for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
          const rng = coordRng(this.featureSeed, ncx, ncz, 100 + o);
          for (let a = 0; a < attempts; a++) {
            let x = ((rng() * CHUNK_X) | 0) + (ncx - cx) * CHUNK_X;
            let z = ((rng() * CHUNK_Z) | 0) + (ncz - cz) * CHUNK_Z;
            const top = Math.min(maxY, Math.floor(this.columnAt(cx * CHUNK_X + x, cz * CHUNK_Z + z).h) - 3);
            if (top <= minY) { rng(); continue; }
            let y = minY + ((rng() * (top - minY)) | 0);
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
    return this.version >= 4 ? this.chunkFeaturesV4(cx, cz) : this.chunkFeaturesV1(cx, cz);
  }

  // Generator 4+: decoration decided per 8x8 quadrant (by that quadrant's own
  // biome) and every feature checks the biome under it, so river banks get
  // trees and grass, and beaches/rivers don't sprout flowers.
  chunkFeaturesV4(cx, cz) {
    const rng = coordRng(this.featureSeed, cx, cz, 778);
    const features = [];
    const LUSH = new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.SWAMP, BIOME.MOUNTAINS, BIOME.SNOWY, BIOME.SNOWY_FOREST]);
    const count = (n) => Math.floor(n / 4 + rng());   // a quarter of a chunk's worth, stochastically rounded
    for (let q = 0; q < 4; q++) {
      const qx = cx * CHUNK_X + (q & 1) * 8, qz = cz * CHUNK_Z + (q >> 1) * 8;
      const biome = this.biomeAt(qx + 4, qz + 4);
      // a column in this quadrant with ground of the right biome, or null
      // (above the sea, or for beach palms level with it)
      const spot = (ok, minH = SEA_LEVEL + 1) => {
        const wx = qx + ((rng() * 8) | 0), wz = qz + ((rng() * 8) | 0);
        const col = this.columnAt(wx, wz);
        const h = Math.floor(col.h);
        if (h < minH || !ok(this.biomeOf(col)) || !this.groundOk(wx, h, wz)) return null;
        // v9: no trees rooted in bare mountain rock (it's grass or snow they need)
        if (this.version >= 9 && this.biomeOf(col) === BIOME.MOUNTAINS && h > 68 && h <= 84 && !(col.t < FROZEN) && h <= 78) return null;
        return { wx, wz, h };
      };

      let trees = 0, treeKind = 'oak';
      switch (biome) {
        case BIOME.FOREST: trees = count(7.5); break;
        case BIOME.BIRCH_FOREST: trees = count(6.5); treeKind = 'birch'; break;
        case BIOME.SNOWY_FOREST: trees = count(5); treeKind = 'spruce'; break;
        case BIOME.PLAINS: trees = count(0.3); break;
        case BIOME.SWAMP: trees = count(2.5); break;
        case BIOME.MOUNTAINS: trees = count(1.2); treeKind = 'spruce'; break;
        case BIOME.SNOWY: trees = count(0.35); treeKind = 'spruce'; break;
        case BIOME.RIVER: case BIOME.BEACH: trees = count(0.6); break;   // the odd tree on the bank
      }
      // v9: coconut palms along warm beaches
      if (this.version >= 9 && biome === BIOME.BEACH && this.climateAt(qx + 4, qz + 4).t > 0.5) {
        for (let i = count(4); i > 0; i--) {
          const s = spot((b) => b === BIOME.BEACH, SEA_LEVEL);   // beach sand lies level with the sea
          if (s) features.push({ type: 'tree', kind: 'palm', wx: s.wx, wy: s.h + 1, wz: s.wz, size: 4 + ((rng() * 3) | 0), rng: coordRng(this.featureSeed, s.wx, s.wz, 556) });
        }
      }
      for (let i = 0; i < trees; i++) {
        const s = spot((b) => LUSH.has(b));
        if (!s) continue;
        const kind = treeKind === 'oak' && rng() < 0.12 ? 'birch' : treeKind;
        features.push({ type: 'tree', kind, wx: s.wx, wy: s.h + 1, wz: s.wz, size: 4 + ((rng() * 3) | 0), rng: coordRng(this.featureSeed, s.wx, s.wz, 555) });
      }

      if (biome === BIOME.DESERT) {
        for (let i = count(4); i > 0; i--) {
          const s = spot((b) => b === BIOME.DESERT);
          if (s) features.push({ type: 'cactus', wx: s.wx, wy: s.h + 1, wz: s.wz, size: 1 + ((rng() * 3) | 0) });
        }
        for (let i = count(2); i > 0; i--) {
          const s = spot((b) => b === BIOME.DESERT);
          if (s) features.push({ type: 'plant', block: B.DEAD_BUSH, wx: s.wx, wy: s.h + 1, wz: s.wz });
        }
      }

      // grass and flowers: only on grassy biomes
      const grass = { [BIOME.PLAINS]: 24, [BIOME.FOREST]: 12, [BIOME.BIRCH_FOREST]: 12, [BIOME.SWAMP]: 10, [BIOME.RIVER]: 8, [BIOME.MOUNTAINS]: 4 }[biome] ?? 0;
      const GRASSY = new Set([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.SWAMP, BIOME.MOUNTAINS]);
      for (let i = count(grass); i > 0; i--) {
        const s = spot((b) => GRASSY.has(b));
        if (!s) continue;
        const r = rng();
        features.push({ type: 'plant', block: r < 0.08 ? B.DANDELION : r < 0.16 ? B.POPPY : B.TALL_GRASS, wx: s.wx, wy: s.h + 1, wz: s.wz });
      }
      if (biome === BIOME.SWAMP) {
        for (let i = count(4); i > 0; i--) {
          const s = spot((b) => b === BIOME.SWAMP);
          if (s) features.push({ type: 'plant', block: rng() < 0.5 ? B.MUSHROOM_BROWN : B.MUSHROOM_RED, wx: s.wx, wy: s.h + 1, wz: s.wz });
        }
      }
      if ((biome === BIOME.PLAINS || biome === BIOME.FOREST) && rng() < 0.015) {
        const s = spot((b) => b === BIOME.PLAINS || b === BIOME.FOREST);
        if (s) features.push({ type: 'plant', block: B.PUMPKIN, wx: s.wx, wy: s.h + 1, wz: s.wz });
      }
      // mossy boulders on mountains, tundra and the odd plain
      const boulders = { [BIOME.MOUNTAINS]: 0.5, [BIOME.SNOWY]: 0.35, [BIOME.PLAINS]: 0.05, [BIOME.SNOWY_FOREST]: 0.15 }[biome] ?? 0;
      if (rng() < boulders) {
        const s = spot((b) => b !== BIOME.RIVER && b !== BIOME.BEACH && b !== BIOME.OCEAN);
        if (s) features.push({ type: 'boulder', wx: s.wx, wy: s.h, wz: s.wz, size: rng() < 0.3 ? 2 : 1, rng: coordRng(this.featureSeed, s.wx, s.wz, 556) });
      }
      // sugar cane wherever low ground touches water: rivers, swamps, beaches, lakes
      for (let i = count(biome === BIOME.RIVER || biome === BIOME.SWAMP ? 24 : biome === BIOME.BEACH || biome === BIOME.PLAINS ? 10 : 0); i > 0; i--) {
        const wx = qx + ((rng() * 8) | 0), wz = qz + ((rng() * 8) | 0);
        const h = Math.floor(this.columnAt(wx, wz).h);
        if (h < SEA_LEVEL || h > SEA_LEVEL + 2 || !this.groundOk(wx, h, wz)) continue;
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.columnAt(wx + dx, wz + dz).h < SEA_LEVEL);
        if (wet) features.push({ type: 'cane', wx, wy: h + 1, wz, size: 2 + ((rng() * 2) | 0) });
      }
      if (this.version >= 10) {
        // flower meadows: patches of the plains (and the odd glade) thick with flowers
        const meadow = this.detail.noise2((qx + 4) / 48 + this.off.d[0], (qz + 4) / 48 + this.off.d[1]);
        if ((biome === BIOME.PLAINS || biome === BIOME.BIRCH_FOREST) && meadow > 0.25) {
          const pick = rng() < 0.5 ? B.DANDELION : B.POPPY;
          for (let i = count(28 * Math.min(1, (meadow - 0.25) * 4)); i > 0; i--) {
            const s = spot((b) => b === BIOME.PLAINS || b === BIOME.BIRCH_FOREST);
            if (s) features.push({ type: 'plant', block: rng() < 0.7 ? pick : B.TALL_GRASS, wx: s.wx, wy: s.h + 1, wz: s.wz });
          }
        }
        // bushes: a stub of trunk in a ball of leaves, under the trees and out on the plains
        const bushes = { [BIOME.FOREST]: 3, [BIOME.BIRCH_FOREST]: 2, [BIOME.PLAINS]: 0.8, [BIOME.SWAMP]: 1.5 }[biome] ?? 0;
        for (let i = count(bushes); i > 0; i--) {
          const s = spot((b) => LUSH.has(b));
          if (s) features.push({ type: 'bush', wx: s.wx, wy: s.h + 1, wz: s.wz, rng: coordRng(this.featureSeed, s.wx, s.wz, 557) });
        }
      }
    }
    if (this.version >= 11) this.featuresV11(cx, cz, features);
    return features;
  }

  // Generator 11: cornflowers out on the plains, berry bushes in the snowy
  // forests (and the odd one at the edge of the woods), wild rice on swamp
  // and river banks. Drawn from a stream of their own after everything
  // else, so the rest of the land is just as generator 10 made it.
  featuresV11(cx, cz, features) {
    const rng = coordRng(this.featureSeed, cx, cz, 1111);
    const count = (n) => Math.floor(n / 4 + rng());
    for (let q = 0; q < 4; q++) {
      const qx = cx * CHUNK_X + (q & 1) * 8, qz = cz * CHUNK_Z + (q >> 1) * 8;
      const biome = this.biomeAt(qx + 4, qz + 4);
      const spot = (ok, lo = SEA_LEVEL + 1, hi = 255) => {
        const wx = qx + ((rng() * 8) | 0), wz = qz + ((rng() * 8) | 0);
        const col = this.columnAt(wx, wz);
        const h = Math.floor(col.h);
        if (h < lo || h > hi || !ok(this.biomeOf(col)) || !this.groundOk(wx, h, wz)) return null;
        return { wx, wz, h };
      };
      const cornflowers = { [BIOME.PLAINS]: 5, [BIOME.BIRCH_FOREST]: 2, [BIOME.FOREST]: 0.6 }[biome] ?? 0;
      for (let i = count(cornflowers); i > 0; i--) {
        const s = spot((b) => b === BIOME.PLAINS || b === BIOME.BIRCH_FOREST || b === BIOME.FOREST);
        if (s) features.push({ type: 'rooted', block: B.CORNFLOWER, wx: s.wx, wy: s.h + 1, wz: s.wz });
      }
      const berries = { [BIOME.SNOWY_FOREST]: 3, [BIOME.SNOWY]: 0.8, [BIOME.FOREST]: 0.5 }[biome] ?? 0;
      for (let i = count(berries); i > 0; i--) {
        const s = spot((b) => b === BIOME.SNOWY_FOREST || b === BIOME.SNOWY || b === BIOME.FOREST);
        if (s) features.push({ type: 'rooted', block: B.BERRY_BUSH_3, wx: s.wx, wy: s.h + 1, wz: s.wz });
      }
      // wild rice where the bank meets the water
      const rice = { [BIOME.SWAMP]: 10, [BIOME.RIVER]: 4 }[biome] ?? 0;
      for (let i = count(rice); i > 0; i--) {
        const s = spot((b) => b === BIOME.SWAMP || b === BIOME.RIVER, SEA_LEVEL, SEA_LEVEL + 1);
        if (!s) continue;
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.columnAt(s.wx + dx, s.wz + dz).h < SEA_LEVEL);
        if (wet) features.push({ type: 'rooted', block: B.RICE_3, wx: s.wx, wy: s.h + 1, wz: s.wz });
      }
    }
  }

  chunkFeaturesV1(cx, cz) {
    const rng = coordRng(this.featureSeed, cx, cz, 777);
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
      features.push({ type: 'tree', kind, wx, wy: h + 1, wz, size: 4 + ((rng() * 3) | 0), rng: coordRng(this.featureSeed, wx, wz, 555) });
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
    if (nearStructure(this, f.wx, f.wz, f.type === 'tree' || f.type === 'boulder' || f.type === 'bush' ? 3 : 0)) return;
    // (returns false if the cell was taken; generator 13 lets nothing
    // overwrite cane or cactus, which would leave the rest of a stalk hanging)
    const v13 = this.version >= 13;
    const put = (wx, wy, wz, id, onlyAir = true) => {
      const x = wx - cx * CHUNK_X;
      const z = wz - cz * CHUNK_Z;
      if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || wy < 0 || wy >= CHUNK_Y) return true;
      const idx = blockIndex(x, wy, z);
      if (onlyAir && blocks[idx] !== B.AIR) return false;
      if (v13 && (blocks[idx] === B.SUGAR_CANE || blocks[idx] === B.CACTUS)) return false;
      blocks[idx] = id;
      return true;
    };

    switch (f.type) {
      case 'tree': this.buildTree(put, f); break;
      // (a stalk stops where something's in the way: generator 13; older
      // ones stacked the rest on over a snow layer)
      case 'cactus':
        for (let i = 0; i < f.size; i++) if (!put(f.wx, f.wy + i, f.wz, B.CACTUS) && v13) break;
        break;
      case 'cane':
        for (let i = 0; i < f.size; i++) if (!put(f.wx, f.wy + i, f.wz, B.SUGAR_CANE) && v13) break;
        break;
      case 'plant':
        put(f.wx, f.wy, f.wz, f.block);
        break;
      case 'rooted': {
        // (generator 11) a plant that needs soil under it: grass or dirt, not sand or stone
        const x = f.wx - cx * CHUNK_X, z = f.wz - cz * CHUNK_Z;
        if (x < 0 || x >= CHUNK_X || z < 0 || z >= CHUNK_Z || f.wy < 1 || f.wy >= CHUNK_Y) break;
        const below = blocks[blockIndex(x, f.wy - 1, z)];
        if (below === B.GRASS || below === B.DIRT || below === B.SNOWY_GRASS) put(f.wx, f.wy, f.wz, f.block);
        break;
      }
      case 'bush': {
        // (generator 10) a log stub with a rounded clump of leaves over it
        put(f.wx, f.wy, f.wz, B.OAK_LOG);
        for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(dx) + Math.abs(dz) + dy > 2 || (dx && dz && f.rng() < 0.6)) continue;
          put(f.wx + dx, f.wy + dy, f.wz + dz, B.OAK_LEAVES);
        }
        break;
      }
      case 'boulder': {
        // a lumpy ball of (mossy) cobblestone half sunk into the ground
        const r = f.size;
        for (let dx = -r; dx <= r; dx++) for (let dy = -1; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r + 0.6 + f.rng() * 0.8) continue;
          put(f.wx + dx, f.wy + dy, f.wz + dz, f.rng() < 0.45 ? B.MOSSY_COBBLE : B.COBBLESTONE, false);
        }
        break;
      }
    }
  }

  buildTree(put, f) {
    const { kind, wx, wy, wz } = f;
    const rng = f.rng ?? coordRng(this.featureSeed, wx, wz, 555);
    if (kind === 'palm') {
      // a ringed trunk leaning gently one way, a star of drooping fronds,
      // and a few coconuts tucked under them
      const h = f.size + 2;
      const lean = [[1, 0], [-1, 0], [0, 1], [0, -1]][(rng() * 4) | 0];
      let x = wx, z = wz;
      for (let i = 0; i < h; i++) {
        // a step over: logs side by side at that height, so the trunk stays joined
        if (i >= 3 && i % 3 === 0 && rng() < 0.7) { put(x, wy + i, z, B.PALM_LOG, false); x += lean[0]; z += lean[1]; }
        put(x, wy + i, z, B.PALM_LOG, false);
      }
      const top = wy + h;
      put(x, top, z, B.PALM_LEAVES);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // long fronds: out along the top, then down at the tip
        put(x + dx, top, z + dz, B.PALM_LEAVES);
        put(x + dx * 2, top, z + dz * 2, B.PALM_LEAVES);
        put(x + dx * 3, top - 1, z + dz * 3, B.PALM_LEAVES);
        if (rng() < 0.6) put(x + dx * 4, top - 2, z + dz * 4, B.PALM_LEAVES);
      }
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        put(x + dx, top, z + dz, B.PALM_LEAVES);
        put(x + dx * 2, top - 1, z + dz * 2, B.PALM_LEAVES);
      }
      // coconuts hang beside the trunk, under the crown
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const n = 1 + ((rng() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const [dx, dz] = spots.splice((rng() * spots.length) | 0, 1)[0];
        put(x + dx, top - 1, z + dz, B.COCONUT);
      }
      return;
    }
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
