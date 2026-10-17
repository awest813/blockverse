// Holds and updates all non-player entities (drops, mobs).

import { ItemDrop } from './itemDrop.js';
import { chunkKey } from '../world/chunk.js';
import { Arrow, Fireball } from './projectile.js';
import { moveEntity } from '../core/physics.js';
import { Pig, Sheep } from './mobs.js';
import { Cow, Chicken, Goat, Horse, Duck, Panda, Sloth, Capybara, PolarBear, Camel, Pelican, Crab } from './animals.js';
import { isRare } from '../items/items.js';

// animals that can be kept (stashed while far away, saved with the world)
const KEPT = { pig: Pig, sheep: Sheep, cow: Cow, chicken: Chicken, goat: Goat, horse: Horse, duck: Duck,
  panda: Panda, sloth: Sloth, capybara: Capybara, polarbear: PolarBear, camel: Camel, pelican: Pelican, crab: Crab };
const STASH_LIMIT = 300;

export class EntityManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.drops = [];
    this.mobs = [];
    this.projectiles = [];
    this.onPickup = null; // callback for pickup sound
    this.stash = [];      // kept animals far from the player: [{kind, x, y, z, ...}]
    this.stashTimer = 0;
    // effects mobs can trigger; explode/sound are filled in by the game
    this.fx = {
      shoot: (x, y, z, vx, vy, vz, dmg, cause = 'skeleton') => {
        const a = new Arrow(this.scene, this.world, x, y, z, vx, vy, vz, dmg);
        a.cause = cause;
        a.onStick = (s) => this.fx.sound('arrowhit', { pos: s });
        this.projectiles.push(a);
        this.fx.sound('shoot', { pos: { x, y, z } });
      },
      // a drake's or the dragon's fireball (it never harms a block)
      fireball: (x, y, z, vx, vy, vz, dmg, cause = 'fireball') => {
        const f = new Fireball(this.scene, this.world, x, y, z, vx, vy, vz, dmg);
        f.cause = cause;
        f.onBurst = (s) => { this.fx.spark?.(s.x, s.y, s.z, 0xff8a2a, 10); this.fx.sound('fizz', { pos: s }); };
        f.onHitPlayer = (p) => { p.fireTime = Math.max(p.fireTime ?? 0, 3); };
        this.projectiles.push(f);
        this.fx.sound('fireball', { pos: { x, y, z } });
      },
      // the player's bow
      fire: (x, y, z, vx, vy, vz, dmg, pickup) => {
        const a = new Arrow(this.scene, this.world, x, y, z, vx, vy, vz, dmg, 'player', pickup);
        a.onStick = (s) => this.fx.sound('arrowhit', { pos: s });
        this.projectiles.push(a);
        this.fx.sound('throw');
      },
      explode: () => {},
      sound: () => {},
      notify: () => {},
      hearts: () => {},
      mobs: () => this.mobs,
      spawn: (mob) => this.addMob(mob),
      // false when full: the animal then waits where it is instead of being lost
      stash: (mob) => {
        if (this.stash.length >= STASH_LIMIT) return false;
        this.stash.push(serializeAnimal(mob));
        return true;
      },
    };
  }

  // `owned`: things that were already the player's (thrown, spilled from a
  // container, lost on death): picking them back up is no "rare find"
  spawnDrops(x, y, z, drops, owned = false) {
    for (const d of drops) {
      if (!d || d.count <= 0) continue;
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 0.8;
      this.drops.push(new ItemDrop(
        this.scene, this.world, d.id, d.count,
        x, y, z,
        Math.cos(a) * s, 2.2 + Math.random(), Math.sin(a) * s,
        d.dur,
      ));
      if (owned) this.drops[this.drops.length - 1].owned = true;
    }
  }

  addMob(mob) {
    mob.fx = this.fx;
    mob.dropFn ??= (drops) => this.spawnDrops(mob.x, mob.y + 0.4, mob.z, drops);
    this.mobs.push(mob);
  }

  // Items lying on the ground travel with the save (your things after a
  // death included), up to a sane number.
  savedDrops() {
    // (ones still waiting for their chunk to load are kept too)
    return [...this.drops.filter((d) => !d.dead).map((d) => ({
      id: d.id, count: d.count, dur: d.dur, x: d.x, y: d.y, z: d.z, age: d.age, ...(d.owned ? { owned: true } : {}),
    })), ...(this.pendingDrops ?? [])].slice(-200);
  }

  // Put saved drops back once the ground under them has loaded.
  restoreDrops(list) { this.pendingDrops = [...(list ?? [])]; }

  update(dt, player) {
    if (this.pendingDrops?.length) {
      this.pendingDrops = this.pendingDrops.filter((s) => {
        const c = this.world.chunks.get(chunkKey(Math.floor(s.x) >> 4, Math.floor(s.z) >> 4));
        if (!c?.hasBlocks) return true;
        const d = new ItemDrop(this.scene, this.world, s.id, s.count, s.x, s.y, s.z, 0, 0, 0, s.dur);
        d.age = s.age ?? 0;
        d.pickupDelay = 0;
        if (s.owned) d.owned = true;
        this.drops.push(d);
        return false;
      });
    }
    this.glintT = (this.glintT ?? 0) - dt;
    const glint = this.glintT <= 0;
    if (glint) this.glintT = 0.6;
    for (const d of this.drops) {
      d.update(dt, player);
      if (d.pickedUp) this.onPickup?.(d);
      // rare finds sparkle so they're not missed in the grass
      else if (glint && !d.dead && isRare(d.id) && Math.hypot(d.x - player.x, d.z - player.z) < 32) this.fx.glint?.(d.x, d.y + 0.35, d.z);
    }
    this.drops = this.drops.filter((d) => !d.dead);

    for (const m of this.mobs) m.update(dt, player);
    this.mobs = this.mobs.filter((m) => !m.dead);
    this.separate(dt, player);

    // bring kept animals back once the player is near them again
    this.stashTimer -= dt;
    if (this.stashTimer <= 0 && this.stash.length) {
      this.stashTimer = 2;
      this.stash = this.stash.filter((a) => {
        if (Math.hypot(a.x - player.x, a.z - player.z) > 64) return true;
        if (!this.world.isLoaded(Math.floor(a.x), Math.floor(a.z))) return true;
        const mob = restoreAnimal(this.scene, this.world, a);
        if (mob) this.addMob(mob);
        return false;
      });
    }

    for (const a of this.projectiles) a.update(dt, player, this.mobs, this.onPickup);
    this.projectiles = this.projectiles.filter((a) => !a.dead);
  }

  // Mobs gently push each other (and are shoved by the player) instead of
  // merging into one blob. Pushes are small displacements run through the
  // physics step, so walls still win.
  separate(dt, player) {
    const live = this.mobs.filter((m) => m.dying === undefined && !m.dead &&
      Math.abs(m.x - player.x) < 32 && Math.abs(m.z - player.z) < 32);
    const shove = new Map();   // mob -> [dx, dz]
    const add = (m, dx, dz) => { const v = shove.get(m) ?? [0, 0]; v[0] += dx; v[1] += dz; shove.set(m, v); };
    const overlap = (a, bx, by, bz, bw, bh) => {
      const dx = a.x - bx, dz = a.z - bz;
      const reach = (a.w + bw) / 2;
      if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) return null;
      if (a.y >= by + bh || by >= a.y + a.h) return null;   // no vertical overlap
      const d = Math.hypot(dx, dz);
      if (d >= reach) return null;
      const nx = d > 1e-4 ? dx / d : Math.random() - 0.5, nz = d > 1e-4 ? dz / d : Math.random() - 0.5;
      const k = Math.min(1, 6 * dt) * (reach - d);
      return [nx * k, nz * k];
    };
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const o = overlap(a, b.x, b.y, b.z, b.w, b.h);
        if (o) { add(a, o[0] / 2, o[1] / 2); add(b, -o[0] / 2, -o[1] / 2); }
      }
      // the player shoves animals out of the way (and gets nudged a little)
      if (!player.dead && !player.flying && !player.mount) {
        const o = overlap(a, player.x, player.y, player.z, 0.6, 1.8);
        if (o) { add(a, o[0], o[1]); player.vx -= o[0] * 4; player.vz -= o[1] * 4; }
      }
    }
    for (const [m, [dx, dz]] of shove) {
      const vx = m.vx, vy = m.vy, vz = m.vz;
      m.vx = dx; m.vy = 0; m.vz = dz;
      moveEntity(this.world, m, 1);
      m.vx = vx; m.vy = vy; m.vz = vz;
    }
  }

  mobsNear(x, y, z, r) {
    const out = [];
    for (const m of this.mobs) {
      const dx = m.x - x, dy = m.y - y, dz = m.z - z;
      if (dx * dx + dy * dy + dz * dz < r * r) out.push(m);
    }
    return out;
  }

  dispose() {
    for (const d of this.drops) d.kill();
    for (const m of this.mobs) m.kill?.();
    for (const a of this.projectiles) a.kill();
    this.drops = [];
    this.mobs = [];
    this.projectiles = [];
  }
}

