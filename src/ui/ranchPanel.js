// The ranch's two windows: the market stall (sell produce, buy goods) and
// the ledger (every animal that's yours, wherever it is, and what the ranch
// has made).

import { I } from '../items/itemIds.js';
import { itemInfo } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { SELLS, RETURNS, BUYS, priceOf, sell } from '../world/market.js';
import { describeAnimal } from '../entities/inspect.js';

const name = (id) => itemInfo(id)?.display ?? '?';
const coinsText = (v) => (v >= 10 ? `${Math.round(v)}` : v.toFixed(1).replace(/\.0$/, ''));

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
    this.root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'screen dim container-screen';
    const win = document.createElement('div');
    win.className = 'inv-window ranch-panel';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', title);
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
      b.addEventListener('click', fn);
      r.appendChild(b);
    }
    return r;
  }

  // ---- the market ----

  openMarket() {
    this.kind = 'market';
    this.game.setUiOpen(true);
    this.renderMarket();
  }

  renderMarket() {
    const g = this.game, p = g.player, meta = g.worldMeta;
    const creative = p.mode === GAMEMODE_CREATIVE;
    this.frame('Market Stall', (win) => {
      const purse = document.createElement('p');
      purse.className = 'ranch-purse';
      purse.textContent = `Your coins: ${p.countOf(I.COIN)}`;
      win.appendChild(purse);
      const cols = document.createElement('div');
      cols.className = 'ranch-cols';
      // selling: what you've got that the market takes
      const sellCol = document.createElement('section');
      sellCol.innerHTML = '<h4>Sell</h4>';
      const have = [...new Set(p.inventory.filter((s) => s && SELLS.has(s.id) && s.dur === undefined).map((s) => s.id))];
      if (!have.length) sellCol.append(Object.assign(document.createElement('p'), { className: 'ranch-empty', textContent: 'Nothing the market buys: eggs, milk, butter, cheese, wool, honey, meat, crops and good food sell here.' }));
      for (const id of have) {
        const n = p.countOf(id), price = priceOf(meta, id);
        const each = `${coinsText(price)} coin${price === 1 ? '' : 's'} each${price < SELLS.get(id) * 0.8 ? ' (plenty sold lately)' : ''}`;
        sellCol.appendChild(this.row(id, `${name(id)} ×${n}`, each, [
          ['Sell 1', () => this.sell(id, 1)],
          ['Sell all', () => this.sell(id, n)],
        ]));
      }
      // buying
      const buyCol = document.createElement('section');
      buyCol.innerHTML = '<h4>Buy</h4>';
      const coins = p.countOf(I.COIN);
      for (const [id, cost] of BUYS) {
        buyCol.appendChild(this.row(id, name(id), `${cost} coin${cost === 1 ? '' : 's'}`, [['Buy', () => this.buy(id, cost), !creative && coins < cost]]));
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
    if (back && p.give(back, n) > 0) g.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id: back, count: n }]);
    const coins = sell(g.worldMeta, id, n);
    if (coins && p.give(I.COIN, coins) > 0) g.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id: I.COIN, count: coins }]);
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
    if (p.give(id, 1) > 0) g.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id, count: 1 }]);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    g.sfx?.play('pickup');
    this.renderMarket();
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
      tally.textContent = rows.length ? `${rows.length} animals: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}` : 'No animals yet: feed, lead, pen or name one and it’s yours.';
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
        list.appendChild(this.row(null, r.name ? `${r.name} the ${r.kind}` : r.kind[0].toUpperCase() + r.kind.slice(1), sub, []));
      }
      win.appendChild(list);
    });
  }
}

