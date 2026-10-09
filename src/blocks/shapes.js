// Box shapes for R_SHAPE blocks. Each box is [x0, y0, z0, x1, y1, z1] in
// block-local units. The same boxes drive the mesher, collision and the
// block raycast, so what you see is what you bump into and click.

import { B, BLOCKS } from './blocks.js';

const P = 1 / 16;
// the four horizontal edges, indexed like placement meta: 0 = -z, 1 = +x, 2 = +z, 3 = -x
const EDGE_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// a thin slab of `t` against edge e (0..3), full height
function edgeBox(e, t, y0 = 0, y1 = 1) {
  switch (e & 3) {
    case 0: return [0, y0, 0, 1, y1, t];
    case 1: return [1 - t, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 1 - t, 1, y1, 1];
    default: return [0, y0, 0, t, y1, 1];
  }
}

// does a fence at this cell reach toward a neighbour with this id?
function fenceConnects(id) {
  const b = BLOCKS[id];
  if (!b) return false;
  return id === B.OAK_FENCE || (b.solid && b.opacity >= 15);
}

// door meta: bits 0-1 edge, bit 2 open (an open door swings onto the next edge)
export function doorEdge(meta) {
  return (meta & 4) ? ((meta & 3) + 1) & 3 : meta & 3;
}

// nb(dx, dz) -> id of the horizontal neighbour (fences only)
export function shapeBoxes(id, meta, nb, collision = false) {
  switch (BLOCKS[id]?.shape) {
    case 'slab': return [(meta & 1) ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
    case 'ladder': return [edgeBox(meta, P)];
    case 'door': return [edgeBox(doorEdge(meta), 3 * P)];
    // lily pads float on the (slightly lowered) water surface below them
    case 'pad': return [[P, -0.125, P, 1 - P, -0.1, 1 - P]];
    case 'layer': return [[0, 0, 0, 1, 2 * P, 1]];
    case 'fence': {
      const top = collision ? 1.5 : 1;
      const boxes = [[6 * P, 0, 6 * P, 10 * P, top, 10 * P]];
      EDGE_DIRS.forEach(([dx, dz], e) => {
        if (!nb || !fenceConnects(nb(dx, dz))) return;
        // rails from the post out to the edge (one tall box for collision)
        const rails = collision ? [[0, top]] : [[6 * P, 9 * P], [12 * P, 15 * P]];
        for (const [y0, y1] of rails) {
          if (e === 0) boxes.push([7 * P, y0, 0, 9 * P, y1, 6 * P]);
          else if (e === 1) boxes.push([10 * P, y0, 7 * P, 1, y1, 9 * P]);
          else if (e === 2) boxes.push([7 * P, y0, 10 * P, 9 * P, y1, 1]);
          else boxes.push([0, y0, 7 * P, 6 * P, y1, 9 * P]);
        }
      });
      return boxes;
    }
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

// boxes for a block in the world (world needs getBlockW and getMetaW)
export function worldBoxes(world, x, y, z, id, collision = false) {
  return shapeBoxes(id, world.getMetaW(x, y, z), (dx, dz) => world.getBlockW(x + dx, y, z + dz), collision);
}
