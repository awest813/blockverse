// Trading with villagers: each job buys some of what the ranch and the
// kitchen make, and sells a few useful things. Every offer has a few uses
// and comes back over a day (while you're away too); a villager's level
// rises with trade, adding offers; and what you sell piles up in that
// village and its price sags, as at your own stall (recovering with time),
// so selling eggs to the next village over doesn't spoil the price here.
//
// On the resident (worldMeta.villages[id].residents[i]): level, xp, stock
// {key: uses left}, stockAt; on the village record: market {glut, at, credit}.

import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { worldClock } from '../core/clock.js';
import { DAY_LENGTH_SECONDS } from '../core/constants.js';
import { SELLS } from './market.js';

// buys: [item, coins apiece at their best (default: the market's price), level]
// sells: [item, coins, uses a day, level]
// (each sale price is well over what anyone pays for the thing, the
// trader's twice-the-market wants included: nothing bought here sells on
// at a profit)
export const TRADES = {
  farmer: {
    buys: [[I.WHEAT], [I.CARROT], [I.POTATO], [I.BEETROOT, null, 2], [B.PUMPKIN, null, 2], [B.MELON, null, 3]],
    sells: [[I.BREAD, 5, 6], [I.WHEAT_SEEDS, 1, 8], [I.BEETROOT_SEEDS, 1, 8], [I.PUMPKIN_SEEDS, 2, 4, 2], [I.MELON_SEEDS, 3, 4, 2], [I.BONE_MEAL, 2, 8, 2], [I.GOLDEN_CARROT, 7, 2, 4]],
  },
  smith: {
    buys: [[I.COAL, 1], [B.IRON_ORE, 2], [I.FLINT, 0.5], [I.IRON_INGOT, 3, 2], [I.GOLD_INGOT, 5, 3], [I.DIAMOND, 12, 4]],
    sells: [[I.SHEARS, 5, 2], [I.BUCKET, 6, 2], [I.IRON_PICKAXE, 12, 1], [I.IRON_SWORD, 10, 1], [I.IRON_AXE, 10, 1, 2], [I.IRON_HELMET, 10, 1, 2], [I.IRON_BOOTS, 9, 1, 3], [I.IRON_LEGGINGS, 18, 1, 3], [I.IRON_CHESTPLATE, 22, 1, 3], [I.SADDLE, 16, 1, 3], [I.IRON_HORSE_ARMOR, 26, 1, 4]],
  },
  cook: {
    buys: [[B.MUSHROOM_BROWN], [B.MUSHROOM_RED], [I.RICE], [I.EGG], [I.FISH_RAW, 1.5, 2], [I.MILK_BUCKET, null, 2], [I.SCORCH_PEPPER, null, 3], [I.BUTTER, null, 3]],
    sells: [[I.COOKIE, 2, 8], [I.MUSHROOM_SOUP, 7, 3], [I.PUMPKIN_PIE, 6, 3, 2], [I.HEARTY_STEW, 10, 2, 3], [I.FISH_AND_CHIPS, 21, 2, 3], [B.CAKE, 46, 1, 4]],
  },
  librarian: {
    buys: [[I.PAPER, 0.5], [I.FEATHER], [I.BOOK, 3, 2], [B.CANDLE, null, 3]],
    sells: [[I.BOOK, 4, 3], [I.NAME_TAG, 6, 2], [I.LEDGER, 6, 1, 2], [B.BOOKSHELF, 8, 2, 2], [B.LANTERN, 4, 4, 3], [I.GOLDEN_APPLE, 24, 1, 4]],
  },
  shepherd: {
    buys: [[B.WOOL], [I.MUTTON_RAW], [I.STRING, 0.5], [I.WHEAT, null, 2], [B.HAY_BALE, null, 3]],
    sells: [[I.SHEARS, 5, 2], [B.RED_WOOL, 5, 4], [B.BLUE_WOOL, 5, 4, 2], [B.YELLOW_WOOL, 5, 4, 2], [B.WHITE_CARPET, 3, 6, 2], [B.BED, 10, 1, 3], [B.BLACK_WOOL, 6, 4, 4]],
  },
  butcher: {
    buys: [[I.BEEF_RAW], [I.PORKCHOP_RAW], [I.MUTTON_RAW], [I.CHICKEN_RAW], [I.COAL, 1], [I.DUCK_RAW, null, 2]],
    sells: [[I.PORKCHOP_COOKED, 5, 4], [I.BEEF_COOKED, 5, 4], [I.CHICKEN_COOKED, 4, 4, 2], [I.LEATHER, 6, 3, 2], [I.LEAD, 4, 2, 3], [I.BEEF_STEW, 9, 2, 3], [I.HEARTY_STEW, 10, 2, 4]],
  },
  beekeeper: {
    buys: [[B.DANDELION, 0.5], [B.POPPY, 0.5], [B.CORNFLOWER, 0.5], [I.SUGAR, 1, 2], [I.HONEYCOMB, null, 2], [I.BOWL, 0.5, 3]],
    sells: [[I.HONEYCOMB, 5, 4], [B.CANDLE, 6, 4], [I.HONEY_BOWL, 11, 2, 2], [I.HONEY_BREAD, 9, 2, 3], [B.BEEHIVE, 12, 1, 3], [I.TOFFEE_APPLE, 9, 2, 4]],
  },
  fisher: {
    buys: [[I.STRING, 0.5], [I.STICK, 0.25], [I.FEATHER, null, 2], [I.BREAD, null, 3]],
    sells: [[I.FISH_RAW, 3, 6], [I.FISH_COOKED, 4, 6], [I.FISHING_ROD, 6, 1, 2], [I.DRIED_KELP, 1, 8, 2], [I.SUSHI, 8, 2, 3], [I.FISH_CHOWDER, 9, 2, 4]],
  },
  stablehand: {
    buys: [[I.WHEAT], [B.HAY_BALE], [I.APPLE, 1], [I.CARROT, null, 2], [I.LEATHER, null, 2]],
    sells: [[I.LEAD, 4, 3], [I.SADDLE, 15, 1, 2], [I.LEATHER_HORSE_ARMOR, 8, 1, 2], [I.WHISTLE, 9, 1, 3], [I.IRON_HORSE_ARMOR, 26, 1, 3], [I.GOLD_HORSE_ARMOR, 30, 1, 4], [I.GOLDEN_CARROT, 7, 2, 4]],
  },
};

