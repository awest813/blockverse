// The Scorchlands' own monsters.
//
//   Skeleton Knight  armoured bones with a sword and a shield. The shield
//                    turns blows and arrows from the front; it drops while
//                    the knight swings, and enough battering knocks it aside.
//   Ash Drake, Scorch Dragon  (fliers: below)

import { Mob } from './mob.js';
import { Zombie } from './mobs.js';
import { I } from '../items/itemIds.js';
import { B } from '../blocks/blocks.js';
import { makeStack } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

const GUARD_ARC = 0.45;     // cos of the half-angle the shield covers (about 63 degrees)
const GUARD_BREAK = 10;     // damage soaked before the shield is knocked aside
const SWING_TIME = 0.45;    // the wind-up of a sword stroke (the shield is down)

export class SkeletonKnight extends Zombie {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'knight';
    this.ambientSound = 'skeleton';
    this.health = 30;
    this.speed = 1.1;
    this.fleeSpeed = 2.5;
    this.meleeDamage = 5;
    this.swing = 0;        // >0: a stroke coming
    this.guardDown = 0;    // >0: shield knocked aside
    this.soaked = 0;
  }

  // blackened bones in battered iron, a red plume, a sword and a kite shield
  buildModel() {
    const bone = 0x8a8478, iron = 0x3c3c42, ironD = 0x2a2a30, red = 0x8a1e16;
    this.part(0.5, 0.72, 0.3, iron, 0, 1.12, 0);                    // breastplate
    this.part(0.34, 0.12, 0.24, ironD, 0, 0.8, 0);                  // belt
    this.part(0.4, 0.4, 0.4, bone, 0, 1.72, 0);                     // skull
    this.part(0.46, 0.24, 0.46, iron, 0, 1.88, 0);                  // helm
    this.part(0.46, 0.06, 0.04, ironD, 0, 1.74, -0.23);             // visor bar
    this.glowPart(0.08, 0.06, 0.02, 0xff6a1a, -0.1, 1.68, -0.215);  // ember eyes
    this.glowPart(0.08, 0.06, 0.02, 0xff6a1a, 0.1, 1.68, -0.215);
    this.part(0.08, 0.22, 0.34, red, 0, 2.08, 0.04);                // plume
    this.part(0.12, 0.12, 0.6, bone, 0.32, 1.36, -0.24);            // sword arm
    this.sword = this.part(0.06, 0.06, 0.95, 0xb8b8c0, 0.32, 1.36, -0.82);
    this.part(0.22, 0.05, 0.05, 0x6a4a2a, 0.32, 1.36, -0.5);       // crossguard
    this.part(0.12, 0.12, 0.4, bone, -0.32, 1.3, -0.14);            // shield arm
    this.shield = this.part(0.5, 0.72, 0.06, 0x4a2c20, -0.26, 1.22, -0.4);
    this.emblem = this.part(0.14, 0.14, 0.02, 0xd8641a, -0.26, 1.3, -0.44);   // an ember on its face
    this.legs = [this.legPart(bone, -0.12), this.legPart(bone, 0.12)];
  }

  legPart(color, x) {
    const leg = this.part(0.12, 0.76, 0.12, color, x, 0.76, 0);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.38, 0);
    leg.position.y = 0.76;
    return leg;
  }

  // the shield covers the front, unless it's down
  guards(source) {
    if (!source || source.kind === 'explosion' || this.guardDown > 0 || this.swing > 0) return false;
    if (this.dead || this.dying !== undefined) return false;
    const dx = source.x - this.x, dz = source.z - this.z, d = Math.hypot(dx, dz) || 1;
    return (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / d > GUARD_ARC;
  }

  damage(amount, source) {
    if (this.hurtCooldown > 0 || !this.guards(source)) return super.damage(amount, source);
    // turned on the shield: a clang, a shove, and the arm tires
    this.hurtCooldown = 0.3;
    this.fx?.sound('clang', { pos: this });
    this.fx?.spark?.(this.x - Math.sin(this.yaw) * 0.5, this.y + 1.2, this.z - Math.cos(this.yaw) * 0.5, 0xffd890, 6);
    const dx = this.x - source.x, dz = this.z - source.z, d = Math.hypot(dx, dz) || 1;
    this.vx += (dx / d) * 2.5;
    this.vz += (dz / d) * 2.5;
    this.soaked += amount;
    if (this.soaked >= this.guardBreak()) {
      this.soaked = 0;
      this.guardDown = 2.5;
      this.fx?.sound('shieldbreak', { pos: this });
    }
    return true;   // (a blow on the shield still lands: the swing is spent)
  }

  guardBreak() { return GUARD_BREAK; }

  think(dt, player, playerDist) {
    this.guardDown = Math.max(0, this.guardDown - dt);
    if (this.swing > 0) {
      // the stroke: it plants its feet, and the blow falls at the end
      this.swing -= dt;
      this.moving = false;
      this.steer(player, 1);
      if (this.swing <= 0) {
        this.attackCooldown = 1.2;
        if (this.dist3(player) < 2 * (this.reach ?? 1)) this.meleeHit(player, this.meleeDamage, this.kind);
        this.fx?.sound('sweep', { pos: this });
      }
      return;
    }
    // (a zombie's chase, but a stroke instead of a grab)
    const close = this.state === 'chase' && this.dist3(player) < 1.8 * (this.reach ?? 1);
    if (close && this.attackCooldown <= 0 && this.canSee(player)) {
      this.swing = SWING_TIME;
      return;
    }
    const cd = this.attackCooldown;
    this.attackCooldown = Infinity;   // (keeps the zombie's own grab from firing)
    super.think(dt, player, playerDist);
    this.attackCooldown = Math.max(0, cd - dt);
  }

  animate(dt) {
    super.animate(dt);
    // the sword rises for the stroke; the shield swings wide when knocked aside
    const raise = this.swing > 0 ? 1 - this.swing / SWING_TIME : 0;
    this.sword.position.y = 1.36 + raise * 0.5;
    this.sword.rotation.x = raise * 0.9;
    const open = this.guardDown > 0 || this.swing > 0;
    this.shield.position.x = open ? -0.48 : -0.26;
    this.shield.rotation.y = open ? -0.9 : 0;
    this.emblem.position.x = this.shield.position.x;
    this.emblem.rotation.y = this.shield.rotation.y;
  }

  // bones, and now and then a bit of its kit
  onDeath() {
    const drops = [{ id: I.BONE, count: 1 + ((Math.random() * 2) | 0) }];
    const r = Math.random();
    if (r < 0.12) drops.push(makeStack(I.IRON_INGOT, 1));
    else if (r < 0.16) drops.push(makeStack(I.GOLD_INGOT, 1));
    if (Math.random() < 0.03) {
      const sword = makeStack(I.IRON_SWORD, 1);
      if (sword.dur !== undefined) sword.dur = Math.max(1, Math.floor(sword.dur * (0.2 + Math.random() * 0.5)));
      drops.push(sword);
    }
    this.dropFn?.(drops);
  }
}

