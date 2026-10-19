# BlockVerse Architecture

A technical tour of how the engine works. Everything runs client-side; the
only dependencies are **three.js** (rendering) and **Vite** (bundling).

## 1. World representation

### Chunks

The world is an infinite grid of **chunks**, each `16 × 128 × 16` blocks
(`src/world/chunk.js`). A chunk stores:

| Field | Type | Purpose |
| --- | --- | --- |
| `blocks` | `Uint16Array(32768)` | block ids |
| `meta` | `Uint8Array` (lazy) | orientation for furnaces / pumpkins etc. |
| `skyLight`, `blockLight` | `Uint8Array` | 0–15 light per cell |
| `heightMap`, `biomeMap` | `Uint8Array(256)` | terrain queries, debug, mob spawning |
| `blockEntities` | `Map<cellIndex, state>` | per-block state: furnaces, chests, campfires, cooking pots, crops, saplings, spawners, signs, troughs and other machines |

The flat index is `(x * 16 + z) * 128 + y` — columns are contiguous in
memory, which makes vertical scans (skylight, surface queries) cache-friendly.

### Streaming

`World.update()` (`src/world/world.js`) runs every frame:

1. When the player crosses a chunk border, request all missing chunks within
   `renderDistance + 1` (sorted nearest-first) and evict chunks beyond
   `renderDistance + 3` (saving modified ones first).
2. Freshly generated chunks enter a **light-init queue**, processed with a
   per-frame time budget.
3. Chunks whose 8 neighbors are lit become meshable; dirty meshes rebuild
   nearest-first under a time budget (~9 ms/frame, more when the tab is
   hidden).

Block reads outside loaded chunks return bedrock — physics can never fall
through an unloaded chunk, and the player is frozen until their chunk loads.

## 2. Terrain generation

`src/world/worldgen.js` is a **pure module** (no DOM, no three.js) so the same
code runs on the main thread (for spawn/biome queries) and inside the worker
pool (`src/workers/genWorker.js`, `src/world/genPool.js`). Workers transfer
the finished `Uint16Array` back zero-copy.

The height function combines seeded gradient-noise fields (all from
`src/core/noise.js`, an original Perlin-style implementation):

- **continental** (1/700 scale) — landmass vs. ocean
- **erosion** (1/400) — smooth plains vs. rugged detail
- **mountain mask** (1/520) + **ridged peaks** (1/230) — regional mountain
  ranges with sharp crests
- **detail** (1/60) — small bumps, damped by erosion

Biomes come from independent **temperature** and **moisture** fields plus the
height (ocean/beach/mountain overrides). Swamps flatten terrain toward sea
level.

**Caves** subtract two kinds of space: spaghetti tunnels (the intersection of
two 3D noise bands, i.e. `|n1| < ε && |n2| < ε`) and cheese caverns below
y≈34. Depths below y=9 flood with water.

**Ores** are random-walk blobs seeded per chunk `(seed, cx, cz, oreIndex)` so
they are deterministic.

### Cross-chunk features

Trees and plants may straddle chunk borders. Instead of a post-pass, every
chunk applies the feature lists of its **3×3 chunk neighborhood**. Feature
lists are derived only from `(seed, cx, cz)`, so every chunk that overlaps a
tree computes the exact same blocks for it — no seams, no ordering issues.

### Dimensions

A world has two dimensions, the overworld and **the Scorchlands**
(`src/world/dimensions.js`); one is open at a time. The Scorchlands have
their own generator, `src/world/scorchgen.js` (`ScorchGen`), with its own
version number (`meta.scorchVersion`), so changes there never touch the
overworld's terrain versions. Its castles and the dragon's roost are larger
than a chunk but use the same trick as trees: each is rooted in one chunk,
every chunk in its 3×3 neighbourhood replays the whole build with the same
random rolls, and a clipping `put` writes only what falls in that chunk.

Travelling (`Game.travel` → `travelTo` in `main.js`) saves and closes the
running `Game`, swaps the per-dimension parts of the world entry
(`swapDimension`: kept animals, items on the ground, pets left behind and
where you stood go into `meta.dims[from]`; pets following you come along),
and opens the world again in the other dimension. A block there is eight
at home (`arrivalPoint`).

**Ember portals** (`src/world/portal.js`): a ring of charred stone around a
2×3 opening, lit with an Ember Core. The world entry lists every lit
portal (`meta.portals`, with its dimension); going through looks for the
listed portal on the far side nearest the scaled point (128 blocks at
home, 16 in the Scorchlands) and otherwise builds one where you land
(`Game.finishArrival`, once the chunks there have loaded). `World.setBlock`
queues any change to a frame or sheet block (`portalChecks`), and
`Game.updatePortals` puts out a portal whose frame is no longer whole.

## 3. Lighting

`src/world/light.js` implements the classic two-channel voxel light model:

- **Sky light**: level 15 falls straight down until it hits an opaque block,
  attenuating through leaves (1) and water (2). Lateral spread uses BFS with
  loss 1 per step. The special rule: level-15 light propagating **downward**
  through air stays 15.
- **Block light**: emitters (torch 14, glowstone 15, lit furnace 13) BFS
  outward with loss 1 (+opacity).

On block change (`lightBlockChange`):

