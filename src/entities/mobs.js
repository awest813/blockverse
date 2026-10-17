// Concrete mob types: pig, sheep (passive); zombie, skeleton, spider,
// scorpion, creeper (hostile); plus primed TNT, which reuses mob physics.
// Original box-model designs built from shaded colored parts.

import * as THREE from 'three';
import { Mob } from './mob.js';
import { I } from '../items/itemIds.js';
import { B, isWater } from '../blocks/blocks.js';
import { makeStack } from '../items/items.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { generateTile } from '../render/textures.js';
import { moodRate } from '../world/ranch.js';
import { trait } from './traits.js';
import { COLOUR, colourOfDye, blendColours } from '../items/dyes.js';
import { tally } from '../world/market.js';
import { worldClock } from '../core/clock.js';

// the wool block's own weave, shared by every sheep's fleece
let woolTex = null;
function woolTexture() {
  if (!woolTex) {
    woolTex = new THREE.CanvasTexture(generateTile('wool'));
    woolTex.magFilter = THREE.NearestFilter;
    woolTex.minFilter = THREE.NearestFilter;
    woolTex.colorSpace = THREE.SRGBColorSpace;
  }
  return woolTex;
}

export class Pig extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.8;
    this.h = 0.9;
    this.health = 10;
    this.kind = 'pig';
    this.ambientSound = 'pig';
    this.hurtSound = 'pig';
    this.breedItem = I.APPLE;
    this.breedAlso = [I.CARROT, I.POTATO];   // pigs love root vegetables
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
    this.ambientSound = 'sheep';
    this.hurtSound = 'sheep';
    this.breedItem = I.WHEAT;
  }

  buildModel() {
    // natural fleece: mostly white, some cream, the odd light-grey one, and
    // now and then a black sheep
    const r = Math.random();
    this.woolTint = r < 0.62 ? 0xffffff : r < 0.87 ? 0xf3ecdc : r < 0.99 ? 0xdedcd8 : COLOUR.black.tint;
    this.dye = r < 0.99 ? null : 'black';   // (its wool's colour: null for natural white, cream or grey)
    const skin = 0xd9b9a0, face = 0xcfa88e, legC = 0xc39c84, hoof = 0x5a4638;
    const woolPart = (w, h, d, x, y, z, parent = null) => {
      const m = this.part(w, h, d, this.woolTint, x, y, z);
      m.material.map = woolTexture();
      this.woolMats.push(this.materials.at(-1));
      if (parent) { this.group.remove(m); parent.add(m); }
      return m;
    };
    this.woolMats = [];
    this.fleece = [
      woolPart(1.0, 0.72, 0.68, 0, 0.78, 0.02),               // woolly body
      woolPart(0.74, 0.12, 0.5, 0, 1.18, 0.06),               // lumpy back
      woolPart(0.6, 0.5, 0.12, 0, 0.8, 0.41),                 // rump puff
    ];
    // shorn: a short, pink-cream fuzz (same weave, close-cropped)
    this.shorn = this.part(0.82, 0.54, 0.54, 0xe6c8b2, 0, 0.76, 0.02);
    this.shorn.material.map = woolTexture();
    this.shorn.visible = false;
    // the head is a pivot so it can dip to graze
    this.head = new THREE.Group();
    this.head.position.set(0, 1.02, -0.5);
    this.group.add(this.head);
    const hp = (w, h, d, c, x, y, z) => { const m = this.part(w, h, d, c, x, y, z); this.group.remove(m); this.head.add(m); return m; };
    hp(0.38, 0.36, 0.42, skin, 0, 0, -0.12);                  // head
    hp(0.32, 0.22, 0.06, face, 0, -0.05, -0.34);              // face
    this.fleece.push(woolPart(0.42, 0.14, 0.3, 0, 0.21, -0.06, this.head));   // wool cap
    hp(0.16, 0.06, 0.1, skin, -0.25, 0.06, -0.08).rotation.z = 0.35;          // ears, drooping
    hp(0.16, 0.06, 0.1, skin, 0.25, 0.06, -0.08).rotation.z = -0.35;
    hp(0.09, 0.07, 0.02, 0xf2f0ea, -0.1, 0.03, -0.375);       // eyes
    hp(0.09, 0.07, 0.02, 0xf2f0ea, 0.1, 0.03, -0.375);
    hp(0.045, 0.07, 0.02, 0x1e1a18, -0.075, 0.03, -0.38);
    hp(0.045, 0.07, 0.02, 0x1e1a18, 0.075, 0.03, -0.38);
    hp(0.12, 0.05, 0.02, 0xb07a78, 0, -0.1, -0.38);           // nose
    this.legs = [
      this.legPart(legC, hoof, -0.28, -0.22),
      this.legPart(legC, hoof, 0.28, -0.22),
      this.legPart(legC, hoof, -0.28, 0.22),
      this.legPart(legC, hoof, 0.28, 0.22),
    ];
    // woolly upper legs (they go with the fleece)
    for (const leg of this.legs) this.fleece.push(woolPart(0.23, 0.18, 0.23, 0, -0.13, 0, leg));
  }

  legPart(color, hoof, x, z) {
    const leg = this.part(0.16, 0.45, 0.16, color, x, 0.45, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.22, 0);
    leg.position.y = 0.45;
    const h = this.part(0.17, 0.08, 0.17, hoof, 0, -0.41, 0);
    this.group.remove(h); leg.add(h);
    return leg;
  }

  saveExtra() { return { tint: this.woolTint, ...(this.dye ? { dye: this.dye } : {}), ...(this.sheared ? { regrow: Math.round(this.regrow) } : {}) }; }   // (white too, or it'd be re-rolled on load)
  loadExtra(e) {
    if (Number.isFinite(e.regrow) && this.sheared) this.regrow = e.regrow;
    this.dye = COLOUR[e.dye] && e.dye !== 'white' ? e.dye : null;
    if (Number.isInteger(e.tint)) this.setTint(e.tint);
    else if (this.dye) this.setTint(COLOUR[this.dye].tint);
  }

  setTint(tint) {
    this.woolTint = tint;
    for (const m of this.woolMats) m.base.setHex(tint);
  }

  // what a shearing gives: wool of its colour
  woolId() { return COLOUR[this.dye ?? 'white'].wool; }

  // a lamb's fleece: the same as its parents', a blend of the two (red and
  // white make pink), or one or the other's; and now and then a black sheep
  inherit(baby, mate) {
    if (Math.random() < 0.02) { baby.dye = 'black'; baby.setTint(COLOUR.black.tint); return; }
    const blend = blendColours(this.dye ?? 'white', mate.dye ?? 'white');
    if (blend && blend !== 'white') { baby.dye = blend; baby.setTint(COLOUR[blend].tint); return; }
    const from = Math.random() < 0.5 ? this : mate;
    baby.dye = from.dye;
    baby.setTint(from.woolTint);
  }

  // shears: 1-3 wool (how thick its fleece is), and it grows back after a
  // few minutes; a dye colours it
  interact(player, held) {
    const colour = colourOfDye(held?.id);
    if (colour && !this.baby) {
      const natural = colour.key === 'white' ? !this.dye && this.woolTint === 0xffffff : this.dye === colour.key;
      if (natural) { this.fx?.notify?.(`This sheep is already ${colour.key}`); return true; }
      this.dye = colour.key === 'white' ? null : colour.key;
      this.setTint(colour.tint);
      this.persistent = true;
      if (player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
      this.fx?.sound('place', { block: 'cloth', pos: this });
      this.fx?.spark?.(this.x, this.y + this.h, this.z, colour.tint, 8);
      return true;
    }
    if (held?.id !== I.SHEARS) return super.interact(player, held);
    if (this.sheared || this.baby) return true;
    this.setSheared(true);
    this.persistent = true;   // a sheep you're shearing is one of yours: kept and saved
    const wool = Math.max(1, Math.floor(trait(this, 'fleece') + Math.random()));
    this.dropFn?.([{ id: this.woolId(), count: wool }]);
    tally('wool', wool);
    if (player.mode !== GAMEMODE_CREATIVE) player.damageHeldTool(1);
    this.fx?.sound('shear', { pos: this });
    this.fx?.sound('sheep', { pos: this, pitch: 1.1 });   // an indignant bleat
    return true;
  }

  setSheared(on) {
    this.sheared = on;
    this.regrow = on ? 120 + Math.random() * 120 : 0;
    for (const f of this.fleece) f.visible = !on;
    this.shorn.visible = on;
  }

  think(dt, player, playerDist) {
    if (this.sheared && (this.regrow -= dt * moodRate(this)) <= 0) this.setSheared(false);
    // sheep graze: head down for a mouthful. A shorn sheep or a lamb eats the
    // grass down to dirt (the fleece comes back, the lamb grows); a sheep in
    // full fleece just nibbles, so a flock doesn't strip the land bare
    if (this.graze > 0) {
      this.graze -= dt;
      this.moving = false;
      const dip = Math.min(1, (1.4 - this.graze) * 3, this.graze * 3);
      this.head.position.y = 1.02 - dip * 0.42;
      this.head.rotation.x = -dip * 0.7;
      if (this.graze <= 0) {
        this.head.position.y = 1.02;
        this.head.rotation.x = 0;
        const bx = Math.floor(this.x), by = Math.floor(this.y - 0.1), bz = Math.floor(this.z);
        if ((this.sheared || this.baby) && this.world.getBlockW(bx, by, bz) === B.GRASS) {
          this.world.setBlock(bx, by, bz, B.DIRT);
          this.fedAt = worldClock.now;
          this.fx?.sound('break', { block: 'leaf', pos: this, vol: 0.5 });
          if (this.baby) this.grow = Math.max(0, this.grow - 60);
          else this.setSheared(false);
        }
      }
      return;
    }
    if (this.onGround && this.state === 'idle' && Math.random() < dt / (this.sheared ? 25 : 40)
      && this.world.getBlockW(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z)) === B.GRASS) {
      this.graze = 1.4;
      return;
    }
    super.think(dt, player, playerDist);
  }

  onDeath() {
    this.dropFn?.([
      { id: this.woolId(), count: this.sheared ? 0 : 1 },
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
    this.ambientSound = 'zombie';
    this.undead = true;
    this.submerged = 0;   // seconds with its head underwater (30 -> drowned)
  }

  // baby zombies: half size, fast, just as tough
  makeBaby() {
    this.small = true;
    this.w = 0.35; this.h = 1.0;
    this.group.scale.setScalar(0.52);
    this.speed *= 1.6;
    this.fleeSpeed *= 1.45;
    return this;
  }

  buildModel(skinC = 0x5a9c50, shirt = 0x3a6a8a, pants = 0x35506b) {
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
    if (this.burnInDaylight(dt)) return;
    // a zombie that stays underwater too long turns into a drowned
    if (this.kind === 'zombie') {
      const head = this.world.getBlockW(Math.floor(this.x), Math.floor(this.y + this.h - 0.2), Math.floor(this.z));
      this.submerged = isWater(head) ? this.submerged + dt : 0;
      if (this.submerged > 30 && this.fx?.spawn) {
        const d = new Drowned(this.scene, this.world, this.x, this.y, this.z);
        if (this.small) d.makeBaby();
        // the same zombie, just waterlogged: keep its wounds and heading
        d.health = Math.min(d.health, this.health);
        d.yaw = d.targetYaw = this.yaw;
        if (this.fromSpawner) d.fromSpawner = true;
        this.fx.spawn(d);
        this.kill();
        return;
      }
    }
    if (!this.senses(player, 18, dt)) {
      this.loseTarget();
      if (!this.seekShade(dt)) super.think(dt, player, playerDist);
      return;
    }
    this.state = 'chase';
    this.moving = true;
    this.steer(player, 1);
    if (this.dist3(player) < 1.6 * (this.reach ?? 1) && this.attackCooldown <= 0 && this.meleeHit(player, this.meleeDamage ?? 3, this.kind)) {
      this.attackCooldown = 1.1;
      // a burning zombie passes the fire on
      if (this.fireTime > 0) player.fireTime = Math.max(player.fireTime ?? 0, 3);
      this.onHit?.(player);
    }
  }

  // rotten flesh, and rarely something it was carrying: a carrot, a potato, an iron ingot
  onDeath() {
    const drops = [{ id: I.ROTTEN_FLESH, count: 1 + ((Math.random() * 2) | 0) }];
    const r = Math.random();
    if (r < 0.025) drops.push({ id: I.CARROT, count: 1 });
    else if (r < 0.05) drops.push({ id: I.POTATO, count: 1 });
    else if (r < 0.06) drops.push({ id: I.IRON_INGOT, count: 1 });
    this.dropFn?.(drops);
  }
}

// Desert zombies: sun-dried, they don't burn in daylight, and their hits
// leave you hungry.
export class Husk extends Zombie {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'husk';
    this.fireproofSun = true;
  }

  buildModel() { super.buildModel(0xa89a6a, 0x7a6a4a, 0x5c5040); }

  onHit(player) { player.addExhaustion(6); }
}

