// Villages (generator 12): a square with a well, roads out from it, and
// houses, a smithy, a kitchen, a library, fields and a stable along the
// roads, in the style of the biome they stand in.
//
// A village is far bigger than a chunk, so it's planned once from the seed
// alone (where it stands, its roads, which building goes on which plot and
// at what floor height) and every chunk builds just its own slice of it,
// column by column, the way trees cross chunk borders. Nothing a chunk
// builds reads another chunk's blocks, so a village comes out the same
// whatever order its chunks load in.
//
// The world is cut into regions REGION chunks a side; each has at most one
// village, kept well in from the region's edges so two never touch.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, blockIndex } from '../core/constants.js';
import { coordRng } from '../core/rng.js';
import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { makeStack } from '../items/items.js';

export const REGION = 24;                 // chunks
const CHANCE = 0.7;                       // of a region trying for a village at all
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // 0 -z, 1 +x, 2 +z, 3 -x (door and stair facings use the same)
const SQUARE = 5;                         // the square: 11 x 11 round the well
const GROUND = new Set([B.STONE, B.DIRT, B.GRASS, B.SAND, B.SANDSTONE, B.GRAVEL, B.SNOWY_GRASS, B.CLAY, B.SNOW_BLOCK,
  B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.REDSTONE_ORE, B.BEDROCK, B.COBBLESTONE, B.MOSSY_COBBLE, B.DIRT_PATH]);

// ---- styles, by biome ----

const STYLES = {
  oak: { wall: B.OAK_PLANKS, post: B.OAK_LOG, floor: B.OAK_PLANKS, base: B.COBBLESTONE, roof: B.OAK_STAIRS, ridge: B.OAK_SLAB, road: B.DIRT_PATH, plaza: B.DIRT_PATH, gable: true },
  birch: { wall: B.BIRCH_PLANKS, post: B.BIRCH_LOG, floor: B.BIRCH_PLANKS, base: B.COBBLESTONE, roof: B.OAK_STAIRS, ridge: B.OAK_SLAB, road: B.DIRT_PATH, plaza: B.GRAVEL, gable: true },
  spruce: { wall: B.SPRUCE_PLANKS, post: B.SPRUCE_LOG, floor: B.SPRUCE_PLANKS, base: B.COBBLESTONE, roof: B.OAK_STAIRS, ridge: B.OAK_SLAB, road: B.DIRT_PATH, plaza: B.COBBLESTONE, gable: true },
  sand: { wall: B.SANDSTONE, post: B.CHISELED_SANDSTONE, floor: B.SANDSTONE, base: B.SANDSTONE, roof: B.SANDSTONE, ridge: B.SANDSTONE, road: B.SANDSTONE, plaza: B.SANDSTONE, gable: false },
};
// biome id (worldgen BIOME) -> style
const BIOME_STYLE = { 2: 'oak', 3: 'oak', 4: 'birch', 5: 'sand', 6: 'spruce', 7: 'spruce' };
const BAD_GROUND = new Set([0, 1, 8, 9, 10]);   // ocean, beach, swamp, mountains, river

// ---- names ----

const NAME_PARTS = {
  oak: [['Ash', 'Oak', 'Elm', 'Hay', 'Mill', 'Brook', 'Thorn', 'Wheat', 'Fern', 'Bram'], ['ford', 'field', 'ley', 'stead', 'wick', 'ton', 'bury', 'well', 'dale']],
  birch: [['Birch', 'White', 'Silver', 'Glen', 'Fair', 'Lark', 'Hollin'], ['wood', 'holt', 'mere', 'combe', 'hurst', 'ley', 'ton']],
  spruce: [['Pine', 'Frost', 'Snow', 'Fir', 'Winter', 'Ice', 'Elk'], ['combe', 'hold', 'fell', 'haven', 'rest', 'wick', 'gard']],
  sand: [['Sand', 'Sun', 'Dune', 'Palm', 'Amber', 'Dry', 'Gold'], ['well', 'spring', 'rest', 'stone', 'gate', 'reach', 'haven']],
};

