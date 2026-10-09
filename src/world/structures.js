// Generated structures: buried dungeons, desert temples, overgrown forest
// temples and small wayside shrines. Every structure fits inside a single
// chunk, so it is built while that chunk generates and never seams. Surface
// structures are planned per chunk (deterministically, from the seed) and
// trees/plants of neighbouring chunks keep clear of them.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, blockIndex } from '../core/constants.js';
import { coordRng } from '../core/rng.js';
import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { makeStack } from '../items/items.js';

// ---- loot: [id, min, max, chance] ----

const DUNGEON_LOOT = [
  [I.BREAD, 1, 3, 0.6], [I.WHEAT, 2, 5, 0.4], [I.WHEAT_SEEDS, 2, 6, 0.4], [I.APPLE, 1, 3, 0.4],
  [I.COAL, 3, 8, 0.6], [I.IRON_INGOT, 1, 4, 0.5], [I.GOLD_INGOT, 1, 3, 0.3],
  [I.STRING, 1, 4, 0.4], [I.BONE, 2, 5, 0.5], [I.ARROW, 4, 12, 0.4], [I.GUNPOWDER, 1, 3, 0.3],
  [I.BOOK, 1, 2, 0.25], [I.DIAMOND, 1, 2, 0.15], [I.GOLDEN_APPLE, 1, 1, 0.08],
  [I.IRON_PICKAXE, 1, 1, 0.12], [I.IRON_SWORD, 1, 1, 0.12], [I.IRON_SPEAR, 1, 1, 0.12], [I.BOW, 1, 1, 0.15],
  [I.IRON_HELMET, 1, 1, 0.1], [I.LEATHER_CHESTPLATE, 1, 1, 0.15],
];

const DESERT_TEMPLE_LOOT = [
  [I.GOLD_INGOT, 2, 7, 0.6], [I.IRON_INGOT, 1, 5, 0.5], [I.DIAMOND, 1, 3, 0.3],
  [I.BONE, 2, 6, 0.5], [I.ROTTEN_FLESH, 3, 7, 0.6], [I.GUNPOWDER, 1, 4, 0.4], [B.TNT, 1, 2, 0.15],
  [I.BOOK, 1, 2, 0.3], [I.GOLDEN_APPLE, 1, 2, 0.25],
  [I.GOLD_SWORD, 1, 1, 0.2], [I.GOLD_SPEAR, 1, 1, 0.15], [I.GOLD_CHESTPLATE, 1, 1, 0.12], [I.GOLD_HELMET, 1, 1, 0.12],
  [I.IRON_SPEAR, 1, 1, 0.15], [I.DIAMOND_SPEAR, 1, 1, 0.05], [I.ANCIENT_SWORD, 1, 1, 0.1],
];

const FOREST_TEMPLE_LOOT = [
  [I.ARROW, 6, 16, 0.6], [I.BOW, 1, 1, 0.3], [I.BONE, 2, 6, 0.5], [I.ROTTEN_FLESH, 2, 6, 0.5],
  [I.IRON_INGOT, 2, 5, 0.5], [I.GOLD_INGOT, 1, 4, 0.4], [I.DIAMOND, 1, 2, 0.2],
  [I.APPLE, 2, 4, 0.5], [I.GOLDEN_APPLE, 1, 1, 0.2], [I.BOOK, 1, 3, 0.3],
  [I.IRON_SWORD, 1, 1, 0.2], [I.IRON_SPEAR, 1, 1, 0.25], [I.IRON_CHESTPLATE, 1, 1, 0.1],
  [I.DIAMOND_SWORD, 1, 1, 0.05], [I.ANCIENT_SWORD, 1, 1, 0.12],
];

const SHRINE_LOOT = [
  [I.BREAD, 1, 3, 0.6], [I.APPLE, 1, 3, 0.5], [I.GOLDEN_APPLE, 1, 1, 0.1],
  [I.IRON_INGOT, 1, 3, 0.4], [I.GOLD_INGOT, 1, 2, 0.3], [I.ARROW, 4, 10, 0.3],
  [B.TORCH, 2, 6, 0.4], [I.BOOK, 1, 1, 0.2],
  [I.STONE_SPEAR, 1, 1, 0.25], [I.IRON_SPEAR, 1, 1, 0.12], [I.IRON_SWORD, 1, 1, 0.08],
];

function rollLoot(rng, table) {
  const slots = new Array(27).fill(null);
  for (const [id, lo, hi, chance] of table) {
    if (rng() > chance) continue;
    const stack = makeStack(id, lo + ((rng() * (hi - lo + 1)) | 0));
    let i = (rng() * 27) | 0;
    while (slots[i]) i = (i + 1) % 27;
    slots[i] = stack;
  }
  // never an empty chest
  if (slots.every((s) => !s)) slots[13] = makeStack(table[0][0], table[0][1]);
  return slots;
}

