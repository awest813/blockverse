// Seeded gradient (Perlin-style) noise, 2D and 3D, with fBm helpers.
// Implemented from scratch; returns values roughly in [-1, 1].

import { mulberry32 } from './rng.js';

const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class Noise {
  constructor(seed) {
    const rand = mulberry32(seed >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle driven by the seed.
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    // Duplicate so we never need to wrap indices.
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  grad2(hash, x, y) {
    const g = GRAD2[hash & 7];
    return g[0] * x + g[1] * y;
  }

  grad3(hash, x, y, z) {
    const g = GRAD3[hash % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  }

  noise2(x, y) {
    const P = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x);
    const v = fade(y);
    const a = P[X] + Y;
    const b = P[X + 1] + Y;
    return lerp(
      lerp(this.grad2(P[a], x, y), this.grad2(P[b], x - 1, y), u),
      lerp(this.grad2(P[a + 1], x, y - 1), this.grad2(P[b + 1], x - 1, y - 1), u),
      v,
    );
  }

  noise3(x, y, z) {
    const P = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
    const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    return lerp(
      lerp(
        lerp(this.grad3(P[AA], x, y, z), this.grad3(P[BA], x - 1, y, z), u),
        lerp(this.grad3(P[AB], x, y - 1, z), this.grad3(P[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(this.grad3(P[AA + 1], x, y, z - 1), this.grad3(P[BA + 1], x - 1, y, z - 1), u),
        lerp(this.grad3(P[AB + 1], x, y - 1, z - 1), this.grad3(P[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }

  // Fractal Brownian motion (octave stacking). Output normalized to ~[-1, 1].
  fbm2(x, y, octaves, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  // Ridged noise: sharp mountain crests.
  ridge2(x, y, octaves, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(this.noise2(x * freq, y * freq)));
      amp *= gain;
      freq *= lacunarity;
    }
    return sum;
  }
}
