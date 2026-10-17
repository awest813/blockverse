// Weather you can see: rain streaks (or snowflakes in cold places) falling
// in a box round the player, thinning out when you're under a roof.

import * as THREE from 'three';

const BOX = 18, HEIGHT = 18;
const RAIN = 520, SNOW = 360;

export class WeatherFx {
  constructor(scene) {
    this.scene = scene;
    // rain: short vertical streaks
    const rp = new Float32Array(RAIN * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xd0dcf0, transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false;
    // snow: soft dots
    const sp = new Float32Array(SNOW * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xf4f8ff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false }));
    this.snow.frustumCulled = false;
    scene.add(this.rain, this.snow);
    const seed = (n) => Array.from({ length: n }, () => ({ x: (Math.random() * 2 - 1) * BOX, y: Math.random() * HEIGHT, z: (Math.random() * 2 - 1) * BOX, v: 0.8 + Math.random() * 0.4, s: Math.random() * 6.28 }));
    this.r = seed(RAIN);
    this.s = seed(SNOW);
    this.t = 0;
  }

  // amount 0..1; kind 'rain' | 'snow' | null (none here: a desert); cover 0..1 (under a roof)
  update(dt, player, amount, kind, cover) {
    const show = amount * (1 - cover);
    this.rain.visible = kind === 'rain' && show > 0.02;
    this.snow.visible = kind === 'snow' && show > 0.02;
    if (!this.rain.visible && !this.snow.visible) return;
    this.t += dt;
    const wrap = (v, h) => ((v + h) % (2 * h) + 2 * h) % (2 * h) - h;
    const ox = player.x, oy = player.y - 4, oz = player.z;
    if (this.rain.visible) {
      const arr = this.rain.geometry.attributes.position.array;
      const n = Math.floor(RAIN * show);
      this.r.forEach((q, i) => {
        q.y -= 16 * q.v * dt;
        if (q.y < 0) q.y += HEIGHT;
        const x = ox + wrap(q.x - ox, BOX), z = oz + wrap(q.z - oz, BOX), y = i < n ? oy + q.y : -1000, j = i * 6;
        arr[j] = x; arr[j + 1] = y; arr[j + 2] = z; arr[j + 3] = x - 0.06; arr[j + 4] = y + 0.8; arr[j + 5] = z;
      });
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.6 * Math.min(1, show * 1.5);
    }
    if (this.snow.visible) {
      const arr = this.snow.geometry.attributes.position.array;
      const n = Math.floor(SNOW * show);
      this.s.forEach((q, i) => {
        q.y -= 1.6 * q.v * dt;
        q.x += Math.sin(this.t * 0.8 + q.s) * 0.4 * dt;
        q.z += Math.cos(this.t * 0.7 + q.s) * 0.4 * dt;
        if (q.y < 0) q.y += HEIGHT;
        const j = i * 3;
        arr[j] = ox + wrap(q.x - ox, BOX); arr[j + 1] = i < n ? oy + q.y : -1000; arr[j + 2] = oz + wrap(q.z - oz, BOX);
      });
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.scene.remove(this.rain, this.snow);
    for (const o of [this.rain, this.snow]) { o.geometry.dispose(); o.material.dispose(); }
  }
}