// ---- loot ----

const LOOT = {
  house: [[I.BREAD, 1, 4, 0.6], [I.APPLE, 1, 3, 0.4], [I.WHEAT_SEEDS, 2, 6, 0.4], [I.CARROT, 1, 3, 0.3], [I.POTATO, 1, 3, 0.3], [I.STICK, 2, 6, 0.3], [B.TORCH, 2, 5, 0.3], [I.COIN, 2, 6, 0.25], [I.STRING, 1, 3, 0.15]],
  smithy: [[I.IRON_INGOT, 1, 5, 0.6], [I.COAL, 2, 8, 0.6], [I.GOLD_INGOT, 1, 3, 0.25], [I.IRON_PICKAXE, 1, 1, 0.2], [I.IRON_SWORD, 1, 1, 0.15], [I.IRON_HELMET, 1, 1, 0.12], [I.SADDLE, 1, 1, 0.12], [I.IRON_HORSE_ARMOR, 1, 1, 0.06], [I.FLINT, 1, 3, 0.3], [I.BUCKET, 1, 1, 0.2]],
  kitchen: [[I.BREAD, 2, 5, 0.6], [I.BOWL, 2, 4, 0.5], [I.BAKED_POTATO, 1, 4, 0.4], [I.EGG, 1, 4, 0.4], [I.SUGAR, 1, 3, 0.3], [I.CHEESE, 1, 2, 0.2], [I.BUTTER, 1, 2, 0.2], [I.COOKIE, 2, 6, 0.3], [I.HONEY_BOWL, 1, 1, 0.1]],
  library: [[I.BOOK, 1, 3, 0.6], [I.PAPER, 2, 8, 0.6], [I.FEATHER, 1, 4, 0.4], [I.NAME_TAG, 1, 1, 0.2], [I.LEDGER, 1, 1, 0.1], [B.CANDLE, 1, 3, 0.3]],
  stable: [[I.WHEAT, 3, 9, 0.6], [I.LEAD, 1, 2, 0.4], [I.SADDLE, 1, 1, 0.2], [I.APPLE, 1, 3, 0.3], [I.LEATHER_HORSE_ARMOR, 1, 1, 0.1], [I.GOLDEN_CARROT, 1, 1, 0.06]],
};
function lootChest(rng, table) {
  const slots = new Array(27).fill(null);
  for (const [id, lo, hi, chance] of table) {
    if (rng() > chance) continue;
    let i = (rng() * 27) | 0;
    while (slots[i]) i = (i + 1) % 27;
    slots[i] = makeStack(id, lo + ((rng() * (hi - lo + 1)) | 0));
  }
  if (slots.every((s) => !s)) slots[13] = makeStack(table[0][0], table[0][1]);
  return { kind: 'chest', slots };
}

// ---- buildings: [name, width (along the road), depth, weight] ----
// Each is drawn with its front (the door) on the local z = 0 side, facing
// local -z (toward the road), then turned into place.
const BUILDINGS = [
  ['house', 5, 6, 5], ['bighouse', 7, 7, 3], ['smithy', 7, 6, 1.4], ['kitchen', 7, 6, 1.2],   // (odd widths: the door's in the middle)
  ['library', 7, 6, 0.9], ['farm', 9, 7, 2.6], ['stable', 9, 8, 1],
];
const pickBuilding = (rng) => {
  const total = BUILDINGS.reduce((a, b) => a + b[3], 0);
  let r = rng() * total;
  for (const b of BUILDINGS) if ((r -= b[3]) < 0) return b;
  return BUILDINGS[0];
};

// ---- the plan ----

