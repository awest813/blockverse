// Chunk mesher: culled faces, per-vertex ambient occlusion, smooth lighting
// sampled from the voxel light grids, texture-array UVs.

import * as THREE from 'three';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from '../core/constants.js';
import { BLOCKS, R_NONE, R_SOLID, R_CUTOUT, R_BLEND, R_CROSS, R_TORCH, R_SHAPE, faceVisible, isWater, B } from '../blocks/blocks.js';
import { shapeBoxes } from '../blocks/shapes.js';
import { FACE_PX, FACE_NX, FACE_PY, FACE_NY, FACE_PZ, FACE_NZ } from './atlas.js';

const OPACITY = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) if (b) OPACITY[b.id] = b.opacity;

// Face tables. corners are CCW seen from outside; uv matches corner order.
// ao tangent axes: for each face, the two axes spanning the face plane.
const FACES = [
  { face: FACE_PX, dir: [1, 0, 0], shade: 0.6, ta: 1, tb: 2, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { face: FACE_NX, dir: [-1, 0, 0], shade: 0.6, ta: 1, tb: 2, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uvs: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { face: FACE_PY, dir: [0, 1, 0], shade: 1.0, ta: 0, tb: 2, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { face: FACE_NY, dir: [0, -1, 0], shade: 0.5, ta: 0, tb: 2, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { face: FACE_PZ, dir: [0, 0, 1], shade: 0.8, ta: 0, tb: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { face: FACE_NZ, dir: [0, 0, -1], shade: 0.8, ta: 0, tb: 1, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] },
];

const AO_LEVELS = [0.45, 0.62, 0.8, 1.0];

// texture coords from a point on each face (FACES order), so part-block
// boxes show the matching part of the tile
const FACE_UV = [
  (p) => [p[2], p[1]], (p) => [1 - p[2], p[1]],
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

  // Cached world accessors (hot path: hoist for speed)
  const getBlock = (wx, wy, wz) => world.getBlockW(wx, wy, wz);
  const getSky = (wx, wy, wz) => world.getSkyW(wx, wy, wz);
  const getBlockLight = (wx, wy, wz) => world.getBlockLightW(wx, wy, wz);

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
          // slabs, doors, fences, ladders, lily pads: lit from their own cell
          const sky = getSky(wx, y, wz) / 15;
          const bl = getBlockLight(wx, y, wz) / 15;
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
              for (let i = 0; i < 4; i++) { lights[i * 2] = sky * f.shade; lights[i * 2 + 1] = bl * f.shade; }
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
          let aoSum03 = 0, aoSum12 = 0;
          const aoVals = [0, 0, 0, 0];
          for (let vi = 0; vi < 4; vi++) {
            const c = f.corners[vi];
            const sa = c[f.ta] === 1 ? 1 : -1;
            const sb = c[f.tb] === 1 ? 1 : -1;
            // cells in the plane one step along the normal
            const bx = wx + f.dir[0], by = y + f.dir[1], bz = wz + f.dir[2];
            const offA = [0, 0, 0]; offA[f.ta] = sa;
            const offB = [0, 0, 0]; offB[f.tb] = sb;

            const s1 = OPACITY[getBlock(bx + offA[0], by + offA[1], bz + offA[2])] >= 15 ? 1 : 0;
            const s2 = OPACITY[getBlock(bx + offB[0], by + offB[1], bz + offB[2])] >= 15 ? 1 : 0;
            const cr = OPACITY[getBlock(bx + offA[0] + offB[0], by + offA[1] + offB[1], bz + offA[2] + offB[2])] >= 15 ? 1 : 0;
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            aoVals[vi] = ao;

            // smooth light: average the 4 cells around this vertex
            let skyAcc = 0, blAcc = 0, cnt = 0;
            const cells = [
              [bx, by, bz],
              [bx + offA[0], by + offA[1], bz + offA[2]],
              [bx + offB[0], by + offB[1], bz + offB[2]],
              [bx + offA[0] + offB[0], by + offA[1] + offB[1], bz + offA[2] + offB[2]],
            ];
            for (const [gx, gy, gz] of cells) {
              if (OPACITY[getBlock(gx, gy, gz)] >= 15) continue;
              skyAcc += getSky(gx, gy, gz);
              blAcc += getBlockLight(gx, gy, gz);
              cnt++;
            }
            if (cnt === 0) { skyAcc = getSky(bx, by, bz); blAcc = getBlockLight(bx, by, bz); cnt = 1; }
            const mod = AO_LEVELS[ao] * f.shade;
            lights[vi * 2] = (skyAcc / cnt / 15) * mod;
            lights[vi * 2 + 1] = (blAcc / cnt / 15) * mod;
            if (vi === 0 || vi === 3) aoSum03 += ao; else aoSum12 += ao;
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
