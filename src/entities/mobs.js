// Concrete mob types: pig, sheep (passive); zombie, skeleton, spider,
// creeper (hostile); plus primed TNT, which reuses mob physics.
// Original box-model designs built from shaded colored parts.

import * as THREE from 'three';
import { Mob } from './mob.js';
import { I } from '../items/itemIds.js';
import { B, isSolid } from '../blocks/blocks.js';

export class Pig extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.8;
    this.h = 0.9;
    this.health = 10;
    this.kind = 'pig';
  }

  buildModel() {
    const pink = 0xefa2a0, dark = 0xd98886, snoutC = 0xdf8886;
    this.part(0.9, 0.55, 0.6, pink, 0, 0.55, 0);              // body
    const head = this.part(0.45, 0.45, 0.45, pink, 0, 0.72, -0.55); // head
    this.part(0.2, 0.14, 0.08, snoutC, 0, 0.66, -0.8);        // snout
    // eyes
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, -0.12, 0.82, -0.78);
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, 0.12, 0.82, -0.78);
    // legs (pivot at hip: offset geometry down)
    this.legs = [
      this.legPart(dark, -0.25, -0.22),
      this.legPart(dark, 0.25, -0.22),
      this.legPart(dark, -0.25, 0.22),
      this.legPart(dark, 0.25, 0.22),
    ];
    this.head = head;
  }

  legPart(color, x, z) {
    const leg = this.part(0.18, 0.32, 0.18, color, x, 0.32, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.16, 0);
    leg.position.y = 0.32;
    return leg;
  }

  onDeath() {
    this.dropFn?.([{ id: I.PORKCHOP_RAW, count: 1 + ((Math.random() * 2) | 0) }]);
  }
}

export class Sheep extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.9;
    this.h = 1.1;
    this.health = 8;
    this.speed = 1.3;
    this.kind = 'sheep';
  }

  buildModel() {
    const wool = 0xe8e6e0, skin = 0xcfae94, legC = 0xbfa088;
    this.part(1.0, 0.7, 0.65, wool, 0, 0.75, 0);              // woolly body
    this.part(0.42, 0.4, 0.4, skin, 0, 1.0, -0.6);            // head
    this.part(0.46, 0.28, 0.2, wool, 0, 1.14, -0.52);         // wool cap
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, -0.11, 1.06, -0.81);
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, 0.11, 1.06, -0.81);
    this.legs = [
      this.legPart(legC, -0.28, -0.22),
      this.legPart(legC, 0.28, -0.22),
      this.legPart(legC, -0.28, 0.22),
      this.legPart(legC, 0.28, 0.22),
    ];
  }

  legPart(color, x, z) {
    const leg = this.part(0.16, 0.45, 0.16, color, x, 0.45, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.22, 0);
    leg.position.y = 0.45;
    return leg;
  }

  onDeath() {
    this.dropFn?.([
      { id: B.WOOL, count: 1 },
      { id: I.MUTTON_RAW, count: 1 + ((Math.random() * 2) | 0) },
    ]);
  }
}

export class Zombie extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6;
    this.h = 1.9;
    this.health = 20;
    this.hostile = true;
    this.speed = 1.2;
    this.fleeSpeed = 2.9;   // chase speed
    this.attackCooldown = 0;
    this.burnTimer = 0;
    this.kind = 'zombie';
  }

  buildModel() {
    const skinC = 0x5a9c50, shirt = 0x3a6a8a, pants = 0x35506b;
    this.part(0.5, 0.72, 0.3, shirt, 0, 1.12, 0);             // torso
    this.part(0.42, 0.42, 0.42, skinC, 0, 1.72, 0);           // head
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, -0.1, 1.78, -0.22);
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, 0.1, 1.78, -0.22);
    // outstretched arms
    this.part(0.16, 0.16, 0.6, skinC, -0.34, 1.36, -0.24);
    this.part(0.16, 0.16, 0.6, skinC, 0.34, 1.36, -0.24);
    this.legs = [
      this.legPart(pants, -0.14),
      this.legPart(pants, 0.14),
    ];
  }

  legPart(color, x) {
    const leg = this.part(0.2, 0.76, 0.24, color, x, 0.76, 0);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.38, 0);
    leg.position.y = 0.76;
    return leg;
  }

  think(dt, player, playerDist) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.burnInDaylight(dt)) return;

    if (!player.dead && playerDist < 18) {
      this.state = 'chase';
      this.moving = true;
      const dx = player.x - this.x, dz = player.z - this.z;
      this.targetYaw = Math.atan2(-dx, -dz);
      // melee
      if (playerDist < 1.4 && this.attackCooldown <= 0) {
        const dy = Math.abs((player.y + 0.9) - (this.y + 1));
        if (dy < 1.6) {
          player.damage(3, 'zombie');
          this.attackCooldown = 1.1;
        }
      }
    } else if (this.state === 'chase') {
      this.state = 'idle';
      this.stateTime = 1;
      this.moving = false;
    } else {
      super.think(dt, player, playerDist);
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.ROTTEN_FLESH, count: 1 + ((Math.random() * 2) | 0) }]);
  }
}

