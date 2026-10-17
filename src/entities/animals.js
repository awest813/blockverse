// Animals: farm animals (cow, chicken), wildlife (fox, bird, fish, whale)
// and tameable pets (cat, dog). Original box-model designs, like mobs.js.

import * as THREE from 'three';
import { Mob } from './mob.js';
import { entityCollides } from '../core/physics.js';
import { I } from '../items/itemIds.js';
import { itemInfo } from '../items/items.js';
import { B, isSolid as isSolidId, isWater } from '../blocks/blocks.js';
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
      if (m.dead || m.dying !== undefined || m === this || (kind && !kind(m))) continue;
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
    this.w = 0.9; this.h = 1.3; this.health = 10; this.speed = 1.2; this.kind = 'cow'; this.hurtSound = 'cow';
    this.ambientSound = 'cow';
    this.breedItem = I.WHEAT;
  }

  // a bucket fills with milk
  interact(player, held) {
    if (held?.id !== I.BUCKET || this.baby) return super.interact(player, held);
    if (player.mode !== GAMEMODE_CREATIVE) {
      if (held.count > 1) {
        player.consumeHeld(1);
        if (player.give(I.MILK_BUCKET, 1) > 0) this.dropFn?.([{ id: I.MILK_BUCKET, count: 1 }]);   // no room: it drops by the cow
      } else player.inventory[player.selected] = { id: I.MILK_BUCKET, count: 1 };
      player.events.dispatchEvent(new CustomEvent('inventory'));
    }
    this.persistent = true;   // (your milk cow: kept, not left to wander off)
    this.fx?.sound('cow', { vol: 0.8, pos: this });
    return true;
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
    this.w = 0.45; this.h = 0.75; this.health = 4; this.speed = 1.1; this.fleeSpeed = 2.6; this.kind = 'chicken'; this.hurtSound = 'chicken';
    this.ambientSound = 'chicken';
    this.breedItem = I.WHEAT_SEEDS;
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
    // grown hens lay an egg every few minutes
    // (not while it's frozen in an unloaded chunk: the egg would fall through)
    if (this.world.isLoaded(Math.floor(this.x), Math.floor(this.z))) this.eggTimer = (this.eggTimer ?? 120 + Math.random() * 240) - dt;
    if (this.eggTimer <= 0) {
      this.eggTimer = 300 + Math.random() * 300;
      if (!this.baby && this.dying === undefined) { this.dropFn?.([{ id: I.EGG, count: 1 }]); this.fx?.sound('chicken', { vol: 0.6, pos: this }); }
    }
    // flap to fall gently
    const airborne = !this.onGround && this.vy < 0;
    if (airborne) { this.vy = Math.max(this.vy, -2.2); this.fallStart = this.y; }   // flapping: no fall damage
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

// a bucket fills with milk (cows and goats)
function milk(animal, player, held) {
  if (player.mode !== GAMEMODE_CREATIVE) {
    if (held.count > 1) {
      player.consumeHeld(1);
      if (player.give(I.MILK_BUCKET, 1) > 0) animal.dropFn?.([{ id: I.MILK_BUCKET, count: 1 }]);   // no room: it drops by the animal
    } else player.inventory[player.selected] = { id: I.MILK_BUCKET, count: 1 };
    player.events.dispatchEvent(new CustomEvent('inventory'));
  }
}

// Mountain goats: sure-footed (long drops don't hurt), leap about, give
// milk — and now and then lower their heads and charge. Hit one and it
// charges you for sure.
export class Goat extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.8; this.h = 1.2; this.health = 10; this.speed = 1.4; this.fleeSpeed = 3.0; this.kind = 'goat'; this.hurtSound = 'goat';
    this.ambientSound = 'goat';
    this.breedItem = I.WHEAT;
    this.safeFall = 9;
    this.ram = null;      // {phase: 'aim' | 'charge', t, dir}
    this.grudge = 0;      // seconds left wanting to ram whoever hit it
  }

  interact(player, held) {
    if (held?.id !== I.BUCKET || this.baby) return super.interact(player, held);
    milk(this, player, held);
    this.persistent = true;
    this.fx?.sound('goat', { vol: 0.8, pos: this });
    return true;
  }

  buildModel() {
    const coat = 0xe2ddd2, shade = 0xc9c2b4, horn = 0x8a8070, hoof = 0x4a4038, beard = 0xb8b0a0;
    this.part(0.62, 0.62, 1.0, coat, 0, 0.92, 0.05);          // body
    this.part(0.3, 0.2, 0.4, shade, 0, 1.14, 0.3);            // back fleece
    this.head = new THREE.Group();                             // head pivots for the charge
    this.head.position.set(0, 1.2, -0.42);
    this.group.add(this.head);
    const hp = (w, h, d, c, x, y, z) => { const m = this.part(w, h, d, c, x, y, z); this.group.remove(m); this.head.add(m); return m; };
    hp(0.36, 0.38, 0.46, coat, 0, 0.04, -0.16);               // head
    hp(0.14, 0.22, 0.1, beard, 0, -0.2, -0.3);                // beard
    this.hornParts = [hp(0.08, 0.3, 0.08, horn, -0.12, 0.3, -0.04), hp(0.08, 0.3, 0.08, horn, 0.12, 0.3, -0.04)];
    for (const h of this.hornParts) h.rotation.x = 0.5;
    this.horns = 2;
    hp(0.05, 0.05, 0.02, 0xc89a20, -0.1, 0.1, -0.4);          // yellow eyes
    hp(0.05, 0.05, 0.02, 0xc89a20, 0.1, 0.1, -0.4);
    this.quadLegs(shade, 0.16, 0.6, 0.2, 0.3, 0.62);
    for (const l of this.legs) { const h = this.part(0.17, 0.1, 0.17, hoof, 0, -0.55, 0); this.group.remove(h); l.add(h); }
  }

  damage(amount, source) {
    const hit = super.damage(amount, source);
    if (hit && source && !source.kind && this.health > 0) { this.grudge = 8; this.state = 'idle'; }   // hit by a player: no running away
    return hit;
  }

  think(dt, player, playerDist) {
    this.grudge = Math.max(0, this.grudge - dt);
    if (this.ram) return this.ramTick(dt, player);
    // something to charge at: a player who hit it, or (rarely) one who just stands about
    const target = !this.baby && !player.dead && player.mode !== GAMEMODE_CREATIVE && playerDist < 9 && this.canSee(player);
    // (a goat that's yours, penned or on a lead, only charges when it's been hit)
    const calm = this.persistent || this.leash;
    if (target && (this.grudge > 0 ? Math.random() < dt * 1.5 : !calm && Math.random() < dt / 60)) {
      this.ram = { phase: 'aim', t: 0.9 };
      this.moving = false;
      this.fx?.sound('goat', { vol: 1, pos: this, pitch: 0.8 });
      return;
    }
    super.think(dt, player, playerDist);
    // a mountain goat leaps
    // (1.4 blocks: high, but not over a fence)
    if (this.state === 'wander' && this.moving && this.onGround && Math.random() < dt / 5) this.vy = 8.6;
  }

  ramTick(dt, player) {
    const r = this.ram;
    r.t -= dt;
    if (r.phase === 'aim') {
      // head down, paw the ground, lock on
      this.steer(player, 1);
      this.moving = false;
      this.head.rotation.x = Math.min(0.6, this.head.rotation.x + dt * 2);
      if (r.t <= 0) {
        const dx = player.x - this.x, dz = player.z - this.z, d = Math.hypot(dx, dz) || 1;
        Object.assign(r, { phase: 'charge', t: 1.4, dir: [dx / d, dz / d] });
        this.yaw = this.targetYaw;
      }
      return;
    }
    // charge in a straight line
    this.moving = true;
    this.state = 'flee';   // (moves at fleeSpeed)
    this.fleeSpeed = 7;
    const hitPlayer = !player.dead && Math.hypot(player.x - this.x, player.z - this.z) < (this.w + 0.6) / 2 + 0.35 && Math.abs(player.y - this.y) < 1.4
      && this.clearTo(player);   // (not through a fence)
    if (hitPlayer) {
      if (player.hurtCooldown <= 0 && player.mode !== GAMEMODE_CREATIVE) player.damage(2, 'goat');
      player.vx += r.dir[0] * 10; player.vz += r.dir[1] * 10; player.vy = Math.max(player.vy, 5.5);
      this.fx?.sound('hit', { pos: this });
    }
    // slamming into rock can knock a horn off
    if (this.lastHitWall && !hitPlayer && this.horns > 0 && !this.baby) {
      const fx = Math.floor(this.x + r.dir[0] * (this.w / 2 + 0.3)), fz = Math.floor(this.z + r.dir[1] * (this.w / 2 + 0.3));
      if (HORN_ROCK.has(this.world.getBlockW(fx, Math.floor(this.y + 0.5), fz)) && Math.random() < 0.5) {
        this.setHorns(this.horns - 1);
        this.dropFn?.([{ id: I.GOAT_HORN, count: 1 }]);
        this.fx?.sound('hit', { pos: this });
      }
    }
    if (hitPlayer || r.t <= 0 || this.lastHitWall) {
      this.ram = null;
      this.grudge = hitPlayer ? 0 : this.grudge;
      this.fleeSpeed = 3.0;
      this.state = 'idle'; this.stateTime = 1.5; this.moving = false;
      this.head.rotation.x = 0;
    }
  }

  setHorns(n) {
    this.horns = Math.max(0, Math.min(2, n));
    this.hornParts.forEach((h, i) => { h.visible = i < this.horns; });
  }

  saveExtra() { return this.horns < 2 ? { horns: this.horns } : null; }
  loadExtra(e) { if (Number.isFinite(e.horns)) this.setHorns(e.horns); }

  onDeath() {
    this.dropFn?.([
      { id: I.LEATHER, count: (Math.random() * 2) | 0 },
      { id: I.MUTTON_RAW, count: 1 + ((Math.random() * 2) | 0) },
    ]);
  }
}
const HORN_ROCK = new Set([B.STONE, B.COBBLESTONE, B.GRANITE ?? -1, B.ANDESITE ?? -1, B.DIORITE ?? -1, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.STONE_BRICKS ?? -1, B.PACKED_ICE ?? -1, B.ICE ?? -1].filter((id) => id >= 0));

