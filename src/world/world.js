// World: owns chunks, streams them around the player, schedules light
// initialization and mesh building, and mediates all block access.

import * as THREE from 'three';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, blockIndex } from '../core/constants.js';
import { B, BLOCKS } from '../blocks/blocks.js';
import { Chunk, chunkKey } from './chunk.js';
import { GenPool } from './genPool.js';
import { makeGen, OVERWORLD } from './dimensions.js';
import { initChunkLight, lightBlockChange } from './light.js';
import { buildChunkGeometry } from '../render/mesher.js';
import { createChunkMaterials } from '../render/chunkMaterial.js';

export class World {
  // genVersion: terrain generator version the world was created with (see worldgen.js)
  constructor({ seed, genVersion = 1, dimension = OVERWORLD, atlas, renderDistance = 8, loadChunk = null, onChunkEvicted = null }) {
    this.seed = seed;
    this.atlas = atlas;
    this.renderDistance = renderDistance;
    this.loadChunk = loadChunk;           // async (cx, cz) => {blocks, meta, blockEntities}|null
    this.onChunkEvicted = onChunkEvicted; // (chunk) => void  (save hook)

    this.dimension = dimension;
    this.gen = makeGen(seed, genVersion, dimension);   // main-thread copy for queries (spawn, biome)
    this.pool = new GenPool(seed, genVersion, dimension);
    this.chunks = new Map();
    this.pendingGen = new Set();
    this.lightQueue = [];                 // chunks with blocks, awaiting light
    this.dirtyMeshes = new Set();         // chunk keys needing rebuild
    // Changes the world makes by itself (grass spreading, crops and saplings
    // growing) wait a moment before their chunk is rebuilt, so several in
    // one chunk share a rebuild and they never stack up in one frame: key ->
    // when it was first marked. (Anything the player does is rebuilt at once.)
    this.lazyMeshes = new Map();
    this.deferRemesh = false;
    this.materials = createChunkMaterials(atlas);
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.centerCx = Infinity;
    this.centerCz = Infinity;
    this.stats = { chunks: 0, meshed: 0, genQueue: 0 };
    this.portalChecks = [];               // cells where a portal's frame or sheet changed (Game checks them)
    this.blockChanges = [];               // every change: x, y, z, old, new (falling sand, leaf decay: blockUpdates.js)
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  // ---- world-space accessors ----
  getBlockW(wx, wy, wz) {
    if (wy < 0) return B.BEDROCK;         // below the world: solid
    if (wy >= CHUNK_Y) return B.AIR;
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (!c || !c.hasBlocks) return B.BEDROCK; // unloaded: treat as solid
    return c.blocks[blockIndex(wx & 15, wy, wz & 15)];
  }

  getMetaW(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_Y) return 0;
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (!c || !c.hasBlocks) return 0;
    return c.getMeta(wx & 15, wy, wz & 15);
  }

  isLoaded(wx, wz) {
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    return !!(c && c.hasBlocks);
  }

  getSkyW(wx, wy, wz) {
    if (wy >= CHUNK_Y) return 15;
    if (wy < 0) return 0;
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (!c || !c.hasLight) return 15;
    return c.skyLight[blockIndex(wx & 15, wy, wz & 15)];
  }

  // How bright an unlit (non-voxel) thing at this spot should be drawn, as
  // a linear colour multiplier: the same curve the chunk shader applies
  // (sky light by time of day, block light, a small floor, the brightness
  // setting), so mobs, drops and the hand match the terrain around them.
  lightAt(x, y, z) {
    const wx = Math.floor(x), wy = Math.floor(y), wz = Math.floor(z);
    const u = this.materials.uniforms;
    let br = Math.min(1, Math.max(this.getBlockLightW(wx, wy, wz) / 15, (this.getSkyW(wx, wy, wz) / 15) * u.uDay.value) + 0.04);
    br = Math.pow(br, 1 / (1 + u.uBrightness.value * 1.2));
    return Math.pow(br, 2.2);
  }

  getBlockLightW(wx, wy, wz) {
    if (wy < 0 || wy >= CHUNK_Y) return 0;
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (!c || !c.hasLight) return 0;
    return c.blockLight[blockIndex(wx & 15, wy, wz & 15)];
  }