// ---------- fliers ----------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// a wing hinged at the body (its geometry shifted so it turns at the root)
function wing(mob, side, span, depth, color, x, y, z) {
  const w = mob.part(span, 0.05, depth, color, x, y, z);
  w.geometry = w.geometry.clone();
  w.geometry.translate(side * span / 2, 0, 0);
  w.position.x = x;
  return w;
}

class Flier extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.flier = true;
    this.hostile = true;
    this.fireproof = true;
    this.moving = true;
  }

  // head for a point in the air
  flyTo(tx, ty, tz, climb = 4) {
    this.targetYaw = Math.atan2(-(tx - this.x), -(tz - this.z));
    this.targetVy = clamp((ty - this.y) * 1.2, -climb, climb);
  }

  // spit a fireball at the player's chest (leading a moving target a little)
  spit(player, speed, dmg, spread = 0) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const ox = this.x + fx * this.w * 0.7, oy = this.y + this.h * 0.6, oz = this.z + fz * this.w * 0.7;
    const t = Math.hypot(player.x - ox, player.z - oz) / speed;
    const dx = player.x + player.vx * t * 0.5 - ox, dy = player.y + 1.1 - oy, dz = player.z + player.vz * t * 0.5 - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const c = Math.cos(spread), s = Math.sin(spread);
    const vx = (dx / len) * speed, vz = (dz / len) * speed;
    this.fx?.fireball?.(ox, oy, oz, vx * c - vz * s, (dy / len) * speed, vx * s + vz * c, dmg, this.fireCause);
  }

  // the ground (or lava) under it
  groundBelow() {
    const bx = Math.floor(this.x), bz = Math.floor(this.z);
    let y = Math.floor(this.y);
    while (y > 1 && y > this.y - 48 && this.world.getBlockW(bx, y, bz) === B.AIR) y--;
    return y;
  }
}