// Ducks: waddle on land, paddle on water (they like it), and their
// ducklings follow them about. Drakes have green heads.
export class Duck extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.45; this.h = 0.6; this.health = 4; this.speed = 1.0; this.fleeSpeed = 2.6; this.kind = 'duck'; this.hurtSound = 'duck';
    this.ambientSound = 'duck';
    this.breedItem = I.WHEAT_SEEDS;
    this.likesWater = true;
  }

  buildModel() {
    const bill = 0xe8a828, legC = 0xe89030;
    const tint = (k, m) => ((this.plumage ??= {})[k] ??= []).push(this.materials.at(-1)) && m;
    tint('body', this.part(0.36, 0.26, 0.56, 0, 0, 0.3, 0.04));          // body
    tint('wing', this.part(0.24, 0.12, 0.2, 0, 0, 0.42, 0.26));          // tail
    this.collar = this.part(0.24, 0.05, 0.22, 0xf2f0ea, 0, 0.47, -0.2);   // a drake's white collar
    tint('head', this.part(0.22, 0.24, 0.22, 0, 0, 0.6, -0.22));         // head
    this.part(0.16, 0.06, 0.16, bill, 0, 0.55, -0.4);          // flat bill
    this.part(0.04, 0.04, 0.02, 0x111111, -0.1, 0.65, -0.33);
    this.part(0.04, 0.04, 0.02, 0x111111, 0.1, 0.65, -0.33);
    this.wings = [tint('wing', this.part(0.05, 0.18, 0.36, 0, -0.2, 0.33, 0.04)), tint('wing', this.part(0.05, 0.18, 0.36, 0, 0.2, 0.33, 0.04))];
    this.setDrake(Math.random() < 0.5);
    const leg = (x) => {
      const l = this.part(0.05, 0.18, 0.05, legC, x, 0.18, 0.02);
      l.geometry = l.geometry.clone(); l.geometry.translate(0, -0.09, 0); l.position.y = 0.18;
      const foot = this.part(0.1, 0.02, 0.12, legC, 0, -0.17, -0.04); this.group.remove(foot); l.add(foot);
      return l;
    };
    this.legs = [leg(-0.08), leg(0.08)];
  }

  // drakes are grey with a green head and a white collar; hens are brown
  setDrake(on) {
    this.drake = on;
    const c = on ? { body: 0x9a948a, wing: 0x6a6660, head: 0x1f6a3a } : { body: 0x8a6a48, wing: 0x6e5236, head: 0x7a5a3c };
    for (const [k, list] of Object.entries(this.plumage)) for (const m of list) m.base.setHex(c[k]);
    this.collar.visible = on;
  }

  saveExtra() { return { drake: this.drake }; }
  loadExtra(e) { this.setDrake(!!e.drake); }

  update(dt, player) {
    super.update(dt, player);
    if (this.dead || this.dying !== undefined) return;
    // float with the body half under the surface instead of bobbing up and down
    // (but not while climbing out at a bank)
    if (this.inWater && !(this.lastHitWall && this.moving)) {
      const bx = Math.floor(this.x), bz = Math.floor(this.z);
      let top = Math.floor(this.y);
      while (top < Math.floor(this.y) + 3 && this.world.getBlockW(bx, top, bz) === B.WATER) top++;
      this.vy = (top - 0.2 - this.y) * 5;
    }
    const airborne = !this.onGround && !this.inWater && this.vy < 0;
    if (airborne) { this.vy = Math.max(this.vy, -2.4); this.fallStart = this.y; }   // flapping: no fall damage
    const flap = airborne || this.state === 'flee' ? Math.sin(this.age * 28) * 0.7 : 0;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
    // paddling: the legs swing slower, the body rocks gently
    this.group.rotation.z = this.inWater ? Math.sin(this.age * 2) * 0.06 : 0;
  }

  onDeath() {
    this.dropFn?.([
      { id: I.FEATHER, count: (Math.random() * 3) | 0 },
      { id: I.DUCK_RAW, count: 1 },
    ]);
  }
}

// Horses: wild ones throw you off until they trust you (feeding helps);
// a tamed horse with a saddle can be ridden — it goes where you look,
// faster when you sprint, and jumps fences. Each has its own coat, speed and jump.
const COATS = [
  [0x7a4e2c, 0x2e1c10, 'bay'], [0x9a5a28, 0x6a3a18, 'chestnut'], [0x2c2622, 0x141210, 'black'],
  [0xd8d2c8, 0xb8b0a4, 'white'], [0x8c8680, 0x3c3834, 'grey'], [0xc49a5c, 0xece2cc, 'palomino'],
];
const TAMING_FOOD = new Map([[I.WHEAT, 3], [I.APPLE, 5], [I.CARROT, 4], [B.HAY_BALE, 10], [I.GOLDEN_CARROT, 20], [I.GOLDEN_APPLE, 20]]);

