// Container UIs: player inventory (with 2x2 crafting), crafting table (3x3),
// furnace, and the creative item palette. Handles cursor stack drag logic,
// right-click split, shift-click quick move, and tooltips.

import { itemInfo, maxStack, makeStack } from '../items/items.js';
import { matchRecipe, SMELTING, SMELT_TIME } from '../items/recipes.js';
import { furnaceState } from '../items/furnace.js';
import { BLOCKS } from '../blocks/blocks.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { I } from '../items/itemIds.js';
import { fillSlot } from './hud.js';

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
    if (stack.dur !== undefined && info?.tool) {
      const d = document.createElement('div');
      d.className = 'tooltip-sub';
      d.textContent = `Durability ${stack.dur} / ${info.tool.durability}`;
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
    this.open = null;
    this.furnacePos = null;
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
      if (e.target === screen) {
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
    const win = document.createElement('div');
    win.className = 'inv-window';
    screen.appendChild(win);
    this.root.appendChild(screen);

    if (this.open === 'inventory' && this.player.mode === GAMEMODE_CREATIVE) {
      this.renderCreative(win);
    } else if (this.open === 'inventory') {
      this.renderCraftArea(win, 2, 'Crafting');
    } else if (this.open === 'crafting') {
      this.renderCraftArea(win, 3, 'Crafting Table');
    } else if (this.open === 'furnace') {
      this.renderFurnace(win);
    }

    this.renderPlayerInv(win);

    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = this.open === 'inventory' && this.player.mode === GAMEMODE_CREATIVE
      ? 'Left-click: stack · Right-click: one · Click outside: drop · E: close'
      : 'Right-click: split · Shift-click: move · Click outside: drop · E: close';
    win.appendChild(hint);
    this.renderCursor();
  }

  slotEl(ref) {
    const el = document.createElement('div');
    el.className = 'slot';
    fillSlot(el, ref.get(), this.atlas);
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
    win.appendChild(main);

    const hot = document.createElement('div');
    hot.className = 'inv-grid cols-9';
    hot.style.marginTop = '8px';
    for (let i = 0; i < 9; i++) hot.appendChild(this.slotEl(this.invRef(i)));
    win.appendChild(hot);
  }

  renderCraftArea(win, size, title) {
    const h3 = document.createElement('h3');
    h3.textContent = title;
    win.appendChild(h3);

    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '12px';

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
    const h3 = document.createElement('h3');
    h3.textContent = 'All Items';
    win.appendChild(h3);
    const grid = document.createElement('div');
    grid.className = 'inv-grid cols-9';
    grid.style.maxHeight = '260px';
    grid.style.overflowY = 'auto';
    grid.style.marginBottom = '12px';

    const ids = [];
    for (const b of BLOCKS) {
      if (b && b.id !== 0 && b.name !== 'furnace_lit' && b.name !== 'water') ids.push(b.id);
    }
    for (const id of Object.values(I)) ids.push(id);

    for (const id of ids) {
      const ref = {
        get: () => ({ id, count: 1 }),
        set: () => {},
        creative: id,
      };
      grid.appendChild(this.slotEl(ref));
    }
    win.appendChild(grid);
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
