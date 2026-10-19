// Your market stall's shelf: put things out on it, and by day customers
// walk up and buy them, paying a little over what the market gives on the
// spot (they're buying from a stall, not selling in bulk), into the stall's
// till. Customers come while you're away too, a few a day at most, and the
// till waits for you.
//
// Block entity: {kind: 'stall', slots: [{id, count} | null x9], till: coins
// (a fraction carries over), empties: {id: count} (buckets and bowls they
// hand back), at: clock when last seen to, sold: {id: count} since you last
// looked, next: clock when the next customer sets out}

import { I } from '../items/itemIds.js';
import { B } from '../blocks/blocks.js';
import { SELLS, RETURNS, priceOf, sellValue, bump } from './market.js';
import { COLOURS } from '../items/dyes.js';
import { DAY_LENGTH_SECONDS } from '../core/constants.js';

export const SHELF = 9;
export const PREMIUM = 1.25;           // over the market's on-the-spot price
export const CUSTOMER_EVERY = 75;      // seconds between customers, on average, by day
const AWAY_PER_DAY = 6;                // customers a day while you're away...
const AWAY_MAX = 12;                   // ...and at most this many, however long
const TILL_MAX = 20000;                // (more than a full shelf of the dearest thing ever fetches)

// who comes, and what each is after
const DAIRY = [I.EGG, I.DUCK_EGG, I.MILK_BUCKET, I.GOAT_MILK_BUCKET, I.BUTTER, I.CHEESE];
const CROPS = [I.WHEAT, I.BERRIES, I.RICE, I.MELON_SLICE, B.MELON, I.CARROT, I.POTATO, I.BEETROOT, B.PUMPKIN, I.SCORCH_PEPPER, B.HAY_BALE, B.MUSHROOM_BROWN, B.MUSHROOM_RED];
const MEAT = [I.BEEF_RAW, I.PORKCHOP_RAW, I.MUTTON_RAW, I.CHICKEN_RAW, I.DUCK_RAW, I.LEATHER, I.FEATHER];
const WOOL = COLOURS.map((c) => c.wool);
export const CUSTOMERS = [
  { job: 'cook', label: 'A cook', wants: [...DAIRY, ...MEAT.slice(0, 5), I.RICE, I.SCORCH_PEPPER, B.MUSHROOM_BROWN, I.HONEY_BOWL], colours: [0xf0ece0, 0x9a3a2a] },
  { job: 'farmhand', label: 'A farmhand', wants: [...CROPS, I.EGG, I.LEATHER], colours: [0x6a8a3a, 0x8a6a3a] },
  { job: 'tailor', label: 'A tailor', wants: [...WOOL, I.LEATHER, I.FEATHER, B.CANDLE], colours: [0x3a5a9a, 0xd0c060] },
  { job: 'neighbour', label: 'A neighbour', wants: null, colours: [0xa04a6a, 0x5a4a3a] },   // (anything that's there)
];

// the stall's state at (x, y, z), made sound (an imported save may say anything)
export function stallState(world, x, y, z) {
  let st = world.blockEntityAt(x, y, z);
  if (!st || st.kind !== 'stall') { st = { kind: 'stall' }; world.setBlockEntity(x, y, z, st); }
  if (!Array.isArray(st.slots) || st.slots.length !== SHELF) st.slots = new Array(SHELF).fill(null);
  st.slots = st.slots.map((s) => (s && Number.isInteger(s.id) && SELLS.has(s.id) && Number.isInteger(s.count) && s.count > 0 ? { id: s.id, count: Math.min(64, s.count) } : null));
  if (!Number.isFinite(st.till) || st.till < 0) st.till = 0;
  st.till = Math.min(st.till, TILL_MAX);
  if (!st.empties || typeof st.empties !== 'object' || Array.isArray(st.empties)) st.empties = {};
  for (const k of Object.keys(st.empties)) {
    if (!(Number.isInteger(st.empties[k]) && st.empties[k] > 0 && [I.BUCKET, I.BOWL].includes(Number(k)))) delete st.empties[k];
    else st.empties[k] = Math.min(st.empties[k], SHELF * 64);
  }
  if (!st.sold || typeof st.sold !== 'object' || Array.isArray(st.sold)) st.sold = {};
  return st;
}

export const shelfCount = (st, id) => st.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
export const shelfEmpty = (st) => st.slots.every((s) => !s);

