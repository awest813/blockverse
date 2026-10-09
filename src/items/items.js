// Item registry. IDs < 256 are placeable blocks (see blocks.js);
// IDs >= 256 are pure items defined here.

import { B, BLOCKS, blockInfo } from '../blocks/blocks.js';
import { I } from './itemIds.js';

export { I };

export const TIER_WOOD = 1;
export const TIER_STONE = 2;
export const TIER_IRON = 3;
export const TIER_GOLD = 1;    // gold: fast but weak tier
export const TIER_DIAMOND = 4;

const TIER_STATS = {
  wood: { tier: 1, speed: 2, durability: 60, damage: 4 },
  stone: { tier: 2, speed: 4, durability: 132, damage: 5 },
  iron: { tier: 3, speed: 6, durability: 251, damage: 6 },
  gold: { tier: 1, speed: 12, durability: 33, damage: 4 },
  diamond: { tier: 4, speed: 8, durability: 1562, damage: 7 },
};

const ITEMS = new Map();

function item(id, name, display, opts = {}) {
  ITEMS.set(id, {
    id,
    name,
    display,
    texture: opts.texture ?? name,
    stack: opts.stack ?? 64,
    tool: opts.tool ?? null,   // {class, tier, speed, durability, damage}
    food: opts.food ?? 0,      // hunger points restored
    sat: opts.sat ?? (opts.food ?? 0) * 0.6,   // saturation it gives
    sickly: opts.sickly ?? 0,  // chance it upsets your stomach (rotten flesh, raw chicken)
    burnTime: opts.burnTime ?? 0, // furnace fuel, in seconds
    armor: opts.armor ?? null,  // {slot: 0 head .. 3 feet, points, durability}
    bow: opts.bow ?? null,      // {durability}
    places: opts.places ?? null, // block this item plants/places (seeds)
    returns: opts.returns ?? null, // item left behind after eating (bowl)
    heal: opts.heal ?? 0,          // health restored on eating (golden apple)
    eatTime: opts.eatTime ?? 1.6,  // seconds of holding use to eat/drink
    drink: opts.drink ?? false,    // milk: drinkable without being food
  });
}

function toolItem(id, material, cls) {
  const s = TIER_STATS[material];
  const display = `${material[0].toUpperCase()}${material.slice(1)} ${cls[0].toUpperCase()}${cls.slice(1)}`;
  item(id, `${material}_${cls}`, display, {
    stack: 1,
    burnTime: material === 'wood' ? 10 : 0,
    tool: {
      class: cls,
      tier: s.tier,
      speed: s.speed,
      durability: s.durability,
      damage: cls === 'sword' ? s.damage
        : cls === 'axe' ? s.damage + 1        // hits hard but slowly (see WEAPON_STATS)
          : cls === 'spear' ? s.damage - 1    // longer reach, bigger knockback
            : Math.max(1, s.damage - 3),
    },
  });
}

