// Chat log + command console. All user text is rendered with textContent.

import { BLOCKS } from '../blocks/blocks.js';
import { itemInfo, I } from '../items/items.js';
import { GAMEMODE_CREATIVE, GAMEMODE_SURVIVAL } from '../core/constants.js';
import * as MOBS from '../entities/mobs.js';
import * as ANIMALS from '../entities/animals.js';

// /summon names -> classes (every exported mob class with a lower-case name)
const SUMMONABLE = {};
for (const mod of [MOBS, ANIMALS]) {
  for (const [name, Cls] of Object.entries(mod)) {
    if (typeof Cls === 'function' && /^[A-Z]/.test(name) && Cls.prototype?.think && name !== 'PrimedTnt') SUMMONABLE[name.toLowerCase()] = Cls;
  }
}

const HOSTILE_NAMES = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'spider', 'creeper']);

// what Tab can complete, per command argument
const COMMANDS = ['help', 'tp', 'time', 'give', 'summon', 'gamemode', 'difficulty', 'seed', 'spawn', 'kill', 'heal', 'clear', 'rd'];
const ARGS = {
  time: [['set'], ['day', 'noon', 'night', 'midnight']],
  gamemode: [['survival', 'creative']],
  difficulty: [['peaceful', 'easy', 'normal', 'hard']],
};

// name -> id lookup across blocks and items
const NAME_TO_ID = new Map();
for (const b of BLOCKS) if (b && b.id !== 0) NAME_TO_ID.set(b.name, b.id);
for (const id of Object.values(I)) {
  const info = itemInfo(id);
  if (info) NAME_TO_ID.set(info.name, id);
}