const chest = (rng, table) => ({ kind: 'chest', slots: rollLoot(rng, table) });
function spawnerMob(rng) {
  const r = rng();
  return r < 0.5 ? 'zombie' : r < 0.75 ? 'skeleton' : 'spider';
}

// ---- dungeons ----

// A rare buried room of (mossy) cobblestone with a monster spawner and one or
// two loot chests. Only built where it cuts into a cave, so it can be found;
// the cave keeps its openings into the room. Returns [index, entity] pairs.
export function placeDungeon(gen, blocks, cx, cz, heightMap) {
  const rng = coordRng(gen.seed, cx, cz, 4242);
  if (rng() > 0.05) return [];
  const W = rng() < 0.5 ? 7 : 9, D = rng() < 0.5 ? 7 : 9, H = 5;
  const x0 = 2 + ((rng() * (CHUNK_X - W - 3)) | 0);
  const z0 = 2 + ((rng() * (CHUNK_Z - D - 3)) | 0);
  let minTop = CHUNK_Y;
  for (let x = x0; x < x0 + W; x++) for (let z = z0; z < z0 + D; z++) minTop = Math.min(minTop, heightMap[x * CHUNK_Z + z]);
  const hiY = Math.min(44, minTop - 9);
  if (hiY < 12) return [];

  const isWall = (dx, dz) => dx === 0 || dz === 0 || dx === W - 1 || dz === D - 1;
  const isCorner = (dx, dz) => (dx === 0 || dx === W - 1) && (dz === 0 || dz === D - 1);
  // find a height where caves open into the walls, but don't swallow the room
  let y0 = -1;
  for (let attempt = 0; attempt < 8 && y0 < 0; attempt++) {
    const y = 10 + ((rng() * (hiY - 10)) | 0);
    let openings = 0, wet = false;
    for (let dx = 0; dx < W && !wet; dx++) {
      for (let dz = 0; dz < D; dz++) {
        for (let dy = 0; dy < H; dy++) {
          const id = blocks[blockIndex(x0 + dx, y + dy, z0 + dz)];
          if (id === B.WATER) { wet = true; break; }
          if (dy >= 1 && dy <= 3 && isWall(dx, dz) && !isCorner(dx, dz) && id === B.AIR) openings++;
        }
      }
    }
    if (!wet && openings >= 1 && openings <= 16) y0 = y;
  }
  if (y0 < 0) return [];

  for (let dx = 0; dx < W; dx++) {
    for (let dz = 0; dz < D; dz++) {
      for (let dy = 0; dy < H; dy++) {
        const idx = blockIndex(x0 + dx, y0 + dy, z0 + dz);
        const shell = dy === 0 || dy === H - 1 || isWall(dx, dz);
        if (!shell) blocks[idx] = B.AIR;
        else if (dy >= 1 && dy <= 3 && isWall(dx, dz) && blocks[idx] === B.AIR) continue;   // cave opening
        else blocks[idx] = rng() < 0.4 ? B.MOSSY_COBBLE : B.COBBLESTONE;
      }
    }
  }
  const out = [];
  // the spawner in the middle
  const sidx = blockIndex(x0 + (W >> 1), y0 + 1, z0 + (D >> 1));
  blocks[sidx] = B.SPAWNER;
  out.push([sidx, { kind: 'spawner', mob: spawnerMob(rng) }]);
  // one or two chests against solid stretches of wall
  const spots = [];
  for (let dx = 1; dx < W - 1; dx++) {
    for (let dz = 1; dz < D - 1; dz++) {
      if (!(dx === 1 || dz === 1 || dx === W - 2 || dz === D - 2)) continue;
      // the wall block(s) behind this spot must be solid
      const behind = [];
      if (dx === 1) behind.push([0, dz]);
      if (dx === W - 2) behind.push([W - 1, dz]);
      if (dz === 1) behind.push([dx, 0]);
      if (dz === D - 2) behind.push([dx, D - 1]);
      if (behind.every(([bx, bz]) => blocks[blockIndex(x0 + bx, y0 + 1, z0 + bz)] !== B.AIR)) spots.push([dx, dz]);
    }
  }
  const chests = 1 + (rng() < 0.5 ? 1 : 0);
  for (let c = 0; c < chests && spots.length; c++) {
    const [dx, dz] = spots.splice((rng() * spots.length) | 0, 1)[0];
    const cidx = blockIndex(x0 + dx, y0 + 1, z0 + dz);
    blocks[cidx] = B.CHEST;
    out.push([cidx, chest(rng, DUNGEON_LOOT)]);
  }
  return out;
}