//   Ash Drake  a small, soot-black dragon. Circles overhead and spits
//              fireballs (they set you alight, and never harm a block).
export class AshDrake extends Flier {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'drake';
    this.fireCause = 'drake';
    this.w = 0.9; this.h = 0.7;
    this.health = 16;
    this.speed = 3.2;
    this.fleeSpeed = 6;
    this.ambientSound = 'drake';
    this.shootCooldown = 2 + Math.random() * 2;
    this.orbit = Math.random() * Math.PI * 2;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    for (const m of this.materials) m.glow = Math.max(m.glow ?? 0, 0.3);
  }

  buildModel() {
    const soot = 0x2e2a2c, sootL = 0x403a3a, ember = 0xd8501a;
    this.part(0.46, 0.38, 0.9, soot, 0, 0.36, 0);                       // body
    this.glowPart(0.3, 0.05, 0.6, ember, 0, 0.16, 0, 0.7);              // a smouldering belly
    this.part(0.22, 0.22, 0.34, soot, 0, 0.5, -0.56);                   // neck
    this.part(0.3, 0.26, 0.36, sootL, 0, 0.6, -0.84);                   // head
    this.part(0.22, 0.08, 0.22, soot, 0, 0.48, -0.92);                  // jaw
    this.glowPart(0.06, 0.05, 0.02, 0xffa030, -0.1, 0.66, -1.025);
    this.glowPart(0.06, 0.05, 0.02, 0xffa030, 0.1, 0.66, -1.025);
    this.part(0.05, 0.05, 0.22, 0x8a8478, -0.1, 0.76, -0.68);           // horns
    this.part(0.05, 0.05, 0.22, 0x8a8478, 0.1, 0.76, -0.68);
    this.part(0.14, 0.12, 0.8, soot, 0, 0.34, 0.82);                    // tail
    this.part(0.24, 0.04, 0.16, ember, 0, 0.36, 1.2);                   // its fiery tip
    this.wings = [wing(this, -1, 0.95, 0.55, sootL, -0.22, 0.48, 0.02), wing(this, 1, 0.95, 0.55, sootL, 0.22, 0.48, 0.02)];
  }

  think(dt, player, playerDist) {
    this.stateTime -= dt;
    this.shootCooldown -= dt;
    this.moving = true;
    if (this.senses(player, 28, dt)) {
      // wheel round above you, spitting fire
      this.state = 'chase';
      this.orbit += dt * 0.7 * this.orbitDir;
      this.flyTo(player.x + Math.cos(this.orbit) * 8, player.y + 5, player.z + Math.sin(this.orbit) * 8);
      if (this.shootCooldown <= 0 && playerDist < 22 && this.canSee(player, 0.4)) {
        this.shootCooldown = 2.6 + Math.random() * 1.6;
        this.spit(player, 14, 3);
      }
      return;
    }
    if (this.state === 'chase') this.state = 'wander';
    if (this.stateTime <= 0) {
      // drift about, high over the dead trees
      this.state = 'wander';
      this.stateTime = 2 + Math.random() * 3;
      this.targetYaw = this.yaw + (Math.random() - 0.5) * 2.5;
      const want = this.groundBelow() + 9 + Math.random() * 6;
      this.targetVy = clamp((want - this.y) * 0.5, -2.5, 2.5);
    }
  }

  animate() {
    const f = Math.sin(this.age * 11) * 0.7;
    this.wings[0].rotation.z = -f;
    this.wings[1].rotation.z = f;
  }

  // charcoal, and now and then a scale
  onDeath() {
    const drops = [{ id: I.CHARCOAL, count: (Math.random() * 3) | 0 }];
    if (Math.random() < 0.25) drops.push(makeStack(I.DRAGON_SCALE, 1));
    this.dropFn?.(drops);
  }
}

