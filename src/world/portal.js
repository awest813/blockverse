// Ember portals: a ring of charred stone 4 wide and 5 tall (its corners
// optional) around a 2×3 opening, lit with an Ember Core. The opening fills
// with portal blocks; stand in them a moment to cross to the other side.
// Break the frame and the portal goes out.
//
// A portal is named by its opening's lowest corner (x, y, z) and its axis:
// 0 spans x (a sheet facing ±z), 1 spans z (facing ±x). The world entry
// keeps a list of them per dimension so the way back finds the one you came
// through (or the nearest, the 8:1 scale allowing).

import { B, isSolid } from '../blocks/blocks.js';
import { OVERWORLD, SCORCH } from './dimensions.js';

export const PORTAL_W = 2, PORTAL_H = 3;
// how far either side looks for a portal to come out of (overworld blocks
// are 8 to the Scorchlands' 1, so its search is wider)
const LINK_RANGE = { [OVERWORLD]: 128, [SCORCH]: 16 };

const along = (axis) => (axis ? [0, 1] : [1, 0]);   // the opening's width runs this way (dx, dz)

// each cell of the opening
export function openingCells(f) {
  const [ax, az] = along(f.axis);
  const out = [];
  for (let u = 0; u < PORTAL_W; u++) for (let v = 0; v < PORTAL_H; v++) out.push([f.x + ax * u, f.y + v, f.z + az * u]);
  return out;
}

// each cell of the ring around it: [x, y, z, corner]
export function frameCells(f) {
  const [ax, az] = along(f.axis);
  const out = [];
  for (let u = -1; u <= PORTAL_W; u++) {
    for (let v = -1; v <= PORTAL_H; v++) {
      const edgeU = u === -1 || u === PORTAL_W, edgeV = v === -1 || v === PORTAL_H;
      if (edgeU || edgeV) out.push([f.x + ax * u, f.y + v, f.z + az * u, edgeU && edgeV]);
    }
  }
  return out;
}

const frameOk = (world, f) => frameCells(f).every(([x, y, z, corner]) => corner || world.getBlockW(x, y, z) === B.CHARRED_STONE);

// A complete, empty frame with (x, y, z) in its opening (on either axis),
// or null.
function frameAround(world, x, y, z) {
  for (const axis of [0, 1]) {
    const [ax, az] = along(axis);
    for (let u = 0; u < PORTAL_W; u++) {
      for (let v = 0; v < PORTAL_H; v++) {
        const f = { x: x - ax * u, y: y - v, z: z - az * u, axis };
        if (openingCells(f).every(([cx, cy, cz]) => world.getBlockW(cx, cy, cz) === B.AIR) && frameOk(world, f)) return f;
      }
    }
  }
  return null;
}

// The frame a click on the charred stone block t (with its face normal)
// belongs to: the opening may be on the clicked face's side or beside it.
export function findFrame(world, t) {
  const tries = [[t.x + t.nx, t.y + t.ny, t.z + t.nz], [t.x + 1, t.y, t.z], [t.x - 1, t.y, t.z], [t.x, t.y + 1, t.z], [t.x, t.y - 1, t.z], [t.x, t.y, t.z + 1], [t.x, t.y, t.z - 1]];
  for (const [x, y, z] of tries) {
    if (world.getBlockW(x, y, z) !== B.AIR) continue;
    const f = frameAround(world, x, y, z);
    if (f) return f;
  }
  return null;
}

export function lightPortal(world, f) {
  for (const [x, y, z] of openingCells(f)) world.setBlock(x, y, z, B.EMBER_PORTAL, f.axis);
}

// The portal a portal block belongs to: walk down and back to its corner.
export function portalAt(world, x, y, z) {
  if (world.getBlockW(x, y, z) !== B.EMBER_PORTAL) return null;
  const axis = world.getMetaW(x, y, z) & 1;
  const [ax, az] = along(axis);
  let n = 0;
  while (n++ < PORTAL_H && world.getBlockW(x, y - 1, z) === B.EMBER_PORTAL) y--;
  n = 0;
  while (n++ < PORTAL_W && world.getBlockW(x - ax, y, z - az) === B.EMBER_PORTAL) { x -= ax; z -= az; }
  return { x, y, z, axis };
}

