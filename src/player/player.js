// Player: first-person movement, physics, survival stats, inventory.

import {
  PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_EYE, GRAVITY, JUMP_SPEED,
  WALK_SPEED, SPRINT_SPEED, SNEAK_SPEED, FLY_SPEED, SWIM_SPEED,
  GAMEMODE_SURVIVAL, GAMEMODE_CREATIVE, CHUNK_Y,
} from '../core/constants.js';
import { moveEntity, entityInBlock, entityInWater, pointInWater } from '../core/physics.js';
import { B } from '../blocks/blocks.js';
import { itemInfo, makeStack, mergeStack, maxStack } from '../items/items.js';

// damage from monsters scales with difficulty (Game sets mobDamageScale)
const MOB_DAMAGE = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'spider', 'dog']);   // (explosions hurt at any difficulty)
const UNARMORED_DAMAGE = new Set(['fall', 'starve', 'drown', 'void', 'command', 'fire']);

export class Player {
  constructor(world) {
    this.world = world;
    this.x = 8; this.y = 80; this.z = 8;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = PLAYER_WIDTH;
    this.h = PLAYER_HEIGHT;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.inWater = false;
    this.headInWater = false;
    this.mode = GAMEMODE_SURVIVAL;

    // survival stats
    this.health = 20;
    this.maxHealth = 20;
    this.hunger = 20;
    this.saturation = 5;
    this.air = 20;
    this.dead = false;
    this.fallStart = null;
    this.hurtCooldown = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.airTimer = 0;
    this.fireTime = 0;     // seconds left burning
    this.exhaustion = 0;

    // inventory: 36 slots (0-8 hotbar), stacks are {id, count, dur?} | null
    this.inventory = new Array(36).fill(null);
    this.selected = 0;
    this.armor = [null, null, null, null];   // helmet, chestplate, leggings, boots

    this.spawnPoint = { x: 8, y: 80, z: 8 };   // where respawn() puts you (bed or world spawn)
    this.worldSpawn = { ...this.spawnPoint };
    this.bedPos = null;

    // double-tap space tracking for fly toggle
    this._lastSpace = -1;
    this._lastForward = -1;
    this.sprintLatch = false;
    this.invertY = false;

    this.events = new EventTarget();
  }

  get eyeY() {
    return this.y + (this.sneaking ? PLAYER_EYE - 0.15 : PLAYER_EYE);
  }

