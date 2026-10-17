// AABB voxel collision, shared by the player and mobs.
// Entities are {x, y, z (feet-center), w (width), h (height), vx, vy, vz}.

import { isSolid, isWater, BLOCKS, R_SHAPE } from '../blocks/blocks.js';
import { worldBoxes } from '../blocks/shapes.js';

const EPS = 1e-4;
const STEP_HEIGHT = 0.6;   // walk up slabs without jumping

// Call fn(boxY0, boxY1) for each solid box overlapping the AABB; stops early
// when fn returns true. Shaped blocks (slabs, fences, doors) use their boxes;
// fences reach 1.5 blocks up, so the cell below the feet is checked too.
function forEachHit(world, x, y, z, w, h, fn) {
  const hw = w / 2;
  const ax0 = x - hw, ax1 = x + hw, az0 = z - hw, az1 = z + hw, ay0 = y, ay1 = y + h;
  const x0 = Math.floor(ax0), x1 = Math.floor(ax1 - EPS);
  const y0 = Math.floor(ay0), y1 = Math.floor(ay1 - EPS);
  const z0 = Math.floor(az0), z1 = Math.floor(az1 - EPS);
  for (let bx = x0; bx <= x1; bx++) {
    for (let by = y0 - 1; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        const id = world.getBlockW(bx, by, bz);
        if (!isSolid(id)) continue;
        if (BLOCKS[id].render !== R_SHAPE) {
          if (by >= y0 && fn(by, by + 1)) return true;
          continue;
        }
        for (const b of worldBoxes(world, bx, by, bz, id, true)) {
          if (bx + b[0] >= ax1 || bx + b[3] <= ax0 || bz + b[2] >= az1 || bz + b[5] <= az0) continue;
          if (by + b[1] >= ay1 || by + b[4] <= ay0) continue;
          if (fn(by + b[1], by + b[4])) return true;
        }
      }
    }
  }
  return false;
}

function collides(world, x, y, z, w, h) {
  return forEachHit(world, x, y, z, w, h, () => true);
}

// Is this entity's box inside something solid? (e.g. a baby that's just
// grown up beside a fence)
export function entityCollides(world, e) {
  return collides(world, e.x, e.y, e.z, e.w, e.h);
}

// Slide an entity sideways out of whatever it overlaps (never up: popping a
// grown animal upward would stand it on top of a fence). False if boxed in.
export function nudgeFree(world, e, reach = 0.6) {
  if (!collides(world, e.x, e.y, e.z, e.w, e.h)) return true;
  for (let r = 0.05; r <= reach + 1e-9; r += 0.05) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
      if (!collides(world, x, e.y, z, e.w, e.h)) { e.x = x; e.z = z; return true; }
    }
  }
  return false;
}

