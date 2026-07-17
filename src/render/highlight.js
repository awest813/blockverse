// Block selection outline + breaking crack overlay.

import * as THREE from 'three';
import { generateTile } from './textures.js';

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

  update(target, breakProgress) {
    if (!target) {
      this.outline.visible = false;
      this.crack.visible = false;
      return;
    }
    this.outline.visible = true;
    this.outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);

    if (breakProgress > 0) {
      const stage = Math.min(4, Math.floor(breakProgress * 5));
      this.crackMat.map = this.crackTextures[stage];
      this.crack.visible = true;
      this.crack.position.copy(this.outline.position);
    } else {
      this.crack.visible = false;
    }
  }
}
