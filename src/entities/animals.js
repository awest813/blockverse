// Animals: farm animals (cow, chicken), wildlife (fox, bird, fish, whale)
// and tameable pets (cat, dog). Original box-model designs, like mobs.js.

import { Mob } from './mob.js';
import { I } from '../items/itemIds.js';
import { B } from '../blocks/blocks.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// shared helpers on top of Mob
class Animal extends Mob {
  face(x, z, away = false) {
    this.targetYaw = Math.atan2(-(x - this.x), -(z - this.z)) + (away ? Math.PI : 0);
  }

  dist(o) {
    return Math.hypot(o.x - this.x, o.z - this.z);
  }

  // four legs hinged at the hip
  quadLegs(color, w, h, dx, dz, hip) {
    const leg = (x, z) => {
      const l = this.part(w, h, w, color, x, hip, z);
      l.geometry = l.geometry.clone();
      l.geometry.translate(0, -h / 2, 0);
      l.position.y = hip;
      return l;
    };
    this.legs = [leg(-dx, -dz), leg(dx, -dz), leg(-dx, dz), leg(dx, dz)];
  }

  nearest(kind, range) {
    let best = null, bestD = range;
    for (const m of this.fx?.mobs() ?? []) {
      if (m.dead || m === this || (kind && !kind(m))) continue;
      const d = this.dist(m);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }
}

// ---------- farm animals ----------

export class Cow extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.9; this.h = 1.3; this.health = 10; this.speed = 1.2; this.kind = 'cow';
  }

  buildModel() {
    const hide = 0x4a3426, spot = 0xe8e4dc, muzzle = 0xc9a48c, horn = 0xd8d0c0;
    this.part(1.0, 0.7, 0.6, hide, 0, 0.9, 0);                 // body
    this.part(0.42, 0.36, 0.36, spot, 0.15, 1.05, -0.12);     // patches
    this.part(0.3, 0.3, 0.3, spot, -0.25, 0.85, 0.2);
    this.part(0.46, 0.44, 0.4, hide, 0, 1.18, -0.62);         // head
    this.part(0.32, 0.18, 0.08, muzzle, 0, 1.06, -0.84);
    this.part(0.06, 0.12, 0.06, horn, -0.2, 1.44, -0.6);
    this.part(0.06, 0.12, 0.06, horn, 0.2, 1.44, -0.6);
    this.part(0.06, 0.06, 0.02, 0x111111, -0.12, 1.24, -0.83);
    this.part(0.06, 0.06, 0.02, 0x111111, 0.12, 1.24, -0.83);
    this.quadLegs(hide, 0.2, 0.55, 0.3, 0.2, 0.55);
  }

  onDeath() {
    this.dropFn?.([
      { id: I.LEATHER, count: (Math.random() * 3) | 0 },
      { id: I.BEEF_RAW, count: 1 + ((Math.random() * 3) | 0) },
    ]);
  }
}

export class Chicken extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.45; this.h = 0.75; this.health = 4; this.speed = 1.1; this.fleeSpeed = 2.6; this.kind = 'chicken';
  }

  buildModel() {
    const white = 0xf2f0ea, beak = 0xe8a030, comb = 0xd02828, legC = 0xe0a040;
    this.part(0.38, 0.32, 0.5, white, 0, 0.42, 0.04);          // body
    this.part(0.26, 0.3, 0.24, white, 0, 0.68, -0.22);        // head
    this.part(0.12, 0.08, 0.1, beak, 0, 0.66, -0.38);
    this.part(0.06, 0.1, 0.06, comb, 0, 0.6, -0.36);
    this.part(0.05, 0.05, 0.02, 0x111111, -0.08, 0.74, -0.35);
    this.part(0.05, 0.05, 0.02, 0x111111, 0.08, 0.74, -0.35);
    this.wings = [this.part(0.06, 0.24, 0.34, white, -0.22, 0.46, 0.04), this.part(0.06, 0.24, 0.34, white, 0.22, 0.46, 0.04)];
    const leg = (x) => {
      const l = this.part(0.05, 0.26, 0.05, legC, x, 0.26, 0.02);
      l.geometry = l.geometry.clone(); l.geometry.translate(0, -0.13, 0); l.position.y = 0.26;
      return l;
    };
    this.legs = [leg(-0.08), leg(0.08)];
  }

  update(dt, player) {
    super.update(dt, player);
    if (this.dead) return;
    // flap to fall gently
    const airborne = !this.onGround && this.vy < 0;
    if (airborne) this.vy = Math.max(this.vy, -2.2);
    const flap = airborne || this.state === 'flee' ? Math.sin(this.age * 30) * 0.6 : 0;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
  }

  onDeath() {
    this.dropFn?.([
      { id: I.FEATHER, count: (Math.random() * 3) | 0 },
      { id: I.CHICKEN_RAW, count: 1 },
    ]);
  }
}

