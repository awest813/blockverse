// A block of sand or gravel falling: it drops with ordinary mob physics and
// sets itself down where it lands (or breaks into an item if it can't).

import * as THREE from 'three';
import { Mob } from './mob.js';
import { B, blockInfo } from '../blocks/blocks.js';
import { itemTexture } from './itemDrop.js';

export class FallingBlock extends Mob {
  constructor(scene, world, x, y, z, id) {
    super(scene, world, x, y, z);
    this.blockId = id;
    this.w = 0.98; this.h = 0.98;
    this.kind = 'falling';
    this.countsForCap = false;
    this.noLoot = true;
    this.sinks = true;   // (through water to the bottom, as sand would)
    const geo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    geo.translate(0, 0.49, 0);
    const mat = new THREE.MeshBasicMaterial({ map: itemTexture(id) });
    this.group.add(new THREE.Mesh(geo, mat));
    this.materials.push({ mat, base: new THREE.Color(0xffffff) });
    this.age = 0;
  }

  think(dt) {
    this.moving = false;
    this.vx = this.vz = 0;
    this.age += dt;
    if (!this.onGround && this.age < 20) return;
    // landed: set down in the cell it came to rest in
    // (two falling one on the other can land in the same moment: the upper
    // one sits on top of the lower, not inside it)
    const x = Math.floor(this.x), z = Math.floor(this.z);
    // (water it settles in is pushed aside: sand on the seabed)
    const free = (y) => { const id = this.world.getBlockW(x, y, z), b = blockInfo(id); return b.replaceable && (!b.fluid || id === B.WATER); };
    let y = Math.round(this.y);
    for (let n = 0; n < 3 && !free(y); n++) y++;
    if (free(y)) this.world.setBlock(x, y, z, this.blockId);
    else this.fx?.drop?.(this.x, this.y + 0.5, this.z, [{ id: this.blockId, count: 1 }]);
    this.kill();
  }

  damage() { return false; }
  rayHit() { return null; }   // not something to swing at
}
