// Dimensions: the overworld and the Scorchlands. A world's save holds both;
// one is open at a time. Travelling saves and closes one and opens the
// other (main.js), so everything that lives in a world (chunks, animals,
// drops, your position) belongs to one dimension or the other.

import { WorldGen } from './worldgen.js';
import { ScorchGen, SCORCH_LATEST } from './scorchgen.js';

export const OVERWORLD = 'overworld';
export const SCORCH = 'scorch';
export const DIMENSION_NAMES = { [OVERWORLD]: 'the Overworld', [SCORCH]: 'the Scorchlands' };

// the Scorchlands are smaller: a block there is 8 at home
export const SCORCH_SCALE = 8;

export const dimensionOf = (meta) => (meta?.dimension === SCORCH ? SCORCH : OVERWORLD);

// the generator version a dimension builds with (each counts its own: the
// overworld's terrain versions are untouched by the Scorchlands')
export function genVersionOf(meta, dimension = dimensionOf(meta)) {
  return dimension === SCORCH ? (meta.scorchVersion ?? SCORCH_LATEST) : (meta.genVersion ?? 1);
}

export function makeGen(seed, version, dimension) {
  return dimension === SCORCH ? new ScorchGen(seed, version) : new WorldGen(seed, version);
}

// Where you land on the other side: the same spot, scaled (x/8 going in,
// x*8 coming out).
export function arrivalPoint(from, to, x, z) {
  const k = from === OVERWORLD && to === SCORCH ? 1 / SCORCH_SCALE : from === SCORCH && to === OVERWORLD ? SCORCH_SCALE : 1;
  return { x: Math.floor(x * k) + 0.5, z: Math.floor(z * k) + 0.5 };
}

// What belongs to one dimension in the world entry: kept animals, items on
// the ground, pets left behind, and where you last stood there.
const PER_DIMENSION = ['animals', 'drops', 'pets'];

// Switch a world entry from its current dimension to `to`. `arrive` is where
// the player turns up: {x, z} (stand on the ground there) or {x, y, z,
// exact: true}. Pets that were following close by (saved with travel: true)
// come along.
export function swapDimension(meta, to, arrive) {
  const from = dimensionOf(meta);
  if (from === to) return meta;
  meta.dims ??= {};
  const here = {};
  for (const k of PER_DIMENSION) here[k] = meta[k] ?? [];
  const travellers = here.pets.filter((p) => p.travel).map(({ travel, ...p }) => p);
  here.pets = here.pets.filter((p) => !p.travel);
  // animals on your lead, and the one you rode through
  // (a pen over here isn't home over there)
  const herd = here.animals.filter((a) => a.travel).map(({ travel, home, mood, ...a }) => ({ ...a, arriving: true }));
  here.animals = here.animals.filter((a) => !a.travel);
  const pd = meta.playerData;
  if (pd) here.pos = { x: pd.x, y: pd.y, z: pd.z, yaw: pd.yaw, pitch: pd.pitch };
  meta.dims[from] = here;
  const there = meta.dims[to] ?? {};
  for (const k of PER_DIMENSION) meta[k] = there[k] ?? [];
  // the pets that came with you stand beside you when you arrive
  meta.pets = [...meta.pets, ...travellers.map((p) => ({ ...p, sitting: false, arriving: true }))];   // (set down beside you: Game.restorePets)
  meta.animals = [...meta.animals, ...herd];   // (set down beside you: Game.landAnimals)
  delete meta.dims[to];
  meta.dimension = to;
  if (to === SCORCH) meta.scorchVersion ??= SCORCH_LATEST;
  meta.arrive = arrive;
  return meta;
}
