// Procedural pixel-art texture generation. Every tile is original art drawn
// in code — nothing is copied from any existing game. Tiles are 16x16 and
// deterministic (seeded per tile name) so they look identical every run.

import { coordRng, hashString } from '../core/rng.js';

export const TILE = 16;

// ---------- low-level helpers ----------

function shade([r, g, b, a = 255], f) {
  return [Math.min(255, r * f) | 0, Math.min(255, g * f) | 0, Math.min(255, b * f) | 0, a];
}

function css([r, g, b, a = 255]) {
  return `rgba(${r | 0},${g | 0},${b | 0},${(a / 255).toFixed(3)})`;
}

function px(ctx, x, y, col) {
  if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
  ctx.fillStyle = css(col);
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx, x, y, w, h, col) {
  ctx.fillStyle = css(col);
  ctx.fillRect(x, y, w, h);
}

// Fill the tile with per-pixel noise picked from weighted colors: [[col, weight], ...]
function fillNoise(ctx, rng, colors) {
  let total = 0;
  for (const [, w] of colors) total += w;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let r = rng() * total;
      for (const [col, w] of colors) {
        r -= w;
        if (r <= 0) { px(ctx, x, y, col); break; }
      }
    }
  }
}

// Scatter n pixels of col randomly.
function speckle(ctx, rng, col, n) {
  for (let i = 0; i < n; i++) {
    px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, col);
  }
}

// Small irregular blob centred at (cx, cy).
function blob(ctx, rng, cx, cy, size, cols) {
  for (let i = 0; i < size; i++) {
    const x = cx + ((rng() * 3) | 0) - 1;
    const y = cy + ((rng() * 3) | 0) - 1;
    px(ctx, x, y, cols[(rng() * cols.length) | 0]);
  }
}

// ---------- palettes ----------

const P = {
  stoneL: [138, 138, 138], stone: [125, 125, 125], stoneD: [105, 105, 105], stoneDD: [88, 88, 88],
  dirtL: [155, 112, 74], dirt: [134, 96, 60], dirtD: [110, 78, 48],
  grassL: [118, 190, 82], grass: [96, 168, 68], grassD: [76, 140, 54],
  sandL: [222, 210, 164], sand: [210, 196, 148], sandD: [188, 174, 128],
  snowL: [250, 251, 253], snow: [238, 242, 247], snowD: [216, 224, 236],
  woodOakL: [178, 140, 88], woodOak: [158, 122, 74], woodOakD: [132, 100, 58],
  barkOak: [104, 82, 50], barkOakD: [84, 66, 40], barkOakL: [122, 98, 62],
  birchL: [232, 230, 222], birch: [214, 212, 202], birchD: [70, 66, 60],
  spruceBark: [72, 54, 34], spruceBarkD: [56, 42, 26], spruceBarkL: [88, 68, 44],
  leafOak: [64, 130, 42], leafOakD: [48, 104, 32], leafOakL: [82, 152, 54],
  leafBirch: [96, 156, 68], leafBirchD: [76, 128, 52], leafBirchL: [116, 176, 84],
  leafSpruce: [44, 96, 60], leafSpruceD: [32, 76, 46], leafSpruceL: [58, 116, 74],
  waterL: [64, 118, 228, 205], water: [48, 100, 214, 205], waterD: [38, 84, 196, 205],
};

// ---------- tile generators ----------

const generators = {};
function tile(name, fn) { generators[name] = fn; }

// --- ground ---
tile('stone', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.stone, 8], [P.stoneL, 3], [P.stoneD, 3], [P.stoneDD, 1]]);
});

tile('cobblestone', (ctx, rng) => cobble(ctx, rng, false));
tile('mossy_cobble', (ctx, rng) => cobble(ctx, rng, true));

function cobble(ctx, rng, mossy) {
  fillNoise(ctx, rng, [[P.stoneD, 5], [P.stoneDD, 3]]);
  // rounded stone lumps on a jittered grid
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const cx = gx * 5 + 1 + ((rng() * 2) | 0);
      const cy = gy * 5 + 1 + ((rng() * 2) | 0);
      const w = 3 + ((rng() * 2) | 0);
      const h = 3 + ((rng() * 2) | 0);
      const base = rng() < 0.5 ? P.stone : P.stoneL;
      rect(ctx, cx, cy, w, h, base);
      rect(ctx, cx, cy, w, 1, shade(base, 1.12));
      rect(ctx, cx, cy + h - 1, w, 1, shade(base, 0.85));
    }
  }
  if (mossy) {
    for (let i = 0; i < 5; i++) {
      blob(ctx, rng, (rng() * 14 + 1) | 0, (rng() * 14 + 1) | 0, 8, [P.grassD, [58, 110, 44], P.grass]);
    }
  }
}

tile('bedrock', (ctx, rng) => {
  fillNoise(ctx, rng, [[[60, 60, 60], 5], [[40, 40, 40], 4], [[90, 90, 90], 3], [[25, 25, 25], 2]]);
});

tile('dirt', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.dirt, 7], [P.dirtL, 3], [P.dirtD, 3]]);
  speckle(ctx, rng, [92, 64, 40], 8);
});

tile('grass_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.grass, 7], [P.grassL, 3], [P.grassD, 3]]);
  speckle(ctx, rng, [130, 200, 96], 6);
});

tile('grass_side', (ctx, rng) => {
  generators['dirt'](ctx, rng);
  rect(ctx, 0, 0, TILE, 3, P.grass);
  for (let x = 0; x < TILE; x++) {
    const d = 2 + ((rng() * 3) | 0); // jagged grass lip
    for (let y = 0; y < d; y++) px(ctx, x, y, rng() < 0.4 ? P.grassL : P.grass);
    px(ctx, x, d, P.grassD);
  }
});

tile('snowy_grass_side', (ctx, rng) => {
  generators['dirt'](ctx, rng);
  for (let x = 0; x < TILE; x++) {
    const d = 2 + ((rng() * 3) | 0);
    for (let y = 0; y < d; y++) px(ctx, x, y, rng() < 0.4 ? P.snowL : P.snow);
    px(ctx, x, d, P.snowD);
  }
});

tile('snow_block', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.snow, 8], [P.snowL, 4], [P.snowD, 2]]);
});

tile('sand', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.sand, 8], [P.sandL, 3], [P.sandD, 3]]);
});

tile('sandstone', (ctx, rng) => {
  for (let y = 0; y < TILE; y++) {
    const band = Math.sin(y * 1.1) * 0.08 + 1;
    for (let x = 0; x < TILE; x++) {
      const c = rng() < 0.2 ? P.sandD : P.sand;
      px(ctx, x, y, shade(c, band));
    }
  }
  rect(ctx, 0, 0, TILE, 1, P.sandL);
  rect(ctx, 0, TILE - 1, TILE, 1, P.sandD);
});

tile('sandstone_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.sand, 8], [P.sandL, 4], [P.sandD, 1]]);
});

tile('gravel', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.stone, 5], [P.stoneD, 4], [[146, 132, 120], 3], [[100, 92, 84], 3]]);
  for (let i = 0; i < 7; i++) {
    blob(ctx, rng, (rng() * 14 + 1) | 0, (rng() * 14 + 1) | 0, 4, [P.stoneL, [160, 148, 136]]);
  }
});

tile('clay', (ctx, rng) => {
  fillNoise(ctx, rng, [[[158, 164, 178], 7], [[142, 148, 164], 4], [[172, 178, 190], 3]]);
});

// --- fluids / ice ---
tile('water', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.water, 7], [P.waterD, 3], [P.waterL, 2]]);
  for (let i = 0; i < 4; i++) {
    const y = (rng() * TILE) | 0;
    const x = (rng() * 10) | 0;
    rect(ctx, x, y, 4 + ((rng() * 4) | 0), 1, [110, 160, 240, 160]);
  }
});

tile('lava', (ctx, rng) => {
  fillNoise(ctx, rng, [[[232, 96, 20], 6], [[250, 150, 30], 4], [[196, 56, 14], 3], [[255, 214, 90], 1]]);
  for (let i = 0; i < 5; i++) blob(ctx, rng, (rng() * 14 + 1) | 0, (rng() * 14 + 1) | 0, 4, [[255, 196, 64], [255, 168, 40]]);
});

// ---- block shapes: ladder, door, fence icon, lily pad, kelp, seagrass ----
tile('ladder', (ctx) => {
  const rail = P.woodOakD, rung = P.woodOak, hi = P.woodOakL;
  rect(ctx, 2, 0, 2, 16, rail); rect(ctx, 12, 0, 2, 16, rail);
  rect(ctx, 2, 0, 1, 16, hi); rect(ctx, 12, 0, 1, 16, hi);
  for (const y of [2, 6, 10, 14]) { rect(ctx, 4, y, 8, 2, rung); rect(ctx, 4, y, 8, 1, hi); }
});

function doorHalf(ctx, rng, upper) {
  planks(ctx, rng, P.woodOak);
  const frame = P.woodOakD;
  rect(ctx, 0, 0, 16, 1, frame); rect(ctx, 0, 15, 16, 1, frame);
  rect(ctx, 0, 0, 1, 16, frame); rect(ctx, 15, 0, 1, 16, frame);
  if (upper) {
    // two little windows
    ctx.clearRect(3, 3, 4, 6); ctx.clearRect(9, 3, 4, 6);
    rect(ctx, 7, 3, 2, 6, frame);
  } else {
    rect(ctx, 3, 3, 10, 1, frame); rect(ctx, 3, 12, 10, 1, frame);
    rect(ctx, 12, 1, 2, 2, [70, 70, 76]);   // handle
  }
}
tile('oak_door_lower', (ctx, rng) => doorHalf(ctx, rng, false));
tile('oak_door_upper', (ctx, rng) => doorHalf(ctx, rng, true));
tile('oak_door_item', (ctx, rng) => {
  const d = P.woodOakD, w = P.woodOak, l = P.woodOakL;
  rect(ctx, 4, 0, 8, 16, w); rect(ctx, 4, 0, 1, 16, l);
  rect(ctx, 4, 0, 8, 1, d); rect(ctx, 4, 15, 8, 1, d); rect(ctx, 11, 0, 1, 16, d);
  ctx.clearRect(6, 2, 4, 4); rect(ctx, 6, 7, 4, 1, d);
  rect(ctx, 9, 9, 1, 2, [70, 70, 76]);
});
tile('oak_fence_item', (ctx) => {
  const w = P.woodOak, d = P.woodOakD, l = P.woodOakL;
  for (const x of [2, 11]) { rect(ctx, x, 1, 3, 15, w); rect(ctx, x, 1, 1, 15, l); rect(ctx, x + 2, 1, 1, 15, d); }
  rect(ctx, 0, 4, 16, 2, w); rect(ctx, 0, 10, 16, 2, w);
  rect(ctx, 0, 5, 16, 1, d); rect(ctx, 0, 11, 16, 1, d);
});
tile('lily_pad', (ctx, rng) => {
  const g = [58, 128, 46], gd = [40, 96, 32], gl = [86, 160, 64];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    if (dx * dx + dy * dy > 49) continue;
    if (dx > 0 && Math.abs(dy) < dx * 0.35) continue;   // the notch
    px(ctx, x, y, rng() < 0.2 ? gl : rng() < 0.2 ? gd : g);
  }
  for (let i = 1; i < 7; i++) { px(ctx, 7 - i, 7, gd); px(ctx, 7, 7 - i, gd); px(ctx, 7, 7 + i, gd); }
});
tile('kelp', (ctx, rng) => {
  const g = [52, 110, 40], gd = [36, 80, 28], gl = [80, 140, 56];
  for (let y = 0; y < 16; y++) {
    const x = 7 + Math.round(Math.sin(y * 0.7) * 1.5);
    rect(ctx, x, y, 2, 1, g);
    if (y % 4 === 1) { rect(ctx, x + 2, y, 3, 1, gl); px(ctx, x + 4, y + 1, gl); }
    if (y % 4 === 3) { rect(ctx, x - 3, y, 3, 1, gd); px(ctx, x - 3, y + 1, gd); }
  }
});
tile('seagrass', (ctx, rng) => {
  const cols = [[64, 140, 60], [48, 116, 48], [92, 168, 80]];
  for (let i = 0; i < 6; i++) {
    let x = 2 + i * 2 + ((rng() * 2) | 0);
    const top = 3 + ((rng() * 8) | 0);
    for (let y = 15; y >= top; y--) {
      px(ctx, x, y, cols[i % 3]);
      if (rng() < 0.15) x += rng() < 0.5 ? -1 : 1;
    }
  }
});

tile('ice', (ctx, rng) => {
  fillNoise(ctx, rng, [[[158, 190, 242, 235], 7], [[140, 174, 232, 235], 4], [[184, 210, 248, 235], 3]]);
  for (let i = 0; i < 3; i++) {
    let x = (rng() * TILE) | 0, y = (rng() * TILE) | 0;
    for (let s = 0; s < 5; s++) {
      px(ctx, x, y, [226, 240, 254, 240]);
      x += rng() < 0.5 ? 1 : -1; y += 1;
    }
  }
});

// --- wood ---
function barkSide(ctx, rng, base, dark, light) {
  for (let x = 0; x < TILE; x++) {
    const stripe = rng();
    for (let y = 0; y < TILE; y++) {
      let c = base;
      if (stripe < 0.28) c = dark;
      else if (stripe > 0.82) c = light;
      if (rng() < 0.12) c = shade(c, 0.88);
      px(ctx, x, y, c);
    }
  }
  // knots / cracks
  for (let i = 0; i < 3; i++) {
    const x = (rng() * TILE) | 0;
    const y = (rng() * 10) | 0;
    rect(ctx, x, y, 1, 3 + ((rng() * 4) | 0), dark);
  }
}

function logTop(ctx, rng, bark, wood, woodD) {
  rect(ctx, 0, 0, TILE, TILE, bark);
  rect(ctx, 2, 2, 12, 12, wood);
  // growth rings
  rect(ctx, 4, 4, 8, 8, woodD);
  rect(ctx, 6, 6, 4, 4, wood);
  rect(ctx, 7, 7, 2, 2, woodD);
  speckle(ctx, rng, shade(wood, 1.1), 10);
}

tile('oak_log', (ctx, rng) => barkSide(ctx, rng, P.barkOak, P.barkOakD, P.barkOakL));
tile('oak_log_top', (ctx, rng) => logTop(ctx, rng, P.barkOak, P.woodOak, P.woodOakD));
tile('birch_log', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.birch, 8], [P.birchL, 4], [[196, 194, 186], 2]]);
  for (let i = 0; i < 6; i++) {
    const y = (rng() * TILE) | 0;
    rect(ctx, (rng() * 12) | 0, y, 2 + ((rng() * 3) | 0), 1, P.birchD);
  }
});
tile('birch_log_top', (ctx, rng) => logTop(ctx, rng, P.birch, [206, 188, 152], [182, 164, 130]));
tile('spruce_log', (ctx, rng) => barkSide(ctx, rng, P.spruceBark, P.spruceBarkD, P.spruceBarkL));
tile('spruce_log_top', (ctx, rng) => logTop(ctx, rng, P.spruceBark, [140, 106, 66], [116, 88, 54]));