1. If the cell became darker (more opaque / emitter removed), a **removal
   BFS** zeroes everything lit *by* that cell; any neighbor that is equally or
   brighter lit is enqueued as a re-fill source.
2. If the cell became more transparent, its neighbors are enqueued directly.
3. A propagation BFS then re-floods from all queued sources.

Both passes freely cross chunk borders (the `Access` helper caches the last
chunk touched). Chunks whose light changed — including border neighbors — are
marked for remesh.

When a new chunk initializes, it exchanges **border seeds** with already-lit
neighbors in both directions, so light flows into and out of the new chunk.

## 4. Meshing & rendering

`src/render/mesher.js` builds two geometries per chunk:

- **Opaque + cutout**: full cubes with per-face culling; leaves/glass use
  alpha-test in the same pass. Cross-shaped plants (flowers, grass, torches)
  emit two double-sided quads.
- **Water**: alpha-blended, drawn after opaque, with the surface lowered to
  14/16 when there is no water above.

Per **vertex** the mesher emits:

- `aUvw` — tile-local UV plus the **texture-array layer**
- `aLight` — sky and block light, each pre-multiplied by ambient occlusion
  and a per-face directional shade (top 1.0, z 0.8, x 0.6, bottom 0.5)

AO uses the standard 3-neighbor rule (`side1 && side2 ? 0 : 3 - sum`), and the
quad diagonal flips when needed to avoid the classic AO anisotropy artifact.
Smooth lighting averages the four light cells adjacent to each vertex.

**Greedy merging**: a full-cube face whose four corners agree on light, AO
and tint is set aside instead of emitted, and at the end of the chunk the
set-aside faces of each layer are merged into the largest rectangles of the
same tile. The shader tiles the texture across a merged quad with
`fract()` and explicit gradients (`textureGrad`), so mipmaps don't seam.
Faces with any lighting gradient stay as single quads, so the image is
unchanged.

**Lazy rebuilds**: an edit the player makes remeshes at once, but changes the
world makes on its own (crops growing, saplings, farm machines) go through
`world.deferred()` and wait (about a second for nearby chunks, a few seconds
for far ones), one rebuild per frame, so a field ripening doesn't stall a
frame.

The fragment shader computes
`brightness = max(blockLight, skyLight * uDay)`, so night dims sunlight but
never torches. Fog is distance-based with colors driven by the sky system.

### Textures

`src/render/textures.js` draws every 16×16 tile procedurally (seeded per tile
name, so they're stable). `src/render/atlas.js` packs them into a
`THREE.DataArrayTexture` — one layer per tile. Because tiles are separate
layers, mipmaps can be generated without atlas bleeding. The same tiles render
the inventory icons (blocks become small isometric cubes drawn with canvas
transforms).

## 5. Entities

`src/core/physics.js` provides axis-separated AABB collision against the
voxel grid, shared by the player, item drops, and mobs.

- **Player** (`src/player/player.js`): walking/sprinting/sneaking (with edge
  guard), swimming, creative flight, fall damage, hunger/saturation/
  exhaustion, drowning, and a 36-slot inventory.
- **Interaction** (`src/player/interaction.js`): DDA voxel raycast
  (Amanatides–Woo, `src/world/raycast.js`), hold-to-break with per-block time
  (hardness × tool speed × tier gates), placement with orientation metadata,
  usable blocks, eating.
- **Item drops** (`src/entities/itemDrop.js`): mini-cube/sprite entities with
  gravity that magnetize to the player.
- **Mobs** (`src/entities/mob.js`, `mobs.js`): box-model creatures with
  vertex-shaded faces, wander/flee/chase state machines, 1-block hop,
  knockback, and voxel-light-aware tinting. On its first update a mob merges
  the parts that never move on their own into one vertex-coloured mesh per
  parent, which cuts its draw calls; hurt and death flashes tint the merged
  mesh through a shader uniform (`tintPart`). The spawner keeps population caps
  around the player and requires darkness for zombies.

## 6. Persistence

`src/save/store.js` uses IndexedDB with two object stores:

- `worlds`: metadata — name, seed, mode, time of day, serialized player
  (position, stats, inventory, spawn point)
- `chunks`: key `"<worldId>:<cx>,<cz>"` → `{blocks, meta, blockEntities}`
  (the Scorchlands' chunks: `"<worldId>:s:<cx>,<cz>"`)

Only **modified** chunks are stored; everything else regenerates from the
seed. Saves happen on an autosave timer, on chunk eviction, and on quit.
Settings live in `localStorage`.

## 7. The frame

```
Game.loop()
├── advance time of day → uDay uniform, sky colors, sun/moon/stars/clouds
├── player.update()        input → physics → survival stats
├── interaction.update()   raycast, breaking progress, placement
├── entities.update()      drops + mobs
├── mobSpawner.update()
├── tickFurnaces()
├── highlight.update()     selection box + crack overlay
├── world.update()         streaming, light init, mesh rebuilds (budgeted)
└── renderer.render()
```

A hidden-tab worker ticker keeps this loop running (at reduced fidelity) when
the browser throttles page timers. In a hidden tab only block entities tick
(furnaces, crops, saplings, cooking pots); the player, mobs and the clock wait.
