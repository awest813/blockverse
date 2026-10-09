// DDA voxel raycast (Amanatides & Woo). Returns the first targetable block
// hit within maxDist, with the face normal, or null.

import { BLOCKS, B, R_SHAPE } from '../blocks/blocks.js';
import { worldBoxes } from '../blocks/shapes.js';

export function raycastBlocks(world, origin, dir, maxDist, hitFluids = false) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const fr = (v) => v - Math.floor(v);
  let tMaxX = dir.x !== 0 ? (dir.x > 0 ? (1 - fr(origin.x)) : fr(origin.x)) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? (dir.y > 0 ? (1 - fr(origin.y)) : fr(origin.y)) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? (dir.z > 0 ? (1 - fr(origin.z)) : fr(origin.z)) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  while (t <= maxDist) {
    const id = world.getBlockW(x, y, z);
    const info = BLOCKS[id];
    if (id !== B.AIR && info && (!info.fluid || hitFluids)) {
      if (info.render === R_SHAPE) {
        // part-blocks: hit the actual boxes (or pass through the gaps)
        const hit = rayBoxes(origin, dir, x, y, z, worldBoxes(world, x, y, z, id), maxDist);
        if (hit) return { x, y, z, id, ...hit, point: at(origin, dir, hit.dist) };
      } else {
        return { x, y, z, id, nx, ny, nz, dist: t, point: at(origin, dir, t) };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = 0 - stepZ;
    }
  }
  return null;
}

const at = (o, d, t) => ({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });

// nearest entry into any of the boxes of block (x, y, z): {dist, nx, ny, nz}
function rayBoxes(o, d, x, y, z, boxes, maxDist) {
  let best = null;
  for (const b of boxes) {
    let tmin = 0, tmax = maxDist, n = [0, 0, 0];
    const lo = [x + b[0], y + b[1], z + b[2]], hi = [x + b[3], y + b[4], z + b[5]];
    const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    let ok = true;
    for (let a = 0; a < 3 && ok; a++) {
      if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < lo[a] || oo[a] > hi[a]) ok = false; continue; }
      let t1 = (lo[a] - oo[a]) / dd[a], t2 = (hi[a] - oo[a]) / dd[a];
      let sign = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; sign = 1; }
      if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[a] = sign; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) ok = false;
    }
    if (ok && (!best || tmin < best.dist)) best = { dist: tmin, nx: n[0], ny: n[1], nz: n[2] };
  }
  return best;
}
