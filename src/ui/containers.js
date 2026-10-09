// Container UIs: player inventory (with 2x2 crafting), crafting table (3x3),
// furnace, and the creative item palette. Handles cursor stack drag logic,
// right-click split, shift-click quick move, and tooltips.

import { itemInfo, maxStack, makeStack } from '../items/items.js';
import { matchRecipe, SMELTING, SMELT_TIME, RECIPES, recipeSize, recipeCells, recipeNeeds, recipeAvailability } from '../items/recipes.js';
import { furnaceState } from '../items/furnace.js';
import { BLOCKS, R_CROSS, R_TORCH } from '../blocks/blocks.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { I } from '../items/itemIds.js';
import { fillSlot } from './hud.js';

const CREATIVE_TABS = [
  ['all', 'All'], ['blocks', 'Blocks'], ['decor', 'Plants & Decor'],
  ['tools', 'Tools & Armour'], ['food', 'Food'], ['materials', 'Materials'],
];

function creativeCategory(id) {
  const info = itemInfo(id);
  if (info?.tool || info?.armor) return 'tools';
  if (info?.food) return 'food';
  if (info?.block) return info.block.render === R_CROSS || info.block.render === R_TORCH ? 'decor' : 'blocks';
  return 'materials';
}

let creativeIdsCache = null;
function creativeItems(tab) {
  if (!creativeIdsCache) {
    creativeIdsCache = [];
    for (const b of BLOCKS) {
      if (b && b.id !== 0 && b.name !== 'furnace_lit' && b.name !== 'water') creativeIdsCache.push(b.id);
    }
    for (const id of Object.values(I)) creativeIdsCache.push(id);
  }
  return tab === 'all' ? creativeIdsCache : creativeIdsCache.filter((id) => creativeCategory(id) === tab);
}