// ---- kept animals ----

export function serializeAnimal(m) {
  const a = { kind: m.kind, x: m.x, y: m.y, z: m.z, health: m.health, baby: !!m.baby, grow: m.grow ?? 0, breedCooldown: m.breedCooldown ?? 0, sheared: !!m.sheared };
  const extra = m.saveExtra?.();   // a horse's coat, gifts and saddle; a duck's plumage
  if (extra) a.extra = extra;
  if (m.leash) a.leash = m.leash.knot ? { knot: { ...m.leash.knot } } : 'player';
  return a;
}

export function restoreAnimal(scene, world, a) {
  const Cls = KEPT[a.kind];
  if (!Cls) return null;
  const mob = new Cls(scene, world, a.x, a.y + 0.05, a.z);
  mob.persistent = true;
  mob.health = a.health ?? mob.health;
  mob.breedCooldown = a.breedCooldown ?? 0;
  if (a.baby) mob.setBaby(true, a.grow || 300);
  if (a.sheared) mob.setSheared?.(true);
  if (a.extra) mob.loadExtra?.(a.extra);
  if (a.leash?.knot) mob.leashTo({ knot: a.leash.knot });
  else if (a.leash === 'player') mob.pendingLeash = true;   // picked up again once the player's about
  return mob;
}

// every kept animal, live or stashed, for the save file
EntityManager.prototype.keptAnimals = function keptAnimals() {
  const live = this.mobs.filter((m) => m.persistent && !m.tamed && !m.dead && m.dying === undefined && KEPT[m.kind]).map(serializeAnimal);
  return [...live, ...this.stash];
};
