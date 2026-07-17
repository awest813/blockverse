// HUD: hotbar, health / hunger / air bars, held-item label, debug overlay.

import { itemInfo } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

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
    this._labelTimer = null;
    this._lastSelected = -1;

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
  hide() { this.root.classList.add('hidden'); }

  renderHotbar() {
    const p = this.player;
    for (let i = 0; i < 9; i++) {
      const el = this.slots[i];
      const s = p.inventory[i];
      el.classList.toggle('selected', i === p.selected);
      el.innerHTML = '';
      if (s) {
        const img = document.createElement('img');
        img.src = this.atlas.icon(s.id);
        img.draggable = false;
        el.appendChild(img);
        if (s.count > 1) {
          const c = document.createElement('span');
          c.className = 'count';
          c.textContent = s.count;
          el.appendChild(c);
        }
        if (s.dur !== undefined) {
          const info = itemInfo(s.id);
          if (info?.tool && s.dur < info.tool.durability) {
            const bar = document.createElement('div');
            bar.className = 'durability';
            const fill = document.createElement('div');
            const frac = s.dur / info.tool.durability;
            fill.style.width = `${Math.round(frac * 100)}%`;
            fill.style.background = frac > 0.5 ? '#4caf50' : frac > 0.2 ? '#ffb300' : '#e53935';
            bar.appendChild(fill);
            el.appendChild(bar);
          }
        }
      }
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
    this.healthEl.innerHTML = '';
    this.hungerEl.innerHTML = '';
    this.airEl.innerHTML = '';
    if (creative) return;

    for (let i = 0; i < 10; i++) {
      const heart = document.createElement('span');
      heart.className = 'stat-icon';
      const v = p.health - i * 2;
      heart.textContent = '❤';
      heart.style.color = v >= 2 ? '#e53935' : v >= 1 ? '#ef9a9a' : '#3a3a3a';
      this.healthEl.appendChild(heart);
    }
    for (let i = 9; i >= 0; i--) {
      const food = document.createElement('span');
      food.className = 'stat-icon';
      const v = p.hunger - i * 2;
      food.textContent = '🍗';
      food.style.filter = v >= 2 ? 'none' : v >= 1 ? 'grayscale(50%) brightness(0.9)' : 'grayscale(100%) brightness(0.5)';
      this.airEl.style.marginBottom = '0';
      this.hungerEl.appendChild(food);
    }
    if (p.air < 20) {
      for (let i = 9; i >= 0; i--) {
        const bub = document.createElement('span');
        bub.className = 'stat-icon';
        bub.textContent = '🫧';
        bub.style.visibility = p.air - i * 2 >= 1 ? 'visible' : 'hidden';
        this.airEl.appendChild(bub);
      }
    }
  }

  setDebug(text) {
    this.debugEl.textContent = text;
  }

  toggleDebug() {
    this.debugEl.classList.toggle('hidden');
  }
}
