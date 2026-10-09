// Gamepad support (standard mapping, e.g. Xbox / PlayStation pads).
//
// In game it drives the same Input state as keyboard + mouse. Whenever a
// screen is open (menus, pause, inventory, death) it becomes a spatial
// navigator: the D-pad / left stick moves a highlight between buttons and
// slots, A activates, B goes back.

const DEAD = 0.18;
const LOOK_SPEED = 900;   // mouse-pixel equivalents per second at full tilt
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export const PAD_LAYOUT = [
  ['Left stick', 'Move (click: sprint)'], ['Right stick', 'Look (click: toggle sneak)'],
  ['RT', 'Mine / attack'], ['LT', 'Place / use'],
  ['A', 'Jump (double-tap: fly)'], ['B', 'Drop item'],
  ['X', 'Pick block'], ['Y', 'Inventory'],
  ['LB / RB', 'Hotbar'], ['Start', 'Pause'],
  ['Menus', 'D-pad moves · A select · B back'], ['Inventory', 'X split · RB quick move'],
];

const deadzone = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

const FOCUSABLE = 'button:not(:disabled), input, select, .world-entry, .inv-window .slot';

export class GamepadController {
  constructor({ getGame, uiRoot }) {
    this.getGame = getGame;
    this.uiRoot = uiRoot;
    this.prev = [];
    this.stale = [];           // buttons held across a menu -> game switch, ignored until released
    this.playing = false;
    this.active = false;       // set by the first real button press / stick push
    this.sneak = false;        // right-stick-click toggle
    this.target = null;        // highlighted element in menu mode
    this.targetIndex = -1;
    this.targetScreen = null;
    this.lastDir = null;
    this.repeatAt = 0;
    this.last = performance.now();

    window.addEventListener('gamepadconnected', () => {
      this.getGame()?.chat.message('Controller connected — press Start for the menu', '#9fdcff');
    });
    window.addEventListener('gamepaddisconnected', () => {
      const game = this.getGame();
      if (game) {
        this.releaseGameplay(game);
        if (game.running && !game.uiOpen) game.uiHooks?.showPause?.();
      }
      this.active = false;
    });

    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  pad() {
    for (const p of navigator.getGamepads?.() ?? []) if (p?.connected) return p;
    return null;
  }

  tick() {
    requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const pad = this.pad();
    if (!pad) return;

    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i) => pressed[i] && !this.prev[i];
    if (!this.active && (pressed.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.5))) this.active = true;
    if (this.active) {
      const game = this.getGame();
      const playing = !!(game?.running && !game.uiOpen && !game.player.dead);
      // e.g. A on "Back to Game" must not also jump
      if (playing && !this.playing) this.stale = pressed.slice();
      this.playing = playing;
      if (playing) {
        this.clearTarget();
        this.stale = this.stale.map((s, i) => s && pressed[i]);
        const live = pressed.map((p, i) => p && !this.stale[i]);
        this.gameplay(game, pad, live, (i) => live[i] && !this.prev[i], dt);
      } else {
        if (game) this.releaseGameplay(game);
        if (!game?.chat.open) this.menus(pad, pressed, edge, now);
        else if (edge(B.B)) this.sendEscape();
      }
    }
    this.prev = pressed;
  }

  // ---------- gameplay ----------

  gameplay(game, pad, pressed, edge, dt) {
    const input = game.input;
    input.altInput = 'gamepad';
    input.move.x = deadzone(pad.axes[0] ?? 0);
    input.move.y = -deadzone(pad.axes[1] ?? 0);
    // squared response: fine aim near the centre, fast turns at the edge
    const rx = deadzone(pad.axes[2] ?? 0), ry = deadzone(pad.axes[3] ?? 0);
    input.dx += rx * Math.abs(rx) * LOOK_SPEED * dt;
    input.dy += ry * Math.abs(ry) * LOOK_SPEED * dt;

    if (edge(B.A)) input.tapAction('jump');
    input.holdAction('jump', pressed[B.A]);
    input.holdAction('sprint', pressed[B.LS]);
    if (edge(B.RS)) this.sneak = !this.sneak;
    input.holdAction('sneak', this.sneak);
    input.holdButton(0, pressed[B.RT]);
    input.holdButton(2, pressed[B.LT]);

    if (edge(B.LB) || edge(B.LEFT)) input.onWheel?.(-1);
    if (edge(B.RB) || edge(B.RIGHT)) input.onWheel?.(1);
    if (edge(B.X)) game.pickBlock();
    if (edge(B.B)) input.tapAction('drop');
    if (edge(B.UP)) input.tapAction('hideHud');
    if (edge(B.BACK)) input.tapAction('chat');
    // opening a screen last, so the presses above don't leak into it
    if (edge(B.Y)) input.tapAction('inventory');
    if (edge(B.START)) input.tapAction('pause');
  }

  releaseGameplay(game) {
    if (game.input.altInput === 'gamepad') game.input.releaseVirtual();
    this.sneak = false;
  }

  // ---------- menus ----------

  menus(pad, pressed, edge, now) {
    const list = this.candidates();
    const screen = this.uiRoot.firstElementChild;
    if (screen !== this.targetScreen) {
      // a new screen: start from its autofocused element, not the old index
      this.targetScreen = screen;
      this.targetIndex = -1;
      this.clearTarget();
    }
    if (!list.length) return;
    // highlight something right away so the first D-pad press moves, not just selects
    if (!this.target && !this.current(list)) this.setTarget(list[0], list);
    // re-renders (inventory clicks, furnace ticks) replace elements; follow by index
    if (this.target && !this.target.isConnected && list[this.targetIndex]) this.setTarget(list[this.targetIndex], list);

    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    const dir = pressed[B.UP] || ay < -0.6 ? 'up'
      : pressed[B.DOWN] || ay > 0.6 ? 'down'
        : pressed[B.LEFT] || ax < -0.6 ? 'left'
          : pressed[B.RIGHT] || ax > 0.6 ? 'right' : null;
    if (dir && (dir !== this.lastDir || now >= this.repeatAt)) {
      this.repeatAt = now + (dir !== this.lastDir ? 380 : 110);
      this.navigate(dir, list);
    }
    this.lastDir = dir;

    if (edge(B.A)) this.activate(list, 0, false);
    if (edge(B.X)) this.activate(list, 2, false);
    if (edge(B.RB) && !this.switchTab(1)) this.activate(list, 0, true);
    if (edge(B.LB)) this.switchTab(-1);
    if (edge(B.B) || edge(B.START) || (edge(B.Y) && this.getGame()?.containers.isOpen())) this.sendEscape();
  }

  candidates() {
    return [...this.uiRoot.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  }

  current(list) {
    if (this.target?.isConnected && list.includes(this.target)) return this.target;
    if (list.includes(document.activeElement)) return document.activeElement;
    return null;
  }

  setTarget(el, list) {
    if (this.target !== el) this.target?.classList.remove('pad-focus');
    this.target = el;
    this.targetIndex = list.indexOf(el);
    el.classList.add('pad-focus');
    if (el.classList.contains('slot')) {
      // a synthetic hover moves the tooltip and the carried stack onto the slot
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    } else {
      el.focus({ preventScroll: true });
    }
    el.scrollIntoView({ block: 'nearest' });
  }

  clearTarget() {
    this.target?.classList.remove('pad-focus');
    this.target = null;
  }

  navigate(dir, list) {
    const cur = this.current(list);
    if (!cur) { this.setTarget(list[0], list); return; }
    const horizontal = dir === 'left' || dir === 'right';
    if (horizontal && cur.matches('input[type=range]')) {
      if (dir === 'left') cur.stepDown(); else cur.stepUp();
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (horizontal && cur.tagName === 'SELECT') {
      const n = cur.options.length;
      cur.selectedIndex = (cur.selectedIndex + (dir === 'left' ? n - 1 : 1)) % n;
      cur.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    // nearest element in the pressed direction, favouring straight lines
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const q = el.getBoundingClientRect();
      const x = q.left + q.width / 2 - cx, y = q.top + q.height / 2 - cy;
      const [main, cross] = dir === 'up' ? [-y, x] : dir === 'down' ? [y, x] : dir === 'left' ? [-x, y] : [x, y];
      if (main <= 2) continue;
      const score = main + Math.abs(cross) * 2.5;
      if (score < bestScore) { best = el; bestScore = score; }
    }
    if (best) this.setTarget(best, list);
  }

  activate(list, button, shift) {
    const el = this.current(list);
    if (!el) { this.setTarget(list[0], list); return; }
    if (el.classList.contains('slot')) {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button, shiftKey: shift,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    } else if (button !== 0) {
      // X/RB only mean something on slots
    } else if (el.classList.contains('world-entry') && el.classList.contains('selected')) {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    } else if (!el.matches('input[type=range], select, input[type=text], input:not([type])')) {
      el.click();
    }
  }

  // LB / RB cycle settings tabs; returns false when there are none
  switchTab(step) {
    const tabs = [...this.uiRoot.querySelectorAll('.tab')];
    if (!tabs.length) return false;
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    tabs[(i + step + tabs.length) % tabs.length].click();
    return true;
  }

  // B / Start behave like Esc on whatever has focus (chat, rebind, menus, game)
  sendEscape() {
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }
}