function loadFlag(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function saveFlag(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

const ARMOR_GHOSTS = [I.IRON_HELMET, I.IRON_CHESTPLATE, I.IRON_LEGGINGS, I.IRON_BOOTS];

function groupLabel(group) {
  return group.label ?? itemInfo(group[0])?.display ?? '?';
}

// Slot abstraction: {get: () => stack|null, set: (stack) => void, filter?: (id)=>bool, output?: bool}

export class Containers {
  constructor(game) {
    this.game = game;
    this.atlas = game.atlas;
    this.player = game.player;
    this.root = document.getElementById('ui-root');
    this.open = null;             // 'inventory' | 'crafting' | 'furnace' | null
    this.cursor = null;           // stack held by the mouse
    this.craftGrid = new Array(9).fill(null); // stacks in the 3x3 (or 2x2) grid
    this.craftSize = 2;
    this.furnacePos = null;
    this.hovered = null;          // slot ref under the mouse, for 1-9 / drop keys
    this.creativeTab = 'all';
    this.creativeQuery = '';
    this.creativeFocusSearch = false;
    this.bookOpen = loadFlag('blockverse-recipe-book', true);
    this.bookCraftableOnly = false;

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursor-stack';
    document.body.appendChild(this.cursorEl);
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'tooltip hidden';
    document.body.appendChild(this.tooltipEl);

    document.addEventListener('mousemove', (e) => this.movePointer(e.clientX, e.clientY),
      { signal: game.input.signal });
  }

  // cursor stack + tooltip follow the mouse (or the gamepad/touch focus)
  movePointer(x, y) {
    const half = this.cursorEl.offsetWidth / 2 || 18;
    this.cursorEl.style.left = `${x - half}px`;
    this.cursorEl.style.top = `${y - half}px`;
    this.positionTooltip(x, y);
  }

  dispose() {
    this.cursorEl.remove();
    this.tooltipEl.remove();
  }

  // keep the tooltip beside the pointer but inside the viewport
  positionTooltip(x, y) {
    const t = this.tooltipEl;
    if (t.classList.contains('hidden')) return;
    const w = t.offsetWidth, h = t.offsetHeight;
    const left = x + 14 + w > window.innerWidth - 4 ? x - 10 - w : x + 14;
    const top = Math.min(y + 10, window.innerHeight - h - 4);
    t.style.left = `${Math.max(4, left)}px`;
    t.style.top = `${Math.max(4, top)}px`;
  }

  showTooltip(stack, x, y) {
    const info = itemInfo(stack.id);
    const t = this.tooltipEl;
    t.textContent = info?.display ?? '?';
    const max = info?.tool?.durability ?? info?.armor?.durability;
    if (stack.dur !== undefined && max) {
      const d = document.createElement('div');
      d.className = 'tooltip-sub';
      d.textContent = `Durability ${stack.dur} / ${max}`;
      t.appendChild(d);
    }
    if (info?.armor) {
      const d = document.createElement('div');
      d.className = 'tooltip-sub';
      d.textContent = `+${info.armor.points} armour`;
      t.appendChild(d);
    }
    if (info?.food) {
      const d = document.createElement('div');
      d.className = 'tooltip-sub';
      d.textContent = `Restores ${info.food / 2} hunger`;
      t.appendChild(d);
    }
    t.classList.remove('hidden');
    this.positionTooltip(x, y);
  }

  // plain text tooltip: a title plus dimmer detail lines
  showTooltipLines(title, lines, x, y) {
    const t = this.tooltipEl;
    t.textContent = title;
    for (const line of lines) {
      const d = document.createElement('div');
      d.className = 'tooltip-sub';
      d.textContent = line;
      t.appendChild(d);
    }
    t.classList.remove('hidden');
    this.positionTooltip(x, y);
  }

  hideTooltip() {
    this.tooltipEl.classList.add('hidden');
  }

  isOpen() { return this.open !== null; }

  // ---------- open / close ----------

  openInventory() {
    if (this.player.mode === GAMEMODE_CREATIVE) {
      this.craftSize = 0;
    } else {
      this.craftSize = 2;
    }
    this.open = 'inventory';
    this.show();
  }

  openCrafting() {
    this.craftSize = 3;
    this.open = 'crafting';
    this.show();
  }

  openFurnace(pos) {
    this.furnacePos = { x: pos.x, y: pos.y, z: pos.z };
    this.open = 'furnace';
    this.show();
  }

  openChest(pos) {
    this.chestPos = { x: pos.x, y: pos.y, z: pos.z };
    this.open = 'chest';
    this.show();
  }

  chestState() {
    const { x, y, z } = this.chestPos;
    let st = this.game.world.blockEntityAt(x, y, z);
    if (!st || st.kind !== 'chest') {
      st = { kind: 'chest', slots: new Array(27).fill(null) };
      this.game.world.setBlockEntity(x, y, z, st);
    }
    return st;
  }

  close() {
    if (!this.open) return;
    // return craft grid + cursor stack to the inventory (or drop leftovers)
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (s) {
        const left = this.player.give(s.id, s.count);
        if (left > 0) this.dropStack({ ...s, count: left });
        this.craftGrid[i] = null;
      }
    }
    if (this.cursor) {
      const left = this.player.give(this.cursor.id, this.cursor.count);
      if (left > 0) this.dropStack({ ...this.cursor, count: left });
      this.cursor = null;
    }
    // chest contents changed: make sure the chunk is saved
    if (this.open === 'chest') this.game.world.setBlockEntity(this.chestPos.x, this.chestPos.y, this.chestPos.z, this.chestState());
    this.open = null;
    this.furnacePos = null;
    this.chestPos = null;
    this.hovered = null;
    this.root.innerHTML = '';
    this.renderCursor();
    this.hideTooltip();
    this.game.setUiOpen(false);
    this.game.hud.renderHotbar();
    this.game.input.requestLock();
  }

  dropStack(stack) {
    const p = this.player;
    const dir = p.lookDir();
    this.game.entities.spawnDrops(p.x + dir.x, p.eyeY - 0.2, p.z + dir.z, [stack]);
  }

  // ---------- rendering ----------

  show() {
    this.game.hints?.markInventoryOpened();
    this.game.setUiOpen(true);
    this.render();
  }

  render() {
    // the hovered slot is about to be replaced; its mouseleave will never fire
    this.hideTooltip();
    // this.hovered survives: the pointer is still over the same slot position
    this.root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'screen dim';
    screen.addEventListener('mousedown', (e) => {
      if (e.target === screen || e.target === row) {
        // click outside: drop cursor stack
        if (this.cursor) {
          this.dropStack(this.cursor);
          this.cursor = null;
          this.renderCursor();
          this.render();
        }
      }
    });
    // right-click splits stacks; never let the browser menu open over the UI
    screen.addEventListener('contextmenu', (e) => e.preventDefault());
    const row = document.createElement('div');
    row.className = 'inv-row';
    const win = document.createElement('div');
    win.className = 'inv-window';
    // the recipe book sits beside survival crafting screens
    if (this.craftSize > 0 && (this.open === 'crafting' || this.open === 'inventory') && this.bookOpen) {
      row.appendChild(this.renderRecipeBook());
    }
    row.appendChild(win);
    screen.appendChild(row);
    this.root.appendChild(screen);

    if (this.open === 'inventory' && this.player.mode === GAMEMODE_CREATIVE) {
      this.renderCreative(win);
    } else if (this.open === 'inventory') {
      this.renderCraftArea(win, 2, 'Crafting');
    } else if (this.open === 'crafting') {
      this.renderCraftArea(win, 3, 'Crafting Table');
    } else if (this.open === 'furnace') {
      this.renderFurnace(win);
    } else if (this.open === 'chest') {
      this.renderChest(win);
    }

    this.renderPlayerInv(win);

    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = this.open === 'inventory' && this.player.mode === GAMEMODE_CREATIVE
      ? 'Left-click: stack · Right-click: one · ✕: destroy · E: close'
      : 'Right-click: split · Shift-click: move · Click outside: drop · E: close';
    win.appendChild(hint);
    this.renderCursor();
  }

  slotEl(ref) {
    const el = document.createElement('div');
    el.className = 'slot';
    fillSlot(el, ref.get(), this.atlas);
    if (ref.output && ref.get()) el.classList.add('ready');
    if (ref.armorSlot !== undefined && !ref.get()) {
      // faint outline of the piece that goes here
      const ghost = document.createElement('img');
      ghost.className = 'ghost';
      ghost.src = this.atlas.icon(ARMOR_GHOSTS[ref.armorSlot]);
      ghost.alt = '';
      el.appendChild(ghost);
      el.title = ['Helmet', 'Chestplate', 'Leggings', 'Boots'][ref.armorSlot];
    }
    // mousemove (not mouseenter) so the tooltip comes back after a re-render
    el.addEventListener('mousemove', (e) => {
      this.hovered = ref;
      const cur = ref.get();
      if (cur && !this.cursor) this.showTooltip(cur, e.clientX, e.clientY);
      else this.hideTooltip();
    });
    el.addEventListener('mouseleave', () => {
      if (this.hovered === ref) this.hovered = null;
      this.hideTooltip();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.clickSlot(ref, e.button, e.shiftKey);
    });
    // touch: tap = left click, touch-and-hold = right click (split / place one)
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();          // also suppresses the emulated mousedown
      e.stopPropagation();
      this.movePointer(e.clientX, e.clientY);
      let long = false;
      const timer = setTimeout(() => { long = true; this.clickSlot(ref, 2, false); }, 450);
      // listen on window: furnace refreshes may replace this element mid-press
      const end = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        clearTimeout(timer);
        if (!long && ev.type === 'pointerup') this.clickSlot(ref, 0, false);
      };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
    return el;
  }

  renderPlayerInv(win) {
    const h3 = document.createElement('h3');
    h3.textContent = 'Inventory';
    win.appendChild(h3);

    const main = document.createElement('div');
    main.className = 'inv-grid cols-9';
    for (let i = 9; i < 36; i++) main.appendChild(this.slotEl(this.invRef(i)));
    main.firstChild.dataset.padStart = '';   // where a gamepad highlight begins
    win.appendChild(main);

    const hot = document.createElement('div');
    hot.className = 'inv-grid cols-9';
    hot.style.marginTop = '8px';
    for (let i = 0; i < 9; i++) hot.appendChild(this.slotEl(this.invRef(i)));
    win.appendChild(hot);
  }

  renderCraftArea(win, size, title) {
    const head = document.createElement('div');
    head.className = 'craft-head';
    const h3 = document.createElement('h3');
    h3.textContent = title;
    head.appendChild(h3);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'book-toggle';
    toggle.textContent = this.bookOpen ? '◀ Hide recipes' : '▶ Recipes';
    toggle.setAttribute('aria-expanded', String(this.bookOpen));
    toggle.addEventListener('click', () => {
      this.bookOpen = !this.bookOpen;
      saveFlag('blockverse-recipe-book', this.bookOpen);
      this.render();
    });
    head.appendChild(toggle);
    win.appendChild(head);

    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '12px';

    // survival inventory: armour column beside the 2x2 grid
    if (this.open === 'inventory') {
      const armor = document.createElement('div');
      armor.className = 'inv-grid cols-1 armor-col';
      for (let i = 0; i < 4; i++) armor.appendChild(this.slotEl(this.armorRef(i)));
      row.appendChild(armor);
    }

    const grid = document.createElement('div');
    grid.className = `inv-grid cols-${size}`;
    for (let i = 0; i < size * size; i++) {
      grid.appendChild(this.slotEl(this.craftRef(i)));
    }
    row.appendChild(grid);

    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    arrow.textContent = '➜';
    row.appendChild(arrow);

    row.appendChild(this.slotEl(this.craftResultRef()));
    win.appendChild(row);
  }

  renderChest(win) {
    const st = this.chestState();
    const h3 = document.createElement('h3');
    h3.textContent = 'Chest';
    win.appendChild(h3);
    const grid = document.createElement('div');
    grid.className = 'inv-grid cols-9';
    grid.style.marginBottom = '12px';
    for (let i = 0; i < 27; i++) {
      grid.appendChild(this.slotEl({
        get: () => st.slots[i],
        set: (v) => { st.slots[i] = v; },
        area: 'chest',
      }));
    }
    win.appendChild(grid);
  }

  // ---------- recipe book ----------

  renderRecipeBook() {
    const book = document.createElement('div');
    book.className = 'inv-window recipe-book';
    const head = document.createElement('div');
    head.className = 'craft-head';
    const h3 = document.createElement('h3');
    h3.textContent = 'Recipes';
    head.appendChild(h3);
    const filter = document.createElement('button');
    filter.type = 'button';
    filter.className = 'book-toggle';
    filter.textContent = this.bookCraftableOnly ? 'Showing: can make' : 'Showing: all';
    filter.setAttribute('aria-pressed', String(this.bookCraftableOnly));
    filter.addEventListener('click', () => {
      this.bookCraftableOnly = !this.bookCraftableOnly;
      this.render();
    });
    head.appendChild(filter);
    book.appendChild(head);

    // ingredients already in the grid go back to the inventory on fill, so they count
    const countOf = (id) => this.player.countOf(id)
      + this.craftGrid.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
    const size = this.craftSize;
    const entries = RECIPES.map((r, order) => {
      const avail = recipeAvailability(r, countOf);
      const { w, h } = recipeSize(r);
      const fits = w <= size && h <= size;
      const state = avail.ok ? (fits ? 'craftable' : 'needs-table') : 'missing';
      return { r, avail, fits, state, order };
    }).filter((e) => !this.bookCraftableOnly || e.state === 'craftable');
    const rank = { craftable: 0, 'needs-table': 1, missing: 2 };
    entries.sort((a, b) => rank[a.state] - rank[b.state] || a.order - b.order);

    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    for (const e of entries) grid.appendChild(this.recipeButton(e, countOf));
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'creative-empty';
      empty.textContent = 'Nothing you can make yet — gather more materials.';
      grid.appendChild(empty);
    }
    book.appendChild(grid);

    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = 'Click a recipe to fill the grid · Shift-click: as many as you can';
    book.appendChild(hint);
    return book;
  }

  recipeButton({ r, avail, fits, state }, countOf) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `recipe ${state}`;
    const img = document.createElement('img');
    img.src = this.atlas.icon(r.result);
    img.alt = '';
    img.draggable = false;
    b.appendChild(img);
    if (r.count > 1) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = r.count;
      b.appendChild(c);
    }
    const name = itemInfo(r.result)?.display ?? '?';
    b.setAttribute('aria-label', `${name}${state === 'craftable' ? '' : state === 'needs-table' ? ' (needs a crafting table)' : ' (missing ingredients)'}`);

    const needs = recipeNeeds(r);
    b.addEventListener('mousemove', (ev) => {
      const lines = [`Needs: ${needs.map((n) => `${n.count} × ${groupLabel(n.group)}`).join(', ')}`];
      if (state === 'craftable') lines.push(avail.times > 1 ? `Click to fill the grid (enough for ${avail.times})` : 'Click to fill the grid');
      else if (state === 'needs-table') lines.push('Needs a Crafting Table (3×3 grid)');
      else {
        const missing = needs.map((n) => {
          const have = Math.max(...n.group.map(countOf));
          return have < n.count ? `${n.count - have} × ${groupLabel(n.group)}` : null;
        }).filter(Boolean);
        lines.push(`Missing: ${missing.join(', ')}`);
      }
      this.showTooltipLines(r.count > 1 ? `${name} ×${r.count}` : name, lines, ev.clientX, ev.clientY);
    });
    b.addEventListener('mouseleave', () => this.hideTooltip());
    b.addEventListener('click', (ev) => {
      if (state !== 'craftable' || !fits) return;
      this.game.sfx?.play('click');
      this.fillRecipe(r, ev.shiftKey);
    });
    return b;
  }

  // Move a recipe's ingredients from the inventory into the craft grid.
  fillRecipe(r, max) {
    // clear the grid back into the inventory first
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      const left = this.player.give(s.id, s.count);
      if (left > 0) this.dropStack({ ...s, count: left });
      this.craftGrid[i] = null;
    }
    const avail = recipeAvailability(r, (id) => this.player.countOf(id));
    if (!avail.ok) { this.afterChange(); return; }
    const cells = recipeCells(r);
    let n = 1;
    if (max) {
      n = avail.times;
      for (const c of cells) n = Math.min(n, maxStack(avail.pick.get(c.group)));
    }
    for (const { x, y, group } of cells) {
      const id = avail.pick.get(group);
      this.player.take(id, n);
      this.craftGrid[y * this.craftSize + x] = { id, count: n };
    }
    this.afterChange();
  }

  renderFurnace(win) {
    const st = furnaceState(this.game.world, this.furnacePos.x, this.furnacePos.y, this.furnacePos.z);
    const h3 = document.createElement('h3');
    h3.textContent = 'Furnace';
    win.appendChild(h3);

    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '12px';

    const col = document.createElement('div');
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.gap = '4px';
    col.appendChild(this.slotEl(this.beRef(st, 'input')));

    const flame = document.createElement('div');
    flame.className = 'furnace-flame';
    flame.textContent = '🔥';
    flame.classList.toggle('off', !(st.burnLeft > 0));
    const burnTrack = document.createElement('div');
    burnTrack.className = 'progress-track';
    const burnFill = document.createElement('div');
    burnFill.style.width = st.burnTotal > 0 ? `${Math.round((st.burnLeft / st.burnTotal) * 100)}%` : '0%';
    burnTrack.appendChild(burnFill);
    col.appendChild(flame);
    col.appendChild(burnTrack);
    col.appendChild(this.slotEl(this.beRef(st, 'fuel')));
    row.appendChild(col);

    const mid = document.createElement('div');
    mid.style.display = 'flex';
    mid.style.flexDirection = 'column';
    mid.style.alignItems = 'center';
    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    arrow.textContent = '➜';
    const cookTrack = document.createElement('div');
    cookTrack.className = 'progress-track';
    const cookFill = document.createElement('div');
    cookFill.style.width = `${Math.round((st.cook / SMELT_TIME) * 100)}%`;
    cookTrack.appendChild(cookFill);
    mid.appendChild(arrow);
    mid.appendChild(cookTrack);
    row.appendChild(mid);

    row.appendChild(this.slotEl(this.beRef(st, 'output')));
    win.appendChild(row);
  }

  renderCreative(win) {
    const head = document.createElement('div');
    head.className = 'creative-head';
    const tabs = document.createElement('div');
    tabs.className = 'creative-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of CREATIVE_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'creative-tab';
      b.textContent = label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === this.creativeTab));
      b.addEventListener('click', () => {
        this.creativeTab = id;
        this.creativeQuery = '';
        this.render();
      });
      tabs.appendChild(b);
    }
    head.appendChild(tabs);

    const search = document.createElement('input');
    search.className = 'creative-search';
    search.type = 'search';
    search.placeholder = 'Search…';
    search.setAttribute('aria-label', 'Search items');
    search.value = this.creativeQuery;
    search.autocomplete = 'off';
    search.spellcheck = false;
    // typing must not reach gameplay keys (E closes the inventory, 1-9 swap...)
    search.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    search.addEventListener('input', () => {
      this.creativeQuery = search.value;
      this.fillCreativeGrid(grid);
    });
    head.appendChild(search);

    // trash: drop the carried stack in here to delete it
    const trash = document.createElement('div');
    trash.className = 'slot trash';
    trash.title = 'Destroy item';
    trash.textContent = '✕';
    trash.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.cursor) return;
      this.cursor = null;
      this.afterChange();
    });
    head.appendChild(trash);
    win.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'inv-grid cols-9 creative-grid';
    win.appendChild(grid);
    this.fillCreativeGrid(grid);
    if (this.creativeFocusSearch) search.focus();
    search.addEventListener('focus', () => { this.creativeFocusSearch = true; });
    search.addEventListener('blur', () => { this.creativeFocusSearch = false; });
  }

  fillCreativeGrid(grid) {
    grid.innerHTML = '';
    const q = this.creativeQuery.trim().toLowerCase();
    const ids = creativeItems(this.creativeTab).filter((id) => {
      if (!q) return true;
      const info = itemInfo(id);
      return info && (info.display.toLowerCase().includes(q) || info.name.includes(q.replace(/ /g, '_')));
    });
    for (const id of ids) {
      grid.appendChild(this.slotEl({ get: () => ({ id, count: 1 }), set: () => {}, creative: id }));
    }
    if (!ids.length) {
      const empty = document.createElement('div');
      empty.className = 'creative-empty';
      empty.textContent = 'No matching items';
      grid.appendChild(empty);
    }
  }

  renderCursor() {
    this.cursorEl.innerHTML = '';
    if (this.cursor) {
      this.cursorEl.style.display = 'block';
      const img = document.createElement('img');
      img.src = this.atlas.icon(this.cursor.id);
      this.cursorEl.appendChild(img);
      if (this.cursor.count > 1) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = this.cursor.count;
        this.cursorEl.appendChild(c);
      }
    } else {
      this.cursorEl.style.display = 'none';
    }
  }

  // ---------- slot refs ----------

  invRef(i) {
    return {
      get: () => this.player.inventory[i],
      set: (s) => { this.player.inventory[i] = s; },
      area: 'inv',
      index: i,
    };
  }

  armorRef(i) {
    return {
      get: () => this.player.armor[i],
      set: (s) => { this.player.armor[i] = s; },
      area: 'armor',
      armorSlot: i,
      filter: (id) => itemInfo(id)?.armor?.slot === i,
    };
  }

  craftRef(i) {
    return {
      get: () => this.craftGrid[i],
      set: (s) => { this.craftGrid[i] = s; },
      area: 'craft',
    };
  }

  craftResultRef() {
    return {
      get: () => {
        const size = this.craftSize;
        const grid = [];
        for (let i = 0; i < size * size; i++) grid.push(this.craftGrid[i]?.id ?? 0);
        const m = matchRecipe(grid, size, size);
        return m ? makeStack(m.id, m.count) : null;
      },
      set: () => {},
      output: 'craft',
    };
  }

  beRef(st, field) {
    return {
      get: () => st[field],
      set: (s) => { st[field] = s; },
      area: 'furnace',
      output: field === 'output' ? 'furnace' : undefined,
      filter: field === 'fuel'
        ? (id) => (itemInfo(id)?.burnTime ?? 0) > 0
        : field === 'input' ? (id) => SMELTING.has(id) : undefined,
    };
  }

  // ---------- click logic ----------

  clickSlot(ref, button, shift) {
    if (ref.creative !== undefined) {
      // creative palette: left = grab full stack, right = single
      if (this.cursor) this.cursor = null;
      else this.cursor = makeStack(ref.creative, button === 2 ? 1 : maxStack(ref.creative));
      this.renderCursor();
      this.render();
      return;
    }

    if (ref.output) {
      this.takeOutput(ref, shift);
      this.afterChange();
      return;
    }

    const cur = this.cursor;
    const inSlot = ref.get();

    if (shift && !cur && inSlot) {
      this.quickMove(ref, inSlot);
      this.afterChange();
      return;
    }

    if (button === 0) {
      // left click: swap / merge
      if (!cur && inSlot) {
        ref.set(null);
        this.cursor = inSlot;
      } else if (cur && !inSlot) {
        if (ref.filter && !ref.filter(cur.id)) return;
        ref.set(cur);
        this.cursor = null;
      } else if (cur && inSlot) {
        if (cur.id === inSlot.id && cur.dur === undefined && inSlot.dur === undefined) {
          const room = maxStack(cur.id) - inSlot.count;
          const moved = Math.min(room, cur.count);
          inSlot.count += moved;
          cur.count -= moved;
          if (cur.count <= 0) this.cursor = null;
        } else {
          if (ref.filter && !ref.filter(cur.id)) return;
          ref.set(cur);
          this.cursor = inSlot;
        }
      }
    } else if (button === 2) {
      // right click: place one / take half
      if (cur) {
        if (ref.filter && !ref.filter(cur.id)) return;
        if (!inSlot) {
          ref.set({ ...cur, count: 1 });
          cur.count--;
          if (cur.count <= 0) this.cursor = null;
        } else if (inSlot.id === cur.id && inSlot.dur === undefined && inSlot.count < maxStack(cur.id)) {
          inSlot.count++;
          cur.count--;
          if (cur.count <= 0) this.cursor = null;
        }
      } else if (inSlot) {
        const half = Math.ceil(inSlot.count / 2);
        const rest = inSlot.count - half;
        this.cursor = { ...inSlot, count: half };
        if (rest > 0) ref.set({ ...inSlot, count: rest });
        else ref.set(null);
      }
    }
    this.afterChange();
  }

  takeOutput(ref, shift) {
    const doOnce = () => {
      const out = ref.get();
      if (!out) return false;
      if (ref.output === 'craft') {
        if (this.cursor) {
          if (this.cursor.id !== out.id || this.cursor.dur !== undefined) return false;
          if (this.cursor.count + out.count > maxStack(out.id)) return false;
          this.cursor.count += out.count;
        } else {
          this.cursor = out;
        }
        // consume one item from every occupied craft cell
        for (let i = 0; i < this.craftGrid.length; i++) {
          const s = this.craftGrid[i];
          if (s) {
            s.count--;
            if (s.count <= 0) this.craftGrid[i] = null;
          }
        }
        return true;
      }
      // furnace output
      if (this.cursor) {
        if (this.cursor.id !== out.id) return false;
        if (this.cursor.count + out.count > maxStack(out.id)) return false;
        this.cursor.count += out.count;
      } else {
        this.cursor = out;
      }
      ref.set(null);
      return true;
    };

    if (shift) {
      // craft/take as much as fits, sending to inventory
      let guard = 0;
      while (guard++ < 64) {
        const out = ref.get();
        if (!out) break;
        const left = this.player.give(out.id, out.count);
        if (left > 0) break;
        if (ref.output === 'craft') {
          for (let i = 0; i < this.craftGrid.length; i++) {
            const s = this.craftGrid[i];
            if (s) {
              s.count--;
              if (s.count <= 0) this.craftGrid[i] = null;
            }
          }
        } else {
          ref.set(null);
        }
      }
    } else {
      doOnce();
    }
    this.game.sfx?.play('click');
  }

  quickMove(ref, stack) {
    if (ref.area === 'inv') {
      // move into container area if a sensible one exists, else hotbar<->main
      if (this.open === 'furnace') {
        const st = furnaceState(this.game.world, this.furnacePos.x, this.furnacePos.y, this.furnacePos.z);
        const target = SMELTING.has(stack.id) ? 'input' : (itemInfo(stack.id)?.burnTime ?? 0) > 0 ? 'fuel' : null;
        if (target) {
          const t = st[target];
          if (!t) { st[target] = stack; ref.set(null); return; }
          if (t.id === stack.id) {
            const room = maxStack(t.id) - t.count;
            const moved = Math.min(room, stack.count);
            t.count += moved;
            stack.count -= moved;
            if (stack.count <= 0) ref.set(null);
            return;
          }
        }
      }
      if (this.open === 'chest') {
        this.moveIntoSlots(ref, stack, this.chestState().slots);
        return;
      }
      // armour pieces jump into their empty slot
      const armor = itemInfo(stack.id)?.armor;
      if (this.open === 'inventory' && armor && !this.player.armor[armor.slot]) {
        this.player.armor[armor.slot] = stack;
        ref.set(null);
        return;
      }
      // hotbar <-> main swap region
      const from = ref.index;
      const targetRange = from < 9 ? [9, 36] : [0, 9];
      this.moveIntoRange(ref, stack, targetRange);
    } else {
      // container -> inventory
      const left = this.player.give(stack.id, stack.count);
      ref.set(left > 0 ? { ...stack, count: left } : null);
    }
  }

  // shift-click into a container's slot array: merge, then fill empties
  moveIntoSlots(ref, stack, slots) {
    for (const s of slots) {
      if (stack.count <= 0) break;
      if (s && s.id === stack.id && s.dur === undefined && stack.dur === undefined) {
        const moved = Math.min(maxStack(s.id) - s.count, stack.count);
        s.count += moved;
        stack.count -= moved;
      }
    }
    for (let i = 0; i < slots.length && stack.count > 0; i++) {
      if (!slots[i]) { slots[i] = { ...stack }; stack.count = 0; }
    }
    ref.set(stack.count > 0 ? stack : null);
  }

  moveIntoRange(ref, stack, [a, b]) {
    // merge first
    for (let i = a; i < b && stack.count > 0; i++) {
      const s = this.player.inventory[i];
      if (s && s.id === stack.id && s.dur === undefined && stack.dur === undefined) {
        const room = maxStack(s.id) - s.count;
        const moved = Math.min(room, stack.count);
        s.count += moved;
        stack.count -= moved;
      }
    }
    for (let i = a; i < b && stack.count > 0; i++) {
      if (!this.player.inventory[i]) {
        this.player.inventory[i] = { ...stack };
        stack.count = 0;
      }
    }
    ref.set(stack.count > 0 ? stack : null);
  }

  // number key over a slot: swap it with that hotbar slot
  swapHoveredWithHotbar(i) {
    const ref = this.hovered;
    if (!ref || this.cursor || ref.output) return;
    const inv = this.player.inventory;
    if (ref.creative !== undefined) {
      inv[i] = makeStack(ref.creative, maxStack(ref.creative));
    } else {
      if (ref.area === 'inv' && ref.index === i) return;
      const here = ref.get();
      const there = inv[i];
      if (there && ref.filter && !ref.filter(there.id)) return;
      ref.set(there);
      inv[i] = here;
    }
    this.afterChange();
  }

  // drop key over a slot: throw one item (or the whole stack)
  dropHovered(all) {
    const ref = this.hovered;
    if (!ref || this.cursor || ref.output || ref.creative !== undefined) return;
    const s = ref.get();
    if (!s) return;
    const n = all ? s.count : 1;
    this.dropStack({ ...s, count: n });
    ref.set(s.count - n > 0 ? { ...s, count: s.count - n } : null);
    this.afterChange();
  }

  afterChange() {
    this.player.events.dispatchEvent(new CustomEvent('inventory'));
    this.renderCursor();
    this.render();
  }

  // called by game each frame while a furnace is open, to refresh progress bars
  refreshIfFurnace() {
    if (this.open === 'furnace') this.render();
  }
}