// Zombies of the deep: they swim after you, and sometimes carry a spear.
export class Drowned extends Zombie {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.kind = 'drowned';
    this.ambientSound = 'zombie';
  }

  // swims (steers vertically) only while in water; walks like a zombie on land
  get swimmer() { return this.inWater; }

  buildModel() { super.buildModel(0x4f9a8e, 0x2d6b6a, 0x2b4a5a); }

  think(dt, player, playerDist) {
    this.landSpeed ??= this.fleeSpeed;
    this.fleeSpeed = this.landSpeed;
    super.think(dt, player, playerDist);
    if (!this.inWater || this.dead || this.dying !== undefined) return;
    if (this.state === 'chase') {
      this.targetVy = Math.max(-2.2, Math.min(2.2, (player.y + 0.4 - this.y) * 1.5));
      this.fleeSpeed = Math.min(this.landSpeed, 2.4);   // a little slower swimming
      if (this.lastHitWall) this.vy = Math.max(this.vy, 5.5);   // scramble up the bank after you
    } else {
      this.targetVy = (Math.random() - 0.5) * 0.4;
    }
  }

  onDeath() {
    const drops = [{ id: I.ROTTEN_FLESH, count: 1 + ((Math.random() * 2) | 0) }];
    if (Math.random() < 0.04) drops.push(makeStack(I.IRON_SPEAR, 1));
    this.dropFn?.(drops);
  }
}

