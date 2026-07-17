// Concrete mob types: pig, sheep (passive), zombie (hostile).
// Original box-model designs built from shaded colored parts.

import { Mob } from './mob.js';
import { I } from '../items/itemIds.js';
import { B } from '../blocks/blocks.js';

export class Pig extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.8;
    this.h = 0.9;
    this.health = 10;
    this.kind = 'pig';
  }

  buildModel() {
    const pink = 0xefa2a0, dark = 0xd98886, snoutC = 0xdf8886;
    this.part(0.9, 0.55, 0.6, pink, 0, 0.55, 0);              // body
    const head = this.part(0.45, 0.45, 0.45, pink, 0, 0.72, -0.55); // head
    this.part(0.2, 0.14, 0.08, snoutC, 0, 0.66, -0.8);        // snout
    // eyes
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, -0.12, 0.82, -0.78);
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, 0.12, 0.82, -0.78);
    // legs (pivot at hip: offset geometry down)
    this.legs = [
      this.legPart(dark, -0.25, -0.22),
      this.legPart(dark, 0.25, -0.22),
      this.legPart(dark, -0.25, 0.22),
      this.legPart(dark, 0.25, 0.22),
    ];
    this.head = head;
  }

  legPart(color, x, z) {
    const leg = this.part(0.18, 0.32, 0.18, color, x, 0.32, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.16, 0);
    leg.position.y = 0.32;
    return leg;
  }

  onDeath() {
    this.dropFn?.([{ id: I.PORKCHOP_RAW, count: 1 + ((Math.random() * 2) | 0) }]);
  }
}

export class Sheep extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.9;
    this.h = 1.1;
    this.health = 8;
    this.speed = 1.3;
    this.kind = 'sheep';
  }

  buildModel() {
    const wool = 0xe8e6e0, skin = 0xcfae94, legC = 0xbfa088;
    this.part(1.0, 0.7, 0.65, wool, 0, 0.75, 0);              // woolly body
    this.part(0.42, 0.4, 0.4, skin, 0, 1.0, -0.6);            // head
    this.part(0.46, 0.28, 0.2, wool, 0, 1.14, -0.52);         // wool cap
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, -0.11, 1.06, -0.81);
    this.part(0.07, 0.07, 0.02, 0x2a2a2a, 0.11, 1.06, -0.81);
    this.legs = [
      this.legPart(legC, -0.28, -0.22),
      this.legPart(legC, 0.28, -0.22),
      this.legPart(legC, -0.28, 0.22),
      this.legPart(legC, 0.28, 0.22),
    ];
  }

  legPart(color, x, z) {
    const leg = this.part(0.16, 0.45, 0.16, color, x, 0.45, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.22, 0);
    leg.position.y = 0.45;
    return leg;
  }

  onDeath() {
    this.dropFn?.([
      { id: B.WOOL, count: 1 },
      { id: I.MUTTON_RAW, count: 1 + ((Math.random() * 2) | 0) },
    ]);
  }
}

export class Zombie extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6;
    this.h = 1.9;
    this.health = 20;
    this.hostile = true;
    this.speed = 1.2;
    this.fleeSpeed = 2.9;   // chase speed
    this.attackCooldown = 0;
    this.burnTimer = 0;
    this.kind = 'zombie';
  }

  buildModel() {
    const skinC = 0x5a9c50, shirt = 0x3a6a8a, pants = 0x35506b;
    this.part(0.5, 0.72, 0.3, shirt, 0, 1.12, 0);             // torso
    this.part(0.42, 0.42, 0.42, skinC, 0, 1.72, 0);           // head
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, -0.1, 1.78, -0.22);
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, 0.1, 1.78, -0.22);
    // outstretched arms
    this.part(0.16, 0.16, 0.6, skinC, -0.34, 1.36, -0.24);
    this.part(0.16, 0.16, 0.6, skinC, 0.34, 1.36, -0.24);
    this.legs = [
      this.legPart(pants, -0.14),
      this.legPart(pants, 0.14),
    ];
  }

  legPart(color, x) {
    const leg = this.part(0.2, 0.76, 0.24, color, x, 0.76, 0);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.38, 0);
    leg.position.y = 0.76;
    return leg;
  }

  think(dt, player, playerDist) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    // burn in direct daylight
    const day = this.world.materials.uniforms.uDay.value;
    const sky = this.world.getSkyW(Math.floor(this.x), Math.floor(this.y + 1.5), Math.floor(this.z));
    if (day > 0.8 && sky >= 14) {
      this.burnTimer += dt;
      this.flashTime = 0.1;
      if (this.burnTimer > 1) {
        this.burnTimer = 0;
        this.hurtCooldown = 0;
        this.damage(2, null);
        if (this.dead) return;
      }
    }

    if (!player.dead && playerDist < 18) {
      this.state = 'chase';
      this.moving = true;
      const dx = player.x - this.x, dz = player.z - this.z;
      this.targetYaw = Math.atan2(-dx, -dz);
      // melee
      if (playerDist < 1.4 && this.attackCooldown <= 0) {
        const dy = Math.abs((player.y + 0.9) - (this.y + 1));
        if (dy < 1.6) {
          player.damage(3, 'zombie');
          this.attackCooldown = 1.1;
        }
      }
    } else if (this.state === 'chase') {
      this.state = 'idle';
      this.stateTime = 1;
      this.moving = false;
    } else {
      super.think(dt, player, playerDist);
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.ROTTEN_FLESH, count: 1 + ((Math.random() * 2) | 0) }]);
  }
}
