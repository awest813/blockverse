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

  makeMesh() { return new THREE.Mesh(shaftGeo, shaftMat.clone()); }

  // shaded by the light where it is, like everything else in the world
  shade() {
    if ((this._lt = (this._lt ?? 0) - 1) > 0) return;
    this._lt = 6;
    this.mesh.material.color.copy(this.base).multiplyScalar(this.world.lightAt(this.x, this.y, this.z));
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

    this.vy -= GRAVITY * dt;
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
          if (m.dead || m.dying !== undefined || m.kind === 'tnt' || m.tamed) continue;   // flies past your own pets (and the fallen)
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
        player.damage(this.damage, 'skeleton');
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
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
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
        this.vx = this.vz = 0; this.vy = 0;
        this.y = Math.floor(this.y) + 1.05;
        this.grounded = true;
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