export class Skeleton extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6;
    this.h = 1.9;
    this.health = 20;
    this.hostile = true;
    this.speed = 1.2;
    this.fleeSpeed = 2.4;
    this.shootCooldown = 1 + Math.random();
    this.kind = 'skeleton';
    this.ambientSound = 'skeleton';
    this.undead = true;
  }

  buildModel() {
    const bone = 0xd8d6cc, boneD = 0xb4b2a8;
    this.part(0.46, 0.7, 0.22, boneD, 0, 1.12, 0);            // ribcage
    this.part(0.42, 0.42, 0.42, bone, 0, 1.72, 0);            // skull
    this.part(0.1, 0.1, 0.02, 0x1a1a1a, -0.1, 1.76, -0.22);   // eye sockets
    this.part(0.1, 0.1, 0.02, 0x1a1a1a, 0.1, 1.76, -0.22);
    this.part(0.1, 0.1, 0.62, bone, -0.3, 1.38, -0.26);       // bow arm
    this.part(0.1, 0.1, 0.62, bone, 0.3, 1.38, -0.26);
    this.part(0.06, 0.7, 0.06, 0x6b4a2a, 0, 1.38, -0.58);     // bow
    this.legs = [this.legPart(bone, -0.12), this.legPart(bone, 0.12)];
  }

  legPart(color, x) {
    const leg = this.part(0.12, 0.76, 0.12, color, x, 0.76, 0);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.38, 0);
    leg.position.y = 0.76;
    return leg;
  }

  think(dt, player, playerDist) {
    if (this.burnInDaylight(dt)) return;
    this.shootCooldown -= dt;
    if (!this.senses(player, 16, dt)) {
      this.loseTarget();
      if (!this.seekShade(dt)) super.think(dt, player, playerDist);
      return;
    }
    // keep a shooting distance: close in when far, back off when crowded
    this.state = 'chase';
    if (playerDist > 10) { this.steer(player, 1); this.moving = true; }
    else if (playerDist < 5) { this.steer(player, -1); this.moving = true; }
    else { this.steer(player, 1); this.moving = false; }

    if (this.shootCooldown <= 0 && this.canSee(player, 1.6)) {
      this.shootCooldown = 1.6 + Math.random() * 0.8;
      if (!this.moving || playerDist < 5) this.steer(player, 1);
      const ox = this.x, oy = this.y + 1.5, oz = this.z;
      // lead a moving target a little (capped, so strafing still works)
      const lead = Math.min(0.6, Math.hypot(player.x - ox, player.z - oz) / 18);
      const dx = player.x + Math.max(-3, Math.min(3, player.vx * lead)) - ox, dy = player.y + 1.1 - oy;
      const dz = player.z + Math.max(-3, Math.min(3, player.vz * lead)) - oz;
      const flat = Math.hypot(dx, dz);
      if (flat < 0.5) return;   // straight up/down: no sensible lob
      const speed = 18;
      const t = flat / speed;
      // lob to cancel gravity over the flight time, plus a little inaccuracy
      const spread = () => (Math.random() - 0.5) * 0.9;
      this.shootArrow(ox, oy, oz,
        (dx / flat) * speed + spread(), dy / t + 10 * t + spread(), (dz / flat) * speed + spread(),
        2 + ((Math.random() * 2) | 0));
    }
  }

  shootArrow(x, y, z, vx, vy, vz, dmg) { this.fx?.shoot(x, y, z, vx, vy, vz, dmg, this.kind); }

  // bones, arrows now and then, and rarely its own (well-used) bow
  onDeath() {
    const drops = [{ id: I.BONE, count: (Math.random() * 3) | 0 }, { id: I.ARROW, count: (Math.random() * 3) | 0 }];
    if (Math.random() < 0.025) {
      const bow = makeStack(I.BOW, 1);
      if (bow.dur !== undefined) bow.dur = Math.max(1, Math.floor(bow.dur * (0.2 + Math.random() * 0.5)));
      drops.push(bow);
    }
    this.dropFn?.(drops);
  }
}

