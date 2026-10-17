// Campfire visuals: the food cooking on each nearby fire, and rising smoke;
// and the steam (and bubbling) off a cooking pot on the boil.

import * as THREE from 'three';
import { B } from '../blocks/blocks.js';
import { forEachCampfire, forEachBlockEntity, CAMPFIRE_SLOTS } from '../items/campfire.js';
import { potHeated } from '../items/cookingPot.js';

const RANGE = 28;          // only decorate fires this close to the player
const SMOKE_EVERY = 0.35;  // seconds between puffs per lit fire
const SMOKE_LIFE = 2.6;
// where the four foods sit on the logs
const SPOTS = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  g.addColorStop(0, 'rgba(200,200,200,0.75)');
  g.addColorStop(1, 'rgba(200,200,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class CampfireFx {
  constructor(scene, world, atlas, sound = null) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.sound = sound;        // (name, opts) for a pot's bubbling
    this.fires = new Map();    // "x,y,z" -> {food: Mesh[], smokeTimer, x, y, z}
    this.pots = [];            // {x, y, z, cooking, timer} for hot pots nearby
    this.smoke = [];
    this.scanTimer = 0;
    this.iconTex = new Map();
    this.smokeTex = smokeTexture();
    this.foodGeo = new THREE.PlaneGeometry(0.32, 0.32);
  }

  iconTexture(id) {
    if (!this.iconTex.has(id)) {
      const img = new Image();
      const tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      img.onload = () => { tex.needsUpdate = true; };
      img.src = this.atlas.icon(id);
      this.iconTex.set(id, tex);
    }
    return this.iconTex.get(id);
  }

  update(dt, player) {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.3;
      this.sync(player);
    }
    // puffs from lit fires
    for (const f of this.fires.values()) {
      if (!f.lit) continue;
      f.smokeTimer -= dt;
      if (f.smokeTimer <= 0) {
        f.smokeTimer = SMOKE_EVERY * (0.7 + Math.random() * 0.6);
        this.puff(f.x + 0.5, f.y + 0.8, f.z + 0.5);
      }
    }
    for (const s of this.smoke) {
      s.age += dt;
      const k = s.age / (s.steam ? SMOKE_LIFE * 0.6 : SMOKE_LIFE);
      s.sprite.position.y += dt * (s.steam ? 0.9 : 1.1);
      s.sprite.position.x += s.drift * dt;
      s.sprite.scale.setScalar(s.steam ? 0.25 + k * 0.7 : 0.35 + k * 1.1);
      s.sprite.material.opacity = (s.steam ? 0.4 : 0.55) * (1 - k);
      if (k >= 1) { this.scene.remove(s.sprite); s.sprite.material.dispose(); }
    }
    // steam off a hot pot of water; one with a meal on bubbles too
    for (const pot of this.pots) {
      pot.timer -= dt;
      if (pot.timer > 0) continue;
      pot.timer = (pot.cooking ? 0.45 : 0.8) * (0.7 + Math.random() * 0.6);
      this.puff(pot.x + 0.5, pot.y + 0.65, pot.z + 0.5, true);
      if (pot.cooking && Math.random() < 0.5) this.sound?.('simmer', { pos: { x: pot.x + 0.5, y: pot.y + 0.5, z: pot.z + 0.5 } });
    }
    this.smoke = this.smoke.filter((s) => s.age < (s.steam ? SMOKE_LIFE * 0.6 : SMOKE_LIFE));
  }

  puff(x, y, z, steam = false) {
    if (this.smoke.length > 80) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0.55 }));
    if (steam) sprite.material.color.setRGB(1.25, 1.25, 1.3);   // whiter than smoke
    sprite.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    this.scene.add(sprite);
    this.smoke.push({ sprite, age: 0, drift: (Math.random() - 0.5) * 0.3, steam });
  }

  // match meshes to the campfires (and the food on them) near the player
  sync(player) {
    const seen = new Set();
    forEachCampfire(this.world, (x, y, z, st) => {
      if (Math.abs(x - player.x) > RANGE || Math.abs(z - player.z) > RANGE) return;
      const id = this.world.getBlockW(x, y, z);
      if (id !== B.CAMPFIRE && id !== B.CAMPFIRE_OFF) return;
      const key = `${x},${y},${z}`;
      seen.add(key);
      let f = this.fires.get(key);
      if (!f) {
        f = { x, y, z, food: new Array(CAMPFIRE_SLOTS).fill(null), smokeTimer: Math.random() * SMOKE_EVERY };
        this.fires.set(key, f);
      }
      f.lit = id === B.CAMPFIRE;
      st.slots.forEach((s, i) => {
        const mesh = f.food[i];
        if (mesh && (!s || mesh.userData.id !== s.id)) { this.scene.remove(mesh); mesh.material.dispose(); f.food[i] = null; }
        if (s && !f.food[i]) {
          const m = new THREE.Mesh(this.foodGeo, new THREE.MeshBasicMaterial({
            map: this.iconTexture(s.id), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
          }));
          m.rotation.x = -Math.PI / 2;
          m.rotation.z = i * 0.9;
          m.position.set(x + SPOTS[i][0], y + 0.42, z + SPOTS[i][1]);
          m.userData.id = s.id;
          this.scene.add(m);
          f.food[i] = m;
        }
      });
    });
    // hot pots of water nearby (keeping their puff timers)
    const old = new Map(this.pots.map((p) => [`${p.x},${p.y},${p.z}`, p]));
    this.pots = [];
    forEachBlockEntity(this.world, 'pot', (x, y, z, st) => {
      if (Math.abs(x - player.x) > RANGE || Math.abs(z - player.z) > RANGE) return;
      if (!st.water || this.world.getBlockW(x, y, z) !== B.COOKING_POT || !potHeated(this.world, x, y, z)) return;
      const pot = old.get(`${x},${y},${z}`) ?? { x, y, z, timer: Math.random() * 0.5 };
      pot.cooking = st.items.length >= 2 || !!st.meal;
      this.pots.push(pot);
    });
    // fires that were broken or left behind
    for (const [key, f] of this.fires) {
      if (seen.has(key)) continue;
      for (const m of f.food) if (m) { this.scene.remove(m); m.material.dispose(); }
      this.fires.delete(key);
    }
  }

  dispose() {
    for (const f of this.fires.values()) for (const m of f.food) if (m) { this.scene.remove(m); m.material.dispose(); }
    for (const s of this.smoke) { this.scene.remove(s.sprite); s.sprite.material.dispose(); }
    this.fires.clear();
    this.smoke = [];
    this.pots = [];
    for (const t of this.iconTex.values()) t.dispose();
    this.smokeTex.dispose();
    this.foodGeo.dispose();
  }
}