// Line of sight from a mob's eyes to the player's chest: march the segment
// and stop at solid blocks only (grass and flowers don't block a shot).
function canSee(mob, player, eyeY) {
  const ox = mob.x, oy = mob.y + eyeY, oz = mob.z;
  const dx = player.x - ox, dy = player.y + 1.2 - oy, dz = player.z - oz;
  const steps = Math.ceil(Math.hypot(dx, dy, dz) / 0.3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isSolid(mob.world.getBlockW(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t)))) return false;
  }
  return true;
}

export class Skeleton extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6;
    this.h = 1.9;
    this.health = 20;
    this.hostile = true;
    this.speed = 1.2;
    this.fleeSpeed = 2.4;
    this.shootCooldown = 1 + Math.random();
    this.kind = 'skeleton';
  }

  buildModel() {
    const bone = 0xd8d6cc, boneD = 0xb4b2a8;
    this.part(0.46, 0.7, 0.22, boneD, 0, 1.12, 0);            // ribcage
    this.part(0.42, 0.42, 0.42, bone, 0, 1.72, 0);            // skull
    this.part(0.1, 0.1, 0.02, 0x1a1a1a, -0.1, 1.76, -0.22);   // eye sockets
    this.part(0.1, 0.1, 0.02, 0x1a1a1a, 0.1, 1.76, -0.22);
    this.part(0.1, 0.1, 0.62, bone, -0.3, 1.38, -0.26);       // bow arm
    this.part(0.1, 0.1, 0.62, bone, 0.3, 1.38, -0.26);
    this.part(0.06, 0.7, 0.06, 0x6b4a2a, 0, 1.38, -0.58);     // bow
    this.legs = [this.legPart(bone, -0.12), this.legPart(bone, 0.12)];
  }

  legPart(color, x) {
    const leg = this.part(0.12, 0.76, 0.12, color, x, 0.76, 0);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.38, 0);
    leg.position.y = 0.76;
    return leg;
  }

  think(dt, player, playerDist) {
    if (this.burnInDaylight(dt)) return;
    this.shootCooldown -= dt;
    if (player.dead || playerDist > 16) {
      if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
      super.think(dt, player, playerDist);
      return;
    }
    // keep a shooting distance: close in when far, back off when crowded
    this.state = 'chase';
    if (playerDist > 10) { this.steer(player, 1); this.moving = true; }
    else if (playerDist < 5) { this.steer(player, -1); this.moving = true; }
    else { this.steer(player, 1); this.moving = false; }

    if (this.shootCooldown <= 0 && canSee(this, player, 1.6)) {
      this.shootCooldown = 1.6 + Math.random() * 0.8;
      if (!this.moving || playerDist < 5) this.steer(player, 1);
      const ox = this.x, oy = this.y + 1.5, oz = this.z;
      const dx = player.x - ox, dy = player.y + 1.1 - oy, dz = player.z - oz;
      const flat = Math.hypot(dx, dz);
      const speed = 18;
      const t = flat / speed;
      // lob to cancel gravity over the flight time, plus a little inaccuracy
      const spread = () => (Math.random() - 0.5) * 0.9;
      this.fx?.shoot(ox, oy, oz,
        (dx / flat) * speed + spread(), dy / t + 10 * t + spread(), (dz / flat) * speed + spread(),
        2 + ((Math.random() * 2) | 0));
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.BONE, count: (Math.random() * 3) | 0 }]);
  }
}

export class Spider extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 1.2;
    this.h = 0.9;
    this.health = 16;
    this.hostile = true;
    this.climber = true;
    this.speed = 1.6;
    this.fleeSpeed = 3.8;
    this.attackCooldown = 0;
    this.angry = 0;          // seconds of aggression after being hit in daylight
    this.kind = 'spider';
  }

  buildModel() {
    const body = 0x2e2a28, bodyL = 0x4a4440;
    this.part(0.7, 0.55, 0.9, body, 0, 0.55, 0.3);            // abdomen
    this.part(0.5, 0.45, 0.45, bodyL, 0, 0.55, -0.35);        // head
    for (const x of [-0.13, 0.13]) this.part(0.09, 0.07, 0.02, 0xd02020, x, 0.62, -0.58);   // red eyes
    for (const x of [-0.2, 0.2]) this.part(0.06, 0.05, 0.02, 0xd02020, x, 0.52, -0.58);
    this.legs = [];
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const leg = this.part(0.9, 0.08, 0.08, body, side * 0.5, 0.55, -0.25 + i * 0.22);
        leg.rotation.z = side * 0.45;
        this.legs.push(leg);
      }
    }
  }

  animate() {
    const swing = Math.sin(this.walkPhase * 1.5) * (this.moving ? 0.35 : 0);
    this.legs.forEach((leg, i) => { leg.rotation.y = (i % 2 ? swing : -swing) * (i % 4 < 2 ? 1 : -1); });
  }

  damage(amount, source) {
    if (source) this.angry = 10;
    return super.damage(amount, source);
  }

  think(dt, player, playerDist) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.angry = Math.max(0, this.angry - dt);
    // spiders only hunt in the dark, unless you started it
    const day = this.world.materials.uniforms.uDay.value;
    const hunting = !player.dead && playerDist < 16 && (day < 0.6 || this.angry > 0);
    if (hunting) {
      this.state = 'chase';
      this.moving = true;
      this.steer(player, 1);
      if (playerDist < 1.6 && this.attackCooldown <= 0 && Math.abs(player.y - this.y) < 1.6) {
        player.damage(2, 'spider');
        this.attackCooldown = 1;
        // pounce
        if (this.onGround) this.vy = 5;
      }
    } else {
      if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
      super.think(dt, player, playerDist);
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.STRING, count: (Math.random() * 3) | 0 }]);
  }
}