export class Spider extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 1.2;
    this.h = 0.9;
    this.health = 16;
    this.hostile = true;
    this.climber = true;
    this.speed = 1.6;
    this.fleeSpeed = 3.8;
    this.attackCooldown = 0;
    this.angry = 0;          // seconds of aggression after being hit in daylight
    this.kind = 'spider';
    this.ambientSound = 'spider';
  }

  buildModel(body = 0x2e2a28, bodyL = 0x4a4440) {
    this.part(0.7, 0.55, 0.9, body, 0, 0.55, 0.3);            // abdomen
    this.part(0.5, 0.45, 0.45, bodyL, 0, 0.55, -0.35);        // head
    // red eyes that glow in the dark
    for (const x of [-0.13, 0.13]) this.glowPart(0.09, 0.07, 0.02, 0xe02424, x, 0.62, -0.58);
    for (const x of [-0.2, 0.2]) this.glowPart(0.06, 0.05, 0.02, 0xe02424, x, 0.52, -0.58);
    this.legs = [];
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const leg = this.part(0.9, 0.08, 0.08, body, side * 0.5, 0.55, -0.25 + i * 0.22);
        leg.rotation.z = side * 0.45;
        this.legs.push(leg);
      }
    }
  }

  animate() {
    const swing = Math.sin(this.walkPhase * 1.5) * (this.moving ? 0.35 : 0);
    this.legs.forEach((leg, i) => { leg.rotation.y = (i % 2 ? swing : -swing) * (i % 4 < 2 ? 1 : -1); });
  }

  damage(amount, source) {
    if (source) this.angry = 10;
    return super.damage(amount, source);
  }

  think(dt, player, playerDist) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.angry = Math.max(0, this.angry - dt);
    // spiders only hunt in the dark (caves count), unless you started it
    const x = Math.floor(this.x), y = Math.floor(this.y + 0.5), z = Math.floor(this.z);
    const light = Math.max((this.world.getSkyW(x, y, z) / 15) * this.world.materials.uniforms.uDay.value, this.world.getBlockLightW(x, y, z) / 15);
    const hunting = this.senses(player, 16, dt) && (light < 0.5 || this.angry > 0);
    if (!hunting) {
      this.loseTarget();
      super.think(dt, player, playerDist);
      return;
    }
    this.state = 'chase';
    this.moving = true;
    this.steer(player, 1);
    if (this.dist3(player) < 1.8 * (this.reach ?? 1) && this.attackCooldown <= 0 && this.meleeHit(player, this.meleeDamage ?? 2, this.kind)) {
      this.attackCooldown = 1;
      if (this.onGround) this.vy = 5;   // pounce
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.STRING, count: (Math.random() * 3) | 0 }]);
  }
}

