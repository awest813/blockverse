// Chunk mesher: culled faces, per-vertex ambient occlusion, smooth lighting
// sampled from the voxel light grids, texture-array UVs.

import * as THREE from 'three';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from '../core/constants.js';
import { BLOCKS, R_NONE, R_SOLID, R_CUTOUT, R_BLEND, R_CROSS, R_TORCH, R_SHAPE, faceVisible, isWater, B } from '../blocks/blocks.js';
import { shapeBoxes } from '../blocks/shapes.js';
import { chunkKey } from '../world/chunk.js';
import { FACE_PX, FACE_NX, FACE_PY, FACE_NY, FACE_PZ, FACE_NZ } from './atlas.js';

const OPACITY = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) if (b) OPACITY[b.id] = b.opacity;

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

// texture coords from a point on each face (FACES order), so part-block
// boxes show the matching part of the tile
const FACE_UV = [
  (p) => [1 - p[2], p[1]], (p) => [p[2], p[1]],
  (p) => [p[0], p[2]], (p) => [p[0], p[2]],
  (p) => [p[0], p[1]], (p) => [1 - p[0], p[1]],
];

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.uvw = [];
    this.light = [];
    this.index = [];
    this.vcount = 0;
  }

  quad(px, py, pz, corners, uvs, layer, lights, flip) {
    const vi = this.vcount;
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      this.pos.push(px + c[0], py + c[1], pz + c[2]);
      this.uvw.push(uvs[i][0], uvs[i][1], layer);
      this.light.push(lights[i * 2], lights[i * 2 + 1]);
    }
    if (flip) this.index.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
    else this.index.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    this.vcount += 4;
  }

  build() {
    if (this.vcount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aUvw', new THREE.BufferAttribute(new Float32Array(this.uvw), 3));
    g.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(this.light), 2));
    g.setIndex(new THREE.BufferAttribute(
      this.vcount < 65536 ? new Uint16Array(this.index) : new Uint32Array(this.index), 1));
    return g;
  }
}

// Build geometries for one chunk. `world` provides cross-chunk access.
export function buildChunkGeometry(world, chunk, atlas) {
  const opaque = new GeoBuilder();
  const water = new GeoBuilder();

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
  const idx = (wx, wy, wz) => ((wx & 15) * CHUNK_Z + (wz & 15)) * CHUNK_Y + wy;
  const getBlock = (wx, wy, wz) => {
    if (wy < 0) return B.BEDROCK;
    if (wy >= CHUNK_Y) return B.AIR;
    const c = chunkAt(wx, wz);
    return c && c.hasBlocks ? c.blocks[idx(wx, wy, wz)] : B.BEDROCK;
  };
  const getSky = (wx, wy, wz) => {
    if (wy >= CHUNK_Y) return 15;
    if (wy < 0) return 0;
    const c = chunkAt(wx, wz);
    return c && c.hasLight ? c.skyLight[idx(wx, wy, wz)] : 15;
  };
  const getBlockLight = (wx, wy, wz) => {
    if (wy < 0 || wy >= CHUNK_Y) return 0;
    const c = chunkAt(wx, wz);
    return c && c.hasLight ? c.blockLight[idx(wx, wy, wz)] : 0;
  };
  const aoVals = [0, 0, 0, 0];
  const off = [0, 0, 0];
  const cell = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];   // 4 cells × xyz

  const lights = new Float32Array(8);

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
          for (const q of quads) {
            opaque.quad(x, y, z, q, uv, layer, lights, false);
            const rev = [q[3], q[2], q[1], q[0]];
            const uvRev = [[0, 1], [1, 1], [1, 0], [0, 0]];
            opaque.quad(x, y, z, rev, uvRev, layer, lights, false);
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
              opaque.quad(x, y, z, corners, uvs, atlas.faceLayer(id, f.face), lights, false);
            }
          }
          continue;
        }

        // waterlogged plants render their cell as water from here on
        const rid = info.waterlogged ? B.WATER : id;
        const isFluid = rid === B.WATER || rid === B.LAVA;
        // lava is opaque and glows; water is see-through
        const target = render === R_BLEND && rid !== B.LAVA || info.waterlogged ? water : opaque;
        const orient = chunk.getMeta(x, y, z);
        // a fluid's surface drops when there is no more of it above
        const above = getBlock(wx, y + 1, wz);
        const topY = isFluid && !(rid === B.WATER ? isWater(above) : above === rid) ? 0.875 : 1;

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

          target.quad(x, y, z, corners, f.uvs, layer, lights, flip);
        }
      }
    }
  }

  return { opaqueGeo: opaque.build(), waterGeo: water.build() };
}
