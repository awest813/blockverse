// Sign text: a canvas-textured plane on the face of each nearby sign.

import * as THREE from 'three';
import { B } from '../blocks/blocks.js';
import { CHUNK_Y } from '../core/constants.js';

const RANGE = 32;
const P = 1 / 16;
// outward normal for each facing edge (0 -z, 1 +x, 2 +z, 3 -x) and the plane's yaw
const NORMALS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const YAWS = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

function textTexture(lines) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#20140a';
  ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, 64, 9 + i * 15.5));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class SignFx {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.signs = new Map();   // "x,y,z" -> {mesh, rev}
    this.timer = 0;
  }

  update(dt, player) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const seen = new Set();
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.blockEntities.size) continue;
      if (Math.abs(chunk.cx * 16 + 8 - player.x) > RANGE + 8 || Math.abs(chunk.cz * 16 + 8 - player.z) > RANGE + 8) continue;
      for (const [idx, st] of chunk.blockEntities) {
        if (st.kind !== 'sign') continue;
        const y = idx % CHUNK_Y;
        const rest = (idx - y) / CHUNK_Y;
        const lz = rest % 16, lx = (rest - lz) / 16;
        const x = chunk.cx * 16 + lx, z = chunk.cz * 16 + lz;
        if (this.world.getBlockW(x, y, z) !== B.OAK_SIGN) continue;
        const key = `${x},${y},${z}`;
        seen.add(key);
        const meta = this.world.getMetaW(x, y, z);
        const have = this.signs.get(key);
        let sign = have;
        if (!have || have.rev !== st.rev || have.meta !== meta) {
          if (have) this.remove(key);
          sign = { mesh: this.makeMesh(x, y, z, meta, st.lines), rev: st.rev, meta };
          this.signs.set(key, sign);
        }
        // lettering takes the light of the board it's written on
        sign.mesh.material.color.setScalar(this.world.lightAt(x + 0.5, y + 0.5, z + 0.5));
      }
    }
    for (const key of [...this.signs.keys()]) if (!seen.has(key)) this.remove(key);
  }

  makeMesh(x, y, z, meta, lines) {
    const f = meta & 3, wall = meta & 4;
    const [nx, nz] = NORMALS[f];
    const w = wall ? 1 - 2 * P : 1, h = wall ? 8 * P : 9 * P;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, h * 0.94),
      new THREE.MeshBasicMaterial({ map: textTexture(lines), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    // the board's front face: standing boards are centred, wall boards sit 2px off the wall
    const depth = wall ? 2 * P : P;   // from the centre line / the wall
    let cx = x + 0.5, cz = z + 0.5;
    if (wall) { cx = x + 0.5 - nx * 0.5 + nx * (depth + 0.003); cz = z + 0.5 - nz * 0.5 + nz * (depth + 0.003); }
    else { cx += nx * (depth + 0.003); cz += nz * (depth + 0.003); }
    mesh.position.set(cx, y + (wall ? 8 * P : 11.5 * P), cz);
    mesh.rotation.y = YAWS[f];
    this.scene.add(mesh);
    return mesh;
  }

  remove(key) {
    const s = this.signs.get(key);
    if (!s) return;
    this.scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh.material.map.dispose();
    s.mesh.material.dispose();
    this.signs.delete(key);
  }

  dispose() {
    for (const key of [...this.signs.keys()]) this.remove(key);
  }
}
