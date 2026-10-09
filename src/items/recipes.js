// Crafting recipes (shaped + shapeless) and furnace smelting data.

import { B } from '../blocks/blocks.js';
import { I } from './itemIds.js';

const ANY_PLANKS = Object.assign([B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS], { label: 'Any Planks' });
const ANY_LOG = Object.assign([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG], { label: 'Any Log' });

// Shaped: pattern rows with keys; '.' = empty. Matched anywhere in the grid,
// plus horizontally mirrored variants.
// Shapeless: exact multiset of ingredients.
export const RECIPES = [];

function shaped(result, count, pattern, keys) {
  RECIPES.push({ type: 'shaped', result, count, pattern, keys });
}

function shapeless(result, count, ingredients) {
  RECIPES.push({ type: 'shapeless', result, count, ingredients });
}

// wood processing (species preserved)
shapeless(B.OAK_PLANKS, 4, [[B.OAK_LOG]]);
shapeless(B.BIRCH_PLANKS, 4, [[B.BIRCH_LOG]]);
shapeless(B.SPRUCE_PLANKS, 4, [[B.SPRUCE_LOG]]);
shaped(I.STICK, 4, ['X', 'X'], { X: ANY_PLANKS });
shaped(B.CRAFTING_TABLE, 1, ['XX', 'XX'], { X: ANY_PLANKS });
shaped(B.FURNACE, 1, ['XXX', 'X.X', 'XXX'], { X: [B.COBBLESTONE] });
shaped(B.TORCH, 4, ['C', 'S'], { C: [I.COAL], S: [I.STICK] });
shaped(B.CHEST, 1, ['XXX', 'X.X', 'XXX'], { X: ANY_PLANKS });
shaped(B.BED, 1, ['WWW', 'PPP'], { W: [B.WOOL], P: ANY_PLANKS });

// tools: [material group, pickaxe head, axe, shovel, sword]
const TOOL_MATS = [
  [ANY_PLANKS, I.WOOD_PICKAXE, I.WOOD_AXE, I.WOOD_SHOVEL, I.WOOD_SWORD, I.WOOD_HOE],
  [[B.COBBLESTONE], I.STONE_PICKAXE, I.STONE_AXE, I.STONE_SHOVEL, I.STONE_SWORD, I.STONE_HOE],
  [[I.IRON_INGOT], I.IRON_PICKAXE, I.IRON_AXE, I.IRON_SHOVEL, I.IRON_SWORD, I.IRON_HOE],
  [[I.GOLD_INGOT], I.GOLD_PICKAXE, I.GOLD_AXE, I.GOLD_SHOVEL, I.GOLD_SWORD, I.GOLD_HOE],
  [[I.DIAMOND], I.DIAMOND_PICKAXE, I.DIAMOND_AXE, I.DIAMOND_SHOVEL, I.DIAMOND_SWORD, I.DIAMOND_HOE],
];
for (const [mat, pick, axe, shovel, sword, hoe] of TOOL_MATS) {
  const keys = { X: mat, S: [I.STICK] };
  shaped(pick, 1, ['XXX', '.S.', '.S.'], keys);
  shaped(axe, 1, ['XX', 'XS', '.S'], keys);
  shaped(shovel, 1, ['X', 'S', 'S'], keys);
  shaped(sword, 1, ['X', 'X', 'S'], keys);
  shaped(hoe, 1, ['XX', '.S', '.S'], keys);
}

