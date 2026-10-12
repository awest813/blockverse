// Dungeon mini bosses. Each dungeon's monster cage is guarded by a bigger,
// tougher version of its monster, woken the first time a player walks into
// the room (see spawners.js). Beaten, it stays beaten — the spawner remembers;
// left alive, it waits there for you to come back.
//
//   Zombie Brute   (zombie cages)    slow and heavy; winds up a ground slam
//   Bone Archer    (skeleton cages)  looses three-arrow volleys, kicks you off
//   Brood Mother   (spider cages)    hunts in any light; calls spiderlings as she's hurt

import { Zombie, Skeleton, Spider } from './mobs.js';
import { I } from '../items/itemIds.js';
import { makeStack } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

const HEALTH_BY_DIFFICULTY = [1, 0.8, 1, 1.3];   // peaceful (never summoned), easy, normal, hard
const LEASH = 6;                                  // wanders back if it strays this far from its cage

const roll = (lo, hi) => lo + ((Math.random() * (hi - lo + 1)) | 0);

// shared boss setup: size, health, and the things every boss does differently
function bossify(mob, { name, health, scale }) {
  mob.boss = { name };
  mob.baseHealth = health;
  mob.maxHealth = mob.health = health;
  mob.w *= scale;
  mob.h *= scale;
  mob.group.scale.setScalar(scale);
  mob.reach = 1 + (scale - 1) * 0.6;   // long arms
  mob.fireproofSun = true;             // a dungeon dweller, but don't let a sunlit hole end the fight
  mob.countsForCap = false;
}

// shrug off most knockback: a boss isn't bounced round the room by a stick
function steady(mob, before, keep = 0.3) {
  mob.vx = before[0] + (mob.vx - before[0]) * keep;
  mob.vz = before[2] + (mob.vz - before[2]) * keep;
  mob.vy = Math.min(mob.vy, before[1] + 2);
}

const BossMixin = (Base) => class extends Base {
  // scale health to the world's difficulty when summoned
  setDifficulty(d) {
    this.maxHealth = this.health = Math.round(this.baseHealth * (HEALTH_BY_DIFFICULTY[d] ?? 1));
    return this;
  }

  damage(amount, source) {
    const before = [this.vx, this.vy, this.vz];
    const hit = super.damage(amount, source);
    if (hit) steady(this, before);
    return hit;
  }

  // with nobody to fight, drift back toward the cage it guards (runs after
  // the normal AI, so an idle boss still notices you walking in)
  leash() {
    if (!this.home || this.state === 'chase') return false;
    const d = Math.hypot(this.home.x - this.x, this.home.z - this.z);
    if (d < LEASH) return false;
    this.steer(this.home, 1);
    this.moving = true;
    return true;
  }

  die() {
    if (this.dying !== undefined) return;
    super.die();
    this.fx?.bossDown?.(this);
  }
};

export class ZombieBrute extends BossMixin(Zombie) {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'brute';
    this.speed = 0.9;
    this.fleeSpeed = 2.1;
    this.meleeDamage = 6;
    this.slamCooldown = 5;
    this.windup = 0;
    bossify(this, { name: 'Zombie Brute', health: 60, scale: 1.45 });
  }

  // hulking, grey-green, in a torn red shirt
  buildModel() { super.buildModel(0x4c7a44, 0x7a2a26, 0x3a3046); }

  think(dt, player, playerDist) {
    this.slamCooldown -= dt;
    // the slam: a short wind-up (it stops and shudders), then a shockwave
    if (this.windup > 0) {
      this.windup -= dt;
      this.moving = false;
      this.flashTime = Math.max(this.flashTime, 0.05);
      if (this.windup <= 0) this.slam(player);
      return;
    }
    if (this.state === 'chase' && this.onGround && this.slamCooldown <= 0 && this.dist3(player) < 4 && this.canSee(player)) {
      this.windup = 0.7;
      this.fx?.sound('zombie', { pos: this, vol: 1.2 });
      return;
    }
    super.think(dt, player, playerDist);
    this.leash();
  }

  slam(player) {
    this.slamCooldown = 6 + Math.random() * 3;
    this.fx?.sound('explode', { pos: this, vol: 0.45 });
    this.fx?.dust?.(this.x, this.y + 0.1, this.z);
    const dx = player.x - this.x, dz = player.z - this.z, d = Math.hypot(dx, dz) || 1;
    if (d > 4.5 || Math.abs(player.y - this.y) > 2 || player.dead || player.mode === GAMEMODE_CREATIVE) return;
    player.damage(4, this.kind);
    const push = 9 * (1 - d / 6);
    player.vx += (dx / d) * push;
    player.vz += (dz / d) * push;
    player.vy = Math.max(player.vy, 7);
  }

  onDeath() {
    const drops = [makeStack(I.IRON_INGOT, roll(3, 6)), makeStack(I.GOLDEN_APPLE, 1), makeStack(I.ROTTEN_FLESH, roll(2, 4))];
    if (Math.random() < 0.5) drops.push(makeStack(I.DIAMOND, 1));
    this.dropFn?.(drops);
  }
}