export class Horse extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 1.2; this.h = 1.6; this.kind = 'horse'; this.hurtSound = 'horse';
    this.health = this.maxHealth = 20 + ((Math.random() * 11) | 0);
    this.speed = 1.6; this.fleeSpeed = 4;
    this.ambientSound = 'horse';
    this.breedItem = I.GOLDEN_APPLE;   // (and golden carrots, like every farm animal)
    this.safeFall = 6;
    // its own gifts: top speed 7.5-11 m/s, a jump of 2.1-2.9 blocks (any horse clears a fence, even at a trot)
    this.gallop = 7.5 + Math.random() * 3.5;
    this.jumpV = 10.4 + Math.random() * 1.9;
    this.diet = [...TAMING_FOOD.keys()];   // what it'll eat (for the "wrong food" hint)
    this.temper = 0;       // taming progress, 0-100
    this.owned = false;    // tamed
    this.saddled = false;
    this.rider = null;
    // what differs for a camel: standing height, riding pace, its name and food
    this.standH = 1.6;
    this.rideSpeed = 4.2;
    this.tamingFood = TAMING_FOOD;
    this.label = 'horse';
    this.rideable = true;
  }

  buildModel() {
    this.coat = (Math.random() * COATS.length) | 0;
    this.coatParts = []; this.maneParts = [];
    const c = COATS[this.coat], muzzle = 0x2a2420, hoof = 0x3a3028;
    const coat = (m) => (this.coatParts.push(this.materials.at(-1)), m);
    const mane = (m) => (this.maneParts.push(this.materials.at(-1)), m);
    coat(this.part(0.62, 0.62, 1.4, c[0], 0, 1.2, 0.05));            // body
    coat(this.part(0.34, 0.66, 0.4, c[0], 0, 1.62, -0.66)).rotation.x = -0.45;   // neck
    coat(this.part(0.3, 0.3, 0.6, c[0], 0, 1.86, -0.98));            // head
    this.part(0.24, 0.22, 0.14, muzzle, 0, 1.78, -1.28);
    coat(this.part(0.08, 0.14, 0.06, c[0], -0.1, 2.08, -0.8));       // ears
    coat(this.part(0.08, 0.14, 0.06, c[0], 0.1, 2.08, -0.8));
    mane(this.part(0.1, 0.5, 0.5, c[1], 0, 1.84, -0.6)).rotation.x = -0.45;   // mane
    mane(this.part(0.14, 0.62, 0.14, c[1], 0, 1.04, 0.84)).rotation.x = 0.35;  // tail
    this.part(0.05, 0.06, 0.02, 0x111111, -0.16, 1.92, -1.12);
    this.part(0.05, 0.06, 0.02, 0x111111, 0.16, 1.92, -1.12);
    this.quadLegs(c[0], 0.18, 0.9, 0.2, 0.5, 0.9);
    this.coatParts.push(...this.materials.slice(-4));   // the legs are coat too
    for (const l of this.legs) { const h = this.part(0.2, 0.14, 0.2, hoof, 0, -0.84, 0); this.group.remove(h); l.add(h); }
    // the saddle, shown once it has one
    this.saddleParts = [
      this.part(0.66, 0.1, 0.6, 0x7a4a24, 0, 1.55, 0.02),
      this.part(0.5, 0.12, 0.12, 0x5a341a, 0, 1.64, 0.28),
      this.part(0.04, 0.4, 0.04, 0x4a2a14, -0.34, 1.32, 0), this.part(0.04, 0.4, 0.04, 0x4a2a14, 0.34, 1.32, 0),
      this.part(0.08, 0.04, 0.12, 0xa0a0a8, -0.36, 1.1, 0), this.part(0.08, 0.04, 0.12, 0xa0a0a8, 0.36, 1.1, 0),
    ];
    for (const m of this.saddleParts) m.visible = false;
  }

  // restore a saved coat
  setCoat(i) {
    if (!COATS[i]) return;
    this.coat = i;
    for (const m of this.coatParts) m.base.setHex(COATS[i][0]);
    for (const m of this.maneParts) m.base.setHex(COATS[i][1]);
  }

  saveExtra() {
    return { coat: this.coat, gallop: this.gallop, jumpV: this.jumpV, maxHealth: this.maxHealth, temper: this.temper, owned: this.owned, saddled: this.saddled };
  }

  // a foal takes after its parents: one's coat, their gifts between theirs
  // (give or take a little of its own), and if they were yours it already
  // half trusts you
  inherit(baby, mate) {
    if (this.kind === 'horse') baby.setCoat(Math.random() < 0.5 ? this.coat : mate.coat);
    const mix = (a, b, spread) => (a + b) / 2 + (Math.random() - 0.5) * spread;
    baby.gallop = Math.max(7.5, Math.min(11.5, mix(this.gallop, mate.gallop, 1.2)));
    baby.jumpV = this.kind === 'horse' ? Math.max(10.4, Math.min(12.6, mix(this.jumpV, mate.jumpV, 0.6))) : mix(this.jumpV, mate.jumpV, 0.3);
    baby.maxHealth = Math.round(Math.max(15, Math.min(32, mix(this.maxHealth, mate.maxHealth, 4))));
    baby.health = baby.maxHealth;
    if (this.owned || mate.owned) baby.temper = 60;
  }

  loadExtra(e) {
    this.setCoat(e.coat);
    for (const k of ['gallop', 'jumpV', 'maxHealth', 'temper']) if (Number.isFinite(e[k])) this[k] = e[k];
    if (this.kind === 'horse') this.jumpV = Math.max(this.jumpV, 10.4);   // horses saved before every horse could clear a fence
    else this.jumpV = Math.min(this.jumpV, 8.6);                         // camels never could (whatever an old save says)
    this.owned = !!e.owned;
    this.setSaddled(!!e.saddled);
  }

  setSaddled(on) {
    this.saddled = on;
    for (const m of this.saddleParts) m.visible = on;
  }

  get seat() { return 1.3; }

  interact(player, held) {
    if (this.rider) return false;
    const say = (t) => this.fx?.notify?.(t);
    // a saddle on a horse that trusts you
    if (held?.id === I.SADDLE) {
      if (this.baby) return true;
      if (!this.owned) { say('It won\'t take a saddle yet — feed it and climb on until it trusts you'); return true; }
      if (this.saddled) { say('It already has a saddle'); return true; }
      this.setSaddled(true);
      this.persistent = true;
      if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
      this.fx?.sound('equip', { pos: this });
      say('Saddled — use it with an empty hand to ride; sneak to get off');
      return true;
    }
    // food calms a wild horse (and heals or grows any horse)
    const calm = held && this.tamingFood.get(held.id);
    // golden food (a camel's cactus) breeds a tamed pair, like any farm animal,
    // unless it's hurt and the food can heal it
    if (this.owned && this.likes(held?.id) && !(calm && this.health < this.maxHealth)) return super.interact(player, held);
    if (calm) {
      const hungry = this.baby || (!this.owned && this.temper < 100) || this.health < this.maxHealth;
      if (!hungry) {
        say(this.owned ? `Your ${this.label} isn't hungry` : `It trusts you now: climb on with an empty hand`);
        return true;
      }
      if (this.baby) this.grow = Math.max(0, this.grow - calm * 6);
      if (!this.owned) this.temper = Math.min(100, this.temper + calm);
      this.health = Math.min(this.maxHealth, this.health + Math.ceil(calm / 3));
      this.persistent = true;
      if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
      this.fx?.hearts?.(this.x, this.y + this.h, this.z, 2);
      this.fx?.sound('eat', { vol: 0.6, pos: this });
      return true;
    }
    if (held && !(this.owned && this.saddled) || (held && itemInfo(held.id)?.food)) return false;
    if (this.baby) return true;
    // climb on (a wild one needs an empty hand; your saddled horse, anything but food)
    if (this.owned && !this.saddled) { say('It needs a saddle before you can ride it'); return true; }
    if (player.sneaking) {
      // sneak-use takes the saddle back off
      if (this.saddled && this.owned) { this.setSaddled(false); if (player.give(I.SADDLE, 1) > 0) this.dropFn?.([{ id: I.SADDLE, count: 1 }]); }
      return true;
    }
    this.mountBy(player);
    return true;
  }

  mountBy(player) {
    if (player.mount) return;
    // the rider's head needs room
    this.h = this.standH + 1;
    const cramped = entityCollides(this.world, this);
    this.h = this.standH;
    if (cramped) { this.fx?.notify?.('Not enough headroom to climb on here'); return; }
    // climbing on a horse on a lead: the lead comes back to you
    if (this.leash) { this.unleash(); if (player.mode !== GAMEMODE_CREATIVE && player.give(I.LEAD, 1) > 0) this.dropFn?.([{ id: I.LEAD, count: 1 }]); }
    this.rider = player;
    player.mount = this;
    player._sneakHeld = !!player.sneaking;
    this.h = this.standH + 1;   // the rider's head: no squeezing under a low roof
    player.flying = false;
    player.vx = player.vy = player.vz = 0;
    this.persistent = true;
    // a wild horse puts up with it for a moment, then decides
    if (!this.owned) {
      this.buck = 1.5 + Math.random() * 2;
      this.fx?.notify?.('Hold on…');
    }
    this.fx?.sound(this.ambientSound, { pos: this });
  }

  // the rider gets off beside the horse
  dismount() {
    const p = this.rider;
    this.rider = null;
    this.buck = 0;
    this.h = this.standH;
    this.speed = this.walkSpeed ?? this.speed;   // back to an amble
    if (!p) return;
    p.mount = null;
    // to the left, the right, or (boxed in) on top of the horse: wherever the
    // rider's whole body fits (a centre-only check stood them on walls)
    const free = (x, y, z) => !entityCollides(this.world, { x, y, z, w: p.w ?? 0.6, h: p.h ?? 1.8 });
    for (const k of [-1, 1, 0]) {
      const x = this.x + Math.cos(this.yaw) * 1.3 * k, z = this.z - Math.sin(this.yaw) * 1.3 * k;
      const y = (k ? this.y : this.y + this.h) + 0.05;
      if (free(x, y, z)) { p.x = x; p.y = y; p.z = z; break; }
    }
    p.vx = p.vy = p.vz = 0;
    p.fallStart = null;
  }

  think(dt, player, playerDist) {
    // called by a goat horn: come at a gallop
    if (this.called > 0 && !this.rider && !this.leash) {
      this.called -= dt;
      if (playerDist < 3 || player.dead) { this.called = 0; this.waiting = 20; this.moving = false; return; }
      this.state = 'called';
      this.steer(player, 1);
      this.moving = true;
      this.hurry = true;   // at a canter, slowing only for the last few steps
      this.fleeSpeed = playerDist > 6 ? Math.max(4, this.gallop * 0.7) : 3;
      return;
    }
    // come when called, it waits for you (facing you) for a while
    if (this.waiting > 0 && !this.rider && !this.leash) {
      this.waiting -= dt;
      this.state = 'idle'; this.stateTime = 1; this.moving = false;
      if (playerDist > 1.5) this.steer(player, 1);
      if (playerDist > 12) this.waiting = 0;   // you walked off
      return;
    }
    if (!this.rider) return super.think(dt, player, playerDist);
    const r = this.rider;
    this.detour = null;
    this.state = 'ridden';
    if (r.dead || r.mount !== this) { this.rider = null; this.h = this.standH; this.speed = this.walkSpeed ?? this.speed; if (r.mount === this) r.mount = null; this.state = 'idle'; return; }
    // a wild horse bucks: it won't go where you want, and then it decides
    if (this.buck > 0) {
      this.buck -= dt;
      this.moving = Math.random() < 0.7;
      if (Math.random() < dt * 2) this.targetYaw = this.yaw + (Math.random() - 0.5) * 3;
      if (this.onGround && Math.random() < dt * 1.5) this.vy = 6;
      if (this.buck <= 0) {
        if (Math.random() * 100 < this.temper + 15) {
          this.owned = true;
          this.fx?.hearts?.(this.x, this.y + this.h, this.z, 8);
          this.fx?.notify?.(`The ${this.label} trusts you! Put a saddle on it to ride (5 leather + an iron ingot)`);
        } else {
          this.temper = Math.min(100, this.temper + 8);
          this.fx?.sound(this.ambientSound, { pos: this, vol: 1.2 });
          this.fx?.notify?.('Thrown off! Feed it and try again');
          this.dismount();
          r.vy = 5; r.vx += -Math.sin(this.yaw) * 3; r.vz += -Math.cos(this.yaw) * 3;
        }
        // a horse tamed by riding it bare-back: off you get, it needs a saddle to steer
        if (this.owned && !this.saddled) this.dismount();
      }
      return;
    }
    // ridden: it faces where you look and goes when you press forward
    const inp = r.rideInput ?? {};
    this.yaw = this.targetYaw = r.yaw;
    this.moving = inp.fwd > 0.1;
    this.walkSpeed ??= this.speed;   // its own pace, for when you get off
    this.speed = this.inWater ? 2.2 : inp.sprint ? this.gallop : this.rideSpeed;
    if (inp.jump && this.onGround && !this.inWater) this.vy = this.jumpV;
    // hooves
    if (this.moving && this.onGround) {
      this.hoofDist = (this.hoofDist ?? 0) + this.speed * dt;
      if (this.hoofDist > (inp.sprint ? 2.6 : 1.7)) { this.hoofDist = 0; this.fx?.sound('hoof', { pos: this, vol: inp.sprint ? 0.9 : 0.6 }); }
    }
  }

  animate(dt) {
    super.animate(dt);
    // a gallop swings the legs further
    if (this.rider && this.speed > 5 && this.legs) for (const l of this.legs) l.rotation.x *= 1.4;
  }

  damage(amount, source) {
    if (source && source === this.rider) return false;   // no swatting your own horse from the saddle
    return super.damage(amount, source);
  }

  onDeath() {
    if (this.rider) this.dismount();
    const drops = [{ id: I.LEATHER, count: (Math.random() * 3) | 0 }];
    if (this.saddled) drops.push({ id: I.SADDLE, count: 1 });
    this.dropFn?.(drops);
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
    // at night birds come down and roost on the ground until morning
    if (this.world.materials.uniforms.uDay.value < 0.35 && this.state !== 'flee') {
      this.state = 'roost';
      // over water: fly on (level, or up out of it) until there's land below
      const bx = Math.floor(this.x), bz = Math.floor(this.z);
      let y = Math.floor(this.y);
      while (y > 0 && y > this.y - 40 && this.world.getBlockW(bx, y, bz) === B.AIR) y--;
      if (this.inWater || isWater(this.world.getBlockW(bx, y, bz))) {
        this.moving = true;
        this.targetVy = this.inWater ? 2.5 : 0;
        return;
      }
      this.moving = !this.onGround;
      this.targetVy = this.onGround ? 0 : -2.5;
      return;
    }
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
      // hover a few blocks above the ground (or the water), drifting up and down
      const bx = Math.floor(this.x), bz = Math.floor(this.z);
      let ground = this.world.surfaceHeight(bx, bz);
      while (ground < 200 && isWater(this.world.getBlockW(bx, ground + 1, bz))) ground++;
      const want = ground + rand(4, 10);
      this.targetVy = Math.max(-2, Math.min(2, (want - this.y) * 0.6));
    }
  }

  animate() {
    const f = this.state === 'roost' && this.onGround ? 0 : Math.sin(this.age * 28) * 0.8;
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
    this.ambientSound = 'whale';
  }

  // rendered down for oil: fuel, torches and lanterns
  onDeath() {
    this.dropFn?.([{ id: I.WHALE_OIL, count: 2 + ((Math.random() * 3) | 0) }]);
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

// Playful pod animals of the open ocean. They swim over to players in the
// water, leap from the waves, and lend swimmers near them a burst of speed.
// Feeding one a raw fish makes it escort you for a while.
export class Dolphin extends Swimmer {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.9; this.h = 0.6; this.health = 10; this.speed = 2.6; this.fleeSpeed = 4.5;
    this.minDepth = 1;
    this.kind = 'dolphin';
    this.ambientSound = 'dolphin';
    this.leapTime = 0;
    this.escort = 0;    // seconds left following a player who fed it
  }

  buildModel() {
    const back = 0x6c8aa8, belly = 0xdfe6ec;
    this.part(0.7, 0.55, 1.5, back, 0, 0.3, 0);
    this.part(0.6, 0.18, 1.3, belly, 0, 0.08, -0.05);
    this.part(0.5, 0.42, 0.5, back, 0, 0.3, -0.95);          // head
    this.part(0.22, 0.14, 0.4, belly, 0, 0.2, -1.3);          // beak
    this.part(0.06, 0.08, 0.04, 0x111111, -0.26, 0.38, -1.05);
    this.part(0.06, 0.08, 0.04, 0x111111, 0.26, 0.38, -1.05);
    this.part(0.1, 0.35, 0.3, back, 0, 0.7, 0.05);            // dorsal fin
    this.part(0.45, 0.06, 0.25, back, -0.45, 0.15, -0.3);     // flippers
    this.part(0.45, 0.06, 0.25, back, 0.45, 0.15, -0.3);
    this.tail = this.part(0.8, 0.08, 0.3, back, 0, 0.3, 0.9);
  }

  interact(player, held) {
    if (held?.id !== I.FISH_RAW && held?.id !== I.FISH_COOKED) return false;
    if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
    this.escort = 45;
    this.health = 10;
    player.graceTime = Math.max(player.graceTime ?? 0, 10);
    this.fx?.notify('The dolphin clicks happily and swims beside you');
    this.fx?.sound('pickup');
    return true;
  }

  think(dt, player, playerDist) {
    this.escort = Math.max(0, this.escort - dt);
    if (this.leapTime > 0) {          // mid-leap: keep going, gravity does the rest
      this.leapTime -= dt;
      this.moving = true;
      return;
    }
    if (!this.inWater) { super.think(dt, player, playerDist); return; }
    // swimmers close by get a burst of speed
    if (player.inWater && playerDist < 6 && !player.dead) player.graceTime = Math.max(player.graceTime ?? 0, 4);
    if (this.state === 'flee' && this.stateTime > 0) { this.stateTime -= dt; this.moving = true; return; }
    // drawn to players in the water (and anyone who fed it)
    const range = this.escort > 0 ? 40 : 16;
    if ((player.inWater || this.escort > 0) && playerDist < range && playerDist > 2.5 && !player.dead) {
      this.state = 'follow';
      this.moving = true;
      this.face(player.x, player.z);
      this.targetVy = Math.max(-1.5, Math.min(1.5, (player.y - this.y) * 0.8));
      if (this.depthBelowSurface() < 1 && this.targetVy > 0) this.targetVy = 0;
      return;
    }
    // leap from the waves now and then
    if (this.moving && this.depthBelowSurface() <= 1 && Math.random() < dt * 0.25 && this.openWaterAhead(3)) {
      this.vy = 7.5;
      this.leapTime = 1.1;
      this.fx?.sound('splash', { vol: 0.6, pos: this });
      return;
    }
    super.think(dt, player, playerDist);
    // pods play near the surface
    if (this.state === 'wander' && this.depthBelowSurface() > 3) this.targetVy = 0.8;
  }

  // water under where a leap comes down, so it doesn't land on the beach
  openWaterAhead(dist) {
    const y = Math.floor(this.y);
    for (let d = 1; d <= dist + 1; d++) {
      const x = Math.floor(this.x - Math.sin(this.yaw) * d), z = Math.floor(this.z - Math.cos(this.yaw) * d);
      if (isSolidId(this.world.getBlockW(x, y, z)) || this.world.getBlockW(x, y - 1, z) !== B.WATER) return false;
    }
    return true;
  }

  animate() {
    this.tail.rotation.x = Math.sin(this.age * (this.moving ? 9 : 3)) * 0.4;
    this.group.rotation.x = this.leapTime > 0 ? Math.max(-0.7, Math.min(0.7, this.vy * 0.1)) : 0;
  }

  onDeath() {
    this.dropFn?.([{ id: I.FISH_RAW, count: (Math.random() * 2) | 0 }]);
  }
}