// armour
for (const [mat, helmet, chest, legs, boots] of [
  [I.LEATHER, I.LEATHER_HELMET, I.LEATHER_CHESTPLATE, I.LEATHER_LEGGINGS, I.LEATHER_BOOTS],
  [I.IRON_INGOT, I.IRON_HELMET, I.IRON_CHESTPLATE, I.IRON_LEGGINGS, I.IRON_BOOTS],
  [I.GOLD_INGOT, I.GOLD_HELMET, I.GOLD_CHESTPLATE, I.GOLD_LEGGINGS, I.GOLD_BOOTS],
  [I.DIAMOND, I.DIAMOND_HELMET, I.DIAMOND_CHESTPLATE, I.DIAMOND_LEGGINGS, I.DIAMOND_BOOTS],
]) {
  const keys = { X: [mat] };
  shaped(helmet, 1, ['XXX', 'X.X'], keys);
  shaped(chest, 1, ['X.X', 'XXX', 'XXX'], keys);
  shaped(legs, 1, ['XXX', 'X.X', 'X.X'], keys);
  shaped(boots, 1, ['X.X', 'X.X'], keys);
}

// farming and mob drops
shaped(I.BREAD, 1, ['WWW'], { W: [I.WHEAT] });

// storage blocks (and back)
for (const [item, block] of [[I.IRON_INGOT, B.IRON_BLOCK], [I.GOLD_INGOT, B.GOLD_BLOCK], [I.DIAMOND, B.DIAMOND_BLOCK], [I.COAL, B.COAL_BLOCK]]) {
  shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: [item] });
  shapeless(item, 9, [[block]]);
}

// books and decoration
shaped(I.PAPER, 3, ['SSS'], { S: [B.SUGAR_CANE] });
shapeless(I.BOOK, 1, [[I.PAPER], [I.PAPER], [I.PAPER], [I.LEATHER]]);
shaped(B.BOOKSHELF, 1, ['PPP', 'BBB', 'PPP'], { P: ANY_PLANKS, B: [I.BOOK] });
shapeless(B.JACK_O_LANTERN, 1, [[B.PUMPKIN], [B.TORCH]]);
shaped(B.CAMPFIRE, 1, ['.S.', 'SCS', 'LLL'], { S: [I.STICK], C: [I.COAL, I.CHARCOAL], L: ANY_LOG });

// what a campfire can cook: the raw foods the furnace cooks
export const CAMPFIRE_TIME = 20;   // seconds per item (furnace: SMELT_TIME, but needs fuel)
shaped(I.BOWL, 4, ['P.P', '.P.'], { P: ANY_PLANKS });
shapeless(I.MUSHROOM_STEW, 1, [[I.BOWL], [B.MUSHROOM_BROWN], [B.MUSHROOM_RED]]);
shapeless(I.BONE_MEAL, 3, [[I.BONE]]);
shaped(I.BOW, 1, ['.SX', 'S.X', '.SX'], { S: [I.STICK], X: [I.STRING] });
shaped(I.ARROW, 4, ['F', 'S', 'E'], { F: [I.FLINT], S: [I.STICK], E: [I.FEATHER] });
shaped(B.WOOL, 1, ['SS', 'SS'], { S: [I.STRING] });
shaped(B.TNT, 1, ['GSG', 'SGS', 'GSG'], { G: [I.GUNPOWDER], S: [B.SAND] });

// building blocks
shaped(B.STONE_BRICKS, 4, ['XX', 'XX'], { X: [B.STONE] });
shaped(B.SANDSTONE, 1, ['XX', 'XX'], { X: [B.SAND] });
shaped(B.BRICKS, 1, ['XX', 'XX'], { X: [I.BRICK_ITEM] });
shaped(B.GLOWSTONE, 1, ['XX', 'XX'], { X: [I.REDSTONE_DUST] });
shapeless(B.MOSSY_COBBLE, 1, [[B.COBBLESTONE], [B.TALL_GRASS]]);

// ---- matching ----

function idMatches(cellId, group) {
  return group.includes(cellId);
}