function planks(ctx, rng, base) {
  const dark = shade(base, 0.72);
  const light = shade(base, 1.12);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < TILE; x++) {
        let c = base;
        if (rng() < 0.18) c = shade(base, 0.92);
        if (rng() < 0.08) c = light;
        px(ctx, x, y, c);
      }
    }
    rect(ctx, 0, y0 + 3, TILE, 1, dark);          // horizontal seam
    const joint = ((rng() * 12) | 0) + 2;          // one vertical joint per plank
    rect(ctx, joint, y0, 1, 3, dark);
  }
}

tile('oak_planks', (ctx, rng) => planks(ctx, rng, P.woodOak));
tile('birch_planks', (ctx, rng) => planks(ctx, rng, [206, 190, 150]));
tile('spruce_planks', (ctx, rng) => planks(ctx, rng, [112, 84, 50]));

function leaves(ctx, rng, base, dark, light) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const r = rng();
      if (r < 0.22) continue; // transparent hole
      let c = base;
      if (r < 0.45) c = dark;
      else if (r > 0.85) c = light;
      px(ctx, x, y, c);
    }
  }
}

tile('oak_leaves', (ctx, rng) => leaves(ctx, rng, P.leafOak, P.leafOakD, P.leafOakL));

// ---- the Scorchlands ----
tile('scorched_stone', (ctx, rng) => {
  fillNoise(ctx, rng, [[[74, 62, 60], 8], [[58, 48, 46], 4], [[92, 78, 72], 2], [[110, 60, 40], 1]]);
});
tile('ash', (ctx, rng) => {
  fillNoise(ctx, rng, [[[112, 108, 104], 8], [[94, 90, 88], 4], [[134, 130, 126], 3]]);
  speckle(ctx, rng, [60, 56, 54], 6);
});
tile('ashen_grass_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[70, 66, 60], 7], [[52, 50, 46], 4], [[92, 86, 76], 3]]);
  for (let i = 0; i < 7; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, rng() < 0.5 ? [230, 120, 40] : [250, 180, 70]);   // embers
});
tile('ashen_grass_side', (ctx, rng) => {
  generators['ash'](ctx, rng);
  for (let x = 0; x < TILE; x++) {
    const d = 2 + ((rng() * 3) | 0);
    for (let y = 0; y < d; y++) px(ctx, x, y, rng() < 0.4 ? [92, 86, 76] : [70, 66, 60]);
    px(ctx, x, d, [44, 42, 40]);
  }
  px(ctx, (rng() * TILE) | 0, 1, [240, 140, 50]);
});
tile('charred_log', (ctx, rng) => {
  barkSide(ctx, rng, [34, 30, 30], [20, 18, 18], [52, 46, 44]);
  // cracks still glowing deep inside
  for (let i = 0; i < 4; i++) {
    const x = (rng() * TILE) | 0, y = (rng() * 12) | 0, n = 2 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) px(ctx, x, y + k, k === 1 ? [250, 170, 60] : [200, 80, 30]);
  }
});
tile('charred_log_top', (ctx, rng) => logTop(ctx, rng, [30, 26, 26], [62, 52, 48], [44, 36, 34]));
tile('charred_planks', (ctx, rng) => planks(ctx, rng, [58, 48, 44]));
tile('charred_leaves', (ctx, rng) => {
  // sparse and shrivelled: far more sky than leaf
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const r = rng();
    if (r < 0.62) continue;
    px(ctx, x, y, r > 0.95 ? [140, 60, 30] : r > 0.8 ? [62, 50, 44] : [36, 30, 28]);
  }
});
tile('smouldering_stump', (ctx, rng) => {
  generators['charred_log'](ctx, rng);
  rect(ctx, 5, 5, 6, 7, [120, 40, 20]);
  for (let i = 0; i < 14; i++) px(ctx, 5 + ((rng() * 6) | 0), 5 + ((rng() * 7) | 0), rng() < 0.5 ? [250, 150, 50] : [255, 210, 110]);
});
tile('smouldering_stump_top', (ctx, rng) => {
  logTop(ctx, rng, [30, 26, 26], [160, 60, 26], [110, 36, 18]);
  for (let i = 0; i < 12; i++) px(ctx, 3 + ((rng() * 10) | 0), 3 + ((rng() * 10) | 0), rng() < 0.5 ? [255, 180, 70] : [255, 230, 140]);
});
tile('ember_portal', (ctx, rng) => {
  // swirling ember light: an orange-to-violet whorl with bright motes
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const w = Math.sin(a * 3 + r * 0.9);
    const t = 0.5 + 0.5 * w;
    px(ctx, x, y, [Math.round(170 + 80 * t), Math.round(50 + 70 * t * t), Math.round(90 + 60 * (1 - t))]);
  }
  for (let i = 0; i < 10; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, [255, 230, 170]);
});
tile('scorched_bricks', (ctx, rng) => {
  const mortar = [36, 28, 28], brick = [82, 36, 32];
  rect(ctx, 0, 0, TILE, TILE, mortar);
  for (let row = 0; row < 4; row++) {
    const y = row * 4, off = row % 2 === 0 ? 0 : 4;
    for (let bx = -1; bx < 3; bx++) {
      const x = bx * 8 + off;
      const c = rng() < 0.35 ? shade(brick, 0.75) : rng() < 0.2 ? shade(brick, 1.2) : brick;
      rect(ctx, x + 1, y + 1, 7, 3, c);
      rect(ctx, x + 1, y + 1, 7, 1, shade(c, 1.12));
    }
  }
  for (let i = 0; i < 5; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, [20, 16, 16]);   // soot and cracks
});
tile('charred_stone', (ctx, rng) => {
  fillNoise(ctx, rng, [[[34, 30, 34], 8], [[24, 22, 26], 4], [[48, 42, 46], 3]]);
  // thin veins of ember
  let x = (rng() * TILE) | 0;
  for (let y = 0; y < TILE; y++) { x = Math.max(0, Math.min(TILE - 1, x + ((rng() * 3) | 0) - 1)); if (rng() < 0.75) px(ctx, x, y, rng() < 0.3 ? [255, 170, 70] : [200, 70, 30]); }
});
// palm fronds: long leaflets fanning along a midrib, lots of sky between
tile('palm_leaves', (ctx, rng) => {
  const g = [70, 150, 52], gD = [52, 120, 40], gL = [104, 178, 70];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const diag = (x + y * 2) % 6;
      if (diag > 2 || rng() < 0.12) continue;
      px(ctx, x, y, diag === 0 ? gL : rng() < 0.4 ? gD : g);
    }
  }
  for (let i = 0; i < TILE; i++) px(ctx, i, i, [96, 120, 50]);   // the midrib
});
tile('palm_log', (ctx, rng) => {
  // grey-tan bark in stacked rings
  for (let y = 0; y < TILE; y++) {
    const ring = y % 4 === 0;
    for (let x = 0; x < TILE; x++) {
      let c = ring ? [126, 104, 76] : [168, 144, 108];
      if (!ring && rng() < 0.18) c = [150, 126, 92];
      if (!ring && rng() < 0.06) c = [188, 166, 128];
      px(ctx, x, y, c);
    }
  }
});
tile('palm_log_top', (ctx, rng) => logTop(ctx, rng, [150, 126, 92], [212, 190, 150], [188, 164, 124]));
tile('palm_sapling', (ctx, rng) => {
  for (let y = 8; y < TILE; y++) px(ctx, 7, y, [150, 126, 92]);
  for (const [dx, dy] of [[-1, 0], [1, 0], [-1, -1], [1, -1]]) {
    for (let i = 1; i < 6; i++) px(ctx, 7 + dx * i, 8 + dy * Math.floor(i / 2) + (i > 3 ? 1 : 0), i % 2 ? [70, 150, 52] : [52, 120, 40]);
  }
  px(ctx, 7, 7, [104, 178, 70]); px(ctx, 7, 6, [70, 150, 52]);
});
tile('coconut_husk', (ctx, rng) => fillNoise(ctx, rng, [[[112, 78, 44], 6], [[92, 62, 34], 4], [[136, 98, 58], 3]]));
tile('coconut', (ctx, rng) => {
  // a hairy brown nut, cracked to show the white flesh
  const b = [116, 80, 44], bD = [88, 60, 32], bL = [146, 106, 64];
  rect(ctx, 4, 4, 8, 8, b); rect(ctx, 3, 5, 10, 6, b); rect(ctx, 5, 3, 6, 10, b);
  for (let i = 0; i < 14; i++) px(ctx, 3 + ((rng() * 10) | 0), 3 + ((rng() * 10) | 0), rng() < 0.5 ? bD : bL);
  rect(ctx, 6, 6, 4, 3, [240, 236, 224]); px(ctx, 6, 6, [214, 208, 192]);
  px(ctx, 6, 10, bD); px(ctx, 8, 10, bD); px(ctx, 7, 11, bD);   // the three "eyes"
});
tile('birch_leaves', (ctx, rng) => leaves(ctx, rng, P.leafBirch, P.leafBirchD, P.leafBirchL));
tile('spruce_leaves', (ctx, rng) => leaves(ctx, rng, P.leafSpruce, P.leafSpruceD, P.leafSpruceL));

// --- saplings: a short stem with a little leafy crown ---
function sapling(ctx, rng, stem, leaf, leafD, leafL, conical) {
  for (let y = 9; y < TILE; y++) px(ctx, 7 + (y > 12 ? 1 : 0), y, stem);
  const rows = conical
    ? [[7, 1], [6, 3], [5, 5], [6, 3], [4, 7], [5, 5]]
    : [[6, 3], [4, 7], [3, 9], [3, 9], [4, 7], [6, 3]];
  rows.forEach(([x0, w], i) => {
    for (let x = x0; x < x0 + w; x++) {
      if (rng() < 0.12) continue;
      const r = rng();
      px(ctx, x, 3 + i, r < 0.25 ? leafD : r > 0.8 ? leafL : leaf);
    }
  });
}
tile('oak_sapling', (ctx, rng) => sapling(ctx, rng, P.barkOak, P.leafOak, P.leafOakD, P.leafOakL, false));
tile('birch_sapling', (ctx, rng) => sapling(ctx, rng, P.birch, P.leafBirch, P.leafBirchD, P.leafBirchL, false));
tile('spruce_sapling', (ctx, rng) => sapling(ctx, rng, P.spruceBark, P.leafSpruce, P.leafSpruceD, P.leafSpruceL, true));

// --- chest: planks with dark trim and an iron latch on the front ---
function chestBase(ctx, rng) {
  planks(ctx, rng, P.woodOak);
  rect(ctx, 0, 0, TILE, 1, P.barkOakD);
  rect(ctx, 0, TILE - 1, TILE, 1, P.barkOakD);
  rect(ctx, 0, 0, 1, TILE, P.barkOakD);
  rect(ctx, TILE - 1, 0, 1, TILE, P.barkOakD);
}
tile('chest_top', (ctx, rng) => chestBase(ctx, rng));
tile('chest_side', (ctx, rng) => {
  chestBase(ctx, rng);
  rect(ctx, 1, 5, TILE - 2, 1, P.barkOakD);   // lid seam
});
tile('chest_front', (ctx, rng) => {
  generators['chest_side'](ctx, rng);
  rect(ctx, 6, 4, 4, 4, [70, 70, 74]);         // latch
  rect(ctx, 7, 5, 2, 2, [196, 196, 204]);
});

// --- bed: red blanket over a wooden frame, white pillow at the head ---
const BED_RED = [176, 38, 38], BED_RED_D = [140, 26, 28], BED_RED_L = [204, 64, 60];
tile('bed_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[BED_RED, 7], [BED_RED_D, 2], [BED_RED_L, 2]]);
  rect(ctx, 2, 1, 12, 4, [236, 234, 228]);     // pillow
  rect(ctx, 2, 4, 12, 1, [204, 200, 192]);
  rect(ctx, 0, 6, TILE, 1, BED_RED_D);         // blanket fold
});
tile('bed_side', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  fillNoiseRegion(ctx, rng, 0, 2, TILE, 7, [[BED_RED, 7], [BED_RED_D, 3]]);
  rect(ctx, 0, 2, 4, 3, [236, 234, 228]);      // pillow end
  rect(ctx, 0, 13, 2, 3, P.barkOakD);          // legs
  rect(ctx, TILE - 2, 13, 2, 3, P.barkOakD);
});
tile('bed_foot', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  fillNoiseRegion(ctx, rng, 0, 2, TILE, 7, [[BED_RED, 7], [BED_RED_D, 3]]);
  rect(ctx, 0, 13, 2, 3, P.barkOakD);
  rect(ctx, TILE - 2, 13, 2, 3, P.barkOakD);
});

// --- desert plants ---
tile('cactus', (ctx, rng) => {
  const g = [58, 128, 48], gD = [44, 102, 38], gL = [82, 150, 62];
  rect(ctx, 0, 0, TILE, TILE, g);
  for (let x = 0; x < TILE; x += 4) rect(ctx, x, 0, 1, TILE, gD); // ridges
  for (let x = 2; x < TILE; x += 4) rect(ctx, x, 0, 1, TILE, gL);
  for (let i = 0; i < 8; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, [230, 238, 210]); // spines
});

tile('cactus_top', (ctx, rng) => {
  rect(ctx, 0, 0, TILE, TILE, [44, 102, 38]);
  rect(ctx, 1, 1, 14, 14, [58, 128, 48]);
  rect(ctx, 4, 4, 8, 8, [72, 142, 56]);
  speckle(ctx, rng, [230, 238, 210], 5);
});

// --- cross plants (transparent background) ---
tile('tall_grass', (ctx, rng) => {
  for (let i = 0; i < 9; i++) {
    let x = 2 + ((rng() * 12) | 0);
    const h = 6 + ((rng() * 9) | 0);
    const col = rng() < 0.5 ? P.grass : P.grassD;
    for (let y = TILE - 1; y > TILE - h; y--) {
      px(ctx, x, y, col);
      if (rng() < 0.3) x += rng() < 0.5 ? 1 : -1;
    }
  }
});