//   Scorch Dragon  the Scorchlands' master, roosting on its crown of spires.
//                  It wheels overhead loosing fire, and dives at you; hurt
//                  to half, it calls its drakes, and comes down low to
//                  breathe fire. Beaten, it's back the next time you come.
const DRAGON_HEALTH = [1, 0.8, 1, 1.3];   // by difficulty
const CIRCLE_R = 18, CIRCLE_UP = 18;

export class ScorchDragon extends Flier {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'dragon';
    this.fireCause = 'dragonfire';
    this.boss = { name: 'Scorch Dragon' };
    this.w = 3; this.h = 1.8;
    this.baseHealth = 220;
    this.maxHealth = this.health = 220;
    this.speed = 6;
    this.fleeSpeed = 7.5;
    this.countsForCap = false;
    this.ambientSound = null;
    this.roost = { x, y: y - CIRCLE_UP, z };
    this.mode = 'circle';
    this.modeT = 0;
    this.attackT = 6;
    this.volleyT = 3;
    this.orbit = 0;
    this.beatT = 0;
    // its own embers light it a little: never lost against the night sky
    for (const m of this.materials) m.glow = Math.max(m.glow ?? 0, 0.4);
  }

  setDifficulty(d) {
    this.maxHealth = this.health = Math.round(this.baseHealth * (DRAGON_HEALTH[d] ?? 1));
    return this;
  }

  buildModel() {
    const hide = 0x5a2418, hideL = 0x7a3020, belly = 0xd8501c, horn = 0xd8ccb0;
    this.part(1.5, 1.1, 3.2, hide, 0, 0.9, 0);                        // body
    this.glowPart(1.0, 0.1, 2.4, belly, 0, 0.32, 0, 0.6);             // a glowing belly
    for (let i = 0; i < 5; i++) this.part(0.14, 0.34, 0.3, horn, 0, 1.6, -1.2 + i * 0.6);   // spines
    this.part(0.7, 0.7, 1.4, hide, 0, 1.3, -2.1);                     // neck
    this.part(0.9, 0.7, 1.2, hideL, 0, 1.6, -3.1);                    // head
    this.part(0.7, 0.24, 0.9, hide, 0, 1.18, -3.2);                   // jaw
    this.glowPart(0.14, 0.12, 0.04, 0xffc040, -0.3, 1.78, -3.71);     // eyes
    this.glowPart(0.14, 0.12, 0.04, 0xffc040, 0.3, 1.78, -3.71);
    this.part(0.14, 0.14, 0.8, horn, -0.3, 2.1, -2.7);                // horns
    this.part(0.14, 0.14, 0.8, horn, 0.3, 2.1, -2.7);
    this.part(0.6, 0.5, 2.4, hide, 0, 0.9, 2.7);                      // tail
    this.part(0.3, 0.3, 1.6, hide, 0, 0.9, 4.6);
    this.glowPart(0.8, 0.1, 0.5, belly, 0, 0.9, 5.4, 0.7);            // its blade of a tip
    this.legs = [this.part(0.4, 0.8, 0.4, hide, -0.6, 0.2, -0.9), this.part(0.4, 0.8, 0.4, hide, 0.6, 0.2, -0.9),
      this.part(0.4, 0.8, 0.4, hide, -0.6, 0.2, 1.0), this.part(0.4, 0.8, 0.4, hide, 0.6, 0.2, 1.0)];
    this.wings = [wing(this, -1, 4.2, 2.4, hideL, -0.7, 1.3, -0.2), wing(this, 1, 4.2, 2.4, hideL, 0.7, 1.3, -0.2)];
  }

  // a boss isn't bounced about by a sword
  damage(amount, source) {
    const before = [this.vx, this.vy, this.vz];
    const hit = super.damage(amount, source);
    if (hit) { this.vx = before[0]; this.vy = before[1]; this.vz = before[2]; }
    return hit;
  }

  die() {
    if (this.dying !== undefined) return;
    super.die();
    this.fx?.sound('dragon', { pos: this, vol: 1.2 });
    this.fx?.bossDown?.(this);
  }

  think(dt, player) {
    const r = this.roost;
    this.moving = true;
    this.dashSpeed = 0;
    const engaged = !player.dead && player.mode !== GAMEMODE_CREATIVE && Math.hypot(player.x - r.x, player.z - r.z) < 60;
    // wingbeats
    if ((this.beatT -= dt) <= 0) { this.beatT = this.mode === 'dive' ? 0.6 : 1.1; this.fx?.sound('wingbeat', { pos: this }); }
    // hurt to half: it calls its drakes and fights on enraged
    if (!this.enraged && this.health <= this.maxHealth / 2) {
      this.enraged = true;
      this.fx?.sound('dragon', { pos: this });
      this.fx?.notify?.('The Scorch Dragon calls its drakes!');
      for (let i = 0; i < 2; i++) {
        const d = new AshDrake(this.scene, this.world, this.x + (i ? 3 : -3), this.y, this.z);
        d.noLoot = true;   // (summoned: they drop nothing)
        this.fx?.spawn?.(d);
      }
      this.attackT = Math.min(this.attackT, 2);
    }
    if (!engaged && this.mode !== 'circle') this.mode = 'climb';
    switch (this.mode) {
      case 'dive': {
        // straight at you; a raking blow if it connects, then back up
        // (a straight line down at you: the descent keeps pace with the run in)
        const dx = player.x - this.x, dy = player.y + 0.8 - this.y, dz = player.z - this.z, len = Math.hypot(dx, dy, dz) || 1;
        const speed = this.enraged ? 15 : 13;
        this.targetYaw = Math.atan2(-dx, -dz);
        this.dashSpeed = Math.max(2, (speed * Math.hypot(dx, dz)) / len);
        this.targetVy = (speed * dy) / len;
        if (this.dist3(player) < 3.2 && this.meleeHit(player, 8, 'dragon')) {
          const dx = player.x - this.x, dz = player.z - this.z, d = Math.hypot(dx, dz) || 1;
          player.vx += (dx / d) * 10;
          player.vz += (dz / d) * 10;
          player.vy = Math.max(player.vy, 8);
          this.mode = 'climb';
        }
        if ((this.modeT -= dt) <= 0) this.mode = 'climb';
        break;
      }
      case 'breathe': {
        // down low beside you, a long stream of fire
        const dx = this.x - player.x, dz = this.z - player.z, d = Math.hypot(dx, dz) || 1;
        const hx = player.x + (dx / d) * 4.5, hz = player.z + (dz / d) * 4.5, hy = player.y + 2.4;
        const far = Math.hypot(hx - this.x, hz - this.z) > 1.5;
        this.flyTo(hx, hy, hz, 6);
        this.moving = far;
        if (!far) {
          this.steer(player, 1);
          this.breathe(dt, player);
        }
        if ((this.modeT -= dt) <= 0) this.mode = 'climb';
        break;
      }
      case 'climb':
        this.orbit = Math.atan2(this.z - r.z, this.x - r.x);
        this.flyTo(r.x + Math.cos(this.orbit) * CIRCLE_R, r.y + CIRCLE_UP, r.z + Math.sin(this.orbit) * CIRCLE_R, 6);
        if (this.y > r.y + CIRCLE_UP - 5) this.mode = 'circle';
        break;
      default: {
        // wheel round the roost, loosing fire at you
        this.orbit += dt * 0.38;
        this.flyTo(r.x + Math.cos(this.orbit) * CIRCLE_R, r.y + CIRCLE_UP, r.z + Math.sin(this.orbit) * CIRCLE_R);
        if (!engaged) break;
        if ((this.volleyT -= dt) <= 0) {
          this.volleyT = this.enraged ? 3.5 : 5;
          if (this.dist3(player) < 40 && this.canSee(player, 1.2)) for (const s of [-0.12, 0, 0.12]) this.spit(player, 16, 4, s);
        }
        if ((this.attackT -= dt) <= 0) {
          this.attackT = this.enraged ? 7 : 10;
          if (this.enraged && Math.random() < 0.5) { this.mode = 'breathe'; this.modeT = 5; this.fx?.sound('dragon', { pos: this, vol: 0.7 }); }
          else { this.mode = 'dive'; this.modeT = 3.5; this.fx?.sound('dragon', { pos: this, vol: 0.8 }); }
        }
      }
    }
  }

  // fire from the jaws: flames along its gaze, and a burn for whoever's in them
  breathe(dt, player) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const mx = this.x + fx * 3.8, my = this.y + 1.3, mz = this.z + fz * 3.8;
    this.flameT = (this.flameT ?? 0) - dt;
    if (this.flameT > 0) return;
    this.flameT = 0.08;
    const dx = player.x - mx, dy = player.y + 0.9 - my, dz = player.z - mz, len = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i < 3; i++) {
      const s = 7 + Math.random() * 3;
      this.fx?.flame?.(mx, my, mz, (fx * 0.6 + (dx / len) * 0.4) * s + (Math.random() - 0.5) * 2, (dy / len) * s * 0.6 + (Math.random() - 0.5) * 1.5, (fz * 0.6 + (dz / len) * 0.4) * s + (Math.random() - 0.5) * 2);
    }
    if ((this.roarT = (this.roarT ?? 0) - 0.08) <= 0) { this.roarT = 1.1; this.fx?.sound('breath', { pos: this }); }
    // in the cone, close enough, nothing in the way: it burns
    const toward = ((dx / len) * fx + (dz / len) * fz) / (Math.hypot(dx / len, dz / len) || 1);
    if (len < 9 && toward > 0.7 && this.canSee(player, 1.3)) {
      player.damage(2, 'dragonfire');
      player.fireTime = Math.max(player.fireTime ?? 0, 2);
    }
  }

  animate() {
    const slow = this.mode === 'dive' ? 0.15 : 1;
    const f = Math.sin(this.age * 4.2) * 0.55 * slow + (this.mode === 'dive' ? 0.35 : 0);
    this.wings[0].rotation.z = -f;
    this.wings[1].rotation.z = f;
  }

  onDeath() {
    const roll = (lo, hi) => lo + ((Math.random() * (hi - lo + 1)) | 0);
    this.dropFn?.([makeStack(I.DRAGON_SCALE, roll(6, 10)), makeStack(I.DRAGON_FANG, 1), makeStack(I.DIAMOND, roll(2, 4)),
      makeStack(I.GOLD_INGOT, roll(4, 8)), makeStack(I.GOLDEN_APPLE, 1)]);
  }
}
