// HUD: hotbar, health / hunger / air bars, held-item label, debug overlay,
// and the "click to play" prompt shown while the pointer isn't locked.

import { itemInfo } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

export function durabilityColor(frac) {
  return frac > 0.5 ? '#4caf50' : frac > 0.2 ? '#ffb300' : '#e53935';
}

// Fill a slot element with a stack's icon, count and durability bar.
// Shared by the hotbar and every container window.
export function fillSlot(el, stack, atlas) {
  el.innerHTML = '';
  if (!stack) return;
  const img = document.createElement('img');
  img.src = atlas.icon(stack.id);
  img.draggable = false;
  img.alt = '';
  el.appendChild(img);
  if (stack.count > 1) {
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = stack.count;
    el.appendChild(c);
  }
  if (stack.dur !== undefined) {
    const info = itemInfo(stack.id);
    if (info?.tool && stack.dur < info.tool.durability) {
      const bar = document.createElement('div');
      bar.className = 'durability';
      const fill = document.createElement('div');
      const frac = stack.dur / info.tool.durability;
      fill.style.width = `${Math.round(frac * 100)}%`;
      fill.style.background = durabilityColor(frac);
      bar.appendChild(fill);
      el.appendChild(bar);
    }
  }
}

export class Hud {
  constructor(atlas, player) {
    this.atlas = atlas;
    this.player = player;
    this.root = document.getElementById('hud');
    this.hotbarEl = document.getElementById('hotbar');
    this.healthEl = document.getElementById('health-bar');
    this.hungerEl = document.getElementById('hunger-bar');
    this.airEl = document.getElementById('air-bar');
    this.labelEl = document.getElementById('held-item-label');
    this.debugEl = document.getElementById('debug-overlay');
    this.promptEl = document.getElementById('click-to-play');
    this.fpsEl = document.getElementById('fps-counter');
    this._labelTimer = null;
    this._lastSelected = -1;
    this._statsKey = '';

    this.slots = [];
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      this.hotbarEl.appendChild(el);
      this.slots.push(el);
    }

    player.events.addEventListener('inventory', () => this.renderHotbar());
    this.renderHotbar();
    this.renderStats();
  }

  show() { this.root.classList.remove('hidden'); }
  hide() {
    this.root.classList.add('hidden');
    this.root.classList.remove('bare');
    this.setPrompt(false);
  }

  setPrompt(visible) {
    this.promptEl.classList.toggle('hidden', !visible);
  }

  renderHotbar() {
    const p = this.player;
    for (let i = 0; i < 9; i++) {
      const el = this.slots[i];
      el.classList.toggle('selected', i === p.selected);
      fillSlot(el, p.inventory[i], this.atlas);
    }
    if (p.selected !== this._lastSelected) {
      this._lastSelected = p.selected;
      this.showLabel();
    }
  }

  showLabel() {
    const s = this.player.heldStack();
    this.labelEl.textContent = s ? itemInfo(s.id)?.display ?? '' : '';
    this.labelEl.style.opacity = '1';
    clearTimeout(this._labelTimer);
    this._labelTimer = setTimeout(() => { this.labelEl.style.opacity = '0'; }, 1600);
  }

  renderStats() {
    const p = this.player;
    const creative = p.mode === GAMEMODE_CREATIVE;
    // called several times a second; only touch the DOM when something changed
    const key = creative ? 'c' : `${p.health}|${p.hunger}|${p.air}`;
    if (key === this._statsKey) return;
    this._statsKey = key;

    this.healthEl.innerHTML = '';
    this.hungerEl.innerHTML = '';
    this.airEl.innerHTML = '';
    if (creative) return;

    const icon = (glyph) => {
      const el = document.createElement('span');
      el.className = 'stat-icon';
      el.textContent = glyph;
      return el;
    };

    for (let i = 0; i < 10; i++) {
      const heart = icon('❤');
      const v = p.health - i * 2;
      heart.style.color = v >= 2 ? '#e53935' : v >= 1 ? '#ef9a9a' : '#3a3a3a';
      this.healthEl.appendChild(heart);
    }
    this.healthEl.classList.toggle('low', p.health <= 4);

    // hunger drains from the left, like the bar it mirrors
    for (let i = 9; i >= 0; i--) {
      const food = icon('🍗');
      const v = p.hunger - i * 2;
      food.style.filter = v >= 2 ? 'none' : v >= 1 ? 'grayscale(50%) brightness(0.9)' : 'grayscale(100%) brightness(0.5)';
      this.hungerEl.appendChild(food);
    }

    if (p.air < 20) {
      for (let i = 9; i >= 0; i--) {
        const bub = icon('🫧');
        bub.style.visibility = p.air - i * 2 >= 1 ? 'visible' : 'hidden';
        this.airEl.appendChild(bub);
      }
    }
  }

  showFps(on) {
    this.fpsEl.classList.toggle('hidden', !on);
  }

  setFps(fps) {
    this.fpsEl.textContent = `${fps} FPS`;
  }

  setDebug(text) {
    this.debugEl.textContent = text;
  }

  toggleDebug() {
    this.debugEl.classList.toggle('hidden');
  }

  // F1: hide everything but chat, for screenshots
  toggleHidden() {
    this.root.classList.toggle('bare');
  }
}