item(I.STICK, 'stick', 'Stick', { burnTime: 5 });
item(I.COAL, 'coal', 'Coal', { burnTime: 80 });
item(I.IRON_INGOT, 'iron_ingot', 'Iron Ingot');
item(I.GOLD_INGOT, 'gold_ingot', 'Gold Ingot');
item(I.DIAMOND, 'diamond', 'Diamond');
item(I.REDSTONE_DUST, 'redstone_dust', 'Redstone Dust');
item(I.PORKCHOP_RAW, 'porkchop_raw', 'Raw Porkchop', { food: 3, sat: 1.8 });
item(I.PORKCHOP_COOKED, 'porkchop_cooked', 'Cooked Porkchop', { food: 8, sat: 12.8 });
item(I.APPLE, 'apple', 'Apple', { food: 4, sat: 2.4 });
item(I.ROTTEN_FLESH, 'rotten_flesh', 'Rotten Flesh', { food: 2, sat: 0.4, sickly: 0.8 });
item(I.MUTTON_RAW, 'mutton_raw', 'Raw Mutton', { food: 2, sat: 1.2 });
item(I.MUTTON_COOKED, 'mutton_cooked', 'Cooked Mutton', { food: 6, sat: 9.6 });
item(I.BRICK_ITEM, 'brick_item', 'Brick');
item(I.CLAY_BALL, 'clay_ball', 'Clay Ball');
item(I.WHEAT_SEEDS, 'wheat_seeds', 'Wheat Seeds', { places: B.WHEAT_0 });
item(I.WHEAT, 'wheat', 'Wheat');
item(I.BREAD, 'bread', 'Bread', { food: 5, sat: 6 });
item(I.BONE, 'bone', 'Bone');
item(I.BONE_MEAL, 'bone_meal', 'Bone Meal');
item(I.STRING, 'string', 'String');
item(I.GUNPOWDER, 'gunpowder', 'Gunpowder');
item(I.BOW, 'bow', 'Bow', { stack: 1, bow: { durability: 384 }, burnTime: 10 });
item(I.ARROW, 'arrow', 'Arrow');
item(I.FLINT, 'flint', 'Flint');
item(I.FEATHER, 'feather', 'Feather');
item(I.LEATHER, 'leather', 'Leather');
item(I.BEEF_RAW, 'beef_raw', 'Raw Beef', { food: 3, sat: 1.8 });
item(I.BEEF_COOKED, 'beef_cooked', 'Steak', { food: 8, sat: 12.8 });
item(I.CHICKEN_RAW, 'chicken_raw', 'Raw Chicken', { food: 2, sat: 1.2, sickly: 0.3 });
item(I.CHICKEN_COOKED, 'chicken_cooked', 'Cooked Chicken', { food: 6, sat: 7.2 });
item(I.FISH_RAW, 'fish_raw', 'Raw Fish', { food: 2, sat: 0.4 });
item(I.FISH_COOKED, 'fish_cooked', 'Cooked Fish', { food: 5, sat: 6 });
item(I.CHARCOAL, 'charcoal', 'Charcoal', { burnTime: 80 });
item(I.PAPER, 'paper', 'Paper');
item(I.BOOK, 'book', 'Book');
item(I.BOWL, 'bowl', 'Bowl', { burnTime: 5 });
item(I.BUCKET, 'bucket', 'Bucket', { stack: 16 });
item(I.WATER_BUCKET, 'water_bucket', 'Water Bucket', { stack: 1 });
item(I.LAVA_BUCKET, 'lava_bucket', 'Lava Bucket', { stack: 1 });
item(I.MILK_BUCKET, 'milk_bucket', 'Milk Bucket', { stack: 1, drink: true, returns: I.BUCKET });
item(I.SNOWBALL, 'snowball', 'Snowball', { stack: 16 });
item(I.DRIED_KELP, 'dried_kelp', 'Dried Kelp', { food: 1, eatTime: 0.8 });
item(I.FLINT_AND_STEEL, 'flint_and_steel', 'Flint and Steel', { stack: 1, tool: { class: 'igniter', tier: 0, speed: 1, durability: 64, damage: 1 } });
item(I.EGG, 'egg', 'Egg', { stack: 16 });
item(I.SUGAR, 'sugar', 'Sugar');
item(I.PUMPKIN_PIE, 'pumpkin_pie', 'Pumpkin Pie', { food: 8, sat: 4.8 });
// rendered from whales: burns twice as long as coal, and lights lanterns and torches
item(I.WHALE_OIL, 'whale_oil', 'Whale Oil', { burnTime: 160 });
item(I.FISHING_ROD, 'fishing_rod', 'Fishing Rod', { stack: 1, tool: { class: 'rod', tier: 0, speed: 1, durability: 64, damage: 1 }, burnTime: 10 });
item(I.SHEARS, 'shears', 'Shears', { stack: 1, tool: { class: 'shears', tier: 0, speed: 6, durability: 238, damage: 1 } });
item(I.GOLDEN_APPLE, 'golden_apple', 'Golden Apple', { food: 4, sat: 9.6, heal: 8 });
item(I.MUSHROOM_STEW, 'mushroom_stew', 'Mushroom Stew', { food: 6, sat: 7.2, stack: 1, returns: I.BOWL });

// armour: [material, durability multiplier, points head/chest/legs/feet]
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_BASE_DURABILITY = [11, 16, 15, 13];
for (const [mat, mult, points, ids] of [
  ['leather', 5, [1, 3, 2, 1], [I.LEATHER_HELMET, I.LEATHER_CHESTPLATE, I.LEATHER_LEGGINGS, I.LEATHER_BOOTS]],
  ['iron', 15, [2, 6, 5, 2], [I.IRON_HELMET, I.IRON_CHESTPLATE, I.IRON_LEGGINGS, I.IRON_BOOTS]],
  ['gold', 7, [2, 5, 3, 1], [I.GOLD_HELMET, I.GOLD_CHESTPLATE, I.GOLD_LEGGINGS, I.GOLD_BOOTS]],
  ['diamond', 33, [3, 8, 6, 3], [I.DIAMOND_HELMET, I.DIAMOND_CHESTPLATE, I.DIAMOND_LEGGINGS, I.DIAMOND_BOOTS]],
]) {
  ARMOR_SLOTS.forEach((piece, slot) => {
    const display = `${mat[0].toUpperCase()}${mat.slice(1)} ${piece[0].toUpperCase()}${piece.slice(1)}`;
    item(ids[slot], `${mat}_${piece}`, display, {
      stack: 1,
      armor: { slot, points: points[slot], durability: ARMOR_BASE_DURABILITY[slot] * mult },
    });
  });
}