// ---------- wildlife ----------

export class Fox extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6; this.h = 0.7; this.health = 10; this.speed = 1.5; this.fleeSpeed = 4; this.kind = 'fox';
    this.biteCooldown = 0;
  }

  buildModel() {
    const fur = 0xd8722a, belly = 0xf4ece0, dark = 0x2a1a12;
    this.part(0.36, 0.34, 0.7, fur, 0, 0.5, 0.05);            // body
    this.part(0.36, 0.3, 0.3, fur, 0, 0.66, -0.42);           // head
    this.part(0.16, 0.12, 0.16, belly, 0, 0.58, -0.62);       // snout
    this.part(0.06, 0.05, 0.03, dark, 0, 0.6, -0.71);
    this.part(0.1, 0.12, 0.05, fur, -0.12, 0.86, -0.42);      // ears
    this.part(0.1, 0.12, 0.05, fur, 0.12, 0.86, -0.42);
    this.part(0.05, 0.05, 0.02, dark, -0.09, 0.7, -0.58);
    this.part(0.05, 0.05, 0.02, dark, 0.09, 0.7, -0.58);
    this.part(0.2, 0.2, 0.46, fur, 0, 0.56, 0.6);             // bushy tail
    this.part(0.16, 0.16, 0.12, belly, 0, 0.56, 0.86);
    this.quadLegs(dark, 0.1, 0.33, 0.12, 0.25, 0.33);
  }

  think(dt, player, playerDist) {
    this.biteCooldown = Math.max(0, this.biteCooldown - dt);
    // wary of people unless they sneak up
    if (playerDist < 6 && !player.sneaking && !player.dead) {
      this.state = 'flee';
      this.stateTime = 2;
      this.moving = true;
      this.face(player.x, player.z, true);
      return;
    }
    // hunt chickens
    const prey = this.nearest((m) => m.kind === 'chicken', 12);
    if (prey) {
      this.state = 'chase';
      this.moving = true;
      this.face(prey.x, prey.z);
      if (this.dist(prey) < 1 && this.biteCooldown <= 0) {
        prey.damage(2, this);
        this.biteCooldown = 1;
      }
      return;
    }
    if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
    super.think(dt, player, playerDist);
  }
}

const BIRD_COLORS = [[0x3a7ad8, 0xe8e0d0], [0xd83a3a, 0x2a2a2a], [0xe8c43a, 0x5a5a3a], [0x6a4a3a, 0xe8d8c0]];