function flower(ctx, rng, petal, center) {
  // stem
  let x = 8;
  for (let y = 15; y > 8; y--) {
    px(ctx, x, y, P.grassD);
    if (y === 12) { px(ctx, x - 1, y, P.grassD); px(ctx, x - 2, y - 1, P.grass); } // leaf
  }
  // head
  rect(ctx, 6, 4, 4, 4, petal);
  px(ctx, 5, 5, petal); px(ctx, 10, 5, petal);
  px(ctx, 7, 3, petal); px(ctx, 8, 3, petal);
  px(ctx, 7, 8, petal); px(ctx, 8, 8, petal);
  rect(ctx, 7, 5, 2, 2, center);
}

tile('dandelion', (ctx, rng) => flower(ctx, rng, [240, 214, 42], [200, 160, 30]));
tile('poppy', (ctx, rng) => flower(ctx, rng, [214, 48, 48], [40, 40, 40]));

tile('sugar_cane', (ctx, rng) => {
  for (const x of [3, 8, 12]) {
    const col = [126, 188, 106];
    for (let y = 0; y < TILE; y++) {
      px(ctx, x, y, y % 5 === 4 ? [96, 148, 82] : col);
      if (rng() < 0.3) px(ctx, x + 1, y, [148, 204, 124]);
    }
  }
});

tile('dead_bush', (ctx, rng) => {
  const c = [122, 90, 48];
  let branches = [[8, 15]];
  for (let step = 0; step < 10 && branches.length; step++) {
    const next = [];
    for (const [x, y] of branches) {
      px(ctx, x, y, c);
      if (y <= 4) continue;
      if (rng() < 0.35 && next.length < 5) next.push([x - 1, y - 1]);
      if (rng() < 0.35 && next.length < 5) next.push([x + 1, y - 1]);
      // the first branch always keeps growing, so a bush is never a lone pixel
      if (rng() < 0.8 || next.length === 0) next.push([x, y - 1]);
    }
    branches = next;
  }
});

// --- ores ---
function ore(ctx, rng, cols) {
  generators['stone'](ctx, rng);
  for (let i = 0; i < 5; i++) {
    blob(ctx, rng, 2 + ((rng() * 12) | 0), 2 + ((rng() * 12) | 0), 5, cols);
  }
}

tile('coal_ore', (ctx, rng) => ore(ctx, rng, [[40, 40, 44], [24, 24, 28], [58, 58, 62]]));
tile('iron_ore', (ctx, rng) => ore(ctx, rng, [[216, 176, 140], [196, 152, 116], [232, 198, 168]]));
tile('gold_ore', (ctx, rng) => ore(ctx, rng, [[248, 210, 70], [222, 180, 50], [255, 232, 120]]));
tile('diamond_ore', (ctx, rng) => ore(ctx, rng, [[96, 226, 222], [64, 196, 200], [160, 246, 240]]));
tile('redstone_ore', (ctx, rng) => ore(ctx, rng, [[212, 44, 32], [170, 30, 24], [244, 88, 70]]));

// --- special blocks ---
tile('glass', (ctx, rng) => {
  const edge = [214, 230, 236, 255];
  rect(ctx, 0, 0, TILE, 1, edge);
  rect(ctx, 0, TILE - 1, TILE, 1, edge);
  rect(ctx, 0, 0, 1, TILE, edge);
  rect(ctx, TILE - 1, 0, 1, TILE, edge);
  // faint diagonal streak
  for (let i = 0; i < 6; i++) px(ctx, 3 + i, 9 - i, [240, 250, 254, 120]);
  for (let i = 0; i < 4; i++) px(ctx, 9 + i, 13 - i, [240, 250, 254, 90]);
});

tile('glowstone', (ctx, rng) => {
  fillNoise(ctx, rng, [[[252, 218, 108], 6], [[240, 190, 70], 4], [[212, 150, 52], 3], [[255, 240, 170], 2]]);
});

tile('torch', (ctx, rng) => {
  rect(ctx, 7, 6, 2, 10, P.barkOak);       // stick
  rect(ctx, 7, 6, 1, 10, P.barkOakL);
  rect(ctx, 7, 4, 2, 2, [255, 232, 120]);  // flame
  rect(ctx, 7, 3, 2, 1, [255, 190, 60]);
  px(ctx, 7, 2, [255, 140, 40]);
});

// --- campfire: crossed logs (drawn as a cross sprite) with flames or ash ---
function campfireLogs(ctx) {
  rect(ctx, 1, 12, 14, 3, P.barkOak);
  rect(ctx, 1, 12, 14, 1, P.barkOakL);
  rect(ctx, 3, 14, 10, 2, P.barkOakD);
  rect(ctx, 6, 11, 4, 1, [70, 52, 32]);
}
tile('campfire', (ctx, rng) => {
  const flame = [[255, 200, 60], [255, 150, 40], [255, 236, 140]];
  for (let x = 3; x < 13; x++) {
    const h = 4 + ((rng() * 7) | 0) - Math.abs(x - 8);
    for (let y = 12 - h; y < 12; y++) px(ctx, x, y, flame[y > 9 ? 1 : (rng() * 3) | 0]);
  }
  rect(ctx, 6, 9, 4, 3, [255, 244, 190]);   // hot core
  campfireLogs(ctx);
});
tile('campfire_off', (ctx) => {
  campfireLogs(ctx);
  rect(ctx, 4, 11, 8, 1, [90, 90, 90]);     // ash
  px(ctx, 6, 10, [120, 120, 120]); px(ctx, 9, 10, [110, 110, 110]);
});

tile('crafting_table_top', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  rect(ctx, 0, 0, TILE, 1, P.barkOakD);
  rect(ctx, 0, TILE - 1, TILE, 1, P.barkOakD);
  rect(ctx, 0, 0, 1, TILE, P.barkOakD);
  rect(ctx, TILE - 1, 0, 1, TILE, P.barkOakD);
  rect(ctx, 3, 3, 10, 1, P.barkOakD);      // inset grid
  rect(ctx, 3, 12, 10, 1, P.barkOakD);
  rect(ctx, 3, 3, 1, 10, P.barkOakD);
  rect(ctx, 12, 3, 1, 10, P.barkOakD);
});

tile('crafting_table_side', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  rect(ctx, 0, 0, TILE, 2, shade(P.woodOak, 1.1));
  // implied tool shapes
  rect(ctx, 3, 5, 4, 4, P.barkOakD);
  rect(ctx, 9, 5, 4, 4, shade(P.barkOakD, 1.2));
});

tile('crafting_table_front', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  rect(ctx, 0, 0, TILE, 2, shade(P.woodOak, 1.1));
  rect(ctx, 4, 5, 8, 6, P.barkOakD);
  rect(ctx, 5, 6, 6, 4, P.woodOakD);
});

tile('furnace_top', (ctx, rng) => generators['stone'](ctx, rng));

tile('furnace_side', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.stoneD, 6], [P.stone, 4], [P.stoneDD, 2]]);
  rect(ctx, 0, 0, TILE, 1, P.stone);
  rect(ctx, 0, TILE - 1, TILE, 1, P.stoneDD);
});

tile('furnace_front', (ctx, rng) => {
  generators['furnace_side'](ctx, rng);
  rect(ctx, 4, 6, 8, 7, [40, 40, 40]);
  rect(ctx, 5, 7, 6, 5, [22, 22, 22]);
});

tile('furnace_front_lit', (ctx, rng) => {
  generators['furnace_side'](ctx, rng);
  rect(ctx, 4, 6, 8, 7, [60, 40, 30]);
  rect(ctx, 5, 7, 6, 5, [255, 140, 30]);
  rect(ctx, 6, 8, 4, 3, [255, 210, 80]);
  px(ctx, 6, 7, [255, 240, 160]); px(ctx, 9, 7, [255, 240, 160]);
});

tile('bricks', (ctx, rng) => {
  const mortar = [188, 180, 172];
  const brick = [168, 74, 58];
  rect(ctx, 0, 0, TILE, TILE, mortar);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    const off = row % 2 === 0 ? 0 : 4;
    for (let bx = -1; bx < 3; bx++) {
      const x = bx * 8 + off;
      const c = rng() < 0.3 ? shade(brick, 0.88) : brick;
      rect(ctx, x + 1, y + 1, 7, 3, c);
      rect(ctx, x + 1, y + 1, 7, 1, shade(c, 1.1));
    }
  }
});

tile('stone_bricks', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.stone, 7], [P.stoneL, 3], [P.stoneD, 2]]);
  const line = P.stoneDD;
  rect(ctx, 0, 7, TILE, 1, line);
  rect(ctx, 0, 15, TILE, 1, line);
  rect(ctx, 7, 0, 1, 8, line);
  rect(ctx, 3, 8, 1, 8, line);
  rect(ctx, 11, 8, 1, 8, line);
  rect(ctx, 0, 0, TILE, 1, shade(P.stoneL, 1.05));
});

tile('mossy_stone_bricks', (ctx, rng) => {
  generators['stone_bricks'](ctx, rng);
  for (let i = 0; i < 46; i++) {
    const x = (rng() * TILE) | 0, y = (rng() * TILE) | 0;
    // moss creeps along the mortar lines and the bottom of each brick
    if (y === 7 || y === 15 || y === 6 || y === 14 || rng() < 0.35) px(ctx, x, y, rng() < 0.5 ? [86, 120, 52] : [64, 96, 40]);
  }
});

tile('chiseled_sandstone', (ctx, rng) => {
  generators['sandstone_top'](ctx, rng);
  const d = P.sandD, l = P.sandL;
  rect(ctx, 0, 0, TILE, 2, d); rect(ctx, 0, TILE - 2, TILE, 2, d);
  rect(ctx, 0, 2, TILE, 1, l);
  // a carved face/glyph in the middle
  rect(ctx, 4, 5, 8, 6, shade(P.sand, 0.92));
  rect(ctx, 5, 6, 2, 1, d); rect(ctx, 9, 6, 2, 1, d);
  rect(ctx, 7, 7, 2, 2, d);
  rect(ctx, 5, 9, 6, 1, d);
  rect(ctx, 4, 11, 8, 1, l);
});

// monster spawner: a dark iron cage (gaps are see-through)
tile('spawner', (ctx, rng) => {
  const bar = [44, 50, 62], barL = [78, 88, 104], barD = [26, 30, 38];
  for (let i = 0; i < TILE; i += 5) {
    rect(ctx, i, 0, 2, TILE, bar);
    rect(ctx, 0, i, TILE, 2, bar);
    rect(ctx, i, 0, 1, TILE, barL);
  }
  rect(ctx, 0, 0, TILE, 1, barL); rect(ctx, 0, TILE - 1, TILE, 1, barD);
  rect(ctx, 0, 0, 1, TILE, barL); rect(ctx, TILE - 1, 0, 1, TILE, barD);
  for (let i = 0; i < 10; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, [180, 60, 40, 200]);
});

tile('obsidian', (ctx, rng) => {
  fillNoise(ctx, rng, [[[24, 18, 38], 7], [[16, 12, 26], 4], [[42, 30, 62], 3]]);
  speckle(ctx, rng, [96, 70, 140], 4);
});

tile('wool', (ctx, rng) => {
  fillNoise(ctx, rng, [[[228, 228, 222], 7], [[214, 214, 206], 4], [[240, 240, 236], 3]]);
  for (let y = 0; y < TILE; y += 4) {
    for (let x = 0; x < TILE; x += 4) {
      if ((x + y) % 8 === 0) rect(ctx, x, y, 2, 1, [202, 202, 194]);
    }
  }
});

// dyed wool, the same weave in each colour
function dyedWool(c) {
  return (ctx, rng) => {
    fillNoise(ctx, rng, [[c, 7], [shade(c, 0.93), 4], [shade(c, 1.06), 3]]);
    for (let y = 0; y < TILE; y += 4) for (let x = 0; x < TILE; x += 4) if ((x + y) % 8 === 0) rect(ctx, x, y, 2, 1, shade(c, 0.86));
  };
}
tile('red_wool', dyedWool([168, 48, 44]));
tile('yellow_wool', dyedWool([222, 188, 52]));
tile('orange_wool', dyedWool([220, 120, 38]));
tile('pink_wool', dyedWool([232, 148, 168]));
tile('green_wool', dyedWool([84, 116, 40]));
tile('brown_wool', dyedWool([108, 72, 42]));
tile('black_wool', dyedWool([34, 32, 32]));
tile('grey_wool', dyedWool([104, 104, 100]));
// dyes: a little heap of powder
tile('red_dye', (ctx, rng) => blobIcon(ctx, rng, [[168, 48, 44], shade([168, 48, 44], 0.8), shade([168, 48, 44], 1.15)]));
tile('yellow_dye', (ctx, rng) => blobIcon(ctx, rng, [[222, 188, 52], shade([222, 188, 52], 0.8), shade([222, 188, 52], 1.15)]));
tile('orange_dye', (ctx, rng) => blobIcon(ctx, rng, [[220, 120, 38], shade([220, 120, 38], 0.8), shade([220, 120, 38], 1.15)]));
tile('pink_dye', (ctx, rng) => blobIcon(ctx, rng, [[232, 148, 168], shade([232, 148, 168], 0.8), shade([232, 148, 168], 1.15)]));
tile('green_dye', (ctx, rng) => blobIcon(ctx, rng, [[84, 116, 40], shade([84, 116, 40], 0.8), shade([84, 116, 40], 1.15)]));
tile('brown_dye', (ctx, rng) => blobIcon(ctx, rng, [[108, 72, 42], shade([108, 72, 42], 0.8), shade([108, 72, 42], 1.15)]));
tile('black_dye', (ctx, rng) => blobIcon(ctx, rng, [[34, 32, 32], shade([34, 32, 32], 0.8), shade([34, 32, 32], 1.15)]));
tile('grey_dye', (ctx, rng) => blobIcon(ctx, rng, [[104, 104, 100], shade([104, 104, 100], 0.8), shade([104, 104, 100], 1.15)]));

tile('pumpkin_side', (ctx, rng) => {
  const o = [216, 128, 32], oD = [184, 102, 24], oL = [236, 152, 52];
  rect(ctx, 0, 0, TILE, TILE, o);
  for (let x = 1; x < TILE; x += 4) rect(ctx, x, 0, 1, TILE, oD);   // ribs
  for (let x = 3; x < TILE; x += 4) rect(ctx, x, 0, 1, TILE, oL);
  rect(ctx, 0, 0, TILE, 1, oD);
  rect(ctx, 0, TILE - 1, TILE, 1, oD);
});

tile('pumpkin_top', (ctx, rng) => {
  rect(ctx, 0, 0, TILE, TILE, [196, 112, 28]);
  rect(ctx, 1, 1, 14, 14, [216, 128, 32]);
  rect(ctx, 6, 6, 4, 4, [92, 118, 42]);    // stem
  rect(ctx, 7, 7, 2, 2, [72, 94, 34]);
});

