// The ranch's two windows: the market stall (sell produce, buy goods) and
// the ledger (every animal that's yours, wherever it is, and what the ranch
// has made).

import { I } from '../items/itemIds.js';
import { itemInfo } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { SELLS, RETURNS, BUYS, priceOf, sell, bump, quote, onAccount } from '../world/market.js';
import { describeAnimal } from '../entities/inspect.js';
import { B } from '../blocks/blocks.js';
import { stallState, shelve, unshelve, shelfCount, shelfPrice, catchUp } from '../world/stall.js';
import { hurryCustomer } from '../entities/customers.js';
import { worldClock } from '../core/clock.js';
import { offers, sellTo, buyFrom, quoteTo, LEVEL_NAMES } from '../world/villageTrade.js';
import { villageRecord, JOB_LABEL } from '../entities/villagers.js';

const name = (id) => itemInfo(id)?.display ?? '?';

// into the pack; what doesn't fit drops at your feet (just that, not the lot)
function giveOrDrop(g, id, n) {
  const p = g.player;
  if (!(n > 0)) return;
  const left = p.give(id, n);
  if (left > 0) g.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id, count: left }]);
}
// an animal kind for people: 'polarbear' -> 'polar bear', and its plural
const KIND_NAMES = { polarbear: 'polar bear', bonearcher: 'bone archer', cinderhound: 'cinder hound', broodmother: 'brood mother' };
const KIND_PLURALS = { sheep: 'sheep', fish: 'fish', fox: 'foxes', wolf: 'wolves', whelp: 'whelps', sloth: 'sloths', polarbear: 'polar bears', capybara: 'capybaras', cinderhound: 'cinder hounds' };
const kindName = (k) => KIND_NAMES[k] ?? k;
const kindPlural = (k, n) => (n === 1 ? kindName(k) : KIND_PLURALS[k] ?? `${kindName(k)}s`);
const coinsText = (v) => (v >= 10 ? `${Math.round(v)}` : v.toFixed(1).replace(/\.0$/, ''));
// '2 coins', '1 coin', '0.5 coins' (by what's shown: 0.99 shows as 1)
const coinsOf = (v) => { const t = coinsText(v); return `${t} coin${t === '1' ? '' : 's'}`; };

