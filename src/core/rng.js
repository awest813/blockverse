// Deterministic PRNG utilities. Everything world-related must flow through
// these so a seed always reproduces the same world.

// mulberry32: fast 32-bit PRNG, good enough distribution for worldgen.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a string to a 32-bit seed (FNV-1a).
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mix multiple integers into one 32-bit hash (for per-chunk / per-position RNG).
export function hashCoords(seed, a, b, c = 0) {
  let h = seed >>> 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (c | 0), 0x27d4eb2f);
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

// Convenience: RNG scoped to a chunk (or any coordinate pair) for decorations.
export function coordRng(seed, a, b, c = 0) {
  return mulberry32(hashCoords(seed, a, b, c));
}