tile('pumpkin_face', (ctx, rng) => {
  generators['pumpkin_side'](ctx, rng);
  const dark = [50, 30, 10];
  // carved eyes + mouth
  rect(ctx, 3, 5, 3, 2, dark); rect(ctx, 10, 5, 3, 2, dark);
  px(ctx, 4, 4, dark); px(ctx, 11, 4, dark);
  rect(ctx, 4, 10, 8, 2, dark);
  px(ctx, 3, 9, dark); px(ctx, 12, 9, dark); px(ctx, 7, 12, dark); px(ctx, 8, 12, dark);
});

tile('pumpkin_face_lit', (ctx, rng) => {
  generators['pumpkin_side'](ctx, rng);
  const glow = [255, 214, 90], hot = [255, 244, 170];
  rect(ctx, 3, 5, 3, 2, glow); rect(ctx, 10, 5, 3, 2, glow);
  px(ctx, 4, 4, glow); px(ctx, 11, 4, glow);
  rect(ctx, 4, 10, 8, 2, glow);
  px(ctx, 3, 9, glow); px(ctx, 12, 9, glow); px(ctx, 7, 12, glow); px(ctx, 8, 12, glow);
  px(ctx, 4, 5, hot); px(ctx, 11, 5, hot); rect(ctx, 6, 10, 4, 1, hot);
});

// --- storage blocks: bevelled tiles in the material's colours ---
function storageBlock(ctx, rng, base, light, dark) {
  fillNoise(ctx, rng, [[base, 7], [shade(base, 1.05), 2], [shade(base, 0.95), 2]]);
  rect(ctx, 0, 0, TILE, 1, light); rect(ctx, 0, 0, 1, TILE, light);
  rect(ctx, 0, TILE - 1, TILE, 1, dark); rect(ctx, TILE - 1, 0, 1, TILE, dark);
  rect(ctx, 3, 3, 10, 1, light); rect(ctx, 3, 3, 1, 10, light);
  rect(ctx, 3, 12, 10, 1, dark); rect(ctx, 12, 3, 1, 10, dark);
}
tile('iron_block', (ctx, rng) => storageBlock(ctx, rng, [210, 210, 214], [240, 240, 244], [150, 150, 158]));
tile('gold_block', (ctx, rng) => storageBlock(ctx, rng, [240, 200, 60], [255, 236, 130], [190, 146, 36]));
tile('diamond_block', (ctx, rng) => storageBlock(ctx, rng, [100, 222, 214], [176, 250, 244], [52, 166, 168]));
tile('coal_block', (ctx, rng) => storageBlock(ctx, rng, [34, 34, 38], [64, 64, 70], [16, 16, 18]));

// --- bookshelf: two rows of coloured spines between plank shelves ---
tile('bookshelf', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  const spines = [[150, 40, 36], [44, 76, 140], [52, 112, 54], [170, 130, 50], [96, 52, 120], [120, 84, 52]];
  for (const y0 of [2, 9]) {
    rect(ctx, 0, y0, TILE, 5, [40, 28, 16]);
    for (let x = 1; x < TILE - 1; x += 2) {
      const h = 4 + ((rng() * 2) | 0) - 1;
      rect(ctx, x, y0 + 5 - h, 2, h, spines[(rng() * spines.length) | 0]);
      px(ctx, x, y0 + 5 - h, shade(spines[0], 1.3));
    }
  }
});

function mushroom(ctx, rng, cap, capD) {
  rect(ctx, 7, 9, 2, 6, [222, 214, 196]);  // stem
  rect(ctx, 5, 5, 6, 3, cap);              // cap
  rect(ctx, 4, 6, 8, 2, cap);
  rect(ctx, 6, 4, 4, 1, capD);
  px(ctx, 6, 6, capD); px(ctx, 9, 5, capD);
}

tile('mushroom_brown', (ctx, rng) => mushroom(ctx, rng, [150, 112, 82], [124, 90, 64]));
tile('mushroom_red', (ctx, rng) => {
  mushroom(ctx, rng, [200, 46, 40], [160, 34, 30]);
  px(ctx, 6, 5, [240, 236, 228]); px(ctx, 9, 6, [240, 236, 228]);
});

// ---------- item icons ----------

tile('stick', (ctx) => {
  for (let i = 0; i < 9; i++) {
    px(ctx, 4 + i, 12 - i, P.barkOak);
    px(ctx, 5 + i, 12 - i, P.barkOakL);
  }
});

tile('coal', (ctx, rng) => {
  blobIcon(ctx, rng, [[36, 36, 40], [22, 22, 26], [52, 52, 58]]);
});

tile('clay_ball', (ctx, rng) => {
  blobIcon(ctx, rng, [[160, 166, 180], [144, 150, 166], [176, 182, 194]]);
});

function blobIcon(ctx, rng, cols) {
  for (let i = 0; i < 26; i++) {
    const x = 5 + ((rng() * 6) | 0);
    const y = 5 + ((rng() * 6) | 0);
    px(ctx, x, y, cols[(rng() * cols.length) | 0]);
  }
  rect(ctx, 6, 6, 4, 4, cols[0]);
}

function ingot(ctx, base, light, dark) {
  // slanted bar
  for (let i = 0; i < 4; i++) {
    rect(ctx, 3 + i, 10 - i, 8, 1, base);
  }
  rect(ctx, 3, 10, 8, 2, dark);
  rect(ctx, 6, 7, 8, 1, light);
  for (let i = 0; i < 3; i++) px(ctx, 13, 8 + i, dark);
}

tile('iron_ingot', (ctx) => ingot(ctx, [216, 216, 220], [240, 240, 244], [168, 168, 176]));
tile('gold_ingot', (ctx) => ingot(ctx, [244, 200, 60], [255, 236, 130], [196, 150, 36]));

tile('diamond', (ctx) => {
  const c = [92, 226, 220], l = [180, 250, 246], d = [52, 172, 176];
  rect(ctx, 5, 5, 6, 2, l);
  rect(ctx, 4, 7, 8, 2, c);
  rect(ctx, 5, 9, 6, 1, c);
  rect(ctx, 6, 10, 4, 1, d);
  rect(ctx, 7, 11, 2, 1, d);
  px(ctx, 5, 6, [230, 255, 253]);
});

tile('redstone_dust', (ctx, rng) => {
  for (let i = 0; i < 30; i++) {
    const x = 3 + ((rng() * 10) | 0);
    const y = 8 + ((rng() * 6) | 0) - (((x - 8) * (x - 8)) >> 3);
    px(ctx, x, y, rng() < 0.5 ? [212, 44, 32] : [170, 28, 22]);
  }
});

function meat(ctx, rng, flesh, fleshD, edge) {
  rect(ctx, 4, 4, 8, 8, flesh);
  rect(ctx, 5, 3, 6, 1, flesh);
  rect(ctx, 5, 12, 6, 1, flesh);
  rect(ctx, 4, 4, 1, 8, edge);
  rect(ctx, 11, 4, 1, 8, edge);
  speckle(ctx, rng, fleshD, 6);
  // bone
  rect(ctx, 11, 10, 3, 2, [240, 236, 224]);
}

tile('porkchop_raw', (ctx, rng) => meat(ctx, rng, [238, 140, 140], [216, 110, 110], [246, 190, 180]));
tile('porkchop_cooked', (ctx, rng) => meat(ctx, rng, [180, 112, 60], [150, 88, 44], [214, 152, 96]));
tile('mutton_raw', (ctx, rng) => meat(ctx, rng, [210, 90, 90], [180, 66, 66], [232, 150, 140]));
tile('mutton_cooked', (ctx, rng) => meat(ctx, rng, [160, 96, 48], [132, 74, 36], [196, 134, 82]));

tile('apple', (ctx) => {
  const r = [212, 50, 44], rD = [170, 34, 30], rL = [238, 96, 84];
  rect(ctx, 5, 6, 6, 6, r);
  rect(ctx, 4, 7, 8, 4, r);
  px(ctx, 6, 7, rL); px(ctx, 6, 8, rL);
  rect(ctx, 6, 12, 4, 1, rD);
  px(ctx, 8, 5, P.barkOak); px(ctx, 8, 4, P.barkOak);
  px(ctx, 9, 4, P.grassD); px(ctx, 10, 3, P.grassD);
});

tile('rotten_flesh', (ctx, rng) => {
  fillNoiseRegion(ctx, rng, 4, 5, 9, 7, [[[142, 108, 62], 5], [[104, 122, 62], 4], [[88, 66, 44], 3]]);
  px(ctx, 6, 7, [70, 90, 46]); px(ctx, 10, 9, [70, 90, 46]);
});

function fillNoiseRegion(ctx, rng, x0, y0, w, h, colors) {
  let total = 0;
  for (const [, wt] of colors) total += wt;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let r = rng() * total;
      for (const [col, wt] of colors) {
        r -= wt;
        if (r <= 0) { px(ctx, x, y, col); break; }
      }
    }
  }
}

tile('brick_item', (ctx) => {
  rect(ctx, 4, 6, 8, 5, [168, 74, 58]);
  rect(ctx, 4, 6, 8, 1, [196, 96, 76]);
  rect(ctx, 4, 10, 8, 1, [136, 56, 44]);
});

// --- tools: pixel maps. H=handle, h=handle shade, M=material, m=material shade ---

const TOOL_MAPS = {
  pickaxe: [
    '....mMMMMMm.....',
    '...MM.....MMm...',
    '..Mm...HH...Mm..',
    '..M...Hh.M...M..',
    '.....Hh...m..m..',
    '....Hh..........',
    '...Hh...........',
    '..Hh............',
    '.Hh.............',
    'Hh..............',
  ],
  axe: [
    '....mMMm........',
    '...MMMMMm.......',
    '...MMhHMM.......',
    '...mMHh.m.......',
    '....Hh..........',
    '...Hh...........',
    '..Hh............',
    '.Hh.............',
    'Hh..............',
  ],
  shovel: [
    '......mMMm......',
    '.....MMMMM......',
    '.....mMMMm......',
    '......mHm.......',
    '.....Hh.........',
    '....Hh..........',
    '...Hh...........',
    '..Hh............',
    '.Hh.............',
  ],
  sword: [
    '..........mM....',
    '.........MMm....',
    '........MMm.....',
    '.......MMm......',
    '......MMm.......',
    '.....MMm........',
    '.hh.MMm.........',
    '..hHhm..........',
    '..Hhh...........',
    '.Hh.hh..........',
  ],
};

TOOL_MAPS.spear = [
  '............mM..',
  '...........MMMm.',
  '...........MMm..',
  '..........hm....',
  '.........Hh.....',
  '........Hh......',
  '.......Hh.......',
  '......Hh........',
  '.....Hh.........',
  '....Hh..........',
  '...Hh...........',
  '..Hh............',
];

TOOL_MAPS.hoe = [
  '....mMMMm.......',
  '...MMm.Hh.......',
  '......Hh........',
  '.....Hh.........',
  '....Hh..........',
  '...Hh...........',
  '..Hh............',
  '.Hh.............',
  'Hh..............',
];

const TOOL_MATERIALS = {
  wood: { M: [158, 122, 74], m: [122, 94, 56] },
  stone: { M: [136, 136, 136], m: [100, 100, 100] },
  iron: { M: [222, 222, 228], m: [170, 170, 180] },
  gold: { M: [246, 204, 62], m: [200, 156, 40] },
  diamond: { M: [96, 226, 220], m: [56, 178, 180] },
};

for (const mat of Object.keys(TOOL_MATERIALS)) {
  for (const cls of Object.keys(TOOL_MAPS)) {
    tile(`${mat}_${cls}`, (ctx) => {
      const cols = {
        H: [122, 94, 56], h: [94, 72, 42],
        M: TOOL_MATERIALS[mat].M, m: TOOL_MATERIALS[mat].m,
      };
      const map = TOOL_MAPS[cls];
      const yOff = 16 - map.length - 1;
      for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
          const ch = map[y][x];
          if (cols[ch]) px(ctx, x, y + yOff, cols[ch]);
        }
      }
    });
  }
}

// the Ancient Blade: a temple-only sword, dark glassy blade on a gilded hilt
tile('ancient_sword', (ctx) => {
  const cols = { H: [246, 204, 62], h: [190, 146, 36], M: [150, 92, 220], m: [92, 52, 150] };
  const map = TOOL_MAPS.sword;
  const yOff = 16 - map.length - 1;
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (cols[ch]) px(ctx, x, y + yOff, cols[ch]); }));
  px(ctx, 11, yOff, [226, 196, 255]); px(ctx, 10, yOff + 1, [226, 196, 255]);
});

// the Ember Blade: a blackened blade with a glowing edge, on a scaled hilt
tile('ember_blade', (ctx) => {
  const cols = { H: [150, 40, 30], h: [92, 22, 18], M: [44, 36, 40], m: [255, 120, 40] };
  const map = TOOL_MAPS.sword;
  const yOff = 16 - map.length - 1;
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (cols[ch]) px(ctx, x, y + yOff, cols[ch]); }));
  px(ctx, 11, yOff, [255, 220, 140]); px(ctx, 10, yOff + 1, [255, 200, 100]);
});
// a dragon's scale: a dark red plate with a bright rim; its fang, long and ivory
tile('dragon_scale', (ctx) => {
  const c = [150, 40, 30], d = [92, 22, 18], l = [236, 120, 52];
  for (let y = 3; y < 13; y++) { const w = y < 8 ? y - 2 : 13 - y + 4; rect(ctx, 8 - (w >> 1), y, w, 1, y < 5 ? l : c); }
  for (let y = 6; y < 12; y++) px(ctx, 8, y, d);
  px(ctx, 6, 9, d); px(ctx, 10, 9, d);
});
// a drake's egg: speckled, warm red-black, a crack of light down one side
tile('drake_egg', (ctx, rng) => {
  const shell = [70, 30, 26], dark = [40, 18, 16], hot = [255, 140, 50];
  for (let y = 3; y < 14; y++) { const w = Math.round(Math.sqrt(1 - ((y - 9) / 6.5) ** 2) * 9) - (y < 7 ? 2 - ((y - 3) >> 1) : 0); rect(ctx, 8 - (w >> 1), y, w, 1, shell); }
  for (let i = 0; i < 9; i++) px(ctx, 5 + ((rng() * 6) | 0), 5 + ((rng() * 8) | 0), dark);
  px(ctx, 9, 6, hot); px(ctx, 10, 7, hot); px(ctx, 9, 8, hot); px(ctx, 10, 9, [255, 200, 120]);
  px(ctx, 6, 5, [120, 60, 50]);
});
tile('dragon_fang', (ctx) => {
  const ivory = [238, 228, 200], shadow = [190, 176, 146], root = [120, 40, 30];
  for (let i = 0; i < 10; i++) { rect(ctx, 4 + i, 2 + i, 3 - (i >> 2) || 1, 1, i > 6 ? shadow : ivory); }
  rect(ctx, 3, 1, 3, 2, root);
});
tile('shears', (ctx) => {
  const map = [
    '..........b.....',
    '.........bB.....',
    '........bB......',
    '.......bB..b....',
    '......bB..bB....',
    '.....bBk.bB.....',
    '......kkbB......',
    '.....GGkk.......',
    '....G..GG.......',
    '...G...G.G......',
    '...G..G...G.....',
    '....GG....G.....',
    '..........G.....',
    '.......GGG......',
  ];
  const cols = { b: [150, 150, 160], B: [222, 222, 228], k: [90, 90, 96], G: [190, 60, 50] };
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (cols[ch]) px(ctx, x, y + 1, cols[ch]); }));
});

