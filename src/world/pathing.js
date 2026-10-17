// Finding the way: a small A* over the ground an animal can walk (the same
// rules as a pen's: fences, closed gates and long drops are walls; open
// gates and doors are ways through), within 16 blocks and 200 steps. A few
// searches a frame at most; an animal that can't get one this frame walks
// straight for now and asks again.

import { stepTo } from './ranch.js';

const RADIUS = 16, MAX_NODES = 200, PER_FRAME = 3;
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SPAN = 1 << 20;
const key = (x, z) => x * SPAN + z;

let budget = PER_FRAME;
export function newFrame() { budget = PER_FRAME; }

// The way from (x, y, z) toward `to`: waypoints [{x, y, z}] (cells), the
// last one as near the goal as it got; null when out of searches this
// frame. `near`: how close counts as there.
export function findPath(world, from, to, near = 1) {
  if (budget <= 0) return null;
  budget--;
  const sx = Math.floor(from.x), sy = Math.floor(from.y + 0.2), sz = Math.floor(from.z);
  const gx = Math.floor(to.x), gz = Math.floor(to.z);
  const h = (x, z) => Math.abs(x - gx) + Math.abs(z - gz);
  const nodes = new Map();   // key -> {x, y, z, g, parent}
  const start = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sz), parent: null };
  nodes.set(key(sx, sz), start);
  const open = [start];
  let best = start, n = 0;
  while (open.length && n++ < MAX_NODES) {
    // (a short list: a linear pick of the cheapest is quick enough)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (h(cur.x, cur.z) < h(best.x, best.z)) best = cur;
    if (Math.max(Math.abs(cur.x - gx), Math.abs(cur.z - gz)) <= near) { best = cur; break; }
    for (const [dx, dz] of SIDES) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (Math.abs(nx - sx) > RADIUS || Math.abs(nz - sz) > RADIUS) continue;
      const k = key(nx, nz), g = cur.g + 1;
      const seen = nodes.get(k);
      if (seen && seen.g <= g) continue;   // (a wall's g is -1: never again)
      const ny = seen ? seen.y : stepTo(world, nx, cur.y, nz);
      if (ny === null) { nodes.set(k, { g: -1 }); continue; }
      const node = { x: nx, y: ny, z: nz, g, f: g + h(nx, nz), parent: cur };
      nodes.set(k, node);
      open.push(node);
    }
  }
  const pts = [];
  for (let c = best; c && c !== start; c = c.parent) pts.push({ x: c.x, y: c.y, z: c.z });
  return pts.reverse();
}
