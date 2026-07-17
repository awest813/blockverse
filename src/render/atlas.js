// Texture atlas: packs all generated tiles into a THREE.DataArrayTexture
// (one layer per tile — mipmap-safe, no bleeding) and renders inventory icons.

import * as THREE from 'three';
import { TILE, tileNames, generateTile } from './textures.js';
import { BLOCKS, blockInfo, R_CROSS, R_TORCH, R_SOLID, R_CUTOUT, R_BLEND } from '../blocks/blocks.js';
import { itemInfo } from '../items/items.js';

// Face order used by the mesher: +x, -x, +y, -y, +z, -z
export const FACE_PX = 0, FACE_NX = 1, FACE_PY = 2, FACE_NY = 3, FACE_PZ = 4, FACE_NZ = 5;

export class Atlas {
  constructor() {
    const names = tileNames();
    this.layerOfName = new Map();
    this.count = names.length;

    const data = new Uint8Array(TILE * TILE * 4 * this.count);
    const tmp = document.createElement('canvas');
    tmp.width = TILE; tmp.height = TILE;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });

    names.forEach((name, layer) => {
      this.layerOfName.set(name, layer);
      tctx.clearRect(0, 0, TILE, TILE);
      tctx.drawImage(generateTile(name), 0, 0);
      const img = tctx.getImageData(0, 0, TILE, TILE).data;
      // Flip vertically: canvas origin is top-left, GL UV origin is bottom-left.
      const base = layer * TILE * TILE * 4;
      for (let y = 0; y < TILE; y++) {
        const src = (TILE - 1 - y) * TILE * 4;
        data.set(img.subarray(src, src + TILE * 4), base + y * TILE * 4);
      }
    });

    const tex = new THREE.DataArrayTexture(data, TILE, TILE, this.count);
    tex.format = THREE.RGBAFormat;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.texture = tex;

    // Precompute per-block face layers: blockFaces[id * 8 + face(+front variants)]
    // Layout per block: [px, nx, py, ny, pz, nz, frontLayer, hasFront]
    this.blockFaces = new Int16Array(BLOCKS.length * 8).fill(-1);
    for (const b of BLOCKS) {
      if (!b || b.render === 0) continue;
      const t = b.textures;
      let top, bottom, side, front = -1;
      if (typeof t === 'string') {
        top = bottom = side = this.layer(t);
      } else {
        top = this.layer(t.top);
        bottom = this.layer(t.bottom);
        side = this.layer(t.side);
        if (t.front) front = this.layer(t.front);
      }
      const o = b.id * 8;
      this.blockFaces[o + FACE_PX] = side;
      this.blockFaces[o + FACE_NX] = side;
      this.blockFaces[o + FACE_PY] = top;
      this.blockFaces[o + FACE_NY] = bottom;
      this.blockFaces[o + FACE_PZ] = side;
      this.blockFaces[o + FACE_NZ] = side;
      this.blockFaces[o + 6] = front;
      this.blockFaces[o + 7] = front >= 0 ? 1 : 0;
    }

    this.iconCache = new Map();
  }

  layer(name) {
    const l = this.layerOfName.get(name);
    if (l === undefined) throw new Error(`Atlas: unknown tile "${name}"`);
    return l;
  }

  // Layer for a block face. `orient` 0..3 rotates which horizontal face is the front.
  faceLayer(blockId, face, orient = 0) {
    const o = blockId * 8;
    if (this.blockFaces[o + 7] === 1 && face !== FACE_PY && face !== FACE_NY) {
      // orient: 0=-z front, 1=+x, 2=+z, 3=-x  (matches placement yaw quadrant)
      const frontFace = [FACE_NZ, FACE_PX, FACE_PZ, FACE_NX][orient & 3];
      if (face === frontFace) return this.blockFaces[o + 6];
    }
    return this.blockFaces[o + face];
  }

  // ---- inventory icons (data URLs, cached) ----
  icon(itemId) {
    if (this.iconCache.has(itemId)) return this.iconCache.get(itemId);
    const url = this.renderIcon(itemId);
    this.iconCache.set(itemId, url);
    return url;
  }

  renderIcon(itemId) {
    const info = itemInfo(itemId);
    if (!info) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    if (info.block) {
      const b = info.block;
      const t = b.textures;
      const tname = (sel) => (typeof t === 'string' ? t : t[sel] ?? t.side);
      if (b.render === R_CROSS || b.render === R_TORCH) {
        ctx.drawImage(generateTile(tname('side')), 0, 0, 32, 32);
      } else {
        this.drawIsoCube(ctx, generateTile(tname('top')), generateTile(tname('side')), generateTile(tname('side')));
      }
    } else {
      ctx.drawImage(generateTile(info.texture), 0, 0, 32, 32);
    }
    return canvas.toDataURL();
  }

  drawIsoCube(ctx, topTile, leftTile, rightTile) {
    const shaded = (tileCanvas, factor) => {
      const c = document.createElement('canvas');
      c.width = TILE; c.height = TILE;
      const cctx = c.getContext('2d');
      cctx.drawImage(tileCanvas, 0, 0);
      cctx.globalCompositeOperation = 'source-atop';
      cctx.fillStyle = `rgba(0,0,0,${1 - factor})`;
      cctx.fillRect(0, 0, TILE, TILE);
      return c;
    };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // top rhombus
    ctx.setTransform(1, 0.5, -1, 0.5, 16, 0);
    ctx.drawImage(topTile, 0, 0, TILE, TILE, 0, 0, 16, 16);
    // left face
    ctx.setTransform(1, 0.5, 0, 1, 0, 8);
    ctx.drawImage(shaded(leftTile, 0.72), 0, 0, TILE, TILE, 0, 0, 16, 16);
    // right face
    ctx.setTransform(1, -0.5, 0, 1, 16, 16);
    ctx.drawImage(shaded(rightTile, 0.55), 0, 0, TILE, TILE, 0, 0, 16, 16);
    ctx.restore();
  }
}