const FUSE_TIME = 1.5;

export class Creeper extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6;
    this.h = 1.7;
    this.health = 20;
    this.hostile = true;
    this.speed = 1.2;
    this.fleeSpeed = 2.4;
    this.fuse = 0;
    this.kind = 'creeper';
  }

  buildModel() {
    const green = 0x4fae3c, greenD = 0x3a8a2c;
    this.body = this.part(0.5, 0.8, 0.3, green, 0, 0.82, 0);
    this.part(0.46, 0.46, 0.46, green, 0, 1.45, 0);
    // the face
    this.part(0.1, 0.1, 0.02, 0x152a12, -0.1, 1.52, -0.24);
    this.part(0.1, 0.1, 0.02, 0x152a12, 0.1, 1.52, -0.24);
    this.part(0.1, 0.16, 0.02, 0x152a12, 0, 1.4, -0.24);
    this.legs = [
      this.legPart(greenD, -0.13, -0.12), this.legPart(greenD, 0.13, -0.12),
      this.legPart(greenD, -0.13, 0.12), this.legPart(greenD, 0.13, 0.12),
    ];
  }

  legPart(color, x, z) {
    const leg = this.part(0.2, 0.42, 0.2, color, x, 0.42, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.21, 0);
    leg.position.y = 0.42;
    return leg;
  }

  think(dt, player, playerDist) {
    if (player.dead || playerDist > 16) {
      this.fuse = Math.max(0, this.fuse - dt);
      if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
      super.think(dt, player, playerDist);
      return;
    }
    // creepers keep well away from cats
    const cat = (this.fx?.mobs() ?? []).find((m) => m.kind === 'cat' && !m.dead && Math.hypot(m.x - this.x, m.z - this.z) < 6);
    if (cat) {
      this.fuse = 0;
      this.state = 'flee';
      this.moving = true;
      this.targetYaw = Math.atan2(-(cat.x - this.x), -(cat.z - this.z)) + Math.PI;
      return;
    }
    this.state = 'chase';
    this.steer(player, 1);
    if (playerDist < 3 || (this.fuse > 0 && playerDist < 7)) {
      // stop and hiss; walking away far enough defuses it
      if (this.fuse === 0) this.fx?.sound('fuse');
      this.moving = false;
      this.fuse += dt;
      if (this.fuse >= FUSE_TIME) {
        this.kill();   // first, so the blast doesn't also "kill" it for drops
        this.fx?.explode(this.x, this.y + 0.8, this.z, 3);
        return;
      }
    } else {
      this.fuse = Math.max(0, this.fuse - dt);
      this.moving = true;
    }
  }

  update(dt, player) {
    super.update(dt, player);
    if (this.dead) return;
    // swell and flash white while the fuse burns
    const f = this.fuse / FUSE_TIME;
    this.group.scale.setScalar(1 + f * 0.25);
    if (f > 0 && Math.floor(this.fuse * 8) % 2 === 0) {
      for (const { mat } of this.materials) mat.color.lerp(new THREE.Color(0xffffff), 0.7);
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.GUNPOWDER, count: (Math.random() * 3) | 0 }]);
  }
}

// A lit TNT block: falls like a block, flashes, then explodes.
export class PrimedTnt extends Mob {
  constructor(scene, world, x, y, z, fuse = 3) {
    super(scene, world, x, y, z);
    this.w = 0.98;
    this.h = 0.98;
    this.fuse = fuse;
    this.kind = 'tnt';
    this.countsForCap = false;
    this.vy = 3;
  }

  buildModel() {
    this.part(0.98, 0.98, 0.98, 0xcc3024, 0, 0.49, 0);
    this.part(1.0, 0.36, 1.0, 0xece8dc, 0, 0.49, 0);
  }

  think(dt) {
    this.moving = false;
    this.fuse -= dt;
    if (this.fuse <= 0) {
      this.kill();
      this.fx?.explode(this.x, this.y + 0.5, this.z, 4);
    }
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.dead && Math.floor(this.fuse * 4) % 2 === 0) {
      for (const { mat } of this.materials) mat.color.lerp(new THREE.Color(0xffffff), 0.6);
    }
  }

  damage() { return false; }   // can't be punched out
}