export class Chat {
  constructor(game) {
    this.game = game;
    this.logEl = document.getElementById('chat-log');
    this.rowEl = document.getElementById('chat-input-row');
    this.inputEl = document.getElementById('chat-input');
    this.open = false;
    this.history = [];      // previously sent lines, newest last
    this.historyPos = 0;
    this.logEl.innerHTML = '';

    // suggestions under the box, and a Send button for touch screens
    this.suggestEl = document.createElement('div');
    this.suggestEl.className = 'chat-suggest';
    this.rowEl.appendChild(this.suggestEl);
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'chat-send';
    send.textContent = 'Send';
    send.addEventListener('click', () => this.inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
    this.rowEl.appendChild(send);
    this.sendEl = send;
    this.inputEl.addEventListener('input', () => this.suggest(), { signal: game.input.signal });

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault();
        this.complete();
        return;
      }
      if (e.key === 'Enter') {
        const text = this.inputEl.value.trim();
        this.hide();
        if (text) {
          if (this.history[this.history.length - 1] !== text) this.history.push(text);
          if (this.history.length > 50) this.history.shift();
          this.submit(text);
        }
      } else if (e.key === 'Escape') {
        this.hide();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.history.length) return;
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        this.historyPos = Math.max(0, Math.min(this.history.length, this.historyPos + dir));
        this.inputEl.value = this.history[this.historyPos] ?? '';
      }
    }, { signal: game.input.signal });
  }

  dispose() {
    this.open = false;
    this.suggestEl.remove();
    this.sendEl.remove();
    this.rowEl.classList.add('hidden');
    this.logEl.classList.remove('open');
    this.logEl.innerHTML = '';
  }

  show(prefill = '') {
    this.open = true;
    this.historyPos = this.history.length;
    this.rowEl.classList.remove('hidden');
    this.logEl.classList.add('open');   // reveal faded messages while typing
    this.inputEl.value = prefill;
    this.suggest();
    this.game.setUiOpen(true);
    // focus now so fast typing isn't lost; the opening key's default is cancelled by the caller
    this.inputEl.focus();
  }

  hide() {
    this.open = false;
    this.rowEl.classList.add('hidden');
    this.logEl.classList.remove('open');
    this.inputEl.value = '';
    this.inputEl.blur();
    this.game.setUiOpen(false);
    this.game.input.requestLock();
  }

  message(text, color = '#fff', ms = 8000) {
    const el = document.createElement('div');
    el.className = 'msg';
    el.textContent = text;      // textContent: no HTML injection
    el.style.color = color;
    this.logEl.appendChild(el);
    while (this.logEl.children.length > 30) this.logEl.firstChild.remove();
    // fade out of the HUD but stay in the log, visible again while chat is open
    setTimeout(() => el.classList.add('faded'), ms);
  }

  submit(text) {
    if (!text.startsWith('/')) {
      this.message(`<you> ${text}`);
      return;
    }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    try {
      this.run(cmd.toLowerCase(), args);
    } catch (err) {
      this.message(`Error: ${err.message}`, '#ff8080');
    }
  }

  run(cmd, args) {
    const g = this.game;
    const p = g.player;
    switch (cmd) {
      case 'help':
        this.message('/tp <x> <y> <z> — teleport');
        this.message('/time set <day|noon|night|midnight|0..1>');
        this.message('/give <item> [count] — e.g. /give diamond_pickaxe');
        this.message('/gamemode <survival|creative>');
        this.message('/summon <mob> — e.g. /summon dolphin');
        this.message('/seed  /spawn  /kill  /clear  /rd <2-16>  /heal');
        this.message('Tab completes commands, items and mobs', '#aaa');
        this.message('/difficulty <peaceful|easy|normal|hard>');
        break;
      case 'tp': {
        if (args.length < 3) throw new Error('usage: /tp x y z');
        const [x, y, z] = args.map(Number);
        if ([x, y, z].some(Number.isNaN)) throw new Error('coordinates must be numbers');
        p.x = x; p.y = y; p.z = z;
        p.vx = p.vy = p.vz = 0;
        p.fallStart = null;
        this.message(`Teleported to ${x} ${y} ${z}`, '#9fdcff');
        break;
      }
      case 'time': {
        if (args[0] !== 'set' || args.length < 2) throw new Error('usage: /time set <value>');
        const presets = { day: 0.06, noon: 0.25, sunset: 0.5, night: 0.6, midnight: 0.75 };
        const v = presets[args[1]] ?? Number(args[1]);
        if (Number.isNaN(v)) throw new Error('unknown time value');
        g.time = ((v % 1) + 1) % 1;
        this.message(`Time set to ${g.clockTime()}${presets[args[1]] !== undefined ? ` (${args[1]})` : ''}`, '#9fdcff');
        break;
      }
      case 'give': {
        if (!args[0]) throw new Error('usage: /give <item> [count]');
        const id = NAME_TO_ID.get(args[0].toLowerCase());
        if (!id) throw new Error(`unknown item "${args[0]}"`);
        const count = Math.max(1, Math.min(64, parseInt(args[1] ?? '1', 10) || 1));
        const left = p.give(id, count);
        g.hud.renderHotbar();
        this.message(`Gave ${count - left}× ${itemInfo(id).display}`, '#9fdcff');
        break;
      }
      case 'gamemode': {
        const m = args[0]?.[0];
        if (m === 'c' || args[0] === '1') p.mode = GAMEMODE_CREATIVE;
        else if (m === 's' || args[0] === '0') { p.mode = GAMEMODE_SURVIVAL; p.flying = false; }
        else throw new Error('usage: /gamemode <survival|creative>');
        g.hud.renderStats();
        this.message(`Game mode: ${p.mode === GAMEMODE_CREATIVE ? 'creative' : 'survival'}`, '#9fdcff');
        break;
      }
      case 'difficulty': {
        const names = ['peaceful', 'easy', 'normal', 'hard'];
        const n = names.findIndex((d) => d.startsWith((args[0] ?? '').toLowerCase()) && args[0]);
        if (n < 0) throw new Error(`difficulty is ${names[g.difficulty]} — usage: /difficulty <peaceful|easy|normal|hard>`);
        g.setDifficulty(n);
        this.message(`Difficulty: ${names[n]}`, '#9fdcff');
        break;
      }
      case 'seed':
        this.message(`Seed: ${g.worldMeta.seed}`, '#9fdcff');
        break;
      case 'spawn':
        p.x = p.spawnPoint.x; p.y = p.spawnPoint.y; p.z = p.spawnPoint.z;
        p.vx = p.vy = p.vz = 0;
        p.fallStart = null;
        this.message('Returned to spawn', '#9fdcff');
        break;
      case 'kill':
        p.hurtCooldown = 0;
        p.damage(1000, 'command');
        break;
      case 'heal':
        p.health = p.maxHealth;
        p.hunger = 20;
        p.air = 20;
        g.hud.renderStats();
        this.message('Healed', '#9fdcff');
        break;
      case 'clear':
        p.inventory.fill(null);
        p.events.dispatchEvent(new CustomEvent('inventory'));
        this.message('Inventory cleared', '#9fdcff');
        break;
      case 'rd': {
        const n = parseInt(args[0], 10);
        if (!n || n < 2 || n > 16) throw new Error('usage: /rd <2-16>');
        g.world.renderDistance = n;
        g.world.centerCx = Infinity; // force re-stream
        this.message(`Render distance: ${n}`, '#9fdcff');
        break;
      }
      case 'summon': {
        const Cls = SUMMONABLE[(args[0] ?? '').toLowerCase()];
        if (!Cls) throw new Error(`usage: /summon <${Object.keys(SUMMONABLE).slice(0, 6).join('|')}|…>`);
        if (g.difficulty === 0 && HOSTILE_NAMES.has(args[0].toLowerCase())) {
          throw new Error('monsters can\'t be summoned in Peaceful');
        }
        const dir = p.lookDir();
        const mob = g.mobSpawner.spawnMob(Cls, p.x + dir.x * 3, p.y + 0.2, p.z + dir.z * 3);
        this.message(`Summoned a ${args[0].toLowerCase()}`, '#9fdcff');
        break;
      }
      default:
        throw new Error(`unknown command /${cmd} — try /help`);
    }
  }

  // candidates for the word being typed: [prefix before it, the word, options]
  candidates() {
    const text = this.inputEl.value;
    if (!text.startsWith('/')) return null;
    const parts = text.slice(1).split(' ');
    const word = parts[parts.length - 1].toLowerCase();
    const before = text.slice(0, text.length - parts[parts.length - 1].length);
    let options;
    if (parts.length === 1) options = COMMANDS;
    else if (parts[0] === 'give' && parts.length === 2) options = [...NAME_TO_ID.keys()];
    else if (parts[0] === 'summon' && parts.length === 2) options = Object.keys(SUMMONABLE);
    else options = ARGS[parts[0]]?.[parts.length - 2] ?? [];
    return { before, word, matches: options.filter((o) => o.startsWith(word)).sort() };
  }

  suggest() {
    const c = this.candidates();
    const show = c && c.matches.length && !(c.matches.length === 1 && c.matches[0] === c.word);
    this.suggestEl.textContent = show ? c.matches.slice(0, 8).join('   ') + (c.matches.length > 8 ? '   …' : '') : '';
  }

  // Tab: finish the word, or as much as all the matches share; pressing Tab
  // again cycles through the matches one by one
  complete() {
    if (this.cycle && this.inputEl.value === this.cycle.shown) {
      const { before, matches } = this.cycle;
      this.cycle.i = (this.cycle.i + 1) % matches.length;
      this.inputEl.value = this.cycle.shown = before + matches[this.cycle.i];
      return;
    }
    this.cycle = null;
    const c = this.candidates();
    if (!c || !c.matches.length) return;
    if (c.matches.length === 1) {
      this.inputEl.value = c.before + c.matches[0] + ' ';
    } else {
      let common = c.matches[0];
      for (const m of c.matches) while (!m.startsWith(common)) common = common.slice(0, -1);
      if (common.length > c.word.length) this.inputEl.value = c.before + common;
      else this.inputEl.value = (this.cycle = { before: c.before, matches: c.matches, i: 0, shown: c.before + c.matches[0] }).shown;
    }
    this.suggest();
  }
}
