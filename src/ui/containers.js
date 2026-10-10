// Container UIs: player inventory (with 2x2 crafting), crafting table (3x3),
// furnace, and the creative item palette. Handles cursor stack drag logic,
// right-click split, shift-click quick move, and tooltips.

import { itemInfo, maxStack, makeStack, WEAPON_STATS } from '../items/items.js';
import { matchRecipe, SMELTING, SMELT_TIME, RECIPES, recipeSize, recipeCells, recipeNeeds, recipeAvailability } from '../items/recipes.js';
import { furnaceState } from '../items/furnace.js';
import { B, BLOCKS, R_CROSS, R_TORCH, isTechnicalBlock } from '../blocks/blocks.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { I } from '../items/itemIds.js';
import { fillSlot } from './hud.js';
import { keyLabel } from '../core/keybinds.js';

// fuels the smelting guide may load automatically
const AUTO_FUELS = new Set([
  I.COAL, I.CHARCOAL, I.STICK, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS,
]);

// how many of this stack the player's inventory could take
function roomFor(player, stack) {
  const max = maxStack(stack.id);
  let room = 0;
  for (const s of player.inventory) {
    if (!s) room += max;
    else if (s.id === stack.id && s.dur === undefined && stack.dur === undefined) room += max - s.count;
  }
  return room;
}

const CREATIVE_TABS = [
  ['all', 'All'], ['blocks', 'Blocks'], ['decor', 'Plants'],
  ['tools', 'Gear'], ['food', 'Food'], ['materials', 'Items'],
];

function creativeCategory(id) {
  const info = itemInfo(id);
  if (info?.tool || info?.armor || info?.bow || id === I.ARROW) return 'tools';
  if (info?.food) return 'food';
  if (info?.block) return info.block.render === R_CROSS || info.block.render === R_TORCH || info.block.shape === 'lantern' ? 'decor' : 'blocks';
  return 'materials';
}

