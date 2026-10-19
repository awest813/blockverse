// Runtime mob spawning and despawning around the player.

import { inVillage } from '../world/villages.js';
import { Pig, Sheep, Zombie, Husk, Drowned, Skeleton, Spider, Creeper, Scorpion } from './mobs.js';
import { SkeletonKnight, AshDrake, CinderHound } from './scorchMobs.js';
import { Cow, Chicken, Fox, Bird, Fish, Whale, Dog, Cat, Dolphin, Manatee, Goat, Horse, Duck, Panda, Sloth, Capybara, PolarBear, Camel, Seagull, Pelican, Crab } from './animals.js';

// night spawn mix: [class, weight]
const HOSTILE_TABLE = [[Zombie, 40], [Skeleton, 25], [Spider, 20], [Creeper, 15]];
// the Scorchlands' monsters (no animals live there)
const SCORCH_HOSTILES = [[Skeleton, 35], [SkeletonKnight, 20], [Spider, 25], [Zombie, 20]];
function pickHostile(table = HOSTILE_TABLE) {
  let r = Math.random() * table.reduce((n, [, w]) => n + w, 0);
  for (const [cls, w] of table) if ((r -= w) < 0) return cls;
  return table[0][0];
}
import { B, isSolid, isWater } from '../blocks/blocks.js';
import { nudgeFree } from '../core/physics.js';
import { BIOME } from '../world/worldgen.js';

const PASSIVE_CAP = 12;
const HOSTILE_CAP = 8;
const BIRD_CAP = 4;
const FISH_CAP = 6;
const WHALE_CAP = 1;
const DROWNED_CAP = 3;
const DOLPHIN_CAP = 4;
const MANATEE_CAP = 2;
const SCORPION_CAP = 3;
const GULL_CAP = 5;
const PELICAN_CAP = 4;
const CRAB_CAP = 5;
const DRAKE_CAP = 2;
const HOUND_CAP = 2;
// a desert has the one kind of animal: don't let camels fill the cap
const KIND_CAP = new Map([[Camel, 4]]);
// these live on sand rather than grass
const SAND_DWELLERS = new Set([Camel]);

// land animals per biome: [class, weight]
const LAND_TABLE = {
  [BIOME.PLAINS]: [[Pig, 3], [Sheep, 3], [Cow, 3], [Chicken, 3], [Horse, 2], [Duck, 1], [Cat, 1]],
  [BIOME.FOREST]: [[Pig, 2], [Cow, 2], [Chicken, 2], [Fox, 2], [Dog, 1], [Panda, 1], [Sloth, 1]],
  [BIOME.BIRCH_FOREST]: [[Pig, 2], [Cow, 2], [Chicken, 2], [Horse, 1], [Fox, 2], [Dog, 1], [Panda, 1]],
  [BIOME.SWAMP]: [[Pig, 2], [Chicken, 2], [Duck, 3], [Cat, 1], [Capybara, 3], [Sloth, 1]],
  [BIOME.RIVER]: [[Duck, 4], [Sheep, 1], [Cow, 1], [Capybara, 3]],   // the grassy banks
  [BIOME.MOUNTAINS]: [[Goat, 4], [Sheep, 3], [Cow, 1], [Dog, 1]],
  [BIOME.SNOWY]: [[Sheep, 2], [Goat, 2], [Fox, 2], [Dog, 2], [PolarBear, 1]],
  [BIOME.SNOWY_FOREST]: [[Sheep, 1], [Fox, 3], [Dog, 2], [PolarBear, 1]],
  [BIOME.DESERT]: [[Camel, 1]],
};
const GROUP = new Map([[Horse, () => 2 + ((Math.random() * 2) | 0)], [Goat, () => 2], [Duck, () => 2 + ((Math.random() * 3) | 0)],
  [Capybara, () => 2 + ((Math.random() * 3) | 0)], [Panda, () => 1 + ((Math.random() * 2) | 0)],
  [PolarBear, () => (Math.random() < 0.5 ? 2 : 1)], [Camel, () => 1 + ((Math.random() * 2) | 0)]]);