// Gentle giants of warm rivers, swamps and shallow coasts. They graze slowly
// along the bottom and drift up to breathe; they never fight back. Feed one
// wheat or sugar cane and it will nuzzle up and follow you for a while.
export class Manatee extends Swimmer {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 1.2; this.h = 0.8; this.health = 20; this.speed = 0.6; this.fleeSpeed = 1.3;
    this.minDepth = 0;
    this.kind = 'manatee';
    this.breath = rand(10, 25);   // seconds until it surfaces to breathe
    this.escort = 0;
  }

  buildModel() {
    const hide = 0x7d7a72, belly = 0x9c978c;
    this.part(1.1, 0.75, 1.8, hide, 0, 0.4, 0);
    this.part(0.95, 0.2, 1.5, belly, 0, 0.1, -0.05);
    this.part(0.8, 0.6, 0.6, hide, 0, 0.38, -1.1);            // head
    this.part(0.6, 0.35, 0.25, belly, 0, 0.25, -1.45);        // whiskery snout
    this.part(0.07, 0.07, 0.04, 0x111111, -0.36, 0.5, -1.25);
    this.part(0.07, 0.07, 0.04, 0x111111, 0.36, 0.5, -1.25);
    this.part(0.5, 0.08, 0.3, hide, -0.7, 0.2, -0.6);         // flippers
    this.part(0.5, 0.08, 0.3, hide, 0.7, 0.2, -0.6);
    this.tail = this.part(1.1, 0.1, 0.8, hide, 0, 0.35, 1.25); // round paddle tail
  }

  interact(player, held) {
    if (held?.id !== I.WHEAT && held?.id !== B.SUGAR_CANE) return false;
    if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
    this.escort = 40;
    this.health = 20;
    this.fx?.notify('The manatee nuzzles your hand');
    this.fx?.sound('eat', { pos: this });
    return true;
  }

  think(dt, player, playerDist) {
    if (!this.inWater) { super.think(dt, player, playerDist); return; }
    this.escort = Math.max(0, this.escort - dt);
    this.breath -= dt;
    const depth = this.depthBelowSurface();
    if (this.breath <= 0) {
      // rise for a breath, linger at the top, then sink again
      this.targetVy = depth > 0 ? 0.9 : 0;
      this.moving = false;
      if (depth === 0 && this.breath < -3) this.breath = rand(15, 30);
      return;
    }
    if (this.state === 'flee' && this.stateTime > 0) { this.stateTime -= dt; this.moving = true; this.targetVy = -0.4; return; }
    if (this.escort > 0 && playerDist > 2.5 && playerDist < 30) {
      this.state = 'follow';
      this.moving = true;
      this.face(player.x, player.z);
      this.targetVy = Math.max(-0.6, Math.min(0.6, (player.y - this.y) * 0.5));
      return;
    }
    this.stateTime -= dt;
    if (this.stateTime <= 0) {
      this.state = 'wander';
      this.stateTime = rand(3, 7);
      this.targetYaw = this.yaw + rand(-1.2, 1.2);
      this.moving = Math.random() < 0.6;   // often just grazing in place
    }
    this.targetVy = -0.3;   // settle toward the bottom
  }

  animate() {
    this.tail.rotation.x = Math.sin(this.age * (this.moving ? 3 : 1.2)) * 0.25;
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
      this.fx?.notify(this.sitting ? `Your ${this.petName ?? this.kind} is sitting` : `Your ${this.petName ?? this.kind} follows you`);
      return true;
    }
    if (held?.id !== this.tameItem) return false;
    if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
    if (Math.random() < 0.34) {
      this.tamed = true;
      this.health = this.maxTamedHealth;
      this.onTamed();
      this.fx?.notify(`You tamed a ${this.petName ?? this.kind}! Right-click it to make it sit or follow.`);
      this.fx?.sound('pickup');
    } else {
      this.fx?.notify(`The ${this.petName ?? this.kind} isn't sure about you yet…`);
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
    this.ambientSound = 'dog';
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
        this.onBite?.(target);
      }
    };
    if (this.tamed) {
      // defend the owner from monsters that come close
      // (only ones it can reach: not a zombie idling in a cave far below)
      const foe = !this.sitting && this.nearest((m) => m.hostile && m.kind !== 'creeper'
        && Math.hypot(m.x - player.x, m.z - player.z) < 10 && Math.abs(m.y - this.y) < 3, 14);
      if (foe) { bite(foe, this.biteDamage ?? 4); return; }
      this.follow(player, playerDist);
      return;
    }
    if (this.angry > 0 && !player.dead && playerDist < 16) { bite(player, 3, this.kind); return; }
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
    this.ambientSound = 'cat';
  }

  buildModel() {
    this.coat = (Math.random() * CAT_COATS.length) | 0;
    const coat = CAT_COATS[this.coat], eye = 0x5ac83a, nose = 0xe88a9a;
    const fur = [];
    const c = (m) => { fur.push(this.materials.at(-1)); return m; };
    c(this.part(0.3, 0.3, 0.62, coat, 0, 0.45, 0.05));
    c(this.part(0.32, 0.28, 0.28, coat, 0, 0.62, -0.38));
    c(this.part(0.08, 0.1, 0.05, coat, -0.1, 0.8, -0.38));
    c(this.part(0.08, 0.1, 0.05, coat, 0.1, 0.8, -0.38));
    this.part(0.06, 0.05, 0.02, eye, -0.08, 0.65, -0.53);
    this.part(0.06, 0.05, 0.02, eye, 0.08, 0.65, -0.53);
    this.part(0.05, 0.04, 0.02, nose, 0, 0.58, -0.53);
    this.tail = c(this.part(0.07, 0.07, 0.46, coat, 0, 0.6, 0.55));
    this.tail.rotation.x = -0.5;
    const before = this.materials.length;
    this.quadLegs(coat, 0.09, 0.3, 0.1, 0.2, 0.3);
    fur.push(...this.materials.slice(before));
    this.furParts = fur;
  }

  // (a pet keeps its coat through saves and portals)
  setCoat(i) {
    if (!(i >= 0 && i < CAT_COATS.length)) return;
    this.coat = i;
    for (const m of this.furParts) m.base.setHex(CAT_COATS[i]);
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

// ---------- pandas, sloths, capybaras, polar bears ----------

// a box hinged at its top edge, for limbs that swing from the shoulder
function hingedPart(mob, w, h, d, color, x, y, z) {
  const p = mob.part(w, h, d, color, x, y, z);
  p.geometry = p.geometry.clone();
  p.geometry.translate(0, -h / 2, 0);
  p.position.y = y;
  return p;
}

// Pandas: big and very lazy. They sit about a lot, now and then roll over or
// sneeze, and love sugar cane (the nearest thing here to bamboo).
export class Panda extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 1.1; this.h = 1.2; this.health = 20; this.speed = 0.8; this.fleeSpeed = 2.2; this.kind = 'panda'; this.hurtSound = 'panda';
    this.ambientSound = 'panda';
    this.breedItem = B.SUGAR_CANE;
    this.pose = null;     // {kind: 'sit' | 'roll', t}
  }

  buildModel() {
    const white = 0xeceae4, black = 0x26262a, nose = 0x18181a;
    this.part(1.0, 0.8, 1.3, white, 0, 0.85, 0.05);            // body
    this.part(1.04, 0.5, 0.3, black, 0, 0.92, -0.38);          // black shoulder band
    this.part(0.66, 0.6, 0.56, white, 0, 1.05, -0.78);         // head
    this.part(0.18, 0.2, 0.06, black, -0.17, 1.08, -1.07);     // eye patches
    this.part(0.18, 0.2, 0.06, black, 0.17, 1.08, -1.07);
    this.part(0.06, 0.06, 0.02, 0xf4f4f4, -0.15, 1.1, -1.1);   // eyes
    this.part(0.06, 0.06, 0.02, 0xf4f4f4, 0.15, 1.1, -1.1);
    this.part(0.26, 0.18, 0.16, white, 0, 0.92, -1.1);         // muzzle
    this.part(0.12, 0.07, 0.04, nose, 0, 0.98, -1.19);
    this.part(0.18, 0.16, 0.1, black, -0.26, 1.4, -0.72);      // round ears
    this.part(0.18, 0.16, 0.1, black, 0.26, 1.4, -0.72);
    this.part(0.16, 0.14, 0.12, white, 0, 0.98, 0.74);         // stubby tail
    this.quadLegs(black, 0.3, 0.55, 0.32, 0.42, 0.55);
    // everything hangs off a pivot at the rump, so sitting rocks it back onto
    // its haunches instead of tipping it over its own feet
    this.body = new THREE.Group();
    this.body.position.set(0, 0.3, 0.6);
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.position.y -= 0.3; c.position.z -= 0.6;
      this.body.add(c);
    }
    this.group.add(this.body);
  }

  think(dt, player, playerDist) {
    if (this.pose) {
      this.pose.t -= dt;
      this.moving = false;
      // a sitting panda gets up for food (or when it's had enough)
      const held = !player.dead && playerDist < 8 ? player.heldStack() : null;
      if (this.pose.t <= 0 || this.state === 'flee' || (held && this.likes(held.id)) || this.leash || this.love > 0) this.pose = null;
      else return;
    }
    super.think(dt, player, playerDist);
    if (this.state === 'idle' && !this.baby && Math.random() < dt / 8) {
      this.pose = Math.random() < 0.75 ? { kind: 'sit', t: 6 + Math.random() * 10 } : { kind: 'roll', t: 1.2 };
    } else if (this.baby && this.state === 'idle' && Math.random() < dt / 6) {
      this.pose = { kind: 'roll', t: 1.2 };   // cubs are always rolling about
    }
    // achoo
    if (Math.random() < dt / 90) {
      this.fx?.sound('panda', { pos: this, sneeze: true });
      this.fx?.puff?.(this.x - Math.sin(this.yaw) * 1.1, this.y + 0.95, this.z - Math.cos(this.yaw) * 1.1);
    }
  }

  animate(dt) {
    super.animate(dt);
    const p = this.pose;
    if (p?.kind === 'sit') {
      // back on its haunches, front paws out
      this.body.rotation.x = Math.min(0.7, this.body.rotation.x + dt * 3);
      this.legs[0].rotation.x = this.legs[1].rotation.x = -1.1;
      this.legs[2].rotation.x = this.legs[3].rotation.x = -1.4;   // hind legs stuck out in front
      this.group.rotation.z = 0;
    } else if (p?.kind === 'roll') {
      // flop over onto its side and back
      this.group.rotation.z = Math.sin((1 - p.t / 1.2) * Math.PI) * 1.4;
      this.body.rotation.x = 0;
    } else {
      this.body.rotation.x = Math.max(0, this.body.rotation.x - dt * 3);
      this.group.rotation.z = 0;
    }
  }

  onDeath() {
    this.dropFn?.([{ id: B.SUGAR_CANE, count: (Math.random() * 2) | 0 }]);
  }
}

