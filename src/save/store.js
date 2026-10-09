// Persistence: worlds and chunks in IndexedDB, settings in localStorage.

const DB_NAME = 'blockverse';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class SaveStore {
  static async open() {
    const store = new SaveStore();
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('worlds')) {
        db.createObjectStore('worlds', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks'); // key: `${worldId}:${cx},${cz}`
      }
    };
    store.db = await req(r);
    return store;
  }

  tx(name, mode = 'readonly') {
    return this.db.transaction(name, mode).objectStore(name);
  }

  async listWorlds() {
    const all = await req(this.tx('worlds').getAll());
    return all.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  }

  async createWorld({ name, seed, mode, renderDistance, keepInventory = false, difficulty = 2 }) {
    const meta = {
      id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      seed,
      mode,
      renderDistance,
      keepInventory,
      difficulty,
      created: Date.now(),
      lastPlayed: Date.now(),
      timeOfDay: 0.05,
      playerData: null,
      version: 1,
    };
    await req(this.tx('worlds', 'readwrite').put(meta));
    return meta;
  }

  async loadWorld(id) {
    return req(this.tx('worlds').get(id));
  }

  async saveWorldMeta(id, patch) {
    const meta = await this.loadWorld(id);
    if (!meta) return;
    Object.assign(meta, patch, { lastPlayed: Date.now() });
    await req(this.tx('worlds', 'readwrite').put(meta));
  }

  // rename without bumping lastPlayed, so the world list order doesn't change
  async renameWorld(id, name) {
    const meta = await this.loadWorld(id);
    if (!meta) return;
    meta.name = name;
    await req(this.tx('worlds', 'readwrite').put(meta));
  }

  async deleteWorld(id) {
    await req(this.tx('worlds', 'readwrite').delete(id));
    const range = IDBKeyRange.bound(`${id}:`, `${id}:￿`);
    await req(this.tx('chunks', 'readwrite').delete(range));
  }

  chunkKey(worldId, cx, cz) {
    return `${worldId}:${cx},${cz}`;
  }

  async saveChunk(worldId, chunk) {
    const value = {
      blocks: chunk.blocks,
      meta: chunk.meta ?? null,
      blockEntities: [...chunk.blockEntities.entries()],
    };
    await req(this.tx('chunks', 'readwrite').put(value, this.chunkKey(worldId, chunk.cx, chunk.cz)));
  }

  async loadChunk(worldId, cx, cz) {
    const v = await req(this.tx('chunks').get(this.chunkKey(worldId, cx, cz)));
    if (!v) return null;
    return {
      blocks: v.blocks instanceof Uint16Array ? v.blocks : new Uint16Array(v.blocks),
      meta: v.meta ? (v.meta instanceof Uint8Array ? v.meta : new Uint8Array(v.meta)) : null,
      blockEntities: v.blockEntities ?? [],
    };
  }
}

// ---- settings (localStorage) ----

const SETTINGS_KEY = 'blockverse-settings';
export const DEFAULT_SETTINGS = {
  renderDistance: 8,
  fov: 75,
  sensitivity: 1,
  volume: 0.5,
  invertY: false,
  showFps: false,
  guiScale: 0,       // 0 = auto (fit the window), otherwise a multiplier
  keys: {},          // action id -> KeyboardEvent.code overrides (see core/keybinds.js)
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