let creativeIdsCache = null;
function creativeItems(tab) {
  if (!creativeIdsCache) {
    creativeIdsCache = [];
    for (const b of BLOCKS) {
      // skip technical states: lit furnace, water, growing wheat
      if (b && b.id !== 0 && !isTechnicalBlock(b.id)) creativeIdsCache.push(b.id);
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

const BOOK_TABS = [['all', 'All'], ['tools', 'Gear'], ['blocks', 'Blocks'], ['food', 'Food'], ['materials', 'Items']];

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
    this.bookTab = 'all';
    this.bookQuery = '';
    this.bookFocusSearch = false;
    this.ghost = null;            // recipe previewed in the craft grid

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursor-stack';
    document.body.appendChild(this.cursorEl);
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'tooltip hidden';
    document.body.appendChild(this.tooltipEl);

    document.addEventListener('mousemove', (e) => this.movePointer(e.clientX, e.clientY),
      { signal: game.input.signal });
    // finish a drag: one slot is an ordinary click, several share the stack
    document.addEventListener('mouseup', () => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (!this.cursor) { this.render(); return; }
      if (d.refs.length === 1) this.clickSlot(d.refs[0], d.button, false);
      else this.distribute(d.refs, d.button === 2);
    }, { signal: game.input.signal });
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
    const max = info?.tool?.durability ?? info?.armor?.durability ?? info?.bow?.durability;
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
      d.textContent = `Restores ${info.food / 2} hunger` + (info.heal ? ` and ${info.heal / 2} hearts` : '');
      t.appendChild(d);
    }
    if (info?.tool && WEAPON_STATS[info.tool.class]) {
      const w = WEAPON_STATS[info.tool.class];
      const d = document.createElement('div');
      d.className = 'tooltip-sub';
      const extra = [w.reach ? `+${w.reach} reach` : '', info.tool.class === 'sword' ? 'sweeps' : ''].filter(Boolean);
      d.textContent = `${info.tool.damage} attack damage, ${(1 / w.cooldown).toFixed(1)} hits/s` + (extra.length ? ` · ${extra.join(', ')}` : '');
      t.appendChild(d);
    }
    t.classList.remove('hidden');
    this.positionTooltip(x, y);
  }

  // plain text tooltip: a title plus dimmer detail lines
  showTooltipLines(title, lines, x, y, extra = null) {
    const t = this.tooltipEl;
    t.textContent = title;
    if (extra) t.appendChild(extra);
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

  // stacks the player is holding outside the inventory right now (saved with it)
  heldStacks() {
    if (!this.open) return [];
    return [this.cursor, ...this.craftGrid].filter(Boolean);
  }

  // is a chest / furnace UI showing the block at this position?
  isOpenAt(x, y, z) {
    const p = this.open === 'chest' ? this.chestPos : this.open === 'furnace' ? this.furnacePos : null;
    return !!p && p.x === x && p.y === y && p.z === z;
  }

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
        const left = this.player.giveStack(s);
        if (left > 0) this.dropStack({ ...s, count: left });
        this.craftGrid[i] = null;
      }
    }
    if (this.cursor) {
      const left = this.player.giveStack(this.cursor);
      if (left > 0) this.dropStack({ ...this.cursor, count: left });
      this.cursor = null;
    }
    // chest contents changed: make sure the chunk is saved (if the chest still exists)
    if (this.open === 'chest') {
      const { x, y, z } = this.chestPos;
      if (this.game.world.getBlockW(x, y, z) === B.CHEST) this.game.world.setBlockEntity(x, y, z, this.chestState());
    }
    this.open = null;
    this.furnacePos = null;
    this.chestPos = null;
    this.drag = null;
    this.ghost = null;
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
    screen.className = 'screen dim container-screen';
    screen.addEventListener('mousedown', (e) => {
      if (e.target === screen || e.target === row) {
        // click outside: drop cursor stack
        if (this.cursor) {
          this.dropStack(this.cursor);
          this.cursor = null;
          this.renderCursor();
          this.render();
        } else if (this.game.input.altInput === 'touch') {
          this.close();   // touch has no E/Esc: a tap outside closes
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
    if (this.open === 'furnace' && this.bookOpen) row.appendChild(this.renderSmeltingGuide());
    row.appendChild(win);
    // an explicit close button (touch and gamepad players have no E key)
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'inv-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());
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
    const mode = this.game.input.altInput;
    const closeKey = keyLabel(this.game.input.bindings.inventory);
    const creative = this.open === 'inventory' && this.player.mode === GAMEMODE_CREATIVE;
    hint.textContent = mode === 'touch'
      ? (creative ? 'Tap: take a stack · Hold: take one · Tap outside: close' : 'Tap: pick up / place · Hold: split or place one · Tap outside: close')
      : mode === 'gamepad'
        ? 'A: pick up / place · X: split · RB: quick move · B: close'
        : creative
          ? `Left-click: stack · Right-click: one · ✕ slot: destroy · ${closeKey}: close`
          : `Right-click: split · Shift-click: move · Click outside: drop · ${closeKey}: close`;
    win.appendChild(hint);
    // last in the DOM so keyboard/gamepad focus starts on the slots, not here
    win.appendChild(closeBtn);
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
      // extend a drag over slots that can take the carried stack
      const d = this.drag;
      if (d && (e.buttons & (d.button === 0 ? 1 : 2)) && ref.key && !d.keys.has(ref.key) && this.canDropInto(ref, this.cursor)) {
        d.keys.add(ref.key);
        d.refs.push(ref);
        el.classList.add('drag-over');
      }
      const cur = ref.get();
      if (cur && !this.cursor) this.showTooltip(cur, e.clientX, e.clientY);
      else this.hideTooltip();
    });
    el.addEventListener('mouseleave', () => {
      if (this.hovered === ref) this.hovered = null;
      this.hideTooltip();
    });
    if (this.drag?.keys.has(ref.key)) el.classList.add('drag-over');
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // double-click: gather every matching item onto the cursor
      const now = performance.now();
      if (e.button === 0 && !e.shiftKey && this.cursor && this.lastPickup
        && this.lastPickup.key === ref.key && now - this.lastPickup.time < 500) {
        this.lastPickup = null;
        this.collectAll();
        return;
      }
      // with a stack on the cursor, a press may become a drag across slots
      if (!e.shiftKey && this.cursor && (e.button === 0 || e.button === 2) && ref.key && this.canDropInto(ref, this.cursor)) {
        this.drag = { button: e.button, keys: new Set([ref.key]), refs: [ref] };
        el.classList.add('drag-over');
        return;
      }
      const hadCursor = !!this.cursor;
      this.clickSlot(ref, e.button, e.shiftKey);
      this.lastPickup = !hadCursor && this.cursor && e.button === 0 ? { key: ref.key, time: now } : null;
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
    // a previewed recipe shows its ingredients as faint items until something is placed
    const ghostCells = new Map();
    if (this.ghost && this.craftGrid.every((c) => !c)) {
      for (const c of recipeCells(this.ghost)) ghostCells.set(c.y * size + c.x, c.group);
    } else {
      this.ghost = null;
    }
    for (let i = 0; i < size * size; i++) {
      const el = this.slotEl(this.craftRef(i));
      const group = ghostCells.get(i);
      if (group) {
        const have = group.some((id) => this.player.countOf(id) > 0);
        const img = document.createElement('img');
        img.className = 'ghost-item';
        if (!have) el.classList.add('ghost-lacking');   // red outline: you have none of this
        img.src = this.atlas.icon(group[0]);
        img.alt = '';
        el.appendChild(img);
        el.title = `${groupLabel(group)}${have ? '' : ' (you have none)'}`;
      }
      grid.appendChild(el);
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
        key: `chest:${i}`,
      }));
    }
    win.appendChild(grid);
  }

  // ---------- smelting guide ----------

  renderSmeltingGuide() {
    const book = document.createElement('div');
    book.className = 'inv-window recipe-book';
    const h3 = document.createElement('h3');
    h3.textContent = 'Smelting';
    book.appendChild(h3);
    const entries = [...SMELTING].map(([input, out], order) => ({ input, out, have: this.player.countOf(input), order }))
      .sort((a, b) => (b.have > 0) - (a.have > 0) || a.order - b.order);
    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    for (const e of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `recipe smelt ${e.have ? 'craftable' : 'missing'}`;
      const img = document.createElement('img');
      img.src = this.atlas.icon(e.out.id);
      img.alt = '';
      b.appendChild(img);
      const from = document.createElement('img');
      from.className = 'smelt-from';
      from.src = this.atlas.icon(e.input);
      from.alt = '';
      b.appendChild(from);
      const inName = itemInfo(e.input)?.display ?? '?', outName = itemInfo(e.out.id)?.display ?? '?';
      b.setAttribute('aria-label', `${inName} to ${outName}`);
      b.addEventListener('mousemove', (ev) => this.showTooltipLines(outName, [
        `Smelt: ${inName}`,
        e.have ? `Click to load ${Math.min(e.have, maxStack(e.input))} plus fuel` : `You have no ${inName}`,
      ], ev.clientX, ev.clientY));
      b.addEventListener('mouseleave', () => this.hideTooltip());
      b.addEventListener('click', () => {
        if (!e.have) return;
        this.game.sfx?.play('click');
        this.loadFurnace(e.input);
      });
      grid.appendChild(b);
    }
    book.appendChild(grid);
    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = 'Fuel: coal and charcoal burn longest; wood, planks and sticks work too';
    book.appendChild(hint);
    return book;
  }

  // Put a stack of `input` into the furnace and enough of the best fuel to cook it.
  loadFurnace(input) {
    const st = furnaceState(this.game.world, this.furnacePos.x, this.furnacePos.y, this.furnacePos.z);
    const p = this.player;
    if (st.input && st.input.id !== input) {
      const left = p.giveStack(st.input);
      st.input = left > 0 ? { ...st.input, count: left } : null;
      if (st.input) { this.afterChange(); return; }
    }
    const room = maxStack(input) - (st.input?.count ?? 0);
    const n = p.take(input, room);
    if (n > 0) st.input = { id: input, count: (st.input?.count ?? 0) + n };

    // fuel: only everyday fuels (never a coal block, chest or bookshelf), the
    // smallest one that covers the whole job, else the longest-burning
    if (!st.fuel || st.fuel.id !== input) {
      const job = st.input.count * SMELT_TIME - st.burnLeft;
      let best = null;
      for (const s of p.inventory) {
        if (!s || !AUTO_FUELS.has(s.id) || s.id === input) continue;
        const burn = itemInfo(s.id).burnTime;
        const covers = burn * p.countOf(s.id) >= job;
        const better = !best || (covers && !best.covers) || (covers === best.covers && (covers ? burn < best.burn : burn > best.burn));
        if (better) best = { id: s.id, burn, covers };
      }
      if (best && (!st.fuel || st.fuel.id === best.id)) {
        const needed = Math.ceil((st.input.count * SMELT_TIME - st.burnLeft) / best.burn);
        const have = st.fuel?.count ?? 0;
        const want = Math.min(maxStack(best.id) - have, Math.max(0, needed - have));
        const got = p.take(best.id, want);
        if (got > 0) st.fuel = { id: best.id, count: have + got };
      }
    }
    this.afterChange();
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

    const tabs = document.createElement('div');
    tabs.className = 'creative-tabs book-tabs';
    for (const [id, label] of BOOK_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'creative-tab';
      b.textContent = label;
      b.setAttribute('aria-selected', String(id === this.bookTab));
      b.addEventListener('click', () => { this.bookTab = id; this.render(); });
      tabs.appendChild(b);
    }
    book.appendChild(tabs);

    const search = document.createElement('input');
    search.className = 'creative-search book-search';
    search.type = 'search';
    search.placeholder = 'Search recipes…';
    search.setAttribute('aria-label', 'Search recipes');
    search.value = this.bookQuery;
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    search.addEventListener('input', () => {
      this.bookQuery = search.value;
      this.fillRecipeGrid(grid);
    });
    search.addEventListener('focus', () => { this.bookFocusSearch = true; });
    search.addEventListener('blur', () => { this.bookFocusSearch = false; });
    book.appendChild(search);

    const grid = document.createElement('div');
    grid.className = 'recipe-grid';
    this.fillRecipeGrid(grid);
    book.appendChild(grid);

    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = this.game.input.altInput === 'touch'
      ? 'Tap: fill the grid (or preview a missing recipe)'
      : 'Click: fill the grid (or preview a missing recipe) · Shift-click: as many as you can';
    book.appendChild(hint);
    if (this.bookFocusSearch) setTimeout(() => search.focus(), 0);
    return book;
  }

  fillRecipeGrid(grid) {
    grid.innerHTML = '';
    // ingredients already in the grid go back to the inventory on fill, so they count
    const countOf = (id) => this.player.countOf(id)
      + this.craftGrid.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
    const size = this.craftSize;
    const q = this.bookQuery.trim().toLowerCase();
    const entries = RECIPES.map((r, order) => {
      const avail = recipeAvailability(r, countOf);
      const { w, h } = recipeSize(r);
      const fits = w <= size && h <= size;
      const state = avail.ok ? (fits ? 'craftable' : 'needs-table') : 'missing';
      return { r, avail, fits, state, order };
    }).filter((e) => {
      if (this.bookCraftableOnly && e.state !== 'craftable') return false;
      const cat = creativeCategory(e.r.result);
      if (this.bookTab !== 'all' && cat !== this.bookTab && !(this.bookTab === 'blocks' && cat === 'decor')) return false;
      if (!q) return true;
      // match the result or any ingredient ("planks" finds everything made of planks)
      const names = [e.r.result, ...recipeNeeds(e.r).map((n) => n.group[0])]
        .map((id) => itemInfo(id)?.display.toLowerCase() ?? '');
      return names.some((n) => n.includes(q));
    });
    const rank = { craftable: 0, 'needs-table': 1, missing: 2 };
    entries.sort((a, b) => rank[a.state] - rank[b.state] || a.order - b.order);
    for (const e of entries) grid.appendChild(this.recipeButton(e, countOf));
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'creative-empty';
      empty.textContent = q || this.bookTab !== 'all' ? 'No matching recipes.' : 'Nothing you can make yet — gather more materials.';
      grid.appendChild(empty);
    }
  }

  // a miniature of the recipe's shape, for tooltips
  recipePreview(r, pick) {
    const { w, h } = recipeSize(r);
    const box = document.createElement('div');
    box.className = 'recipe-preview';
    box.style.gridTemplateColumns = `repeat(${w}, 18px)`;
    const cells = new Map(recipeCells(r).map((c) => [`${c.x},${c.y}`, c.group]));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = document.createElement('div');
        const group = cells.get(`${x},${y}`);
        if (group) {
          const img = document.createElement('img');
          img.src = this.atlas.icon(pick.get(group) ?? group[0]);
          img.alt = '';
          cell.appendChild(img);
        }
        box.appendChild(cell);
      }
    }
    return box;
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
      else if (fits) lines.push('Click to see where everything goes');
      else if (state === 'needs-table') lines.push('Needs a Crafting Table (3×3 grid)');
      else {
        const missing = needs.map((n) => {
          const have = Math.max(...n.group.map(countOf));
          return have < n.count ? `${n.count - have} × ${groupLabel(n.group)}` : null;
        }).filter(Boolean);
        lines.push(`Missing: ${missing.join(', ')}`);
      }
      this.showTooltipLines(r.count > 1 ? `${name} ×${r.count}` : name, lines, ev.clientX, ev.clientY, this.recipePreview(r, avail.pick));
    });
    b.addEventListener('mouseleave', () => this.hideTooltip());
    b.addEventListener('click', (ev) => {
      if (!fits) return;
      this.game.sfx?.play('click');
      if (state === 'craftable') this.fillRecipe(r, ev.shiftKey);
      else this.showGhost(r);
    });
    return b;
  }

  // Show a missing recipe's layout as faint items in the (emptied) craft grid.
  showGhost(r) {
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      const left = this.player.giveStack(s);
      if (left > 0) this.dropStack({ ...s, count: left });
      this.craftGrid[i] = null;
    }
    this.ghost = r;
    this.player.events.dispatchEvent(new CustomEvent('inventory'));
    this.render();
  }

  // Move a recipe's ingredients from the inventory into the craft grid.
  fillRecipe(r, max) {
    // clear the grid back into the inventory first
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      const left = this.player.giveStack(s);
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
      // whichever variant of the group is most plentiful right now
      let id = avail.pick.get(group), most = -1;
      for (const g of group) { const c = this.player.countOf(g); if (c > most) { most = c; id = g; } }
      const count = Math.min(n, most);
      if (count <= 0) continue;
      this.player.take(id, count);
      this.craftGrid[y * this.craftSize + x] = { id, count };
    }
    this.afterChange();
  }

  renderFurnace(win) {
    const st = furnaceState(this.game.world, this.furnacePos.x, this.furnacePos.y, this.furnacePos.z);
    const head = document.createElement('div');
    head.className = 'craft-head';
    const h3 = document.createElement('h3');
    h3.textContent = 'Furnace';
    head.appendChild(h3);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'book-toggle';
    toggle.textContent = this.bookOpen ? '◀ Hide guide' : '▶ Smelting guide';
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

    const col = document.createElement('div');
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.gap = '4px';
    col.appendChild(this.slotEl(this.beRef(st, 'input')));

    const flame = document.createElement('div');
    flame.className = 'furnace-flame';
    const flameImg = document.createElement('img');
    flameImg.src = this.atlas.icon(B.CAMPFIRE);   // pixel-art flame, not a platform emoji
    flameImg.alt = '';
    flame.appendChild(flameImg);
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
      key: `inv:${i}`,
    };
  }

  armorRef(i) {
    return {
      get: () => this.player.armor[i],
      set: (s) => { this.player.armor[i] = s; },
      area: 'armor',
      armorSlot: i,
      key: `armor:${i}`,
      filter: (id) => itemInfo(id)?.armor?.slot === i,
    };
  }

  craftRef(i) {
    return {
      get: () => this.craftGrid[i],
      set: (s) => { this.craftGrid[i] = s; },
      area: 'craft',
      key: `craft:${i}`,
    };
  }

  craftResultRef() {
    return {
      get: () => {
        const size = this.craftSize;
        const grid = [];
        for (let i = 0; i < size * size; i++) grid.push(this.craftGrid[i]?.id ?? 0);
        const m = matchRecipe(grid, size, size);
        return m ? makeStack(m.id, m.count) : this.repairResult();
      },
      set: () => {},
      output: 'craft',
    };
  }

  // two worn tools (or bows/armour) of the same kind mend into one, with a
  // small bonus on top of their combined durability
  repairResult() {
    const items = this.craftGrid.filter(Boolean);
    if (items.length !== 2 || items[0].id !== items[1].id || items[0].dur === undefined) return null;
    const info = itemInfo(items[0].id);
    const max = info?.tool?.durability ?? info?.armor?.durability ?? info?.bow?.durability;
    if (!max) return null;
    return { id: items[0].id, count: 1, dur: Math.min(max, items[0].dur + items[1].dur + Math.floor(max * 0.05)) };
  }

  beRef(st, field) {
    return {
      get: () => st[field],
      set: (s) => { st[field] = s; },
      area: 'furnace',
      key: `furnace:${field}`,
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
        // crafting: only craft when the whole result fits, or it would be free
        if (ref.output === 'craft' && roomFor(this.player, out) < out.count) break;
        // stacks with durability (a repaired tool) keep it
        const left = out.dur !== undefined ? this.player.giveStack({ ...out }) : this.player.give(out.id, out.count);
        if (left > 0) {
          // furnace: keep whatever didn't fit in the output slot
          if (ref.output !== 'craft') ref.set(left === out.count ? out : { ...out, count: left });
          break;
        }
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
      const left = this.player.giveStack(stack);
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

  // can this slot accept (part of) the stack?
  canDropInto(ref, stack) {
    if (!stack || ref.output || ref.creative !== undefined) return false;
    if (ref.filter && !ref.filter(stack.id)) return false;
    const cur = ref.get();
    if (!cur) return true;
    return cur.id === stack.id && cur.dur === undefined && stack.dur === undefined && cur.count < maxStack(cur.id);
  }

  // drag-split: share the cursor stack evenly (left) or one each (right)
  distribute(refs, oneEach) {
    const stack = this.cursor;
    const per = oneEach ? 1 : Math.max(1, Math.floor(stack.count / refs.length));
    for (const ref of refs) {
      if (stack.count <= 0) break;
      const cur = ref.get();
      const room = cur ? maxStack(cur.id) - cur.count : maxStack(stack.id);
      const put = Math.min(per, room, stack.count);
      if (put <= 0) continue;
      if (cur) cur.count += put;
      else ref.set({ ...stack, count: put });
      stack.count -= put;
    }
    if (stack.count <= 0) this.cursor = null;
    this.afterChange();
  }

  // double-click: pull matching stacks from the inventory (and open chest) onto the cursor
  collectAll() {
    const c = this.cursor;
    if (!c || c.dur !== undefined) return;
    const pools = [this.player.inventory];
    if (this.open === 'chest') pools.push(this.chestState().slots);
    for (const slots of pools) {
      for (let i = 0; i < slots.length && c.count < maxStack(c.id); i++) {
        const s = slots[i];
        if (!s || s.id !== c.id || s.dur !== undefined) continue;
        const take = Math.min(s.count, maxStack(c.id) - c.count);
        c.count += take;
        s.count -= take;
        if (s.count <= 0) slots[i] = null;
      }
    }
    this.afterChange();
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
    // an open chest or furnace may just have changed: save its chunk too
    const pos = this.open === 'chest' ? this.chestPos : this.open === 'furnace' ? this.furnacePos : null;
    if (pos) this.game.world.markModified(pos.x, pos.z);
    this.player.events.dispatchEvent(new CustomEvent('inventory'));
    this.renderCursor();
    this.render();
  }

  // called by game each frame while a furnace is open, to refresh progress bars
  refreshIfFurnace() {
    if (this.open === 'furnace') this.render();
  }
}
