// The market stall: sell what the ranch makes for coins, and buy what a
// rancher needs. What you sell piles up at the market and its price sags
// (sell thirty-odd of one thing and it fetches half), recovering as the
// world's clock runs on, so a ranch that makes many things does better than
// one that floods it with eggs.
//
// Also the ranch's tally (eggs laid, wool shorn, milk, butter, cheese,
// honey, young born, coins earned) for the ledger.
// worldMeta.market = {glut: {id: amount}, at, credit}; worldMeta.ranchStats = {...}

import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { worldClock } from '../core/clock.js';
import { COLOURS } from '../items/dyes.js';

// what the market buys: coins apiece, at their best (empty bucket or bowl back with a full one)
export const SELLS = new Map([
  [I.EGG, 1], [I.DUCK_EGG, 1.5], [I.MILK_BUCKET, 4], [I.GOAT_MILK_BUCKET, 5], [I.BUTTER, 3], [I.CHEESE, 6],
  [I.HONEY_BOWL, 5], [I.LEATHER, 2], [I.FEATHER, 0.5],
  [I.BEEF_RAW, 2], [I.PORKCHOP_RAW, 2], [I.MUTTON_RAW, 2], [I.CHICKEN_RAW, 1.5], [I.DUCK_RAW, 1.5],
  [I.WHEAT, 0.5], [I.BERRIES, 0.75], [I.RICE, 0.5], [I.MELON_SLICE, 0.5], [B.MELON, 4], [I.HONEYCOMB, 2], [B.CANDLE, 3], [I.CARROT, 0.5], [I.POTATO, 0.5], [I.BEETROOT, 0.75], [B.PUMPKIN, 3], [I.SCORCH_PEPPER, 4], [B.HAY_BALE, 5],
  [I.CHEESE_SANDWICH, 9], [I.BERRY_PIE, 8], [I.FRIED_RICE, 9], [I.PANCAKES, 6], [I.BUTTERED_POTATO, 6], [I.HONEY_BREAD, 6], [I.SPICY_STEW, 10], [I.BEETROOT_SOUP, 5],
  [I.OMELETTE, 8], [I.FISH_AND_CHIPS, 9], [I.TOFFEE_APPLE, 4], [I.RICE_BALL, 2], [I.COOKIE, 0.5], [I.MUSHROOM_SOUP, 7], [B.MUSHROOM_BROWN, 0.5], [B.MUSHROOM_RED, 0.5],
  [B.CAKE, 14],
  ...COLOURS.map((c) => [c.wool, c.key === 'white' ? 2 : 3]),   // (dyed wool fetches more)
]);
export const RETURNS = new Map([[I.MILK_BUCKET, I.BUCKET], [I.GOAT_MILK_BUCKET, I.BUCKET], [I.HONEY_BOWL, I.BOWL], [I.SPICY_STEW, I.BOWL], [I.BEETROOT_SOUP, I.BOWL], [I.MUSHROOM_SOUP, I.BOWL]]);

// what it sells: coins apiece
export const BUYS = [
  [I.NAME_TAG, 6], [I.LEAD, 4], [I.SADDLE, 18], [I.WHISTLE, 10], [I.GOLDEN_CARROT, 8],
  [I.IRON_HORSE_ARMOR, 30], [I.DIAMOND_HORSE_ARMOR, 90],
  [I.BEETROOT_SEEDS, 1], [I.PUMPKIN_SEEDS, 2], [I.RICE, 2], [I.BERRIES, 2], [B.CORNFLOWER, 2], [I.MELON_SEEDS, 3], [I.BONE_MEAL, 1], [B.BEEHIVE, 12], [B.NEST, 4],
  [I.RED_DYE, 2], [I.YELLOW_DYE, 2], [I.GREEN_DYE, 3], [I.BLACK_DYE, 2], [I.PINK_DYE, 3], [I.ORANGE_DYE, 3],
];

const GLUT = 32;          // this much of one thing piled up halves its price
const RECOVER = 1200;     // seconds of the world's clock for a pile to shrink to a third

function market(meta) {
  if (!meta.market || typeof meta.market !== 'object' || Array.isArray(meta.market)) meta.market = {};
  const m = meta.market;
  if (!m.glut || typeof m.glut !== 'object') m.glut = {};
  // what's been sold drains away as time passes
  const now = worldClock.now, dt = Number.isFinite(m.at) ? Math.max(0, now - m.at) : 0;
  m.at = Math.round(now);
  if (dt > 0) {
    const k = Math.exp(-dt / RECOVER);
    for (const id of Object.keys(m.glut)) {
      const v = (Number(m.glut[id]) || 0) * k;
      if (v < 0.5) delete m.glut[id]; else m.glut[id] = v;
    }
  }
  if (!Number.isFinite(m.credit) || m.credit < 0) m.credit = 0;
  return m;
}

// what one of `id` fetches now (0: the market won't take it)
export function priceOf(meta, id) {
  const base = SELLS.get(id);
  if (!base) return 0;
  const glut = market(meta).glut[id] ?? 0;
  return base / (1 + glut / GLUT);
}

// Sell n of id: returns whole coins paid (the odd part of a coin is kept
// on account for the next sale).
export function sell(meta, id, n) {
  const m = market(meta);
  m.credit += sellValue(meta, id, n);
  const coins = Math.floor(m.credit + 1e-9);
  m.credit -= coins;
  bump(meta, 'coins', coins);
  return coins;
}

// What n of id fetch, one after another (each one sold sags the price for
// the next), counted into the market's glut. Coins as a fraction: the
// caller decides where the odd part goes.
export function sellValue(meta, id, n, premium = 1) {
  const m = market(meta);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += (SELLS.get(id) ?? 0) * premium / (1 + (m.glut[id] ?? 0) / GLUT);
    m.glut[id] = (m.glut[id] ?? 0) + 1;
  }
  return total;
}

// ---- the ranch's tally ----

let stats = null;
export function bindStats(meta) {
  if (!meta.ranchStats || typeof meta.ranchStats !== 'object') meta.ranchStats = {};
  stats = meta.ranchStats;
}
export function bump(meta, key, n = 1) {
  const s = meta ? (meta.ranchStats ??= {}) : stats;
  if (!s || !(n > 0)) return;
  s[key] = (Number.isFinite(s[key]) ? s[key] : 0) + n;
}
export const tally = (key, n = 1) => bump(null, key, n);
