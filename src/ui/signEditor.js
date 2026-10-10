// Sign text editor: four short lines typed onto a wooden board.
// Block entity: {kind: 'sign', lines: [4 strings], rev}.

import { B } from '../blocks/blocks.js';

export const SIGN_LINES = 4;
export const SIGN_LINE_MAX = 15;

export class SignEditor {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.pos = null;
  }

  isOpen() { return !!this.pos; }

  open(x, y, z) {
    const g = this.game;
    const st = g.world.blockEntityAt(x, y, z);
    const lines = st?.kind === 'sign' ? [...st.lines] : new Array(SIGN_LINES).fill('');
    this.pos = { x, y, z };
    g.setUiOpen(true);
    this.root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'screen dim container-screen';
    const h = document.createElement('h2');
    h.className = 'sign-title';
    h.textContent = 'Edit Sign';
    const board = document.createElement('div');
    board.className = 'sign-board';
    this.inputs = lines.map((text, i) => {
      const input = document.createElement('input');
      input.className = 'sign-line';
      input.maxLength = SIGN_LINE_MAX;
      input.value = text;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', `Line ${i + 1}`);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();   // typing never reaches the game's key bindings
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          if (i < SIGN_LINES - 1 && e.key !== 'Enter') this.inputs[i + 1].focus();
          else if (e.key === 'Enter') { if (i < SIGN_LINES - 1) this.inputs[i + 1].focus(); else this.close(); }
        } else if (e.key === 'ArrowUp' && i > 0) {
          e.preventDefault();
          this.inputs[i - 1].focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
      board.appendChild(input);
      return input;
    });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn small primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());
    screen.append(h, board, done);
    this.root.appendChild(screen);
    this.inputs[0].focus();
  }

  close() {
    if (!this.pos) return;
    const g = this.game;
    const { x, y, z } = this.pos;
    if (g.world.getBlockW(x, y, z) === B.OAK_SIGN) {
      const old = g.world.blockEntityAt(x, y, z);
      g.world.setBlockEntity(x, y, z, { kind: 'sign', lines: this.inputs.map((i) => i.value.slice(0, SIGN_LINE_MAX)), rev: (old?.rev ?? 0) + 1 });
    }
    this.pos = null;
    this.root.innerHTML = '';
    g.setUiOpen(false);
    g.input.requestLock();
  }
}
