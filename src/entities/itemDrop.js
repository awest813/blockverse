// Dropped item entities: mini cubes (blocks) or flat sprites (items) that
// bob, spin, fall with gravity, and fly to the player on pickup range.

import * as THREE from 'three';
import { moveEntity, pointInWater } from '../core/physics.js';
import { isBlockItem, itemInfo } from '../items/items.js';
import { blockInfo, R_CROSS, R_TORCH } from '../blocks/blocks.js';
import { generateTile } from '../render/textures.js';

const texCache = new Map();
export function itemTexture(id) {
  if (texCache.has(id)) return texCache.get(id);
  let tileName;
  if (isBlockItem(id)) {
    const b = blockInfo(id);
    const t = b.textures;
    tileName = typeof t === 'string' ? t : (b.render === R_CROSS || b.render === R_TORCH ? t.side ?? t : t.side);
    if (typeof tileName !== 'string') tileName = typeof t === 'object' ? (t.side ?? t.top) : t;
  } else {
    tileName = itemInfo(id)?.texture;
  }
  const tex = new THREE.CanvasTexture(generateTile(tileName));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(id, tex);
  return tex;
}

const geoCube = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const geoFlat = new THREE.PlaneGeometry(0.35, 0.35);

export class ItemDrop {
  // dur: remaining durability of a worn tool / armour piece (kept through drop and pickup)
  constructor(scene, world, id, count, x, y, z, vx = 0, vy = 2.5, vz = 0, dur = undefined) {
    this.world = world;
    this.id = id;
    this.count = count;
    this.dur = dur;
    this.x = x; this.y = y; this.z = z;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.w = 0.25;
    this.h = 0.25;
    this.age = 0;
    this.pickupDelay = 0.6;
    this.dead = false;

    const isBlock = isBlockItem(id) && blockInfo(id).render !== R_CROSS && blockInfo(id).render !== R_TORCH;
    const mat = new THREE.MeshBasicMaterial({
      map: itemTexture(id),
      transparent: true,
      alphaTest: 0.1,
      side: isBlock ? THREE.FrontSide : THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(isBlock ? geoCube : geoFlat, mat);
    this.spin = Math.random() * Math.PI * 2;
    scene.add(this.mesh);
    this.scene = scene;
  }

  update(dt, player) {
    this.age += dt;
    this.pickupDelay = Math.max(0, this.pickupDelay - dt);
    if (this.age > 300) { this.kill(); return; }

    // gravity + collision; in water items drift up and bob at the surface
    // (on the seabed they'd sink out of reach and out of sight)
    if (pointInWater(this.world, this.x, this.y + 0.1, this.z)) {
      this.vy += (1.2 - this.vy) * Math.min(1, 4 * dt);
    } else {
      this.vy -= 22 * dt;
      this.vy = Math.max(this.vy, -30);
    }
    this.vx *= (1 - Math.min(1, 6 * dt));
    this.vz *= (1 - Math.min(1, 6 * dt));
    // (in steps when falling fast, so a drop can't skip through a thin floor)
    const steps = Math.max(1, Math.ceil((Math.abs(this.vy) * dt) / 0.4));
    for (let i = 0; i < steps; i++) moveEntity(this.world, this, dt / steps);

    // magnet + pickup
    if (this.pickupDelay <= 0 && !player.dead) {
      const dx = player.x - this.x;
      const dy = (player.y + 0.9) - this.y;
      const dz = player.z - this.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < 1.1) {
        const leftover = this.dur !== undefined
          ? player.giveStack({ id: this.id, count: this.count, dur: this.dur })
          : player.give(this.id, this.count);
        if (leftover === 0) {
          this.kill();
          this.pickedUp = true;
          return;
        }
        this.count = leftover;
      } else if (distSq < 6.5) {
        const d = Math.sqrt(distSq);
        const pull = 5.5 / Math.max(0.4, d);
        this.vx += (dx / d) * pull * dt * 10;
        this.vy += (dy / d) * pull * dt * 10;
        this.vz += (dz / d) * pull * dt * 10;
      }
    }

    // visuals
    this.spin += dt * 1.8;
    const bob = Math.sin(this.age * 2.2) * 0.045;
    this.mesh.position.set(this.x, this.y + 0.18 + bob, this.z);
    // about to vanish: it blinks for its last ten seconds
    this.mesh.visible = this.age < 290 || Math.floor(this.age * 5) % 2 === 0;
    this.mesh.rotation.y = this.spin;
    // take the light of where it lies (a few times a second is plenty)
    if ((this._lt = (this._lt ?? Math.random() * 0.2) - dt) <= 0) {
      this._lt = 0.2;
      this.mesh.material.color.setScalar(this.world.lightAt(this.x, this.y + 0.2, this.z));
    }
  }

  kill() {
    this.dead = true;
    this.scene.remove(this.mesh);
    this.mesh.material.dispose();
  }
}
