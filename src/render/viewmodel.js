// First-person view model: the held block / item (or a bare arm) drawn in
// front of the camera, with walk bob, swing, equip, eat and drink animations.
// Drawn last and without depth testing so it never clips into nearby blocks.

import * as THREE from 'three';
import { generateTile, TILE } from './textures.js';
import { itemInfo } from '../items/items.js';
import { R_CROSS, R_TORCH } from '../blocks/blocks.js';

const SWING_TIME = 0.25;
const EQUIP_TIME = 0.18;
const BITE_TIME = 0.27;      // matches the chewing sound (interaction.js)
// the held bow's turn at rest and drawn (the arrow along the sprite's diagonal, aimed into the view)
const BOW_REST = [0, -0.95, 0.3];
const BOW_AIM = [0.15, -1.25, 0.6];

// face shading for boxes, in BoxGeometry order (+x, -x, +y, -y, +z, -z),
// close to the terrain's so the hand and held blocks sit in the same light
const FACE_SHADE = [0.78, 0.62, 1, 0.5, 0.88, 0.7];

const SKIN = new THREE.Color(0xd9a37c);
const SLEEVE = new THREE.Color(0x3d8a9e);
// a chestplate shows on the arm: its plate colour and a darker cuff
const ARMOUR = {
  leather: [0x8a5a34, 0x5e3a1e], iron: [0xc9ccd1, 0x8a9098],
  gold: [0xf0c648, 0xb88a22], diamond: [0x62d8e2, 0x2a96a4], dragon: [0x962820, 0x5c1612],
};

function tileTexture(name) {
  const tex = new THREE.CanvasTexture(generateTile(name));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function overlayMaterial(opts, shade = 1, base = null) {
  // transparent puts it in the last render pass (after water); no depth = no clipping
  const m = new THREE.MeshBasicMaterial({
    transparent: true, alphaTest: 0.5, depthTest: false, depthWrite: false, fog: false, ...opts,
  });
  // the light tint is applied on top of these each frame
  m.userData.shade = shade;
  m.userData.base = base ?? new THREE.Color(1, 1, 1);
  return m;
}

function shadedBox(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), FACE_SHADE.map((s) => overlayMaterial({}, s, color)));
}

// the opaque part of a tile: its pixel bounds
function tileBounds(img) {
  let x0 = TILE, y0 = TILE, x1 = -1, y1 = -1;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (img[(y * TILE + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 } : { x0, y0, x1, y1 };
}

// Held sprites are sized by what's drawn on the tile, not the tile itself:
// a shovel (9 pixels across) and a pickaxe (14) come out about as long as
// each other, and a lump of coal doesn't fill your hand like a loaf does.
// Long tools are measured and held at the grip (the tile's bottom-left);
// everything else at its middle, where the tile's middle used to be.
const GRIP_TOOLS = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'spear', 'rod']);
const SPRITE_SIZE = 0.36;      // the old size for every sprite: positions are tuned to it
// [how long the drawn part comes out, and the sprite size's floor and ceiling]
const SPRITE_FIT = {
  tool: [0.3, 0.3, 0.5],       // pickaxes, swords, shovels, rods ...
  gadget: [0.26, 0.26, 0.4],   // shears, flint and steel, the watering can
  plant: [0.24, 0.24, 0.36],   // flowers, saplings, torches and the like
  item: [0.2, 0.24, 0.4],      // food, ingots, dyes, buckets ...
};
function heldSprite(tile, kind) {
  const img = generateTile(tile).getContext('2d').getImageData(0, 0, TILE, TILE).data;
  const bb = tileBounds(img);
  const ext = Math.max(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1) / TILE;   // 0..1 of the tile
  const [want, lo, hi] = SPRITE_FIT[kind];
  const size = Math.min(hi, Math.max(lo, want / ext));
  const mesh = extrudedSprite(tile, size, img);
  // the anchor pixel (grip or middle), in tile units from the tile's centre
  const ax = kind === 'tool' ? (bb.x0 + 0.5) / TILE - 0.5 : (bb.x0 + bb.x1 + 1) / 2 / TILE - 0.5;
  const ay = kind === 'tool' ? 0.5 - (bb.y1 + 0.5) / TILE : 0.5 - (bb.y0 + bb.y1 + 1) / 2 / TILE;
  // a tool's grip stays where it was; anything else is centred where the tile was
  const keep = kind === 'tool' ? SPRITE_SIZE : 0;
  mesh.geometry.translate(ax * (keep - size), ay * (keep - size), 0);
  return mesh;
}

