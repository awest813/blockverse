// App orchestrator: main menu <-> game lifecycle.

import { Atlas } from './render/atlas.js';
import { Game } from './game.js';
import { SaveStore, loadSettings } from './save/store.js';
import { acquireWorldLock } from './save/worldLock.js';
import { Screens } from './ui/screens.js';
import { Sfx } from './audio/sfx.js';
import { applyGuiScale } from './ui/display.js';
import { GamepadController } from './core/gamepad.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');
const hudEl = document.getElementById('hud');

const atlas = new Atlas();
const sfx = new Sfx();
let game = null;

// Ctrl is the sprint key, so Ctrl+W can close the tab mid-game outside
// fullscreen: save at once and let the browser ask "Leave site?"
// a closing tab, a phone app switch: save while the page is still alive
// (the write may not finish after unload, so the 10 s autosave matters too)
window.addEventListener('pagehide', () => { if (game?.running) game.save(); });
window.addEventListener('beforeunload', (e) => {
  if (!game?.running) return;
  game.save();
  e.preventDefault();
  e.returnValue = '';
});
let screens = null;
let store = null;
let releaseWorld = null;   // the open world's tab lock

async function boot() {
  store = await SaveStore.open();
  const initial = loadSettings();
  sfx.setVolume(initial.volume);
  sfx.setMix(initial);
  applyGuiScale(initial.guiScale);

  screens = new Screens(uiRoot, {
    store,
    sfx,
    onPlay: (id) => startWorld(id),
    onQuitToTitle: () => quitToTitle(),
    onRespawn: () => respawn(),
    onResume: () => resumeGame(),
    onApplySettings: (s) => {
      sfx.setVolume(s.volume);
      sfx.setMix(s);
      applyGuiScale(s.guiScale);
      game?.applySettings(s);
    },
  });

  screens.showMain();
  new GamepadController({ getGame: () => game, uiRoot });
}

let starting = false;
async function startWorld(id) {
  if (game || starting) return; // guard against double-clicks starting two worlds
  starting = true;
  try { await openWorld(id); } finally { starting = false; }
}

