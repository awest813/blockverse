// The Scorchlands' own monsters.
//
//   Skeleton Knight  armoured bones with a sword and a shield. The shield
//                    turns blows and arrows from the front; it drops while
//                    the knight swings, and enough battering knocks it aside.

import { Zombie } from './mobs.js';
import { I } from '../items/itemIds.js';
import { makeStack } from '../items/items.js';

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