export class Bird extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.3; this.h = 0.3; this.health = 2; this.speed = 3.2; this.fleeSpeed = 5;
    this.flier = true;
    this.kind = 'bird';
    this.moving = true;
    this.homeY = y;
  }

  buildModel() {
    const [body, belly] = pick(BIRD_COLORS);
    this.part(0.18, 0.16, 0.3, body, 0, 0.12, 0);
    this.part(0.16, 0.14, 0.14, body, 0, 0.2, -0.18);
    this.part(0.12, 0.06, 0.04, belly, 0, 0.08, -0.04);
    this.part(0.05, 0.04, 0.08, 0xe8a030, 0, 0.19, -0.28);   // beak
    this.part(0.12, 0.03, 0.16, body, 0, 0.14, 0.2);          // tail
    this.wings = [this.part(0.3, 0.03, 0.16, body, -0.2, 0.15, 0), this.part(0.3, 0.03, 0.16, body, 0.2, 0.15, 0)];
  }

  think(dt, player, playerDist) {
    this.stateTime -= dt;
    this.moving = true;
    if (playerDist < 5 && this.state !== 'flee') {
      this.state = 'flee';
      this.stateTime = 2.5;
      this.face(player.x, player.z, true);
      this.targetVy = 3;
      return;
    }
    if (this.stateTime <= 0) {
      this.state = 'wander';
      this.stateTime = rand(1.5, 4);
      this.targetYaw = this.yaw + rand(-1.5, 1.5);
      // hover a few blocks above the ground, drifting up and down
      const ground = this.world.surfaceHeight(Math.floor(this.x), Math.floor(this.z));
      const want = ground + rand(4, 10);
      this.targetVy = Math.max(-2, Math.min(2, (want - this.y) * 0.6));
    }
  }

  animate() {
    const f = Math.sin(this.age * 28) * 0.8;
    this.wings[0].rotation.z = f;
    this.wings[1].rotation.z = -f;
  }

  onDeath() {
    this.dropFn?.([{ id: I.FEATHER, count: (Math.random() * 2) | 0 }]);
  }
}

// ---------- water ----------

const FISH_COLORS = [[0x6f8ca8, 0xc8d2dc], [0xe8822a, 0xf4f0e8], [0x48a888, 0xd8e8d8], [0xc84868, 0xf0d0d8]];

class Swimmer extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.swimmer = true;
    this.inWater = true;   // spawned in water; updated each frame by Mob.update
    this.airTime = 0;
  }

  // water the mob is in, and how far below the surface it is
  depthBelowSurface() {
    let d = 0;
    const x = Math.floor(this.x), z = Math.floor(this.z);
    for (let y = Math.floor(this.y + this.h); y < Math.floor(this.y + this.h) + 8; y++) {
      if (this.world.getBlockW(x, y, z) !== B.WATER) break;
      d++;
    }
    return d;
  }

  think(dt, player, playerDist) {
    if (!this.inWater) {
      // stranded: flop around and slowly suffocate
      this.moving = false;
      this.airTime += dt;
      if (this.onGround && Math.random() < dt * 2) {
        this.vy = 4;
        this.vx = rand(-1.5, 1.5);
        this.vz = rand(-1.5, 1.5);
      }
      if (this.airTime > 1) { this.airTime = 0; this.hurtCooldown = 0; this.damage(1, null); }
      return;
    }
    this.airTime = 0;
    this.stateTime -= dt;
    if (this.state === 'flee' && this.stateTime > 0) { this.moving = true; return; }
    if (this.stateTime <= 0) {
      this.state = 'wander';
      this.stateTime = rand(1, 3);
      this.targetYaw = this.yaw + rand(-2, 2);
      this.moving = Math.random() < 0.85;
      this.targetVy = rand(-0.6, 0.6);
    }
    // stay under the surface
    if (this.depthBelowSurface() < this.minDepth) this.targetVy = -0.8;
  }
}

export class Fish extends Swimmer {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.4; this.h = 0.35; this.health = 3; this.speed = 1.8; this.fleeSpeed = 3.5;
    this.minDepth = 1;
    this.kind = 'fish';
  }

  buildModel() {
    const [body, belly] = pick(FISH_COLORS);
    this.part(0.16, 0.24, 0.42, body, 0, 0.17, 0);
    this.part(0.14, 0.08, 0.3, belly, 0, 0.07, -0.02);
    this.tail = this.part(0.04, 0.22, 0.14, body, 0, 0.17, 0.28);
    this.part(0.03, 0.04, 0.04, 0x111111, -0.08, 0.22, -0.14);
    this.part(0.03, 0.04, 0.04, 0x111111, 0.08, 0.22, -0.14);
  }

  animate() {
    this.tail.rotation.y = Math.sin(this.age * (this.moving ? 14 : 5)) * 0.5;
  }

  onDeath() {
    this.dropFn?.([{ id: I.FISH_RAW, count: 1 }]);
  }
}