// buckets: B = metal, d = shade, f = contents
function bucket(ctx, fill) {
  const map = [
    '..BBBBBBBBBBBB..',
    '.B............B.',
    '.BffffffffffffB.',
    '..BddffffffddB..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBdB..',
    '...BBBBBBBBdB...',
    '...BBBBBBBBdB...',
    '....BBBBBBdB....',
    '....BBBBBBBB....',
  ];
  const cols = { B: [200, 200, 206], d: [140, 140, 150], f: fill };
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = ch === 'f' && !fill ? null : cols[ch];
    if (c) px(ctx, x, y + 4, ch === 'd' && fill && y === 3 ? shade(fill, 0.8) : c);
  }));
  // the handle
  for (let x = 2; x < 14; x++) px(ctx, x, 4 - Math.round(Math.sin(((x - 2) / 11) * Math.PI) * 3), [120, 120, 128]);
}
tile('bucket', (ctx) => bucket(ctx, null));
// a stoppered glass bottle of amber oil
tile('whale_oil', (ctx) => {
  const glass = [200, 220, 228], glassD = [150, 172, 184], oil = [214, 150, 48], oilL = [244, 196, 92], cork = [150, 108, 66];
  rect(ctx, 6, 1, 4, 2, cork);
  rect(ctx, 6, 3, 4, 2, glass);
  rect(ctx, 4, 5, 8, 10, glass);
  rect(ctx, 5, 7, 6, 7, oil);
  rect(ctx, 5, 7, 2, 5, oilL);
  rect(ctx, 4, 5, 1, 10, glassD); rect(ctx, 11, 5, 1, 10, glassD); rect(ctx, 4, 14, 8, 1, glassD);
});
// lantern: iron frame and cap round a glowing pane (also its icon)
tile('lantern', (ctx) => {
  // laid out to match the block's boxes: body x 5-10 (bottom 7 rows), cap x 6-9 above it
  const iron = [62, 62, 72], ironL = [104, 104, 116], glow = [255, 214, 120], glowL = [255, 240, 190];
  rect(ctx, 7, 0, 2, 7, [80, 80, 90]);            // chain
  rect(ctx, 6, 7, 4, 2, iron); rect(ctx, 6, 7, 4, 1, ironL);   // cap
  rect(ctx, 5, 9, 6, 7, iron);                     // body frame
  rect(ctx, 6, 10, 4, 5, glow);
  rect(ctx, 7, 11, 2, 3, glowL);
});
tile('water_bucket', (ctx) => bucket(ctx, [52, 104, 220]));
tile('lava_bucket', (ctx) => bucket(ctx, [240, 120, 30]));
tile('milk_bucket', (ctx) => bucket(ctx, [244, 244, 240]));
tile('snowball', (ctx, rng) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 8.5;
    if (dx * dx + dy * dy > 20) continue;
    px(ctx, x, y, dx + dy < -2 ? P.snowL : dx + dy > 3 ? P.snowD : P.snow);
  }
});
tile('dried_kelp', (ctx) => {
  const d = [40, 52, 30], m = [60, 76, 40], l = [84, 100, 54];
  for (let i = 0; i < 9; i++) { rect(ctx, 3 + i, 11 - i, 3, 2, i % 2 ? m : d); px(ctx, 3 + i, 11 - i, l); }
});

tile('fire', (ctx, rng) => {
  for (let x = 0; x < 16; x++) {
    const h = 7 + Math.round(Math.abs(Math.sin(x * 1.3)) * 6 + rng() * 3);
    for (let y = 0; y < h; y++) {
      const k = y / h;
      px(ctx, x, 15 - y, k < 0.35 ? [255, 236, 140] : k < 0.7 ? [255, 160, 40] : [222, 72, 20]);
    }
  }
});
tile('flint_and_steel', (ctx) => {
  // a C-shaped steel striker and a dark wedge of flint
  const map = [
    '..SSSS..........',
    '.Sd..dS.........',
    'Sd....dS........',
    'S......S........',
    'S...............',
    'Sd..............',
    '.SdddS..........',
    '..SSS...FFF.....',
    '.......FFFFF....',
    '......FFfFFFF...',
    '......FFFFFFF...',
    '.......FFFFf....',
    '........FFF.....',
  ];
  const cols = { S: [206, 206, 214], d: [140, 140, 150], F: [70, 70, 76], f: [110, 110, 118] };
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (cols[ch]) px(ctx, x + 2, y + 2, cols[ch]); }));
});
tile('egg', (ctx) => {
  const c = [232, 216, 180], d = [204, 184, 146], l = [248, 240, 220];
  for (let y = 3; y < 14; y++) {
    const w = Math.round(Math.sqrt(1 - ((y - 8.5) / 5.5) ** 2) * (y < 8 ? 3.2 : 4));
    rect(ctx, 8 - w, y, w * 2, 1, c);
    px(ctx, 8 + w - 1, y, d);
  }
  px(ctx, 6, 6, l); px(ctx, 6, 7, l);
});
tile('sugar', (ctx, rng) => {
  for (let i = 0; i < 40; i++) {
    const x = 4 + ((rng() * 8) | 0), y = 6 + ((rng() * 7) | 0);
    px(ctx, x, y, rng() < 0.3 ? [214, 214, 222] : [246, 246, 250]);
  }
});
tile('pumpkin_pie', (ctx) => {
  rect(ctx, 2, 7, 12, 5, [196, 140, 70]);
  rect(ctx, 3, 6, 10, 2, [214, 120, 40]);
  rect(ctx, 2, 11, 12, 1, [150, 100, 50]);
  for (let x = 3; x < 13; x += 2) px(ctx, x, 7, [236, 160, 70]);
});
tile('fishing_rod', (ctx) => {
  for (let i = 0; i < 12; i++) px(ctx, 2 + i, 14 - i, i < 4 ? [94, 72, 42] : [122, 94, 56]);
  for (let y = 3; y < 13; y++) px(ctx, 14, y, [220, 220, 220]);
  rect(ctx, 13, 12, 2, 2, [200, 50, 40]);
});
tile('oak_sign_item', (ctx) => {
  const w = P.woodOak, d = P.woodOakD, l = P.woodOakL;
  rect(ctx, 1, 2, 14, 8, w); rect(ctx, 1, 2, 14, 1, l); rect(ctx, 1, 9, 14, 1, d);
  for (const y of [4, 6]) rect(ctx, 3, y, 10, 1, d);
  rect(ctx, 7, 10, 2, 6, P.barkOak);
});
tile('bone_block', (ctx, rng) => {
  fillNoise(ctx, rng, [[[226, 222, 204], 6], [[212, 206, 186], 3], [[238, 236, 222], 2]]);
  for (let x = 0; x < 16; x += 4) rect(ctx, x, 0, 1, 16, [196, 190, 168]);
});
tile('bone_block_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[226, 222, 204], 6], [[212, 206, 186], 3]]);
  rect(ctx, 5, 5, 6, 6, [196, 190, 168]); rect(ctx, 6, 6, 4, 4, [176, 168, 140]);
});
tile('oak_gate_item', (ctx) => {
  const w = P.woodOak, d = P.woodOakD, l = P.woodOakL;
  rect(ctx, 1, 2, 3, 13, w); rect(ctx, 12, 2, 3, 13, w);
  rect(ctx, 1, 2, 1, 13, l); rect(ctx, 12, 2, 1, 13, l);
  rect(ctx, 4, 5, 8, 2, w); rect(ctx, 4, 10, 8, 2, w); rect(ctx, 4, 6, 8, 1, d); rect(ctx, 4, 11, 8, 1, d);
  rect(ctx, 7, 7, 2, 3, w);
});

tile('golden_apple', (ctx) => {
  const g = [246, 204, 62], gD = [196, 150, 36], gL = [255, 240, 150];
  rect(ctx, 5, 6, 6, 6, g);
  rect(ctx, 4, 7, 8, 4, g);
  px(ctx, 6, 7, gL); px(ctx, 6, 8, gL); px(ctx, 7, 7, gL);
  rect(ctx, 6, 12, 4, 1, gD);
  px(ctx, 10, 9, gD); px(ctx, 10, 10, gD);
  px(ctx, 8, 5, P.barkOak); px(ctx, 8, 4, P.barkOak);
  px(ctx, 9, 4, P.grassD); px(ctx, 10, 3, P.grassD);
});

// --- armour: M=material, m=shade, L=highlight ---
const ARMOR_MAPS = {
  helmet: [
    '................',
    '................',
    '....mMMMMMMm....',
    '...mMLLMMMMMm...',
    '...MML....MMM...',
    '...MM......MM...',
    '...mm......mm...',
  ],
  chestplate: [
    '..mMm......mMm..',
    '..MMMm....mMMM..',
    '..MMLMMMMMMMMM..',
    '...mMLMMMMMMm...',
    '....MLMMMMMM....',
    '....MMMMMMMM....',
    '....MMMMMMMM....',
    '....mMMMMMMm....',
    '....mmmmmmmm....',
  ],
  leggings: [
    '....mMMMMMMm....',
    '....MLMMMMMM....',
    '....MLMmmMMM....',
    '....MLM..MMM....',
    '....MLM..MMM....',
    '....MMM..MMM....',
    '....MMm..mMM....',
    '....mmm..mmm....',
  ],
  // a horse's barding, side on
  horse_armor: [
    '...........mMm..',
    '..........mMLMm.',
    '...mMMMMMMMMLMm.',
    '..mMLLLLLLLLMMm.',
    '..MMMMMMMMMMMm..',
    '..MMMMMMMMMMm...',
    '..mMMMMMMMMm....',
    '...mm....mm.....',
  ],
  boots: [
    '................',
    '...mMm....mMm...',
    '...MLM....MLM...',
    '...MLM....MLM...',
    '..mMMM...mMMM...',
    '..MMMMm..MMMMm..',
    '..mmmmm..mmmmm..',
  ],
};
const ARMOR_MATERIALS = {
  leather: { M: [150, 96, 54], m: [112, 68, 36], L: [184, 128, 80] },
  iron: { M: [214, 214, 220], m: [158, 158, 168], L: [244, 244, 248] },
  gold: { M: [240, 196, 58], m: [190, 146, 36], L: [255, 236, 130] },
  diamond: { M: [92, 220, 214], m: [52, 170, 172], L: [176, 250, 244] },
  dragon: { M: [150, 40, 30], m: [92, 22, 18], L: [236, 120, 52] },
};
for (const mat of Object.keys(ARMOR_MATERIALS)) {
  for (const piece of Object.keys(ARMOR_MAPS)) {
    tile(`${mat}_${piece}`, (ctx) => {
      const map = ARMOR_MAPS[piece];
      const yOff = Math.floor((16 - map.length) / 2);
      map.forEach((row, y) => [...row].forEach((ch, x) => {
        const col = ARMOR_MATERIALS[mat][ch];
        if (col) px(ctx, x, y + yOff, col);
      }));
    });
  }
}

// --- farming ---
tile('farmland_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[P.dirtD, 5], [P.dirt, 3], [[92, 64, 38], 2]]);
  for (let y = 1; y < TILE; y += 4) rect(ctx, 0, y, TILE, 1, [74, 50, 28]);   // furrows
  for (let y = 2; y < TILE; y += 4) rect(ctx, 0, y, TILE, 1, shade(P.dirt, 1.12));
});
const WHEAT_GREEN = [[76, 150, 52], [96, 172, 64], [60, 124, 40]];
const WHEAT_GOLD = [[204, 172, 72], [226, 196, 96], [172, 140, 52]];
for (let stage = 0; stage < 4; stage++) {
  tile(`wheat_stage_${stage}`, (ctx, rng) => {
    const height = 4 + stage * 4;          // stalks get taller
    const cols = stage === 3 ? WHEAT_GOLD : WHEAT_GREEN;
    for (const x of [1, 4, 7, 10, 13]) {
      const h = height - ((rng() * 3) | 0);
      for (let y = TILE - h; y < TILE; y++) px(ctx, x + (y % 3 === 0 ? 1 : 0), y, cols[(rng() * 3) | 0]);
      if (stage >= 2) {                     // seed heads
        const top = TILE - h;
        rect(ctx, x, top, 2, 3, stage === 3 ? [214, 180, 80] : [140, 170, 70]);
        px(ctx, x + 1, top + 1, stage === 3 ? [240, 214, 120] : [160, 190, 90]);
      }
    }
  });
}
tile('wheat_seeds', (ctx, rng) => {
  for (let i = 0; i < 9; i++) {
    const x = 4 + ((rng() * 8) | 0), y = 5 + ((rng() * 7) | 0);
    px(ctx, x, y, [108, 150, 58]);
    px(ctx, x + 1, y, [80, 120, 44]);
  }
});
tile('wheat', (ctx, rng) => {
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 10; k++) px(ctx, 3 + i * 2 + (k > 6 ? 1 : 0), 14 - k, [196, 164, 70]);
    rect(ctx, 3 + i * 2, 2, 2, 4, WHEAT_GOLD[i % 3]);
  }
  rect(ctx, 3, 10, 8, 1, [150, 110, 50]);   // binding
});
tile('bread', (ctx) => {
  rect(ctx, 2, 6, 12, 6, [176, 112, 48]);
  rect(ctx, 3, 5, 10, 1, [196, 134, 64]);
  rect(ctx, 2, 11, 12, 1, [138, 84, 34]);
  for (const x of [4, 7, 10]) rect(ctx, x, 6, 1, 3, [226, 180, 110]);   // scored top
});
tile('bone', (ctx) => {
  for (let i = 0; i < 8; i++) { px(ctx, 4 + i, 11 - i, [232, 228, 214]); px(ctx, 5 + i, 11 - i, [204, 198, 180]); }
  rect(ctx, 2, 11, 3, 2, [232, 228, 214]); rect(ctx, 3, 12, 2, 2, [214, 208, 192]);
  rect(ctx, 11, 2, 3, 2, [232, 228, 214]); rect(ctx, 12, 3, 2, 2, [214, 208, 192]);
});
tile('bone_meal', (ctx, rng) => blobIcon(ctx, rng, [[236, 234, 226], [214, 210, 198], [250, 250, 246]]));
tile('string', (ctx) => {
  for (let i = 0; i < 12; i++) px(ctx, 2 + i, 8 + Math.round(Math.sin(i * 0.9) * 3), [236, 236, 236]);
});
tile('gunpowder', (ctx, rng) => blobIcon(ctx, rng, [[86, 86, 86], [60, 60, 60], [116, 116, 116]]));

