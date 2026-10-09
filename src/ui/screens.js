// Full-screen UI shell: main menu, world management, loading, pause,
// settings, death screen.

import { hashString } from '../core/rng.js';
import { GAMEMODE_SURVIVAL, GAMEMODE_CREATIVE } from '../core/constants.js';
import { loadSettings, saveSettings } from '../save/store.js';
import { ACTIONS, RESERVED, resolveBindings, keyLabel, findConflicts } from '../core/keybinds.js';
import { PAD_LAYOUT } from '../core/gamepad.js';
import { isFullscreen, setFullscreen, fullscreenSupported, autoGuiScale } from './display.js';

const GUI_SCALES = [0, 0.75, 1, 1.25, 1.5, 2];   // 0 = auto

const DEATH_MESSAGES = {
  fall: 'You hit the ground too hard',
  drown: 'You drowned',
  starve: 'You starved to death',
  zombie: 'You were slain by a Zombie',
  skeleton: 'You were shot by a Skeleton',
  spider: 'You were slain by a Spider',
  explosion: 'You blew up',
  void: 'You fell out of the world',
  command: 'You were killed by a command',
};

// Pause-screen cheat sheet, labelled with the player's current bindings.
function controlsList(bindings) {
  const k = (id) => keyLabel(bindings[id]);
  return [
    [`${k('forward')} ${k('left')} ${k('back')} ${k('right')}`, 'Move'], ['Mouse', 'Look'],
    ['Left click', 'Mine / attack'], ['Right click', 'Place / use'],
    [k('jump'), 'Jump (double-tap: fly in creative)'], [`${k('sprint')} / ${k('sneak')}`, 'Sprint / sneak'],
    ['Middle click', 'Pick block'], ['1–9 / wheel', 'Hotbar'],
    [k('inventory'), 'Inventory'], [k('drop'), 'Drop item (Ctrl: stack)'],
    [`${k('chat')} or ${k('command')}`, 'Chat & commands'], [k('hideHud'), 'Hide HUD'],
    [k('debug'), 'Debug info'], ['Esc', 'Pause'],
  ];
}

const TOUCH_LAYOUT = [
  ['Left stick', 'Move (push fully: sprint)'], ['Drag', 'Look around'],
  ['Tap', 'Use / place / hit'], ['Touch & hold', 'Mine'],
  ['⤒', 'Jump (double-tap: fly)'], ['Sneak', 'Toggle sneaking'],
  ['▦', 'Inventory'], ['Drop', 'Drop held item'],
  ['Hotbar', 'Tap a slot to select'], ['Inventory', 'Tap: pick up · Hold: split'],
];

