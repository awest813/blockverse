// Block selection outline + breaking crack overlay.

import * as THREE from 'three';
import { generateTile } from './textures.js';
import { BLOCKS, R_SHAPE } from '../blocks/blocks.js';
import { worldBoxes } from '../blocks/shapes.js';

export class BlockHighlight {
  constructor(scene) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 }),
    );
    this.outline.visible = false;
    scene.add(this.outline);

    this.crackTextures = [];
    for (let i = 0; i < 5; i++) {
      const tex = new THREE.CanvasTexture(generateTile(`crack_${i}`));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      this.crackTextures.push(tex);
    }
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), this.crackMat);
    this.crack.visible = false;
    scene.add(this.crack);
  }

  update(target, breakProgress, world) {
    if (!target) {
      this.outline.visible = false;
      this.crack.visible = false;
      return;
    }
    this.outline.visible = true;
    // part-blocks (slabs, doors, fences...) get an outline around their boxes
    let b = [0, 0, 0, 1, 1, 1];
    if (world && BLOCKS[target.id]?.render === R_SHAPE) {
      b = [1, 1, 1, 0, 0, 0];
      for (const x of worldBoxes(world, target.x, target.y, target.z, target.id)) {
        for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], x[i]); b[i + 3] = Math.max(b[i + 3], x[i + 3]); }
      }
    }
    this.outline.scale.set(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    this.crack.scale.copy(this.outline.scale);
    this.outline.position.set(target.x + (b[0] + b[3]) / 2, target.y + (b[1] + b[4]) / 2, target.z + (b[2] + b[5]) / 2);

    if (breakProgress > 0) {
      const stage = Math.min(4, Math.floor(breakProgress * 5));
      this.crackMat.map = this.crackTextures[stage];
      this.crack.visible = true;
      this.crack.position.copy(this.outline.position);
    } else {
      this.crack.visible = false;
    }
  }

  dispose() {
    for (const m of [this.outline, this.crack]) {
      m.removeFromParent();
      m.geometry.dispose();
      m.material.dispose();
    }
    for (const t of this.crackTextures) t.dispose();
  }
}