// --- bow, arrows, animal drops ---
tile('bow', (ctx) => {
  const wood = [122, 86, 50], woodD = [92, 62, 34], str = [224, 224, 224];
  const arc = [[11, 1], [9, 2], [7, 3], [6, 4], [5, 5], [4, 6], [3, 7], [2, 9], [1, 11]];
  for (const [x, y] of arc) { px(ctx, x + 2, y + 2, wood); px(ctx, x + 3, y + 2, woodD); }
  for (let i = 0; i < 11; i++) px(ctx, 13 - i, 3 + i, str);   // string
});
tile('arrow', (ctx) => {
  for (let i = 0; i < 9; i++) px(ctx, 3 + i, 12 - i, [122, 94, 56]);
  rect(ctx, 11, 2, 3, 2, [150, 150, 156]); px(ctx, 12, 4, [150, 150, 156]); px(ctx, 13, 1, [190, 190, 196]);  // head
  px(ctx, 2, 12, [236, 236, 236]); px(ctx, 3, 13, [236, 236, 236]); px(ctx, 2, 13, [210, 210, 210]);  // fletching
  px(ctx, 4, 13, [210, 210, 210]); px(ctx, 2, 11, [210, 210, 210]);
});
tile('flint', (ctx, rng) => blobIcon(ctx, rng, [[52, 52, 58], [36, 36, 40], [86, 86, 96]]));
tile('feather', (ctx) => {
  for (let i = 0; i < 10; i++) {
    px(ctx, 4 + i, 13 - i, [200, 200, 204]);
    if (i > 1 && i < 9) { px(ctx, 5 + i, 13 - i, [244, 244, 246]); px(ctx, 4 + i, 12 - i, [244, 244, 246]); }
  }
});
tile('leather', (ctx, rng) => {
  fillNoiseRegion(ctx, rng, 3, 3, 10, 10, [[[150, 96, 54], 5], [[128, 80, 42], 3], [[170, 112, 66], 2]]);
});
tile('beef_raw', (ctx, rng) => meat(ctx, rng, [200, 56, 52], [170, 40, 38], [232, 150, 140]));
tile('beef_cooked', (ctx, rng) => meat(ctx, rng, [120, 72, 40], [92, 52, 28], [160, 108, 66]));
function drumstick(ctx, meatC, meatD) {
  rect(ctx, 5, 3, 7, 7, meatC); rect(ctx, 6, 2, 5, 1, meatC); rect(ctx, 5, 9, 6, 1, meatD);
  for (let i = 0; i < 4; i++) px(ctx, 5 - i, 10 + i, [236, 230, 214]);   // bone
  rect(ctx, 1, 13, 2, 2, [236, 230, 214]);
}
tile('chicken_raw', (ctx) => drumstick(ctx, [236, 190, 170], [210, 160, 140]));
tile('chicken_cooked', (ctx) => drumstick(ctx, [196, 128, 60], [160, 96, 40]));
tile('duck_raw', (ctx) => drumstick(ctx, [214, 140, 128], [176, 104, 96]));
tile('duck_cooked', (ctx) => drumstick(ctx, [150, 82, 36], [112, 58, 24]));
// a name tag: a pale card with a punched hole and a loop of string
tile('name_tag', (ctx) => {
  const card = [232, 220, 190], edge = [180, 164, 128], ink = [90, 80, 70];
  rect(ctx, 4, 6, 9, 6, card); rect(ctx, 5, 5, 7, 8, card);
  rect(ctx, 4, 12, 9, 1, edge); rect(ctx, 13, 6, 1, 6, edge);
  px(ctx, 6, 8, [120, 100, 80]);   // the hole
  rect(ctx, 8, 8, 3, 1, ink); rect(ctx, 8, 10, 4, 1, ink);
  for (const [x, y] of [[5, 7], [4, 6], [3, 5], [3, 4], [4, 3], [5, 3]]) px(ctx, x, y, [200, 200, 200]);
});
tile('lead', (ctx) => {
  const R = [168, 128, 76], D = [120, 88, 50];
  for (let a = 0; a < 26; a++) { const t = a / 26 * Math.PI * 2; px(ctx, Math.round(8 + Math.cos(t) * 4), Math.round(6 + Math.sin(t) * 3), a % 3 ? R : D); }   // the loop
  for (let i = 0; i < 6; i++) px(ctx, 10 + (i >> 1), 9 + i, i % 2 ? D : R);                                                // the tail
  rect(ctx, 11, 8, 2, 2, [190, 190, 196]);                                                                                    // the clip
});
tile('whistle', (ctx) => {
  const m = [176, 180, 188], d = [120, 124, 132], l = [222, 226, 232];
  rect(ctx, 3, 7, 9, 4, m); rect(ctx, 3, 7, 9, 1, l); rect(ctx, 3, 10, 9, 1, d);
  rect(ctx, 8, 5, 5, 3, m); rect(ctx, 8, 5, 5, 1, l);   // the mouthpiece
  rect(ctx, 5, 8, 2, 1, [40, 40, 44]);                  // the slot
  for (let i = 0; i < 4; i++) px(ctx, 2 - (i >> 1), 11 + i, [150, 110, 60]);   // a cord
});
tile('goat_horn', (ctx) => {
  const H = [200, 188, 160], D = [150, 136, 110], L = [228, 220, 198];
  for (let i = 0; i < 10; i++) { const w = 1 + (i >> 2); rect(ctx, 3 + i, 11 - Math.round(i * 0.7) - w + 1, 1, w + 1, i % 3 ? H : D); }
  px(ctx, 4, 11, L); px(ctx, 7, 8, L); rect(ctx, 12, 2, 2, 4, D); px(ctx, 13, 2, L);
});
tile('saddle', (ctx) => {
  const L = [140, 84, 44], D = [100, 58, 30], H = [176, 116, 66], M = [180, 180, 186];
  rect(ctx, 3, 5, 10, 4, L); rect(ctx, 2, 6, 1, 3, D); rect(ctx, 13, 6, 1, 3, D);   // seat
  rect(ctx, 3, 4, 3, 1, L); rect(ctx, 11, 3, 2, 2, L);                              // cantle, pommel
  rect(ctx, 4, 6, 8, 1, H); rect(ctx, 3, 9, 10, 1, D);
  rect(ctx, 5, 10, 1, 3, D); rect(ctx, 10, 10, 1, 3, D);                            // straps
  rect(ctx, 4, 13, 3, 1, M); rect(ctx, 9, 13, 3, 1, M);                              // stirrups
});
function fishIcon(ctx, body, belly, fin) {
  rect(ctx, 3, 6, 8, 4, body); rect(ctx, 4, 5, 6, 1, body); rect(ctx, 4, 10, 6, 1, belly);
  rect(ctx, 11, 5, 2, 6, fin); px(ctx, 13, 4, fin); px(ctx, 13, 11, fin);   // tail
  px(ctx, 5, 7, [20, 20, 20]);   // eye
}
tile('fish_raw', (ctx) => fishIcon(ctx, [112, 140, 168], [200, 210, 220], [88, 112, 140]));
tile('fish_cooked', (ctx) => fishIcon(ctx, [170, 120, 70], [204, 160, 100], [130, 88, 50]));

tile('charcoal', (ctx, rng) => blobIcon(ctx, rng, [[58, 46, 38], [40, 32, 26], [80, 64, 52]]));
tile('paper', (ctx) => {
  rect(ctx, 3, 2, 10, 12, [236, 236, 228]);
  rect(ctx, 3, 13, 10, 1, [200, 200, 190]);
  for (const y of [5, 8, 11]) rect(ctx, 5, y, 6, 1, [190, 190, 200]);
});
tile('book', (ctx) => {
  rect(ctx, 3, 2, 10, 12, [150, 96, 54]);
  rect(ctx, 3, 2, 2, 12, [112, 68, 36]);       // spine
  rect(ctx, 12, 3, 1, 10, [236, 236, 228]);    // page edges
  rect(ctx, 7, 6, 4, 2, [214, 180, 80]);       // title plate
});
function bowlShape(ctx, fill) {
  rect(ctx, 2, 7, 12, 2, [122, 86, 50]);
  rect(ctx, 3, 9, 10, 2, [104, 72, 40]);
  rect(ctx, 5, 11, 6, 1, [86, 58, 32]);
  if (fill) rect(ctx, 3, 6, 10, 2, fill);
}
tile('bowl', (ctx) => bowlShape(ctx, null));
tile('mushroom_stew', (ctx) => {
  bowlShape(ctx, [170, 120, 80]);
  px(ctx, 5, 6, [214, 60, 50]); px(ctx, 9, 6, [214, 60, 50]); px(ctx, 7, 6, [200, 170, 140]);
});
// pot meals: a bowl of something, with a few bits showing, and a wisp of steam
function mealIcon(ctx, broth, bits) {
  bowlShape(ctx, broth);
  bits.forEach(([x, col]) => px(ctx, x, 6, col));
  for (const [x, y] of [[6, 4], [7, 3], [6, 2], [9, 4], [10, 3]]) px(ctx, x, y, [236, 236, 240]);
}
tile('beef_stew', (ctx) => mealIcon(ctx, [132, 74, 40], [[4, [96, 52, 30]], [6, [230, 130, 40]], [8, [222, 206, 150]], [11, [96, 52, 30]]]));
tile('chicken_soup', (ctx) => mealIcon(ctx, [226, 196, 120], [[4, [240, 226, 196]], [7, [230, 130, 40]], [10, [240, 226, 196]]]));
tile('fish_chowder', (ctx) => mealIcon(ctx, [232, 226, 206], [[5, [240, 170, 140]], [8, [222, 206, 150]], [11, [120, 160, 90]]]));
tile('vegetable_soup', (ctx) => mealIcon(ctx, [196, 120, 60], [[4, [230, 130, 40]], [6, [110, 160, 70]], [9, [222, 206, 150]], [11, [214, 60, 50]]]));
tile('pumpkin_soup', (ctx) => mealIcon(ctx, [232, 132, 40], [[5, [250, 200, 120]], [9, [250, 200, 120]]]));
tile('coconut_curry', (ctx) => mealIcon(ctx, [226, 170, 60], [[4, [244, 238, 220]], [7, [214, 60, 50]], [10, [110, 160, 70]]]));
tile('hearty_stew', (ctx) => mealIcon(ctx, [140, 96, 60], [[5, [110, 74, 44]], [8, [180, 150, 100]], [11, [110, 74, 44]]]));
tile('coconut_milk', (ctx) => {
  bowlShape(ctx, [246, 244, 236]);
  rect(ctx, 5, 3, 6, 3, [116, 80, 44]); rect(ctx, 6, 3, 4, 2, [244, 240, 228]);   // half a shell on the rim
});
// the guardians' embers: a glowing coal in each one's colours, and the core
// they make (a red-hot gem ringed in gold)
function emberIcon(ctx, rng, core, glow, rim) {
  rect(ctx, 5, 5, 6, 6, glow); rect(ctx, 4, 6, 8, 4, glow); rect(ctx, 6, 4, 4, 8, glow);
  rect(ctx, 6, 6, 4, 4, core); px(ctx, 6, 6, [255, 250, 220]);
  for (const [x, y] of [[4, 6], [11, 9], [6, 4], [9, 11], [4, 9], [11, 6]]) px(ctx, x, y, rim);
  for (let i = 0; i < 4; i++) px(ctx, 3 + ((rng() * 10) | 0), 2 + ((rng() * 3) | 0), [255, 170, 60]);   // sparks
}
tile('brute_ember', (ctx, rng) => emberIcon(ctx, rng, [255, 214, 120], [214, 96, 40], [120, 150, 70]));
tile('archer_ember', (ctx, rng) => emberIcon(ctx, rng, [255, 236, 190], [226, 140, 60], [214, 206, 180]));
tile('brood_ember', (ctx, rng) => emberIcon(ctx, rng, [255, 190, 120], [200, 60, 50], [90, 40, 90]));
tile('ember_core', (ctx) => {
  const gold = [244, 200, 60], goldD = [190, 140, 30];
  rect(ctx, 4, 3, 8, 10, gold); rect(ctx, 3, 4, 10, 8, gold);
  rect(ctx, 4, 12, 8, 1, goldD); rect(ctx, 12, 4, 1, 8, goldD);
  rect(ctx, 5, 5, 6, 6, [200, 40, 24]); rect(ctx, 6, 4, 4, 8, [200, 40, 24]); rect(ctx, 4, 6, 8, 4, [200, 40, 24]);
  rect(ctx, 6, 6, 4, 4, [255, 120, 40]); rect(ctx, 7, 7, 2, 2, [255, 236, 160]);
  px(ctx, 5, 5, [255, 200, 120]);
});
function crabIcon(ctx, shell, dark) {
  rect(ctx, 4, 7, 8, 5, shell); rect(ctx, 5, 6, 6, 1, shell); rect(ctx, 5, 12, 6, 1, dark);
  rect(ctx, 1, 4, 3, 3, shell); rect(ctx, 12, 4, 3, 3, shell);          // claws
  px(ctx, 2, 4, [250, 240, 230]); px(ctx, 13, 4, [250, 240, 230]);
  rect(ctx, 3, 7, 1, 2, dark); rect(ctx, 12, 7, 1, 2, dark);
  for (const x of [3, 4, 11, 12]) px(ctx, x, 12 + (x % 2), dark);       // legs
  px(ctx, 6, 5, [20, 20, 20]); px(ctx, 9, 5, [20, 20, 20]);             // eyes
}
tile('crab_raw', (ctx) => crabIcon(ctx, [196, 110, 80], [150, 80, 56]));
tile('crab_cooked', (ctx) => crabIcon(ctx, [230, 84, 44], [176, 54, 26]));
// cake: white icing over sponge, a red berry on top
tile('cake_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[246, 244, 240], 8], [[236, 232, 226], 2]]);
  for (let i = 0; i < 7; i++) px(ctx, 2 + ((rng() * 12) | 0), 2 + ((rng() * 12) | 0), [214, 50, 60]);
});
tile('cake_side', (ctx, rng) => {
  fillNoise(ctx, rng, [[[214, 160, 100], 6], [[196, 140, 84], 3]]);
  rect(ctx, 0, 8, TILE, 4, [246, 244, 240]);                    // icing down the top half
  for (let x = 0; x < TILE; x += 3) rect(ctx, x, 12, 2, 1 + ((rng() * 2) | 0), [246, 244, 240]);   // drips
  for (let i = 0; i < 4; i++) px(ctx, (rng() * TILE) | 0, 9 + ((rng() * 2) | 0), [214, 50, 60]);
});
tile('cake_bottom', (ctx, rng) => fillNoise(ctx, rng, [[[200, 146, 88], 6], [[180, 128, 74], 3]]));
tile('cake_inner', (ctx, rng) => {
  fillNoise(ctx, rng, [[[232, 196, 130], 6], [[218, 178, 112], 3]]);
  // (a cake is half a block tall: its cut face shows rows 8-15)
  rect(ctx, 0, 8, TILE, 2, [246, 244, 240]);                              // icing
  rect(ctx, 0, 12, TILE, 1, [214, 50, 60]); rect(ctx, 0, 13, TILE, 1, [246, 236, 220]);   // jam and cream
});
tile('cake', (ctx) => {
  rect(ctx, 2, 7, 12, 6, [214, 160, 100]); rect(ctx, 2, 5, 12, 3, [246, 244, 240]);
  rect(ctx, 3, 4, 10, 1, [246, 244, 240]); rect(ctx, 2, 12, 12, 1, [180, 128, 74]);
  for (const x of [4, 8, 11]) px(ctx, x, 4, [214, 50, 60]);
  for (const x of [3, 6, 9, 12]) px(ctx, x, 8, [246, 244, 240]);
});
tile('fried_egg', (ctx) => {
  const w = [248, 248, 244], wE = [226, 224, 216];
  rect(ctx, 3, 5, 10, 7, w); rect(ctx, 4, 4, 7, 9, w); rect(ctx, 2, 7, 12, 3, w);
  px(ctx, 2, 7, wE); px(ctx, 13, 9, wE); rect(ctx, 4, 12, 6, 1, wE); px(ctx, 12, 5, [210, 170, 110]);
  rect(ctx, 6, 6, 4, 4, [246, 178, 30]); rect(ctx, 7, 5, 2, 6, [246, 178, 30]); px(ctx, 7, 6, [255, 220, 120]);
});
tile('sushi', (ctx) => {
  const nori = [34, 52, 34], rice = [246, 244, 236];
  for (const [ox, oy] of [[2, 6], [8, 3]]) {
    rect(ctx, ox, oy, 6, 7, nori);
    rect(ctx, ox + 1, oy + 1, 4, 3, rice);
    rect(ctx, ox + 2, oy + 2, 2, 1, [240, 130, 90]);    // the fish
    rect(ctx, ox, oy + 5, 6, 2, [24, 40, 26]);
  }
});
tile('apple_pie', (ctx) => {
  rect(ctx, 2, 7, 12, 5, [196, 140, 70]);
  rect(ctx, 3, 6, 10, 2, [214, 168, 96]);
  rect(ctx, 2, 11, 12, 1, [150, 100, 50]);
  for (let x = 3; x < 13; x += 3) { px(ctx, x, 7, [150, 40, 30]); px(ctx, x + 1, 6, [236, 196, 130]); }   // lattice and fruit
});
// the cooking pot: fired clay, darker at the rim; the icon shows it steaming on its legs
tile('pot_side', (ctx, rng) => {
  fillNoise(ctx, rng, [[[168, 92, 60], 6], [[150, 80, 52], 3], [[184, 106, 70], 2]]);
  rect(ctx, 0, 5, TILE, 1, [132, 70, 44]);   // the rim's shadow
  rect(ctx, 0, 10, TILE, 1, [186, 112, 76]); // a band round its belly
});
tile('pot_rim', (ctx, rng) => {
  fillNoise(ctx, rng, [[[180, 102, 66], 6], [[160, 88, 56], 3]]);
  rect(ctx, 3, 3, 10, 10, [70, 40, 28]);     // the dark inside
});
tile('pot_water', (ctx, rng) => fillNoise(ctx, rng, [[[64, 110, 200], 6], [[80, 128, 214], 3], [[150, 190, 236], 1]]));
tile('pot_stew', (ctx, rng) => {
  fillNoise(ctx, rng, [[[130, 76, 42], 6], [[112, 64, 34], 3]]);
  for (let i = 0; i < 12; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, rng() < 0.5 ? [230, 130, 40] : [210, 196, 150]);
});
tile('pot_soup', (ctx, rng) => {
  fillNoise(ctx, rng, [[[226, 140, 50], 6], [[210, 120, 40], 3]]);
  for (let i = 0; i < 10; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, rng() < 0.5 ? [250, 200, 120] : [110, 160, 70]);
});
tile('pot_chowder', (ctx, rng) => {
  fillNoise(ctx, rng, [[[230, 222, 196], 6], [[214, 204, 176], 3]]);
  for (let i = 0; i < 10; i++) px(ctx, (rng() * TILE) | 0, (rng() * TILE) | 0, rng() < 0.5 ? [240, 170, 140] : [230, 130, 40]);
});
tile('cooking_pot', (ctx) => {
  const c = [168, 92, 60], cD = [128, 68, 42], cL = [196, 120, 80];
  rect(ctx, 3, 7, 10, 6, c); rect(ctx, 2, 6, 12, 2, cL); rect(ctx, 3, 12, 10, 1, cD);
  rect(ctx, 4, 6, 8, 1, [64, 110, 200]);                                     // water
  rect(ctx, 4, 13, 1, 2, cD); rect(ctx, 11, 13, 1, 2, cD);                    // legs
  for (const [x, y] of [[6, 4], [7, 3], [6, 2], [9, 4], [10, 3], [9, 1]]) px(ctx, x, y, [236, 236, 240]);   // steam
});

