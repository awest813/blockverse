// App orchestrator: main menu <-> game lifecycle.

import { Atlas } from './render/atlas.js';
import { Game } from './game.js';
import { SaveStore, loadSettings } from './save/store.js';
import { Screens } from './ui/screens.js';
import { Sfx } from './audio/sfx.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');
const hudEl = document.getElementById('hud');

const atlas = new Atlas();
const sfx = new Sfx();
let game = null;
let screens = null;
let store = null;

async function boot() {
  store = await SaveStore.open();
  sfx.setVolume(loadSettings().volume);

  screens = new Screens(uiRoot, {
    store,
    sfx,
    onPlay: (id) => startWorld(id),
    onQuitToTitle: () => quitToTitle(),
    onRespawn: () => respawn(),
    onResume: () => resumeGame(),
    onApplySettings: (s) => {
      sfx.setVolume(s.volume);
      game?.applySettings(s);
    },
  });

  screens.showMain();
}

async function startWorld(id) {
  const meta = await store.loadWorld(id);
  if (!meta) return;
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
      screens.showPause();
    },
    showDeath: () => {
      game.setUiOpen(true);
      screens.showDeath();
    },
    handleKey: (code) => {
      if (code === 'Escape' && (screens.current === 'pause' || screens.current === 'settings-pause')) {
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
}

function resumeGame() {
  if (!game) return;
  screens.clear();
  game.resume();
}

function respawn() {
  if (!game) return;
  screens.clear();
  game.player.respawn();
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