// ---- surface structures ----

// natural ground a foundation can rest on (anything else - air, water,
// plants, trees - gets filled in)
const GROUND = new Set([
  B.STONE, B.GRASS, B.DIRT, B.COBBLESTONE, B.BEDROCK, B.SAND, B.SANDSTONE, B.GRAVEL, B.CLAY,
  B.SNOW_BLOCK, B.SNOWY_GRASS, B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.REDSTONE_ORE,
]);

const SIZES = { desert_temple: 13, forest_temple: 11, shrine: 7 };
const SHRINE_BIOMES = new Set([2, 3, 4, 5, 6, 7, 8, 9]);   // land biomes (see BIOME)

// What surface structure (if any) this chunk holds: {type, x0, z0, size, y, rot, biome}.
// Pure function of the seed, cached per generator.
export function structurePlan(gen, cx, cz) {
  if (gen.version < 3) return null;
  const key = `${cx},${cz}`;
  const cache = gen.planCache ?? (gen.planCache = new Map());
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 4096) cache.clear();
  let plan = rawPlan(gen, cx, cz);
  // keep structures apart: within two chunks only the highest-priority one stands
  for (let dx = -2; dx <= 2 && plan; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (!dx && !dz) continue;
      const other = rawPlan(gen, cx + dx, cz + dz);
      if (other && other.priority > plan.priority) { plan = null; break; }
    }
  }
  cache.set(key, plan);
  return plan;
}

function rawPlan(gen, cx, cz) {
  const key = `${cx},${cz}`;
  const cache = gen.rawPlanCache ?? (gen.rawPlanCache = new Map());
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 8192) cache.clear();
  const plan = makePlan(gen, cx, cz);
  cache.set(key, plan);
  return plan;
}

function makePlan(gen, cx, cz) {
  const rng = coordRng(gen.seed, cx, cz, 6161);
  const roll = rng();
  const biome = gen.biomeOf(gen.columnAt(cx * CHUNK_X + 8, cz * CHUNK_Z + 8));
  let type = null;
  if (biome === 5 && roll < 0.12) type = 'desert_temple';
  else if ((biome === 3 || biome === 4 || biome === 8) && roll < 0.045) type = 'forest_temple';
  else if (SHRINE_BIOMES.has(biome) && roll > 0.955) type = 'shrine';
  if (!type) return null;
  const size = SIZES[type];
  const x0 = 1 + ((rng() * (CHUNK_X - size - 1)) | 0);
  const z0 = 1 + ((rng() * (CHUNK_Z - size - 1)) | 0);
  // needs fairly level, dry ground
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const h = Math.floor(gen.columnAt(cx * CHUNK_X + x0 + Math.round(i * (size - 1) / 3), cz * CHUNK_Z + z0 + Math.round(j * (size - 1) / 3)).h);
      lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
    }
  }
  if (lo <= SEA_LEVEL || hi - lo > (type === 'shrine' ? 3 : 5)) return null;
  const y = Math.round(sum / n);
  if (y + 16 >= CHUNK_Y) return null;
  return { type, x0, z0, size, y, rot: (rng() * 4) | 0, biome, priority: rng() };
}

// Is this world column within `margin` blocks of a planned structure?
export function nearStructure(gen, wx, wz, margin = 3) {
  if (gen.version < 3) return false;
  const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const p = structurePlan(gen, cx + dx, cz + dz);
      if (!p) continue;
      const X0 = (cx + dx) * CHUNK_X + p.x0, Z0 = (cz + dz) * CHUNK_Z + p.z0;
      if (wx >= X0 - margin && wx < X0 + p.size + margin && wz >= Z0 - margin && wz < Z0 + p.size + margin) return true;
    }
  }
  return false;
}

