// App orchestrator: main menu <-> game lifecycle.

import { Atlas } from './render/atlas.js';
import { Game } from './game.js';
import { SaveStore, loadSettings } from './save/store.js';
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
window.addEventListener('beforeunload', (e) => {
  if (!game?.running) return;
  game.save();
  e.preventDefault();
  e.returnValue = '';
});
let screens = null;
let store = null;

async function boot() {
  store = await SaveStore.open();
  const initial = loadSettings();
  sfx.setVolume(initial.volume);
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
      applyGuiScale(s.guiScale);
      game?.applySettings(s);
    },
  });

  screens.showMain();
  new GamepadController({ getGame: () => game, uiRoot });
}

async function startWorld(id) {
  if (game) return; // guard against double-clicks starting two worlds
  const meta = await store.loadWorld(id);
  if (!meta || game) return;
  screens.showLoading(`Loading "${meta.name}"…`);

  const settings = screens.settings;
  game = new Game({
    canvas,
    atlas,
    worldMeta: { ...meta, renderDistance: settings.renderDistance },
    store,
    sfx,
  });
  game.applySettings(settings);

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

  // wait for the area around the player to be meshed
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
  });

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

function quitToTitle() {
  if (game) {
    game.stop();
    game = null;
  }
  hudEl.classList.add('hidden');
  screens.showMain();
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
