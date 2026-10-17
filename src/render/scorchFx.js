// The Scorchlands' air: glowing embers drifting up and grey ash sifting
// down around the player. Two point clouds that follow you, each particle
// wrapping round the box it lives in.

import * as THREE from 'three';

const BOX = 22;      // half-width of the box around the player
const HEIGHT = 16;   // and its height (from a few blocks under your feet)

function dotTexture(soft) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft ? 0.35 : 0.6, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(c);
}

function cloud(n, color, size, blending, tex) {
  const pos = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, map: tex, transparent: true, depthWrite: false, blending, sizeAttenuation: true, opacity: 0.9,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export class ScorchFx {
  constructor(scene) {
    this.scene = scene;
    this.tex = dotTexture(true);
    this.embers = cloud(140, 0xff8a3a, 0.22, THREE.AdditiveBlending, this.tex);
    this.ash = cloud(220, 0x8a8480, 0.1, THREE.NormalBlending, this.tex);
    this.embers.material.fog = false;   // they glow through the haze
    scene.add(this.embers, this.ash);
    // per particle: offset in the box and its own speeds
    const seed = (n) => Array.from({ length: n }, () => ({
      x: (Math.random() * 2 - 1) * BOX, y: Math.random() * HEIGHT, z: (Math.random() * 2 - 1) * BOX,
      s: Math.random() * 6.28, v: 0.5 + Math.random(),
    }));
    this.e = seed(140);
    this.a = seed(220);
    this.t = 0;
  }

  update(dt, player, visible) {
    this.embers.visible = this.ash.visible = visible;
    if (!visible) return;
    this.t += dt;
    const ox = player.x, oy = player.y - 4, oz = player.z;
    const wrap = (v, h) => ((v + h) % (2 * h) + 2 * h) % (2 * h) - h;
    const step = (list, pts, rise, sway) => {
      const arr = pts.geometry.attributes.position.array;
      list.forEach((q, i) => {
        q.y += rise * q.v * dt;
        q.x += Math.sin(this.t * 0.7 + q.s) * sway * dt;
        q.z += Math.cos(this.t * 0.6 + q.s) * sway * dt;
        if (q.y > HEIGHT) q.y -= HEIGHT;
        if (q.y < 0) q.y += HEIGHT;
        // world positions wrap round the player so the box never runs out
        arr[i * 3] = ox + wrap(q.x - ox, BOX);
        arr[i * 3 + 1] = oy + q.y;
        arr[i * 3 + 2] = oz + wrap(q.z - oz, BOX);
      });
      pts.geometry.attributes.position.needsUpdate = true;
    };
    step(this.e, this.embers, 0.9, 0.5);
    step(this.a, this.ash, -0.45, 0.35);
    // embers flicker
    this.embers.material.opacity = 0.75 + Math.sin(this.t * 7) * 0.15;
  }

  dispose() {
    this.scene.remove(this.embers, this.ash);
    for (const p of [this.embers, this.ash]) { p.geometry.dispose(); p.material.dispose(); }
    this.tex.dispose();
  }
}