// A flat item sprite with a pixel of thickness: front and back carry the
// texture, and every opaque pixel on a transparent edge gets a darker side
// face in its own colour, so swords and food look solid rather than paper.
function extrudedSprite(tile, size, img = generateTile(tile).getContext('2d').getImageData(0, 0, TILE, TILE).data) {
  const opaque = (x, y) => x >= 0 && y >= 0 && x < TILE && y < TILE && img[(y * TILE + x) * 4 + 3] >= 128;
  const px = size / TILE, half = size / 2, t = px / 2;
  const pos = [], uv = [], col = [];
  const quad = (a, b, c, d, uvs, shade) => {
    for (const [p, q] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
      pos.push(...p); uv.push(...q); col.push(shade, shade, shade);
    }
  };
  // front (+z) and back (-z): the whole tile, alpha-tested
  quad([-half, -half, t], [half, -half, t], [half, half, t], [-half, half, t], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
  quad([half, -half, -t], [-half, -half, -t], [-half, half, -t], [half, half, -t], [[1, 0], [0, 0], [0, 1], [1, 1]], 0.8);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (!opaque(x, y)) continue;
      const x0 = -half + x * px, x1 = x0 + px;
      const y1 = half - y * px, y0 = y1 - px;     // canvas rows run downward
      const c = [(x + 0.5) / TILE, 1 - (y + 0.5) / TILE];
      const uvs = [c, c, c, c];
      if (!opaque(x - 1, y)) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], uvs, 0.62);
      if (!opaque(x + 1, y)) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], uvs, 0.62);
      if (!opaque(x, y - 1)) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], uvs, 0.9);
      if (!opaque(x, y + 1)) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], uvs, 0.5);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(geo, overlayMaterial({ map: tileTexture(tile), side: THREE.DoubleSide, vertexColors: true }));
}