function cheatSheet(rows) {
  const dl = document.createElement('dl');
  dl.className = 'controls';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  return dl;
}

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
    this.rebind = null;  // set while a keybind button waits for its new key

    document.addEventListener('keydown', (e) => {
      if (this.onKey && this.onKey(e)) e.preventDefault();
    });
    // capture phase on window runs before the game's document listener, so the
    // key being bound (even Esc or E) never reaches gameplay or menu handlers
    window.addEventListener('keydown', (e) => {
      if (!this.rebind) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.rebind(e);
    }, true);
  }

  clear() {
    this.root.innerHTML = '';
    this.current = null;
    this.onKey = null;
    this.rebind = null;
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

  async showMain(selectId = null) {
    const worlds = await this.store.listWorlds();
    const el = this.screen();
    this.current = 'main';
    this.title(el);

    let selected = (worlds.find((w) => w.id === selectId) ?? worlds[0])?.id ?? null;

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
      }, () => this.showMain(w.id));
    }, 'btn small danger');
    const renameBtn = this.btn('Rename…', () => {
      const w = worlds.find((x) => x.id === selected);
      if (w) this.showRename(w);
    }, 'btn small');

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
      renameBtn.disabled = !selected;
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
    row2.appendChild(renameBtn);
    row2.appendChild(deleteBtn);
    row2.appendChild(this.btn('Settings', () => this.showSettings(() => this.showMain(selected)), 'btn small'));
    el.appendChild(row2);

    const foot = document.createElement('div');
    foot.className = 'footer';
    foot.textContent = 'BlockVerse — an original open-source voxel game. Not affiliated with Mojang or Microsoft.';
    el.appendChild(foot);

    select(selected);
    if (selected) entries.get(selected).focus();
    else createBtn.focus();

    // arrow keys move the selection, Enter plays, F2 renames, Delete asks to delete
    this.onKey = (e) => {
      if (e.target instanceof HTMLButtonElement && e.key === 'Enter') return false;
      const ids = worlds.map((w) => w.id);
      const i = ids.indexOf(selected);
      if (e.key === 'ArrowDown' && ids.length) { select(ids[Math.min(ids.length - 1, i + 1)], true); return true; }
      if (e.key === 'ArrowUp' && ids.length) { select(ids[Math.max(0, i - 1)], true); return true; }
      if (e.key === 'Enter' && selected) { this.onPlay(selected); return true; }
      if (e.key === 'Delete' && selected) { deleteBtn.click(); return true; }
      if (e.key === 'F2' && selected) { renameBtn.click(); return true; }
      return false;
    };
  }

  // ---------- rename world ----------

  showRename(w) {
    const el = this.screen();
    this.current = 'rename';
    this.heading(el, 'Rename World');
    const form = document.createElement('form');
    form.className = 'form';
    const f = document.createElement('div');
    f.className = 'field';
    const input = document.createElement('input');
    input.id = 'rename-input';
    input.value = w.name;
    input.maxLength = 32;
    input.autocomplete = 'off';
    const l = document.createElement('label');
    l.htmlFor = input.id;
    l.textContent = 'World name';
    f.appendChild(l);
    f.appendChild(input);
    form.appendChild(f);
    const save = this.btn('Save', () => {}, 'btn primary');
    save.type = 'submit';
    form.appendChild(save);
    el.appendChild(form);
    el.appendChild(this.btn('Cancel', () => this.showMain(w.id), 'btn small'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name && name !== w.name) await this.store.renameWorld(w.id, name);
      this.showMain(w.id);
    });
    this.onKey = (e) => {
      if (e.key === 'Escape') { this.showMain(w.id); return true; }
      return false;
    };
    input.focus();
    input.select();
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

    const keepSel = document.createElement('select');
    for (const [v, label] of [['0', 'Drop items on death'], ['1', 'Keep inventory on death']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      keepSel.appendChild(o);
    }
    mkField('When you die', keepSel, 'Dropped items can be picked up again for 5 minutes.');

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
        keepInventory: keepSel.value === '1',
      });
      this.onPlay(meta.id);
    });

    el.appendChild(this.btn('Back', () => this.showMain(), 'btn small'));
    this.onKey = (e) => {
      if (e.key === 'Escape') { this.showMain(); return true; }
      return false;
    };
    nameIn.focus();
    nameIn.select();
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

  // altInput: 'gamepad' | 'touch' | null — picks which cheat sheet to show
  showPause(altInput = null, subtitle = '') {
    const el = this.screen('screen dim');
    this.current = 'pause';
    this.heading(el, 'Game Paused');
    if (subtitle) {
      const sub = document.createElement('div');
      sub.className = 'pause-sub';
      sub.textContent = subtitle;
      el.appendChild(sub);
    }
    el.appendChild(this.btn('Back to Game', () => this.onResume()));
    el.appendChild(this.btn('Settings', () => this.showSettings(() => this.showPause(altInput, subtitle))));
    el.appendChild(this.btn('Save & Quit to Title', () => this.onQuitToTitle()));

    const rows = altInput === 'gamepad' ? PAD_LAYOUT
      : altInput === 'touch' ? TOUCH_LAYOUT
        : controlsList(resolveBindings(this.settings.keys));
    const help = cheatSheet(rows);
    el.appendChild(help);
  }

  // ---------- settings ----------

  // focus: CSS selector of the element to focus after (re)rendering
  showSettings(back, tab = 'general', focus = null) {
    const inGame = this.current === 'pause' || this.current === 'settings-pause';
    const el = this.screen(inGame ? 'screen dim' : 'screen menu-bg');
    this.current = inGame ? 'settings-pause' : 'settings';
    this.heading(el, 'Settings');

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [['general', 'Video & Sound'], ['controls', 'Controls']]) {
      const t = this.btn(label, () => { if (id !== tab) this.showSettings(back, id, '.tab[aria-selected="true"]'); }, 'tab');
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(id === tab));
      tabs.appendChild(t);
    }
    el.appendChild(tabs);

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.setAttribute('role', 'tabpanel');
    el.appendChild(panel);

    let n = 0;
    const row = (label, control, extra = null) => {
      const r = document.createElement('div');
      r.className = 'setting-row';
      control.id = `setting-${++n}`;
      const l = document.createElement('label');
      l.htmlFor = control.id;
      l.textContent = label;
      r.appendChild(l);
      r.appendChild(control);
      if (extra) r.appendChild(extra);
      panel.appendChild(r);
      return r;
    };
    // live=false applies only on release (for settings that move the slider itself)
    const slider = (label, min, max, step, value, fmt, onChange, live = true) => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step; input.value = value;
      const val = document.createElement('output');
      val.className = 'val';
      val.textContent = fmt(value);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = fmt(v);
        if (live) { onChange(v); this.applySettings(); }
      });
      if (!live) {
        input.addEventListener('change', () => { onChange(parseFloat(input.value)); this.applySettings(); });
      }
      row(label, input, val);
      val.htmlFor = input.id;
      return input;
    };
    const toggle = (label, value, onChange) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toggle';
      const paint = (v) => { b.textContent = v ? 'On' : 'Off'; b.setAttribute('aria-pressed', String(v)); };
      paint(value);
      b.addEventListener('click', async () => {
        value = !value;
        this.sfx?.play('click');
        // onChange may return the real resulting state (e.g. fullscreen refused)
        const result = await onChange(value);
        if (typeof result === 'boolean') value = result;
        paint(value);
        this.applySettings();
      });
      row(label, b);
      return b;
    };

    const s = this.settings;
    let first;
    if (tab === 'general') {
      first = slider('Render distance', 2, 16, 1, s.renderDistance, (v) => `${v} chunks`, (v) => { s.renderDistance = v; });
      slider('Field of view', 60, 110, 1, s.fov, (v) => `${v}°`, (v) => { s.fov = v; });
      slider('Volume', 0, 1, 0.05, s.volume, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`), (v) => { s.volume = v; });
      const gi = Math.max(0, GUI_SCALES.indexOf(s.guiScale));
      slider('GUI scale', 0, GUI_SCALES.length - 1, 1, gi,
        (i) => (GUI_SCALES[i] ? `${GUI_SCALES[i] * 100}%` : `Auto (${Math.round(autoGuiScale() * 100)}%)`),
        (i) => { s.guiScale = GUI_SCALES[i]; }, false);
      toggle('Show FPS', !!s.showFps, (v) => { s.showFps = v; });
      if (fullscreenSupported()) toggle('Fullscreen', isFullscreen(), (v) => setFullscreen(v));
    } else {
      first = slider('Mouse sensitivity', 0.2, 2.5, 0.05, s.sensitivity, (v) => `${(+v).toFixed(2)}×`, (v) => { s.sensitivity = v; });
      toggle('Invert mouse Y', !!s.invertY, (v) => { s.invertY = v; });
      this.renderKeybinds(panel, back);
    }

    const footer = document.createElement('div');
    footer.className = 'row';
    if (tab === 'controls') {
      footer.appendChild(this.btn('Reset Keys', () => {
        s.keys = {};
        this.applySettings();
        this.showSettings(back, 'controls');
      }, 'btn small'));
    }
    footer.appendChild(this.btn('Done', () => back(), 'btn small primary'));
    el.appendChild(footer);

    // keep focus where the player was (tab strip, the key just rebound) for keyboard / gamepad
    ((focus && el.querySelector(focus)) || first).focus();
    // in-game, Escape is routed through the game's key handler (resumes play)
    if (!inGame) {
      this.onKey = (e) => {
        if (e.key === 'Escape') { back(); return true; }
        return false;
      };
    }
  }

  renderKeybinds(panel, back) {
    const s = this.settings;
    const bindings = resolveBindings(s.keys);
    const conflicts = findConflicts(bindings);
    let group = null;
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        const h = document.createElement('div');
        h.className = 'setting-group';
        h.textContent = group;
        panel.appendChild(h);
      }
      const r = document.createElement('div');
      r.className = 'setting-row';
      const l = document.createElement('span');
      l.className = 'setting-label';
      l.textContent = a.label;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'keybind';
      b.textContent = keyLabel(bindings[a.id]);
      b.classList.toggle('conflict', conflicts.has(a.id));
      b.classList.toggle('changed', bindings[a.id] !== a.def);
      b.setAttribute('aria-label', `${a.label}: ${keyLabel(bindings[a.id])}. Press to change.`);
      if (conflicts.has(a.id)) b.title = 'This key is also bound to another action';
      b.addEventListener('click', () => {
        this.sfx?.play('click');
        panel.querySelectorAll('.keybind.listening').forEach((x) => {
          x.classList.remove('listening');
          x.textContent = keyLabel(bindings[x.dataset.action]);
        });
        b.classList.add('listening');
        b.textContent = 'Press a key…';
        this.rebind = (e) => {
          this.rebind = null;
          if (e.code !== 'Escape' && !RESERVED.has(e.code)) {
            if (e.code === a.def) delete s.keys[a.id];
            else s.keys = { ...s.keys, [a.id]: e.code };
            this.applySettings();
          }
          this.showSettings(back, 'controls', `.keybind[data-action="${a.id}"]`);
        };
      });
      b.dataset.action = a.id;
      r.appendChild(l);
      r.appendChild(b);
      panel.appendChild(r);
    }
    const note = document.createElement('div');
    note.className = 'field-hint';
    note.textContent = 'Click a key to change it, then press the new key (Esc cancels). '
      + 'Double-tap forward also sprints. Esc and 1–9 are fixed.';
    panel.appendChild(note);

    const pad = document.createElement('div');
    pad.className = 'setting-group';
    pad.textContent = 'Controller';
    panel.appendChild(pad);
    const sheet = cheatSheet(PAD_LAYOUT);
    sheet.classList.add('controls-inline');
    panel.appendChild(sheet);
  }

  applySettings() {
    saveSettings(this.settings);
    this.onApplySettings?.(this.settings);
  }

  // ---------- death ----------

  // dropped: where the inventory was scattered ({x, y, z}) or null if kept
  showDeath(cause, dropped = null) {
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
    if (dropped) {
      const items = document.createElement('div');
      items.className = 'death-items';
      items.textContent = `Your items were dropped at ${dropped.x}, ${dropped.y}, ${dropped.z} — get back within 5 minutes to recover them.`;
      el.appendChild(items);
    }
    // no autofocus: a held Space/Enter from gameplay must not trigger Respawn
    el.appendChild(this.btn('Respawn', () => this.onRespawn()));
    el.appendChild(this.btn('Title Screen', () => this.onQuitToTitle()));
  }
}