// The village of region (rx, rz), or null: a pure function of the seed,
// cached per generator.
export function villageIn(gen, rx, rz) {
  if (gen.version < 12) return null;
  const cache = gen.villageCache ?? (gen.villageCache = new Map());
  const key = `${rx},${rz}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 256) cache.clear();
  const v = planVillage(gen, rx, rz);
  cache.set(key, v);
  return v;
}

// the village (if any) whose region holds this world column
export function villageAt(gen, wx, wz) {
  if (gen.version < 12) return null;
  const R = REGION * CHUNK_X;
  return villageIn(gen, Math.floor(wx / R), Math.floor(wz / R));
}

// Is (wx, wz) on or within `margin` of anything a village builds?
export function inVillage(gen, wx, wz, margin = 0) {
  const v = villageAt(gen, wx, wz);
  if (!v || wx < v.bounds.x0 - margin || wx > v.bounds.x1 + margin || wz < v.bounds.z0 - margin || wz > v.bounds.z1 + margin) return false;
  return v.boxes.some((b) => wx >= b.x0 - margin && wx <= b.x1 + margin && wz >= b.z0 - margin && wz <= b.z1 + margin);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function planVillage(gen, rx, rz) {
  const rng = coordRng(gen.seed, rx, rz, 7171);
  if (rng() > CHANCE) return null;
  const ccx = rx * REGION + 6 + Math.floor(rng() * (REGION - 12));
  const ccz = rz * REGION + 6 + Math.floor(rng() * (REGION - 12));
  const X = ccx * CHUNK_X + 8, Z = ccz * CHUNK_Z + 8;
  const ground = (x, z) => {
    const c = gen.columnAt(x, z);
    return { h: Math.floor(c.h), biome: gen.biomeOf(c) };
  };
  const centre = ground(X, Z);
  const styleKey = BIOME_STYLE[centre.biome];
  if (!styleKey) return null;
  // mostly dry, fairly level land all round, and a flat heart
  let land = 0;
  const core = [];
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const g = ground(X + i * 8, Z + j * 8);
      const ok = g.h > SEA_LEVEL + 1 && !BAD_GROUND.has(g.biome);
      if (ok) land++;
      if (Math.abs(i) <= 1 && Math.abs(j) <= 1) { if (!ok) return null; core.push(g.h); }
    }
  }
  if (land < 60 || Math.max(...core) - Math.min(...core) > 5) return null;
  const y = median(core);
  if (y + 20 >= CHUNK_Y) return null;

  const boxes = [];
  const overlaps = (b, m = 1) => boxes.some((o) => b.x0 - m <= o.x1 && b.x1 + m >= o.x0 && b.z0 - m <= o.z1 && b.z1 + m >= o.z0);
  const pieces = [];
  const square = { kind: 'square', x0: X - SQUARE, z0: Z - SQUARE, x1: X + SQUARE, z1: Z + SQUARE, y };
  pieces.push(square); boxes.push(square);

  // roads: two to four, out from the square's sides
  const dirs = [0, 1, 2, 3].filter(() => rng() < 0.85);
  while (dirs.length < 2) { const d = (rng() * 4) | 0; if (!dirs.includes(d)) dirs.push(d); }
  for (const d of dirs) {
    const [dx, dz] = DIRS[d], [px, pz] = DIRS[(d + 1) % 4];
    const want = 22 + Math.floor(rng() * 20);
    // level across, and climbing or dropping at most a block a step (it
    // cuts into rises and is built up over dips rather than stair-stepping
    // over every bump)
    const cells = [];
    let len = 0, prev = y;
    for (let s = SQUARE + 1; s <= SQUARE + want; s++) {
      const row = [];
      for (let w = -1; w <= 1; w++) {
        const x = X + dx * s + px * w, z = Z + dz * s + pz * w;
        const g = ground(x, z);
        if (g.h <= SEA_LEVEL || Math.abs(g.h - y) > 10) { row.length = 0; break; }
        row.push([x, z, g.h]);
      }
      if (!row.length) break;
      const ry = Math.max(prev - 1, Math.min(prev + 1, median(row.map((c) => c[2]))));
      for (const c of row) cells.push([c[0], c[1], ry]);
      prev = ry;
      len = s;
    }
    if (len < SQUARE + 8) continue;
    const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
    const road = { kind: 'road', d, len, cells, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    pieces.push(road); boxes.push(road);
  }
  const roads = pieces.filter((p) => p.kind === 'road');
  if (!roads.length) return null;

  // plots along the roads, on alternate sides, doors facing the road
  for (const road of roads) {
    const d = road.d, [dx, dz] = DIRS[d];
    let side = rng() < 0.5 ? 1 : -1;
    for (let s = SQUARE + 4; s < road.len - 2;) {
      const [name, w, depth] = pickBuilding(rng);
      const n = side > 0 ? (d + 1) % 4 : (d + 3) % 4;   // out from the road, toward the plot
      const [nx, nz] = DIRS[n];
      const along0 = s, along1 = s + w - 1;
      const at = (along, off) => [X + dx * along + nx * off, Z + dz * along + nz * off];
      const corners = [at(along0, 3), at(along1, 3), at(along0, 2 + depth), at(along1, 2 + depth)];
      const box = { x0: Math.min(...corners.map((c) => c[0])), x1: Math.max(...corners.map((c) => c[0])), z0: Math.min(...corners.map((c) => c[1])), z1: Math.max(...corners.map((c) => c[1])) };
      const hs = [...corners, at(s + (w >> 1), 3 + (depth >> 1))].map(([x, z]) => ground(x, z).h);
      const fits = hs.every((h) => h > SEA_LEVEL) && Math.max(...hs) - Math.min(...hs) <= 3 && !overlaps(box);
      if (fits) {
        const door = at(s + (w >> 1), 2);   // the step between the road and the door
        // the floor at the step's ground if that's higher (within reason), so
        // the step out to the road is level with the door, not a trench
        const floor = Math.min(Math.max(...hs) + 1, Math.max(median(hs), ground(door[0], door[1]).h));
        const plot = { kind: 'plot', name, ...box, y: floor, w, depth, rot: (n + 2) % 4, door, seed: (rng() * 2 ** 31) | 0 };
        pieces.push(plot); boxes.push(plot, { x0: door[0], x1: door[0], z0: door[1], z1: door[1] });
        s += w + 2 + Math.floor(rng() * 3);
      } else s += 3;
      side = -side;
    }
    // lamps along the road, every dozen blocks, just off its edge
    for (let s = SQUARE + 6; s < road.len; s += 12) {
      const [x, z] = [X + dx * s + DIRS[(d + 1) % 4][0] * 2, Z + dz * s + DIRS[(d + 1) % 4][1] * 2];
      const lamp = { kind: 'lamp', x0: x, x1: x, z0: z, z1: z, y: ground(x, z).h };
      const underEaves = pieces.some((q) => q.kind === 'plot' && x >= q.x0 - 1 && x <= q.x1 + 1 && z >= q.z0 - 1 && z <= q.z1 + 1);
      if (lamp.y > SEA_LEVEL && !overlaps(lamp, 0) && !underEaves) { pieces.push(lamp); boxes.push(lamp); }
    }
  }
  const [a, b] = NAME_PARTS[styleKey];
  const name = a[(rng() * a.length) | 0] + b[(rng() * b.length) | 0];
  const bounds = { x0: Math.min(...boxes.map((p) => p.x0)) - 1, x1: Math.max(...boxes.map((p) => p.x1)) + 1, z0: Math.min(...boxes.map((p) => p.z0)) - 1, z1: Math.max(...boxes.map((p) => p.z1)) + 1 };   // (1: eaves)
  return { id: `${rx},${rz}`, name, style: styleKey, x: X, z: Z, y, bounds, pieces, boxes };
}

// ---- building a chunk's slice ----

// Build whatever part of a village falls in chunk (cx, cz). Returns
// [index, entity] pairs; writes orientations into `meta` (a Uint8Array the
// size of the chunk, made on first use: returned via the holder).
export function buildVillageSlice(gen, blocks, cx, cz, holder) {
  const out = [];
  const bx0 = cx * CHUNK_X, bz0 = cz * CHUNK_Z, bx1 = bx0 + CHUNK_X - 1, bz1 = bz0 + CHUNK_Z - 1;
  const v = villageAt(gen, bx0 + 8, bz0 + 8);
  if (!v || v.bounds.x0 > bx1 || v.bounds.x1 < bx0 || v.bounds.z0 > bz1 || v.bounds.z1 < bz0) return out;
  const S = STYLES[v.style];
  const inside = (x, z) => x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1;
  const set = (x, y, z, id, meta = 0) => {
    if (!inside(x, z) || y < 1 || y >= CHUNK_Y) return -1;
    const idx = blockIndex(x - bx0, y, z - bz0);
    blocks[idx] = id;
    if (meta || holder.meta) (holder.meta ??= new Uint8Array(blocks.length))[idx] = meta;
    return idx;
  };
  const get = (x, y, z) => blocks[blockIndex(x - bx0, y, z - bz0)];
  // a column brought to `y`: earth (or the style's footing) under it down
  // to the ground, `top` at y, air above up to y + clear
  const column = (x, z, y, top, fill, clear) => {
    if (!inside(x, z)) return;
    for (let yy = y - 1; yy > y - 8 && yy > 1; yy--) { if (GROUND.has(get(x, yy, z))) break; set(x, yy, z, fill); }
    set(x, y, z, top);
    for (let yy = y + 1; yy <= y + clear && yy < CHUNK_Y; yy++) set(x, yy, z, B.AIR);
  };
  const earth = v.style === 'sand' ? B.SAND : B.DIRT;
  const touches = (p, m = 0) => !(p.x0 - m > bx1 || p.x1 + m < bx0 || p.z0 - m > bz1 || p.z1 + m < bz0);

  for (const p of v.pieces) {
    if (p.kind === 'road') {
      for (const [x, z, h] of p.cells) {
        if (!inside(x, z)) continue;
        column(x, z, h, S.road, earth, 4);
      }
    } else if (p.kind === 'lamp') {
      if (!inside(p.x0, p.z0)) continue;
      column(p.x0, p.z0, p.y, get(p.x0, p.y, p.z0) === B.AIR ? earth : get(p.x0, p.y, p.z0), earth, 3);   // (3: not into an eave over it)
      set(p.x0, p.y + 1, p.z0, v.style === 'sand' ? B.SANDSTONE : B.OAK_FENCE);
      set(p.x0, p.y + 2, p.z0, v.style === 'sand' ? B.SANDSTONE : B.OAK_FENCE);
      set(p.x0, p.y + 3, p.z0, B.LANTERN);
    } else if (p.kind === 'square' && touches(p)) {
      buildSquare(v, S, p, set, column, earth);
    } else if (p.kind === 'plot' && (touches(p, 1) || inside(p.door[0], p.door[1]))) {   // (1: the roof's eaves overhang the plot)
      buildPlot(p, S, v.style, set, get, column, earth, out);
    }
  }
  return out;
}

function buildSquare(v, S, p, set, column, earth) {
  const { x: X, z: Z, y } = { x: v.x, z: v.z, y: p.y };
  for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) column(x, z, y, S.plaza, earth, 8);
  // the well: a rim round three by three of water, posts and a little roof
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      if (ring <= 1) { for (let dy = 0; dy >= -3; dy--) set(X + dx, y + dy, Z + dz, B.WATER); set(X + dx, y - 4, Z + dz, S.base); }
      else {
        set(X + dx, y + 1, Z + dz, S.base);
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) for (let dy = 2; dy <= 3; dy++) set(X + dx, y + dy, Z + dz, v.style === 'sand' ? B.SANDSTONE : B.OAK_FENCE);
      }
      set(X + dx, y + 4, Z + dz, S.ridge);
    }
  }
  // lamps at the corners, a market stall and a bench of stairs
  for (const [cx, cz] of [[p.x0, p.z0], [p.x1, p.z0], [p.x0, p.z1], [p.x1, p.z1]]) {
    set(cx, y + 1, cz, v.style === 'sand' ? B.SANDSTONE : B.OAK_FENCE);
    set(cx, y + 2, cz, B.LANTERN);
  }
  set(p.x0 + 2, y + 1, p.z0 + 1, B.MARKET_STALL);
  set(p.x1 - 1, y + 1, p.z1 - 3, S.roof === B.OAK_STAIRS ? B.OAK_STAIRS : S.wall, 3);
  set(p.x1 - 1, y + 1, p.z1 - 2, S.roof === B.OAK_STAIRS ? B.OAK_STAIRS : S.wall, 3);
}

// One plot: its building, turned to face the road, and the step to its door.
function buildPlot(p, S, style, set, get, column, earth, out) {
  const rng = coordRng(p.seed, 0, 0, 1);
  const { w, depth: d, rot, y } = p;
  // local (lx, lz) -> world: lx along the front, lz back from it; the front
  // row (lz = 0) faces the road
  const right = DIRS[(rot + 1) % 4], back = DIRS[(rot + 2) % 4];
  // the front row runs along `right` from the corner nearest the road
  const origin = (() => {
    // pick the corner of the box whose local frame (right, back) covers it
    const xs = [p.x0, p.x1], zs = [p.z0, p.z1];
    for (const x of xs) for (const z of zs) {
      const far = [x + right[0] * (w - 1) + back[0] * (d - 1), z + right[1] * (w - 1) + back[1] * (d - 1)];
      if (far[0] >= p.x0 && far[0] <= p.x1 && far[1] >= p.z0 && far[1] <= p.z1) return [x, z];
    }
    return [p.x0, p.z0];
  })();
  const W = (lx, lz) => [origin[0] + right[0] * lx + back[0] * lz, origin[1] + right[1] * lx + back[1] * lz];
  const turn = (dir) => (dir + rot) % 4;   // a local facing (0 = toward the road) in the world
  const b = {
    set(lx, ly, lz, id, dir = -1) { const [x, z] = W(lx, lz); return set(x, y + ly, z, id, dir >= 0 ? turn(dir) : 0); },
    gate(lx, ly, lz) { const [x, z] = W(lx, lz); return set(x, y + ly, z, B.OAK_FENCE_GATE, rot & 1); },   // (a gate's meta is its axis)
    entity(idx, data) { if (idx >= 0 && data) out.push([idx, data]); },
  };
  // the ground: the footprint levelled at the floor, cleared above
  const clear = p.name === 'farm' ? 4 : 12;
  for (let lx = 0; lx < w; lx++) for (let lz = 0; lz < d; lz++) { const [x, z] = W(lx, lz); column(x, z, y, p.name === 'farm' ? B.DIRT : S.floor, S.base, clear); }
  // the step out to the road
  column(p.door[0], p.door[1], y, S.road, earth, 4);
  BUILD[p.name](b, S, style, w, d, rng);
}

// walls, corner posts, a door in the middle of the front, windows
function shell(b, S, w, d, h = 3, opts = {}) {
  const mid = w >> 1;
  for (let lx = 0; lx < w; lx++) {
    for (let lz = 0; lz < d; lz++) {
      const edgeX = lx === 0 || lx === w - 1, edgeZ = lz === 0 || lz === d - 1;
      if (!edgeX && !edgeZ) continue;
      for (let ly = 1; ly <= h; ly++) b.set(lx, ly, lz, edgeX && edgeZ ? S.post : (opts.wall ?? S.wall));
    }
  }
  if (opts.open) { for (let lx = 1; lx < w - 1; lx++) for (let ly = 1; ly <= h; ly++) b.set(lx, ly, 0, B.AIR); }
  else {
    b.set(mid, 1, 0, B.OAK_DOOR, 0);
    b.set(mid, 2, 0, B.OAK_DOOR_TOP, 0);
  }
  // windows: a pane in each side wall and the back
  const wz = d >> 1;
  b.set(0, 2, wz, B.GLASS_PANE); b.set(w - 1, 2, wz, B.GLASS_PANE);
  b.set(mid, 2, d - 1, B.GLASS_PANE);
  if (w >= 7) { b.set(mid - 2, 2, 0, B.GLASS_PANE); b.set(mid + 2, 2, 0, B.GLASS_PANE); }
}

// a gable roof over (0..w-1, 0..d-1) from ly, running across the front: or a
// flat one with a parapet in the desert
function roof(b, S, w, d, ly) {
  if (!S.gable) {
    for (let lx = 0; lx < w; lx++) for (let lz = 0; lz < d; lz++) {
      b.set(lx, ly, lz, S.roof);
      if (lx === 0 || lz === 0 || lx === w - 1 || lz === d - 1) b.set(lx, ly + 1, lz, (lx + lz) % 2 ? S.roof : B.AIR);
    }
    return;
  }
  for (let k = 0; ; k++) {
    const zf = -1 + k, zb = d - k;
    if (zf > zb) break;
    for (let lx = -1; lx <= w; lx++) {
      if (zf === zb) { b.set(lx, ly + k, zf, S.ridge); continue; }
      b.set(lx, ly + k, zf, S.roof, 2);   // rising toward the back
      b.set(lx, ly + k, zb, S.roof, 0);   // rising toward the front
    }
    // the gable ends, walled up under the slopes
    for (let lz = zf + 1; lz < zb; lz++) { b.set(0, ly + k, lz, S.wall); b.set(w - 1, ly + k, lz, S.wall); }
    if (zb - zf <= 1) break;
  }
}

const BUILD = {
  house(b, S, style, w, d, rng) {
    shell(b, S, w, d);
    roof(b, S, w, d, 4);
    b.set(1, 1, d - 2, B.BED);
    b.entity(b.set(w - 2, 1, d - 2, B.CHEST, 0), lootChest(rng, LOOT.house));
    b.set(w - 2, 1, 1, rng() < 0.5 ? B.CRAFTING_TABLE : B.FURNACE, 3);
    b.set(1, 1, 1, B.LANTERN);
  },
  bighouse(b, S, style, w, d, rng) {
    shell(b, S, w, d);
    roof(b, S, w, d, 4);
    b.set(1, 1, d - 2, B.BED); b.set(2, 1, d - 2, B.BED);
    b.entity(b.set(w - 2, 1, d - 2, B.CHEST, 0), lootChest(rng, LOOT.house));
    b.set(w - 2, 1, 1, B.CRAFTING_TABLE, 3);
    b.set(w - 2, 1, 2, B.FURNACE, 3);
    b.set(1, 1, 1, B.LANTERN);
    b.set(1, 1, 3, B.BOOKSHELF);
    if (style !== 'sand') b.set(3, 1, d - 2, rng() < 0.5 ? B.RED_CARPET : B.BROWN_CARPET);
  },
  smithy(b, S, style, w, d, rng) {
    shell(b, S, w, d, 3, { open: true, wall: style === 'sand' ? S.wall : B.COBBLESTONE });
    roof(b, S, w, d, 4);
    for (let lx = 1; lx < w - 1; lx++) for (let lz = 1; lz < d - 1; lz++) b.set(lx, 0, lz, B.COBBLESTONE);
    b.set(1, 1, d - 2, B.FURNACE, 0); b.set(2, 1, d - 2, B.FURNACE, 0);
    b.entity(b.set(w - 2, 1, d - 2, B.CHEST, 0), lootChest(rng, LOOT.smithy));
    b.set(w - 2, 1, 1, B.CRAFTING_TABLE, 3);
    b.set(3, 1, d - 2, B.IRON_BLOCK);
    b.set(1, 1, 1, B.LANTERN);
  },
  kitchen(b, S, style, w, d, rng) {
    shell(b, S, w, d);
    roof(b, S, w, d, 4);
    b.set(1, 0, d - 2, B.COBBLESTONE);
    b.set(1, 1, d - 2, B.CAMPFIRE_OFF);
    b.set(2, 1, d - 2, B.COOKING_POT);
    b.entity(b.set(w - 2, 1, d - 2, B.CHEST, 0), lootChest(rng, LOOT.kitchen));
    b.set(w - 2, 1, 1, B.CRAFTING_TABLE, 3);
    b.set(1, 1, 1, B.LANTERN);
    if (rng() < 0.5) b.set(w - 2, 1, 2, B.CHURN);
  },
  library(b, S, style, w, d, rng) {
    shell(b, S, w, d);
    roof(b, S, w, d, 4);
    for (let lx = 1; lx < w - 1; lx++) { b.set(lx, 1, d - 2, B.BOOKSHELF); b.set(lx, 2, d - 2, B.BOOKSHELF); }
    b.set(1, 1, 2, B.BOOKSHELF); b.set(w - 2, 1, 2, B.BOOKSHELF);
    b.entity(b.set(w - 2, 1, 1, B.CHEST, 3), lootChest(rng, LOOT.library));
    b.set(1, 1, 1, B.LANTERN);
    b.set(w >> 1, 1, 3, B.CRAFTING_TABLE, 0);
  },
  farm(b, S, style, w, d, rng) {
    // a ring of logs, farmland in rows, a channel of water down the middle
    const crops = style === 'sand' ? [B.WHEAT_0, B.CARROTS_0, B.BEETROOTS_0] : [B.WHEAT_0, B.CARROTS_0, B.POTATOES_0, B.BEETROOTS_0];
    const mid = w >> 1;
    for (let lx = 0; lx < w; lx++) {
      for (let lz = 0; lz < d; lz++) {
        const edge = lx === 0 || lz === 0 || lx === w - 1 || lz === d - 1;
        if (edge) { b.set(lx, 0, lz, S.post); continue; }
        if (lx === mid) { b.set(lx, 0, lz, B.WATER); continue; }
        b.set(lx, 0, lz, B.FARMLAND);
        const crop = crops[((lx < mid ? 0 : 2) + (lz <= d >> 1 ? 0 : 1)) % crops.length];   // a crop to each quarter
        const stage = (rng() * 4) | 0;
        b.entity(b.set(lx, 1, lz, crop + stage), stage < 3 ? { kind: 'crop', grow: 40 + rng() * 120 } : null);
      }
    }
    b.set(0, 1, 0, B.COMPOSTER);
  },
  stable(b, S, style, w, d, rng) {
    // a fenced paddock with a gate to the road, hay, a trough and a lean-to
    const fence = style === 'sand' ? B.SANDSTONE : B.OAK_FENCE;
    const mid = w >> 1;
    for (let lx = 0; lx < w; lx++) {
      for (let lz = 0; lz < d; lz++) {
        if (lx > 0 && lz > 0 && lx < w - 1 && lz < d - 1) { b.set(lx, 0, lz, style === 'sand' ? B.SAND : B.GRASS); continue; }
        b.set(lx, 0, lz, style === 'sand' ? B.SAND : B.GRASS);
        if (lz === 0 && lx === mid) { b.gate(lx, 1, lz); continue; }
        b.set(lx, 1, lz, fence);
      }
    }
    for (let lx = 1; lx < w - 1; lx++) { b.set(lx, 3, d - 2, S.ridge); b.set(lx, 3, d - 3, S.ridge); }
    b.set(1, 1, d - 2, S.post); b.set(1, 2, d - 2, S.post); b.set(w - 2, 1, d - 2, S.post); b.set(w - 2, 2, d - 2, S.post);
    b.set(2, 1, d - 2, B.HAY_BALE); b.set(3, 1, d - 2, B.HAY_BALE); b.set(2, 2, d - 2, B.HAY_BALE);
    b.entity(b.set(w - 3, 1, d - 2, B.TROUGH), { kind: 'trough', slots: [makeStack(I.WHEAT, 8 + ((rng() * 16) | 0)), null, null] });
    b.entity(b.set(w - 2, 1, 1, B.CHEST, 3), lootChest(rng, LOOT.stable));
  },
};

export const VILLAGE_STYLES = Object.keys(STYLES);