// Sloths: the slowest thing alive. They climb tree trunks (only trees) to
// hang about in the canopy, and a fall doesn't bother them. They like apples.
export class Sloth extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6; this.h = 0.7; this.health = 8; this.speed = 0.35; this.fleeSpeed = 0.6; this.kind = 'sloth'; this.hurtSound = 'sloth';
    this.ambientSound = 'sloth';
    this.breedItem = I.APPLE;
    this.climbSpeed = 0.9;
    this.safeFall = 14;
  }

  buildModel() {
    const fur = 0x8a7458, light = 0xc8b494, face = 0xe0d2b4, dark = 0x3a2c22;
    this.part(0.5, 0.42, 0.66, fur, 0, 0.5, 0.05);             // body
    this.part(0.38, 0.12, 0.4, light, 0, 0.74, 0.1);           // shaggy back
    this.part(0.36, 0.32, 0.32, fur, 0, 0.62, -0.42);          // head
    this.part(0.28, 0.2, 0.06, face, 0, 0.62, -0.59);          // pale face
    this.part(0.12, 0.05, 0.03, dark, -0.08, 0.66, -0.62);     // the dark eye stripes
    this.part(0.12, 0.05, 0.03, dark, 0.08, 0.66, -0.62);
    this.part(0.06, 0.04, 0.03, dark, 0, 0.58, -0.62);         // nose
    this.part(0.1, 0.02, 0.02, dark, 0, 0.54, -0.62);          // the smile
    // long arms with hooked claws, short legs
    this.legs = [];
    for (const [x, z, h] of [[-0.29, -0.2, 0.42], [0.29, -0.2, 0.42], [-0.22, 0.3, 0.3], [0.22, 0.3, 0.3]]) {
      const l = hingedPart(this, 0.12, h, 0.12, fur, x, 0.45, z);
      const claw = this.part(0.13, 0.05, 0.08, 0xd8d0c0, 0, -h + 0.02, -0.06);
      this.group.remove(claw); l.add(claw);
      this.legs.push(l);
    }
  }

  think(dt, player, playerDist) {
    super.think(dt, player, playerDist);
    // up tree trunks only (not walls or cliffs); the canopy is where it likes to be
    const ax = Math.floor(this.x - Math.sin(this.yaw) * (this.w / 2 + 0.3));
    const az = Math.floor(this.z - Math.cos(this.yaw) * (this.w / 2 + 0.3));
    const ahead = this.world.getBlockW(ax, Math.floor(this.y + 0.3), az);
    this.climber = ahead === B.OAK_LOG || ahead === B.BIRCH_LOG || ahead === B.SPRUCE_LOG || ahead === B.PALM_LOG;
    if (this.climber) this.legs[0].rotation.x = this.legs[1].rotation.x = -2.4;   // reaching up the trunk
  }

  animate(dt) {
    // a slow-motion walk
    const swing = Math.sin(this.walkPhase * 0.6) * (this.moving ? 0.5 : 0);
    if (!this.climber) { this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing; }
    this.legs[2].rotation.x = -swing;
    this.legs[3].rotation.x = swing;
  }
}