// the rest of these groups are young: a polar bear's cub (keep your distance)
const YOUNG_IN_GROUP = new Set([PolarBear]);
function weighted(table) {
  let r = Math.random() * table.reduce((n, [, w]) => n + w, 0);
  for (const [cls, w] of table) if ((r -= w) < 0) return cls;
  return table[0][0];
}
// the top of the ground, or of the water over it
function waterline(world, wx, wz) {
  let y = world.surfaceHeight(wx, wz);
  while (y < 200 && isWater(world.getBlockW(wx, y + 1, wz))) y++;
  return y;
}
const count = (mobs, ...classes) => mobs.filter((m) => classes.some((c) => m instanceof c)).length;

export class MobSpawner {
  constructor(scene, world, entities) {
    this.scene = scene;
    this.world = world;
    this.entities = entities;
    this.timer = 0;
    this.difficulty = 2;   // 0 peaceful, 1 easy, 2 normal, 3 hard (set by the game)
  }

  update(dt, player, dayFactor) {
    this.timer += dt;
    if (this.timer < 2) return;
    this.timer = 0;

    const mobs = this.entities.mobs;
    const passives = mobs.filter((m) => !m.hostile && m.countsForCap !== false && !m.flier && !m.swimmer && !m.tamed && !m.persistent).length;
    const hostiles = mobs.filter((m) => m.hostile && !m.boss).length;   // a dungeon boss doesn't crowd out the night

    // peaceful: monsters vanish; otherwise far-away ones slowly despawn
    for (const m of mobs) {
      if (!m.hostile || m.dead) continue;
      const d = Math.hypot(m.x - player.x, m.y - player.y, m.z - player.z);
      // a dungeon boss waits longer, and only goes once you're well away (its
      // cage summons it again, at full strength, when you come back)
      if (this.difficulty === 0 || (m.boss ? d > 64 : d > 48 && Math.random() < 0.15)) m.kill();
    }

    const cap = this.difficulty === 3 ? HOSTILE_CAP + 4 : this.difficulty === 1 ? HOSTILE_CAP - 3 : HOSTILE_CAP;
    // the Scorchlands: monsters only, and it's always night there
    if (this.dimension === 'scorch') {
      if (this.difficulty > 0 && hostiles < cap) this.trySpawn(player, true, dayFactor);
      // ash drakes take wing from anywhere (they don't need the dark)
      // (not while the dragon's up: it calls its own)
      if (this.difficulty > 0 && !mobs.some((m) => m.kind === 'dragon' && !m.dead) && mobs.filter((m) => m instanceof AshDrake && !m.tamed).length < DRAKE_CAP && Math.random() < 0.2) this.trySpawnLocal(player, AshDrake, () => true);
      // cinder hounds roam the burnt forest in ones and twos (at any difficulty: they're wild animals)
      const hounds = mobs.filter((m) => m instanceof CinderHound && !m.tamed).length;
      if (hounds < HOUND_CAP && Math.random() < 0.15) {
        this.trySpawnLocal(player, CinderHound, (wx, wz, ground) => ground === B.ASHEN_GRASS || ground === B.ASH, Math.min(HOUND_CAP - hounds, 1 + (Math.random() < 0.4 ? 1 : 0)));
      }
      return;
    }
    if (passives < PASSIVE_CAP) this.trySpawn(player, false, dayFactor);
    // the surface spawns monsters at night; caves are dark at any hour
    if (this.difficulty > 0 && hostiles < cap) this.trySpawn(player, true, dayFactor);
    const gulls = count(mobs, Seagull);
    if (dayFactor > 0.5 && count(mobs, Bird) - gulls < BIRD_CAP) this.trySpawnBird(player, false);
    if (dayFactor > 0.5 && gulls < GULL_CAP && Math.random() < 0.5) this.trySpawnBird(player, true);
    // a beach is a thin strip and a desert's scorpions come out at any hour:
    // these get a pass of their own rather than waiting on the biome tables
    const pelicans = mobs.filter((m) => m instanceof Pelican && !m.persistent).length;
    if (pelicans < PELICAN_CAP && Math.random() < 0.3) {
      this.trySpawnLocal(player, Pelican, (wx, wz, ground) => ground === B.SAND && this.world.biomeAt(wx, wz) === BIOME.BEACH
        && this.world.gen.columnAt(wx, wz).t >= 0.45, Math.min(PELICAN_CAP - pelicans, 1 + ((Math.random() * 3) | 0)));   // pelicans like it warm
    }
    const crabs = mobs.filter((m) => m instanceof Crab && !m.persistent).length;   // (kept ones don't stop wild ones)
    if (crabs < CRAB_CAP && Math.random() < 0.3) {
      this.trySpawnLocal(player, Crab, (wx, wz, ground) => ground === B.SAND && this.world.biomeAt(wx, wz) === BIOME.BEACH
        && this.world.gen.columnAt(wx, wz).t >= 0.3, Math.min(CRAB_CAP - crabs, 1 + ((Math.random() * 3) | 0)));   // any beach that isn't frozen
    }
    if (this.difficulty > 0 && count(mobs, Scorpion) < SCORPION_CAP && Math.random() < 0.3) {
      this.trySpawnLocal(player, Scorpion, (wx, wz, ground) => ground === B.SAND && this.world.biomeAt(wx, wz) === BIOME.DESERT);
    }
    if (count(mobs, Fish) < FISH_CAP) this.trySpawnWater(player, Fish, 1);
    if (count(mobs, Whale) < WHALE_CAP && Math.random() < 0.15) this.trySpawnWater(player, Whale, 7);
    if (count(mobs, Dolphin) < DOLPHIN_CAP && Math.random() < 0.2) this.trySpawnWater(player, Dolphin, 4);
    if (count(mobs, Manatee) < MANATEE_CAP && Math.random() < 0.15) this.trySpawnWater(player, Manatee, 2);
    // drowned rise from oceans and rivers at night
    if (this.difficulty > 0 && dayFactor < 0.4 && count(mobs, Drowned) < DROWNED_CAP && Math.random() < 0.25) this.trySpawnWater(player, Drowned, 3);
  }

