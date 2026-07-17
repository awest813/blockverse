// AABB voxel collision, shared by the player and mobs.
// Entities are {x, y, z (feet-center), w (width), h (height), vx, vy, vz}.

import { isSolid, B } from '../blocks/blocks.js';

const EPS = 1e-4;

function collides(world, x, y, z, w, h) {
  const hw = w / 2;
  const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw - EPS);
  const y0 = Math.floor(y), y1 = Math.floor(y + h - EPS);
  const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw - EPS);
  for (let bx = x0; bx <= x1; bx++) {
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        if (isSolid(world.getBlockW(bx, by, bz))) return true;
      }
    }
  }
  return false;
}

// Move entity by velocity*dt with axis-separated collision resolution.
// Returns {onGround, hitWall, hitCeiling}.
export function moveEntity(world, e, dt, sneakGuard = false) {
  const res = { onGround: false, hitWall: false, hitCeiling: false };

  // Y axis
  let dy = e.vy * dt;
  if (dy !== 0) {
    const ny = e.y + dy;
    if (collides(world, e.x, ny, e.z, e.w, e.h)) {
      if (dy < 0) {
        // land: snap to block top
        e.y = Math.floor(e.y + dy) + 1;
        // ensure we're not still colliding due to precision (bounded)
        for (let g = 0; g < 4 && collides(world, e.x, e.y, e.z, e.w, e.h); g++) e.y += 1;
        res.onGround = true;
      } else {
        e.y = Math.ceil(e.y + e.h + dy) - e.h - EPS * 2;
        res.hitCeiling = true;
      }
      e.vy = 0;
    } else {
      e.y = ny;
    }
  }
  // resting check (vy may already be 0)
  if (!res.onGround && collides(world, e.x, e.y - 0.02, e.z, e.w, e.h)) res.onGround = true;

  // X axis
  let dx = e.vx * dt;
  if (dx !== 0) {
    const nx = e.x + dx;
    const blockedBySneak = sneakGuard && res.onGround &&
      !collides(world, nx, e.y - 0.6, e.z, e.w, 0.5);
    if (collides(world, nx, e.y, e.z, e.w, e.h) || blockedBySneak) {
      e.vx = 0;
      res.hitWall = !blockedBySneak;
    } else {
      e.x = nx;
    }
  }

  // Z axis
  let dz = e.vz * dt;
  if (dz !== 0) {
    const nz = e.z + dz;
    const blockedBySneak = sneakGuard && res.onGround &&
      !collides(world, e.x, e.y - 0.6, nz, e.w, 0.5);
    if (collides(world, e.x, e.y, nz, e.w, e.h) || blockedBySneak) {
      e.vz = 0;
      res.hitWall = !blockedBySneak;
    } else {
      e.z = nz;
    }
  }

  return res;
}

export function entityInBlock(world, e, blockId) {
  const hw = e.w / 2;
  const x0 = Math.floor(e.x - hw), x1 = Math.floor(e.x + hw - EPS);
  const y0 = Math.floor(e.y), y1 = Math.floor(e.y + e.h - EPS);
  const z0 = Math.floor(e.z - hw), z1 = Math.floor(e.z + hw - EPS);
  for (let bx = x0; bx <= x1; bx++) {
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        if (world.getBlockW(bx, by, bz) === blockId) return true;
      }
    }
  }
  return false;
}

export function pointInWater(world, x, y, z) {
  return world.getBlockW(Math.floor(x), Math.floor(y), Math.floor(z)) === B.WATER;
}