// grid: array of item ids (0 = empty) with given width/height (2x2 or 3x3).
// Returns {id, count} or null.
export function matchRecipe(grid, w, h) {
  // bounding box of non-empty cells
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = grid[y * w + x];
      if (id) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        items.push(id);
      }
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  outer:
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (items.length !== r.ingredients.length) continue;
      const pool = [...r.ingredients];
      for (const id of items) {
        const idx = pool.findIndex((group) => idMatches(id, group));
        if (idx === -1) continue outer;
        pool.splice(idx, 1);
      }
      return { id: r.result, count: r.count };
    }

    const rows = r.pattern;
    const pw = rows[0].length, ph = rows.length;
    if (pw !== bw || ph !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) {
        for (let x = 0; x < pw && ok; x++) {
          const ch = rows[y][mirror ? pw - 1 - x : x];
          const cell = grid[(minY + y) * w + (minX + x)];
          if (ch === '.') {
            if (cell) ok = false;
          } else {
            const group = r.keys[ch];
            if (!cell || !group || !idMatches(cell, group)) ok = false;
          }
        }
      }
      if (ok) return { id: r.result, count: r.count };
    }
  }
  return null;
}

// ---- recipe book helpers ----

// Grid footprint of a recipe: {w, h}. Shapeless recipes are laid out in a row-major block.
export function recipeSize(r) {
  if (r.type === 'shaped') return { w: Math.max(...r.pattern.map((row) => row.length)), h: r.pattern.length };
  const n = r.ingredients.length;
  return n <= 2 ? { w: n, h: 1 } : n <= 4 ? { w: 2, h: 2 } : { w: 3, h: Math.ceil(n / 3) };
}

// Cells as [{x, y, group}] in the recipe's own coordinates.
export function recipeCells(r) {
  const cells = [];
  if (r.type === 'shaped') {
    r.pattern.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '.') cells.push({ x, y, group: r.keys[ch] });
    }));
  } else {
    const { w } = recipeSize(r);
    r.ingredients.forEach((group, i) => cells.push({ x: i % w, y: Math.floor(i / w), group }));
  }
  return cells;
}

// What a recipe needs, merged per ingredient group: [{group, count}]
export function recipeNeeds(r) {
  const needs = new Map();
  for (const { group } of recipeCells(r)) needs.set(group, (needs.get(group) ?? 0) + 1);
  return [...needs].map(([group, count]) => ({ group, count }));
}

// For each ingredient group, the item id to use given the player's counts
// (the variant they have most of), or null if they can't afford one craft.
// Returns {ok, pick: Map<group, id>, times: crafts affordable}.
export function recipeAvailability(r, countOf) {
  const pick = new Map();
  let times = Infinity;
  for (const { group, count } of recipeNeeds(r)) {
    let best = group[0], bestN = -1;
    for (const id of group) {
      const n = countOf(id);
      if (n > bestN) { best = id; bestN = n; }
    }
    pick.set(group, best);
    times = Math.min(times, Math.floor(bestN / count));
  }
  return { ok: times > 0, pick, times };
}

// ---- smelting ----

export const SMELTING = new Map([
  [B.IRON_ORE, { id: I.IRON_INGOT, count: 1 }],
  [B.GOLD_ORE, { id: I.GOLD_INGOT, count: 1 }],
  [B.SAND, { id: B.GLASS, count: 1 }],
  [B.COBBLESTONE, { id: B.STONE, count: 1 }],
  [I.CLAY_BALL, { id: I.BRICK_ITEM, count: 1 }],
  [I.PORKCHOP_RAW, { id: I.PORKCHOP_COOKED, count: 1 }],
  [I.MUTTON_RAW, { id: I.MUTTON_COOKED, count: 1 }],
  [I.BEEF_RAW, { id: I.BEEF_COOKED, count: 1 }],
  [I.CHICKEN_RAW, { id: I.CHICKEN_COOKED, count: 1 }],
  [I.FISH_RAW, { id: I.FISH_COOKED, count: 1 }],
  [B.OAK_LOG, { id: I.CHARCOAL, count: 1 }],
  [B.BIRCH_LOG, { id: I.CHARCOAL, count: 1 }],
  [B.SPRUCE_LOG, { id: I.CHARCOAL, count: 1 }],
]);

export const SMELT_TIME = 10; // seconds per item
