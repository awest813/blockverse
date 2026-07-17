// Holds and updates all non-player entities (drops, mobs).

import { ItemDrop } from './itemDrop.js';

export class EntityManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.drops = [];
    this.mobs = [];
    this.onPickup = null; // callback for pickup sound
  }

  spawnDrops(x, y, z, drops) {
    for (const d of drops) {
      if (!d || d.count <= 0) continue;
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 0.8;
      this.drops.push(new ItemDrop(
        this.scene, this.world, d.id, d.count,
        x, y, z,
        Math.cos(a) * s, 2.2 + Math.random(), Math.sin(a) * s,
      ));
    }
  }

  addMob(mob) {
    this.mobs.push(mob);
  }

  update(dt, player) {
    for (const d of this.drops) {
      d.update(dt, player);
      if (d.pickedUp) this.onPickup?.();
    }
    this.drops = this.drops.filter((d) => !d.dead);

    for (const m of this.mobs) m.update(dt, player);
    this.mobs = this.mobs.filter((m) => !m.dead);
  }

  mobsNear(x, y, z, r) {
    const out = [];
    for (const m of this.mobs) {
      const dx = m.x - x, dy = m.y - y, dz = m.z - z;
      if (dx * dx + dy * dy + dz * dz < r * r) out.push(m);
    }
    return out;
  }

  dispose() {
    for (const d of this.drops) d.kill();
    for (const m of this.mobs) m.kill?.();
    this.drops = [];
    this.mobs = [];
  }
}
