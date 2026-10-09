// Arrows shot by skeletons: ballistic flight, stick into blocks, hurt the player.

import * as THREE from 'three';
import { isSolid } from '../blocks/blocks.js';

const GRAVITY = 20;
const shaftGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
const shaftMat = new THREE.MeshBasicMaterial({ color: 0x8a6a44 });

export class Arrow {
  constructor(scene, world, x, y, z, vx, vy, vz, damage) {
    this.scene = scene;
    this.world = world;
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.damage = damage;
    this.age = 0;
    this.stuck = false;
    this.dead = false;
    this.mesh = new THREE.Mesh(shaftGeo, shaftMat);
    scene.add(this.mesh);
    this.orient();
  }

  orient() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.lookAt(this.x + this.vx, this.y + this.vy, this.z + this.vz);
  }

  update(dt, player) {
    this.age += dt;
    if (this.age > (this.stuck ? 8 : 6)) { this.kill(); return; }
    if (this.stuck) return;

    this.vy -= GRAVITY * dt;
    // small substeps so fast arrows don't tunnel through blocks or the player
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy, this.vz) * dt / 0.25));
    for (let i = 0; i < steps; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      this.z += (this.vz * dt) / steps;
      if (isSolid(this.world.getBlockW(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)))) {
        this.stuck = true;
        break;
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

  kill() {
    this.dead = true;
    this.scene.remove(this.mesh);
  }
}
