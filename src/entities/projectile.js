// Projectiles: arrows (ballistic flight, stick into blocks; skeleton arrows
// hurt the player, the player's hurt mobs and can be picked up again) and
// thrown snowballs and eggs (pop on whatever they hit).

import * as THREE from 'three';
import { isSolid, isWater } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';

const GRAVITY = 20;
const WATER_DRAG = 2.2;   // per second: arrows slow right down underwater
const shaftGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
const shaftMat = new THREE.MeshBasicMaterial({ color: 0x8a6a44 });
// an arrow's head (at the front: +z faces where it's flying) and its fletching
const headGeo = new THREE.BoxGeometry(0.09, 0.09, 0.1).translate(0, 0, 0.32);
const fletchGeo = new THREE.BoxGeometry(0.14, 0.012, 0.14).translate(0, 0, -0.24);
const ballGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const snowMat = new THREE.MeshBasicMaterial({ color: 0xf2f6fb });
const eggMat = new THREE.MeshBasicMaterial({ color: 0xe8d8b4 });

export class Arrow {
  // owner: 'mob' | 'player'; pickup: can the player collect it once stuck
  constructor(scene, world, x, y, z, vx, vy, vz, damage, owner = 'mob', pickup = false) {
    this.owner = owner;
    this.pickup = pickup;
    this.scene = scene;
    this.world = world;
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.damage = damage;
    this.age = 0;
    this.stuck = false;
    this.dead = false;
    this.mesh = this.makeMesh();
    this.base = this.mesh.material.color.clone();
    scene.add(this.mesh);
    this.orient();
  }

  makeMesh() {
    const m = new THREE.Mesh(shaftGeo, shaftMat.clone());
    // a grey head, and white fletching in a cross at the tail
    const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: 0x9a9aa2 }));
    const f1 = new THREE.Mesh(fletchGeo, new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }));
    const f2 = new THREE.Mesh(fletchGeo, f1.material);
    f2.rotation.z = Math.PI / 2;
    m.add(head, f1, f2);
    for (const c of m.children) c.userData.base = c.material.color.clone();
    return m;
  }

  // shaded by the light where it is, like everything else in the world
  shade() {
    if ((this._lt = (this._lt ?? 0) - 1) > 0) return;
    this._lt = 6;
    const l = this.world.lightAt(this.x, this.y, this.z);
    this.mesh.material.color.copy(this.base).multiplyScalar(l);
    for (const c of this.mesh.children) if (c.userData.base) c.material.color.copy(c.userData.base).multiplyScalar(l);
  }

  orient() {
    this.shade();
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.lookAt(this.x + this.vx, this.y + this.vy, this.z + this.vz);
  }

  update(dt, player, mobs, onPickup) {
    this.age += dt;
    if (this.age > (this.stuck ? (this.pickup ? 60 : 8) : 6)) { this.kill(); return; }
    if (this.stuck) {
      if (this.pickup && this.age > 0.5 && Math.abs(this.x - player.x) < 1.3 && Math.abs(this.z - player.z) < 1.3
        && this.y > player.y - 0.5 && this.y < player.y + 2.3 && player.give(I.ARROW, 1) === 0) {
        onPickup?.();
        this.kill();
      }
      return;
    }

    this.vy -= (this.gravity ?? GRAVITY) * dt;
    if (isWater(this.world.getBlockW(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)))) {
      const k = Math.exp(-WATER_DRAG * dt);
      this.vx *= k; this.vy *= k; this.vz *= k;
    }
    // small substeps so fast arrows don't tunnel through blocks or the player
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy, this.vz) * dt / 0.25));
    for (let i = 0; i < steps; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      this.z += (this.vz * dt) / steps;
      if (isSolid(this.world.getBlockW(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)))) {
        this.hitBlock();
        return;
      }
      if (this.owner === 'player') {
        for (const m of mobs) {
          if (m.dead || m.dying !== undefined || m.kind === 'tnt' || m.kind === 'falling' || m.tamed || m.owned || m === player.mount) continue;   // flies past your own pets and horse (and the fallen)
          if (this.onlyHostile && !m.hostile) continue;   // (a pet's fire is for monsters)
          const hw = m.w / 2 + 0.1;
          if (Math.abs(this.x - m.x) < hw && Math.abs(this.z - m.z) < hw && this.y > m.y && this.y < m.y + m.h) {
            this.hitMob(m);
            return;
          }
        }
        continue;
      }
      if (!player.dead && Math.abs(this.x - player.x) < 0.4 && Math.abs(this.z - player.z) < 0.4
        && this.y > player.y && this.y < player.y + 1.85) {
        player.damage(this.damage, this.cause ?? 'skeleton');
        this.onHitPlayer?.(player);
        // knock the player back along the arrow's path
        const len = Math.hypot(this.vx, this.vz) || 1;
        player.vx += (this.vx / len) * 4;
        player.vz += (this.vz / len) * 4;
        this.kill();
        return;
      }
    }
    this.orient();
  }

  hitBlock() {
    this.stuck = true;
    this.orient();
    this.onStick?.(this);
  }

  hitMob(m) {
    m.hurtCooldown = 0;
    m.damage(this.damage, { x: this.x - this.vx, z: this.z - this.vz });
    this.kill();
  }

  kill() {
    this.dead = true;
    this.scene.remove(this.mesh);
    this.mesh.material.dispose();
    for (const c of this.mesh.children) c.material?.dispose();
  }
}

// A drake's (or the dragon's) fireball: flies straight, sets you alight,
// and bursts harmlessly on whatever block it meets.
const fireGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
export class Fireball extends Arrow {
  // owner 'player': a pet's, which hits monsters (never you or your animals)
  constructor(scene, world, x, y, z, vx, vy, vz, damage, owner = 'mob') {
    super(scene, world, x, y, z, vx, vy, vz, damage, owner, false);
    this.gravity = 0;
    this.onlyHostile = owner === 'player';
  }

