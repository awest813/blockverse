// Mob base class: box-model creatures with simple AI, physics and combat.
// Models are assembled from shaded colored boxes (all original designs).

import * as THREE from 'three';
import { moveEntity, entityInBlock } from '../core/physics.js';
import { B, isSolid } from '../blocks/blocks.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';

const DEATH_TIME = 0.6;   // seconds of tipping over before a dead mob disappears

// BoxGeometry with per-face brightness baked into vertex colors, so flat
// MeshBasicMaterial still reads as 3D.
const FACE_SHADE = { px: 0.72, nx: 0.72, py: 1.0, ny: 0.45, pz: 0.86, nz: 0.6 };
function shadedBox(w, h, d) {
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

  part(w, h, d, color, x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color, vertexColors: true });
    const m = new THREE.Mesh(shadedBox(w, h, d), mat);
    m.position.set(x, y, z);
    this.materials.push({ mat, base: new THREE.Color(color) });
    this.group.add(m);
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
      if (!this.tamed) { this.kill(); return; }
    }
    // pets left far behind catch up by appearing next to the player
    // (only once the player is on the ground, so pets aren't dropped from the sky)
    if (this.tamed && !this.sitting && playerDistSq > 24 * 24 && !player.dead && player.onGround && !player.flying) {
      this.x = player.x + (Math.random() - 0.5) * 2;
      this.y = player.y + 0.1;
      this.z = player.z + (Math.random() - 0.5) * 2;
      this.vx = this.vy = this.vz = 0;
      this.fallStart = undefined;
    }
    // freeze in unloaded chunks
    if (!this.world.isLoaded(Math.floor(this.x), Math.floor(this.z))) return;

    this.think(dt, player, Math.sqrt(playerDistSq));
    if (this.dead || this.dying !== undefined) return;
    this.avoidHazards(dt);
    this.ambient(dt, player);

    // steering: turn toward targetYaw, walk forward when moving
    let dyaw = ((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));

    const inWater = entityInBlock(this.world, this, B.WATER);
    const speed = this.state === 'flee' || this.state === 'chase' ? this.fleeSpeed : this.speed;
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
    } else if (inWater) {
      this.vy += (1.6 - this.vy) * Math.min(1, 3 * dt); // float up
    } else {
      this.vy -= 26 * dt;
      this.vy = Math.max(this.vy, -40);
    }
    this.inWater = inWater;

    const before = this.y;
    const r = moveEntity(this.world, this, dt);
    this.onGround = r.onGround;
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
      if (this.climber) this.vy = Math.max(this.vy, 3.6);
      else if (this.onGround) this.vy = 7.2;
    }

    // fall damage (fliers and swimmers don't take it)
    if (this.flier || this.swimmer) {
      this.fallStart = undefined;
    } else if (!this.onGround && this.vy < 0 && !inWater) {
      this.fallStart = Math.max(this.fallStart ?? this.y, this.y);
    } else if ((this.onGround || inWater) && this.fallStart !== undefined) {
      const d = this.fallStart - this.y;
      if (!inWater && d > 4) this.damage(Math.floor(d - 3), null);
      this.fallStart = undefined;
    }

    // animate
    if (this.moving) this.walkPhase += dt * speed * 3.2;
    this.animate(dt);

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;

    // brightness from voxel light + hurt flash
    const sky = this.world.getSkyW(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    const bl = this.world.getBlockLightW(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    const day = this.world.materials.uniforms.uDay.value;
    const light = Math.max(0.12, Math.max((sky / 15) * day, bl / 15));
    for (const { mat, base } of this.materials) {
      mat.color.copy(base).multiplyScalar(light);
      if (this.flashTime > 0) mat.color.lerp(new THREE.Color(0xff3333), 0.55);
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
    if (this.state !== 'wander' || !this.moving || !this.onGround || this.flier || this.swimmer) return;
    const ax = Math.floor(this.x - Math.sin(this.yaw) * (this.w / 2 + 0.6));
    const az = Math.floor(this.z - Math.cos(this.yaw) * (this.w / 2 + 0.6));
    const y = Math.floor(this.y);
    let drop = 0;
    while (drop < 4 && !isSolid(this.world.getBlockW(ax, y - 1 - drop, az))) drop++;
    if (drop >= 4 || this.world.getBlockW(ax, y - 1, az) === B.WATER) {
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
    this.ambientTimer = 7 + Math.random() * 10;
    const d = this.dist3(player);
    if (d < 16) this.fx?.sound(this.ambientSound, { vol: 1 - d / 16 });
  }

  animateDeath(dt) {
    this.dying -= dt;
    const k = Math.min(1, 1 - this.dying / DEATH_TIME);
    this.group.rotation.z = Math.min(1, k * 2) * Math.PI / 2;   // tip over
    for (const { mat, base } of this.materials) mat.color.copy(base).lerp(new THREE.Color(0xff3333), 0.5).multiplyScalar(1 - k * 0.6);
    if (this.dying <= 0) this.kill();
  }

  // undead burn in direct daylight; returns true if this killed the mob
  burnInDaylight(dt) {
    const day = this.world.materials.uniforms.uDay.value;
    const sky = this.world.getSkyW(Math.floor(this.x), Math.floor(this.y + this.h - 0.3), Math.floor(this.z));
    if (day <= 0.8 || sky < 14) return false;
    this.burnTimer = (this.burnTimer ?? 0) + dt;
    this.flashTime = 0.1;
    if (this.burnTimer > 1) {
      this.burnTimer = 0;
      this.hurtCooldown = 0;
      this.damage(2, null);
    }
    return this.dead;
  }

  // face the player and walk toward (dir 1) or away from (dir -1) them
  steer(player, dir = 1) {
    const dx = player.x - this.x, dz = player.z - this.z;
    this.targetYaw = Math.atan2(-dx, -dz) + (dir < 0 ? Math.PI : 0);
  }

  // default wander AI; subclasses extend
  think(dt, player, playerDist) {
    this.stateTime -= dt;
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
    this.fx?.sound('mobhurt', { vol: 0.8 });
    return true;
  }

  die() {
    if (this.dying !== undefined) return;
    this.onDeath?.();
    this.fx?.sound('mobdeath');
    // tip over briefly before vanishing; no longer a threat or a target
    this.dying = DEATH_TIME;
    this.hostile = false;
    this.moving = false;
  }

  kill() {
    this.dead = true;
    this.scene.remove(this.group);
    for (const { mat } of this.materials) mat.dispose();
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
