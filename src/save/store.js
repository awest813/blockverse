// Persistence: worlds and chunks in IndexedDB, settings in localStorage.

import { LATEST_GEN } from '../world/worldgen.js';
import { CHUNK_VOLUME } from '../core/constants.js';

const CHUNK_SUFFIX = /^-?\d+,-?\d+$/;

const DB_NAME = 'blockverse';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
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
      id: this.newId(),
      name,
      seed,
      mode,
      renderDistance,
      keepInventory,
      difficulty,
      genVersion: LATEST_GEN,
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

  // the entry and its chunks go together (no orphaned chunks on a failure)
  deleteWorld(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('worlds').delete(id);
      tx.objectStore('chunks').delete(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('delete aborted'));
    });
  }

  // every saved chunk of a world, as [key suffix "cx,cz", value]
  async worldChunks(id) {
    const range = IDBKeyRange.bound(`${id}:`, `${id}:\uffff`);
    const store = this.tx('chunks');
    const [keys, values] = await Promise.all([req(store.getAllKeys(range)), req(store.getAll(range))]);
    return keys.map((k, i) => [k.slice(id.length + 1), values[i]]);
  }

  // the world entry and all its chunks in one transaction: all or nothing
  putWorld(meta, chunks) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
      tx.objectStore('worlds').put(meta);
      const store = tx.objectStore('chunks');
      for (const [suffix, v] of chunks) store.put(v, `${meta.id}:${suffix}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('save aborted'));
    });
  }

  // Save a running world: the changed chunks and the world entry together.
  // The chunk arrays are copied when put() is called, so later edits are safe.
  saveWorld(meta, chunks) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
      const store = tx.objectStore('chunks');
      for (const c of chunks) {
        store.put({ blocks: c.blocks, meta: c.meta ?? null, blockEntities: [...c.blockEntities.entries()] },
          this.chunkKey(meta.id, c.cx, c.cz));
      }
      tx.objectStore('worlds').put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('save aborted'));
    });
  }

  // Write a whole world entry we already hold in memory: no read first, so
  // it is queued at once (it can still land while the page is unloading).
  putWorldMeta(meta) {
    return req(this.tx('worlds', 'readwrite').put(meta));
  }

  newId() {
    return `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  async duplicateWorld(id) {
    const meta = await this.loadWorld(id);
    if (!meta) return null;
    const copy = { ...structuredClone(meta), id: this.newId(), name: `${meta.name} (copy)`.slice(0, 32), created: Date.now(), lastPlayed: Date.now() };
    await this.putWorld(copy, await this.worldChunks(id));
    return copy;
  }

  // A whole world as a JSON-safe object (typed arrays as base64).
  async exportWorld(id) {
    const meta = await this.loadWorld(id);
    const chunks = (await this.worldChunks(id)).map(([suffix, v]) => [suffix, {
      blocks: toB64(bytesOf(v.blocks instanceof Uint16Array ? v.blocks : new Uint16Array(v.blocks))),
      meta: v.meta ? toB64(v.meta instanceof Uint8Array ? v.meta : new Uint8Array(v.meta)) : null,
      blockEntities: v.blockEntities ?? [],
    }]);
    return { format: 'blockverse-world', version: 1, meta, chunks };
  }

  async importWorld(data) {
    if (data?.format !== 'blockverse-world' || !data.meta) throw new Error('Not a BlockVerse world file');
    const m = data.meta;
    if (typeof m.name !== 'string' || m.seed === undefined || !Array.isArray(data.chunks)) throw new Error('The world file is damaged or incomplete');
    const meta = { ...data.meta, id: this.newId(), lastPlayed: Date.now() };
    const damaged = () => new Error('The world file is damaged or incomplete');
    const chunks = data.chunks.map((entry) => {
      const [suffix, v] = Array.isArray(entry) ? entry : [];
      if (typeof suffix !== 'string' || !CHUNK_SUFFIX.test(suffix) || typeof v?.blocks !== 'string') throw damaged();
      let blocks, cmeta;
      try {
        blocks = fromB64(v.blocks);
        cmeta = v.meta ? fromB64(v.meta) : null;
      } catch { throw damaged(); }
      if (blocks.length !== CHUNK_VOLUME * 2 || (cmeta && cmeta.length !== CHUNK_VOLUME)) throw damaged();
      return [suffix, {
        blocks: new Uint16Array(blocks.buffer),
        meta: cmeta,
        blockEntities: Array.isArray(v.blockEntities) ? v.blockEntities : [],
      }];
    });
    await this.putWorld(meta, chunks);
    return meta;
  }

  chunkKey(worldId, cx, cz) {
    return `${worldId}:${cx},${cz}`;
  }

  async loadChunk(worldId, cx, cz) {
    let v;
    try {
      v = await req(this.tx('chunks').get(this.chunkKey(worldId, cx, cz)));
    } catch (err) {
      console.warn(`chunk ${cx},${cz}: couldn't read the save`, err);
      return null;
    }
    if (!v) return null;
    const blocks = v.blocks instanceof Uint16Array ? v.blocks : new Uint16Array(v.blocks ?? 0);
    const meta = v.meta ? (v.meta instanceof Uint8Array ? v.meta : new Uint8Array(v.meta)) : null;
    // a damaged chunk is generated afresh rather than crashing the world
    if (blocks.length !== CHUNK_VOLUME || (meta && meta.length !== CHUNK_VOLUME)) {
      console.warn(`chunk ${cx},${cz}: saved data is damaged; regenerating it`);
      return null;
    }
    return { blocks, meta, blockEntities: Array.isArray(v.blockEntities) ? v.blockEntities : [] };
  }
}

// ---- settings (localStorage) ----

const SETTINGS_KEY = 'blockverse-settings';
export const DEFAULT_SETTINGS = {
  renderDistance: 8,
  fov: 75,
  sensitivity: 1,
  volume: 0.5,
  blockVolume: 1,   // per-category mix, multiplied with volume
  mobVolume: 1,
  uiVolume: 1,
  brightness: 0.3,
  viewBobbing: true,
  crosshair: 'plus',   // 'plus' | 'big' | 'dot' | 'off'
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
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode / full: settings last this session */ }
}