export class BoneArcher extends BossMixin(Skeleton) {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'bonearcher';
    this.kickCooldown = 0;
    this.meleeDamage = 4;
    bossify(this, { name: 'Bone Archer', health: 45, scale: 1.25 });
  }

  // yellowed bone with a dark longbow
  buildModel() {
    super.buildModel();
    this.part(0.46, 0.08, 0.46, 0x5a3a24, 0, 1.96, 0);   // a battered hood
  }

  // three arrows fanned out, each a little stronger than a skeleton's
  shootArrow(x, y, z, vx, vy, vz, dmg) {
    for (const a of [-0.13, 0, 0.13]) {
      const c = Math.cos(a), s = Math.sin(a);
      this.fx?.shoot(x, y, z, vx * c - vz * s, vy, vx * s + vz * c, dmg + 1, this.kind);
    }
  }

  think(dt, player, playerDist) {
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    // too close: a kick that sends you back out to bow range
    if (this.kickCooldown <= 0 && this.dist3(player) < 2.2 * this.reach && this.meleeHit(player, this.meleeDamage, this.kind)) {
      this.kickCooldown = 2.5;
      const dx = player.x - this.x, dz = player.z - this.z, d = Math.hypot(dx, dz) || 1;
      player.vx += (dx / d) * 6;
      player.vz += (dz / d) * 6;
    }
    super.think(dt, player, playerDist);
    this.leash();
  }

  onDeath() {
    const drops = [makeStack(I.BOW, 1), makeStack(I.ARROW, roll(8, 16)), makeStack(I.BONE, roll(3, 6))];
    if (Math.random() < 0.6) drops.push(makeStack(I.DIAMOND, 1));
    this.dropFn?.(drops);
  }
}

export class BroodMother extends BossMixin(Spider) {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'broodmother';
    this.meleeDamage = 4;
    this.angry = Infinity;   // hunts by day or night, lit room or not
    this.broods = 0;         // spiderling waves called so far
    bossify(this, { name: 'Brood Mother', health: 50, scale: 1.8 });
  }

  // near-black, with a pale hourglass on her back
  buildModel() {
    super.buildModel(0x1e1a1c, 0x3a2e34);
    this.part(0.16, 0.02, 0.3, 0xd8c8b8, 0, 0.83, 0.3);
    this.part(0.3, 0.02, 0.1, 0xd8c8b8, 0, 0.83, 0.42);
  }

  damage(amount, source) {
    const hit = super.damage(amount, source);
    this.angry = Infinity;
    // each quarter of her health lost calls a wave of spiderlings
    while (hit && this.health > 0 && this.broods < 3 && this.health <= this.maxHealth * (0.75 - this.broods * 0.25)) {
      this.broods++;
      this.callBrood();
    }
    return hit;
  }

  callBrood() {
    this.fx?.sound('spider', { pos: this, vol: 1.2 });
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = new Spider(this.scene, this.world, this.x + Math.cos(a) * 1.2, this.y + 0.3, this.z + Math.sin(a) * 1.2);
      s.kind = 'spiderling';
      s.w *= 0.45; s.h *= 0.45;
      s.group.scale.setScalar(0.45);
      s.health = 5;
      s.speed *= 1.3; s.fleeSpeed *= 1.2;
      s.meleeDamage = 1;
      s.angry = 30;
      s.noLoot = true;
      s.fromSpawner = true;
      this.fx?.spawn?.(s);
    }
  }

  think(dt, player, playerDist) {
    super.think(dt, player, playerDist);
    this.leash();
  }

  onDeath() {
    const drops = [makeStack(I.STRING, roll(5, 9)), makeStack(I.DIAMOND, roll(1, 2))];
    if (Math.random() < 0.3) drops.push(makeStack(I.GOLDEN_APPLE, 1));
    this.dropFn?.(drops);
  }
}

// which boss guards a cage of each monster
export const DUNGEON_BOSSES = { zombie: ZombieBrute, skeleton: BoneArcher, spider: BroodMother };
