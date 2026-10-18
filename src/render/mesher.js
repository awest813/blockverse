// Chunk mesher: culled faces, per-vertex ambient occlusion, smooth lighting
// sampled from the voxel light grids, texture-array UVs.

import * as THREE from 'three';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from '../core/constants.js';
import { BLOCKS, R_NONE, R_SOLID, R_BLEND, R_CROSS, R_TORCH, R_SHAPE, faceVisible, isWater, B } from '../blocks/blocks.js';
import { shapeBoxes } from '../blocks/shapes.js';
import { chunkKey } from '../world/chunk.js';
import { FACE_PX, FACE_NX, FACE_PY, FACE_NY, FACE_PZ, FACE_NZ } from './atlas.js';

const OPACITY = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) if (b) OPACITY[b.id] = b.opacity;
// full opaque cubes: a face against one is never drawn (see faceVisible)
const SOLID_CUBE = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) if (b && b.render === R_SOLID) SOLID_CUBE[b.id] = 1;

// Face tables. corners are CCW seen from outside; uv matches corner order
// (u runs left to right as seen from outside, so no face is mirrored).
// ao tangent axes: for each face, the two axes spanning the face plane.
const FACES = [
  { face: FACE_PX, dir: [1, 0, 0], shade: 0.6, ta: 1, tb: 2, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uvs: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { face: FACE_NX, dir: [-1, 0, 0], shade: 0.6, ta: 1, tb: 2, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uvs: [[1, 0], [1, 1], [0, 1], [0, 0]] },
  { face: FACE_PY, dir: [0, 1, 0], shade: 1.0, ta: 0, tb: 2, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { face: FACE_NY, dir: [0, -1, 0], shade: 0.5, ta: 0, tb: 2, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { face: FACE_PZ, dir: [0, 0, 1], shade: 0.8, ta: 0, tb: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { face: FACE_NZ, dir: [0, 0, -1], shade: 0.8, ta: 0, tb: 1, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
];

// per face, per corner: the two in-plane offsets (A then B) used for AO and
// smooth light, precomputed so the hot loop allocates nothing
for (const f of FACES) {
  f.offs = f.corners.map((c) => {
    const a = [0, 0, 0], b = [0, 0, 0];
    a[f.ta] = c[f.ta] === 1 ? 1 : -1;
    b[f.tb] = c[f.tb] === 1 ? 1 : -1;
    return [...a, ...b];
  });
}

const AO_LEVELS = [0.45, 0.62, 0.8, 1.0];

// ---- biome colours ----
// Grass, oak leaves and water take a tint from the climate where they grow:
// lush and dark in swamps, sun-bleached toward the deserts, cool and blue-
// green in the cold. (Spruce and birch keep their own colours.) Multipliers
// on the textures' green, near 1 in temperate country.
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function climateTints(t, m) {
  // temperature: cold blue-green -> temperate -> warm yellow-green
  let grass = t < 0.45 ? mix3([0.74, 0.9, 1.0], [1, 1, 1], sstep(0.1, 0.45, t)) : mix3([1, 1, 1], [1.12, 1.05, 0.74], sstep(0.55, 0.9, t));
  // dry and warm: straw yellow; wet (and not frozen): deep swampy olive
  grass = mix3(grass, [1.2, 1.04, 0.55], sstep(0.48, 0.28, m) * sstep(0.5, 0.75, t));
  grass = mix3(grass, [0.6, 0.72, 0.42], sstep(0.58, 0.78, m) * sstep(0.3, 0.45, t));
  const foliage = mix3([1, 1, 1], grass, 0.8);
  // water: murky green in the wet lowlands, steely blue in the cold
  let water = mix3([1, 1, 1], [0.62, 0.82, 0.6], sstep(0.6, 0.8, m) * sstep(0.3, 0.45, t));
  water = mix3(water, [0.86, 0.93, 1.06], sstep(0.4, 0.15, t));
  return [grass, foliage, water];
}
// per chunk, 3 tints (grass, foliage, water) x rgb per column; climate only
// depends on (x, z), so this is worked out once per chunk
function chunkTints(world, chunk) {
  if (chunk.tints) return chunk.tints;
  const out = new Float32Array(CHUNK_X * CHUNK_Z * 9);
  const gen = world.gen;
  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      const c = gen?.climateAt ? gen.climateAt(chunk.cx * CHUNK_X + x, chunk.cz * CHUNK_Z + z) : { t: 0.5, m: 0.5 };
      const k = (x * CHUNK_Z + z) * 9;
      let i = 0;
      for (const rgb of climateTints(c.t, c.m)) for (const v of rgb) out[k + i++] = v;
    }
  }
  chunk.tints = out;
  return out;
}
const TINTED = new Map();   // block id -> which tint (0 grass, 1 foliage, 2 water)
const NO_TINT = new Float32Array(12).fill(1);

// texture coords from a point on each face (FACES order), so part-block
// boxes show the matching part of the tile
const FACE_UV = [
  (p) => [1 - p[2], p[1]], (p) => [p[2], p[1]],
  (p) => [p[0], p[2]], (p) => [p[0], p[2]],
  (p) => [p[0], p[1]], (p) => [1 - p[0], p[1]],
];

// Vertex data in typed arrays that grow as needed and are reused from chunk
// to chunk (meshing is one at a time), so building a mesh makes no garbage
// beyond the arrays it hands to the GPU.
class GeoBuilder {
  constructor() {
    this.cap = 0;
    this.reserve(8192);
    this.vcount = 0;
    this.icount = 0;
  }

  reserve(n) {
    if (n <= this.cap) return;
    let cap = Math.max(this.cap * 2, n);
    const grow = (old, per, T) => { const a = new T(cap * per); if (old) a.set(old); return a; };
    this.pos = grow(this.pos, 3, Float32Array);
    this.uvw = grow(this.uvw, 3, Float32Array);
    this.light = grow(this.light, 2, Float32Array);
    this.tint = grow(this.tint, 3, Uint8Array);
    this.index = grow(this.index, 1.5, Uint32Array);
    this.cap = cap;
  }

  reset() { this.vcount = 0; this.icount = 0; return this; }

  // tints: 4 x rgb per corner (biome colour), or all ones
  quad(px, py, pz, corners, uvs, layer, lights, flip, tints = NO_TINT) {
    const vi = this.vcount;
    if (vi + 4 > this.cap) this.reserve(vi + 4);
    const { pos, uvw, light, tint, index } = this;
    for (let i = 0; i < 4; i++) {
      const c = corners[i], v = vi + i;
      pos[v * 3] = px + c[0]; pos[v * 3 + 1] = py + c[1]; pos[v * 3 + 2] = pz + c[2];
      uvw[v * 3] = uvs[i][0]; uvw[v * 3 + 1] = uvs[i][1]; uvw[v * 3 + 2] = layer;
      light[v * 2] = lights[i * 2]; light[v * 2 + 1] = lights[i * 2 + 1];
      // biome tint, 0..2 in a byte each (most are 1: stored as 128)
      for (let j = 0; j < 3; j++) tint[v * 3 + j] = Math.max(0, Math.min(255, Math.round(tints[i * 3 + j] * 128)));
    }
    let k = this.icount;
    if (flip) { index[k++] = vi + 1; index[k++] = vi + 2; index[k++] = vi + 3; index[k++] = vi + 1; index[k++] = vi + 3; index[k++] = vi; }
    else { index[k++] = vi; index[k++] = vi + 1; index[k++] = vi + 2; index[k++] = vi; index[k++] = vi + 2; index[k++] = vi + 3; }
    this.icount = k;
    this.vcount += 4;
  }

  build() {
    const n = this.vcount;
    if (n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('aUvw', new THREE.BufferAttribute(this.uvw.slice(0, n * 3), 3));
    g.setAttribute('aLight', new THREE.BufferAttribute(this.light.slice(0, n * 2), 2));
    g.setAttribute('aTint', new THREE.BufferAttribute(this.tint.slice(0, n * 3), 3, true));
    const idx = this.index.subarray(0, this.icount);
    g.setIndex(new THREE.BufferAttribute(n < 65536 ? Uint16Array.from(idx) : idx.slice(), 1));
    return g;
  }
}
const opaqueBuilder = new GeoBuilder(), waterBuilder = new GeoBuilder();

// The chunk with a one-block border, y from -1 to CHUNK_Y: blocks, sky
// light and block light (reused between chunks: meshing is one at a time).
// Same rules as the world accessors: unloaded = solid and sky-lit, below
// the world = bedrock and dark, above it = air in full sky.
const PAD_X = CHUNK_X + 2, PAD_Z = CHUNK_Z + 2, PAD_Y = CHUNK_Y + 2;
const padBlocks = new Uint16Array(PAD_X * PAD_Z * PAD_Y);
const padSky = new Uint8Array(PAD_X * PAD_Z * PAD_Y);
const padLight = new Uint8Array(PAD_X * PAD_Z * PAD_Y);
function fillPadded(chunk, chunkAt, baseX, baseZ) {
  for (let px = 0; px < PAD_X; px++) {
    for (let pz = 0; pz < PAD_Z; pz++) {
      const wx = baseX + px - 1, wz = baseZ + pz - 1;
      const c = chunkAt(wx, wz);
      const col = (px * PAD_Z + pz) * PAD_Y;
      padBlocks[col] = B.BEDROCK; padSky[col] = 0; padLight[col] = 0;                    // y = -1
      padBlocks[col + PAD_Y - 1] = B.AIR; padSky[col + PAD_Y - 1] = 15; padLight[col + PAD_Y - 1] = 0;   // y = CHUNK_Y
      const src = ((wx & 15) * CHUNK_Z + (wz & 15)) * CHUNK_Y;
      if (c && c.hasBlocks) padBlocks.set(c.blocks.subarray(src, src + CHUNK_Y), col + 1);
      else padBlocks.fill(B.BEDROCK, col + 1, col + 1 + CHUNK_Y);
      if (c && c.hasLight) { padSky.set(c.skyLight.subarray(src, src + CHUNK_Y), col + 1); padLight.set(c.blockLight.subarray(src, src + CHUNK_Y), col + 1); }
      else { padSky.fill(15, col + 1, col + 1 + CHUNK_Y); padLight.fill(0, col + 1, col + 1 + CHUNK_Y); }
    }
  }
}

// Build geometries for one chunk. `world` provides cross-chunk access.
export function buildChunkGeometry(world, chunk, atlas) {
  const opaque = opaqueBuilder.reset();
  const water = waterBuilder.reset();

  const baseX = chunk.cx * CHUNK_X;
  const baseZ = chunk.cz * CHUNK_Z;

  // Hot path: look the 3×3 neighbourhood of chunks up once and read their
  // arrays directly (same rules as the world accessors: unloaded = solid
  // and sky-lit, above the world = air)
  const near = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) near.push(world.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz)));
  const chunkAt = (wx, wz) => {
    const dx = (wx >> 4) - chunk.cx, dz = (wz >> 4) - chunk.cz;
    if (dx < -1 || dx > 1 || dz < -1 || dz > 1) return world.chunks.get(chunkKey(wx >> 4, wz >> 4));
    return near[(dx + 1) * 3 + dz + 1];
  };
  // Every lookup the faces make stays within a block of the chunk, so copy
  // the chunk and a one-block border of its neighbours (and a layer below
  // and above the world) into flat arrays once, and read those: far cheaper
  // than finding the chunk on every one of the ~60 lookups a face makes
  fillPadded(chunk, chunkAt, baseX, baseZ);
  const PB = padBlocks, PS = padSky, PL = padLight;
  const pidx = (wx, wy, wz) => ((wx - baseX + 1) * PAD_Z + (wz - baseZ + 1)) * PAD_Y + wy + 1;
  const getBlock = (wx, wy, wz) => PB[pidx(wx, wy, wz)];
  const getSky = (wx, wy, wz) => PS[pidx(wx, wy, wz)];
  const getBlockLight = (wx, wy, wz) => PL[pidx(wx, wy, wz)];
  const aoVals = [0, 0, 0, 0];
  const off = [0, 0, 0];
  const cell = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];   // 4 cells × xyz

  const lights = new Float32Array(8);
  if (!TINTED.size) {
    TINTED.set(B.GRASS, 0).set(B.TALL_GRASS, 0).set(B.OAK_LEAVES, 1).set(B.WATER, 2);
  }
  const colTints = chunkTints(world, chunk);
  const tints = new Float32Array(12);
  // fill `tints` for a block in column (x, z); `side` fades a grass block's
  // side from tinted (its grassy lip) to plain (the dirt) down the face
  const tintFor = (which, x, z, corners = null) => {
    const k = (x * CHUNK_Z + z) * 9 + which * 3;
    for (let i = 0; i < 4; i++) {
      const s = corners ? corners[i][1] : 1;   // 1 at the top edge, 0 at the bottom
      for (let j = 0; j < 3; j++) tints[i * 3 + j] = 1 + (colTints[k + j] - 1) * s;
    }
    return tints;
  };

  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let y = 0; y < CHUNK_Y; y++) {
        const id = chunk.blocks[(x * CHUNK_Z + z) * CHUNK_Y + y];
        if (id === B.AIR) continue;
        const info = BLOCKS[id];
        const render = info.render;
        if (render === R_NONE) continue;

        const wx = baseX + x, wz = baseZ + z;

        if (render === R_CROSS || render === R_TORCH) {
          // two crossed quads, double-sided, lit from own cell
          const sky = getSky(wx, y, wz) / 15;
          const bl = getBlockLight(wx, y, wz) / 15;
          for (let i = 0; i < 4; i++) { lights[i * 2] = sky; lights[i * 2 + 1] = bl; }
          const layer = atlas.faceLayer(id, FACE_PX);
          const a = 0.146, b = 0.854;
          const quads = [
            [[a, 0, a], [b, 0, b], [b, 1, b], [a, 1, a]],
            [[a, 0, b], [b, 0, a], [b, 1, a], [a, 1, b]],
          ];
          const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
          const ct = TINTED.has(id) ? tintFor(TINTED.get(id), x, z) : NO_TINT;
          for (const q of quads) {
            opaque.quad(x, y, z, q, uv, layer, lights, false, ct);
            const rev = [q[3], q[2], q[1], q[0]];
            const uvRev = [[0, 1], [1, 1], [1, 0], [0, 0]];
            opaque.quad(x, y, z, rev, uvRev, layer, lights, false, ct);
          }
          // kelp and seagrass stand in water: draw the water around them too
          if (!info.waterlogged) continue;
        }

        if (render === R_SHAPE) {
          // slabs, stairs, doors, fences...: smooth light per corner, from the
          // cell the face looks into and its neighbours along the cell edges
          const ownSky = getSky(wx, y, wz), ownBl = getBlockLight(wx, y, wz);
          const boxes = shapeBoxes(id, chunk.getMeta(x, y, z), (dx, dz) => getBlock(wx + dx, y, wz + dz));
          for (const bx of boxes) {
            for (let fi = 0; fi < 6; fi++) {
              const f = FACES[fi];
              const d = f.dir;
              // faces flush with the cell edge hide against opaque neighbours
              const flush = (d[0] === 1 && bx[3] === 1) || (d[0] === -1 && bx[0] === 0) ||
                (d[1] === 1 && bx[4] === 1) || (d[1] === -1 && bx[1] === 0) ||
                (d[2] === 1 && bx[5] === 1) || (d[2] === -1 && bx[2] === 0);
              if (flush && OPACITY[getBlock(wx + d[0], y + d[1], wz + d[2])] >= 15) continue;
              const corners = f.corners.map((c) => [c[0] ? bx[3] : bx[0], c[1] ? bx[4] : bx[1], c[2] ? bx[5] : bx[2]]);
              const uvs = corners.map(FACE_UV[fi]);
              // a box reaching below its cell (a pot's legs): sample the tile's
              // bottom rows rather than smearing its edge
              if (bx[1] < 0) for (const uv of uvs) if (fi !== 2 && fi !== 3) uv[1] += 1;
              const ox = wx + (flush ? d[0] : 0), oy = y + (flush ? d[1] : 0), oz = wz + (flush ? d[2] : 0);
              for (let i = 0; i < 4; i++) {
                const c = corners[i];
                // neighbours only where the corner sits on the cell's edge
                const ea = c[f.ta] === 0 ? -1 : c[f.ta] === 1 ? 1 : 0;
                const eb = c[f.tb] === 0 ? -1 : c[f.tb] === 1 ? 1 : 0;
                let skyAcc = 0, blAcc = 0, cnt = 0;
                for (let a = 0; a <= (ea ? 1 : 0); a++) {
                  for (let b = 0; b <= (eb ? 1 : 0); b++) {
                    off[0] = off[1] = off[2] = 0;
                    off[f.ta] += a * ea; off[f.tb] += b * eb;
                    const gx = ox + off[0], gy = oy + off[1], gz = oz + off[2];
                    if (OPACITY[getBlock(gx, gy, gz)] >= 15) continue;
                    skyAcc += getSky(gx, gy, gz); blAcc += getBlockLight(gx, gy, gz); cnt++;
                  }
                }
                if (!cnt) { skyAcc = ownSky; blAcc = ownBl; cnt = 1; }
                lights[i * 2] = (skyAcc / cnt / 15) * f.shade;
                lights[i * 2 + 1] = (blAcc / cnt / 15) * f.shade;
              }
              opaque.quad(x, y, z, corners, uvs, bx[6] ? atlas.layer(bx[6]) : atlas.faceLayer(id, f.face), lights, false);
            }
          }
          continue;
        }

        // buried: every neighbour a full opaque cube, so not a face to draw
        // (most of a chunk; one look at six array cells instead of six faces)
        const pi = pidx(wx, y, wz);
        if (SOLID_CUBE[PB[pi + 1]] && SOLID_CUBE[PB[pi - 1]] && SOLID_CUBE[PB[pi + PAD_Y]] && SOLID_CUBE[PB[pi - PAD_Y]]
          && SOLID_CUBE[PB[pi + PAD_Z * PAD_Y]] && SOLID_CUBE[PB[pi - PAD_Z * PAD_Y]]) continue;

        // waterlogged plants render their cell as water from here on
        const rid = info.waterlogged ? B.WATER : id;
        const isFluid = rid === B.WATER || rid === B.LAVA;
        // lava is opaque and glows; water is see-through
        const target = render === R_BLEND && rid !== B.LAVA || info.waterlogged ? water : opaque;
        const orient = chunk.getMeta(x, y, z);
        // a fluid's surface drops when there is no more of it above
        const above = getBlock(wx, y + 1, wz);
        // water under ice fills its cell (no gap below the ice)
        const topY = isFluid && !(rid === B.WATER ? isWater(above) || above === B.ICE : above === rid) ? 0.875 : 1;

        for (const f of FACES) {
          const nx = wx + f.dir[0], ny = y + f.dir[1], nz = wz + f.dir[2];
          const nId = getBlock(nx, ny, nz);
          if (!faceVisible(rid, nId)) continue;

          const layer = atlas.faceLayer(rid, f.face, orient);

          // Per-vertex AO + smooth light
          for (let vi = 0; vi < 4; vi++) {
            const o = f.offs[vi];
            // cells in the plane one step along the normal
            const bx = nx, by = ny, bz = nz;
            const ax = bx + o[0], ay = by + o[1], az = bz + o[2];
            const qx = bx + o[3], qy = by + o[4], qz = bz + o[5];
            const cx = ax + o[3], cy = ay + o[4], cz = az + o[5];

            const s1 = OPACITY[getBlock(ax, ay, az)] >= 15 ? 1 : 0;
            const s2 = OPACITY[getBlock(qx, qy, qz)] >= 15 ? 1 : 0;
            const cr = OPACITY[getBlock(cx, cy, cz)] >= 15 ? 1 : 0;
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            aoVals[vi] = ao;

            // smooth light: average the 4 cells around this vertex
            let skyAcc = 0, blAcc = 0, cnt = 0;
            cell[0] = bx; cell[1] = by; cell[2] = bz;
            cell[3] = ax; cell[4] = ay; cell[5] = az;
            cell[6] = qx; cell[7] = qy; cell[8] = qz;
            cell[9] = cx; cell[10] = cy; cell[11] = cz;
            for (let k = 0; k < 12; k += 3) {
              const gx = cell[k], gy = cell[k + 1], gz = cell[k + 2];
              if (OPACITY[getBlock(gx, gy, gz)] >= 15) continue;
              skyAcc += getSky(gx, gy, gz);
              blAcc += getBlockLight(gx, gy, gz);
              cnt++;
            }
            if (cnt === 0) { skyAcc = getSky(bx, by, bz); blAcc = getBlockLight(bx, by, bz); cnt = 1; }
            const mod = AO_LEVELS[ao] * f.shade;
            lights[vi * 2] = (skyAcc / cnt / 15) * mod;
            lights[vi * 2 + 1] = (blAcc / cnt / 15) * mod;
          }

          // flip quad diagonal to avoid AO anisotropy
          const flip = aoVals[0] + aoVals[2] < aoVals[1] + aoVals[3];

          let corners = f.corners;
          if ((isFluid && topY !== 1) || (id === B.CACTUS)) {
            // clone and shrink: fluid top drop / cactus inset sides
            corners = f.corners.map((c) => [...c]);
            if (isFluid) for (const c of corners) { if (c[1] === 1) c[1] = topY; }
            if (id === B.CACTUS && f.dir[1] === 0) {
              for (const c of corners) {
                if (f.dir[0] === 1) c[0] = 0.9375; else if (f.dir[0] === -1) c[0] = 0.0625;
                if (f.dir[2] === 1) c[2] = 0.9375; else if (f.dir[2] === -1) c[2] = 0.0625;
              }
            }
          }

          // biome colour: grass tops and leaves whole, a grass block's sides
          // fading out down to the dirt, water by the climate
          let ft = NO_TINT;
          const tw = TINTED.get(rid);
          if (tw !== undefined && !(rid === B.GRASS && f.dir[1] === -1)) ft = tintFor(tw, x, z, rid === B.GRASS && f.dir[1] === 0 ? corners : null);
          target.quad(x, y, z, corners, f.uvs, layer, lights, flip, ft);
        }
      }
    }
  }

  return { opaqueGeo: opaque.build(), waterGeo: water.build() };
}
