// Full-screen UI shell: main menu, world management, loading, pause,
// settings, death screen.

import { hashString } from '../core/rng.js';
import { GAMEMODE_SURVIVAL, GAMEMODE_CREATIVE } from '../core/constants.js';
import { loadSettings, saveSettings } from '../save/store.js';
import { ACTIONS, RESERVED, resolveBindings, keyLabel, findConflicts } from '../core/keybinds.js';
import { PAD_LAYOUT } from '../core/gamepad.js';
import { isFullscreen, setFullscreen, fullscreenSupported, autoGuiScale, isChromeOS } from './display.js';
import { worldOpenElsewhere } from '../save/worldLock.js';

const GUI_SCALES = [0, 0.75, 1, 1.25, 1.5, 2];   // 0 = auto

const DEATH_MESSAGES = {
  fall: 'You hit the ground too hard',
  drown: 'You drowned',
  starve: 'You starved to death',
  zombie: 'You were slain by a Zombie',
  skeleton: 'You were shot by a Skeleton',
  spider: 'You were slain by a Spider',
  explosion: 'You blew up',
  dog: 'You were mauled by a Dog',
  fire: 'You went up in flames',
  lava: 'You tried to swim in lava',
  husk: 'You were slain by a Husk',
  drowned: 'You were slain by a Drowned',
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
    [`Middle click / ${k('pickBlock')}`, 'Pick block'], ['1–9 / wheel', 'Hotbar'],
    [k('inventory'), 'Inventory'], [k('drop'), 'Drop item (Ctrl: stack)'],
    [`${k('chat')} or ${k('command')}`, 'Chat & commands'], [k('hideHud'), 'Hide HUD'],
    [k('debug'), 'Debug info'], [k('screenshot'), 'Screenshot'], ['Esc', 'Pause'],
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

    // search + sort once there's more than a couple of worlds
    this.worldQuery ??= '';
    this.worldSort ??= 'played';
    const SORTS = { played: 'Last played', name: 'Name', created: 'Newest' };
    if (worlds.length <= 2) this.worldQuery = '';   // no search box: never filter by a stale query
    if (worlds.length > 2) {
      const tools = document.createElement('div');
      tools.className = 'world-tools';
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'world-search';
      search.placeholder = 'Search worlds…';
      search.setAttribute('aria-label', 'Search worlds');
      search.value = this.worldQuery;
      search.addEventListener('input', () => { this.worldQuery = search.value; renderList(); });
      search.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); const v = visible(); if (v.length) select(v[0].id, true); } });
      const sort = document.createElement('select');
      sort.className = 'world-sort';
      sort.setAttribute('aria-label', 'Sort worlds');
      for (const [k, label] of Object.entries(SORTS)) {
        const o = document.createElement('option');
        o.value = k; o.textContent = label;
        sort.appendChild(o);
      }
      sort.value = this.worldSort;
      sort.addEventListener('change', () => { this.worldSort = sort.value; renderList(); });
      tools.append(search, sort);
      el.appendChild(tools);
    }

    const list = document.createElement('div');
    list.className = 'world-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Worlds');

    const playBtn = this.btn('Play', () => { if (selected) this.onPlay(selected); });
    // a world being played in another tab would just be saved back
    const busyElsewhere = async (w) => {
      if (!(await worldOpenElsewhere(w.id))) return false;
      this.showConfirm(`"${w.name}" is open in another tab`, 'Close it there first, then try again.', 'OK', () => this.showMain(w.id), () => this.showMain(w.id));
      return true;
    };
    const deleteBtn = this.btn('Delete…', async () => {
      const w = worlds.find((x) => x.id === selected);
      if (w && await busyElsewhere(w)) return;
      if (w) this.showConfirm(`Delete "${w.name}"?`, 'This world will be lost forever. This cannot be undone.', 'Delete', async () => {
        await this.store.deleteWorld(w.id);
        this.showMain();
      }, () => this.showMain(w.id));
    }, 'btn small danger');
    const renameBtn = this.btn('Rename…', async () => {
      const w = worlds.find((x) => x.id === selected);
      if (w && await busyElsewhere(w)) return;
      if (w) this.showRename(w);
    }, 'btn small');
    const dupBtn = this.btn('Duplicate', async () => {
      if (!selected) return;
      dupBtn.disabled = true;
      try {
        const copy = await this.store.duplicateWorld(selected);
        this.showMain(copy?.id ?? selected);
      } catch (err) {
        const id = selected;
        this.showConfirm('Couldn\u2019t duplicate that world', `${err.message ?? err} — the browser may be out of storage space.`, 'OK', () => this.showMain(id), () => this.showMain(id));
      }
    }, 'btn small');
    const exportBtn = this.btn('Export', async () => {
      const w = worlds.find((x) => x.id === selected);
      if (!w) return;
      let data;
      try {
        data = await this.store.exportWorld(w.id);
      } catch (err) {
        this.showConfirm('Couldn\u2019t export that world', String(err.message ?? err), 'OK', () => this.showMain(w.id), () => this.showMain(w.id));
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `${w.name.replace(/[^\w -]+/g, '').trim() || 'world'}.blockverse.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'btn small');
    const importBtn = this.btn('Import…', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const meta = await this.store.importWorld(JSON.parse(await file.text()));
          this.showMain(meta.id);
        } catch (err) {
          this.showConfirm('Couldn’t import that file', String(err.message ?? err), 'OK', () => this.showMain(), () => this.showMain());
        }
      });
      input.click();
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
      for (const b of [playBtn, deleteBtn, renameBtn, dupBtn, exportBtn]) b.disabled = !selected;
    };

    // the worlds matching the search, in the chosen order
    const visible = () => {
      const q = this.worldQuery.trim().toLowerCase();
      const out = worlds.filter((w) => !q || w.name.toLowerCase().includes(q) || String(w.seed).includes(q));
      if (this.worldSort === 'name') out.sort((x, y) => x.name.localeCompare(y.name));
      else if (this.worldSort === 'created') out.sort((x, y) => (y.created ?? 0) - (x.created ?? 0));
      return out;
    };

    const renderList = () => {
      list.innerHTML = '';
      entries.clear();
      const shown = visible();
      if (shown.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'world-empty';
        empty.textContent = worlds.length ? 'No worlds match your search.' : 'No worlds yet — create one to start playing.';
        list.appendChild(empty);
      }
      for (const w of shown) {
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
        // copy the seed (to share a world with a friend)
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'w-copy';
        copy.textContent = 'copy seed';
        copy.tabIndex = -1;
        copy.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          try { await navigator.clipboard.writeText(String(w.seed)); copy.textContent = 'copied!'; } catch { copy.textContent = String(w.seed); }
          setTimeout(() => { copy.textContent = 'copy seed'; }, 1500);
        });
        info.appendChild(copy);
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
      if (!entries.has(selected)) selected = shown[0]?.id ?? null;
      select(selected);
    };
    renderList();
    el.appendChild(list);

    // with no worlds yet, creating one is the only thing to do: make it the big button
    const row = document.createElement('div');
    row.className = 'row';
    const createBtn = this.btn('Create New World', () => this.showCreate(), worlds.length ? 'btn small' : 'btn primary');
    row.appendChild(worlds.length ? playBtn : createBtn);
    el.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'row';
    if (worlds.length) {
      row2.appendChild(createBtn);
      row2.appendChild(renameBtn);
      row2.appendChild(dupBtn);
      row2.appendChild(exportBtn);
      row2.appendChild(deleteBtn);
    }
    row2.appendChild(importBtn);
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return false;   // typing in the search box
      const ids = visible().map((w) => w.id);
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

    const diffSel = document.createElement('select');
    ['Peaceful — no monsters', 'Easy — monsters hit for half', 'Normal', 'Hard — more monsters, harder hits'].forEach((label, v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      diffSel.appendChild(o);
    });
    diffSel.value = '2';
    mkField('Difficulty', diffSel, 'Change it any time with /difficulty.');

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
        difficulty: parseInt(diffSel.value, 10),
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
    const keys = resolveBindings(this.settings.keys);
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const tips = [
      touch ? 'Tip: tap … to open chat, then /help to list commands.'
        : `Tip: press ${keyLabel(keys.chat)} or ${keyLabel(keys.command)} to open chat, then /help to list commands.`,
      'Tip: feed two animals their favourite food and they\'ll have a baby.',
      'Tip: a full swing hits hardest — and a falling blow lands a critical hit.',
      'Tip: dig through the chiseled square in a desert temple\'s floor.',
      touch ? 'Tip: sprint underwater to swim fast wherever you look.'
        : `Tip: sprint (${keyLabel(keys.sprint)}) underwater to swim fast wherever you look.`,
      'Tip: break a dungeon\'s spawner cage to stop the monsters for good.',
      'Tip: pour a bucket of water onto lava to make obsidian.',
      `Tip: ${keyLabel(keys.screenshot)} saves a screenshot.`,
    ];
    tip.textContent = tips[(Math.random() * tips.length) | 0];
    el.appendChild(tip);
    // a slow device shouldn't feel stuck: say so, and offer a way out
    const slow = document.createElement('div');
    slow.className = 'loading-slow hidden';
    slow.textContent = 'Still building the terrain around you — this can take a while on slower devices.';
    el.appendChild(slow);
    if (this.onCancelLoading) el.appendChild(this.btn('Cancel', () => this.onCancelLoading(), 'btn small'));
    this._loadingSlow = setTimeout(() => slow.classList.remove('hidden'), 8000);
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
    this.settingsBack = back;
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

    // a button that steps through a list of [value, label] choices
    const cycle = (label, choices, get, set) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toggle';
      const paint = () => { b.textContent = (choices.find(([v]) => v === get()) ?? choices[0])[1]; };
      paint();
      b.addEventListener('click', () => {
        const i = choices.findIndex(([v]) => v === get());
        set(choices[(i + 1) % choices.length][0]);
        paint();
        this.sfx?.play('click');
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
      // Auto drops the render resolution when frames slow down (integrated
      // graphics, Chromebooks) and brings it back when there's headroom
      cycle('Resolution', [['auto', 'Auto'], [1, 'Full'], [0.75, '75%'], [0.5, '50%']],
        () => s.renderScale ?? 'auto', (v) => { s.renderScale = v; });
      cycle('Frame rate limit', [[0, 'Off'], [60, '60 FPS'], [30, '30 FPS (saves battery)']],
        () => s.maxFps ?? 0, (v) => { s.maxFps = v; });
      const pct = (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`);
      slider('Brightness', 0, 1, 0.05, s.brightness, (v) => (v === 0 ? 'Moody' : v === 1 ? 'Bright' : `${Math.round(v * 100)}%`), (v) => { s.brightness = v; });
      slider('Volume', 0, 1, 0.05, s.volume, pct, (v) => { s.volume = v; });
      slider('· Blocks & world', 0, 1, 0.05, s.blockVolume, pct, (v) => { s.blockVolume = v; });
      slider('· Creatures', 0, 1, 0.05, s.mobVolume, pct, (v) => { s.mobVolume = v; });
      slider('· Player & menus', 0, 1, 0.05, s.uiVolume, pct, (v) => { s.uiVolume = v; });
      const gi = Math.max(0, GUI_SCALES.indexOf(s.guiScale));
      slider('GUI scale', 0, GUI_SCALES.length - 1, 1, gi,
        (i) => (GUI_SCALES[i] ? `${GUI_SCALES[i] * 100}%` : `Auto (${Math.round(autoGuiScale() * 100)}%)`),
        (i) => { s.guiScale = GUI_SCALES[i]; }, false);
      toggle('Show FPS', !!s.showFps, (v) => { s.showFps = v; });
      toggle('View bobbing', s.viewBobbing !== false, (v) => { s.viewBobbing = v; });
      // crosshair: cycle through the styles
      const CROSS = [['plus', 'Plus'], ['big', 'Big plus'], ['dot', 'Dot'], ['off', 'Off']];
      const cb = document.createElement('button');
      cb.type = 'button';
      cb.className = 'toggle';
      const paintCross = () => { cb.textContent = (CROSS.find(([k]) => k === s.crosshair) ?? CROSS[0])[1]; };
      paintCross();
      cb.addEventListener('click', () => {
        const i = CROSS.findIndex(([k]) => k === s.crosshair);
        s.crosshair = CROSS[(i + 1) % CROSS.length][0];
        paintCross();
        this.sfx?.play('click');
        this.applySettings();
      });
      row('Crosshair', cb);
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
    // in-game, Escape is routed through the game's key handler (back to the pause menu)
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
      if (conflicts.has(a.id)) {
        // say what it clashes with, inline (touch has no hover tooltips)
        const others = ACTIONS.filter((o) => o.id !== a.id && bindings[o.id] === bindings[a.id]).map((o) => o.label);
        b.title = `Also bound to: ${others.join(', ')}`;
        const note = document.createElement('span');
        note.className = 'keybind-clash';
        note.textContent = `also ${others.join(', ')}`;
        l.appendChild(note);
      }
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
      + 'Double-tap forward also sprints. Esc, 1–9 and the Search / Windows key are fixed.';
    panel.appendChild(note);
    if (isChromeOS()) {
      const cros = document.createElement('div');
      cros.className = 'field-hint';
      cros.textContent = 'On a Chromebook: hold Search (\u{1F50D}) with a top-row key for F1\u2013F10, or rebind those actions to letter keys. '
        + 'Two-finger click places blocks and two-finger scroll changes the hotbar slot. '
        + 'Ctrl + Space may switch your keyboard layout, so sprint-jumping is easier with double-tap forward.';
      panel.appendChild(cros);
    }

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
    el.appendChild(this.btn('Save & Quit to Title', () => this.onQuitToTitle()));
  }
}
