// Bees: little fliers that come and go from their hive, visiting the
// flowers round it. They belong to the hive (world/produce.js keeps the
// count): not saved, not counted against the spawn caps, and they go back
// in at night, when the hive's gone, or when you've wandered off.

import { Mob } from './mob.js';
import { B } from '../blocks/blocks.js';

const FLOWERS = new Set([B.DANDELION, B.POPPY]);

export class Bee extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.3; this.h = 0.3; this.health = 2; this.speed = 2.2; this.fleeSpeed = 3;
    this.flier = true;
    this.kind = 'bee';
    this.countsForCap = false;
    this.moving = true;
    this.hive = null;     // {x, y, z}
    this.target = null;
  }

  buildModel() {
    const fur = 0xe8b830, band = 0x2a2420, wing = 0xe8f4ff;
    this.part(0.16, 0.14, 0.24, fur, 0, 0.12, 0);              // body
    this.part(0.17, 0.15, 0.04, band, 0, 0.12, 0.05);          // stripes
    this.part(0.17, 0.15, 0.04, band, 0, 0.12, -0.04);
    this.part(0.12, 0.12, 0.08, band, 0, 0.13, -0.15);         // head
    this.wings = [this.part(0.14, 0.02, 0.1, wing, -0.1, 0.21, 0.02), this.part(0.14, 0.02, 0.1, wing, 0.1, 0.21, 0.02)];
  }

  think(dt, player, playerDist) {
    const h = this.hive;
    if (!h || this.world.getBlockW(h.x, h.y, h.z) !== B.BEEHIVE || playerDist > 40) { this.kill(); return; }
    const home = { x: h.x + 0.5, y: h.y + 0.3, z: h.z + 0.5 };
    // nightfall: back in
    const night = this.world.materials.uniforms.uDay.value < 0.35;
    if (night) {
      this.target = home;
      if (Math.hypot(home.x - this.x, home.y - this.y, home.z - this.z) < 0.9) { this.kill(); return; }
    } else {
      this.stateTime -= dt;
      if (!this.target || this.stateTime <= 0) {
        this.stateTime = 3 + Math.random() * 4;
        this.target = Math.random() < 0.25 ? home : this.flower(h) ?? { x: home.x + (Math.random() - 0.5) * 6, y: home.y + 1, z: home.z + (Math.random() - 0.5) * 6 };
      }
    }
    const t = this.target, dx = t.x - this.x, dz = t.z - this.z;
    this.targetYaw = Math.atan2(-dx, -dz);
    this.moving = Math.hypot(dx, dz) > 0.35;
    // bobbing along, a little above what it's making for
    this.targetVy = Math.max(-1.5, Math.min(1.5, (t.y + 0.35 + Math.sin(this.age * 3) * 0.15 - this.y) * 2));
  }

  // a flower within five blocks of the hive (a few tries), or null
  flower(h) {
    for (let k = 0; k < 10; k++) {
      const x = h.x + Math.round((Math.random() - 0.5) * 10), z = h.z + Math.round((Math.random() - 0.5) * 10);
      for (let y = h.y - 2; y <= h.y + 2; y++) if (FLOWERS.has(this.world.getBlockW(x, y, z))) return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    }
    return null;
  }

  animate() {
    const f = Math.sin(this.age * 60) * 0.7;
    this.wings[0].rotation.z = f;
    this.wings[1].rotation.z = -f;
  }

  onDeath() {}
}