// put up to n of id on the shelf: how many went on
export function shelve(st, id, n) {
  let left = n;
  for (const s of st.slots) if (s?.id === id && left > 0) { const k = Math.min(64 - s.count, left); s.count += k; left -= k; }
  for (let i = 0; i < SHELF && left > 0; i++) if (!st.slots[i]) { const k = Math.min(64, left); st.slots[i] = { id, count: k }; left -= k; }
  return n - left;
}

// take up to n of id off the shelf: how many came off
export function unshelve(st, id, n) {
  let left = n;
  for (let i = SHELF - 1; i >= 0 && left > 0; i--) {
    const s = st.slots[i];
    if (s?.id !== id) continue;
    const k = Math.min(s.count, left);
    s.count -= k; left -= k;
    if (!s.count) st.slots[i] = null;
  }
  return n - left;
}

// what a customer pays for one now
export const shelfPrice = (meta, id) => priceOf(meta, id) * PREMIUM;

// A customer of this kind buys what it likes off the shelf (one to three
// things): [{id, n}] bought, coins into the till. Nothing it wants: [].
export function customerBuys(meta, st, type, rng = Math.random) {
  const on = [...new Set(st.slots.filter(Boolean).map((s) => s.id))].filter((id) => !type.wants || type.wants.includes(id));
  if (!on.length) return [];
  const bought = [];
  const kinds = 1 + Math.floor(rng() * Math.min(2, on.length));
  for (let k = 0; k < kinds && on.length; k++) {
    const id = on.splice(Math.floor(rng() * on.length), 1)[0];
    // a dear thing one at a time; cheap ones by the handful
    const each = shelfPrice(meta, id);
    const want = each >= 4 ? 1 + Math.floor(rng() * 2) : each >= 1 ? 2 + Math.floor(rng() * 4) : 4 + Math.floor(rng() * 9);
    const n = unshelve(st, id, Math.min(want, shelfCount(st, id)));
    if (!n) continue;
    const coins = sellValue(meta, id, n, PREMIUM);
    st.till += coins;
    bump(meta, 'coins', coins);
    const back = RETURNS.get(id);
    if (back) st.empties[back] = (st.empties[back] ?? 0) + n;
    st.sold[id] = (st.sold[id] ?? 0) + n;
    bought.push({ id, n, coins });
  }
  if (bought.length) bump(meta, 'customers', 1);
  return bought;
}

// a customer type for what's on the shelf (picked by something that's there)
export function pickCustomer(st, rng = Math.random) {
  const items = st.slots.filter(Boolean);
  if (!items.length) return null;
  const id = items[Math.floor(rng() * items.length)].id;
  const fits = CUSTOMERS.filter((c) => !c.wants || c.wants.includes(id));
  return fits[Math.floor(rng() * fits.length)];
}

// Customers who came while you were away (only by day: about half the
// clock), from st.at to now. Returns how many came and what they paid.
export function catchUp(meta, st, now, rng = Math.random) {
  const since = Number.isFinite(st.at) ? Math.max(0, now - st.at) : 0;
  st.at = now;
  let n = Math.min(AWAY_MAX, Math.floor((since / DAY_LENGTH_SECONDS) * AWAY_PER_DAY + rng()));
  if (since < CUSTOMER_EVERY * 2) n = 0;   // (you were here: the live ones did the buying)
  let came = 0, coins = 0;
  for (let i = 0; i < n && !shelfEmpty(st); i++) {
    const got = customerBuys(meta, st, pickCustomer(st, rng), rng);
    if (got.length) { came++; coins += got.reduce((a, b) => a + b.coins, 0); }
  }
  return { came, coins };
}

// what's in it, for when it's broken: the shelf, the till's whole coins, the empties
export function stallContents(st) {
  if (!st) return [];
  const out = (Array.isArray(st.slots) ? st.slots : []).filter((s) => s && Number.isInteger(s.id) && s.count > 0).map((s) => ({ id: s.id, count: s.count }));
  const coins = Math.floor(Number.isFinite(st.till) ? Math.min(TILL_MAX, Math.max(0, st.till)) : 0);
  for (let c = coins; c > 0; c -= 64) out.push({ id: I.COIN, count: Math.min(64, c) });
  for (const [k, v] of Object.entries(st.empties ?? {})) {
    if (!(Number.isInteger(v) && v > 0 && [I.BUCKET, I.BOWL].includes(Number(k)))) continue;
    for (let c = Math.min(v, SHELF * 64); c > 0; c -= 64) out.push({ id: Number(k), count: Math.min(64, c) });
  }
  return out;
}