const whole = (world, f) => frameOk(world, f)
  && openingCells(f).every(([x, y, z]) => world.getBlockW(x, y, z) === B.EMBER_PORTAL && (world.getMetaW(x, y, z) & 1) === f.axis);

// Something changed at (x, y, z): if a portal beside it lost part of its
// frame (or its sheet), put the whole thing out. Returns the portals gone.
export function checkPortalsNear(world, x, y, z) {
  const gone = [];
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const f = portalAt(world, x + dx, y + dy, z + dz);
    if (!f || whole(world, f)) continue;
    // every connected sheet block goes (a damaged sheet may not have its corner)
    const stack = [[x + dx, y + dy, z + dz]];
    const seen = new Set();
    while (stack.length && seen.size < 64) {
      const [cx, cy, cz] = stack.pop();
      const k = `${cx},${cy},${cz}`;
      if (seen.has(k) || world.getBlockW(cx, cy, cz) !== B.EMBER_PORTAL) continue;
      seen.add(k);
      world.setBlock(cx, cy, cz, B.AIR);
      stack.push([cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy + 1, cz], [cx, cy - 1, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
    }
    gone.push(f);
  }
  return gone;
}

// Build a lit portal with its opening's corner at (x, y, z) (an arrival with
// nothing to come out of): the frame, the opening and a step either side
// cleared, and solid ground under it all (a platform over lava, water or a
// drop).
export function buildPortal(world, x, y, z, axis, dimension) {
  const f = { x, y, z, axis };
  const [ax, az] = along(axis);
  const [nx, nz] = [az, ax];   // the way it faces
  const floor = dimension === SCORCH ? B.SCORCHED_STONE : B.COBBLESTONE;
  const keep = (id) => id === B.BEDROCK;
  for (let u = -2; u <= PORTAL_W + 1; u++) {
    for (let s = -2; s <= 2; s++) {
      if (s === 0 && u >= -1 && u <= PORTAL_W) continue;   // (the frame itself)
      const bx = x + ax * u + nx * s, bz = z + az * u + nz * s;
      // ground round the frame: a platform where there's none (over lava,
      // water or a drop)
      const under = world.getBlockW(bx, y - 1, bz);
      if (!isSolid(under) && !keep(under)) world.setBlock(bx, y - 1, bz, floor);
      // room to step in and out
      if (Math.abs(s) === 1 && u >= -1 && u <= PORTAL_W) for (let v = 0; v < PORTAL_H; v++) if (!keep(world.getBlockW(bx, y + v, bz))) world.setBlock(bx, y + v, bz, B.AIR);
    }
  }
  for (const [bx, by, bz] of frameCells(f)) if (!keep(world.getBlockW(bx, by, bz))) world.setBlock(bx, by, bz, B.CHARRED_STONE);
  lightPortal(world, f);
  return f;
}

// where to stand in a portal: the middle of its opening, on its floor
export function standSpot(f) {
  const [ax, az] = along(f.axis);
  return { x: f.x + 0.5 + ax * 0.5, y: f.y, z: f.z + 0.5 + az * 0.5 };
}

// ---- the list of portals in the world entry ----

const same = (a, b) => a.dim === b.dim && a.x === b.x && a.y === b.y && a.z === b.z;

export function rememberPortal(meta, dim, f) {
  meta.portals ??= [];
  const p = { dim, x: f.x, y: f.y, z: f.z, axis: f.axis };
  if (!meta.portals.some((q) => same(q, p))) meta.portals.push(p);
}

export function forgetPortal(meta, dim, f) {
  if (meta.portals) meta.portals = meta.portals.filter((q) => !same(q, { dim, ...f }));
}

// the remembered portal in `dim` nearest (x, z) within its range, or null
export function nearestPortal(meta, dim, x, z) {
  let best = null, bd = LINK_RANGE[dim] ?? 16;
  for (const q of meta.portals ?? []) {
    if (q.dim !== dim) continue;
    const d = Math.max(Math.abs(q.x + 1 - x), Math.abs(q.z + 1 - z));
    if (d <= bd) { best = q; bd = d; }
  }
  return best;
}