// --- TNT ---
tile('tnt_side', (ctx, rng) => {
  fillNoise(ctx, rng, [[[204, 48, 36], 6], [[176, 36, 28], 3]]);
  rect(ctx, 0, 5, TILE, 6, [236, 232, 220]);
  rect(ctx, 0, 5, TILE, 1, [200, 196, 186]);
  // "TNT" in 3x5 pixel letters
  const C = [40, 40, 40];
  rect(ctx, 2, 6, 3, 1, C); rect(ctx, 3, 6, 1, 4, C);
  rect(ctx, 6, 6, 1, 4, C); rect(ctx, 9, 6, 1, 4, C); px(ctx, 7, 7, C); px(ctx, 8, 8, C);
  rect(ctx, 11, 6, 3, 1, C); rect(ctx, 12, 6, 1, 4, C);
});
tile('tnt_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[204, 48, 36], 6], [[176, 36, 28], 3]]);
  rect(ctx, 6, 6, 4, 4, [60, 60, 60]);   // fuse
  rect(ctx, 7, 7, 2, 2, [140, 140, 140]);
});
tile('tnt_bottom', (ctx, rng) => fillNoise(ctx, rng, [[[176, 36, 28], 6], [[150, 30, 24], 3]]));

// --- breaking crack overlays (5 stages) ---
for (let stage = 0; stage < 5; stage++) {
  tile(`crack_${stage}`, (ctx, rng) => {
    const n = 6 + stage * 9;
    const col = [20, 20, 20, 190];
    // random walk cracks radiating from centre
    for (let c = 0; c < 2 + stage; c++) {
      let x = 6 + ((rng() * 4) | 0), y = 6 + ((rng() * 4) | 0);
      for (let s = 0; s < n / 2; s++) {
        px(ctx, x, y, col);
        const d = (rng() * 4) | 0;
        if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else y--;
        if (x < 0 || y < 0 || x > 15 || y > 15) break;
      }
    }
  });
}

// --- sky sprites ---
tile('sun', (ctx) => {
  rect(ctx, 2, 2, 12, 12, [255, 240, 170]);
  rect(ctx, 4, 4, 8, 8, [255, 250, 220]);
});

tile('moon', (ctx) => {
  rect(ctx, 3, 3, 10, 10, [212, 216, 228]);
  rect(ctx, 5, 5, 6, 6, [232, 236, 244]);
  rect(ctx, 5, 5, 3, 3, [188, 192, 208]);
  px(ctx, 9, 8, [188, 192, 208]); px(ctx, 7, 10, [188, 192, 208]);
});

// ---------- public API ----------

export function tileNames() {
  return Object.keys(generators);
}

const tileCache = new Map();

// Render a tile into a fresh 16x16 canvas (cached).
export function generateTile(name) {
  if (tileCache.has(name)) return tileCache.get(name);
  const gen = generators[name];
  if (!gen) throw new Error(`Unknown tile: ${name}`);
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, TILE, TILE);
  gen(ctx, coordRng(0xB10C5EED, hashString(name), 7));
  tileCache.set(name, canvas);
  return canvas;
}

// ---- farming & husbandry ----