export class RanchPanel {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.kind = null;
  }

  isOpen() { return !!this.kind; }

  close() {
    if (!this.kind) return;
    this.kind = null;
    this.root.innerHTML = '';
    this.game.setUiOpen(false);
    this.game.input.requestLock();
  }

  // the window's frame; fill(win) adds the rest
  frame(title, fill) {
    const old = this.root.querySelector('.ranch-panel');
    const fresh = !old;   // (not a redraw after a sale)
    // a redraw keeps your place: the button you were on (or the one that
    // takes its place, if its row has gone) and how far down you'd scrolled
    const was = document.activeElement, focusKey = was?.dataset?.act;
    const kin = (root, key) => [...root.querySelectorAll('section, .ranch-list')].map((sec) => [...sec.querySelectorAll('button[data-act]')].filter((b) => b.dataset.act.split('|')[0] === key.split('|')[0]));
    const oldKin = old && focusKey ? kin(old, focusKey) : [];
    const sec = oldKin.findIndex((list) => list.includes(was)), focusAt = sec < 0 ? -1 : oldKin[sec].indexOf(was);
    const scrolls = old ? [...old.querySelectorAll('.ranch-cols, .ranch-list'), old].map((e) => e.scrollTop) : [];
    this.root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'screen dim container-screen';
    const win = document.createElement('div');
    win.className = 'inv-window ranch-panel';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', title);
    win.setAttribute('aria-modal', 'true');
    const h = document.createElement('h3');
    h.textContent = title;
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'inv-close'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => this.close());
    win.append(h, x);
    fill(win);
    screen.appendChild(win);
    screen.addEventListener('mousedown', (e) => { if (e.target === screen) this.close(); });
    this.root.appendChild(screen);
    if (fresh) { x.focus({ preventScroll: true }); return; }   // (keys and a gamepad start inside the window)
    [...win.querySelectorAll('.ranch-cols, .ranch-list'), win].forEach((e, i) => { if (scrolls[i]) e.scrollTop = scrolls[i]; });
    if (focusAt < 0) return;
    // the same button, or the same action on the row that's taken its place
    // in that column (the next one down, or the last), or the close button
    const same = [...win.querySelectorAll('button[data-act]')].find((b) => b.dataset.act === focusKey && !b.disabled);
    const list = (kin(win, focusKey)[sec] ?? []).filter((b) => !b.disabled);
    (same ?? list[Math.min(focusAt, list.length - 1)] ?? x).focus({ preventScroll: true });
  }

  row(icon, text, sub, buttons) {
    const r = document.createElement('div');
    r.className = 'ranch-row';
    const img = document.createElement('img');
    img.alt = '';
    if (icon) img.src = this.game.atlas.icon(icon);
    const t = document.createElement('div');
    t.className = 'ranch-text';
    t.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; t.appendChild(s); }
    r.append(img, t);
    for (const [label, fn, disabled] of buttons) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn small'; b.textContent = label; b.disabled = !!disabled;
      // (which thing it's for, to a screen reader; and a key to find it again after a redraw)
      b.setAttribute('aria-label', `${label}: ${text}`);
      b.dataset.act = `${label.replace(/ \(.*\)$/, '')}|${icon ?? text}`;
      b.addEventListener('click', fn);
      r.appendChild(b);
    }
    return r;
  }

  // ---- the market ----

  // t: the stall you're at (its shelf and till), if any
  openMarket(t = null) {
    this.kind = 'market';
    this.stallAt = t && t.id === B.MARKET_STALL ? { x: t.x, y: t.y, z: t.z } : null;
    const st = this.stall();
    if (st) { catchUp(this.game.worldMeta, st, worldClock.now); this.saveStall(st); }
    this.game.setUiOpen(true);
    this.renderMarket();
  }

  // the stall's shelf and till (null if it's gone)
  stall() {
    const s = this.stallAt, w = this.game.world;
    if (!s || w.getBlockW(s.x, s.y, s.z) !== B.MARKET_STALL) return null;
    return stallState(w, s.x, s.y, s.z);
  }
  saveStall(st) { const s = this.stallAt; this.game.world.setBlockEntity(s.x, s.y, s.z, st); }

  // the shelf: what's on it, and the till
  renderShelf(win, st) {
    const g = this.game, meta = g.worldMeta;
    const box = document.createElement('section');
    box.className = 'ranch-shelf';
    box.innerHTML = '<h4>Your shelf</h4>';
    const coins = Math.floor(st.till), empties = Object.entries(st.empties).filter(([, v]) => v > 0);
    const extra = empties.map(([k, v]) => `${v} ${name(Number(k)).toLowerCase()}${v === 1 ? '' : 's'}`).join(', ');
    const sold = Object.entries(st.sold).map(([k, v]) => `${name(Number(k)).toLowerCase()} ×${v}`).join(', ');
    box.appendChild(this.row(I.COIN, `Till: ${coins} coin${coins === 1 ? '' : 's'}${extra ? ` and ${extra}` : ''}`, sold ? `sold since you last looked: ${sold}` : '', [['Collect', () => this.collect(), !coins && !extra]]));
    const on = [...new Set(st.slots.filter(Boolean).map((s) => s.id))];
    if (!on.length) box.append(Object.assign(document.createElement('p'), { className: 'ranch-empty', textContent: 'Put things out (Shelve) and customers come by day to buy them, paying a quarter more than the market does on the spot. They come while you\u2019re away too.' }));
    for (const id of on) {
      const n = shelfCount(st, id), price = shelfPrice(meta, id);
      box.appendChild(this.row(id, `${name(id)} ×${n}`, `customers pay ${coinsOf(price)} each`, [['Take back', () => this.takeBack(id)]]));
    }
    win.appendChild(box);
  }

  shelveAll(id) {
    const g = this.game, p = g.player, st = this.stall();
    if (!st) return;
    const wasEmpty = st.slots.every((s) => !s);
    const n = shelve(st, id, p.countOf(id));
    if (!n) { g.hud.showLabel('The shelf\u2019s full'); return; }
    p.take(id, n);
    this.saveStall(st);
    if (wasEmpty) hurryCustomer(this.stallAt);   // (an empty shelf just stocked: someone's soon by; not every time)
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('place', { block: 'wood' });
    this.renderMarket();
  }

  takeBack(id) {
    const g = this.game, st = this.stall();
    if (!st) return;
    giveOrDrop(g, id, unshelve(st, id, shelfCount(st, id)));
    this.saveStall(st);
    g.player.events.dispatchEvent(new CustomEvent('inventory'));
    this.renderMarket();
  }

  collect() {
    const g = this.game, st = this.stall();
    if (!st) return;
    const coins = Math.floor(st.till);
    st.till -= coins;
    giveOrDrop(g, I.COIN, coins);
    for (const [k, v] of Object.entries(st.empties)) giveOrDrop(g, Number(k), v);
    st.empties = {}; st.sold = {};
    this.saveStall(st);
    g.player.events.dispatchEvent(new CustomEvent('inventory'));
    if (coins) g.sfx?.play('pickup', { pitch: 1.4 });
    this.renderMarket();
  }

  renderMarket() {
    const g = this.game, p = g.player, meta = g.worldMeta;
    const creative = p.mode === GAMEMODE_CREATIVE;
    this.frame('Market Stall', (win) => {
      const purse = document.createElement('p');
      purse.className = 'ranch-purse';
      // (and the odd part of a coin, kept on account from earlier sales)
      const odd = onAccount(meta);
      purse.textContent = `Your coins: ${p.countOf(I.COIN)}${odd >= 0.05 ? ` (and ${coinsText(odd)} on account, paid with your next sale)` : ''}`;
      purse.setAttribute('aria-live', 'polite');
      win.appendChild(purse);
      const st = this.stall();
      if (st) this.renderShelf(win, st);
      const full = st && st.slots.every((s) => s);
      const cols = document.createElement('div');
      cols.className = 'ranch-cols';
      // selling: what you've got that the market takes
      const sellCol = document.createElement('section');
      sellCol.innerHTML = '<h4>Sell</h4>';
      const have = [...new Set(p.inventory.filter((s) => s && SELLS.has(s.id) && s.dur === undefined).map((s) => s.id))];
      if (!have.length) sellCol.append(Object.assign(document.createElement('p'), { className: 'ranch-empty', textContent: 'Nothing the market buys: eggs, milk, butter, cheese, wool, honey, meat, crops and good food sell here.' }));
      for (const id of have) {
        const n = p.countOf(id), price = priceOf(meta, id);
        const each = `${coinsOf(price)} each${price < SELLS.get(id) * 0.8 ? ' (plenty sold lately)' : ''}`;
        // (selling a lot sags the price as it goes: say what the lot fetches)
        const all = n > 1 ? quote(meta, id, n).coins : null;
        const buttons = [['Sell 1', () => this.sell(id, 1)], [all === null ? 'Sell all' : `Sell all (${all})`, () => this.sell(id, n)]];
        if (st) buttons.push(['Shelve', () => this.shelveAll(id), full && !shelfCount(st, id)]);
        sellCol.appendChild(this.row(id, `${name(id)} ×${n}`, each, buttons));
      }
      // buying
      const buyCol = document.createElement('section');
      buyCol.innerHTML = '<h4>Buy</h4>';
      const coins = p.countOf(I.COIN);
      for (const [id, cost] of BUYS) {
        buyCol.appendChild(this.row(id, name(id), coinsOf(cost), [['Buy', () => this.buy(id, cost), !creative && coins < cost]]));
      }
      cols.append(sellCol, buyCol);
      win.appendChild(cols);
    });
  }

  sell(id, n) {
    const g = this.game, p = g.player;
    n = Math.min(n, p.countOf(id));
    if (n <= 0) return;
    p.take(id, n);
    const back = RETURNS.get(id);
    if (back) giveOrDrop(g, back, n);
    const coins = sell(g.worldMeta, id, n);
    giveOrDrop(g, I.COIN, coins);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('pickup', { pitch: 1.4 });
    this.renderMarket();
  }

  buy(id, cost) {
    const g = this.game, p = g.player;
    if (p.mode !== GAMEMODE_CREATIVE) {
      if (p.countOf(I.COIN) < cost) return;
      p.take(I.COIN, cost);
    }
    giveOrDrop(g, id, 1);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('pickup');
    if (this.kind === 'trader') this.renderTrader(); else this.renderMarket();
  }

  // ---- the travelling trader ----

  openTrader() {
    this.kind = 'trader';
    this.game.setUiOpen(true);
    this.renderTrader();
  }

  renderTrader() {
    const g = this.game, p = g.player, T = g.worldMeta.trader ?? {};
    const creative = p.mode === GAMEMODE_CREATIVE;
    const offers = (Array.isArray(T.offers) ? T.offers : []).filter((o) => Array.isArray(o) && itemInfo(o[0]) && o[1] > 0);
    const wants = (Array.isArray(T.wants) ? T.wants : []).filter((o) => Array.isArray(o) && itemInfo(o[0]) && o[1] > 0);
    this.frame('Travelling Trader', (win) => {
      const purse = document.createElement('p');
      purse.className = 'ranch-purse';
      purse.textContent = `Your coins: ${p.countOf(I.COIN)} \u00b7 Lead an animal up to enter it in the fair`;
      purse.setAttribute('aria-live', 'polite');
      win.appendChild(purse);
      const cols = document.createElement('div');
      cols.className = 'ranch-cols';
      const buyCol = document.createElement('section');
      buyCol.innerHTML = '<h4>For sale this visit</h4>';
      const coins = p.countOf(I.COIN);
      for (const [id, cost] of offers) buyCol.appendChild(this.row(id, name(id), coinsOf(cost), [['Buy', () => this.buy(id, cost), !creative && coins < cost]]));
      if (!offers.length) buyCol.append(Object.assign(document.createElement('p'), { className: 'ranch-empty', textContent: 'Sold out this visit.' }));
      const wantCol = document.createElement('section');
      wantCol.innerHTML = '<h4>Wanted</h4>';
      if (!wants.length) wantCol.append(Object.assign(document.createElement('p'), { className: 'ranch-empty', textContent: 'Nothing this visit.' }));
      for (const w of wants) {
        const [id, price, left] = w, have = p.countOf(id);
        wantCol.appendChild(this.row(id, name(id), left > 0 ? `pays ${price} each (${left} more wanted)` : 'has all it wants', [
          ['Sell 1', () => this.sellToTrader(w, 1), !have || left <= 0],
          ['Sell all', () => this.sellToTrader(w, have), !have || left <= 0],
        ]));
      }
      cols.append(buyCol, wantCol);
      win.appendChild(cols);
    });
  }

  sellToTrader(want, n) {
    const g = this.game, p = g.player, [id, price] = want;
    n = Math.min(n, p.countOf(id), want[2]);
    if (n <= 0) return;
    p.take(id, n);
    want[2] -= n;
    const back = RETURNS.get(id);
    if (back) giveOrDrop(g, back, n);
    giveOrDrop(g, I.COIN, price * n);
    bump(g.worldMeta, 'coins', price * n);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('pickup', { pitch: 1.4 });
    this.renderTrader();
  }

  // ---- a villager ----

  // m: the villager; line: what it said as you came up
  openVillager(m, line = '') {
    this.kind = 'villager';
    this.villager = m;
    this.line = line;
    this.game.setUiOpen(true);
    this.renderVillager();
  }

  renderVillager() {
    const g = this.game, p = g.player, m = this.villager, r = m.res;
    const rec = villageRecord(g, m.village), o = offers(rec, r);
    if (!o) { this.close(); return; }
    const creative = p.mode === GAMEMODE_CREATIVE;
    const job = JOB_LABEL[r.job] ?? 'villager';
    this.frame(`${r.name} the ${job}, of ${m.village.name}`, (win) => {
      const purse = document.createElement('p');
      purse.className = 'ranch-purse';
      const odd = rec.market?.credit ?? 0;
      purse.textContent = `Your coins: ${p.countOf(I.COIN)}${odd >= 0.05 ? ` (and ${coinsText(odd)} on account here)` : ''} \u00b7 ${LEVEL_NAMES[o.level]} ${job}${o.next ? ': more to trade as you deal with them' : ''}`;
      purse.setAttribute('aria-live', 'polite');
      if (this.line) win.appendChild(Object.assign(document.createElement('p'), { className: 'ranch-made', textContent: `\u201c${this.line}\u201d` }));
      win.appendChild(purse);
      const cols = document.createElement('div');
      cols.className = 'ranch-cols';
      const buyCol = document.createElement('section');
      buyCol.innerHTML = `<h4>${r.name} buys</h4>`;
      for (const b of o.buys) {
        const have = p.countOf(b.id), all = Math.min(have, b.left);
        const sub = b.left > 0 ? `${coinsOf(b.price)} each \u00b7 wants ${b.left} more today` : 'has all it wants today: more tomorrow';
        buyCol.appendChild(this.row(b.id, have ? `${name(b.id)} \u00d7${have}` : name(b.id), sub, [
          ['Sell 1', () => this.sellToVillager(b.id, 1), !have || b.left <= 0],
          [all > 1 ? `Sell ${all} (${quoteTo(rec, r, b.id, all)})` : 'Sell all', () => this.sellToVillager(b.id, all), !have || b.left <= 0],
        ]));
      }
      const sellCol = document.createElement('section');
      sellCol.innerHTML = `<h4>${r.name} sells</h4>`;
      const coins = p.countOf(I.COIN);
      for (const s of o.sells) {
        sellCol.appendChild(this.row(s.id, name(s.id), s.left > 0 ? `${coinsOf(s.price)} \u00b7 ${s.left} left today` : 'sold out: more tomorrow', [['Buy', () => this.buyFromVillager(s.id), s.left <= 0 || (!creative && coins < s.price)]]));
      }
      cols.append(buyCol, sellCol);
      win.appendChild(cols);
    });
  }

  sellToVillager(id, n) {
    const g = this.game, p = g.player, m = this.villager, rec = villageRecord(g, m.village);
    n = Math.min(n, p.countOf(id));
    if (n <= 0) return;
    const { sold, coins } = sellTo(rec, m.res, id, n);
    if (!sold) return;
    p.take(id, sold);
    const back = RETURNS.get(id);
    if (back) giveOrDrop(g, back, sold);
    giveOrDrop(g, I.COIN, coins);
    bump(g.worldMeta, 'coins', coins);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('pickup', { pitch: 1.4 });
    m.nod?.();
    this.renderVillager();
  }

  buyFromVillager(id) {
    const g = this.game, p = g.player, m = this.villager, rec = villageRecord(g, m.village);
    const price = offers(rec, m.res)?.sells.find((s) => s.id === id)?.price ?? 0;
    const creative = p.mode === GAMEMODE_CREATIVE;
    if (!price || (!creative && p.countOf(I.COIN) < price)) return;
    if (!buyFrom(rec, m.res, id)) return;
    if (!creative) p.take(I.COIN, price);
    giveOrDrop(g, id, 1);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('pickup');
    m.nod?.();
    this.renderVillager();
  }

  // ---- the ledger ----

  openLedger() {
    this.kind = 'ledger';
    this.game.setUiOpen(true);
    const g = this.game, p = g.player, meta = g.worldMeta;
    const here = g.dimension, other = here === 'scorch' ? 'overworld' : 'scorch';
    const where = { overworld: 'Overworld', scorch: 'Scorchlands' };
    // every animal of yours: about you, stashed far off here, and in the other world
    const rows = [];
    const live = g.entities.mobs.filter((m) => (m.tamed || (m.persistent && m.breedItem)) && !m.dead && m.dying === undefined);
    for (const m of live) rows.push({ kind: m.label ?? m.petName ?? m.kind, name: m.name, x: m.x, z: m.z, dim: here, card: describeAnimal(m) });
    for (const a of g.entities.stash) rows.push({ kind: a.kind, name: a.name, x: a.x, z: a.z, dim: here });
    for (const a of meta.dims?.[other]?.animals ?? []) rows.push({ kind: a.kind, name: a.name, x: a.x, z: a.z, dim: other });
    for (const a of meta.dims?.[other]?.pets ?? []) rows.push({ kind: a.kind, name: a.name, x: a.x, z: a.z, dim: other, pet: true });
    // (entries from an imported save may be missing a kind or a place)
    for (let i = rows.length - 1; i >= 0; i--) if (typeof rows[i].kind !== 'string' || !rows[i].kind || !Number.isFinite(rows[i].x) || !Number.isFinite(rows[i].z)) rows.splice(i, 1);
    const stats = meta.ranchStats ?? {};
    this.frame('Ranch Ledger', (win) => {
      const tally = document.createElement('p');
      tally.className = 'ranch-purse';
      const kinds = {};
      for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      tally.textContent = rows.length ? `${rows.length} animal${rows.length === 1 ? "" : "s"}: ${Object.entries(kinds).map(([k, n]) => `${n} ${kindPlural(k, n)}`).join(', ')}` : 'No animals yet: feed, lead, pen or name one and it’s yours.';
      win.appendChild(tally);
      const made = [['eggs', 'eggs laid'], ['wool', 'wool shorn'], ['milk', 'buckets of milk'], ['butter', 'butter'], ['cheese', 'cheeses'], ['honey', 'bowls of honey'], ['born', 'young born'], ['coins', 'coins earned']]
        .filter(([k]) => stats[k] > 0).map(([k, label]) => `${Math.round(stats[k])} ${label}`);
      if (made.length) win.appendChild(Object.assign(document.createElement('p'), { className: 'ranch-made', textContent: made.join(' · ') }));
      const list = document.createElement('div');
      list.className = 'ranch-list';
      rows.sort((a, b) => (a.dim === b.dim ? 0 : a.dim === here ? -1 : 1) || (!!b.name - !!a.name) || Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      for (const r of rows.slice(0, 200)) {
        const d = r.dim === here ? `${Math.round(Math.hypot(r.x - p.x, r.z - p.z))} blocks away` : `in the ${where[r.dim]}`;
        const sub = `${d} (${Math.round(r.x)}, ${Math.round(r.z)})${r.card ? ' · ' + r.card.lines.slice(0, 2).join(' · ') : ''}`;
        list.appendChild(this.row(null, r.name ? `${r.name} the ${kindName(r.kind)}` : kindName(r.kind)[0].toUpperCase() + kindName(r.kind).slice(1), sub, []));
      }
      win.appendChild(list);
    });
  }
}

