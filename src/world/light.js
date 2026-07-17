// Voxel lighting engine: two channels (sky light, block light), 0..15,
// BFS flood-fill propagation across chunk borders, with incremental
// updates when single blocks change.

import { CHUNK_X, CHUNK_Y, CHUNK_Z, blockIndex, MAX_LIGHT } from '../core/constants.js';
import { BLOCKS } from '../blocks/blocks.js';
import { chunkKey } from './chunk.js';

const OPACITY = new Uint8Array(BLOCKS.length);
const EMIT = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) {
  if (!b) continue;
  OPACITY[b.id] = b.opacity;
  EMIT[b.id] = b.lightEmit;
}

// Neighbor directions: +x,-x,+y,-y,+z,-z
const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const DIR_DOWN = 3;

// Access helper: world-space light/opacity reads and writes with chunk caching.
class Access {
  constructor(world, dirty) {
    this.world = world;
    this.dirty = dirty; // Set of chunk keys needing remesh
    this._cx = Infinity;
    this._cz = Infinity;
    this._chunk = null;
  }

  chunkAt(wx, wz) {
    const cx = wx >> 4, cz = wz >> 4;
    if (cx !== this._cx || cz !== this._cz) {
      this._chunk = this.world.getChunk(cx, cz);
      this._cx = cx; this._cz = cz;
    }
    return this._chunk;
  }

  opacity(wx, wy, wz) {
    if (wy < 0) return 15;
    if (wy >= CHUNK_Y) return 0;
    const c = this.chunkAt(wx, wz);
    if (!c || !c.hasBlocks) return 15; // unloaded: wall off, re-lit on load
    return OPACITY[c.blocks[blockIndex(wx & 15, wy, wz & 15)]];
  }

  light(ch, wx, wy, wz) { // ch: 0 = sky, 1 = block
    if (wy >= CHUNK_Y) return ch === 0 ? 15 : 0;
    if (wy < 0) return 0;
    const c = this.chunkAt(wx, wz);
    if (!c || !c.hasLight) return 0;
    const arr = ch === 0 ? c.skyLight : c.blockLight;
    return arr[blockIndex(wx & 15, wy, wz & 15)];
  }

  setLight(ch, wx, wy, wz, v) {
    const c = this.chunkAt(wx, wz);
    if (!c || !c.hasLight) return;
    const arr = ch === 0 ? c.skyLight : c.blockLight;
    const lx = wx & 15, lz = wz & 15;
    arr[blockIndex(lx, wy, lz)] = v;
    this.dirty.add(chunkKey(c.cx, c.cz));
    // Border cells influence neighbor meshes (AO / smooth lighting).
    if (lx === 0) this.dirty.add(chunkKey(c.cx - 1, c.cz));
    if (lx === 15) this.dirty.add(chunkKey(c.cx + 1, c.cz));
    if (lz === 0) this.dirty.add(chunkKey(c.cx, c.cz - 1));
    if (lz === 15) this.dirty.add(chunkKey(c.cx, c.cz + 1));
  }
}

// Flat queue of (x, y, z) triples.
class Q3 {
  constructor() { this.a = []; this.head = 0; }
  push(x, y, z) { this.a.push(x, y, z); }
  get size() { return (this.a.length - this.head) / 3; }
  empty() { return this.head >= this.a.length; }
  shift(out) {
    out[0] = this.a[this.head++];
    out[1] = this.a[this.head++];
    out[2] = this.a[this.head++];
  }
}

class Q4 {
  constructor() { this.a = []; this.head = 0; }
  push(x, y, z, v) { this.a.push(x, y, z, v); }
  empty() { return this.head >= this.a.length; }
  shift(out) {
    out[0] = this.a[this.head++];
    out[1] = this.a[this.head++];
    out[2] = this.a[this.head++];
    out[3] = this.a[this.head++];
  }
}

