// HUD: hotbar, health / hunger / air bars, held-item label, debug overlay,
// and the "click to play" prompt shown while the pointer isn't locked.

import { itemInfo } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { HUD_ICONS } from './icons.js';

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
    const max = info?.tool?.durability ?? info?.armor?.durability ?? info?.bow?.durability;
    if (max && stack.dur < max) {
      const bar = document.createElement('div');
      bar.className = 'durability';
      const fill = document.createElement('div');
      const frac = stack.dur / max;
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
    this.armorEl = document.getElementById('armor-bar');
    this.labelEl = document.getElementById('held-item-label');
    this.debugEl = document.getElementById('debug-overlay');
    this.promptEl = document.getElementById('click-to-play');
    this.fpsEl = document.getElementById('fps-counter');
    this.toastsEl = document.getElementById('toasts');
    this.toastsEl.innerHTML = '';
    this.invHintEl = document.getElementById('inventory-hint');
    this.invHintEl.classList.add('hidden');
    document.getElementById('sleep-fade').classList.remove('on');
    this.vignetteEl = document.getElementById('vignette');
    // drop the flash class afterwards so the low-health pulse can resume
    this.vignetteEl.onanimationend = (e) => {
      if (e.animationName === 'hurt-flash') this.vignetteEl.classList.remove('hit');
    };
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

    // remember counts so pickups can flash the slot that grew
    this._counts = new Array(9).fill(0);
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
      const s = p.inventory[i];
      fillSlot(el, s, this.atlas);
      const count = s?.count ?? 0;
      if (this._primed && count > this._counts[i]) {
        el.classList.remove('bump');
        void el.offsetWidth;   // restart the animation
        el.classList.add('bump');
      }
      this._counts[i] = count;
    }
    this._primed = true;
    if (p.selected !== this._lastSelected) {
      this._lastSelected = p.selected;
      this.showLabel();
    }
  }

  // text defaults to the held item's name
  showLabel(text = null, warn = false) {
    const s = this.player.heldStack();
    this.labelEl.textContent = text ?? (s ? itemInfo(s.id)?.display ?? '' : '');
    this.labelEl.classList.toggle('warn', warn);
    this.labelEl.style.opacity = '1';
    clearTimeout(this._labelTimer);
    this._labelTimer = setTimeout(() => { this.labelEl.style.opacity = '0'; }, 1600);
  }

  renderStats() {
    const p = this.player;
    const creative = p.mode === GAMEMODE_CREATIVE;
    // called several times a second; only touch the DOM when something changed
    const armor = p.armorPoints();
    const key = creative ? 'c' : `${p.health}|${p.hunger}|${p.air}|${armor}`;
    if (key === this._statsKey) return;
    this._statsKey = key;

    this.healthEl.innerHTML = '';
    this.hungerEl.innerHTML = '';
    this.airEl.innerHTML = '';
    this.armorEl.innerHTML = '';
    if (creative) { this.setLowHealth(false); return; }

    const icon = (src) => {
      const el = document.createElement('img');
      el.className = 'stat-icon';
      el.src = src;
      el.alt = '';
      el.draggable = false;
      return el;
    };
    const I = HUD_ICONS;

    for (let i = 0; i < 10; i++) {
      const v = p.health - i * 2;
      this.healthEl.appendChild(icon(v >= 2 ? I.heartFull : v >= 1 ? I.heartHalf : I.heartEmpty));
    }
    this.healthEl.classList.toggle('low', p.health <= 4);
    this.setLowHealth(p.health <= 4);

    // armour bar only appears once something is worn
    if (armor > 0) {
      for (let i = 0; i < 10; i++) {
        const v = armor - i * 2;
        this.armorEl.appendChild(icon(v >= 2 ? I.armorFull : v >= 1 ? I.armorHalf : I.armorEmpty));
      }
    }

    // hunger drains from the left, like the bar it mirrors
    for (let i = 9; i >= 0; i--) {
      const v = p.hunger - i * 2;
      this.hungerEl.appendChild(icon(v >= 2 ? I.foodFull : v >= 1 ? I.foodHalf : I.foodEmpty));
    }
    // too hungry to sprint or heal: the bar jitters
    this.hungerEl.classList.toggle('low', p.hunger <= 6);

    if (p.air < 20) {
      for (let i = 9; i >= 0; i--) {
        const bub = icon(I.bubble);
        bub.style.visibility = p.air - i * 2 >= 1 ? 'visible' : 'hidden';
        this.airEl.appendChild(bub);
      }
    }
  }

  // red edge flash when hurt
  flashDamage() {
    const v = this.vignetteEl;
    v.classList.remove('hit');
    void v.offsetWidth;
    v.classList.add('hit');
  }

  setBowCharge(f) {
    const el = document.getElementById('bow-charge');
    el.classList.toggle('hidden', f <= 0);
    el.firstChild.style.width = `${Math.round(f * 100)}%`;
    el.classList.toggle('full', f >= 1);
  }

  sleepFade(on) {
    document.getElementById('sleep-fade').classList.toggle('on', on);
  }

  setLowHealth(on) {
    this.vignetteEl.classList.toggle('low', on);
  }

  // pop-up card (top right) for tips and milestones
  toast(title, text, iconId = null, ms = 9000) {
    const el = document.createElement('div');
    el.className = 'toast';
    if (iconId) {
      const img = document.createElement('img');
      img.src = this.atlas.icon(iconId);
      img.alt = '';
      el.appendChild(img);
    }
    const body = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'toast-title';
    t.textContent = title;
    body.appendChild(t);
    if (text) {
      const d = document.createElement('div');
      d.className = 'toast-text';
      d.textContent = text;
      body.appendChild(d);
    }
    el.appendChild(body);
    this.toastsEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  toastBusy() {
    return this.toastsEl.childElementCount > 0;
  }

  // "E  Inventory & crafting" chip beside the hotbar until the player has found it
  setInventoryHint(label) {
    this.invHintEl.classList.toggle('hidden', !label);
    this.root.classList.toggle('inv-hint-on', !!label);   // also pulses the touch ▦ button
    if (!label || this.invHintEl.dataset.label === label) return;
    this.invHintEl.dataset.label = label;
    const kbd = document.createElement('kbd');
    kbd.textContent = label;
    this.invHintEl.replaceChildren(kbd, ' Inventory & crafting');
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
    const on = this.debugEl.classList.toggle('hidden') === false;
    this.root.classList.toggle('debug-on', on);
  }

  // F1: hide everything but chat, for screenshots
  toggleHidden() {
    this.root.classList.toggle('bare');
  }
}