// Capybaras: calm, sociable and fond of water. They come in groups along
// rivers and swamps and float about placidly. Wheat or sugar cane wins them over.
export class Capybara extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.7; this.h = 0.75; this.health = 10; this.speed = 1.1; this.fleeSpeed = 2.8; this.kind = 'capybara'; this.hurtSound = 'capybara';
    this.ambientSound = 'capybara';
    this.breedItem = I.WHEAT;
    this.breedAlso = [B.SUGAR_CANE];
    this.likesWater = true;
  }

  buildModel() {
    const fur = 0x9a6a42, dark = 0x6a4428, snout = 0x4a3020;
    this.part(0.6, 0.5, 0.92, fur, 0, 0.5, 0.05);              // barrel body
    this.part(0.46, 0.14, 0.7, dark, 0, 0.78, 0.05);           // darker back
    this.part(0.4, 0.4, 0.44, fur, 0, 0.62, -0.56);            // big blunt head
    this.part(0.34, 0.24, 0.12, snout, 0, 0.56, -0.8);         // square snout
    this.part(0.05, 0.05, 0.02, 0x111111, -0.15, 0.72, -0.72); // sleepy eyes, high up
    this.part(0.05, 0.05, 0.02, 0x111111, 0.15, 0.72, -0.72);
    this.part(0.1, 0.08, 0.06, dark, -0.14, 0.86, -0.5);       // little ears
    this.part(0.1, 0.08, 0.06, dark, 0.14, 0.86, -0.5);
    this.quadLegs(dark, 0.14, 0.3, 0.2, 0.32, 0.3);
  }

  update(dt, player) {
    super.update(dt, player);
    if (this.dead || this.dying !== undefined) return;
    // floats low and level, nose just out (not while climbing out at a bank)
    if (this.inWater && !(this.lastHitWall && this.moving)) {
      const bx = Math.floor(this.x), bz = Math.floor(this.z);
      let top = Math.floor(this.y);
      while (top < Math.floor(this.y) + 3 && this.world.getBlockW(bx, top, bz) === B.WATER) top++;
      this.vy = (top - 0.45 - this.y) * 4;
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.LEATHER, count: (Math.random() * 2) | 0 }]);
  }
}