export class Whale extends Swimmer {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 2.2; this.h = 1.6; this.health = 60; this.speed = 1.1; this.fleeSpeed = 1.8;
    this.minDepth = 2;
    this.kind = 'whale';
  }

  buildModel() {
    const back = 0x3c4c62, belly = 0xb8c4cc;
    this.part(2.2, 1.5, 4.2, back, 0, 0.8, 0);                // body
    this.part(2.0, 0.4, 3.8, belly, 0, 0.12, -0.1);
    this.part(1.8, 1.3, 1.2, back, 0, 0.75, -2.5);            // head
    this.part(0.12, 0.14, 0.04, 0x111111, -0.92, 0.7, -2.7);
    this.part(0.12, 0.14, 0.04, 0x111111, 0.92, 0.7, -2.7);
    this.part(1.4, 0.12, 0.7, back, -1.4, 0.3, -1);           // flippers
    this.part(1.4, 0.12, 0.7, back, 1.4, 0.3, -1);
    this.flukes = this.part(2.2, 0.14, 0.9, back, 0, 0.8, 2.6);
  }

  animate() {
    this.flukes.rotation.x = Math.sin(this.age * 1.6) * 0.35;
  }
}

// ---------- pets ----------

class Pet extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.tamed = false;
    this.sitting = false;
    this.biteCooldown = 0;
  }

  // right-click with an item; returns true when the click was used
  interact(player, held) {
    if (this.tamed) {
      this.sitting = !this.sitting;
      this.moving = false;
      this.fx?.notify(this.sitting ? `Your ${this.kind} is sitting` : `Your ${this.kind} follows you`);
      return true;
    }
    if (held?.id !== this.tameItem) return false;
    if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
    if (Math.random() < 0.34) {
      this.tamed = true;
      this.health = this.maxTamedHealth;
      this.onTamed();
      this.fx?.notify(`You tamed a ${this.kind}! Right-click it to make it sit or follow.`);
      this.fx?.sound('pickup');
    } else {
      this.fx?.notify(`The ${this.kind} isn't sure about you yet…`);
    }
    return true;
  }

  onTamed() {}

  // stay close to the owner
  follow(player, playerDist) {
    if (this.sitting) { this.moving = false; return; }
    if (playerDist > 3) {
      this.state = 'chase';
      this.moving = true;
      this.face(player.x, player.z);
    } else {
      this.state = 'idle';
      this.moving = false;
    }
  }

  update(dt, player) {
    // tame pets slowly heal
    if (this.tamed && !this.dead && this.health < this.maxTamedHealth) this.health = Math.min(this.maxTamedHealth, this.health + dt * 0.25);
    super.update(dt, player);
  }
}

