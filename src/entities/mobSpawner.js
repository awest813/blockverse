// Runtime mob spawning and despawning around the player.

import { Pig, Sheep, Zombie, Skeleton, Spider, Creeper } from './mobs.js';
import { Cow, Chicken, Fox, Bird, Fish, Whale, Dog, Cat } from './animals.js';

// night spawn mix: [class, weight]
const HOSTILE_TABLE = [[Zombie, 40], [Skeleton, 25], [Spider, 20], [Creeper, 15]];
function pickHostile() {
  let r = Math.random() * HOSTILE_TABLE.reduce((n, [, w]) => n + w, 0);
  for (const [cls, w] of HOSTILE_TABLE) if ((r -= w) < 0) return cls;
  return Zombie;
}
import { B, isSolid } from '../blocks/blocks.js';
import { BIOME } from '../world/worldgen.js';

const PASSIVE_CAP = 12;
const HOSTILE_CAP = 8;
const BIRD_CAP = 4;
const FISH_CAP = 6;
const WHALE_CAP = 1;

// land animals per biome: [class, weight]
const LAND_TABLE = {
  [BIOME.PLAINS]: [[Pig, 3], [Sheep, 3], [Cow, 3], [Chicken, 3], [Cat, 1]],
  [BIOME.FOREST]: [[Pig, 2], [Cow, 2], [Chicken, 2], [Fox, 2], [Dog, 1]],
  [BIOME.BIRCH_FOREST]: [[Pig, 2], [Cow, 2], [Chicken, 2], [Fox, 2], [Dog, 1]],
  [BIOME.SWAMP]: [[Pig, 2], [Chicken, 2], [Cat, 1]],
  [BIOME.MOUNTAINS]: [[Sheep, 3], [Cow, 2], [Dog, 1]],
  [BIOME.SNOWY]: [[Sheep, 2], [Fox, 2], [Dog, 2]],
  [BIOME.SNOWY_FOREST]: [[Sheep, 1], [Fox, 3], [Dog, 2]],
};
function weighted(table) {
  let r = Math.random() * table.reduce((n, [, w]) => n + w, 0);
  for (const [cls, w] of table) if ((r -= w) < 0) return cls;
  return table[0][0];
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
    const passives = mobs.filter((m) => !m.hostile && m.countsForCap !== false && !m.flier && !m.swimmer && !m.tamed).length;
    const hostiles = mobs.filter((m) => m.hostile).length;

    // peaceful: monsters vanish; otherwise far-away ones slowly despawn
    for (const m of mobs) {
      if (!m.hostile || m.dead) continue;
      const d = Math.hypot(m.x - player.x, m.y - player.y, m.z - player.z);
      if (this.difficulty === 0 || (d > 48 && Math.random() < 0.15)) m.kill();
    }

    if (passives < PASSIVE_CAP) this.trySpawn(player, false, dayFactor);
    const cap = this.difficulty === 3 ? HOSTILE_CAP + 4 : HOSTILE_CAP;
    // the surface spawns monsters at night; caves are dark at any hour
    if (this.difficulty > 0 && hostiles < cap) this.trySpawn(player, true, dayFactor);
    if (dayFactor > 0.5 && count(mobs, Bird) < BIRD_CAP) this.trySpawnBird(player);
    if (count(mobs, Fish) < FISH_CAP) this.trySpawnWater(player, Fish, 1);
    if (count(mobs, Whale) < WHALE_CAP && Math.random() < 0.15) this.trySpawnWater(player, Whale, 7);
  }

  // a random column 20-44 blocks away
  randomColumn(player) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 24;
    const wx = Math.floor(player.x + Math.cos(angle) * dist);
    const wz = Math.floor(player.z + Math.sin(angle) * dist);
    return this.world.isLoaded(wx, wz) ? [wx, wz] : null;
  }

  trySpawnBird(player) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const col = this.randomColumn(player);
      if (!col) continue;
      const [wx, wz] = col;
      const biome = this.world.biomeAt(wx, wz);
      if (biome === BIOME.OCEAN || biome === BIOME.DESERT) continue;
      const y = this.world.surfaceHeight(wx, wz) + 6 + Math.random() * 5;
      if (this.world.getBlockW(wx, Math.floor(y), wz) !== B.AIR) continue;
      this.spawnMob(Bird, wx + 0.5, y, wz + 0.5);
      return;
    }
  }

  // fish anywhere with water; whales need deep ocean (minDepth blocks of water)
  trySpawnWater(player, Cls, minDepth) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const col = this.randomColumn(player);
      if (!col) continue;
      const [wx, wz] = col;
      if (Cls === Whale && this.world.biomeAt(wx, wz) !== BIOME.OCEAN) continue;
      const floor = this.world.surfaceHeight(wx, wz) + 1;
      let depth = 0;
      while (depth < 20 && this.world.getBlockW(wx, floor + depth, wz) === B.WATER) depth++;
      if (depth < minDepth) continue;
      this.spawnMob(Cls, wx + 0.5, floor + Math.max(0, depth / 2 - 1), wz + 0.5);
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
        this.spawnMob(pickHostile(), wx + 0.5, y, wz + 0.5);
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
      // need 2 blocks of air
      if (this.world.getBlockW(wx, y, wz) !== B.AIR || this.world.getBlockW(wx, y + 1, wz) !== B.AIR) continue;

      if (hostile) {
        // hostiles need darkness
        const sky = this.world.getSkyW(wx, y, wz);
        const bl = this.world.getBlockLightW(wx, y, wz);
        const light = Math.max((sky / 15) * dayFactor * 15, bl);
        if (light > 7) continue;
        this.spawnMob(pickHostile(), wx + 0.5, y, wz + 0.5);
        return;
      }

      // land animals depend on the biome
      const table = LAND_TABLE[this.world.biomeAt(wx, wz)];
      if (!table) continue;
      if (ground !== B.GRASS && ground !== B.SNOWY_GRASS && ground !== B.DIRT && ground !== B.SNOW_BLOCK) continue;
      this.spawnMob(weighted(table), wx + 0.5, y, wz + 0.5);
      return;
    }
  }

  spawnMob(Cls, x, y, z) {
    const mob = new Cls(this.scene, this.world, x, y, z);
    this.entities.addMob(mob);
    return mob;
  }
}