  hitMob(m) {
    if (!m.fireproof) m.fireTime = Math.max(m.fireTime ?? 0, 3);
    super.hitMob(m);
  }

  makeMesh() { return new THREE.Mesh(fireGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false })); }

  shade() {}   // it glows

  orient() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.x += 0.3; this.mesh.rotation.y += 0.2;
    this.mesh.material.color.setHex(Math.sin(this.age * 30) > 0 ? 0xffa040 : 0xff6a20);
  }

  update(dt, player, mobs, onPickup) {
    // water puts it out
    if (isWater(this.world.getBlockW(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)))) { this.hitBlock(); return; }
    super.update(dt, player, mobs, onPickup);
  }

  hitBlock() {
    this.onBurst?.(this);
    this.kill();
  }
}

// Snowballs and eggs thrown by the player: no damage, a little knockback,
// and an egg sometimes hatches a chick where it lands.
export class Thrown extends Arrow {
  constructor(scene, world, x, y, z, vx, vy, vz, kind, onHatch) {
    super(scene, world, x, y, z, vx, vy, vz, 0, 'player', false);
    this.kind = kind;
    this.onHatch = onHatch;
    this.mesh.material.color.copy((kind === 'egg' ? eggMat : snowMat).color);
    this.base = this.mesh.material.color.clone();
    this._lt = 0; this.shade();
  }

  makeMesh() { return new THREE.Mesh(ballGeo, snowMat.clone()); }

  orient() { this.shade(); this.mesh.position.set(this.x, this.y, this.z); }

  splat() {
    if (this.kind === 'egg' && Math.random() < 0.125) this.onHatch?.(this.x - this.vx * 0.02, this.y + 0.2, this.z - this.vz * 0.02);
    this.kill();
  }

  hitBlock() { this.splat(); }

  hitMob(m) {
    m.hurtCooldown = 0;
    // a harmless thump: knockback only (snowballs do sting a little)
    m.damage(this.kind === 'snowball' ? 0.01 : 0, { x: this.x - this.vx, z: this.z - this.vz });
    this.splat();
  }
}

// The fishing bobber: cast it into water, wait for a bite (it ducks under),
// and reel in while it's down to land a catch.
const bobberGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const bobberMat = new THREE.MeshBasicMaterial({ color: 0xd8332c });
export class Bobber extends Arrow {
  constructor(scene, world, x, y, z, vx, vy, vz) {
    super(scene, world, x, y, z, vx, vy, vz, 0, 'bobber', false);
    this.floating = false;
    this.wait = 0;        // seconds until the next bite
    this.biteTime = 0;    // > 0 while a fish is on the line
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x222222 }));
    scene.add(this.line);
  }

  makeMesh() { return new THREE.Mesh(bobberGeo, bobberMat.clone()); }

  orient() { this.shade(); this.mesh.position.set(this.x, this.y - (this.biteTime > 0 ? 0.18 : 0), this.z); }

  get biting() { return this.biteTime > 0; }

  update(dt, player) {
    this.age += dt;
    // reel in automatically if the player wanders off
    if (this.age > 120 || Math.hypot(this.x - player.x, this.z - player.z) > 32) { this.kill(); return; }
    // the water it floats on was scooped away: it drops
    if (this.floating && !isWater(this.world.getBlockW(Math.floor(this.x), Math.floor(this.surface - 0.5), Math.floor(this.z)))) {
      this.floating = false; this.biteTime = 0; this.vx = this.vz = this.vy = 0;
    }
    if (this.floating) {
      this.y = this.surface + Math.sin(this.age * 3) * 0.03;
      if (this.biteTime > 0) {
        this.biteTime -= dt;
        if (this.biteTime <= 0) this.wait = 4 + Math.random() * 12;   // it got away
      } else if ((this.wait -= dt) <= 0) {
        this.biteTime = 1.1;
        this.onBite?.();
      }
    } else {
      this.vy -= GRAVITY * 0.6 * dt;
      // in steps, so a fast cast can't pass through a wall on a slow frame
      const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy, this.vz) * dt) / 0.3));
      for (let s = 0; s < steps && !this.floating; s++) {
        const px = this.x, py = this.y, pz = this.z;
        this.x += this.vx * dt / steps; this.y += this.vy * dt / steps; this.z += this.vz * dt / steps;
        const id = this.world.getBlockW(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
        if (isWater(id)) {
          // float on top of the water column
          let y = Math.floor(this.y);
          while (isWater(this.world.getBlockW(Math.floor(this.x), y + 1, Math.floor(this.z)))) y++;
          this.surface = y + 0.9;
          this.floating = true;
          this.wait = 5 + Math.random() * 15;
          this.onSplash?.();
        } else if (isSolid(id)) {
          // came down on top of it: rest there; hit its side: stop against it
          this.vx = this.vz = 0; this.vy = 0;
          if (py >= Math.floor(this.y) + 1) this.y = Math.floor(this.y) + 1.05;
          else { this.x = px; this.y = py; this.z = pz; }
          this.grounded = true;
          break;
        }
      }
      if (this.grounded) this.vy = 0;
    }
    this.orient();
    const pos = this.line.geometry.attributes.position;
    const dir = player.lookDir();
    pos.setXYZ(0, player.x + dir.x * 0.6 - dir.z * 0.3, player.eyeY - 0.3, player.z + dir.z * 0.6 + dir.x * 0.3);
    pos.setXYZ(1, this.x, this.y, this.z);
    pos.needsUpdate = true;
  }

  kill() {
    super.kill();
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