async function openWorld(id) {
  const release = await acquireWorldLock(id);
  if (!release) {
    screens.showConfirm('That world is already open', 'It\u2019s being played in another tab or window. Close it there first \u2014 two copies would save over each other.', 'OK', () => screens.showMain(id), () => screens.showMain(id));
    return;
  }
  let meta;
  try { meta = await store.loadWorld(id); } catch { meta = null; }
  if (!meta || game) {
    release();
    if (!meta) screens.showConfirm('Couldn\u2019t open that world', 'Its save couldn\u2019t be read.', 'OK', () => screens.showMain(), () => screens.showMain());
    return;
  }
  releaseWorld = release;
  // ask the browser to keep our saves even when space runs low
  navigator.storage?.persist?.().catch(() => {});
  screens.onCancelLoading = () => { screens._cancelEarly = true; };
  screens.showLoading(`Loading "${meta.name}"…`);

  const settings = screens.settings;
  try {
    game = new Game({
      canvas,
      atlas,
      worldMeta: meta,   // applySettings() below sets the render distance from settings
      store,
      sfx,
    });
    game.applySettings(settings);
  } catch (err) {
    // a broken save or a missing browser feature: don't leave the loading
    // screen up, and let the world be opened again
    console.error(err);
    try { game?.stop({ save: false }); } catch { /* half-built */ }
    game = null;
    releaseWorld?.(); releaseWorld = null;
    screens.onCancelLoading = null;
    clearTimeout(screens._loadingSlow);
    screens.showConfirm('Couldn\u2019t open that world', String(err?.message ?? err), 'OK', () => screens.showMain(id), () => screens.showMain(id));
    return;
  }

  game.uiHooks = {
    showPause: () => {
      if (game.paused || game.player.dead || game.chat.open) return;
      game.pause();
      const level = ['Peaceful', 'Easy', 'Normal', 'Hard'][game.difficulty];
      screens.showPause(game.input.altInput, `Day ${game.day} · ${game.clockTime()} · ${level}`);
    },
    showDeath: (cause, dropped) => {
      game.setUiOpen(true);
      screens.showDeath(cause, dropped);
    },
    handleKey: (code) => {
      if (code === 'Escape' && screens.current === 'settings-pause') {
        screens.settingsBack?.();   // settings -> pause menu, like the Done button
        return true;
      }
      if (code === 'Escape' && screens.current === 'pause') {
        resumeGame();
        return true;
      }
      return false;
    },
  };

  game.setUiOpen(true); // block input until loaded
  game.start();

  // wait for the area around the player to be meshed (or for Cancel)
  let cancelled = false;
  await new Promise((resolve) => {
    const t0 = performance.now();
    const poll = setInterval(() => {
      const pcx = Math.floor(game.player.x / 16);
      const pcz = Math.floor(game.player.z / 16);
      let meshed = 0;
      const R = 2, total = (2 * R + 1) ** 2;
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          const c = game.world.getChunk(pcx + dx, pcz + dz);
          if (c?.mesh) meshed++;
        }
      }
      screens.setLoadingProgress(meshed / total);
      if (meshed >= total || performance.now() - t0 > 25000) {
        clearInterval(poll);
        resolve();
      }
    }, 200);
    screens.onCancelLoading = () => { cancelled = true; clearInterval(poll); resolve(); };
    if (screens._cancelEarly) { screens._cancelEarly = false; screens.onCancelLoading(); }
  });

  screens.onCancelLoading = null;
  clearTimeout(screens._loadingSlow);
  if (cancelled) { quitToTitle({ save: false }); return; }   // nothing was played: leave the save untouched
  screens.clear();
  game.setUiOpen(false);
  game.updateDebug();
  if (!meta.playerData) game.showWelcomeTips();
}

function resumeGame() {
  if (!game) return;
  screens.clear();
  game.resume();
}

function respawn() {
  if (!game) return;
  screens.clear();
  game.respawnPlayer();
  game.hud.renderStats();
  game.hud.renderHotbar();
  game.setUiOpen(false);
  game.input.requestLock();
}

async function quitToTitle({ save = true } = {}) {
  const g = game;
  game = null;
  hudEl.classList.add('hidden');
  if (g) {
    // wait for the save to land before the world list (and the tab lock) move on
    const saving = g.stop({ save });
    if (saving) screens.showLoading('Saving world\u2026');
    const ok = saving ? await saving : true;   // save() resolves false when the write failed
    if (!ok) {
      releaseWorld?.(); releaseWorld = null;
      const err = g.lastSaveError;
      screens.showConfirm('Couldn\u2019t save the world', `${err?.message ?? err ?? 'The write failed'} \u2014 the browser may be out of storage space. Changes since the last save are lost.`, 'OK', () => screens.showMain(g.worldMeta.id), () => screens.showMain(g.worldMeta.id));
      return;
    }
  }
  releaseWorld?.(); releaseWorld = null;
  screens.showMain(g?.worldMeta.id);
}

boot();

// ---- dev/verification helpers (harmless in production) ----
window.__app = { get game() { return game; }, atlas, sfx };
Object.defineProperty(window, '__game', { get: () => game, configurable: true });
Object.defineProperty(window, '__world', { get: () => game?.world, configurable: true });

window.__snap = (name = 'snap', w = 640) => {
  if (!game) return Promise.resolve('no game');
  game.renderer.render(game.scene, game.camera);
  const c = document.createElement('canvas');
  const h = Math.round(w * canvas.height / canvas.width);
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, 0, 0, w, h);
  return fetch(`/__snap?name=${name}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.85) })
    .then((r) => r.text()).catch(() => 'no endpoint');
};