export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group();     // follows the camera
    this.pivot = new THREE.Group();    // animated (bob / swing / equip / eat)
    this.root.add(this.pivot);
    camera.add(this.root);

    this.meshes = new Map();           // item id -> mesh (built lazily)

    // the bare arm: skin, with a shirt sleeve toward the shoulder
    this.arm = new THREE.Group();
    const skin = shadedBox(0.16, 0.16, 0.6, SKIN);
    const sleeve = shadedBox(0.175, 0.175, 0.2, SLEEVE);
    sleeve.position.z = 0.22;
    // a chestplate's sleeve: a longer, thicker plate over the shirt, with a cuff
    this.plate = new THREE.Group();
    this.plateBox = shadedBox(0.19, 0.19, 0.3, new THREE.Color());
    this.plateBox.position.z = 0.17;
    this.cuff = shadedBox(0.2, 0.2, 0.05, new THREE.Color());
    this.cuff.position.z = 0.03;
    this.plate.add(this.plateBox, this.cuff);
    this.plate.visible = false;
    this.sleeve = sleeve;
    this.arm.add(skin, sleeve, this.plate);
    this.chest = null;
    this.arm.position.set(0.05, -0.02, 0.12);
    this.arm.rotation.set(0.15, 0.25, 0);
    this.arm.traverse((o) => { o.renderOrder = 1000; });
    this.pivot.add(this.arm);

    this.heldId = -1;
    this.current = this.arm;
    this.swingT = SWING_TIME;          // >= SWING_TIME means idle
    this.equipT = EQUIP_TIME;
    this.eatBlend = 0;                 // 0..1: how far the food has come up to the mouth
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.brightness = 1;
  }

  meshFor(id) {
    if (this.meshes.has(id)) return this.meshes.get(id);
    const info = itemInfo(id);
    let mesh;
    const b = info?.block;
    if (info?.bow) {
      // a bow: held upright, and drawn in four frames (at rest, then the
      // string coming back with an arrow on it)
      mesh = new THREE.Group();
      const frames = ['bow', 'bow_pull_0', 'bow_pull_1', 'bow_pull_2'].map((t) => extrudedSprite(t, SPRITE_SIZE));
      for (const f of frames) { f.visible = false; f.renderOrder = 1000; mesh.add(f); }
      frames[0].visible = true;
      mesh.userData.frames = frames;
      mesh.rotation.set(0, -0.95, 0.3);
      mesh.position.set(0.03, 0.08, -0.02);
    } else if (b && b.render !== R_CROSS && b.render !== R_TORCH && !b.icon) {
      const t = b.textures;
      const face = (sel) => (typeof t === 'string' ? t : t[sel] ?? t.side);
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z
      const mats = ['side', 'side', 'top', 'bottom', 'side', 'side'].map((sel, i) =>
        overlayMaterial({ map: tileTexture(face(sel) ?? face('top')) }, FACE_SHADE[i]));
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), mats);
      mesh.rotation.set(0.1, 0.75, 0);
      mesh.position.set(0, 0.03, 0);
    } else {
      // items and plants: a sprite with a little thickness, held like a tool
      const tile = b ? (b.icon ?? (typeof b.textures === 'string' ? b.textures : b.textures.side)) : info?.texture;
      const cls = info?.tool?.class;
      mesh = heldSprite(tile, b ? 'plant' : GRIP_TOOLS.has(cls) ? 'tool' : cls ? 'gadget' : 'item');
      mesh.rotation.set(0, -0.95, 0.3);
      mesh.position.set(0.03, 0.08, -0.02);
    }
    mesh.renderOrder = 1000;
    mesh.visible = false;
    this.pivot.add(mesh);
    this.meshes.set(id, mesh);
    return mesh;
  }

  // start a swing (mine, attack, place, use) - but not with food at your mouth
  swing() {
    if (this.eatBlend > 0.05) return;
    if (this.swingT >= SWING_TIME * 0.6) this.swingT = 0;
  }

  // the chestplate's material ('iron' ...) or null: dress the arm to match
  setChest(material) {
    this.chest = material;
    const c = ARMOUR[material];
    this.plate.visible = !!c;
    this.sleeve.visible = !c;
    if (!c) return;
    for (const [mesh, hex] of [[this.plateBox, c[0]], [this.cuff, c[1]]]) {
      for (const m of mesh.material) m.userData.base.setHex(hex);
    }
  }

  // held: item id or 0; light: 0..1 brightness at the player's eyes;
  // eatTime: seconds into eating (0 = not eating); drinking: a drink, not food;
  // chest: the worn chestplate's material, or null
  update(dt, { held, draw = 0, eatTime = 0, drinking = false, mining, speed, onGround, light, visible, chest = null }) {
    this.root.visible = visible;
    if (!visible) return;
    if (chest !== this.chest) this.setChest(chest);

    if (held !== this.heldId) {
      this.heldId = held;
      this.current.visible = false;
      this.current = held ? this.meshFor(held) : this.arm;
      this.current.visible = true;
      this.equipT = 0;
      this.eatBlend = 0;
    }

    // tint to the light level so the hand isn't glowing in a dark cave
    this.brightness += (light - this.brightness) * Math.min(1, dt * 8);
    const c = Math.max(0.02, this.brightness);   // linear, matches the terrain
    this.current.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.color.copy(m.userData.base).multiplyScalar(c * m.userData.shade);
      }
    });

    // food comes up to the mouth (and goes back down) smoothly
    const eating = eatTime > 0;
    this.eatBlend += ((eating ? 1 : 0) - this.eatBlend) * Math.min(1, dt * (eating ? 14 : 10));
    if (eating) this.swingT = SWING_TIME;   // no swinging with food in your mouth

    if (mining && this.swingT >= SWING_TIME) this.swingT = 0;   // keep swinging while mining
    this.swingT = Math.min(SWING_TIME, this.swingT + dt);
    this.equipT = Math.min(EQUIP_TIME, this.equipT + dt);

    // walk bob eases in and out with movement
    const moving = onGround && speed > 0.5;
    this.bobAmount += ((moving && this.bobbing !== false ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * Math.min(speed, 8) * 1.6;
    const bobX = Math.sin(this.bobPhase) * 0.018 * this.bobAmount;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.02 * this.bobAmount;

    const s = Math.sin((this.swingT / SWING_TIME) * Math.PI);   // 0 -> 1 -> 0
    const equipDrop = (1 - this.equipT / EQUIP_TIME) * 0.35;

    this.root.position.set(0.36, -0.3, -0.6);
    // a drawn bow: the frame for how far the string's back, turned upright
    // with the arrow aimed in past the crosshair, and trembling at full draw
    const frames = this.current.userData.frames;
    if (frames) {
      const f = draw <= 0 ? 0 : draw < 0.4 ? 1 : draw < 0.9 ? 2 : 3;
      frames.forEach((m, i) => { m.visible = i === f; });
      // it swings up into place as the draw starts, and eases back down
      // after a shot with a little kick forward as the arrow leaves
      if (this.lastDraw > 0.2 && draw <= 0) this.kick = 1;
      this.lastDraw = draw;
      this.kick = Math.max(0, (this.kick ?? 0) - dt * 6);
      const want = Math.min(1, draw * 4);
      this.bowPose = (this.bowPose ?? 0) + (want - (this.bowPose ?? 0)) * Math.min(1, dt * (want > (this.bowPose ?? 0) ? 18 : 7));
      const k = this.bowPose;
      this.current.rotation.set(BOW_REST[0] + (BOW_AIM[0] - BOW_REST[0]) * k, BOW_REST[1] + (BOW_AIM[1] - BOW_REST[1]) * k, BOW_REST[2] + (BOW_AIM[2] - BOW_REST[2]) * k);
      this.current.position.set(0.03 - 0.12 * k, 0.08 + 0.03 * k, -0.02 + 0.04 * k - this.kick * 0.08);
    }
    const shake = draw >= 1 ? Math.sin(performance.now() / 30) * 0.004 : 0;
    if (frames) draw = 0;   // (the bow's own pose does it: no extra sway of the arm)
    // eating: the food sits just under your chin, turned to face you, and
    // bobs once a bite in step with the chewing; drinking tips it up instead
    const e = this.eatBlend;
    const bite = eating && !drinking ? Math.abs(Math.sin((eatTime / BITE_TIME) * Math.PI)) * 0.045 : 0;
    const sip = eating && drinking ? Math.sin(eatTime * 7) * 0.008 : 0;
    this.pivot.position.set(
      bobX * (1 - e) - s * 0.12 - draw * 0.22 + shake - e * 0.3,
      bobY * (1 - e) - equipDrop + s * 0.06 + draw * 0.1 + e * (drinking ? 0.1 : 0.19) - bite + sip,
      -s * 0.12 + draw * 0.1 + e * 0.16);
    this.pivot.rotation.set(
      -s * 0.9 + e * (drinking ? 0.7 : 0.25),
      s * 0.35 + draw * 0.5 + e * 0.85,
      s * 0.25 - draw * 0.3 + e * (drinking ? -0.35 : 0));
  }

  dispose() {
    this.root.removeFromParent();
    for (const obj of [this.arm, ...this.meshes.values()]) {
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m.map?.dispose(); m.dispose(); }
      });
    }
  }
}
