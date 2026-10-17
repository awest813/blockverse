// Mob base class: box-model creatures with simple AI, physics and combat.
// Models are assembled from shaded colored boxes (all original designs).

import * as THREE from 'three';
import { moveEntity, entityInBlock, entityInWater, nudgeFree } from '../core/physics.js';
import { B, isSolid } from '../blocks/blocks.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { I } from '../items/itemIds.js';
import { itemInfo } from '../items/items.js';
import { SMELTING } from '../items/recipes.js';

// raw meat -> cooked, for animals that die burning
// an animal that dies burning drops its food as the furnace would cook it
// (taken from the smelting list, so a new meat needs no entry here)
const cookedId = (id) => ((itemInfo(id)?.food ?? 0) > 0 ? SMELTING.get(id)?.id ?? null : null);

const DEATH_TIME = 0.6;   // seconds of tipping over before a dead mob disappears
const HURT_RED = new THREE.Color(0xff3333);

// BoxGeometry with per-face brightness baked into vertex colors, so flat
// MeshBasicMaterial still reads as 3D.
const FACE_SHADE = { px: 0.72, nx: 0.72, py: 1.0, ny: 0.45, pz: 0.86, nz: 0.6 };
// box geometries are shared by size across every mob (never disposed)
const BOX_CACHE = new Map();
const SHARED = new WeakSet();   // (not userData: clones would inherit it)
function shadedBox(w, h, d) {
  const key = `${w},${h},${d}`;
  let g = BOX_CACHE.get(key);
  if (!g) { g = makeShadedBox(w, h, d); SHARED.add(g); BOX_CACHE.set(key, g); }
  return g;
}

function makeShadedBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const colors = new Float32Array(g.attributes.position.count * 3);
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  for (let f = 0; f < 6; f++) {
    const s = FACE_SHADE[order[f]];
    for (let v = 0; v < 4; v++) {
      const i = (f * 4 + v) * 3;
      colors[i] = s; colors[i + 1] = s; colors[i + 2] = s;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// a lead: one thin box, stretched and turned between the animal and its holder
const ROPE_GEO = new THREE.BoxGeometry(0.05, 0.05, 1);
const ROPE_MAT = new THREE.MeshBasicMaterial({ color: 0x9a7448 });
const LEASH_SLACK = 3.5, LEASH_SNAP = 12;
export const FENCE_POSTS = new Set([B.OAK_FENCE, B.OAK_FENCE_GATE]);

let flameTex = null;
function makeFlameTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 24;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 16; x++) {
    const h = 10 + Math.sin(x * 1.7) * 4 + (x % 3) * 2;
    for (let y = 0; y < h; y++) {
      const k = y / h;
      ctx.fillStyle = k < 0.4 ? 'rgba(255,230,120,0.9)' : k < 0.75 ? 'rgba(255,150,40,0.85)' : 'rgba(220,70,20,0.7)';
      ctx.fillRect(x, 23 - y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export class Mob {
  constructor(scene, world, x, y, z) {
    this.scene = scene;
    this.world = world;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = 0.7;
    this.h = 1.0;
    this.yaw = Math.random() * Math.PI * 2;
    this.health = 10;
    this.dead = false;
    this.onGround = false;
    this.hurtCooldown = 0;
    this.flashTime = 0;
    this.age = 0;
    this.walkPhase = 0;
    this.moving = false;

    // AI
    this.state = 'idle';
    this.stateTime = 1 + Math.random() * 3;
    this.targetYaw = this.yaw;
    this.speed = 1.6;
    this.fleeSpeed = 3.4;
    this.hostile = false;

    this.group = new THREE.Group();
    this.materials = [];
    this.buildModel();
    scene.add(this.group);
  }

  // subclass hook — assemble boxes into this.group, push materials
  buildModel() {}

  // ---- breeding (animals with a breedItem) ----

  // will it eat this? (its favourite food, or a golden carrot, which any farm animal loves)
  likes(id) {
    if (!this.breedItem || this.tamed) return false;
    return id === I.GOLDEN_CARROT || id === this.breedItem || (this.breedAlso?.includes(id) ?? false);
  }

  // Eat one: an adult falls in love, a baby grows (a golden carrot grows it
  // up at once). Returns false if it isn't hungry. Shared by hand-feeding
  // and the feeding trough.
  feed(id) {
    if (this.baby) {
      this.grow = id === I.GOLDEN_CARROT ? 0 : Math.max(0, this.grow - 60);
    } else {
      if (this.love > 0 || (this.breedCooldown ?? 0) > 0) return false;   // not hungry yet
      this.love = 30;
    }
    this.persistent = true;
    this.fx?.hearts?.(this.x, this.y + this.h, this.z);
    this.fx?.sound('eat', { vol: 0.6, pos: this });
    return true;
  }

  // right-click with its food: fall in love (or help a baby grow)
  interact(player, held) {
    if (!this.likes(held?.id)) return false;
    if (this.feed(held.id) && player.mode !== GAMEMODE_CREATIVE) player.consumeHeld(1);
    return true;
  }

  breedTick(dt) {
    this.breedCooldown = Math.max(0, (this.breedCooldown ?? 0) - dt);
    if (this.baby) {
      this.grow -= dt;
      if (this.grow <= 0) this.setBaby(false);
      // no room to grow (pressed into a fence, say): try again in a moment
      if (!this.baby && !nudgeFree(this.world, this)) this.setBaby(true, 3);
      return;
    }
    if (!(this.love > 0)) return;
    this.love -= dt;
    if (Math.random() < dt * 1.5) this.fx?.hearts?.(this.x, this.y + this.h, this.z, 1);
    // seek a partner of the same kind that's also in love
    let mate = null, best = 10;
    for (const m of this.fx?.mobs() ?? []) {
      if (m === this || m.kind !== this.kind || !(m.love > 0) || m.baby || m.dead || m.dying !== undefined) continue;
      const d = Math.hypot(m.x - this.x, m.z - this.z);
      if (d < best) { best = d; mate = m; }
    }
    if (!mate) return;
    if (best > 1.4) {
      this.targetYaw = Math.atan2(-(mate.x - this.x), -(mate.z - this.z));
      this.moving = true;
      this.state = 'wander';
      return;
    }
    // a baby!
    this.love = mate.love = 0;
    this.breedCooldown = mate.breedCooldown = 300;
    const baby = new this.constructor(this.scene, this.world, (this.x + mate.x) / 2, this.y + 0.2, (this.z + mate.z) / 2);
    baby.setBaby(true);
    baby.persistent = true;
    this.fx?.spawn?.(baby);
    this.fx?.hearts?.(baby.x, baby.y + 0.6, baby.z, 6);
  }

  // babies are half size, can't breed and drop nothing; they grow up in 5 minutes
  setBaby(on, grow = 300) {
    if (on === !!this.baby) return;
    this.baby = on;
    if (!this.adultSize) this.adultSize = { w: this.w, h: this.h };
    const k = on ? 0.55 : 1;
    this.w = this.adultSize.w * k;
    this.h = this.adultSize.h * k;
    this.group.scale.setScalar(k);
    this.grow = on ? grow : 0;
  }

  part(w, h, d, color, x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color, vertexColors: true });
    const m = new THREE.Mesh(shadedBox(w, h, d), mat);
    m.position.set(x, y, z);
    this.materials.push({ mat, base: new THREE.Color(color) });
    this.group.add(m);
    return m;
  }

  // a part that shines in the dark (a spider's eyes): never drawn darker than this
  glowPart(w, h, d, color, x, y, z, glow = 0.9) {
    const m = this.part(w, h, d, color, x, y, z);
    this.materials[this.materials.length - 1].glow = glow;
    return m;
  }

  update(dt, player) {
    if (this.dead) return;
    if (this.dying !== undefined) { this.animateDeath(dt); return; }
    this.age += dt;
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.flashTime = Math.max(0, this.flashTime - dt);

    // despawn far from player
    const pdx = this.x - player.x, pdz = this.z - player.z;
    const playerDistSq = pdx * pdx + pdz * pdz;
    if (playerDistSq > 80 * 80) {
      // animals the player has fed are kept (stashed) rather than lost
      if (!this.tamed) {
        // (with the stash full, a kept animal stays put, unsimulated, rather than vanish)
        if (this.persistent && this.fx?.stash?.(this) === false) return;
        this.kill();
        return;
      }
    }
    // pets left far behind catch up by appearing next to the player
    // (only once the player is on the ground, so pets aren't dropped from the sky)
    if (this.tamed && !this.sitting && playerDistSq > 24 * 24 && !player.dead && player.onGround && !player.flying) {
      this.x = player.x + (Math.random() - 0.5) * 2;
      this.y = player.y + 0.1;
      this.z = player.z + (Math.random() - 0.5) * 2;
      this.vx = this.vy = this.vz = 0;
      this.fallStart = undefined;
      nudgeFree(this.world, this, 1);   // not inside a corridor wall
    }
    // freeze in unloaded chunks
    if (!this.world.isLoaded(Math.floor(this.x), Math.floor(this.z))) return;

    if (this.pendingLeash) { this.pendingLeash = false; if (!player.dead) this.leashTo({ player }); }
    this.think(dt, player, Math.sqrt(playerDistSq));
    if (this.dead || this.dying !== undefined) return;
    this.updateFire(dt);
    if (this.dead || this.dying !== undefined) return;
    if (this.breedItem) this.breedTick(dt);
    this.avoidHazards(dt);
    this.ambient(dt, player);

    // steering: turn toward targetYaw, walk forward when moving
    let dyaw = ((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));

    const inWater = entityInWater(this.world, this);
    const speed = this.leashSpeed || this.dashSpeed || (this.state === 'flee' || this.state === 'chase' || this.hurry ? this.fleeSpeed : this.speed);
    let dvx = 0, dvz = 0;
    if (this.moving) {
      dvx = -Math.sin(this.yaw) * speed;
      dvz = -Math.cos(this.yaw) * speed;
    }
    const accel = this.onGround ? 18 : 5;
    this.vx += (dvx - this.vx) * Math.min(1, accel * dt);
    this.vz += (dvz - this.vz) * Math.min(1, accel * dt);

    if (this.flier || (this.swimmer && inWater)) {
      // fliers and swimmers steer vertically toward targetVy (set by think)
      this.vy += ((this.targetVy ?? 0) - this.vy) * Math.min(1, 3 * dt);
    } else if (this.climbSpeed && this.climber && this.lastHitWall && this.moving && !inWater) {
      this.vy = this.climbSpeed;   // a slow climber (a sloth) grips the trunk: gravity doesn't win
    } else if (inWater && this.undead) {
      this.vy += (-1.6 - this.vy) * Math.min(1, 3 * dt); // the undead sink and walk the bottom
    } else if (inWater) {
      this.vy += (1.6 - this.vy) * Math.min(1, 3 * dt); // float up
    } else {
      this.vy -= 26 * dt;
      this.vy = Math.max(this.vy, -40);
    }
    this.inWater = inWater;

    // a fast fall on a slow frame is cut into steps, so it can't skip a thin floor
    const steps = Math.max(1, Math.ceil((Math.abs(this.vy) * dt) / 0.4));
    const r = { onGround: false, hitWall: false };
    for (let i = 0; i < steps; i++) {
      const s = moveEntity(this.world, this, dt / steps);
      r.onGround = s.onGround; r.hitWall ||= s.hitWall;
    }
    this.onGround = r.onGround;
    // a long frame can carry a fall through the water onto the bottom
    const wetNow = inWater || entityInWater(this.world, this);
    this.lastHitWall = r.hitWall;
    // pressing against a wall it can't hop for a while: sidestep for a moment
    if (r.hitWall && this.moving && !this.flier && !this.swimmer && !this.climber) {
      this.stuckTime = (this.stuckTime ?? 0) + dt;
      if (this.stuckTime > 0.6) {
        this.stuckTime = 0;
        this.detour = { yaw: this.yaw + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2, t: 0.7 + Math.random() * 0.6 };
      }
    } else {
      this.stuckTime = 0;
    }
    // hop up single blocks when walking into a wall; climbers (spiders) scale it
    if (r.hitWall && this.moving && !inWater && !this.flier && !this.swimmer) {
      if (this.climber) this.vy = Math.max(this.vy, this.climbSpeed ?? 3.6);
      // 8 clears a full block at any frame rate (7.2 peaked just short of it)
      // and still not a 1.5-high fence
      else if (this.onGround) this.vy = 8;
    }
    // land mobs paddling into a bank climb out instead of bobbing there forever
    if (r.hitWall && this.moving && inWater && !this.swimmer && !this.flier) this.vy = Math.max(this.vy, 8);
    // swimmers and fliers bumping a wall turn away
    if (r.hitWall && (this.swimmer || this.flier) && !this.detour) {
      this.targetYaw = this.yaw + Math.PI * (0.5 + Math.random());
      if (this.flier) this.targetVy = 2;
    }

    // fall damage (fliers and swimmers don't take it)
    if (this.flier || this.swimmer) {
      this.fallStart = undefined;
    } else if (!this.onGround && this.vy < 0 && !wetNow) {
      this.fallStart = Math.max(this.fallStart ?? this.y, this.y);
    } else if ((this.onGround || wetNow) && this.fallStart !== undefined) {
      const d = this.fallStart - this.y;
      const safe = this.safeFall ?? 4;   // goats shrug off long drops
      // whoever's riding comes down with it (first: a fall that kills the
      // horse throws its rider off, and they'd have walked away unhurt)
      const rider = this.rider;
      if (!wetNow && rider && d > 5 && rider.mode !== GAMEMODE_CREATIVE) rider.damage(Math.floor(d - 4), 'fall');
      if (!wetNow && d > safe) this.damage(Math.floor(d - safe + 1), null);
      this.fallStart = undefined;
    }

    // animate
    if (this.moving) this.walkPhase += dt * speed * 3.2;
    this.animate(dt);

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;

    if (this.leash) this.leashTick(dt);

    // brightness from voxel light + hurt flash
    const light = this.world.lightAt(this.x, this.y + 0.5, this.z);
    for (const { mat, base, glow } of this.materials) {
      mat.color.copy(base).multiplyScalar(glow ? Math.max(light, glow) : light);
      if (this.flashTime > 0) mat.color.lerp(HURT_RED, 0.55);
    }
  }

  // ---------- shared AI helpers ----------

  // distance from this mob's middle to the player's middle, in 3D
  dist3(p) {
    return Math.hypot(p.x - this.x, p.y + 0.9 - (this.y + this.h / 2), p.z - this.z);
  }

  // line of sight from the mob's eyes to the player's chest (solid blocks block it)
  canSee(player, eyeY = this.h * 0.85) {
    const ox = this.x, oy = this.y + eyeY, oz = this.z;
    const dx = player.x - ox, dy = player.y + 1.2 - oy, dz = player.z - oz;
    const steps = Math.ceil(Math.hypot(dx, dy, dz) / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isSolid(this.world.getBlockW(Math.floor(ox + dx * t), Math.floor(oy + dy * t), Math.floor(oz + dz * t)))) return false;
    }
    return true;
  }

  // Hostile awareness: a survival player within range that the mob can see,
  // or saw in the last few seconds (so it follows you round a corner).
  senses(player, range, dt) {
    if (player.dead || player.mode === GAMEMODE_CREATIVE || this.dist3(player) > range) {
      this.memory = 0;
      return false;
    }
    this.losTimer = (this.losTimer ?? 0) - dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.25;
      if (this.canSee(player)) this.memory = 4;
    }
    this.memory = Math.max(0, (this.memory ?? 0) - dt);
    return this.memory > 0;
  }

  // stop chasing and go back to wandering
  loseTarget() {
    if (this.state !== 'chase') return;
    this.state = 'idle';
    this.stateTime = 1;
    this.moving = false;
  }

  // a melee hit with knockback away from the mob
  meleeHit(player, dmg, cause) {
    if (player.hurtCooldown > 0 || player.dead) return false;
    if (!this.canSee(player)) return false;   // no hitting through block corners
    player.damage(dmg, cause);
    const dx = player.x - this.x, dz = player.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    player.vx += (dx / d) * 5;
    player.vz += (dz / d) * 5;
    player.vy = Math.max(player.vy, 4);
    return true;
  }

  // detours around walls, and wanderers turn back at cliff edges
  avoidHazards(dt) {
    if (this.detour) {
      this.targetYaw = this.detour.yaw;
      this.moving = true;
      this.detour.t -= dt;
      if (this.detour.t <= 0) this.detour = null;
      return;
    }
    // a pet following you stops at the edge (lava, a long drop) and catches
    // up once you're clear, instead of walking in after you
    const pet = this.tamed && this.state === 'chase';
    if ((this.state !== 'wander' && !pet) || !this.moving || !this.onGround || this.flier || this.swimmer) return;
    const ax = Math.floor(this.x - Math.sin(this.yaw) * (this.w / 2 + 0.6));
    const az = Math.floor(this.z - Math.cos(this.yaw) * (this.w / 2 + 0.6));
    const y = Math.floor(this.y);
    let drop = 0;
    let lava = this.world.getBlockW(ax, y, az) === B.LAVA;
    // look as far down as the mob can safely fall (goats, horses and sloths further)
    const safe = this.safeFall ?? 4;
    while (drop < safe && !isSolid(this.world.getBlockW(ax, y - 1 - drop, az))) {
      if (this.world.getBlockW(ax, y - 1 - drop, az) === B.LAVA) lava = true;
      drop++;
    }
    if (pet) {
      if (drop >= safe || lava) { this.moving = false; this.vx = this.vz = 0; }
      return;
    }
    if (drop >= safe || lava || (!this.likesWater && this.world.getBlockW(ax, y - 1, az) === B.WATER)) {
      this.targetYaw = this.yaw + Math.PI;
      this.yaw += Math.PI;   // turn on the spot rather than step off
      this.vx = this.vz = 0;
    }
  }

  // occasional groans / rattles / hisses, quieter with distance
  ambient(dt, player) {
    if (!this.ambientSound) return;
    this.ambientTimer = (this.ambientTimer ?? 3 + Math.random() * 8) - dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = this.hostile ? 7 + Math.random() * 10 : 14 + Math.random() * 20;
    const d = this.dist3(player);
    if (d < 20) this.fx?.sound(this.ambientSound, { pos: this, pitch: this.baby ? 1.4 : 1 });   // young ones squeak
  }

  animateDeath(dt) {
    this.dying -= dt;
    const k = Math.min(1, 1 - this.dying / DEATH_TIME);
    this.group.rotation.z = Math.min(1, k * 2) * Math.PI / 2;   // tip over
    for (const { mat, base } of this.materials) mat.color.copy(base).lerp(HURT_RED, 0.5).multiplyScalar((1 - k * 0.6) * this.world.lightAt(this.x, this.y + 0.5, this.z));
    if (this.dying <= 0) this.kill();
  }

  // undead burn in direct daylight; returns true if this killed the mob
  burnInDaylight(dt) {
    const day = this.world.materials.uniforms.uDay.value;
    const sky = this.world.getSkyW(Math.floor(this.x), Math.floor(this.y + this.h - 0.3), Math.floor(this.z));
    // only full, open sky (15) burns: light spilling under an overhang or a
    // tree's edge reads 14
    if (day <= 0.8 || sky < 15 || this.inWater || this.fireproofSun || this.world.raining) return false;   // (not in the rain)
    this.fireTime = Math.max(this.fireTime ?? 0, 2);   // the burning tick does the damage
    return this.dead;
  }

  // On fire (sun, lava, campfires): 1 damage a second (2 for undead in the
  // sun), flames on the model; water puts it out.
  updateFire(dt) {
    if (this.fireproof) { this.fireTime = 0; if (this.flames?.visible) this.showFlames(false); return; }   // (the Scorchlands' fliers)
    const inLava = entityInBlock(this.world, this, B.LAVA);
    if (inLava) {
      this.fireTime = Math.max(this.fireTime ?? 0, 8);
      this.lavaTimer = (this.lavaTimer ?? 0) - dt;
      if (this.lavaTimer <= 0) { this.lavaTimer = 0.5; this.hurtCooldown = 0; this.damage(4, null); }
    }
    if (entityInBlock(this.world, this, B.FIRE)) this.fireTime = Math.max(this.fireTime ?? 0, 4);
    if (this.inWater) this.fireTime = 0;
    const burning = this.fireTime > 0;
    if (burning) {
      this.fireTime -= dt;
      this.fireTick = (this.fireTick ?? 1) - dt;
      if (this.fireTick <= 0) {
        this.fireTick = 1;
        this.hurtCooldown = 0;
        this.damage(this.undead ? 2 : 1, null);
      }
    }
    if (burning !== !!this.flames?.visible) this.showFlames(burning);
    if (burning && this.flames) this.flames.material.rotation = Math.sin(this.age * 20) * 0.08;
  }

  showFlames(on) {
    if (!this.flames) {
      if (!on) return;
      flameTex ??= makeFlameTexture();
      this.flames = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, fog: false }));
      // w and h are already the (baby) size; undo the model's own scale
      const k = this.group.scale.x || 1;
      this.flames.scale.set(this.w * 1.6 / k, this.h * 1.2 / k, 1);
      this.flames.position.y = this.h * 0.55 / k;
      this.group.add(this.flames);
    }
    this.flames.visible = on;
  }

  // Burning in the sun with nothing to chase: head for the nearest shade
  // (a spot whose sky light is blocked: under trees, overhangs, caves).
  seekShade(dt) {
    if (!(this.fireTime > 0) || this.fireproofSun) return false;
    // keep heading for the spot picked until it's reached (or turns out sunny)
    this.shadeTimer = (this.shadeTimer ?? 0) - dt;
    if (this.shade && this.shadeTimer <= 0) {
      this.shadeTimer = 2;
      if (this.world.getSkyW(Math.floor(this.shade.x), this.shade.y + 1, Math.floor(this.shade.z)) >= 13) this.shade = null;
    }
    if (!this.shade) {
      this.shadeTimer = 2;
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(this.x + (Math.random() - 0.5) * 16), z = Math.floor(this.z + (Math.random() - 0.5) * 16);
        for (let y = Math.floor(this.y) + 2; y >= Math.floor(this.y) - 2; y--) {
          if (this.world.getBlockW(x, y, z) !== B.AIR || !isSolid(this.world.getBlockW(x, y - 1, z))) continue;
          if (this.world.getSkyW(x, y + 1, z) < 13) { this.shade = { x: x + 0.5, y, z: z + 0.5 }; break; }
        }
        if (this.shade) break;
      }
    }
    if (!this.shade) return false;
    this.targetYaw = Math.atan2(-(this.shade.x - this.x), -(this.shade.z - this.z));
    this.moving = Math.hypot(this.shade.x - this.x, this.shade.z - this.z) > 0.6;
    this.state = 'wander';
    return true;
  }

  // face the player and walk toward (dir 1) or away from (dir -1) them
  steer(player, dir = 1) {
    const dx = player.x - this.x, dz = player.z - this.z;
    this.targetYaw = Math.atan2(-dx, -dz) + (dir < 0 ? Math.PI : 0);
  }

  // default wander AI; subclasses extend
  think(dt, player, playerDist) {
    this.stateTime -= dt;
    this.hurry = false;
    this.leashSpeed = 0;
    if (this.leash && this.leashPull()) return;
    // hold out a food it likes and it follows you (how you bring a herd home)
    if (this.breedItem && !this.tamed && this.state !== 'flee' && this.tempted(player, playerDist)) return;
    // a farm baby trots after a grown-up of its kind (ducklings in a line)
    if (this.baby && this.breedItem && this.state !== 'flee' && this.followParent(dt)) return;
    if (this.state === 'flee') {
      this.moving = true;
      if (this.stateTime <= 0) { this.state = 'idle'; this.stateTime = 1 + Math.random() * 2; }
    } else if (this.stateTime <= 0) {
      if (this.state === 'idle') {
        this.state = 'wander';
        this.stateTime = 1.5 + Math.random() * 3;
        this.targetYaw = Math.random() * Math.PI * 2;
        this.moving = true;
      } else {
        this.state = 'idle';
        this.stateTime = 1 + Math.random() * 4;
        this.moving = false;
      }
    }
  }

  // ---- leads ----

  // where the other end of the lead is
  leashEnd() {
    const L = this.leash;
    if (L.player) return { x: L.player.x, y: L.player.y + 1.0, z: L.player.z };
    return { x: L.knot.x + 0.5, y: L.knot.y + 0.75, z: L.knot.z + 0.5 };
  }

  // on a lead held by a player, or tied to a fence post
  leashTo(holder) {
    this.leash = holder;
    this.persistent = true;
    if (!this.rope) { this.rope = new THREE.Mesh(ROPE_GEO, ROPE_MAT.clone()); this.scene.add(this.rope); }
  }

  // let go; `drop` leaves the lead lying where it was
  unleash(drop = false) {
    if (!this.leash) return;
    if (drop) this.dropFn?.([{ id: I.LEAD, count: 1 }]);
    this.leash = null;
    if (this.rope) { this.scene.remove(this.rope); this.rope.material.dispose(); this.rope = null; }
  }

  // walk toward the holder once the lead goes taut
  leashPull() {
    const e = this.leashEnd();
    const dx = e.x - this.x, dz = e.z - this.z, d = Math.hypot(dx, dz);
    if (d < LEASH_SLACK) return false;
    this.state = 'leash';
    this.targetYaw = this.yaw = Math.atan2(-dx, -dz);   // (a lead turns you round on the spot)
    this.moving = true;
    // the tauter the lead, the faster it's pulled along: it keeps up with a sprint
    this.leashSpeed = Math.max(this.speed, Math.min(10, (d - LEASH_SLACK) * 2));
    return true;
  }

  leashTick(dt) {
    const L = this.leash;
    // the post's gone, the holder's gone, or it's stretched too far: snap
    if (L.knot && this.world.isLoaded(L.knot.x, L.knot.z) && !FENCE_POSTS.has(this.world.getBlockW(L.knot.x, L.knot.y, L.knot.z))) { this.unleash(true); return; }
    if (L.player?.dead) { this.unleash(true); return; }
    const e = this.leashEnd();
    const dx = e.x - this.x, dy = e.y - (this.y + this.h * 0.7), dz = e.z - this.z, d = Math.hypot(dx, dy, dz);
    if (d > LEASH_SNAP) { this.unleash(true); this.fx?.sound('shear', { pos: this, vol: 0.5 }); return; }
    // draw the rope from the animal's neck to the holder
    const sx = this.x - Math.sin(this.yaw) * this.w * 0.45, sy = this.y + this.h * 0.7, sz = this.z - Math.cos(this.yaw) * this.w * 0.45;
    this.rope.position.set((sx + e.x) / 2, (sy + e.y) / 2, (sz + e.z) / 2);
    this.rope.scale.set(1, 1, Math.max(0.01, Math.hypot(e.x - sx, e.y - sy, e.z - sz)));
    this.rope.lookAt(e.x, e.y, e.z);
    this.rope.material.color.copy(ROPE_MAT.color).multiplyScalar(this.world.lightAt(this.rope.position.x, this.rope.position.y, this.rope.position.z));
  }

  tempted(player, playerDist) {
    const held = player.dead || playerDist > 10 ? null : player.heldStack();
    if (!held || !this.likes(held.id) || Math.abs(player.y - this.y) > 4) {
      if (this.state === 'tempt') { this.state = 'idle'; this.stateTime = 1; this.moving = false; }
      return false;
    }
    if (this.state !== 'tempt') this.temptSince = this.age;
    this.state = 'tempt';
    this.steer(player, 1);
    this.moving = playerDist > 2.4;   // close enough to be fed: wait, looking up at you
    // following you for a while: you're bringing it home, so it stays (saved)
    if (this.age - this.temptSince > 5) this.persistent = true;
    return true;
  }

  followParent(dt) {
    this.parentTimer = (this.parentTimer ?? 0) - dt;
    if (this.parentTimer <= 0) {
      this.parentTimer = 2;
      let best = null, bestD = 14;
      for (const m of this.fx?.mobs() ?? []) {
        if (m.kind !== this.kind || m.baby || m.dead || m.dying !== undefined) continue;
        const d = Math.hypot(m.x - this.x, m.z - this.z);
        if (d < bestD) { best = m; bestD = d; }
      }
      this.parent = best;
    }
    const m = this.parent;
    if (!m || m.dead) return false;
    const d = Math.hypot(m.x - this.x, m.z - this.z);
    // set off once it's 5 blocks behind, stop when it's caught up
    if (this.state === 'follow' ? d < 2.2 : d < 5) {
      if (this.state === 'follow') { this.state = 'idle'; this.stateTime = 1 + Math.random() * 2; this.moving = false; }
      return false;
    }
    this.state = 'follow';
    this.targetYaw = Math.atan2(-(m.x - this.x), -(m.z - this.z));
    this.moving = true;
    return true;
  }

  animate(dt) {
    const swing = Math.sin(this.walkPhase) * (this.moving ? 0.6 : 0);
    if (this.legs) {
      this.legs[0].rotation.x = swing;
      this.legs[1].rotation.x = -swing;
      if (this.legs[2]) this.legs[2].rotation.x = -swing;
      if (this.legs[3]) this.legs[3].rotation.x = swing;
    }
  }

  damage(amount, source) {
    if (this.dead || this.dying !== undefined || this.hurtCooldown > 0) return false;
    this.hurtCooldown = 0.45;
    this.health -= amount;
    this.flashTime = 0.25;
    if (source) {
      // knockback away from the attacker
      const dx = this.x - source.x, dz = this.z - source.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vx += (dx / d) * 6;
      this.vz += (dz / d) * 6;
      this.vy = Math.max(this.vy, 4.5);
      // passive mobs run away
      if (!this.hostile) {
        this.state = 'flee';
        this.stateTime = 4;
        this.targetYaw = Math.atan2(-dx, -dz) + Math.PI;
        this.moving = true;
      }
    }
    if (this.health <= 0) {
      this.die();
      return true;
    }
    // animals cry out in their own voice (pitched up: hurt), the rest grunt
    if (this.hurtSound) this.fx?.sound(this.hurtSound, { vol: 0.9, pos: this, pitch: this.baby ? 1.5 : 1.2 });
    else this.fx?.sound('mobhurt', { vol: 0.8, pos: this });
    return true;
  }

  die() {
    if (this.dying !== undefined) return;
    if (!this.baby && !this.noLoot) {   // (summoned minions drop nothing)
      // an animal that dies on fire drops its meat cooked
      if (this.fireTime > 0 && this.dropFn) {
        const drop = this.dropFn;
        this.dropFn = (items) => drop(items.map((s) => (cookedId(s.id) ? { ...s, id: cookedId(s.id) } : s)));
        this.onDeath?.();
        this.dropFn = drop;
      } else this.onDeath?.();
    }
    this.unleash(true);
    this.fx?.sound('mobdeath', { pos: this });
    // tip over briefly before vanishing; no longer a threat or a target
    this.dying = DEATH_TIME;
    this.hostile = false;
    this.moving = false;
  }

  kill() {
    this.dead = true;
    this.scene.remove(this.group);
    if (this.rope) { this.scene.remove(this.rope); this.rope.material.dispose(); this.rope = null; }
    for (const { mat } of this.materials) mat.dispose();
    // part boxes are shared; anything else built for this mob goes; flames have their own material
    this.group.traverse((o) => { if (o.geometry && !SHARED.has(o.geometry) && !o.isSprite) o.geometry.dispose(); });
    this.flames?.material.dispose();
  }

  // ray vs this mob's AABB; returns distance or null
  rayHit(origin, dir, maxDist) {
    if (this.dying !== undefined) return null;
    const hw = this.w / 2;
    const min = { x: this.x - hw, y: this.y, z: this.z - hw };
    const max = { x: this.x + hw, y: this.y + this.h, z: this.z + hw };
    let tmin = 0, tmax = maxDist;
    for (const axis of ['x', 'y', 'z']) {
      const o = origin[axis], d = dir[axis];
      if (Math.abs(d) < 1e-9) {
        if (o < min[axis] || o > max[axis]) return null;
      } else {
        let t1 = (min[axis] - o) / d;
        let t2 = (max[axis] - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }
}