export class Dog extends Pet {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6; this.h = 0.85; this.health = 8; this.maxTamedHealth = 20;
    this.speed = 1.5; this.fleeSpeed = 3.6;
    this.tameItem = I.BONE;
    this.angry = 0;
    this.kind = 'dog';
  }

  buildModel() {
    const fur = 0xb8b0a4, dark = 0x6a625a, nose = 0x1a1a1a;
    this.part(0.42, 0.4, 0.8, fur, 0, 0.6, 0.05);
    this.part(0.4, 0.36, 0.36, fur, 0, 0.8, -0.5);
    this.part(0.2, 0.16, 0.2, dark, 0, 0.72, -0.74);
    this.part(0.07, 0.06, 0.03, nose, 0, 0.77, -0.85);
    this.part(0.1, 0.14, 0.06, dark, -0.13, 1.03, -0.5);
    this.part(0.1, 0.14, 0.06, dark, 0.13, 1.03, -0.5);
    this.part(0.05, 0.05, 0.02, nose, -0.1, 0.86, -0.69);
    this.part(0.05, 0.05, 0.02, nose, 0.1, 0.86, -0.69);
    this.collar = this.part(0.44, 0.08, 0.12, fur, 0, 0.72, -0.34);
    this.tail = this.part(0.1, 0.1, 0.4, fur, 0, 0.72, 0.58);
    this.quadLegs(fur, 0.14, 0.42, 0.14, 0.28, 0.42);
  }

  onTamed() {
    const collar = this.materials.find((m) => m.mat === this.collar.material);
    collar.base.set(0xd02828);   // red collar marks a pet
    this.tail.rotation.x = -0.6;
  }

  damage(amount, source) {
    if (source && !this.tamed) this.angry = 15;   // wild dogs bite back
    return super.damage(amount, source);
  }

  think(dt, player, playerDist) {
    this.biteCooldown = Math.max(0, this.biteCooldown - dt);
    this.angry = Math.max(0, this.angry - dt);
    const bite = (target, dmg, cause) => {
      this.state = 'chase';
      this.moving = true;
      this.face(target.x, target.z);
      if (this.dist(target) < 1.5 && this.biteCooldown <= 0 && Math.abs(target.y - this.y) < 1.5) {
        if (cause) target.damage(dmg, cause); else target.damage(dmg, this);
        this.biteCooldown = 1;
      }
    };
    if (this.tamed) {
      // defend the owner from monsters that come close
      const foe = !this.sitting && this.nearest((m) => m.hostile && m.kind !== 'creeper'
        && Math.hypot(m.x - player.x, m.z - player.z) < 10, 14);
      if (foe) { bite(foe, 4); return; }
      this.follow(player, playerDist);
      return;
    }
    if (this.angry > 0 && !player.dead && playerDist < 16) { bite(player, 3, 'dog'); return; }
    if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
    super.think(dt, player, playerDist);
  }
}

const CAT_COATS = [0xe8a050, 0x3a3a3a, 0x9a9a9a, 0xf0e8dc];

export class Cat extends Pet {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.5; this.h = 0.65; this.health = 8; this.maxTamedHealth = 10;
    this.speed = 1.3; this.fleeSpeed = 4;
    this.tameItem = I.FISH_RAW;
    this.kind = 'cat';
  }

  buildModel() {
    const coat = pick(CAT_COATS), eye = 0x5ac83a, nose = 0xe88a9a;
    this.part(0.3, 0.3, 0.62, coat, 0, 0.45, 0.05);
    this.part(0.32, 0.28, 0.28, coat, 0, 0.62, -0.38);
    this.part(0.08, 0.1, 0.05, coat, -0.1, 0.8, -0.38);
    this.part(0.08, 0.1, 0.05, coat, 0.1, 0.8, -0.38);
    this.part(0.06, 0.05, 0.02, eye, -0.08, 0.65, -0.53);
    this.part(0.06, 0.05, 0.02, eye, 0.08, 0.65, -0.53);
    this.part(0.05, 0.04, 0.02, nose, 0, 0.58, -0.53);
    this.tail = this.part(0.07, 0.07, 0.46, coat, 0, 0.6, 0.55);
    this.tail.rotation.x = -0.5;
    this.quadLegs(coat, 0.09, 0.3, 0.1, 0.2, 0.3);
  }

  think(dt, player, playerDist) {
    if (this.tamed) { this.follow(player, playerDist); return; }
    // skittish, unless you're holding fish
    const tempting = player.heldStack()?.id === I.FISH_RAW;
    if (playerDist < 6 && !player.dead) {
      if (tempting) {
        this.state = 'idle';
        this.moving = playerDist > 1.8;
        this.face(player.x, player.z);
      } else {
        this.state = 'flee';
        this.stateTime = 2;
        this.moving = true;
        this.face(player.x, player.z, true);
      }
      return;
    }
    super.think(dt, player, playerDist);
  }
}

export const PET_CLASSES = { dog: Dog, cat: Cat };