// Build this chunk's planned structure. Returns [index, entity] pairs.
export function buildStructure(gen, blocks, cx, cz) {
  const plan = structurePlan(gen, cx, cz);
  if (!plan) return [];
  const rng = coordRng(gen.seed, cx, cz, 6262);
  const { x0, z0, size: S, rot } = plan;
  // designs are written with the entrance on the dz = 0 side; rotate into place
  const local = (dx, dz) => {
    switch (rot) {
      case 1: return [S - 1 - dz, dx];
      case 2: return [S - 1 - dx, S - 1 - dz];
      case 3: return [dz, S - 1 - dx];
      default: return [dx, dz];
    }
  };
  const out = [];
  const b = {
    set(dx, y, dz, id) {
      const [lx, lz] = local(dx, dz);
      if (y < 1 || y >= CHUNK_Y) return -1;
      const idx = blockIndex(x0 + lx, y, z0 + lz);
      blocks[idx] = id;
      return idx;
    },
    get(dx, y, dz) {
      const [lx, lz] = local(dx, dz);
      return blocks[blockIndex(x0 + lx, y, z0 + lz)];
    },
    entity(idx, data) { if (idx >= 0) out.push([idx, data]); },
    // fill the ground under the footprint with `id` (no floating corners) and
    // clear everything above the floor
    site(y, id, clearTo) {
      for (let dx = 0; dx < S; dx++) {
        for (let dz = 0; dz < S; dz++) {
          for (let yy = y - 1; yy > y - 14 && yy > 1; yy--) {
            if (GROUND.has(this.get(dx, yy, dz))) break;
            this.set(dx, yy, dz, id);
          }
          for (let yy = y + 1; yy <= y + clearTo; yy++) this.set(dx, yy, dz, B.AIR);
        }
      }
    },
  };
  if (plan.type === 'desert_temple') desertTemple(b, plan, rng);
  else if (plan.type === 'forest_temple') forestTemple(b, plan, rng);
  else shrine(b, plan, rng);
  return out;
}

// A stepped sandstone pyramid with corner towers. Under the chiseled square
// in the middle of the floor lies a sealed vault with four chests.
function desertTemple(b, { y }, rng) {
  const S = 13, C = 6;
  b.site(y, B.SANDSTONE, 14);
  for (let dx = 0; dx < S; dx++) {
    for (let dz = 0; dz < S; dz++) {
      const ring = Math.max(Math.abs(dx - C), Math.abs(dz - C));   // 0 centre .. 6 edge
      // floor, with a chiseled square marking the vault
      b.set(dx, y, dz, ring === 2 || ring === 0 ? B.CHISELED_SANDSTONE : B.SANDSTONE);
      // walls of the hall
      if (ring === 5) for (let dy = 1; dy <= 4; dy++) b.set(dx, y + dy, dz, dy === 3 ? B.CHISELED_SANDSTONE : B.SANDSTONE);
      // stepped roof
      for (let k = 0; k <= 5; k++) if (ring <= 5 - k) b.set(dx, y + 5 + k, dz, k === 5 ? B.CHISELED_SANDSTONE : B.SANDSTONE);
      // solid fill between floor and vault
      for (let dy = 1; dy <= 2; dy++) b.set(dx, y - dy, dz, B.SANDSTONE);
    }
  }
  // corner towers
  for (const [tx, tz] of [[0, 0], [0, S - 1], [S - 1, 0], [S - 1, S - 1]]) {
    for (let dy = 1; dy <= 6; dy++) b.set(tx, y + dy, tz, dy === 6 ? B.CHISELED_SANDSTONE : B.SANDSTONE);
  }
  // entrance: three wide, three high
  for (let dx = C - 1; dx <= C + 1; dx++) for (let dy = 1; dy <= 3; dy++) b.set(dx, y + dy, 1, B.AIR);
  // a few torches in the hall
  for (const [tx, tz] of [[2, 2], [2, S - 3], [S - 3, 2], [S - 3, S - 3]]) b.set(tx, y + 1, tz, B.TORCH);

  // the vault: 5x5x3 inside, its ceiling three blocks under the floor
  const fy = y - 7;
  for (let dx = C - 3; dx <= C + 3; dx++) {
    for (let dz = C - 3; dz <= C + 3; dz++) {
      for (let dy = 0; dy <= 4; dy++) {
        const shell = dy === 0 || dy === 4 || Math.abs(dx - C) === 3 || Math.abs(dz - C) === 3;
        b.set(dx, fy + dy, dz, shell ? (dy === 0 && (dx + dz) % 2 ? B.CHISELED_SANDSTONE : B.SANDSTONE) : B.AIR);
      }
    }
  }
  b.set(C, fy, C, B.GOLD_BLOCK);
  for (const [dx, dz] of [[C, C - 2], [C, C + 2], [C - 2, C], [C + 2, C]]) {
    b.entity(b.set(dx, fy + 1, dz, B.CHEST), chest(rng, DESERT_TEMPLE_LOOT));
  }
}