  // Set a block, updating light and marking meshes dirty. Returns old id, or -1.
  setBlock(wx, wy, wz, id, meta = 0) {
    if (wy < 0 || wy >= CHUNK_Y) return -1;
    const cx = wx >> 4, cz = wz >> 4;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.hasBlocks) return -1;
    const lx = wx & 15, lz = wz & 15;
    const idx = blockIndex(lx, wy, lz);
    const old = c.blocks[idx];
    if (old === id && c.getMeta(lx, wy, lz) === meta) return old;

    c.blocks[idx] = id;
    c.setMeta(lx, wy, lz, meta);
    c.modified = true;
    c.blockEntities.delete(idx);
    if (old === B.EMBER_PORTAL || old === B.CHARRED_STONE) this.portalChecks.push(wx, wy, wz);
    if (this.blockChanges.length < 60000) this.blockChanges.push(wx, wy, wz, old, id);

    const dirty = this.deferRemesh ? this.lazyDirty : this.dirtyMeshes;
    if (c.hasLight) {
      lightBlockChange(this, wx, wy, wz, old, id, dirty);
    }
    dirty.add(chunkKey(cx, cz));
    if (lx === 0) dirty.add(chunkKey(cx - 1, cz));
    if (lx === 15) dirty.add(chunkKey(cx + 1, cz));
    if (lz === 0) dirty.add(chunkKey(cx, cz - 1));
    if (lz === 15) dirty.add(chunkKey(cx, cz + 1));
    return old;
  }

  // the deferred set, as a Set-like the light code can add to
  get lazyDirty() {
    const lazy = this.lazyMeshes;
    return this._lazyAdder ??= { add: (k) => { if (!lazy.has(k)) lazy.set(k, performance.now()); } };
  }

  // run fn with the changes it makes rebuilt lazily
  deferred(fn) {
    const was = this.deferRemesh;
    this.deferRemesh = true;
    try { return fn(); } finally { this.deferRemesh = was; }
  }

  // something in the chunk changed that setBlock didn't see (a container's
  // contents): make sure the next save writes it
  markModified(wx, wz) {
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (c) c.modified = true;
  }

  blockEntityAt(wx, wy, wz) {
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (!c) return null;
    return c.blockEntities.get(blockIndex(wx & 15, wy, wz & 15)) ?? null;
  }

  setBlockEntity(wx, wy, wz, data) {
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (!c) return;
    const idx = blockIndex(wx & 15, wy, wz & 15);
    if (data === null) c.blockEntities.delete(idx);
    else c.blockEntities.set(idx, data);
    c.modified = true;
  }

  // Terrain height by scanning actual blocks (for spawn / mobs).
  surfaceHeight(wx, wz) {
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      const id = this.getBlockW(wx, y, wz);
      if (id !== B.AIR && BLOCKS[id].solid) return y;
    }
    return 0;
  }

  biomeAt(wx, wz) {
    const c = this.chunks.get(chunkKey(wx >> 4, wz >> 4));
    if (c?.biomeMap) return c.biomeMap[(wx & 15) * CHUNK_Z + (wz & 15)];
    return this.gen.biomeAt(wx, wz);
  }

  // ---- streaming ----
  // budgetScale > 1 lets background/hidden ticks do more work per call.
  // (lookX, lookZ): the way the camera faces, to do what's in view first
  update(px, pz, frameStart, budgetScale = 1, lookX = 0, lookZ = 0) {
    // game logic before this call counts against the budgets for at most
    // 4ms, so a slow frame still gets some chunk work done
    frameStart = Math.max(frameStart, performance.now() - 4 * budgetScale);
    const lightBudget = 5 * budgetScale;
    const meshBudget = 9 * budgetScale;
    const pcx = Math.floor(px / CHUNK_X);
    const pcz = Math.floor(pz / CHUNK_Z);
    const R = this.renderDistance;

    if (pcx !== this.centerCx || pcz !== this.centerCz) {
      this.centerCx = pcx;
      this.centerCz = pcz;
      this.requestMissing(pcx, pcz, R + 1, lookX, lookZ);
      this.evictFar(pcx, pcz, R + 3);
      this.pool.prune((cx, cz) => Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) <= R + 1, pcx, pcz);
      this.lastRequestAt = frameStart;
    } else if (frameStart - (this.lastRequestAt ?? 0) > 1000) {
      // now and then, fill any gap left by a chunk that failed to generate
      // (the player can't move while the chunk they stand in is missing)
      this.lastRequestAt = frameStart;
      this.requestMissing(pcx, pcz, R + 1, lookX, lookZ);
    }

    // what to do first: near chunks, and of those the ones in front of you
    // (one behind you counts as a couple of chunks further off)
    const pri = (c) => {
      const dx = c.cx - pcx, dz = c.cz - pcz, d = Math.abs(dx) + Math.abs(dz);
      return d ? d - (dx * lookX + dz * lookZ) / Math.hypot(dx, dz) * 1.5 : -10;
    };

    // light init: budgeted
    let guard = 0;
    // most urgent first (popped off the end)
    if (this.lightQueue.length > 1) this.lightQueue.sort((a, b) => pri(b) - pri(a));
    while (this.lightQueue.length && performance.now() - frameStart < lightBudget && guard++ < 4 * budgetScale) {
      const c = this.lightQueue.pop();
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) continue;   // evicted while it waited
      if (!c.hasBlocks || c.hasLight) continue;
      initChunkLight(this, c, this.dirtyMeshes);
    }

    // the world's own changes, once they've waited (near you briefly, further
    // off a few seconds), join the queue: one a frame
    if (this.lazyMeshes.size) {
      for (const [key, at] of this.lazyMeshes) {
        if (this.dirtyMeshes.has(key)) { this.lazyMeshes.delete(key); continue; }   // (being rebuilt anyway)
        const c = this.chunks.get(key);
        if (!c) { this.lazyMeshes.delete(key); continue; }
        const near = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= 2;
        if (frameStart - at < (near ? 800 : 4000)) continue;
        this.lazyMeshes.delete(key);
        this.dirtyMeshes.add(key);
        break;
      }
    }

    // mesh rebuilds: nearest dirty chunks first, budgeted
    if (this.dirtyMeshes.size) {
      // chunks just outside the view stay queued until they come into range;
      // ones that have been unloaded are dropped
      const list = [];
      for (const key of this.dirtyMeshes) {
        const c = this.chunks.get(key);
        if (!c) { this.dirtyMeshes.delete(key); continue; }
        if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) <= R && c.hasLight && this.neighborsLit(c)) list.push(c);
      }
      list.sort((a, b) => pri(a) - pri(b));
      for (const c of list) {
        this.rebuildMesh(c);
        this.dirtyMeshes.delete(chunkKey(c.cx, c.cz));
        if (performance.now() - frameStart > meshBudget) break;
      }
    }

    this.stats.chunks = this.chunks.size;
    this.stats.genQueue = this.pool.queue.length + this.pendingGen.size;
  }

  neighborsLit(chunk) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (!n || !n.hasLight) return false;
      }
    }
    return true;
  }

  requestMissing(pcx, pcz, radius, lookX = 0, lookZ = 0) {
    const wanted = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key) || this.pendingGen.has(key)) continue;
        // near first, and in front of you before behind
        const d = Math.hypot(dx, dz);
        wanted.push([cx, cz, d ? d - ((dx * lookX + dz * lookZ) / d) * 1.5 : -10]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of wanted) this.requestChunk(cx, cz);
  }

  async requestChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    this.pendingGen.add(key);
    try {
      // Saved data takes precedence over fresh generation.
      let saved = null;
      if (this.loadChunk) saved = await this.loadChunk(cx, cz);

      let blocks, heightMap, biomeMap, generated = null, genMeta = null;
      if (saved) {
        blocks = saved.blocks;
        heightMap = new Uint8Array(CHUNK_X * CHUNK_Z);
        biomeMap = new Uint8Array(CHUNK_X * CHUNK_Z);
        for (let x = 0; x < CHUNK_X; x++) {
          for (let z = 0; z < CHUNK_Z; z++) {
            const wx = cx * CHUNK_X + x, wz = cz * CHUNK_Z + z;
            const col = this.gen.columnAt(wx, wz);
            heightMap[x * CHUNK_Z + z] = Math.floor(col.h);
            biomeMap[x * CHUNK_Z + z] = this.gen.biomeOf(col);
          }
        }
      } else {
        const res = await this.pool.generate(cx, cz);
        if (!res) return;   // pruned: the player moved away
        blocks = res.blocks;
        heightMap = res.heightMap;
        biomeMap = res.biomeMap;
        generated = res.entities;   // e.g. dungeon chests
        genMeta = res.meta;         // (a village's doors and stairs)
      }

      if (!this.pendingGen.has(key)) return; // world disposed meanwhile
      const chunk = new Chunk(cx, cz);
      chunk.setData(blocks, heightMap, biomeMap);
      if (saved?.meta) chunk.meta = saved.meta;
      else if (genMeta) chunk.meta = genMeta;
      for (const [idx, data] of saved?.blockEntities ?? generated ?? []) chunk.blockEntities.set(idx, data);
      // only data that never reached the store (an evicted chunk still waiting
      // for a save) needs writing again; the rest is already on disk
      chunk.modified = !!saved?.dirty;
      this.chunks.set(key, chunk);
      // time passed since it was saved: what was growing there catches up
      if (Number.isFinite(saved?.t)) this.onChunkLoaded?.(chunk, saved.t);
      this.lightQueue.push(chunk);
      // neighbors may now be meshable / need border remesh
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const n = this.getChunk(cx + dx, cz + dz);
          if (n?.mesh || n?.hasLight) this.dirtyMeshes.add(chunkKey(cx + dx, cz + dz));
        }
      }
    } finally {
      this.pendingGen.delete(key);
    }
  }

  evictFar(pcx, pcz, maxDist) {
    for (const [key, c] of this.chunks) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > maxDist) {
        this.onChunkEvicted?.(c);
        this.disposeChunkMesh(c);
        this.chunks.delete(key);
        this.dirtyMeshes.delete(key);
      }
    }
  }

  rebuildMesh(chunk) {
    this.disposeChunkMesh(chunk);
    const { opaqueGeo, waterGeo } = buildChunkGeometry(this, chunk, this.atlas);
    const mesh = { opaque: null, water: null };
    // geometry bounds are local: the mesh itself sits at the chunk origin
    const sphere = new THREE.Sphere(
      new THREE.Vector3(CHUNK_X / 2, CHUNK_Y / 2, CHUNK_Z / 2),
      Math.sqrt(8 * 8 + (CHUNK_Y / 2) * (CHUNK_Y / 2) + 8 * 8) + 1);
    if (opaqueGeo) {
      opaqueGeo.boundingSphere = sphere.clone();
      mesh.opaque = new THREE.Mesh(opaqueGeo, this.materials.opaque);
      mesh.opaque.position.set(chunk.cx * CHUNK_X, 0, chunk.cz * CHUNK_Z);
      mesh.opaque.updateMatrix();
      mesh.opaque.matrixAutoUpdate = false;
      this.group.add(mesh.opaque);
    }
    if (waterGeo) {
      waterGeo.boundingSphere = sphere.clone();
      mesh.water = new THREE.Mesh(waterGeo, this.materials.water);
      mesh.water.position.set(chunk.cx * CHUNK_X, 0, chunk.cz * CHUNK_Z);
      mesh.water.updateMatrix();
      mesh.water.matrixAutoUpdate = false;
      mesh.water.renderOrder = 10;
      this.group.add(mesh.water);
    }
    chunk.mesh = mesh;
    this.stats.meshed++;
  }

  disposeChunkMesh(chunk) {
    if (!chunk.mesh) return;
    for (const m of [chunk.mesh.opaque, chunk.mesh.water]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    chunk.mesh = null;
  }

  // Chunks whose data changed since last save.
  modifiedChunks() {
    const out = [];
    for (const c of this.chunks.values()) if (c.modified) out.push(c);
    return out;
  }

  dispose() {
    for (const c of this.chunks.values()) this.disposeChunkMesh(c);
    this.chunks.clear();
    this.pendingGen.clear();
    this.pool.dispose();
    this.materials.opaque.dispose();
    this.materials.water.dispose();
  }
}