for (const [mat, ids] of [
  ['wood', [I.WOOD_PICKAXE, I.WOOD_AXE, I.WOOD_SHOVEL, I.WOOD_SWORD, I.WOOD_HOE, I.WOOD_SPEAR]],
  ['stone', [I.STONE_PICKAXE, I.STONE_AXE, I.STONE_SHOVEL, I.STONE_SWORD, I.STONE_HOE, I.STONE_SPEAR]],
  ['iron', [I.IRON_PICKAXE, I.IRON_AXE, I.IRON_SHOVEL, I.IRON_SWORD, I.IRON_HOE, I.IRON_SPEAR]],
  ['gold', [I.GOLD_PICKAXE, I.GOLD_AXE, I.GOLD_SHOVEL, I.GOLD_SWORD, I.GOLD_HOE, I.GOLD_SPEAR]],
  ['diamond', [I.DIAMOND_PICKAXE, I.DIAMOND_AXE, I.DIAMOND_SHOVEL, I.DIAMOND_SWORD, I.DIAMOND_HOE, I.DIAMOND_SPEAR]],
]) {
  const [pick, axe, shovel, sword, hoe, spear] = ids;
  toolItem(pick, mat, 'pickaxe');
  toolItem(axe, mat, 'axe');
  toolItem(shovel, mat, 'shovel');
  toolItem(sword, mat, 'sword');
  toolItem(hoe, mat, 'hoe');
  toolItem(spear, mat, 'spear');
}
// the Ancient Blade: found only in temples
item(I.ANCIENT_SWORD, 'ancient_sword', 'Ancient Blade', {
  stack: 1, tool: { class: 'sword', tier: 4, speed: 8, durability: 900, damage: 8 },
});

// How each weapon class swings: seconds to a full-strength hit, extra reach
// in blocks, and extra knockback. Anything else (fists, blocks) uses `hand`.
export const WEAPON_STATS = {
  hand: { cooldown: 0.25, reach: 0, knockback: 0 },
  sword: { cooldown: 0.6, reach: 0, knockback: 0 },
  axe: { cooldown: 1.0, reach: 0, knockback: 1 },
  spear: { cooldown: 0.8, reach: 1.5, knockback: 5 },
  pickaxe: { cooldown: 0.8, reach: 0, knockback: 0 },
  shovel: { cooldown: 0.8, reach: 0, knockback: 0 },
  hoe: { cooldown: 0.5, reach: 0, knockback: 0 },
};
export function weaponStats(id) {
  return WEAPON_STATS[itemInfo(id)?.tool?.class] ?? WEAPON_STATS.hand;
}

// Burn times for block fuels
const BLOCK_BURN = new Map([
  [B.OAK_PLANKS, 15], [B.BIRCH_PLANKS, 15], [B.SPRUCE_PLANKS, 15],
  [B.OAK_LOG, 15], [B.BIRCH_LOG, 15], [B.SPRUCE_LOG, 15],
  [B.CRAFTING_TABLE, 15], [B.COAL_ORE, 0], [B.DEAD_BUSH, 5],
  [B.COAL_BLOCK, 800], [B.BOOKSHELF, 15], [B.CHEST, 15],
  [B.OAK_SAPLING, 5], [B.BIRCH_SAPLING, 5], [B.SPRUCE_SAPLING, 5],
]);

// Unified item info for any id (block or item).
export function itemInfo(id) {
  if (id < 256) {
    const b = blockInfo(id);
    return {
      id,
      name: b.name,
      display: b.display,
      texture: null,        // block items render from their block textures
      block: b,
      stack: 64,
      tool: null,
      food: 0,
      burnTime: BLOCK_BURN.get(id) ?? 0,
    };
  }
  return ITEMS.get(id) ?? null;
}

export function isBlockItem(id) {
  return id > 0 && id < 256 && !!BLOCKS[id];
}

export function maxStack(id) {
  const info = itemInfo(id);
  return info ? info.stack : 64;
}

// ---- Inventory stack helpers ----
// A stack is {id, count, dur?} or null.

export function makeStack(id, count = 1) {
  const info = itemInfo(id);
  const s = { id, count };
  if (info?.tool) s.dur = info.tool.durability;
  else if (info?.armor) s.dur = info.armor.durability;
  else if (info?.bow) s.dur = info.bow.durability;
  return s;
}

export function stacksEqual(a, b) {
  return a && b && a.id === b.id && (a.dur === undefined) === (b.dur === undefined);
}

// Try to merge stack b into a (mutates a). Returns leftover count.
export function mergeStack(a, b) {
  if (!stacksEqual(a, b) || a.dur !== undefined) return b.count;
  const room = maxStack(a.id) - a.count;
  const moved = Math.min(room, b.count);
  a.count += moved;
  return b.count - moved;
}