  heldStack() {
    return this.inventory[this.selected];
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp,
    };
  }

  update(input, dt, paused) {
    if (this.dead) return;
    // Freeze physics until the chunk under the player has real blocks —
    // unloaded chunks read as solid and would eject the player skyward.
    if (!this.world.isLoaded(Math.floor(this.x), Math.floor(this.z))) return;
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);

    // look
    if (!paused) {
      const sens = 0.0023 * (this.sensitivity ?? 1);
      this.yaw -= input.dx * sens;
      this.pitch -= input.dy * sens * (this.invertY ? -1 : 1);
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    }

    this.inWater = entityInWater(this.world, this);
    this.inLava = entityInBlock(this.world, this, B.LAVA);
    this.onLadder = entityInBlock(this.world, this, B.LADDER);
    this.headInWater = pointInWater(this.world, this.x, this.eyeY, this.z);

    // movement intent
    let fwd = 0, strafe = 0;
    if (!paused) {
      if (input.action('forward')) fwd += 1;
      if (input.action('back')) fwd -= 1;
      if (input.action('right')) strafe += 1;
      if (input.action('left')) strafe -= 1;
      // analog stick / touch joystick
      fwd = Math.max(-1, Math.min(1, fwd + input.move.y));
      strafe = Math.max(-1, Math.min(1, strafe + input.move.x));
    }
    this.sneaking = !paused && input.action('sneak') && !this.flying;
    // sprint lasts while moving forward once started (sprint key or double-tap forward)
    if (fwd <= 0 || this.sneaking || this.hunger <= 6) this.sprintLatch = false;
    else if (!paused && input.action('sprint')) this.sprintLatch = true;
    this.sprinting = !paused && this.sprintLatch;

    const creative = this.mode === GAMEMODE_CREATIVE;
    if (!creative) this.flying = false;

    // sprinting underwater swims (fast, in the look direction); dolphins nearby
    // lend a burst of speed (graceTime)
    this.graceTime = Math.max(0, (this.graceTime ?? 0) - dt);
    const grace = this.graceTime > 0 ? 1.6 : 1;
    this.swimming = !this.flying && this.inWater && this.headInWater && this.sprinting && fwd > 0;
    let speed = this.flying ? FLY_SPEED :
      this.swimming ? SWIM_SPEED * 2 * grace :
      this.inLava ? SWIM_SPEED * 0.45 :
      this.inWater ? SWIM_SPEED * grace :
      this.sneaking ? SNEAK_SPEED :
      this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    // desired horizontal velocity in world space
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let dvx = (-sin * fwd + cos * strafe);
    let dvz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(dvx, dvz);
    // keys give full speed; a half-tilted stick walks at half speed
    const throttle = Math.min(1, Math.hypot(fwd, strafe));
    if (len > 0) { dvx = (dvx / len) * speed * throttle; dvz = (dvz / len) * speed * throttle; }
    if (this.swimming) { const c = Math.cos(this.pitch); dvx *= c; dvz *= c; }
    if (this.usingItem) { dvx *= 0.35; dvz *= 0.35; }   // eating slows you down

    // acceleration: snappy on ground, floatier in air/water
    const accel = this.flying ? 24 : this.onGround ? 40 : this.inWater ? 12 : 8;
    this.vx += (dvx - this.vx) * Math.min(1, accel * dt);
    this.vz += (dvz - this.vz) * Math.min(1, accel * dt);

    if (this.flying) {
      let vy = 0;
      if (!paused && input.action('jump')) vy += FLY_SPEED;
      if (!paused && input.action('sneak')) vy -= FLY_SPEED;
      this.vy += (vy - this.vy) * Math.min(1, 24 * dt);
    } else if (this.swimming) {
      // dive and climb with the camera pitch
      const want = Math.sin(this.pitch) * speed;
      this.vy += (want - this.vy) * Math.min(1, 10 * dt);
      if (!paused && input.action('jump')) this.vy = Math.min(this.vy + 24 * dt, 3.2);
      this.addExhaustion(0.6 * dt);
    } else if (this.inLava) {
      // thick and slow: sink gently, struggle up
      this.vy -= GRAVITY * 0.15 * dt;
      this.vy = Math.max(this.vy, -1.5);
      if (!paused && input.action('jump')) this.vy = Math.min(this.vy + 14 * dt, 1.8);
    } else if (this.onLadder) {
      // climb by pushing into the ladder (or holding jump); sneak to hold on
      const climb = !paused && (input.action('jump') || (fwd > 0 && this.hitWall));
      if (climb) this.vy = 2.4;
      else if (!paused && this.sneaking) this.vy = 0;
      else this.vy = Math.max(this.vy - GRAVITY * dt, -2.2);
    } else if (this.inWater) {
      this.vy -= GRAVITY * 0.25 * dt;
      this.vy = Math.max(this.vy, this.sneaking ? -5 : -3.5);
      if (!paused && this.sneaking) this.vy -= 6 * dt;   // dive
      if (!paused && input.action('jump')) {
        this.vy = Math.min(this.vy + 24 * dt, 3.2);
        // pushing against a ledge at the surface: hop out
        if (this.hitWall && !this.headInWater) this.vy = Math.max(this.vy, 5.2);
      }
    } else {
      this.vy -= GRAVITY * dt;
      this.vy = Math.max(this.vy, -60);
      if (!paused && input.action('jump') && this.onGround) {
        this.vy = JUMP_SPEED;
        this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      }
    }

    // integrate with collision (substep for high speeds)
    const steps = Math.max(1, Math.ceil((Math.hypot(this.vx, this.vy, this.vz) * dt) / 0.4));
    let onGround = false, hitWall = false;
    for (let i = 0; i < steps; i++) {
      const r = moveEntity(this.world, this, dt / steps, this.sneaking && !this.inWater);
      onGround = onGround || r.onGround;
      hitWall = hitWall || r.hitWall;
    }
    this.hitWall = hitWall;
    this.onGround = onGround;

    // fall damage tracking
    if (!creative && !this.flying) {
      if (this.onLadder || this.inLava) this.fallStart = null;   // ladders and lava break a fall
      else if (!this.onGround && !this.inWater && this.vy < 0) {
        if (this.fallStart === null) this.fallStart = this.y + Math.abs(this.vy * dt); // approx
        // fallStart records highest point; keep max
        this.fallStart = Math.max(this.fallStart, this.y - this.vy * dt);
      }
      if ((this.onGround || this.inWater) && this.fallStart !== null) {
        const fallDist = this.fallStart - this.y;
        if (!this.inWater && fallDist > 3.2) {
          this.damage(Math.floor(fallDist - 3), 'fall');
        }
        this.fallStart = null;
      }
    } else {
      this.fallStart = null;
    }

    if (this.y < -12) this.damage(4, 'void');

    if (!creative) this.updateSurvival(dt);
    else this.fireTime = 0;   // creative players don't burn (and the overlay goes out)

    // sprint exhaustion
    if (this.sprinting && !this.inWater) this.addExhaustion(0.1 * dt * 7);   // swimming has its own cost
  }

  tapSpace(now) {
    if (this.mode !== GAMEMODE_CREATIVE) return;
    if (now - this._lastSpace < 300) {
      this.flying = !this.flying;
      this.vy = 0;
      this._lastSpace = -1;
    } else {
      this._lastSpace = now;
    }
  }

  // double-tap forward starts sprinting (avoids Ctrl+W closing the browser tab)
  tapForward(now) {
    if (now - this._lastForward < 300 && this.hunger > 6) this.sprintLatch = true;
    this._lastForward = now;
  }

  updateSurvival(dt) {
    // fire: lava sets you alight; water puts you out
    if (this.inLava) {
      this.fireTime = Math.max(this.fireTime ?? 0, 8);
      this.lavaTimer = (this.lavaTimer ?? 0) - dt;
      if (this.lavaTimer <= 0) { this.lavaTimer = 0.5; this.damage(4, 'lava'); }
    }
    if (entityInBlock(this.world, this, B.FIRE)) this.fireTime = Math.max(this.fireTime, 4);
    if (this.inWater && this.fireTime > 0) { this.fireTime = 0; this.events.dispatchEvent(new CustomEvent('extinguish')); }
    if (this.fireTime > 0) {
      this.fireTime -= dt;
      this.burnTimer = (this.burnTimer ?? 0) - dt;
      if (this.burnTimer <= 0) { this.burnTimer = 1; this.damage(1, 'fire'); }
    }

    // exhaustion -> saturation -> hunger
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    // regen / starve
    // peaceful: health and hunger refill on their own
    if (this.difficulty === 0) {
      this.hunger = Math.min(20, this.hunger + dt * 0.5);
      if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + dt * 0.5);
    }
    if (this.hunger >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= 2.5) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.addExhaustion(1.5);
      }
    } else if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 3) {
        this.starveTimer = 0;
        // easy stops at 5 hearts, normal at half a heart; hard starves you outright
        const floor = this.difficulty === 1 ? 10 : this.difficulty === 3 ? 0 : 1;
        if (this.health > floor) this.damage(1, 'starve');
      }
    } else {
      this.regenTimer = 0;
    }

    // drowning
    if (this.headInWater) {
      this.airTimer += dt;
      if (this.airTimer >= 0.75) {
        this.airTimer = 0;
        if (this.air > 0) this.air--;
        else this.damage(2, 'drown');
      }
    } else {
      this.air = Math.min(20, this.air + dt * 8);
      this.airTimer = 0;
    }
  }

  addExhaustion(v) {
    if (this.mode === GAMEMODE_SURVIVAL) this.exhaustion += v;
  }

  armorPoints() {
    return this.armor.reduce((n, s) => n + (s ? itemInfo(s.id)?.armor?.points ?? 0 : 0), 0);
  }

  damage(amount, cause = 'generic') {
    if (this.dead || this.mode === GAMEMODE_CREATIVE) return;
    if (this.hurtCooldown > 0) return;
    if (MOB_DAMAGE.has(cause)) {
      amount *= this.mobDamageScale ?? 1;
      if (amount <= 0) return;
      amount = Math.max(0.5, Math.round(amount * 2) / 2);
    }
    this.hurtCooldown = 0.5;
    // armour soaks up to 80% of attacks and explosions (not falls, hunger, drowning)
    if (!UNARMORED_DAMAGE.has(cause)) {
      const pts = this.armorPoints();
      if (pts > 0) {
        amount = Math.max(0.5, Math.round(amount * (1 - Math.min(20, pts) / 25) * 2) / 2);
        this.wearArmor(Math.max(1, Math.floor(amount / 2)));
      }
    }
    this.health -= amount;
    this.events.dispatchEvent(new CustomEvent('hurt', { detail: { amount, cause } }));
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.events.dispatchEvent(new CustomEvent('death', { detail: { cause } }));
    }
  }

  wearArmor(n) {
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const s = this.armor[i];
      if (!s) continue;
      s.dur -= n;
      changed = true;
      if (s.dur <= 0) {
        this.armor[i] = null;
        this.events.dispatchEvent(new CustomEvent('toolbreak', { detail: { id: s.id } }));
      }
    }
    if (changed) this.events.dispatchEvent(new CustomEvent('inventory'));
  }

  eat(foodValue, sat = foodValue * 0.6) {
    this.hunger = Math.min(20, this.hunger + foodValue);
    this.saturation = Math.min(this.hunger, this.saturation + sat);
  }

  respawn() {
    this.x = this.spawnPoint.x;
    this.y = this.spawnPoint.y;
    this.z = this.spawnPoint.z;
    this.vx = this.vy = this.vz = 0;
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.air = 20;
    this.dead = false;
    this.fallStart = null;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.airTimer = 0;
    this.graceTime = 0;
    this.fireTime = 0;
  }

  // ---- inventory helpers ----

  // Add a stack to the inventory (hotbar first). Returns leftover count.
  give(id, count = 1) {
    let remaining = count;
    const info = itemInfo(id);
    if (!info) return count;
    // merge into existing stacks (non-tools only)
    if (!info.tool) {
      for (let i = 0; i < 36 && remaining > 0; i++) {
        const s = this.inventory[i];
        if (s && s.id === id && s.dur === undefined) {
          const room = maxStack(id) - s.count;
          const take = Math.min(room, remaining);
          s.count += take;
          remaining -= take;
        }
      }
    }
    // fill empty slots
    for (let i = 0; i < 36 && remaining > 0; i++) {
      if (!this.inventory[i]) {
        const take = Math.min(maxStack(id), remaining);
        this.inventory[i] = makeStack(id, take);
        remaining -= take;
      }
    }
    if (remaining !== count) this.events.dispatchEvent(new CustomEvent('inventory'));
    return remaining;
  }

  // Add an exact stack (keeps durability). Returns the leftover count.
  giveStack(stack) {
    if (stack.dur === undefined) return this.give(stack.id, stack.count);
    const i = this.inventory.findIndex((s) => !s);
    if (i < 0) return stack.count;
    this.inventory[i] = { ...stack };
    this.events.dispatchEvent(new CustomEvent('inventory'));
    return 0;
  }

  // Remove `count` items of id. Returns how many were removed.
  take(id, count = 1) {
    let removed = 0;
    for (let i = 35; i >= 0 && removed < count; i--) {
      const s = this.inventory[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, count - removed);
        s.count -= take;
        removed += take;
        if (s.count <= 0) this.inventory[i] = null;
      }
    }
    if (removed > 0) this.events.dispatchEvent(new CustomEvent('inventory'));
    return removed;
  }

  countOf(id) {
    let n = 0;
    for (const s of this.inventory) if (s && s.id === id) n += s.count;
    return n;
  }

  consumeHeld(n = 1) {
    const s = this.inventory[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.inventory[this.selected] = null;
    this.events.dispatchEvent(new CustomEvent('inventory'));
  }

  // any: also wear non-tools that have durability (a bow when it fires)
  damageHeldTool(n = 1, any = false) {
    const s = this.inventory[this.selected];
    if (!s || s.dur === undefined) return;
    if (!any && !itemInfo(s.id)?.tool) return;   // armour or a bow used as a club doesn't wear
    s.dur -= n;
    if (s.dur <= 0) {
      this.inventory[this.selected] = null;
      this.events.dispatchEvent(new CustomEvent('toolbreak', { detail: { id: s.id } }));
    }
    this.events.dispatchEvent(new CustomEvent('inventory'));
  }

  // carried: stacks in hand outside the inventory (the cursor, a crafting
  // grid) — saved as part of it so a closed tab doesn't lose them
  serialize(carried = []) {
    let inventory = this.inventory;
    if (carried.length) {
      inventory = inventory.map((s) => (s ? { ...s } : null));
      const extra = [];
      for (const st of carried) {
        const i = inventory.indexOf(null);
        if (i >= 0) inventory[i] = { ...st }; else extra.push({ ...st });
      }
      if (extra.length) return { ...this.serialize(), inventory, extra };
    }
    return {
      x: this.x, y: this.y, z: this.z,
      yaw: this.yaw, pitch: this.pitch,
      health: this.health, hunger: this.hunger, saturation: this.saturation, air: this.air,
      mode: this.mode, flying: this.flying,
      inventory,
      armor: this.armor,
      selected: this.selected,
      spawnPoint: this.spawnPoint,
      worldSpawn: this.worldSpawn,
      bedPos: this.bedPos,
    };
  }

  deserialize(d) {
    if (!d) return;
    Object.assign(this, {
      x: d.x, y: d.y, z: d.z, yaw: d.yaw ?? 0, pitch: d.pitch ?? 0,
      health: d.health ?? 20, hunger: d.hunger ?? 20, saturation: d.saturation ?? 5,
      air: d.air ?? 20, mode: d.mode ?? GAMEMODE_SURVIVAL, flying: d.flying ?? false,
      selected: Number.isInteger(d.selected) && d.selected >= 0 && d.selected < 9 ? d.selected : 0,
    });
    // a stack the game no longer knows (or a damaged one) is dropped, not kept as a ghost
    const stack = (s) => (s && Number.isInteger(s.id) && s.count > 0 && itemInfo(s.id) ? { ...s, count: Math.min(s.count, maxStack(s.id)) } : null);
    if (Array.isArray(d.inventory)) {
      this.inventory = Array.from({ length: this.inventory.length }, (_, i) => stack(d.inventory[i]));
    }
    this.extraStacks = (Array.isArray(d.extra) ? d.extra : []).map(stack).filter(Boolean);   // carried stacks that didn't fit: dropped at your feet on load
    if (Array.isArray(d.armor)) this.armor = Array.from({ length: this.armor.length }, (_, i) => stack(d.armor[i]));
    if (d.spawnPoint) this.spawnPoint = { ...d.spawnPoint };
    // saves from before beds: the spawn point was always the world spawn
    this.worldSpawn = { ...(d.worldSpawn ?? this.spawnPoint) };
    this.bedPos = d.bedPos ?? null;
    this.dead = this.health <= 0;
  }
}