// BFS light propagation for one channel.
function propagate(acc, ch, queue) {
  const cur = [0, 0, 0];
  while (!queue.empty()) {
    queue.shift(cur);
    const [x, y, z] = cur;
    const level = acc.light(ch, x, y, z);
    if (level <= 1) continue;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (ny < 0 || ny >= CHUNK_Y) continue;
      const o = acc.opacity(nx, ny, nz);
      if (o >= 15) continue;
      let nl;
      if (ch === 0 && d === DIR_DOWN && level === 15 && o === 0) {
        nl = 15; // full skylight falls straight down
      } else {
        nl = level - Math.max(1, o);
      }
      if (nl > 0 && acc.light(ch, nx, ny, nz) < nl) {
        acc.setLight(ch, nx, ny, nz, nl);
        queue.push(nx, ny, nz);
      }
    }
  }
}

// BFS light removal; cells that had light from other sources get re-queued in `fill`.
function unpropagate(acc, ch, removal, fill) {
  const cur = [0, 0, 0, 0];
  while (!removal.empty()) {
    removal.shift(cur);
    const [x, y, z, level] = cur;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      if (ny < 0 || ny >= CHUNK_Y) continue;
      const nl = acc.light(ch, nx, ny, nz);
      if (nl === 0) continue;
      const skyDown = ch === 0 && d === DIR_DOWN && level === 15;
      if (nl < level || (skyDown && nl === 15)) {
        acc.setLight(ch, nx, ny, nz, 0);
        removal.push(nx, ny, nz, skyDown && nl === 15 ? 15 : nl);
      } else {
        fill.push(nx, ny, nz); // independent source: re-propagate from it
      }
    }
  }
}

// Initialize lighting for a freshly generated chunk and knit it into
// already-lit neighbors.
export function initChunkLight(world, chunk, dirty) {
  const n = CHUNK_X * CHUNK_Y * CHUNK_Z;
  chunk.skyLight = new Uint8Array(n);
  chunk.blockLight = new Uint8Array(n);
  chunk.hasLight = true;

  const acc = new Access(world, dirty);
  const skyQ = new Q3();
  const blockQ = new Q3();
  const baseX = chunk.cx * CHUNK_X;
  const baseZ = chunk.cz * CHUNK_Z;

  // 1) vertical skylight per column
  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      let level = 15;
      for (let y = CHUNK_Y - 1; y >= 0 && level > 0; y--) {
        const idx = blockIndex(x, y, z);
        const o = OPACITY[chunk.blocks[idx]];
        if (o >= 15) level = 0;
        else if (o > 0) level = Math.max(0, level - o);
        if (level > 0) chunk.skyLight[idx] = level;
      }
    }
  }

  // 1b) enqueue frontier cells: lit cells with a darker transparent neighbor
  // inside this chunk (cross-chunk frontiers are handled by seed exchange below).
  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let y = 0; y < CHUNK_Y; y++) {
        const level = chunk.skyLight[blockIndex(x, y, z)];
        if (level <= 1) continue;
        let frontier = false;
        for (let d = 0; d < 6 && !frontier; d++) {
          const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
          if (nx < 0 || nx >= CHUNK_X || nz < 0 || nz >= CHUNK_Z || ny < 0 || ny >= CHUNK_Y) continue;
          const nIdx = blockIndex(nx, ny, nz);
          if (OPACITY[chunk.blocks[nIdx]] < 15 && chunk.skyLight[nIdx] < level - 1) frontier = true;
        }
        if (frontier) skyQ.push(baseX + x, y, baseZ + z);
      }
    }
  }

  // 2) block light emitters
  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let y = 0; y < CHUNK_Y; y++) {
        const idx = blockIndex(x, y, z);
        const e = EMIT[chunk.blocks[idx]];
        if (e > 0) {
          chunk.blockLight[idx] = e;
          blockQ.push(baseX + x, y, baseZ + z);
        }
      }
    }
  }

  // 3) seed exchange with loaded neighbors (both directions)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nb = world.getChunk(chunk.cx + dx, chunk.cz + dz);
    if (!nb || !nb.hasLight) continue;
    for (let i = 0; i < 16; i++) {
      for (let y = 0; y < CHUNK_Y; y++) {
        // neighbor border cell (may push light into us)
        const nwx = dx === 1 ? (chunk.cx + 1) * 16 : dx === -1 ? chunk.cx * 16 - 1 : baseX + i;
        const nwz = dz === 1 ? (chunk.cz + 1) * 16 : dz === -1 ? chunk.cz * 16 - 1 : baseZ + i;
        if (nb.skyLight[blockIndex(nwx & 15, y, nwz & 15)] > 1) skyQ.push(nwx, y, nwz);
        if (nb.blockLight[blockIndex(nwx & 15, y, nwz & 15)] > 1) blockQ.push(nwx, y, nwz);
        // our border cell (may push light into neighbor)
        const owx = dx === 1 ? (chunk.cx + 1) * 16 - 1 : dx === -1 ? chunk.cx * 16 : baseX + i;
        const owz = dz === 1 ? (chunk.cz + 1) * 16 - 1 : dz === -1 ? chunk.cz * 16 : baseZ + i;
        if (chunk.skyLight[blockIndex(owx & 15, y, owz & 15)] > 1) skyQ.push(owx, y, owz);
        if (chunk.blockLight[blockIndex(owx & 15, y, owz & 15)] > 1) blockQ.push(owx, y, owz);
      }
    }
  }

  propagate(acc, 0, skyQ);
  propagate(acc, 1, blockQ);
  dirty.add(chunkKey(chunk.cx, chunk.cz));
}

