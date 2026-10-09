// First-person view model: the held block / item (or a bare arm) drawn in
// front of the camera, with walk bob, swing and equip animations. Drawn last
// and without depth testing so it never clips into nearby blocks.

import * as THREE from 'three';
import { generateTile } from './textures.js';
import { itemInfo } from '../items/items.js';
import { R_CROSS, R_TORCH } from '../blocks/blocks.js';

const SWING_TIME = 0.25;
const EQUIP_TIME = 0.18;

function tileTexture(name) {
  const tex = new THREE.CanvasTexture(generateTile(name));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function overlayMaterial(opts) {
  // transparent puts it in the last render pass (after water); no depth = no clipping
  return new THREE.MeshBasicMaterial({
    transparent: true, alphaTest: 0.5, depthTest: false, depthWrite: false, fog: false, ...opts,
  });
}

export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group();     // follows the camera
    this.pivot = new THREE.Group();    // animated (bob / swing / equip)
    this.root.add(this.pivot);
    camera.add(this.root);

    this.meshes = new Map();           // item id -> mesh (built lazily)
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), overlayMaterial({ color: 0xd9a37c }));
    this.arm.position.set(0.05, -0.02, 0.12);
    this.arm.rotation.set(0.15, 0.25, 0);
    this.arm.renderOrder = 1000;
    this.pivot.add(this.arm);

    this.heldId = -1;
    this.current = this.arm;
    this.swingT = SWING_TIME;          // >= SWING_TIME means idle
    this.equipT = EQUIP_TIME;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.brightness = 1;
  }

  meshFor(id) {
    if (this.meshes.has(id)) return this.meshes.get(id);
    const info = itemInfo(id);
    let mesh;
    const b = info?.block;
    if (b && b.render !== R_CROSS && b.render !== R_TORCH) {
      const t = b.textures;
      const face = (sel) => (typeof t === 'string' ? t : t[sel] ?? t.side);
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z
      const mats = ['side', 'side', 'top', 'bottom', 'side', 'side'].map((sel) =>
        overlayMaterial({ map: tileTexture(face(sel) ?? face('top')) }));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), mats);
      mesh.rotation.set(0.1, 0.75, 0);
      mesh.position.set(0, 0.02, 0);
    } else {
      // items and plants: a flat sprite held like a tool
      const tile = b ? (typeof b.textures === 'string' ? b.textures : b.textures.side) : info?.texture;
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3),
        overlayMaterial({ map: tileTexture(tile), side: THREE.DoubleSide }));
      mesh.rotation.set(0, -1.2, 0.35);
      mesh.position.set(0.04, 0.06, -0.02);
    }
    mesh.renderOrder = 1000;
    mesh.visible = false;
    this.pivot.add(mesh);
    this.meshes.set(id, mesh);
    return mesh;
  }

  // start a swing (mine, attack, place, use)
  swing() {
    if (this.swingT >= SWING_TIME * 0.6) this.swingT = 0;
  }

  // held: item id or 0; light: 0..1 brightness at the player's eyes
  update(dt, { held, mining, speed, onGround, light, visible }) {
    this.root.visible = visible;
    if (!visible) return;

    if (held !== this.heldId) {
      this.heldId = held;
      this.current.visible = false;
      this.current = held ? this.meshFor(held) : this.arm;
      this.current.visible = true;
      this.equipT = 0;
    }

    // tint to the light level so the hand isn't glowing in a dark cave
    this.brightness += (light - this.brightness) * Math.min(1, dt * 8);
    const c = 0.2 + 0.8 * this.brightness;
    const mats = Array.isArray(this.current.material) ? this.current.material : [this.current.material];
    for (const m of mats) m.color.setScalar(c);
    if (this.current === this.arm) this.arm.material.color.setRGB(0.85 * c, 0.64 * c, 0.49 * c);

    if (mining && this.swingT >= SWING_TIME) this.swingT = 0;   // keep swinging while mining
    this.swingT = Math.min(SWING_TIME, this.swingT + dt);
    this.equipT = Math.min(EQUIP_TIME, this.equipT + dt);

    // walk bob eases in and out with movement
    const moving = onGround && speed > 0.5;
    this.bobAmount += ((moving ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * Math.min(speed, 8) * 1.6;
    const bobX = Math.sin(this.bobPhase) * 0.018 * this.bobAmount;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.02 * this.bobAmount;

    const s = Math.sin((this.swingT / SWING_TIME) * Math.PI);   // 0 -> 1 -> 0
    const equipDrop = (1 - this.equipT / EQUIP_TIME) * 0.35;

    this.root.position.set(0.36, -0.3, -0.6);
    this.pivot.position.set(bobX - s * 0.12, bobY - equipDrop + s * 0.06, -s * 0.12);
    this.pivot.rotation.set(-s * 0.9, s * 0.35, s * 0.25);
  }

  dispose() {
    this.root.removeFromParent();
    for (const mesh of [this.arm, ...this.meshes.values()]) {
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) { m.map?.dispose(); m.dispose(); }
    }
  }
}