// Polar bears: neutral. They leave you be unless you hit one or come near
// its cub, then rear up and swipe. Strong swimmers; they'll eat raw fish.
export class PolarBear extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 1.3; this.h = 1.4; this.health = 30; this.speed = 1.2; this.fleeSpeed = 3.6; this.kind = 'polarbear';
    this.ambientSound = 'polarbear';
    this.breedItem = I.FISH_RAW;
    this.likesWater = true;
    this.anger = 0;       // seconds left going after the player
    this.swipe = 0;       // >0 while rearing up to strike
    this.swipeCooldown = 0;
  }

  buildModel() {
    const fur = 0xf0ece0, shade = 0xd8d2c2, dark = 0x1c1c1e;
    this.front = new THREE.Group();                 // the front half rears up to strike
    this.front.position.set(0, 0.75, 0.1);
    this.group.add(this.front);
    const fp = (w, h, d, c, x, y, z) => { const m = this.part(w, h, d, c, x, y - 0.75, z - 0.1); this.group.remove(m); this.front.add(m); return m; };
    this.part(1.1, 0.85, 0.8, fur, 0, 0.95, 0.45);             // hindquarters
    fp(1.15, 0.9, 0.9, fur, 0, 1.0, -0.3);                     // shoulders
    fp(0.6, 0.55, 0.6, fur, 0, 1.15, -0.95);                   // head
    fp(0.34, 0.26, 0.24, shade, 0, 1.05, -1.32);               // muzzle
    fp(0.14, 0.09, 0.04, dark, 0, 1.13, -1.45);                // nose
    fp(0.06, 0.06, 0.02, dark, -0.17, 1.26, -1.26);            // eyes
    fp(0.06, 0.06, 0.02, dark, 0.17, 1.26, -1.26);
    fp(0.14, 0.12, 0.08, fur, -0.24, 1.48, -0.86);             // ears
    fp(0.14, 0.12, 0.08, fur, 0.24, 1.48, -0.86);
    // legs: the front pair rides with the shoulders
    const legH = 0.6;
    this.legs = [];
    for (const [x, z, front] of [[-0.36, -0.42, true], [0.36, -0.42, true], [-0.36, 0.55, false], [0.36, 0.55, false]]) {
      const l = hingedPart(this, 0.32, legH, 0.32, shade, x, legH, z);
      if (front) { this.group.remove(l); this.front.add(l); l.position.set(x, legH - 0.75, z - 0.1); }
      this.legs.push(l);
    }
  }

  // hit it and it fights back instead of running
  damage(amount, source) {
    const hit = super.damage(amount, source);
    if (hit && source && !source.kind && this.health > 0 && !this.baby) {
      this.anger = 20;
      this.state = 'chase';
    }
    // a cub that's hurt sends its mother after you
    if (hit && source && !source.kind && this.baby) {
      for (const m of this.fx?.mobs() ?? []) if (m.kind === 'polarbear' && !m.baby && !m.dead && this.dist(m) < 16) m.anger = 20;
    }
    return hit;
  }

  think(dt, player, playerDist) {
    this.anger = Math.max(0, this.anger - dt);
    this.swipeCooldown = Math.max(0, this.swipeCooldown - dt);
    const fair = !this.baby && !player.dead && player.mode !== GAMEMODE_CREATIVE && (player.mobDamageScale ?? 1) > 0;
    // a mother with her cub close by warns you off, then charges
    if (fair && !this.anger && playerDist < 6 && !this.tamed) {
      const cub = this.nearest((m) => m.kind === 'polarbear' && m.baby, 10);
      if (cub && this.canSee(player)) {
        this.anger = 12;
        this.fx?.sound('polarbear', { pos: this, vol: 1.2, pitch: 0.8 });
      }
    }
    if (this.swipe > 0) {
      // rearing up: the blow lands at the top
      this.swipe -= dt;
      this.moving = false;
      this.steer(player, 1);
      if (this.swipe <= 0) {
        this.swipeCooldown = 1.4;
        if (fair && Math.hypot(player.x - this.x, player.z - this.z) < 2.6 && Math.abs(player.y - this.y) < 2) {
          if (this.meleeHit(player, 4, 'polarbear')) this.fx?.sound('hit', { pos: this });
        }
      }
      return;
    }
    if (this.anger > 0 && fair && playerDist < 24) {
      this.state = 'chase';
      this.steer(player, 1);
      this.moving = playerDist > 1.8;
      if (playerDist < 2.3 && this.swipeCooldown <= 0 && this.canSee(player)) {
        this.swipe = 0.45;
        this.fx?.sound('polarbear', { pos: this, vol: 1.1 });
      }
      return;
    }
    if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
    super.think(dt, player, playerDist);
  }

  animate(dt) {
    super.animate(dt);
    // rear up while winding a swipe, and down again
    const up = this.swipe > 0 ? 0.75 : 0;
    this.front.rotation.x += (up - this.front.rotation.x) * Math.min(1, dt * 10);
  }

  onDeath() {
    this.dropFn?.([{ id: I.FISH_RAW, count: (Math.random() * 3) | 0 }]);
  }
}

// ---------- deserts and beaches ----------

// Camels: tall, slow and sure-footed desert travellers. Feed one cactus (or
// wheat) and climb on until it trusts you; saddled, you ride high up with a
// long view over the dunes. Slower than a horse, but steadier.
const CAMEL_FOOD = new Map([[B.CACTUS, 5], [I.WHEAT, 3], [B.HAY_BALE, 10], [B.DEAD_BUSH, 2], [I.GOLDEN_CARROT, 20], [I.GOLDEN_APPLE, 20]]);

export class Camel extends Horse {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'camel'; this.label = 'camel';
    this.hurtSound = this.ambientSound = 'camel';
    this.w = 1.3; this.h = this.standH = 2.1;
    this.health = this.maxHealth = 30 + ((Math.random() * 6) | 0);
    this.speed = 1.1; this.fleeSpeed = 3.2;
    this.gallop = 6.2 + Math.random() * 1.2;   // a steady lope
    this.jumpV = 8.6;                          // over a block, not a fence
    this.rideSpeed = 3.4;
    this.temper = 55;                          // calmer than a wild horse
    this.tamingFood = CAMEL_FOOD;
    this.diet = [...CAMEL_FOOD.keys()];
    this.breedAlso = [B.CACTUS];
  }

  buildModel() {
    const fur = 0xc89a5e, dark = 0x9c7240, muzzle = 0x7a5530, hoof = 0x4a3a2a;
    this.coat = 0; this.coatParts = []; this.maneParts = [];
    this.part(0.7, 0.62, 1.4, fur, 0, 1.42, 0.05);              // body, up on long legs
    this.part(0.5, 0.36, 0.42, fur, 0, 1.86, -0.22);            // front hump
    this.part(0.46, 0.32, 0.4, fur, 0, 1.84, 0.4);              // back hump
    this.part(0.28, 0.7, 0.3, fur, 0, 1.62, -0.82).rotation.x = 0.55;   // long neck, reaching forward
    this.part(0.3, 0.3, 0.52, fur, 0, 1.98, -1.12);             // head
    this.part(0.24, 0.2, 0.16, muzzle, 0, 1.92, -1.4);          // droopy lips
    this.part(0.06, 0.06, 0.02, 0x111111, -0.15, 2.04, -1.24);  // eyes
    this.part(0.06, 0.06, 0.02, 0x111111, 0.15, 2.04, -1.24);
    this.part(0.08, 0.1, 0.06, dark, -0.12, 2.18, -1.0);        // ears
    this.part(0.08, 0.1, 0.06, dark, 0.12, 2.18, -1.0);
    this.part(0.1, 0.42, 0.1, dark, 0, 1.28, 0.78).rotation.x = 0.4;   // tail
    this.quadLegs(fur, 0.2, 1.12, 0.22, 0.52, 1.12);
    for (const l of this.legs) { const h = this.part(0.26, 0.1, 0.28, hoof, 0, -1.08, 0); this.group.remove(h); l.add(h); }
    // the saddle sits between the humps
    this.saddleParts = [
      this.part(0.74, 0.12, 0.42, 0xa0442c, 0, 1.8, 0.1),
      this.part(0.78, 0.06, 0.46, 0xe0b040, 0, 1.75, 0.1),
      this.part(0.04, 0.5, 0.04, 0x4a2a14, -0.38, 1.5, 0.1), this.part(0.04, 0.5, 0.04, 0x4a2a14, 0.38, 1.5, 0.1),
    ];
    for (const m of this.saddleParts) m.visible = false;
  }

  setCoat() {}   // one sandy coat
  get seat() { return 1.8; }

  saveExtra() { const e = super.saveExtra(); delete e.coat; return e; }
}

// Seagulls: noisy white gulls wheeling over beaches and the sea in groups,
// settling on the sand.
export class Seagull extends Bird {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'seagull';
    this.w = 0.4; this.h = 0.35;
    this.ambientSound = this.hurtSound = 'seagull';
    this.phase = Math.random() * 10;
  }

  // long glides on held-out wings between a few slow beats
  animate() {
    const grounded = this.state === 'roost' && this.onGround;
    const beating = this.state === 'flee' || this.targetVy > 0.5 || Math.sin(this.age * 0.9 + this.phase) > 0.3;
    const f = grounded ? 0 : beating ? Math.sin(this.age * 13) * 0.55 : -0.1 + Math.sin(this.age * 2) * 0.04;
    this.wings[0].rotation.z = f;
    this.wings[1].rotation.z = -f;
  }

  buildModel() {
    const white = 0xf2f2ee, grey = 0x9ea4aa, tip = 0x2a2a2c, beak = 0xf0c230;
    this.part(0.22, 0.18, 0.4, white, 0, 0.14, 0);              // body
    this.part(0.18, 0.17, 0.18, white, 0, 0.24, -0.24);         // head
    this.part(0.05, 0.05, 0.12, beak, 0, 0.22, -0.39);          // yellow beak
    this.part(0.03, 0.03, 0.02, 0x111111, -0.07, 0.27, -0.33);  // eyes
    this.part(0.03, 0.03, 0.02, 0x111111, 0.07, 0.27, -0.33);
    this.part(0.16, 0.04, 0.16, grey, 0, 0.19, 0.24);           // tail
    // long grey wings with black tips
    this.wings = [];
    for (const side of [-1, 1]) {
      const w = this.part(0.46, 0.03, 0.2, grey, side * 0.32, 0.18, 0);
      const t = this.part(0.12, 0.031, 0.2, tip, side * 0.17, 0, 0);
      this.group.remove(t); w.add(t);
      this.wings.push(w);
    }
  }

  onDeath() { this.dropFn?.([{ id: I.FEATHER, count: (Math.random() * 3) | 0 }]); }
}