  // a random column 20-44 blocks away
  randomColumn(player) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 24;
    const wx = Math.floor(player.x + Math.cos(angle) * dist);
    const wz = Math.floor(player.z + Math.sin(angle) * dist);
    return this.world.isLoaded(wx, wz) ? [wx, wz] : null;
  }

  // songbirds inland; gulls over the sea, beaches and rivers (not frozen ones)
  trySpawnBird(player, gulls) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const col = this.randomColumn(player);
      if (!col) continue;
      const [wx, wz] = col;
      const biome = this.world.biomeAt(wx, wz);
      if (biome === BIOME.DESERT) continue;
      const coast = biome === BIOME.OCEAN || biome === BIOME.BEACH || biome === BIOME.RIVER;
      if (coast !== gulls || (gulls && this.world.gen.columnAt(wx, wz).t < 0.3)) continue;
      const y = waterline(this.world, wx, wz) + 6 + Math.random() * 5;
      if (this.world.getBlockW(wx, Math.floor(y), wz) !== B.AIR) continue;
      // gulls come in a small, noisy flock
      const n = gulls ? Math.min(GULL_CAP - count(this.entities.mobs, Seagull), 2 + ((Math.random() * 2) | 0)) : 1;
      for (let k = 0; k < n; k++) this.spawnMob(gulls ? Seagull : Bird, wx + 0.5 + (k ? (Math.random() - 0.5) * 4 : 0), y + (k ? Math.random() : 0), wz + 0.5 + (k ? (Math.random() - 0.5) * 4 : 0));
      return;
    }
  }

  // n of a kind on a column that passes ok(wx, wz, ground), in the open
  trySpawnLocal(player, Cls, ok, n = 1) {
    const clear = (x, y, z) => this.world.getBlockW(x, y, z) === B.AIR && this.world.getBlockW(x, y + 1, z) === B.AIR;
    for (let attempt = 0; attempt < 6; attempt++) {
      const col = this.randomColumn(player);
      if (!col) continue;
      const [wx, wz] = col;
      const y = this.world.surfaceHeight(wx, wz) + 1;
      if (!ok(wx, wz, this.world.getBlockW(wx, y - 1, wz)) || !clear(wx, y, wz)) continue;
      for (let k = 0; k < n; k++) {
        const ox = k ? Math.round((Math.random() - 0.5) * 4) : 0, oz = k ? Math.round((Math.random() - 0.5) * 4) : 0;
        if (k && (this.world.surfaceHeight(wx + ox, wz + oz) + 1 !== y || !clear(wx + ox, y, wz + oz))) continue;
        this.spawnMob(Cls, wx + ox + 0.5, y, wz + oz + 0.5);
      }
      return;
    }
  }

  // fish anywhere with water; whales need deep ocean (minDepth blocks of water)
  trySpawnWater(player, Cls, minDepth) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const col = this.randomColumn(player);
      if (!col) continue;
      const [wx, wz] = col;
      const biome = this.world.biomeAt(wx, wz);
      if ((Cls === Whale || Cls === Dolphin) && biome !== BIOME.OCEAN) continue;
      if (Cls === Drowned && biome !== BIOME.OCEAN && biome !== BIOME.RIVER) continue;
      // manatees like warm, calm water: rivers, swamps and warm coasts
      if (Cls === Manatee) {
        const t = this.world.gen.columnAt(wx, wz).t;
        if (t < 0.45 || !(biome === BIOME.RIVER || biome === BIOME.SWAMP || (t > 0.55 && (biome === BIOME.OCEAN || biome === BIOME.BEACH)))) continue;
      }
      const floor = this.world.surfaceHeight(wx, wz) + 1;
      let depth = 0;
      while (depth < 20 && isWater(this.world.getBlockW(wx, floor + depth, wz))) depth++;
      if (depth < minDepth) continue;
      const y = floor + Math.max(0, depth / 2 - 1);
      this.spawnMob(Cls, wx + 0.5, y, wz + 0.5);
      // dolphins come in pods
      const room = DOLPHIN_CAP - count(this.entities.mobs, Dolphin);
      if (Cls === Dolphin) for (let k = 0; k < Math.min(room, 1 + ((Math.random() * 2) | 0)); k++) this.spawnMob(Cls, wx + 0.5 + (Math.random() - 0.5) * 3, y, wz + 0.5 + (Math.random() - 0.5) * 3);
      return;
    }
  }

  // a dark cave floor somewhere under this column, or null
  caveSpot(wx, wz, player) {
    const top = this.world.surfaceHeight(wx, wz);
    const lo = Math.max(4, Math.floor(player.y) - 24), hi = Math.min(top - 6, Math.floor(player.y) + 24);
    for (let attempt = 0; attempt < 4 && hi > lo; attempt++) {
      const y = lo + Math.floor(Math.random() * (hi - lo));
      if (this.world.getBlockW(wx, y, wz) !== B.AIR || this.world.getBlockW(wx, y + 1, wz) !== B.AIR) continue;
      if (!isSolid(this.world.getBlockW(wx, y - 1, wz))) continue;
      if (this.world.getBlockLightW(wx, y, wz) > 7 || this.world.getSkyW(wx, y, wz) > 0) continue;
      return y;
    }
    return null;
  }

  trySpawn(player, hostile, dayFactor) {
    if (hostile && (dayFactor >= 0.4 || Math.random() < 0.5)) {
      // underground first (always allowed); the surface only at night
      for (let attempt = 0; attempt < 4; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 24;
        const wx = Math.floor(player.x + Math.cos(angle) * dist);
        const wz = Math.floor(player.z + Math.sin(angle) * dist);
        if (!this.world.isLoaded(wx, wz)) continue;
        const y = this.caveSpot(wx, wz, player);
        if (y === null) continue;
        this.spawnHostile(pickHostile(this.hostileTable()), wx + 0.5, y, wz + 0.5);
        return;
      }
      if (dayFactor >= 0.4) return;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 24;
      const wx = Math.floor(player.x + Math.cos(angle) * dist);
      const wz = Math.floor(player.z + Math.sin(angle) * dist);
      if (!this.world.isLoaded(wx, wz)) continue;

      const y = this.world.surfaceHeight(wx, wz) + 1;
      if (y <= 1 || y > 120) continue;
      const ground = this.world.getBlockW(wx, y - 1, wz);
      if (!isSolid(ground) || ground === B.WATER) continue;
      // not on tree canopies
      if (ground === B.OAK_LEAVES || ground === B.BIRCH_LEAVES || ground === B.SPRUCE_LEAVES || ground === B.PALM_LEAVES || ground === B.CHARRED_LEAVES) continue;
      // need 2 blocks of room (a snow layer or tall grass doesn't count against
      // it: they used to rule out most of the snowy lands)
      const open = (id) => id === B.AIR || (!isSolid(id) && !isWater(id) && id !== B.LAVA);
      if (!open(this.world.getBlockW(wx, y, wz)) || !open(this.world.getBlockW(wx, y + 1, wz))) continue;

      if (hostile) {
        // hostiles need darkness
        const sky = this.world.getSkyW(wx, y, wz);
        const bl = this.world.getBlockLightW(wx, y, wz);
        const light = Math.max((sky / 15) * dayFactor * 15, bl);
        if (light > 7) continue;
        // nor in a village (on its roofs, in its gardens): its lamps keep the night off
        if (this.dimension !== 'scorch' && inVillage(this.world.gen, wx, wz, 2)) continue;
        // deserts breed husks instead of zombies
        let Cls = pickHostile(this.hostileTable());
        if (Cls === Zombie && this.world.biomeAt(wx, wz) === BIOME.DESERT && Math.random() < 0.8) Cls = Husk;
        this.spawnHostile(Cls, wx + 0.5, y, wz + 0.5);
        return;
      }

      // land animals depend on the biome; on the banks of a river or lake
      // (the river biome itself is all water) its ducks and capybaras turn up
      let landBiome = this.world.biomeAt(wx, wz);
      if (!hostile && (landBiome === BIOME.PLAINS || landBiome === BIOME.FOREST || landBiome === BIOME.SWAMP || landBiome === BIOME.BIRCH_FOREST)
        && Math.random() < 0.4 && [[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dz]) => isWater(this.world.getBlockW(wx + dx, y - 1, wz + dz)))) landBiome = BIOME.RIVER;
      const table = LAND_TABLE[landBiome];
      if (!table) continue;
      const Cls = weighted(table);
      if (KIND_CAP.has(Cls) && count(this.entities.mobs, Cls) >= KIND_CAP.get(Cls)) continue;
      // bare rock is for goats only, sand for camels
      if (SAND_DWELLERS.has(Cls) ? ground !== B.SAND && ground !== B.GRASS
        : ground !== B.GRASS && ground !== B.SNOWY_GRASS && ground !== B.DIRT && ground !== B.SNOW_BLOCK && !(Cls === Goat && ground === B.STONE)) continue;
      if (Cls === Goat && ground !== B.STONE && ground !== B.SNOW_BLOCK && ground !== B.SNOWY_GRASS && y < 80 && Math.random() < 0.6) continue;   // goats like it high and rocky
      // herds and flocks: horses, goats and ducks come in twos and threes
      const n = GROUP.get(Cls)?.() ?? 1;
      for (let k = 0; k < n; k++) {
        const ox = k ? Math.round((Math.random() - 0.5) * 4) : 0, oz = k ? Math.round((Math.random() - 0.5) * 4) : 0;
        const gy = this.world.surfaceHeight(wx + ox, wz + oz) + 1;
        if (k && (Math.abs(gy - y) > 2 || !open(this.world.getBlockW(wx + ox, gy, wz + oz)) || !open(this.world.getBlockW(wx + ox, gy + 1, wz + oz)) || isWater(this.world.getBlockW(wx + ox, gy - 1, wz + oz)))) continue;
        const mob = this.spawnMob(Cls, wx + ox + 0.5, gy, wz + oz + 0.5);
        if (k && YOUNG_IN_GROUP.has(Cls)) mob.setBaby(true);
      }
      return;
    }
  }

  hostileTable() { return this.dimension === 'scorch' ? SCORCH_HOSTILES : HOSTILE_TABLE; }

  // zombies of any kind are sometimes babies
  spawnHostile(Cls, x, y, z) {
    const mob = this.spawnMob(Cls, x, y, z);
    if (mob instanceof Zombie && Math.random() < 0.06) mob.makeBaby();
    return mob;
  }

  spawnMob(Cls, x, y, z) {
    const mob = new Cls(this.scene, this.world, x, y, z);
    // the spawn checks look at one column: a wide mob (a horse, a spider) can
    // overlap the wall beside it, so ease it out into the open
    nudgeFree(this.world, mob, 1);
    this.entities.addMob(mob);
    return mob;
  }
}
