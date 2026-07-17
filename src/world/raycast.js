// DDA voxel raycast (Amanatides & Woo). Returns the first targetable block
// hit within maxDist, with the face normal, or null.

import { BLOCKS, B } from '../blocks/blocks.js';

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
      return { x, y, z, id, nx, ny, nz, dist: t };
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