// A crumbling, moss-eaten two-storey temple. The ground floor may hide a
// spider spawner; steps along the wall lead up to a terrace and a small
// upper sanctum with the better chest.
function forestTemple(b, { y }, rng) {
  const S = 11, C = 5;
  const stone = () => {
    const r = rng();
    return r < 0.3 ? B.MOSSY_COBBLE : r < 0.55 ? B.COBBLESTONE : r < 0.8 ? B.MOSSY_STONE_BRICKS : B.STONE_BRICKS;
  };
  b.site(y, B.COBBLESTONE, 13);
  for (let dx = 0; dx < S; dx++) {
    for (let dz = 0; dz < S; dz++) {
      const edge = dx === 0 || dz === 0 || dx === S - 1 || dz === S - 1;
      b.set(dx, y, dz, rng() < 0.5 ? B.MOSSY_COBBLE : B.COBBLESTONE);
      if (edge) {
        for (let dy = 1; dy <= 4; dy++) {
          // ruined: the upper wall has gaps
          b.set(dx, y + dy, dz, dy >= 3 && rng() < 0.12 ? B.AIR : stone());
        }
      }
      b.set(dx, y + 5, dz, stone());   // ceiling / terrace floor
      // overgrowth on the terrace edge
      if (edge && rng() < 0.3) b.set(dx, y + 6, dz, B.OAK_LEAVES);
      // the upper sanctum
      const ring = Math.max(Math.abs(dx - C), Math.abs(dz - C));
      if (ring === 3) for (let dy = 6; dy <= 8; dy++) b.set(dx, y + dy, dz, dy === 7 && (dx === C || dz === C) ? B.AIR : stone());
      if (ring <= 3) {
        b.set(dx, y + 9, dz, rng() < 0.08 ? B.AIR : stone());
        if (rng() < 0.35) b.set(dx, y + 10, dz, B.OAK_LEAVES);
      }
    }
  }
  // door into the ground floor
  for (let dy = 1; dy <= 2; dy++) b.set(C, y + dy, 0, B.AIR);
  // steps up the west wall, and a hole in the ceiling above them
  for (let k = 0; k < 4; k++) {
    for (let dy = 1; dy <= k + 1; dy++) b.set(1, y + dy, 2 + k, stone());
  }
  for (const dz of [3, 4, 5]) b.set(1, y + 5, dz, B.AIR);
  // the sanctum door faces the stair hole
  for (let dy = 6; dy <= 7; dy++) b.set(2, y + dy, C, B.AIR);

  b.entity(b.set(C, y + 1, S - 2, B.CHEST), chest(rng, FOREST_TEMPLE_LOOT));
  b.entity(b.set(C, y + 6, C, B.CHEST), chest(rng, FOREST_TEMPLE_LOOT));
  if (rng() < 0.6) b.entity(b.set(C, y + 1, C, B.SPAWNER), { kind: 'spawner', mob: 'spider' });
  else b.set(C, y + 1, C, B.MOSSY_COBBLE);
}

// A small open pavilion on a plinth: four pillars, a stepped roof with a
// glowing keystone, and an offering chest in the middle.
function shrine(b, { y, biome }, rng) {
  const S = 7, C = 3;
  let floor = B.STONE_BRICKS, pillar = B.STONE_BRICKS, roof = B.STONE_BRICKS, cap = B.CHISELED_SANDSTONE;
  if (biome === 5) { floor = B.SANDSTONE; pillar = B.CHISELED_SANDSTONE; roof = B.SANDSTONE; }
  else if (biome === 6 || biome === 7 || biome === 9) { pillar = B.SPRUCE_LOG; roof = B.SPRUCE_PLANKS; cap = B.STONE_BRICKS; }
  else { pillar = B.OAK_LOG; roof = B.OAK_PLANKS; cap = B.MOSSY_STONE_BRICKS; }
  const mossy = biome !== 5 && biome !== 6 && biome !== 7;
  b.site(y, floor, 9);
  for (let dx = 0; dx < S; dx++) {
    for (let dz = 0; dz < S; dz++) {
      const ring = Math.max(Math.abs(dx - C), Math.abs(dz - C));
      b.set(dx, y, dz, mossy && rng() < 0.25 ? B.MOSSY_STONE_BRICKS : floor);
      if (ring <= 2) b.set(dx, y + 4, dz, roof);
      if (ring <= 1) b.set(dx, y + 5, dz, roof);
    }
  }
  for (const [px, pz] of [[1, 1], [1, 5], [5, 1], [5, 5]]) {
    for (let dy = 1; dy <= 3; dy++) b.set(px, y + dy, pz, pillar);
  }
  b.set(C, y + 6, C, cap);
  b.set(C, y + 4, C, B.GLOWSTONE);
  b.entity(b.set(C, y + 1, C, B.CHEST), chest(rng, SHRINE_LOOT));
}

export const STRUCTURE_NAMES = { desert_temple: 'Desert Temple', forest_temple: 'Forest Temple', shrine: 'Shrine' };
