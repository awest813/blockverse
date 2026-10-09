// Full-screen UI shell: main menu, world management, loading, pause,
// settings, death screen.

import { hashString } from '../core/rng.js';
import { GAMEMODE_SURVIVAL, GAMEMODE_CREATIVE } from '../core/constants.js';
import { loadSettings, saveSettings } from '../save/store.js';

const DEATH_MESSAGES = {
  fall: 'You hit the ground too hard',
  drown: 'You drowned',
  starve: 'You starved to death',
  zombie: 'You were slain by a Zombie',
  void: 'You fell out of the world',
  command: 'You were killed by a command',
};

const CONTROLS = [
  ['WASD', 'Move'], ['Mouse', 'Look'],
  ['Left click', 'Mine / attack'], ['Right click', 'Place / use'],
  ['Space', 'Jump (double-tap: fly in creative)'], ['Ctrl / Shift', 'Sprint / sneak'],
  ['1–9 / wheel', 'Hotbar'], ['E', 'Inventory'],
  ['Q', 'Drop item'], ['T or /', 'Chat & commands'],
  ['F3', 'Debug info'], ['Esc', 'Pause'],
];

function timeAgo(ts) {
  if (!ts) return 'never played';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

export class Screens {
  constructor(root, { onPlay, onQuitToTitle, onRespawn, onResume, onApplySettings, store, sfx }) {
    this.root = root;
    this.onPlay = onPlay;
    this.onQuitToTitle = onQuitToTitle;
    this.onRespawn = onRespawn;
    this.onResume = onResume;
    this.onApplySettings = onApplySettings;
    this.store = store;
    this.sfx = sfx;
    this.current = null;
    this.settings = loadSettings();
    this.onKey = null;   // per-screen keyboard handler for menus outside a game

    document.addEventListener('keydown', (e) => {
      if (this.onKey && this.onKey(e)) e.preventDefault();
    });
  }

  clear() {
    this.root.innerHTML = '';
    this.current = null;
    this.onKey = null;
  }

  screen(className = 'screen menu-bg') {
    this.clear();
    const el = document.createElement('div');
    el.className = className;
    this.root.appendChild(el);
    return el;
  }

  btn(label, onClick, cls = 'btn') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => { this.sfx?.play('click'); onClick(); });
    return b;
  }

  heading(el, text) {
    const h = document.createElement('h1');
    h.className = 'title title-sm';
    h.textContent = text;
    el.appendChild(h);
    return h;
  }

  title(el, sub = true) {
    const t = document.createElement('h1');
    t.className = 'title';
    t.textContent = 'BLOCKVERSE';
    el.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'subtitle';
      s.textContent = 'An open-source voxel sandbox!';
      el.appendChild(s);
    }
  }

  // ---------- main menu ----------

  async showMain() {
    const worlds = await this.store.listWorlds();
    const el = this.screen();
    this.current = 'main';
    this.title(el);

    let selected = worlds[0]?.id ?? null;

    const list = document.createElement('div');
    list.className = 'world-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Worlds');
    if (worlds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'world-empty';
      empty.textContent = 'No worlds yet — create one to start playing.';
      list.appendChild(empty);
    }

    const playBtn = this.btn('Play Selected World', () => { if (selected) this.onPlay(selected); });
    const deleteBtn = this.btn('Delete…', () => {
      const w = worlds.find((x) => x.id === selected);
      if (w) this.showConfirm(`Delete "${w.name}"?`, 'This world will be lost forever. This cannot be undone.', 'Delete', async () => {
        await this.store.deleteWorld(w.id);
        this.showMain();
      }, () => this.showMain());
    }, 'btn small danger');

    const entries = new Map();
    const select = (id, focus = false) => {
      selected = id;
      for (const [wid, e] of entries) {
        const on = wid === id;
        e.classList.toggle('selected', on);
        e.setAttribute('aria-selected', String(on));
        e.tabIndex = on ? 0 : -1;
        if (on && focus) { e.focus(); e.scrollIntoView({ block: 'nearest' }); }
      }
      playBtn.disabled = !selected;
      deleteBtn.disabled = !selected;
    };

    for (const w of worlds) {
      const e = document.createElement('div');
      e.className = 'world-entry';
      e.setAttribute('role', 'option');
      const name = document.createElement('div');
      name.className = 'w-name';
      name.textContent = w.name;
      const info = document.createElement('div');
      info.className = 'w-info';
      const mode = w.mode === GAMEMODE_CREATIVE ? 'Creative' : 'Survival';
      info.textContent = `${mode} · seed ${w.seed} · ${timeAgo(w.lastPlayed)}`;
      info.title = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : '';
      const left = document.createElement('div');
      left.appendChild(name);
      left.appendChild(info);
      e.appendChild(left);
      const play = document.createElement('span');
      play.className = 'w-play';
      play.textContent = '▶';
      play.setAttribute('aria-hidden', 'true');
      e.appendChild(play);
      e.addEventListener('click', () => select(w.id));
      e.addEventListener('dblclick', () => this.onPlay(w.id));
      play.addEventListener('click', (ev) => { ev.stopPropagation(); this.onPlay(w.id); });
      entries.set(w.id, e);
      list.appendChild(e);
    }
    el.appendChild(list);

    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(playBtn);
    el.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'row';
    const createBtn = this.btn('Create New World', () => this.showCreate(), worlds.length ? 'btn small' : 'btn small primary');
    row2.appendChild(createBtn);
    row2.appendChild(this.btn('Settings', () => this.showSettings(() => this.showMain()), 'btn small'));
    row2.appendChild(deleteBtn);
    el.appendChild(row2);

    const foot = document.createElement('div');
    foot.className = 'footer';
    foot.textContent = 'BlockVerse — an original open-source voxel game. Not affiliated with Mojang or Microsoft.';
    el.appendChild(foot);

    select(selected);
    if (selected) entries.get(selected).focus();
    else createBtn.focus();

    // arrow keys move the selection, Enter plays, Delete asks to delete
    this.onKey = (e) => {
      if (e.target instanceof HTMLButtonElement && e.key === 'Enter') return false;
      const ids = worlds.map((w) => w.id);
      const i = ids.indexOf(selected);
      if (e.key === 'ArrowDown' && ids.length) { select(ids[Math.min(ids.length - 1, i + 1)], true); return true; }
      if (e.key === 'ArrowUp' && ids.length) { select(ids[Math.max(0, i - 1)], true); return true; }
      if (e.key === 'Enter' && selected) { this.onPlay(selected); return true; }
      if (e.key === 'Delete' && selected) { deleteBtn.click(); return true; }
      return false;
    };
  }

  // ---------- confirm dialog ----------

  showConfirm(titleText, body, okLabel, onOk, onCancel) {
    const el = this.screen();
    this.current = 'confirm';
    this.heading(el, titleText);
    const p = document.createElement('p');
    p.className = 'confirm-body';
    p.textContent = body;
    el.appendChild(p);
    const row = document.createElement('div');
    row.className = 'row';
    const cancel = this.btn('Cancel', onCancel, 'btn small');
    row.appendChild(cancel);
    row.appendChild(this.btn(okLabel, onOk, 'btn small danger solid'));
    el.appendChild(row);
    cancel.focus();
    this.onKey = (e) => {
      if (e.key === 'Escape') { onCancel(); return true; }
      return false;
    };
  }

  // ---------- create world ----------

  showCreate() {
    const el = this.screen();
    this.current = 'create';
    this.heading(el, 'Create New World');

    const form = document.createElement('form');
    form.className = 'form';
    form.noValidate = true;
    el.appendChild(form);

    let fieldId = 0;
    // returns the hint element so callers can update it
    const mkField = (labelText, inputEl, hintText = '') => {
      const f = document.createElement('div');
      f.className = 'field';
      const l = document.createElement('label');
      inputEl.id = `field-${++fieldId}`;
      l.htmlFor = inputEl.id;
      l.textContent = labelText;
      f.appendChild(l);
      f.appendChild(inputEl);
      const h = document.createElement('div');
      h.className = 'field-hint';
      h.textContent = hintText;
      f.appendChild(h);
      form.appendChild(f);
      return h;
    };

    const nameIn = document.createElement('input');
    nameIn.value = 'New World';
    nameIn.maxLength = 32;
    nameIn.autocomplete = 'off';
    mkField('World name', nameIn);

    const seedIn = document.createElement('input');
    seedIn.placeholder = 'Random';
    seedIn.autocomplete = 'off';
    seedIn.spellcheck = false;
    mkField('Seed', seedIn, 'Any text or number. The same seed always makes the same world.');

    const modeSel = document.createElement('select');
    for (const [v, label] of [[GAMEMODE_SURVIVAL, 'Survival'], [GAMEMODE_CREATIVE, 'Creative']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      modeSel.appendChild(o);
    }
    const modeHint = mkField('Game mode', modeSel);
    const updateModeHint = () => {
      modeHint.textContent = parseInt(modeSel.value, 10) === GAMEMODE_CREATIVE
        ? 'Unlimited blocks, flight, no damage.'
        : 'Gather resources, craft tools, survive the night.';
    };
    modeSel.addEventListener('change', updateModeHint);
    updateModeHint();

    const createBtn = this.btn('Create World', () => {}, 'btn primary');
    createBtn.type = 'submit';
    form.appendChild(createBtn);

    let creating = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (creating) return;
      creating = true;
      createBtn.disabled = true;
      const seedText = seedIn.value.trim();
      let seed;
      if (seedText === '') seed = (Math.random() * 0xffffffff) >>> 0;
      else if (/^-?\d+$/.test(seedText)) seed = (parseInt(seedText, 10) >>> 0);
      else seed = hashString(seedText);
      const meta = await this.store.createWorld({
        name: nameIn.value.trim() || 'New World',
        seed,
        mode: parseInt(modeSel.value, 10),
        renderDistance: this.settings.renderDistance,
      });
      this.onPlay(meta.id);
    });

    el.appendChild(this.btn('Back', () => this.showMain(), 'btn small'));
    this.onKey = (e) => {
      if (e.key === 'Escape') { this.showMain(); return true; }
      return false;
    };
    setTimeout(() => { nameIn.focus(); nameIn.select(); }, 0);
  }

  // ---------- loading ----------

  showLoading(text = 'Generating world…') {
    const el = this.screen('screen menu-bg');
    this.current = 'loading';
    this.title(el, false);
    const label = document.createElement('div');
    label.className = 'loading-label';
    label.textContent = text;
    el.appendChild(label);
    const track = document.createElement('div');
    track.className = 'loading-bar-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    track.appendChild(fill);
    el.appendChild(track);
    const tip = document.createElement('div');
    tip.className = 'loading-tip';
    tip.textContent = 'Tip: press T or / to open chat, then /help to list commands.';
    el.appendChild(tip);
    this._loadingTrack = track;
    this._loadingFill = fill;
  }

  setLoadingProgress(frac) {
    if (!this._loadingFill) return;
    const pct = Math.round(frac * 100);
    this._loadingFill.style.width = `${pct}%`;
    this._loadingTrack.setAttribute('aria-valuenow', String(pct));
  }

  // ---------- pause ----------

  showPause() {
    const el = this.screen('screen dim');
    this.current = 'pause';
    this.heading(el, 'Game Paused');
    el.appendChild(this.btn('Back to Game', () => this.onResume()));
    el.appendChild(this.btn('Settings', () => this.showSettings(() => this.showPause())));
    el.appendChild(this.btn('Save & Quit to Title', () => this.onQuitToTitle()));

    const help = document.createElement('dl');
    help.className = 'controls';
    for (const [k, v] of CONTROLS) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      help.appendChild(dt);
      help.appendChild(dd);
    }
    el.appendChild(help);
  }

  // ---------- settings ----------

  showSettings(back) {
    const inGame = this.current === 'pause' || this.current === 'settings-pause';
    const el = this.screen(inGame ? 'screen dim' : 'screen menu-bg');
    this.current = inGame ? 'settings-pause' : 'settings';
    this.heading(el, 'Settings');

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    el.appendChild(panel);

    let n = 0;
    const slider = (label, min, max, step, value, fmt, onChange) => {
      const row = document.createElement('div');
      row.className = 'setting-row';
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `setting-${++n}`;
      input.min = min; input.max = max; input.step = step; input.value = value;
      const l = document.createElement('label');
      l.htmlFor = input.id;
      l.textContent = label;
      const val = document.createElement('output');
      val.className = 'val';
      val.htmlFor = input.id;
      val.textContent = fmt(value);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = fmt(v);
        onChange(v);
        this.applySettings();
      });
      row.appendChild(l); row.appendChild(input); row.appendChild(val);
      panel.appendChild(row);
      return input;
    };

    const s = this.settings;
    const first = slider('Render distance', 2, 16, 1, s.renderDistance, (v) => `${v} chunks`, (v) => { s.renderDistance = v; });
    slider('Field of view', 60, 110, 1, s.fov, (v) => `${v}°`, (v) => { s.fov = v; });
    slider('Mouse sensitivity', 0.2, 2.5, 0.05, s.sensitivity, (v) => `${(+v).toFixed(2)}×`, (v) => { s.sensitivity = v; });
    slider('Volume', 0, 1, 0.05, s.volume, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`), (v) => { s.volume = v; });

    el.appendChild(this.btn('Done', () => back(), 'btn small'));
    if (!inGame) first.focus();
    // in-game, Escape is routed through the game's key handler (resumes play)
    if (!inGame) {
      this.onKey = (e) => {
        if (e.key === 'Escape') { back(); return true; }
        return false;
      };
    }
  }

  applySettings() {
    saveSettings(this.settings);
    this.onApplySettings?.(this.settings);
  }

  // ---------- death ----------

  showDeath(cause) {
    const el = this.screen('screen death');
    this.current = 'death';
    const h = document.createElement('h1');
    h.className = 'death-title';
    h.textContent = 'You died!';
    el.appendChild(h);
    const why = document.createElement('div');
    why.className = 'death-cause';
    why.textContent = DEATH_MESSAGES[cause] ?? 'You were slain';
    el.appendChild(why);
    // no autofocus: a held Space/Enter from gameplay must not trigger Respawn
    el.appendChild(this.btn('Respawn', () => this.onRespawn()));
    el.appendChild(this.btn('Title Screen', () => this.onQuitToTitle()));
  }
}