// Pelicans: big beach birds with a pouched bill. They stand about on the
// sand, float on the water and now and then plunge their bill in for a
// fish. Raw fish wins them over.
export class Pelican extends Duck {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'pelican';
    this.w = 0.7; this.h = 1.0; this.health = 8; this.speed = 0.9; this.fleeSpeed = 2.6;
    this.ambientSound = this.hurtSound = 'pelican';
    this.breedItem = I.FISH_RAW;
    this.fishing = 0;
  }

  buildModel() {
    const white = 0xf0eee8, grey = 0xb8b6b0, bill = 0xe8a040, pouch = 0xe8c070, legC = 0x5a5a5e;
    this.plumage = { body: [], wing: [], head: [] };
    this.part(0.5, 0.46, 0.8, white, 0, 0.56, 0.05);            // body
    this.part(0.42, 0.12, 0.36, grey, 0, 0.66, 0.5);            // tail
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.74, -0.28);
    this.group.add(this.neck);
    const np = (w, h, d, c, x, y, z) => { const m = this.part(w, h, d, c, x, y, z); this.group.remove(m); this.neck.add(m); return m; };
    np(0.16, 0.4, 0.16, white, 0, 0.2, 0);                      // neck
    np(0.24, 0.22, 0.26, white, 0, 0.46, -0.04);                // head
    np(0.04, 0.04, 0.02, 0x111111, -0.1, 0.5, -0.17);
    np(0.04, 0.04, 0.02, 0x111111, 0.1, 0.5, -0.17);
    np(0.1, 0.06, 0.5, bill, 0, 0.44, -0.4);                    // the long bill
    np(0.1, 0.14, 0.4, pouch, 0, 0.35, -0.36);                  // and its pouch
    this.collar = this.part(0.01, 0.01, 0.01, white, 0, 0.5, 0); this.collar.visible = false;
    this.wings = [this.part(0.06, 0.32, 0.62, grey, -0.27, 0.6, 0.06), this.part(0.06, 0.32, 0.62, grey, 0.27, 0.6, 0.06)];
    const leg = (x) => {
      const l = this.part(0.07, 0.34, 0.07, legC, x, 0.34, 0.06);
      l.geometry = l.geometry.clone(); l.geometry.translate(0, -0.17, 0); l.position.y = 0.34;
      const foot = this.part(0.16, 0.03, 0.18, 0xd89848, 0, -0.33, -0.05); this.group.remove(foot); l.add(foot);
      return l;
    };
    this.legs = [leg(-0.12), leg(0.12)];
  }

  setDrake() {}   // one plumage
  saveExtra() { return null; }
  loadExtra() {}

  think(dt, player, playerDist) {
    // floating: now and then dip the bill in for a fish (not on a lead, or when frightened)
    const free = !this.leash && this.state !== 'flee';
    if (!free) this.fishing = 0;
    if (this.fishing > 0) { this.fishing -= dt; this.moving = false; return; }
    if (free && this.inWater && Math.random() < dt / 12) {
      this.fishing = 1.2;
      this.fx?.sound('splash', { pos: this, vol: 0.35 });
      return;
    }
    super.think(dt, player, playerDist);
  }

  animate(dt) {
    super.animate?.(dt);
    // the neck dips into the water while fishing
    const dip = this.fishing > 0 ? Math.sin((1 - this.fishing / 1.2) * Math.PI) : 0;
    this.neck.rotation.x = -dip * 1.4;
  }

  onDeath() {
    this.dropFn?.([{ id: I.FEATHER, count: 1 + ((Math.random() * 2) | 0) }, { id: I.FISH_RAW, count: Math.random() < 0.3 ? 1 : 0 }]);
  }
}

// Crabs: little red-orange beach crabs scuttling sideways over the sand. Leave
// them be and they mind their claws; hit one and it pinches back for a while.
// Kelp tempts them (and breeds them); they make good eating cooked.
export class Crab extends Animal {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6; this.h = 0.35; this.health = 6; this.speed = 1.1; this.fleeSpeed = 2.6;
    this.kind = 'crab';
    this.ambientSound = this.hurtSound = 'crab';
    this.breedItem = B.KELP;
    this.breedAlso = [I.DRIED_KELP];
    this.angry = 0;
    this.pinchCooldown = 0;
  }

  buildModel() {
    // it walks "forward" along its side, so the face is on its left (-x)
    const shell = 0xd0502c, dark = 0xa03a1c, light = 0xe87a4a, claw = 0xb8441f;
    this.part(0.5, 0.18, 0.4, shell, 0, 0.2, 0);                  // shell
    this.part(0.38, 0.06, 0.3, light, 0, 0.31, 0);               // a paler back
    // eyes on stalks
    for (const z of [-0.08, 0.08]) {
      this.part(0.03, 0.12, 0.03, dark, -0.18, 0.34, z);
      this.part(0.05, 0.05, 0.05, 0x111111, -0.18, 0.42, z);
    }
    // claws held out in front of the face
    this.claws = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(-0.24, 0.2, side * 0.14);
      this.group.add(arm);
      const add = (m) => { this.group.remove(m); arm.add(m); return m; };
      add(this.part(0.14, 0.06, 0.06, dark, -0.06, 0, 0));
      add(this.part(0.12, 0.1, 0.1, claw, -0.16, 0.02, 0));
      const pincer = add(this.part(0.08, 0.03, 0.06, claw, -0.2, 0.08, 0));
      this.claws.push({ arm, pincer });
    }
    // three jointed legs a side, reaching out and down to the sand (it walks along z)
    this.legs = [];
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(-0.12 + i * 0.12, 0.18, side * 0.18);
        this.group.add(leg);
        const upper = this.part(0.05, 0.05, 0.2, dark, 0, 0.04, side * 0.1);
        upper.rotation.x = -side * 0.4;   // up and out from the shell...
        const lower = this.part(0.05, 0.22, 0.05, dark, 0, -0.04, side * 0.2);   // ...then down to the sand
        for (const m of [upper, lower]) { this.group.remove(m); leg.add(m); }
        this.legs.push(leg);
      }
    }
  }

  animate() {
    // legs patter, claws wave (snap when cross)
    const swing = Math.sin(this.walkPhase * 2.2) * (this.moving ? 0.4 : 0);
    this.legs.forEach((leg, i) => { leg.rotation.y = (i % 2 ? swing : -swing) * (i % 4 < 2 ? 1 : -1); });
    const snap = this.angry > 0 ? Math.abs(Math.sin(this.age * 10)) * 0.5 : Math.abs(Math.sin(this.age * 1.5)) * 0.12;
    for (const c of this.claws) { c.pincer.rotation.z = snap; c.arm.rotation.z = this.angry > 0 ? 0.35 : 0.1; }
  }

  damage(amount, source) {
    const hit = super.damage(amount, source);
    // hit by a player (mobs and blasts have a kind): a grown crab pinches back
    // rather than running away; a little one just runs
    if (hit && source && !source.kind && this.health > 0 && !this.baby) { this.angry = 8; this.state = 'idle'; this.stateTime = 0.3; }
    return hit;
  }

  think(dt, player, playerDist) {
    this.angry = Math.max(0, this.angry - dt);
    this.pinchCooldown = Math.max(0, this.pinchCooldown - dt);
    // nobody to pinch in creative or peaceful; on a lead it goes where it's led
    const fair = !player.dead && player.mode !== GAMEMODE_CREATIVE && (player.mobDamageScale ?? 1) > 0;
    if (!fair || this.leash) this.angry = 0;
    if (this.angry > 0 && playerDist < 10) {
      this.leashSpeed = 0; this.hurry = false;
      this.state = 'chase';
      this.moving = playerDist > 1;
      this.steer(player, 1);
      if (this.dist3(player) < 1.3 && this.pinchCooldown <= 0 && this.meleeHit(player, 1, 'crab')) {
        this.pinchCooldown = 1.2;
        this.fx?.sound('crab', { pos: this, pitch: 1.4 });
      }
      return;
    }
    if (this.state === 'chase') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
    super.think(dt, player, playerDist);
  }

  onDeath() {
    this.dropFn?.([{ id: I.CRAB_RAW, count: 1 }]);
  }
}