const PAYS = 1.2;          // a village pays a fifth over the market's price (it's a walk)
const BUY_USES = 16;       // of each thing a villager buys, a day
const GLUT = 32;           // (as the market: this much piled up halves the price)
const RECOVER = 1200;      // seconds for a pile to shrink to a third
export const LEVELS = [0, 20, 60, 150];   // xp (coins traded) for levels 1-4
export const LEVEL_NAMES = ['', 'Novice', 'Apprentice', 'Journeyman', 'Master'];

const base = (id, set) => set ?? SELLS.get(id) ?? 0;
const levelOf = (xp) => LEVELS.filter((n) => xp >= n).length;

// the village's market (its glut drains away with time; anything damaged goes)
function market(rec) {
  if (!rec.market || typeof rec.market !== 'object' || Array.isArray(rec.market)) rec.market = {};
  const m = rec.market;
  if (!m.glut || typeof m.glut !== 'object' || Array.isArray(m.glut)) m.glut = {};
  const now = worldClock.now, dt = Number.isFinite(m.at) ? Math.max(0, now - m.at) : 0;
  m.at = now;
  const k = dt > 0 ? Math.exp(-dt / RECOVER) : 1;
  for (const id of Object.keys(m.glut)) {
    const v = m.glut[id];
    if (!(typeof v === 'number' && v * k >= 0.5)) delete m.glut[id];
    else m.glut[id] = Math.min(v * k, 1e4);
  }
  if (!Number.isFinite(m.credit) || m.credit < 0 || m.credit >= 1) m.credit = 0;
  return m;
}

