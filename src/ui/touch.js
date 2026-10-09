// On-screen touch controls for phones and tablets: a movement stick, drag to
// look, tap to use / place (or hit a mob), touch-and-hold to mine, plus jump,
// sneak and menu buttons. Shown automatically on the first touch.

import { currentGuiScale } from './display.js';

const LOOK_GAIN = 1.4;      // touch drag pixels -> mouse pixels
const HOLD_MS = 280;        // touch-and-hold this long (without dragging) to mine
const TAP_SLOP = 12;        // px of drift still counted as a tap

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.root = document.getElementById('touch-controls');
    this.hudEl = document.getElementById('hud');
    this.enabled = false;
    this.look = null;        // active look pointer {id, x, y, sx, sy, t, mining, timer}
    this.stickId = null;
    this.sneak = false;
    const signal = game.input.signal;

    this.build();
    // the first touch anywhere switches the HUD into touch mode; a mouse click switches back
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.enable();
      else if (e.pointerType === 'mouse' && this.enabled) this.disable();
    }, { capture: true, signal });
    if (matchMedia('(pointer: coarse)').matches) this.enable();

    // tap a hotbar slot to select it
    game.hud.hotbarEl.addEventListener('pointerdown', (e) => {
      const i = game.hud.slots.indexOf(e.target.closest('.slot'));
      if (i < 0 || !this.enabled) return;
      game.player.selected = i;
      game.hud.renderHotbar();
    }, { signal });
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    const el = (cls, parent = r, text = '') => {
      const d = document.createElement('div');
      d.className = cls;
      if (text) d.textContent = text;
      parent.appendChild(d);
      return d;
    };

    const look = el('tc-look');
    look.addEventListener('pointerdown', (e) => this.lookStart(e));
    look.addEventListener('pointermove', (e) => this.lookMove(e));
    look.addEventListener('pointerup', (e) => this.lookEnd(e, false));
    look.addEventListener('pointercancel', (e) => this.lookEnd(e, true));

    const stick = el('tc-stick');
    this.knob = el('tc-knob', stick);
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      this.stickMove(e, stick);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.stickMove(e, stick); });
    const stickEnd = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.move.x = this.input.move.y = 0;
      this.input.holdAction('sprint', false);
      this.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', stickEnd);
    stick.addEventListener('pointercancel', stickEnd);

    // buttons: [class, label, aria label, down handler, up handler]
    const button = (cls, label, aria, down, up = null) => {
      const b = el(`tc-btn ${cls}`, r, label);
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', aria);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); down(); });
      const release = () => { b.classList.remove('down'); up?.(); };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('pointerleave', release);
      return b;
    };
    button('tc-jump', '⤒', 'Jump', () => {
      this.input.tapAction('jump');   // double-tap toggles flight in creative
      this.input.holdAction('jump', true);
    }, () => this.input.holdAction('jump', false));
    this.sneakBtn = button('tc-sneak tc-text', 'Sneak', 'Sneak (toggle)', () => {
      this.sneak = !this.sneak;
      this.sneakBtn.classList.toggle('on', this.sneak);
      this.input.holdAction('sneak', this.sneak);
    });
    button('tc-inv', '▦', 'Inventory', () => this.input.tapAction('inventory'));
    button('tc-drop tc-text', 'Drop', 'Drop item', () => this.input.tapAction('drop'));
    button('tc-chat', '…', 'Chat', () => this.input.tapAction('chat'));
    button('tc-pause', 'II', 'Pause', () => this.input.tapAction('pause'));
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.input.altInput = 'touch';
    this.root.classList.remove('hidden');
    this.hudEl.classList.add('touch');
  }

  disable() {
    this.enabled = false;
    this.input.altInput = null;
    this.root.classList.add('hidden');
    this.hudEl.classList.remove('touch');
    this.input.releaseVirtual();
    this.sneak = false;
    this.sneakBtn.classList.remove('on');
  }

  dispose() {
    clearTimeout(this.look?.timer);
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
    this.hudEl.classList.remove('touch');
  }

  // ---- movement stick ----

  stickMove(e, stick) {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (e.clientX - (r.left + radius)) / radius;
    let y = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.input.move.x = Math.abs(x) < 0.12 ? 0 : x;
    this.input.move.y = Math.abs(y) < 0.12 ? 0 : -y;
    // pushing the stick all the way forward sprints
    this.input.holdAction('sprint', y < -0.92);
    // the knob lives inside the zoomed HUD, so convert screen px to HUD px
    const k = (radius * 0.55) / currentGuiScale();
    this.knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
  }

  // ---- look / tap / hold ----

  lookStart(e) {
    e.preventDefault();
    if (this.look) return;   // one look finger at a time
    e.currentTarget.setPointerCapture(e.pointerId);
    const look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), mining: false };
    // holding still starts mining (and hits a mob if one is under the crosshair)
    look.timer = setTimeout(() => {
      look.mining = true;
      this.input.holdButton(0, true);
    }, HOLD_MS);
    this.look = look;
  }

  lookMove(e) {
    const look = this.look;
    if (!look || e.pointerId !== look.id) return;
    this.input.dx += (e.clientX - look.x) * LOOK_GAIN;
    this.input.dy += (e.clientY - look.y) * LOOK_GAIN;
    look.x = e.clientX;
    look.y = e.clientY;
    if (!look.mining && Math.hypot(look.x - look.sx, look.y - look.sy) > TAP_SLOP) clearTimeout(look.timer);
  }

  lookEnd(e, cancelled) {
    const look = this.look;
    if (!look || e.pointerId !== look.id) return;
    this.look = null;
    clearTimeout(look.timer);
    if (look.mining) {
      this.input.holdButton(0, false);
      return;
    }
    const still = Math.hypot(look.x - look.sx, look.y - look.sy) <= TAP_SLOP;
    if (!cancelled && still && !this.game.uiOpen && !this.game.player.dead) {
      // a tap hits a mob in reach, otherwise uses / places
      if (!this.game.attackMob()) this.input.clickButton(2);
    }
  }
}