// Scorpions: sand-coloured desert stingers, about by day and by night. They
// keep to themselves until you come close (or hit one), then scuttle in to
// pinch and sting. The venom takes a heart every second and a half and stops
// you healing (it never kills: it leaves you half a heart) until it wears off
// or you drink milk. After a sting they skitter back, then come again.
export class Scorpion extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.9;
    this.h = 0.5;
    this.health = 12;
    this.hostile = true;
    this.speed = 1.1;
    this.fleeSpeed = 3.4;
    this.attackCooldown = 0;
    this.angry = 0;          // seconds of aggression after being hit
    this.backoff = 0;        // seconds of skittering back after a sting
    this.strike = 0;         // the tail strike: 1 -> 0
    this.kind = 'scorpion';
    this.ambientSound = 'scorpion';
  }

  buildModel() {
    const shell = 0xc89a58, dark = 0x8e6532, tip = 0x2e2014;
    this.part(0.5, 0.18, 0.66, shell, 0, 0.2, 0.05);            // body
    this.part(0.36, 0.15, 0.24, dark, 0, 0.2, -0.36);           // head
    for (const x of [-0.08, 0.08]) this.part(0.04, 0.04, 0.02, 0x111111, x, 0.28, -0.49);
    // pincers, on arms that open and snap shut
    this.claws = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.16, 0.2, -0.44);
      arm.rotation.y = side * -0.35;
      this.group.add(arm);
      const add = (m) => { this.group.remove(m); arm.add(m); return m; };
      add(this.part(0.08, 0.08, 0.28, shell, 0, 0, -0.12));
      add(this.part(0.16, 0.12, 0.16, dark, 0, 0.01, -0.32));     // the claw
      const pinch = add(this.part(0.05, 0.08, 0.14, dark, side * -0.07, 0.01, -0.45));
      this.claws.push({ arm, pinch, side });
    }
    // eight legs, splayed out
    this.legs = [];
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const leg = this.part(0.42, 0.06, 0.06, dark, side * 0.36, 0.12, -0.16 + i * 0.15);
        leg.rotation.z = side * -0.5;
        this.legs.push(leg);
      }
    }
    // the tail curls up and forward over the back, the stinger at its tip
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.24, 0.36);
    this.group.add(this.tail);
    let py = 0, pz = 0;
    [0.3, 0.9, 1.5, 2.1, 2.7].forEach((a, i) => {
      py += Math.sin(a) * 0.14; pz += Math.cos(a) * 0.14;
      const seg = this.part(0.13 - i * 0.012, 0.12 - i * 0.01, 0.15, i < 4 ? shell : dark, 0, py, pz);
      seg.rotation.x = -a;
      this.group.remove(seg); this.tail.add(seg);
    });
    const sting = this.part(0.05, 0.12, 0.05, tip, 0, py - 0.08, pz - 0.07);
    sting.rotation.x = -0.5;
    this.group.remove(sting); this.tail.add(sting);
  }

  animate(dt) {
    const swing = Math.sin(this.walkPhase * 1.8) * (this.moving ? 0.35 : 0);
    this.legs.forEach((leg, i) => { leg.rotation.y = (i % 2 ? swing : -swing) * (i % 4 < 2 ? 1 : -1); });
    // the tail sways, then whips forward to sting
    this.strike = Math.max(0, this.strike - dt * 3);
    const s = Math.sin(this.strike * Math.PI);
    this.tail.rotation.x = -s * 0.7 + Math.sin(this.age * 2.2) * 0.05;
    const open = this.state === 'chase' ? 0.35 + Math.sin(this.age * 9) * 0.2 : 0.1;
    for (const c of this.claws) c.pinch.rotation.y = c.side * open;
  }

  damage(amount, source) {
    if (source) this.angry = 12;
    return super.damage(amount, source);
  }

  think(dt, player, playerDist) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.angry = Math.max(0, this.angry - dt);
    this.backoff = Math.max(0, this.backoff - dt);
    // close by (or after you hit it) it turns on you; otherwise it minds its own business
    const near = this.dist3(player) < (this.angry > 0 ? 16 : 4);
    if (!(near && this.senses(player, 16, dt))) {
      this.loseTarget();
      super.think(dt, player, playerDist);
      return;
    }
    this.state = 'chase';
    this.moving = true;
    if (this.backoff > 0) { this.steer(player, -1); return; }
    this.steer(player, 1);
    if (this.dist3(player) < 1.6 && this.attackCooldown <= 0) {
      const before = player.health;
      if (this.meleeHit(player, this.meleeDamage ?? 2, this.kind)) {
        this.attackCooldown = 1.4;
        this.strike = 1;
        this.backoff = 0.7;
        // the venom only gets in if the sting did (not through creative, not on peaceful)
        if (player.health < before && !player.dead) {
          const secs = [0, 4, 7, 10][player.difficulty ?? 2] ?? 7;
          player.poisonTime = Math.max(player.poisonTime ?? 0, secs);
          player.poisonTimer = Math.max(player.poisonTimer ?? 0, 1.5);   // the sting itself was this tick's damage
        }
      }
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.STRING, count: Math.random() < 0.5 ? 1 : 0 }]);
  }
}

