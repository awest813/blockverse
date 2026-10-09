// Input manager: keyboard, mouse, pointer lock. UI layers can pause
// game input by pushing "capture" (e.g. inventory open).

import { resolveBindings } from './keybinds.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseButtons = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.captured = false;      // true when a UI layer owns input
    this.pointerLocked = false;
    this.bindings = resolveBindings();   // action id -> KeyboardEvent.code

    this.onKeyDown = null;      // (code, event) => bool handled
    this.onMouseDown = null;    // (button) => void
    this.onMouseUp = null;
    this.onWheel = null;

    // every listener is registered with this signal so dispose() removes them all
    this._abort = new AbortController();
    const opts = { signal: this._abort.signal };

    document.addEventListener('keydown', (e) => {
      if (e.code === 'F1' || e.code === 'F3' || e.code === 'F5') e.preventDefault();
      if (this.onKeyDown && this.onKeyDown(e.code, e)) return;
      if (!this.captured) this.keys.add(e.code);
    }, opts);
    document.addEventListener('keyup', (e) => this.keys.delete(e.code), opts);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); }, opts);

    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked && !this.captured) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    }, opts);

    canvas.addEventListener('mousedown', (e) => {
      if (this.captured) return;
      if (!this.pointerLocked) {
        this.requestLock();
        return;
      }
      this.mouseButtons.add(e.button);
      this.onMouseDown?.(e.button);
    }, opts);
    document.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      this.onMouseUp?.(e.button);
    }, opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    canvas.addEventListener('wheel', (e) => {
      if (this.captured) return;
      this.wheel += Math.sign(e.deltaY);
      this.onWheel?.(Math.sign(e.deltaY));
    }, { passive: true, signal: this._abort.signal });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (!this.pointerLocked) {
        this.keys.clear();
        this.mouseButtons.clear();
        this.onLockLost?.();
      }
      this.onLockChange?.(this.pointerLocked);
    }, opts);
  }

  // AbortSignal for listeners other modules want torn down with this input
  get signal() { return this._abort.signal; }

  dispose() {
    this._abort.abort();
    this.releaseLock();
  }

  requestLock() {
    this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  // Call once per frame after consuming dx/dy.
  endFrame() {
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  down(code) {
    return !this.captured && this.keys.has(code);
  }

  // is the key bound to this action held?
  action(id) {
    return this.down(this.bindings[id]);
  }

  // does this key code trigger the action?
  is(code, id) {
    return this.bindings[id] === code;
  }

  mouseDown(button) {
    return !this.captured && this.mouseButtons.has(button);
  }
}