// r's level, xp and stock, topped up for the time gone by
function stock(r) {
  if (!Number.isFinite(r.xp) || r.xp < 0) r.xp = 0;
  r.xp = Math.min(r.xp, 1e6);
  r.level = levelOf(r.xp);
  if (!r.stock || typeof r.stock !== 'object' || Array.isArray(r.stock)) r.stock = {};
  const now = worldClock.now, dt = Number.isFinite(r.stockAt) ? Math.max(0, now - r.stockAt) : DAY_LENGTH_SECONDS;
  r.stockAt = now;
  const T = TRADES[r.job];
  if (!T) return null;
  const fill = (key, uses) => {
    const had = Number.isFinite(r.stock[key]) ? Math.max(0, Math.min(uses, r.stock[key])) : uses;
    r.stock[key] = Math.min(uses, had + (uses * dt) / DAY_LENGTH_SECONDS);
  };
  for (const [id] of T.buys) fill(`b${id}`, BUY_USES);
  for (const [id, , uses] of T.sells) fill(`s${id}`, uses);
  return T;
}

// What r trades now: {level, buys: [{id, price, left}], sells: [{id, price, left}]}
// (buys priced apiece now; what r won't take yet is left out)
export function offers(rec, r) {
  const T = stock(r);
  if (!T) return null;
  const m = market(rec);
  const buys = T.buys.filter(([, , lvl = 1]) => r.level >= lvl).map(([id, set]) => ({ id, price: (base(id, set) * PAYS) / (1 + (m.glut[id] ?? 0) / GLUT), left: Math.floor(r.stock[`b${id}`] + 1e-9) }));
  const sells = T.sells.filter(([, , , lvl = 1]) => r.level >= lvl).map(([id, price]) => ({ id, price, left: Math.floor(r.stock[`s${id}`] + 1e-9) }));
  return { level: r.level, buys, sells, next: LEVELS[r.level] ?? null };
}

// what selling n of id to r would pay (whole coins with what's on account),
// without selling it
export function quoteTo(rec, r, id, n) {
  const T = stock(r), m = market(rec), at = T?.buys.find(([b]) => b === id);
  if (!at) return 0;
  n = Math.min(n, Math.floor(r.stock[`b${id}`] + 1e-9));
  let total = m.credit, g = m.glut[id] ?? 0;
  for (let i = 0; i < n; i++, g++) total += (base(id, at[1]) * PAYS) / (1 + g / GLUT);
  return Math.floor(total + 1e-9);
}

// Sell n of id to r: {sold, coins} (each one sags the price for the next;
// the odd part of a coin stays on account with the village)
export function sellTo(rec, r, id, n) {
  const T = stock(r), m = market(rec), at = T?.buys.find(([b, , lvl = 1]) => b === id && r.level >= lvl);
  if (!at) return { sold: 0, coins: 0 };
  n = Math.min(n, Math.floor(r.stock[`b${id}`] + 1e-9));
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += (base(id, at[1]) * PAYS) / (1 + (m.glut[id] ?? 0) / GLUT);
    m.glut[id] = (m.glut[id] ?? 0) + 1;
  }
  r.stock[`b${id}`] -= n;
  m.credit += total;
  const coins = Math.floor(m.credit + 1e-9);
  m.credit -= coins;
  r.xp += total;
  return { sold: n, coins };
}

// Buy one id from r: its price, or 0 if r hasn't one to sell
export function buyFrom(rec, r, id) {
  const T = stock(r), at = T?.sells.find(([s, , , lvl = 1]) => s === id && r.level >= lvl);
  if (!at || r.stock[`s${id}`] < 1 - 1e-9) return 0;
  r.stock[`s${id}`] -= 1;
  r.xp += at[1];
  return at[1];
}

// (for the checks: every sale price against what the thing fetches anywhere)
export function arbitrage(premium = 2.2) {
  const bad = [];
  for (const [job, T] of Object.entries(TRADES)) {
    for (const [id, price] of T.sells) {
      const best = Math.max(SELLS.get(id) ?? 0, ...Object.values(TRADES).flatMap((t) => t.buys.filter(([b]) => b === id).map(([b, set]) => base(b, set) * PAYS)));
      if (price < best * premium && best > 0) bad.push([job, id, price, best]);
    }
  }
  return bad;
}