const FUSE_TIME = 1.5;

export class Creeper extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6;
    this.h = 1.7;
    this.health = 20;
    this.hostile = true;
    this.speed = 1.2;
    this.fleeSpeed = 2.4;
    this.fuse = 0;
    this.kind = 'creeper';
  }

  buildModel() {
    const green = 0x4fae3c, greenD = 0x3a8a2c;
    this.body = this.part(0.5, 0.8, 0.3, green, 0, 0.82, 0);
    this.part(0.46, 0.46, 0.46, green, 0, 1.45, 0);
    // the face
    this.part(0.1, 0.1, 0.02, 0x152a12, -0.1, 1.52, -0.24);
    this.part(0.1, 0.1, 0.02, 0x152a12, 0.1, 1.52, -0.24);
    this.part(0.1, 0.16, 0.02, 0x152a12, 0, 1.4, -0.24);
    this.legs = [
      this.legPart(greenD, -0.13, -0.12), this.legPart(greenD, 0.13, -0.12),
      this.legPart(greenD, -0.13, 0.12), this.legPart(greenD, 0.13, 0.12),
    ];
  }

  legPart(color, x, z) {
    const leg = this.part(0.2, 0.42, 0.2, color, x, 0.42, z);
    leg.geometry = leg.geometry.clone();
    leg.geometry.translate(0, -0.21, 0);
    leg.position.y = 0.42;
    return leg;
  }

  think(dt, player, playerDist) {
    // creepers keep well away from cats
    const cat = (this.fx?.mobs() ?? []).find((m) => m.kind === 'cat' && !m.dead && Math.hypot(m.x - this.x, m.z - this.z) < 6);
    if (cat) {
      this.fuse = 0;
      this.state = 'flee';
      this.moving = true;
      this.targetYaw = Math.atan2(-(cat.x - this.x), -(cat.z - this.z)) + Math.PI;
      return;
    }
    const sees = this.senses(player, 16, dt);
    const d = this.dist3(player);
    // a lit fuse keeps burning while you're within 7 blocks and in sight
    // (duck behind a wall and it fizzles out)
    const inSight = this.fuse > 0 && d < 7 && this.canSee(player);
    if (!sees && !(inSight && !player.dead && player.mode !== GAMEMODE_CREATIVE)) {
      this.fuse = Math.max(0, this.fuse - dt);
      this.loseTarget();
      super.think(dt, player, playerDist);
      return;
    }
    this.state = 'chase';
    this.steer(player, 1);
    if ((d < 3 && this.canSee(player)) || inSight) {
      // stop and hiss; walking away far enough defuses it
      if (this.fuse === 0) this.fx?.sound('fuse', { pos: this });
      this.moving = false;
      this.fuse += dt;
      if (this.fuse >= FUSE_TIME) {
        this.kill();   // first, so the blast doesn't also "kill" it for drops
        this.fx?.explode(this.x, this.y + 0.8, this.z, 3);
      }
    } else {
      this.fuse = Math.max(0, this.fuse - dt);
      this.moving = true;
    }
  }

  onDeath() {
    this.dropFn?.([{ id: I.GUNPOWDER, count: (Math.random() * 3) | 0 }]);
  }
}

// A lit TNT block: falls like a block, flashes, then explodes.
export class PrimedTnt extends Mob {
  constructor(scene, world, x, y, z, fuse = 3) {
    super(scene, world, x, y, z);
    this.w = 0.98;
    this.h = 0.98;
    this.fuse = fuse;
    this.kind = 'tnt';
    this.countsForCap = false;
    this.vy = 3;
  }

  buildModel() {
    this.part(0.98, 0.98, 0.98, 0xcc3024, 0, 0.49, 0);
    this.part(1.0, 0.36, 1.0, 0xece8dc, 0, 0.49, 0);
  }

  think(dt) {
    this.moving = false;
    this.fuse -= dt;
    if (this.fuse <= 0) {
      this.kill();
      this.fx?.explode(this.x, this.y + 0.5, this.z, 4);
    }
  }

  update(dt, player) {
    super.update(dt, player);
    if (!this.dead && Math.floor(this.fuse * 4) % 2 === 0) {
      for (const { mat } of this.materials) mat.color.lerp(new THREE.Color(0xffffff), 0.6);
    }
  }

  damage() { return false; }   // can't be punched out
}