// crops grown from the vegetable: leafy tops, the root showing when ripe
function rootCrop(ctx, rng, stage, leaf, root) {
  const leafD = shade(leaf, 0.75), leafL = shade(leaf, 1.2);
  const height = 3 + stage * 3;
  for (const x of [2, 6, 10, 13]) {
    const h = Math.max(2, height - ((rng() * 3) | 0));
    for (let y = TILE - h; y < TILE; y++) px(ctx, x + (y % 2), y, y < TILE - h + 2 ? leafL : rng() < 0.5 ? leaf : leafD);
    px(ctx, x - 1, TILE - h + 1, leaf); px(ctx, x + 2, TILE - h + 2, leafD);
    if (stage === 3) { rect(ctx, x, TILE - 3, 2, 3, root); px(ctx, x, TILE - 3, shade(root, 1.2)); }
  }
}
for (let stage = 0; stage < 4; stage++) {
  tile(`carrots_stage_${stage}`, (ctx, rng) => rootCrop(ctx, rng, stage, [70, 150, 50], [236, 128, 32]));
  tile(`potatoes_stage_${stage}`, (ctx, rng) => rootCrop(ctx, rng, stage, [60, 132, 56], [196, 160, 96]));
}
// beetroot (the red root showing when ripe), Scorch peppers (red pods
// hanging from a dark stalk) and pumpkin stems (a vine that thickens)
for (let stage = 0; stage < 4; stage++) {
  tile(`beetroots_stage_${stage}`, (ctx, rng) => rootCrop(ctx, rng, stage, [70, 140, 60], [150, 30, 50]));
  tile(`peppers_stage_${stage}`, (ctx, rng) => {
    const stalk = [70, 96, 40], leaf = [96, 128, 50];
    const h = 4 + stage * 3;
    for (const x of [4, 10]) {
      for (let y = TILE - h; y < TILE; y++) px(ctx, x, y, stalk);
      for (let y = TILE - h + 1; y < TILE - 1; y += 3) { px(ctx, x - 1, y, leaf); px(ctx, x + 1, y + 1, leaf); }
      if (stage >= 2) for (const dy of [3, 6]) { const y = TILE - h + dy; if (y < TILE - 1) { rect(ctx, x + 1, y, 2, 3, stage === 3 ? [214, 40, 24] : [120, 150, 50]); px(ctx, x + 1, y, stage === 3 ? [250, 110, 60] : [150, 180, 70]); } }
    }
  });
  tile(`pumpkin_stem_stage_${stage}`, (ctx, rng) => {
    const vine = [96, 140, 48], dark = [70, 104, 34];
    const h = 4 + stage * 3;
    for (let y = TILE - h; y < TILE; y++) { px(ctx, 7 + ((y >> 2) & 1), y, vine); if (stage === 3) px(ctx, 8 - ((y >> 2) & 1), y, dark); }
    for (let y = TILE - h + 2; y < TILE - 1; y += 4) { rect(ctx, 3, y, 4, 2, rng() < 0.5 ? vine : dark); rect(ctx, 9, y + 1, 4, 2, rng() < 0.5 ? vine : dark); }
  });
}
tile('beehive_side', (ctx, rng) => {
  planks(ctx, rng, [196, 156, 92]);
  for (const y of [4, 11]) rect(ctx, 0, y, TILE, 1, [150, 110, 56]);
});
tile('beehive_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[206, 166, 98], 5], [[186, 146, 82], 3], [[220, 184, 116], 2]]);
  rect(ctx, 0, 0, TILE, 1, [150, 110, 56]); rect(ctx, 0, TILE - 1, TILE, 1, [150, 110, 56]);
});
tile('beehive_front', (ctx, rng) => {
  planks(ctx, rng, [196, 156, 92]);
  for (const y of [4, 11]) rect(ctx, 0, y, TILE, 1, [150, 110, 56]);
  rect(ctx, 5, 7, 6, 3, [40, 28, 18]);   // the door
  rect(ctx, 6, 10, 4, 1, [232, 176, 40]);   // a dribble of honey
});
tile('beetroot', (ctx) => {
  const r = [150, 30, 50], d = [110, 20, 36], l = [196, 70, 90];
  rect(ctx, 4, 6, 8, 7, r); rect(ctx, 5, 5, 6, 9, r); rect(ctx, 11, 7, 1, 5, d); px(ctx, 6, 7, l); px(ctx, 7, 14, d);
  rect(ctx, 6, 2, 2, 3, [70, 140, 60]); rect(ctx, 9, 1, 2, 4, [90, 160, 70]);
});
tile('beetroot_seeds', (ctx, rng) => {
  for (let i = 0; i < 8; i++) { const x = 4 + ((rng() * 8) | 0), y = 5 + ((rng() * 7) | 0); px(ctx, x, y, [150, 110, 70]); px(ctx, x + 1, y, [120, 84, 50]); }
});
tile('pumpkin_seeds', (ctx, rng) => {
  for (let i = 0; i < 6; i++) { const x = 4 + ((rng() * 7) | 0), y = 5 + ((rng() * 7) | 0); rect(ctx, x, y, 2, 1, [236, 226, 180]); px(ctx, x, y + 1, [206, 192, 140]); }
});
tile('scorch_pepper', (ctx) => {
  const r = [214, 40, 24], d = [160, 24, 14], l = [250, 110, 60];
  for (let i = 0; i < 8; i++) { rect(ctx, 4 + i, 5 + i, 3, 2, r); px(ctx, 4 + i, 6 + i, d); }
  px(ctx, 5, 5, l); px(ctx, 7, 7, l);
  rect(ctx, 3, 3, 2, 2, [70, 120, 40]); px(ctx, 2, 2, [70, 120, 40]);
});
tile('beetroot_soup', (ctx) => mealIcon(ctx, [150, 30, 50], [[5, [196, 70, 90]], [9, [110, 20, 36]]]));
tile('spicy_stew', (ctx) => mealIcon(ctx, [176, 60, 30], [[4, [214, 40, 24]], [7, [96, 52, 30]], [10, [250, 110, 60]]]));
tile('honey_bowl', (ctx) => { bowlShape(ctx, [232, 170, 30]); px(ctx, 6, 6, [252, 214, 100]); px(ctx, 9, 6, [252, 214, 100]); });
tile('honey_bread', (ctx) => {
  rect(ctx, 2, 6, 12, 6, [176, 112, 48]); rect(ctx, 3, 5, 10, 1, [196, 134, 64]); rect(ctx, 2, 11, 12, 1, [138, 84, 34]);
  rect(ctx, 3, 5, 9, 2, [232, 170, 30]); px(ctx, 5, 7, [232, 170, 30]); px(ctx, 10, 7, [232, 170, 30]);   // honey running down
});
tile('coin', (ctx) => {
  const g = [240, 196, 58], d = [190, 146, 36], l = [255, 236, 140];
  for (let y = 3; y < 13; y++) { const w = Math.round(Math.sqrt(25 - (y - 7.5) ** 2)); rect(ctx, 8 - w, y, w * 2, 1, g); px(ctx, 8 + w - 1, y, d); }
  rect(ctx, 6, 5, 4, 1, l); rect(ctx, 7, 6, 2, 4, d);   // a stamped mark
});
tile('ledger', (ctx) => {
  rect(ctx, 3, 2, 10, 12, [96, 64, 36]); rect(ctx, 4, 3, 8, 10, [124, 84, 48]); rect(ctx, 3, 2, 2, 12, [70, 44, 24]);
  rect(ctx, 6, 5, 5, 1, [236, 222, 190]); rect(ctx, 6, 7, 5, 1, [236, 222, 190]); rect(ctx, 6, 9, 3, 1, [236, 222, 190]);
  for (let i = 0; i < 4; i++) px(ctx, 12 + (i & 1), 10 + i, [236, 236, 236]);   // a quill
});
tile('market_stall', (ctx) => {
  for (let x = 1; x < 15; x++) rect(ctx, x, 2, 1, 3, ((x >> 1) & 1) ? [236, 236, 230] : [196, 50, 44]);   // the awning
  rect(ctx, 2, 5, 1, 9, [112, 76, 40]); rect(ctx, 13, 5, 1, 9, [112, 76, 40]);
  rect(ctx, 1, 10, 14, 4, [150, 104, 60]); rect(ctx, 1, 10, 14, 1, [176, 128, 72]);
  rect(ctx, 4, 8, 2, 2, [236, 196, 84]); rect(ctx, 7, 8, 2, 2, [240, 230, 206]); rect(ctx, 10, 8, 2, 2, [150, 30, 50]);   // wares
});
tile('carrot', (ctx) => {
  const o = [236, 128, 32], oD = [196, 92, 20], oL = [250, 170, 80];
  for (let i = 0; i < 9; i++) { rect(ctx, 3 + i, 12 - i, 3 - (i > 6 ? 1 : 0), 2, o); px(ctx, 3 + i, 13 - i, oD); }
  px(ctx, 5, 10, oL); px(ctx, 8, 7, oL); px(ctx, 6, 9, oD);
  rect(ctx, 11, 2, 2, 3, [70, 150, 50]); rect(ctx, 13, 3, 2, 2, [90, 176, 64]); px(ctx, 12, 1, [90, 176, 64]);
});
tile('golden_carrot', (ctx) => {
  const o = [240, 196, 52], oD = [168, 112, 20], oL = [255, 244, 170];
  for (let i = 0; i < 9; i++) { rect(ctx, 3 + i, 12 - i, 3 - (i > 6 ? 1 : 0), 2, o); px(ctx, 3 + i, 13 - i, oD); px(ctx, 5 + i - (i > 6 ? 1 : 0), 12 - i, oD); }
  px(ctx, 5, 10, oL); px(ctx, 8, 7, oL); px(ctx, 10, 5, oL);
  rect(ctx, 11, 2, 2, 3, [200, 150, 30]); rect(ctx, 13, 3, 2, 2, [236, 200, 80]); px(ctx, 12, 1, [236, 200, 80]);
  px(ctx, 2, 4, oL); px(ctx, 1, 4, [255, 230, 120]); px(ctx, 3, 4, [255, 230, 120]); px(ctx, 2, 3, [255, 230, 120]); px(ctx, 2, 5, [255, 230, 120]);   // a glint
});
function potato(ctx, base, dark, light) {
  rect(ctx, 4, 5, 8, 7, base); rect(ctx, 3, 6, 10, 5, base);
  rect(ctx, 4, 11, 8, 1, dark); rect(ctx, 3, 10, 1, 1, dark); px(ctx, 12, 10, dark);
  px(ctx, 5, 6, light); px(ctx, 6, 6, light);
  for (const [x, y] of [[7, 8], [10, 7], [5, 9]]) px(ctx, x, y, dark);   // eyes
}
tile('potato', (ctx) => potato(ctx, [196, 160, 96], [150, 116, 62], [222, 194, 136]));
tile('baked_potato', (ctx) => {
  potato(ctx, [178, 118, 54], [130, 80, 34], [210, 160, 90]);
  rect(ctx, 6, 6, 4, 2, [246, 226, 150]);   // split open, fluffy inside
});
// ---- the ranch's produce ----
tile('nest_egg', (ctx, rng) => fillNoise(ctx, rng, [[[238, 226, 200], 6], [[224, 208, 176], 3], [[250, 244, 230], 2]]));
tile('cheese_round', (ctx, rng) => {
  fillNoise(ctx, rng, [[[236, 196, 84], 6], [[222, 180, 64], 3], [[246, 214, 120], 2]]);
  for (let i = 0; i < 5; i++) { const x = 2 + ((rng() * 11) | 0), y = 2 + ((rng() * 11) | 0); rect(ctx, x, y, 2, 2, [200, 156, 52]); }   // holes
});
tile('nest', (ctx, rng) => {
  for (let a = 0; a < 40; a++) {   // a ring of straw
    const t = (a / 40) * Math.PI * 2, r = 5 + rng() * 1.5;
    px(ctx, Math.round(7.5 + Math.cos(t) * r), Math.round(9 + Math.sin(t) * r * 0.55), rng() < 0.5 ? [206, 170, 70] : [168, 132, 50]);
  }
  for (const [x, y] of [[5, 7], [8, 8], [6, 9]]) { rect(ctx, x, y, 3, 2, [240, 230, 206]); px(ctx, x, y, [252, 248, 236]); }
});
tile('churn', (ctx) => {
  const w = [150, 104, 60], d = [112, 76, 40], band = [96, 96, 104];
  rect(ctx, 4, 5, 8, 10, w);
  for (const x of [5, 8, 11]) rect(ctx, x, 5, 1, 10, d);
  rect(ctx, 3, 7, 10, 1, band); rect(ctx, 3, 12, 10, 1, band);
  rect(ctx, 7, 1, 2, 4, [176, 128, 72]); rect(ctx, 5, 1, 6, 1, [176, 128, 72]);
});
tile('cheese_press', (ctx) => {
  const w = [150, 104, 60], d = [112, 76, 40];
  rect(ctx, 1, 13, 14, 2, d); rect(ctx, 2, 3, 2, 10, w); rect(ctx, 12, 3, 2, 10, w); rect(ctx, 1, 1, 14, 2, d);
  rect(ctx, 7, 3, 2, 4, [120, 120, 128]); rect(ctx, 4, 7, 8, 1, w);
  rect(ctx, 5, 9, 6, 4, [236, 196, 84]); rect(ctx, 5, 9, 6, 1, [246, 214, 120]);
});
tile('butter', (ctx) => {
  rect(ctx, 3, 7, 10, 5, [244, 214, 96]); rect(ctx, 4, 6, 10, 1, [252, 232, 140]); rect(ctx, 13, 7, 1, 5, [214, 182, 70]);
  rect(ctx, 3, 12, 10, 1, [204, 170, 60]);
});
tile('cheese', (ctx) => {
  for (let y = 5; y < 13; y++) rect(ctx, 3, y, Math.min(11, 3 + (y - 5) * 2), 1, [236, 196, 84]);   // a wedge
  rect(ctx, 3, 12, 11, 1, [206, 162, 56]);
  for (const [x, y] of [[5, 9], [9, 11], [4, 7]]) px(ctx, x, y, [200, 156, 52]);
});
tile('goat_milk_bucket', (ctx) => bucket(ctx, [240, 236, 222]));
tile('duck_egg', (ctx) => {
  const c = [196, 222, 206], d = [160, 192, 174], l = [226, 242, 232];
  for (let y = 3; y < 14; y++) {
    const w = Math.round(Math.sqrt(1 - ((y - 8.5) / 5.5) ** 2) * (y < 8 ? 3.2 : 4));
    rect(ctx, 8 - w, y, w * 2, 1, c);
    px(ctx, 8 + w - 1, y, d);
  }
  px(ctx, 6, 6, l); px(ctx, 6, 7, l);
});
tile('cheese_sandwich', (ctx) => {
  rect(ctx, 2, 6, 12, 3, [214, 170, 104]); rect(ctx, 2, 9, 12, 2, [236, 196, 84]); rect(ctx, 2, 11, 12, 3, [214, 170, 104]);
  rect(ctx, 2, 5, 12, 1, [176, 120, 60]); rect(ctx, 2, 14, 12, 1, [176, 120, 60]); px(ctx, 13, 9, [246, 214, 120]);
});
tile('buttered_potato', (ctx) => {
  potato(ctx, [178, 118, 54], [130, 80, 34], [210, 160, 90]);
  rect(ctx, 6, 6, 4, 2, [246, 226, 150]);
  rect(ctx, 6, 5, 3, 2, [252, 222, 90]);   // a knob of butter melting in
});
tile('pancakes', (ctx) => {
  for (const y of [11, 9, 7]) { rect(ctx, 3, y, 10, 2, [214, 158, 84]); rect(ctx, 3, y, 10, 1, [234, 186, 110]); }
  rect(ctx, 6, 5, 4, 2, [252, 226, 110]);   // butter on top
});
tile('hay_bale_side', (ctx, rng) => {
  fillNoise(ctx, rng, [[[206, 172, 70], 5], [[226, 196, 92], 3], [[176, 140, 50], 2]]);
  for (let y = 0; y < TILE; y += 2) for (let x = 0; x < TILE; x++) if (rng() < 0.25) px(ctx, x, y, [236, 210, 120]);
  for (const y of [3, 12]) rect(ctx, 0, y, TILE, 1, [120, 70, 30]);   // the binding
});
tile('hay_bale_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[200, 166, 66], 5], [[222, 190, 88], 3], [[170, 134, 46], 2]]);
  for (let r = 2; r < 8; r += 2) for (let a = 0; a < 24; a++) px(ctx, Math.round(7.5 + Math.cos(a / 24 * Math.PI * 2) * r), Math.round(7.5 + Math.sin(a / 24 * Math.PI * 2) * r), [176, 140, 52]);
  for (const x of [3, 12]) rect(ctx, x, 0, 1, TILE, [120, 70, 30]);
});
tile('composter_side', (ctx, rng) => {
  planks(ctx, rng, P.woodOak);
  for (const x of [0, 15]) rect(ctx, x, 0, 1, TILE, P.woodOakD);
  rect(ctx, 0, 0, TILE, 1, P.woodOakD); rect(ctx, 0, 15, TILE, 1, P.woodOakD);
});
tile('composter_top', (ctx, rng) => {
  fillNoise(ctx, rng, [[[92, 70, 40], 4], [[70, 52, 30], 3], [[104, 120, 52], 2]]);   // dark compost with green bits
  rect(ctx, 0, 0, TILE, 2, P.woodOak); rect(ctx, 0, 14, TILE, 2, P.woodOak); rect(ctx, 0, 0, 2, TILE, P.woodOak); rect(ctx, 14, 0, 2, TILE, P.woodOak);
});
function metal(ctx, rng, base) { fillNoise(ctx, rng, [[base, 6], [shade(base, 1.12), 2], [shade(base, 0.85), 2]]); }
tile('harvester_side', (ctx, rng) => {
  metal(ctx, rng, [150, 152, 160]);
  rect(ctx, 0, 0, TILE, 2, [96, 98, 108]); rect(ctx, 0, 14, TILE, 2, [96, 98, 108]);
  for (let i = 0; i < 3; i++) { rect(ctx, 3 + i * 4, 5, 2, 7, [200, 202, 208]); px(ctx, 3 + i * 4, 4, [230, 232, 236]); }   // blades
});
tile('harvester_top', (ctx, rng) => {
  metal(ctx, rng, [140, 142, 150]);
  rect(ctx, 5, 5, 6, 6, [96, 98, 108]); rect(ctx, 6, 6, 4, 4, [214, 180, 80]);   // a wheat-gold hatch
});
tile('collector_side', (ctx, rng) => {
  metal(ctx, rng, [120, 122, 132]);
  rect(ctx, 0, 0, TILE, 3, [80, 82, 92]);
  for (let y = 5; y < 14; y += 3) rect(ctx, 3, y, 10, 1, [90, 92, 102]);
});
tile('collector_top', (ctx, rng) => {
  metal(ctx, rng, [120, 122, 132]);
  for (let r = 0; r < 4; r++) { const o = 2 + r * 2; rect(ctx, o, o, 12 - r * 4, 12 - r * 4, shade([60, 62, 70], 1 + r * 0.15)); }   // the funnel
  rect(ctx, 7, 7, 2, 2, [20, 20, 24]);
});
tile('sprinkler', (ctx) => {
  // laid out to match the shape: base (bottom 2 rows), pipe, head (rows 6-7)
  const brass = [196, 160, 70], brassD = [150, 116, 44], brassL = [230, 204, 120];
  rect(ctx, 5, 14, 6, 2, brassD);
  rect(ctx, 7, 8, 2, 6, brass); px(ctx, 7, 9, brassL);
  rect(ctx, 4, 6, 8, 2, brass); rect(ctx, 4, 6, 8, 1, brassL);
  for (const [x, y] of [[2, 4], [5, 2], [8, 1], [11, 2], [14, 4]]) px(ctx, x, y, [120, 180, 240]);   // spray
});
tile('trough', (ctx, rng) => {
  // the icon: a wooden box with wheat in it
  rect(ctx, 1, 6, 14, 8, P.woodOakD);
  rect(ctx, 2, 7, 12, 6, P.woodOak);
  for (let x = 3; x < 13; x++) px(ctx, x, 7 + ((rng() * 2) | 0), [214, 180, 80]);
  rect(ctx, 1, 6, 14, 1, P.woodOakL);
});