// highest box top / lowest box bottom overlapping the AABB
function topOf(world, x, y, z, w, h) {
  let top = -Infinity;
  forEachHit(world, x, y, z, w, h, (y0, y1) => { top = Math.max(top, y1); });
  return top;
}
// highest box top overlapping the AABB that's no higher than cap (the floor
// under an entity, not the top of a wall beside it)
function topBelow(world, x, y, z, w, h, cap) {
  let top = -Infinity;
  forEachHit(world, x, y, z, w, h, (y0, y1) => { if (y1 <= cap) top = Math.max(top, y1); });
  return top;
}
// lowest box bottom overlapping the AABB that's no lower than floor (a
// ceiling over its head, not a wall beside it)
function bottomAbove(world, x, y, z, w, h, floor) {
  let bottom = Infinity;
  forEachHit(world, x, y, z, w, h, (y0) => { if (y0 >= floor) bottom = Math.min(bottom, y0); });
  return bottom;
}
function bottomOf(world, x, y, z, w, h) {
  let bottom = Infinity;
  forEachHit(world, x, y, z, w, h, (y0) => { bottom = Math.min(bottom, y0); });
  return bottom;
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
      if (collides(world, e.x, e.y, e.z, e.w, e.h)) {
        // already overlapping something beside it (spawned or set down too
        // close to a wall): only a real floor or ceiling stops it, and it
        // slides out sideways. It never climbs the wall (the landing lift below
        // used to carry such a mob up through solid rock) or drops through it.
        if (dy < 0) {
          const floor = topBelow(world, e.x, ny, e.z, e.w, e.h, e.y + EPS);
          if (floor > ny) { e.y = floor; res.onGround = true; e.vy = 0; } else e.y = ny;
        } else {
          const ceiling = bottomAbove(world, e.x, ny, e.z, e.w, e.h, e.y + e.h - EPS);
          if (ceiling < ny + e.h) { e.y = ceiling - e.h - EPS * 2; res.hitCeiling = true; e.vy = 0; } else e.y = ny;
        }
        nudgeFree(world, e);
        return finishMove(world, e, dt, sneakGuard, res);
      }
      if (dy < 0) {
        // land: snap onto the highest thing underneath (a block or slab top)
        const top = topOf(world, e.x, ny, e.z, e.w, e.h);
        e.y = top > ny && top <= e.y + EPS ? top : Math.floor(e.y + dy) + 1;
        // ensure we're not still colliding due to precision (bounded)
        for (let g = 0; g < 4 && collides(world, e.x, e.y, e.z, e.w, e.h); g++) e.y += 0.5;
        res.onGround = true;
      } else {
        const bottom = bottomOf(world, e.x, ny, e.z, e.w, e.h);
        e.y = (Number.isFinite(bottom) ? bottom : Math.ceil(e.y + e.h + dy)) - e.h - EPS * 2;
        res.hitCeiling = true;
      }
      e.vy = 0;
    } else {
      e.y = ny;
    }
  }
  return finishMove(world, e, dt, sneakGuard, res);
}

// the rest of a move once the vertical part is settled: the resting check,
// then the horizontal axes
function finishMove(world, e, dt, sneakGuard, res) {
  // resting check (vy may already be 0)
  if (!res.onGround && collides(world, e.x, e.y - 0.02, e.z, e.w, e.h)) res.onGround = true;

  // X axis
  let dx = e.vx * dt;
  if (dx !== 0) {
    const nx = e.x + dx;
    const blockedBySneak = sneakGuard && res.onGround &&
      !collides(world, nx, e.y - 0.6, e.z, e.w, 0.5);
    if (blockedBySneak) {
      e.vx = 0;
    } else if (!collides(world, nx, e.y, e.z, e.w, e.h)) {
      e.x = nx;
    } else if (res.onGround && stepUp(world, e, nx, e.z)) {
      e.x = nx;
    } else {
      e.vx = 0;
      res.hitWall = true;
    }
  }

  // Z axis
  let dz = e.vz * dt;
  if (dz !== 0) {
    const nz = e.z + dz;
    const blockedBySneak = sneakGuard && res.onGround &&
      !collides(world, e.x, e.y - 0.6, nz, e.w, 0.5);
    if (blockedBySneak) {
      e.vz = 0;
    } else if (!collides(world, e.x, e.y, nz, e.w, e.h)) {
      e.z = nz;
    } else if (res.onGround && stepUp(world, e, e.x, nz)) {
      e.z = nz;
    } else {
      e.vz = 0;
      res.hitWall = true;
    }
  }

  return res;
}

// Walking into something low (a slab, a snow layer): rise onto it if there's room.
function stepUp(world, e, x, z) {
  const top = topOf(world, x, e.y, z, e.w, e.h);
  const need = top - e.y;
  if (!(need > 0 && need <= STEP_HEIGHT)) return false;
  if (collides(world, x, top + EPS, z, e.w, e.h)) return false;
  e.y = top + EPS;
  return true;
}

// in water (or a plant growing in water)
export function entityInWater(world, e) {
  const hw = e.w / 2;
  const x0 = Math.floor(e.x - hw), x1 = Math.floor(e.x + hw - EPS);
  const y0 = Math.floor(e.y), y1 = Math.floor(e.y + e.h - EPS);
  const z0 = Math.floor(e.z - hw), z1 = Math.floor(e.z + hw - EPS);
  for (let bx = x0; bx <= x1; bx++) {
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        if (isWater(world.getBlockW(bx, by, bz))) return true;
      }
    }
  }
  return false;
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
  return isWater(world.getBlockW(Math.floor(x), Math.floor(y), Math.floor(z)));
}