// Incremental relight after a single block change.
export function lightBlockChange(world, wx, wy, wz, oldId, newId, dirty) {
  const acc = new Access(world, dirty);
  const oldOpacity = OPACITY[oldId], newOpacity = OPACITY[newId];
  const oldEmit = EMIT[oldId], newEmit = EMIT[newId];

  for (let ch = 0; ch < 2; ch++) {
    const removal = new Q4();
    const fill = new Q3();
    const cur = acc.light(ch, wx, wy, wz);

    if (ch === 1 && oldEmit > 0 && newEmit < oldEmit) {
      // removed a light source
      acc.setLight(1, wx, wy, wz, 0);
      removal.push(wx, wy, wz, cur);
    } else if (newOpacity > oldOpacity && cur > 0) {
      // block got more opaque: kill light here, re-fill from neighbors
      acc.setLight(ch, wx, wy, wz, 0);
      removal.push(wx, wy, wz, cur);
    }
    unpropagate(acc, ch, removal, fill);

    if (newOpacity < oldOpacity) {
      // block got more transparent: neighbors' light can flow in
      for (let d = 0; d < 6; d++) {
        const nx = wx + DX[d], ny = wy + DY[d], nz = wz + DZ[d];
        if (acc.light(ch, nx, ny, nz) > 0) fill.push(nx, ny, nz);
      }
    }
    if (ch === 1 && newEmit > 0) {
      acc.setLight(1, wx, wy, wz, Math.max(acc.light(1, wx, wy, wz), newEmit));
      fill.push(wx, wy, wz);
    }
    if (ch === 0 && newOpacity < oldOpacity) {
      // re-open skylight column: if the cell above has full sky, let it fall
      if (acc.light(0, wx, wy + 1, wz) === 15 || wy + 1 >= CHUNK_Y) {
        fill.push(wx, wy + 1, wz);
      }
    }

    // recompute the changed cell itself if it became opaque-but-lit
    if (newOpacity >= 15) acc.setLight(ch, wx, wy, wz, 0);

    propagate(acc, ch, fill);
  }
}

export function lightLevelAt(world, wx, wy, wz) {
  if (wy >= CHUNK_Y) return { sky: 15, block: 0 };
  if (wy < 0) return { sky: 0, block: 0 };
  const c = world.getChunk(wx >> 4, wz >> 4);
  if (!c || !c.hasLight) return { sky: 15, block: 0 };
  const idx = blockIndex(wx & 15, wy, wz & 15);
  return { sky: c.skyLight[idx], block: c.blockLight[idx] };
}
