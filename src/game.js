// Game: wires the world, player, entities, UI and render loop together.

import * as THREE from 'three';
import { World } from './world/world.js';
import { chunkKey } from './world/chunk.js';
import { Player } from './player/player.js';
import { Interaction, entityContents } from './player/interaction.js';
import { PrimedTnt } from './entities/mobs.js';
import { PET_CLASSES, Chicken } from './entities/animals.js';
import { Thrown, Bobber } from './entities/projectile.js';
import { Input } from './core/input.js';
import { BlockHighlight } from './render/highlight.js';
import { ViewModel } from './render/viewmodel.js';
import { EntityManager } from './entities/entityManager.js';
import { Hud } from './ui/hud.js';
import { Sky } from './render/sky.js';
import { Containers } from './ui/containers.js';
import { tickFurnaces } from './items/furnace.js';
import { tickSaplings } from './world/saplings.js';
import { tickCampfires } from './items/campfire.js';
import { tickSpawners } from './entities/spawners.js';
import { tickRandomGrowth } from './world/randomTicks.js';
import { tickFires } from './world/fire.js';
import { CampfireFx } from './render/campfireFx.js';
import { SignFx } from './render/signFx.js';
import { SignEditor } from './ui/signEditor.js';
import { MobSpawner } from './entities/mobSpawner.js';
import { itemInfo, isBlockItem, makeStack, maxStack, weaponStats, I } from './items/items.js';
import { resolveBindings, keyLabel } from './core/keybinds.js';
import { REACH_DISTANCE } from './core/constants.js';
import { Chat } from './ui/chat.js';
import { TouchControls } from './ui/touch.js';
import { Hints } from './ui/hints.js';
import { blockInfo } from './blocks/blocks.js';
import { BIOME_NAMES } from './world/worldgen.js';
import { DAY_LENGTH_SECONDS, GAMEMODE_CREATIVE, GAMEMODE_SURVIVAL, SEA_LEVEL } from './core/constants.js';
import { B, isWater } from './blocks/blocks.js';
import { isLowEndDevice, isChromeOS } from './ui/display.js';

const WATER_SHALLOW = new THREE.Color(0x1a4faa);
const WATER_DEEP = new THREE.Color(0x061633);
const UNDERWATER = new THREE.Color();

function bubbleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(220, 240, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(8, 8, 5.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(5, 4, 2, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

const RENDERERS = new WeakMap();

// three's fog measures depth along the view axis; the chunk shader uses true
// distance. Use distance for mobs, drops and particles too, so nothing at the
// edge of the screen stays sharp against fogged-out terrain.
THREE.ShaderChunk.fog_vertex = THREE.ShaderChunk.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = length( mvPosition.xyz );');

// Where auto resolution starts: native on capable machines, plain 1× on
// low-end ones (few cores or little memory: many Chromebooks) — it climbs
// back up if there's headroom.
function startPixelRatio() {
  const native = Math.min(window.devicePixelRatio || 1, 2);
  return isLowEndDevice() ? Math.min(native, 1) : native;
}

// Block entities that change on their own every tick (growth, fire, smelting,
// cooking): their chunk is written with every save so progress isn't lost.
const TICKING = new Set(['sapling', 'crop', 'fire', 'furnace', 'campfire']);
function needsSaving(c) {
  if (c.modified) return true;
  for (const st of c.blockEntities.values()) if (TICKING.has(st.kind)) return true;
  return false;
}
const BLAST_GEO = new THREE.SphereGeometry(1, 16, 12);   // shared by every explosion flash

export class Game {
  constructor({ canvas, atlas, worldMeta, store = null, sfx = null, onExit = null }) {
    this.canvas = canvas;
    this.atlas = atlas;
    this.worldMeta = worldMeta;
    this.store = store;
    this.unsaved = new Map();   // "cx,cz" -> evicted chunk waiting for the next save
    this.sfx = sfx;
    this.onExit = onExit;

    // one renderer per canvas for the page's lifetime: a new one on the same
    // canvas would share the GL context and strand the old one's resources
    this.renderer = RENDERERS.get(canvas);
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      RENDERERS.set(canvas, this.renderer);
    }
    this.renderScale = 'auto';   // 'auto' (adapts to the frame rate) or a fraction of native
    this.maxFps = 0;             // 0 = as fast as the display refreshes
    this.pixelRatio = startPixelRatio();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    // fog for mobs, drops and particles; kept in step with the chunk shader's
    this.scene.fog = new THREE.Fog(0x8fbcec, 80, 140);
    this.scene.background = new THREE.Color(0x8fbcec);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 800);
    this.scene.add(this.camera);   // so the held-item view model (a camera child) renders
    this.viewModel = new ViewModel(this.camera);

    this.world = new World({
      seed: worldMeta.seed,
      genVersion: worldMeta.genVersion ?? 1,   // worlds from before versioning keep their terrain
      atlas,
      renderDistance: worldMeta.renderDistance ?? 8,
      // a chunk that left memory before its save landed is read back from here
      loadChunk: store ? (cx, cz) => {
        const c = this.unsaved.get(`${cx},${cz}`);
        if (c) {
          this.unsaved.delete(`${cx},${cz}`);
          return { blocks: c.blocks, meta: c.meta, blockEntities: [...c.blockEntities.entries()], dirty: true };
        }
        return store.loadChunk(worldMeta.id, cx, cz);
      } : null,
      onChunkEvicted: store ? (c) => {
        if (!needsSaving(c)) return;
        this.unsaved.set(`${c.cx},${c.cz}`, c);
        this.autosaveTimer = Math.max(this.autosaveTimer, 15);   // written within a few seconds
      } : null,
    });
    this.scene.add(this.world.group);
    this.campfireFx = new CampfireFx(this.scene, this.world, atlas);
    this.signFx = new SignFx(this.scene, this.world);

    this.player = new Player(this.world);
    this.player.mode = worldMeta.mode ?? GAMEMODE_SURVIVAL;

    this.entities = new EntityManager(this.scene, this.world);
    this.entities.onPickup = () => this.sfx?.play('pickup');
    this.entities.fx.explode = (x, y, z, power) => this.explode(x, y, z, power);
    this.entities.fx.sound = (name, opts) => this.sfx?.play(name, opts);
    this.entities.fx.notify = (text) => this.hud.showLabel(text);
    this.entities.fx.hearts = (x, y, z, n = 4) => this.sparks(x, y, z, 0xff6a8a, n);
    this.entities.stash = (worldMeta.animals ?? []).slice();
    this.blasts = [];   // expanding explosion flashes
    this.sparkList = [];  // crit / sweep flecks
    this.sinceAttack = 10; // seconds since the last landed hit (weapon charge)

    this.input = new Input(canvas);
    this.highlight = new BlockHighlight(this.scene);

    this.interaction = new Interaction(this.world, this.player, {
      spawnDrops: (x, y, z, drops) => this.entities.spawnDrops(x, y, z, drops),
      openUI: (kind, pos) => {
        if (kind === 'crafting') this.containers.openCrafting();
        else if (kind === 'furnace') this.containers.openFurnace(pos);
        else if (kind === 'chest') this.containers.openChest(pos);
        else if (kind === 'bed') this.useBed(pos);
      },
      primeTnt: (x, y, z) => this.primeTnt(x, y, z, 3),
      throwItem: (kind) => this.throwItem(kind),
      castRod: () => this.castRod(),
      editSign: (x, y, z) => this.signEditor.open(x, y, z),
      fireBow: (power) => this.fireBow(power),
      notify: (text) => this.hud.showLabel(text),
      playSound: (name, opts) => {
        if (name === 'place' || name === 'eat') this.viewModel.swing();
        this.sfx?.play(name, opts);
      },
    });

    this.hud = new Hud(atlas, this.player);
    this.sky = new Sky(this.scene, this.world.materials.uniforms);
    this.containers = new Containers(this);
    this.signEditor = new SignEditor(this);
    this._furnaceUiTimer = 0;
    this.mobSpawner = new MobSpawner(this.scene, this.world, this.entities);
    this.chat = new Chat(this);
    this.touch = new TouchControls(this);
    this.hints = new Hints(this);
    this._stepDistance = 0;
    canvas.addEventListener('mousedown', () => this.sfx?.resume(), { signal: this.input.signal });

    // attack mobs on left click (takes priority over starting to mine)
    this.input.onMouseDown = (button) => {
      if ((button === 0 || button === 2) && !this.uiOpen && !this.player.dead) this.viewModel.swing();
      if (button === 1 && !this.uiOpen && !this.player.dead) { this.pickBlock(); return; }
      // right-click an animal: tame / sit / follow
      if (button === 2 && !this.uiOpen && !this.player.dead) {
        const m = this.mobUnderCrosshair();
        if (m?.interact?.(this.player, this.player.heldStack())) {
          this.interaction.placeCooldown = 0.35;
          this.interaction.useCooldown = 0.35;
        }
        return;
      }
      if (button !== 0 || this.uiOpen || this.player.dead) return;
      this.attackMob();
    };

    this.time = worldMeta.timeOfDay ?? 0.05; // fraction of a day; 0 = sunrise
    this.day = worldMeta.day ?? 1;           // days survived, shown at each sunrise
    this.sleeping = false;
    this.setDifficulty(worldMeta.difficulty ?? 2);
    this.paused = false;
    this.uiOpen = false;
    this.uiHooks = null;   // set by ui/screens module
    this.running = false;
    this.statTimer = 0;
    this.autosaveTimer = 0;
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    this.player.events.addEventListener('hurt', (e) => {
      this.sfx?.play('hurt', { cause: e.detail?.cause });
      this.hud.renderStats();
      this.flashDamage();
    });
    this.player.events.addEventListener('toolbreak', (e) => {
      this.sfx?.play('toolbreak');
      this.hud.showLabel(`${itemInfo(e.detail.id)?.display ?? 'Tool'} broke!`, true);
    });
    this.player.events.addEventListener('death', (e) => {
      const dropped = this.dropInventoryOnDeath();
      this.uiHooks?.showDeath?.(e.detail?.cause, dropped);
    });

    this._onResize = () => {
      this.applyPixelRatio();   // e.g. moved to another screen
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);

    this.bindKeys();
    this.setupSpawn();
    this.restorePets(worldMeta.pets ?? []);
    const p0 = this.player;
    this.entities.restoreDrops([...(worldMeta.drops ?? []),
      ...(p0.extraStacks ?? []).map((st) => ({ ...st, x: p0.x, y: p0.y + 0.5, z: p0.z }))]);

    // hidden-tab ticker (page timers are throttled; a worker's are not)
    const tickUrl = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' }));
    this.ticker = new Worker(tickUrl);
    URL.revokeObjectURL(tickUrl);
    this.ticker.onmessage = () => { if (document.hidden && this.running) this.loop(); };
    this._onVisibility = () => {
      if (!this.running) return;
      if (document.hidden) this.save();   // phones often close a hidden tab without warning
      else this.queueFrame();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  setupSpawn() {
    const saved = this.worldMeta.playerData;
    if (saved) {
      const p = this.player;
      p.deserialize(saved);
      // saved on the death screen: wake up at the spawn point
      if (p.dead) p.respawn();
      const ok = (q) => q && [q.x, q.y, q.z].every(Number.isFinite);
      if (ok(p) && p.y > -8) return;
      // a damaged position: back to the spawn point (or find one afresh)
      if (ok(p.spawnPoint)) { p.x = p.spawnPoint.x; p.y = p.spawnPoint.y; p.z = p.spawnPoint.z; p.vx = p.vy = p.vz = 0; return; }
    }
    // find a dry spawn column near origin
    const gen = this.world.gen;
    let sx = 8, sz = 8;
    for (let r = 0; r < 40; r++) {
      const x = 8 + ((r * 13) % 160) - 80;
      const z = 8 + ((r * 29) % 160) - 80;
      const h = Math.floor(gen.heightAt(x, z));
      // dry land that isn't a cave mouth
      if (h > SEA_LEVEL + 1 && gen.groundOk(x, h, z)) { sx = x; sz = z; break; }
    }
    const sy = Math.floor(gen.heightAt(sx, sz)) + 2;
    this.player.x = sx + 0.5; this.player.y = sy; this.player.z = sz + 0.5;
    this.player.spawnPoint = { x: sx + 0.5, y: sy + 1, z: sz + 0.5 };
    this.player.worldSpawn = { ...this.player.spawnPoint };
  }

  bindKeys() {
    const input = this.input;
    this.input.onKeyDown = (code, e) => {
      if (this.signEditor.isOpen()) {
        if (code === 'Escape') this.signEditor.close();
        return true;
      }
      if (this.uiHooks?.handleKey?.(code, e)) return true;
      if (this.sleeping) return true;   // no inventory / chat / pause mid-fade

      // inventory-style screens: E / Esc close, 1-9 and drop act on the hovered slot
      if (this.containers.isOpen()) {
        if (code === 'Escape' || input.is(code, 'inventory')) {
          this.containers.close();
          return true;
        }
        const n = code.startsWith('Digit') ? parseInt(code.slice(5), 10) : 0;
        if (n >= 1 && n <= 9) { this.containers.swapHoveredWithHotbar(n - 1); return true; }
        if (input.is(code, 'drop')) { this.containers.dropHovered(e.ctrlKey); return true; }
        return false;
      }
      if (input.is(code, 'inventory') && !this.uiOpen && !this.player.dead) {
        this.containers.openInventory();
        return true;
      }
      if (code === 'Escape' && !this.uiOpen && !this.player.dead) {
        this.uiHooks?.showPause?.();
        return true;
      }
      if ((input.is(code, 'chat') || input.is(code, 'command')) && !this.uiOpen && !this.player.dead) {
        e.preventDefault();   // keep the T or / itself out of the chat box
        this.chat.show(input.is(code, 'command') ? '/' : '');
        return true;
      }
      if (this.uiOpen) return false;

      if (code.startsWith('Digit')) {
        const n = parseInt(code.slice(5), 10);
        if (n >= 1 && n <= 9) {
          this.player.selected = n - 1;
          this.hud.renderHotbar();
          return true;
        }
      }
      if (input.is(code, 'pickBlock') && !e.repeat) {
        this.pickBlock();
        return true;
      }
      if (input.is(code, 'screenshot')) {
        e.preventDefault();
        this.screenshot();
        return true;
      }
      if (input.is(code, 'debug')) {
        e.preventDefault();
        this.hud.toggleDebug();
        return true;
      }
      if (input.is(code, 'hideHud')) {
        e.preventDefault();
        this.hud.toggleHidden();
        return true;
      }
      if (input.is(code, 'jump') && !e.repeat) this.player.tapSpace(performance.now());
      if (input.is(code, 'forward') && !e.repeat) this.player.tapForward(performance.now());
      if (input.is(code, 'drop')) {
        const s = this.player.heldStack();
        if (s) {
          // Ctrl+drop throws the whole stack
          const count = e.ctrlKey ? s.count : 1;
          const dir = this.player.lookDir();
          this.entities.spawnDrops(
            this.player.x + dir.x, this.player.eyeY - 0.3, this.player.z + dir.z,
            [{ ...s, count }]);
          this.player.consumeHeld(count);
        }
        return true;
      }
      return false;
    };

    this.input.onWheel = (dir) => {
      if (this.uiOpen) return;
      this.player.selected = (this.player.selected + dir + 9) % 9;
      this.hud.renderHotbar();
    };

    this.input.onLockLost = () => {
      if (!this.uiOpen && this.running) this.uiHooks?.showPause?.();
    };
  }

  // Hit the mob under the crosshair, if one is closer than the targeted block.
  // Returns true when a mob was in reach (touch taps fall back to "use" otherwise).
  // the mob under the crosshair within reach, unless a block is in front of it
  mobUnderCrosshair(extraReach = 0) {
    const origin = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const dir = this.player.lookDir();
    let best = null, bestDist = Infinity;
    for (const m of this.entities.mobs) {
      const d = m.rayHit(origin, dir, REACH_DISTANCE + extraReach);
      if (d !== null && d < bestDist) { best = m; bestDist = d; }
    }
    if (!best || (this.interaction.target && bestDist >= this.interaction.target.dist)) return null;
    return best;
  }

  // How charged the next swing is (0..1): weapons hit hardest once their
  // cooldown has passed since the last swing.
  attackCharge() {
    const held = this.player.heldStack();
    return Math.min(1, this.sinceAttack / weaponStats(held?.id).cooldown);
  }

  attackMob() {
    const held = this.player.heldStack();
    const w = weaponStats(held?.id);
    const best = this.mobUnderCrosshair(w.reach);
    if (!best) return false;
    const p = this.player;
    // don't swat your own pets (sneak to mean it)
    if (best.tamed && !p.sneaking) return true;
    const charge = this.attackCharge();
    const base = held ? itemInfo(held.id)?.tool?.damage ?? 1 : 1;
    // spamming does little; a full swing does full damage
    let dmg = base * (0.2 + 0.8 * charge * charge);
    // critical hit: a full-strength blow while falling
    const crit = charge > 0.9 && !p.onGround && !p.flying && p.vy < 0 && !p.inWater;
    if (crit) dmg *= 1.5;
    if (!best.damage(dmg, p)) return true;
    this.sinceAttack = 0;
    const dir = p.lookDir();
    const hd = Math.hypot(dir.x, dir.z) || 1;
    // extra knockback for heavy weapons (scaled by charge)
    if (w.knockback) {
      best.vx += (dir.x / hd) * w.knockback * charge;
      best.vz += (dir.z / hd) * w.knockback * charge;
    }
    this.sfx?.play(crit ? 'crit' : charge < 0.5 ? 'weak' : 'hit', { block: 'cloth' });
    if (crit) this.sparks(best.x, best.y + best.h * 0.7, best.z, 0xfff2a8, 8);
    // swords sweep: a full swing on the ground also clips mobs beside the target
    const cls = held ? itemInfo(held.id)?.tool?.class : null;
    if (cls === 'sword' && charge > 0.9 && p.onGround && !crit) {
      let swept = 0;
      for (const m of this.entities.mobs) {
        if (m === best || m.dead || m.tamed) continue;
        if (Math.hypot(m.x - best.x, m.z - best.z) > 2.2 || Math.abs(m.y - best.y) > 1.5) continue;
        if (Math.hypot(m.x - p.x, m.z - p.z) > REACH_DISTANCE) continue;
        if (m.damage(1 + base * 0.25, p)) swept++;
      }
      this.sfx?.play('sweep');
      this.sparks(best.x, best.y + best.h * 0.5, best.z, 0xffffff, swept ? 10 : 5);
    }
    if (p.mode !== GAMEMODE_CREATIVE) p.damageHeldTool(1);
    p.addExhaustion(0.1);
    this.interaction.breakCooldown = 0.3;
    this.interaction.resetBreaking();
    return true;
  }

  // a few bright flecks flying out of a point (crits, sweeps)
  sparks(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false, fog: false }));
      sprite.scale.setScalar(0.12);
      sprite.position.set(x, y, z);
      this.scene.add(sprite);
      const a = Math.random() * Math.PI * 2;
      this.sparkList.push({ sprite, t: 0, vx: Math.cos(a) * (1.5 + Math.random() * 2), vy: 1 + Math.random() * 2.5, vz: Math.sin(a) * (1.5 + Math.random() * 2) });
    }
  }

  updateSparks(dt) {
    for (const s of this.sparkList) {
      s.t += dt;
      s.vy -= 9 * dt;
      s.sprite.position.x += s.vx * dt; s.sprite.position.y += s.vy * dt; s.sprite.position.z += s.vz * dt;
      s.sprite.material.opacity = Math.max(0, 1 - s.t / 0.5);
      if (s.t >= 0.5) { this.scene.remove(s.sprite); s.sprite.material.dispose(); }
    }
    this.sparkList = this.sparkList.filter((s) => s.t < 0.5);
  }

  // Middle click: select the targeted block in the hotbar (creative: conjure it).
  pickBlock() {
    const t = this.interaction.target;
    if (!t) return;
    let id = t.id === B.FURNACE_LIT ? B.FURNACE : t.id;
    if (id >= B.WHEAT_0 && id <= B.WHEAT_3) id = I.WHEAT_SEEDS;   // crops pick their seeds
    else if (id === B.OAK_DOOR_TOP) id = B.OAK_DOOR;
    else if (!isBlockItem(id) || id === B.WATER || id === B.LAVA || id === B.FIRE) return;
    const p = this.player;
    const inv = p.inventory;
    const hot = inv.findIndex((s, i) => i < 9 && s?.id === id);
    if (hot >= 0) {
      p.selected = hot;
    } else {
      const found = inv.findIndex((s, i) => i >= 9 && s?.id === id);
      if (found >= 0) {
        // survival: swap the stack from the backpack into the selected slot
        const empty = inv.findIndex((s, i) => i < 9 && !s);
        if (empty >= 0) p.selected = empty;
        [inv[p.selected], inv[found]] = [inv[found], inv[p.selected]];
      } else if (p.mode === GAMEMODE_CREATIVE) {
        const empty = inv.findIndex((s, i) => i < 9 && !s);
        if (empty >= 0) p.selected = empty;
        inv[p.selected] = makeStack(id, maxStack(id));
      } else {
        return;
      }
      p.events.dispatchEvent(new CustomEvent('inventory'));
    }
    this.hud.renderHotbar();
    this.hud.showLabel();
  }

  setUiOpen(open) {
    this.uiOpen = open;
    this.input.captured = open;
    if (open) this.interaction.bowCharge = 0;   // a menu cancels a bow draw instead of firing on resume
    if (open) this.input.releaseLock();
  }

  flashDamage() {
    this.hud.flashDamage();
  }

  restorePets(pets) {
    for (const p of pets) {
      const Cls = PET_CLASSES[p.kind];
      if (!Cls) continue;
      const pet = new Cls(this.scene, this.world, p.x, p.y, p.z);
      pet.tamed = true;
      pet.onTamed();
      pet.sitting = !!p.sitting;
      pet.health = p.health ?? pet.maxTamedHealth;
      this.entities.addMob(pet);
    }
  }

  // standing in a lit campfire burns (players and mobs alike)
  burnInCampfires(dt) {
    this._fireTimer = (this._fireTimer ?? 0) - dt;
    if (this._fireTimer > 0) return;
    this._fireTimer = 0.8;
    const lit = (x, y, z) => this.world.getBlockW(Math.floor(x), Math.floor(y), Math.floor(z)) === B.CAMPFIRE;
    const p = this.player;
    if (!p.dead && (lit(p.x, p.y + 0.1, p.z) || lit(p.x, p.y + 1, p.z))) {
      p.hurtCooldown = 0;
      p.damage(1, 'fire');
    }
    for (const m of this.entities.mobs) {
      if (!m.dead && m.kind !== 'tnt' && lit(m.x, m.y + 0.1, m.z)) { m.hurtCooldown = 0; m.damage(1, null); }
    }
  }

  // ---------- bow ----------

  // F2: save what's on screen as a PNG
  screenshot() {
    this.renderer.render(this.scene, this.camera);   // fresh frame: the buffer isn't preserved
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `blockverse-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this.hud.showLabel('Screenshot saved');
      this.sfx?.play('click');
    }, 'image/png');
  }

  // snowballs and eggs
  throwItem(kind) {
    const p = this.player;
    const dir = p.lookDir();
    const speed = 22;
    this.entities.projectiles.push(new Thrown(this.scene, this.world,
      p.x + dir.x * 0.5, p.eyeY - 0.1 + dir.y * 0.5, p.z + dir.z * 0.5,
      dir.x * speed, dir.y * speed + 1.5, dir.z * speed, kind,
      (x, y, z) => {   // an egg hatched
        const chick = new Chicken(this.scene, this.world, x, y, z);
        chick.setBaby(true);
        chick.persistent = true;
        this.entities.addMob(chick);
      }));
    this.sfx?.play('throw', { vol: 0.5 });
    this.viewModel.swing();
  }

  // fishing: cast the bobber out, or reel it in (landing a catch if a fish is biting)
  castRod() {
    const p = this.player;
    this.viewModel.swing();
    if (this.bobber && !this.bobber.dead) {
      const b = this.bobber;
      if (b.biting) {
        const r = Math.random();
        const catchId = r < 0.8 ? I.FISH_RAW : r < 0.9 ? I.STRING : r < 0.96 ? I.BONE : r < 0.985 ? I.BOOK : I.GOLDEN_APPLE;
        // the catch flies toward the player
        this.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id: catchId, count: 1 }]);
        this.hud.showLabel(catchId === I.FISH_RAW ? 'You caught a fish!' : 'You reeled something in!');
        p.addExhaustion(0.5);
        if (p.mode !== GAMEMODE_CREATIVE) p.damageHeldTool(1);
        this.sfx?.play('splash');
      }
      b.kill();
      this.bobber = null;
      return;
    }
    const dir = p.lookDir();
    const b = new Bobber(this.scene, this.world, p.x + dir.x * 0.6, p.eyeY - 0.2, p.z + dir.z * 0.6,
      dir.x * 10, dir.y * 10 + 3, dir.z * 10);
    b.onSplash = () => this.sfx?.play('splash', { vol: 0.4 });
    b.onBite = () => this.sfx?.play('splash', { vol: 0.8 });
    this.bobber = b;
    this.entities.projectiles.push(b);
    this.sfx?.play('throw', { vol: 0.4 });
  }

  fireBow(power) {
    const p = this.player;
    if (power < 0.15) return;   // a twitch isn't a shot
    const creative = p.mode === GAMEMODE_CREATIVE;
    if (!creative && p.take(I.ARROW, 1) === 0) return;
    const dir = p.lookDir();
    const speed = 8 + 32 * power;
    this.entities.fx.fire(
      p.x + dir.x * 0.5, p.eyeY - 0.1 + dir.y * 0.5, p.z + dir.z * 0.5,
      dir.x * speed, dir.y * speed, dir.z * speed,
      Math.round(1 + 8 * power * power), !creative);
    if (!creative) p.damageHeldTool(1, true);
    this.viewModel.swing();
  }

  // ---------- explosions ----------

  primeTnt(x, y, z, fuse) {
    this.entities.addMob(new PrimedTnt(this.scene, this.world, x, y, z, fuse));
    this.sfx?.play('fuse', { pos: { x, y, z } });
  }

  // Blow a roughly spherical hole, hurt and knock back everything nearby.
  explode(x, y, z, power) {
    this.sfx?.play('explode', { pos: { x, y, z } });
    const r = power;
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    const removed = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const d = Math.hypot(dx, dy, dz);
          if (d > r * (0.65 + Math.random() * 0.35)) continue;
          const bx = cx + dx, by = cy + dy, bz = cz + dz;
          const id = this.world.getBlockW(bx, by, bz);
          if (id === B.AIR || id === B.WATER || id === B.LAVA || id === B.BEDROCK || id === B.OBSIDIAN) continue;
          if (id === B.TNT) {   // chain reaction
            this.world.setBlock(bx, by, bz, B.AIR);
            this.primeTnt(bx + 0.5, by, bz + 0.5, 0.5 + Math.random() * 1);
            continue;
          }
          if (this.containers.isOpenAt(bx, by, bz)) this.containers.close();   // don't keep editing a destroyed chest
          const contents = entityContents(this.world.blockEntityAt(bx, by, bz));
          if (contents.length) this.entities.spawnDrops(bx + 0.5, by + 0.5, bz + 0.5, contents.map((s) => ({ ...s })));
          // kelp and seagrass leave their water behind
          this.world.setBlock(bx, by, bz, blockInfo(id).waterlogged ? B.WATER : B.AIR);
          // a door goes as a whole
          if (id === B.OAK_DOOR && this.world.getBlockW(bx, by + 1, bz) === B.OAK_DOOR_TOP) this.world.setBlock(bx, by + 1, bz, B.AIR);
          if (id === B.OAK_DOOR_TOP && this.world.getBlockW(bx, by - 1, bz) === B.OAK_DOOR) this.world.setBlock(bx, by - 1, bz, B.AIR);
          // a third of the blocks survive as drops
          if (Math.random() < 0.3) this.interaction.spawnBlockDrops(bx, by, bz, blockInfo(id), true);
          removed.push(bx, by, bz);
        }
      }
    }
    // torches, ladders, doors and the like left hanging fall off
    for (let i = 0; i < removed.length; i += 3) this.interaction.dropUnsupported(removed[i], removed[i + 1], removed[i + 2]);
    // damage falls off over twice the blast radius
    const reach = power * 2;
    const hurt = (ex, ey, ez) => {
      const d = Math.hypot(ex - x, ey - y, ez - z);
      return d < reach ? { d, dmg: Math.round((1 - d / reach) * (power * 4 + 2)) } : null;
    };
    const p = this.player;
    const ph = hurt(p.x, p.y + 0.9, p.z);
    if (ph && ph.dmg > 0) {
      p.hurtCooldown = 0;
      p.damage(ph.dmg, 'explosion');
      const k = (1 - ph.d / reach) * 9;
      p.vx += ((p.x - x) / (ph.d || 1)) * k;
      p.vz += ((p.z - z) / (ph.d || 1)) * k;
      p.vy = Math.max(p.vy, k * 0.7);
    }
    for (const m of this.entities.mobs) {
      const mh = hurt(m.x, m.y + m.h / 2, m.z);
      if (mh && mh.dmg > 0) { m.hurtCooldown = 0; m.damage(mh.dmg, { x, z }); }
    }
    this.addBlast(x, y, z, power);
  }

  addBlast(x, y, z, power) {
    const mesh = new THREE.Mesh(
      BLAST_GEO,
      new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.blasts.push({ mesh, t: 0, power });
  }

  updateBlasts(dt) {
    for (const b of this.blasts) {
      b.t += dt;
      const f = b.t / 0.45;
      b.mesh.scale.setScalar(0.5 + f * b.power * 1.4);
      b.mesh.material.opacity = Math.max(0, 0.85 * (1 - f));
      if (f >= 1) {
        this.scene.remove(b.mesh);
        b.mesh.material.dispose();
      }
    }
    this.blasts = this.blasts.filter((b) => b.t < 0.45);
  }

  // ---------- survival ----------

  // 0 peaceful, 1 easy, 2 normal, 3 hard
  setDifficulty(level) {
    this.difficulty = Math.max(0, Math.min(3, level | 0));
    this.mobSpawner.difficulty = this.difficulty;
    this.player.mobDamageScale = [0, 0.5, 1, 1.5][this.difficulty];
    this.player.difficulty = this.difficulty;
  }

  newDay() {
    this.day++;
    if (this.player.mode !== GAMEMODE_CREATIVE) this.hud.toast(`Day ${this.day}`, 'You made it through the night.', B.BED, 5000);
  }

  isNight() {
    return this.time > 0.51 && this.time < 0.985;
  }

  // Right-click a bed: set the respawn point, and sleep through the night if it's safe.
  useBed(pos) {
    const p = this.player;
    p.bedPos = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.isNight()) {
      this.hud.showLabel('Respawn point set. You can only sleep at night.');
      return;
    }
    const threat = this.entities.mobs.some((m) => m.hostile && !m.dead
      && Math.abs(m.x - (pos.x + 0.5)) < 8 && Math.abs(m.z - (pos.z + 0.5)) < 8 && Math.abs(m.y - pos.y) < 5);
    if (threat) {
      this.hud.showLabel('You may not rest now — there are monsters nearby.', true);
      return;
    }
    // fade out, skip to morning, fade back in (input frozen, mouse stays captured)
    this.sleeping = true;
    this.input.captured = true;
    this.input.releaseVirtual();
    this.hud.sleepFade(true);
    setTimeout(() => {
      if (!this.running) return;
      this.time = 0;
      this.newDay();
      this.sleeping = false;
      this.input.captured = this.uiOpen;
      this.hud.sleepFade(false);
      this.hud.showLabel('Respawn point set.');
    }, 1800);
  }

  // Scatter the inventory where the player died (unless the world keeps it).
  // Returns the drop position, or null if nothing was dropped.
  dropInventoryOnDeath() {
    const p = this.player;
    if (this.worldMeta.keepInventory || p.mode === GAMEMODE_CREATIVE) return null;
    const stacks = [...p.inventory, ...p.armor].filter(Boolean);
    if (!stacks.length) return null;
    this.entities.spawnDrops(p.x, p.y + 0.5, p.z, stacks.map((s) => ({ ...s })));
    p.inventory.fill(null);
    p.armor.fill(null);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  }

  // Respawn at the bed if it's still there, otherwise at the world spawn.
  respawnPlayer() {
    const p = this.player;
    const bed = p.bedPos;
    let note = null;
    // a bed in an unloaded chunk can't be checked: trust it rather than forget it
    const bedOk = bed && (!this.world.isLoaded(bed.x, bed.z) || this.world.getBlockW(bed.x, bed.y, bed.z) === B.BED);
    if (bedOk) {
      p.spawnPoint = { x: bed.x + 0.5, y: bed.y + 1.05, z: bed.z + 0.5 };
    } else {
      if (bed) note = 'Your bed was missing, so you woke up at the world spawn.';
      p.bedPos = null;
      p.spawnPoint = { ...p.worldSpawn ?? p.spawnPoint };
    }
    p.respawn();
    if (note) this.hud.showLabel(note, true);
  }

  // a few starter hints in chat, shown once when a brand-new world loads
  showWelcomeTips() {
    const k = (id) => keyLabel(this.input.bindings[id]);
    const creative = this.player.mode === GAMEMODE_CREATIVE;
    const tips = this.input.altInput === 'touch' ? [
      'Welcome! Left stick moves, drag to look.',
      'Tap to place or use, touch and hold to mine.',
      creative ? 'Tap ▦ for every block and item.' : 'Punch a tree for wood, then tap ▦ to craft planks.',
    ] : this.input.altInput === 'gamepad' ? [
      'Welcome! Sticks move and look, RT mines, LT places.',
      creative ? 'Y opens every block and item.' : 'Mine a tree for wood, then press Y to craft planks.',
      'Start pauses and shows all controls.',
    ] : [
      `Welcome! ${k('forward')}${k('left')}${k('back')}${k('right')} to move, mouse to look.`,
      isChromeOS() ? 'Click and hold to mine, two-finger click to place or use.' : 'Hold left click to mine, right click to place or use.',
      creative ? `Press ${k('inventory')} for every block and item. Double-tap ${k('jump')} to fly.`
        : `Mine a tree for wood, then press ${k('inventory')} to craft planks.`,
      'Esc pauses and shows all controls.',
    ];
    tips.forEach((t, i) => setTimeout(() => { if (this.running) this.chat.message(t, '#ffe9a8', 15000); }, 600 + i * 1600));
  }

  // how to perform an action with the current input, for tips
  controlLabel(what) {
    const mode = this.input.altInput;
    const table = {
      inventory: { touch: '▦', gamepad: 'Y', key: keyLabel(this.input.bindings.inventory) },
      mine: { touch: 'touch and hold', gamepad: 'hold RT on', key: 'hold left-click on' },
      use: { touch: 'tap', gamepad: 'press LT on', key: 'right-click' },
    }[what];
    return table[mode === 'touch' ? 'touch' : mode === 'gamepad' ? 'gamepad' : 'key'];
  }

  // in-game clock, "HH:MM" (time 0 is sunrise at 06:00)
  clockTime() {
    const h = (((this.time % 1) + 0.25) % 1) * 24;
    return `${Math.floor(h).toString().padStart(2, '0')}:${Math.floor((h % 1) * 60).toString().padStart(2, '0')}`;
  }

  // Day factor: 1 at noon, 0 at night, smooth transitions at dawn/dusk.
  dayFactor() {
    const t = this.time % 1;
    // sun elevation: sin over the day half
    const el = Math.sin(t * Math.PI * 2);
    return Math.max(0.03, Math.min(1, 0.5 + el * 2.2));
  }

  start() {
    this.running = true;
    this.hud.show();
    this.last = this._lastDraw = performance.now();
    this.queueFrame();
  }

  // one animation-frame chain only (showing a hidden tab mustn't start a second)
  queueFrame() {
    if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.loop(); });
  }

  loop() {
    if (!this.running) return;
    if (!document.hidden) this.queueFrame();

    const now = performance.now();
    // frame rate limit (saves battery and heat on laptops and Chromebooks):
    // keep a steady cadence, so a 60 cap on a 75 Hz screen still gives 60
    if (this.maxFps && !document.hidden) {
      const iv = 1000 / this.maxFps;
      if (now - this._lastDraw < iv - 1.5) return;
      this._lastDraw = now - this._lastDraw > iv * 2 ? now : this._lastDraw + iv;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    this._fpsFrames++;
    this._fpsTime += (now - (this._lastReal ?? now)) / 1000;
    this._lastReal = now;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0; this._fpsTime = 0;
      if (!document.hidden) this.adaptResolution();
    }

    const gamePaused = this.paused || this.uiOpen || this.sleeping;

    this.time += dt / DAY_LENGTH_SECONDS;
    if (this.time >= 1) {
      this.time %= 1;
      this.newDay();
    }
    const day = this.dayFactor();
    this.world.materials.uniforms.uDay.value = day;
    this.world.materials.uniforms.uTime.value = (performance.now() / 1000) % 1000;

    // fog follows render distance
    const R = this.world.renderDistance * 16;
    this.world.materials.uniforms.uFogNear.value = R * 0.6;
    this.world.materials.uniforms.uFogFar.value = R * 0.95;
    this.sky.update(this.time, day, this.player, this.player.headInWater);

    if (!gamePaused || document.hidden) {
      const wasInWater = this.player.inWater;
      const px0 = this.player.x, pz0 = this.player.z;
      this.player.update(this.input, dt, gamePaused);
      this.interaction.update(this.input, dt, gamePaused);
      this.entities.update(dt, this.player);
      this.mobSpawner.update(dt, this.player, day);
      this.tickBlockEntities(dt);

      // footsteps + splash
      if (this.player.onGround && !this.player.flying) {
        this._stepDistance += Math.hypot(this.player.x - px0, this.player.z - pz0);
        if (this._stepDistance > 2.1) {
          this._stepDistance = 0;
          const ground = blockInfo(this.world.getBlockW(
            Math.floor(this.player.x), Math.floor(this.player.y) - 1, Math.floor(this.player.z)));
          // left, right, left...; sneaking is silent
          this._stepSide = -(this._stepSide ?? 0.15);
          if (ground.id !== 0 && !this.player.sneaking) this.sfx?.play('step', { block: ground.sound, pan: this._stepSide });
        }
      }
      if (!wasInWater && this.player.inWater && this.player.vy < -3) this.sfx?.play('splash');
    }

    this.highlight.update(this.interaction.target, this.interaction.breakProgress, this.world);
    this.updateBlasts(dt);
    this.updateSparks(dt);
    // putting the rod away reels the line in
    if (this.bobber && (this.bobber.dead || this.player.heldStack()?.id !== I.FISHING_ROD)) { this.bobber.kill(); this.bobber = null; }
    this.updateBubbles(dt);
    this.sfx?.setUnderwater(this.player.headInWater && !this.player.dead && !this.paused);
    if (!gamePaused) this.updateAmbience(dt);
    this.sinceAttack += dt;
    if (!this.fireEl) this.fireEl = document.getElementById('fire-overlay');
    this.fireEl?.classList.toggle('on', this.player.fireTime > 0 && !this.player.dead);
    if (!this.chargeEl) { this.chargeEl = document.getElementById('attack-charge'); this.chargeBar = this.chargeEl?.firstElementChild; }
    if (this.chargeEl) {
      const c = this.attackCharge();
      this.chargeEl.classList.toggle('hidden', c >= 1 || this.player.dead);
      if (c < 1) this.chargeBar.style.width = `${(c * 100) | 0}%`;
    }
    this.campfireFx.update(gamePaused ? 0 : dt, this.player);
    this.signFx.update(dt, this.player);

    // camera follows player eye
    this.camera.position.set(this.player.x, this.player.eyeY, this.player.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotateY(this.player.yaw);
    this.camera.rotateX(this.player.pitch);
    this.updateViewModel(dt, gamePaused);
    // drawing a bow zooms in a little and fills a meter under the crosshair
    const charge = this.interaction.bowCharge;
    if (charge !== this._lastCharge) {
      this._lastCharge = charge;
      this.camera.fov = (this.baseFov ?? 75) * (1 - 0.12 * charge);
      this.camera.updateProjectionMatrix();
      this.hud.setBowCharge(charge);
    }

    // underwater tint
    this.applyUnderwaterEffect();
    const fu = this.world.materials.uniforms, fog = this.scene.fog;
    fog.color.copy(fu.uFogColor.value);
    fog.near = fu.uFogNear.value;
    fog.far = fu.uFogFar.value;

    // a hidden tab keeps the world ticking (and loading) but draws nothing
    this.world.update(this.player.x, this.player.z, now, document.hidden ? 3 : 1);
    if (!document.hidden) this.renderer.render(this.scene, this.camera);

    // prompt the player to click when the game is live but the mouse isn't captured
    // (gamepad and touch players don't need the mouse captured)
    const needClick = !this.uiOpen && !this.input.pointerLocked && !this.player.dead && !this.input.altInput;
    if (needClick !== this._promptShown) {
      this._promptShown = needClick;
      this.hud.setPrompt(needClick);
    }

    this.statTimer += dt;
    if (this.statTimer > 0.25) {
      this.statTimer = 0;
      this.hud.renderStats();
      this.hud.setFps(this.fps);
      this.hints.update(0.25);
      this.updateDebug();
    }

    if (this.store) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 20) {
        this.autosaveTimer = 0;
        const saving = this.save();
        if (saving) this.hud.showSaving(saving);
      }
    }

    this.input.endFrame();
  }

  updateViewModel(dt, paused) {
    const p = this.player;
    const x = Math.floor(p.x), y = Math.floor(p.eyeY), z = Math.floor(p.z);
    const light = this.world.lightAt(x, y, z) || 0;
    this.viewModel.update(paused ? 0 : dt, {
      held: p.heldStack()?.id ?? 0,
      draw: this.interaction.bowCharge,
      eating: this.interaction.eating ? this.interaction.eating.t / this.interaction.eating.need : 0,
      mining: !paused && !!this.interaction.breakTarget && this.input.mouseDown(0),
      speed: Math.hypot(p.vx, p.vz),
      onGround: p.onGround && !p.flying,
      light,
      visible: !p.dead && !this.hud.root.classList.contains('bare'),
    });
  }

  applyUnderwaterEffect() {
    const under = this.player.headInWater;
    if (under !== this._wasUnder) {
      this._wasUnder = under;
      // a background of our own (the sky's colour object is left alone)
      if (under) this.scene.background = this._waterBg ??= new THREE.Color();
    }
    if (under) {
      // deeper (and at night) the water gets darker and murkier
      const p = this.player;
      let depth = 0;
      while (depth < 24 && isWater(this.world.getBlockW(Math.floor(p.x), Math.floor(p.eyeY) + depth + 1, Math.floor(p.z)))) depth++;
      const dark = Math.min(1, depth / 22) * 0.7 + (1 - this.dayFactor()) * 0.5;
      const u = this.world.materials.uniforms;
      UNDERWATER.copy(WATER_SHALLOW).lerp(WATER_DEEP, Math.min(1, dark));
      u.uFogColor.value.copy(UNDERWATER);
      this.scene.background.copy(UNDERWATER);
      u.uFogNear.value = 3;
      u.uFogFar.value = 24 - Math.min(1, dark) * 8;
    }
  }

  // Sounds of the place you're in: the listener follows the camera; fires
  // crackle and lava pops nearby; caves hum; crickets sing on summer nights;
  // and your heart pounds when you're nearly dead.
  updateAmbience(dt) {
    const p = this.player, sfx = this.sfx;
    if (!sfx) return;
    sfx.setListener(p.x, p.eyeY, p.z, p.yaw);
    if (p.dead) return;
    const survival = p.mode !== GAMEMODE_CREATIVE;
    this._beat = (this._beat ?? 0) - dt;
    if (survival && p.health <= 4 && this._beat <= 0) { this._beat = p.health <= 2 ? 0.8 : 1.1; sfx.play('heartbeat'); }
    this._ambT = (this._ambT ?? 0) - dt;
    if (this._ambT > 0) return;
    this._ambT = 0.35;
    // a few random cells around you: anything burning nearby?
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 14), y = Math.floor(p.y + (Math.random() - 0.5) * 8), z = Math.floor(p.z + (Math.random() - 0.5) * 14);
      const id = this.world.getBlockW(x, y, z);
      if ((id === B.FIRE || id === B.CAMPFIRE) && Math.random() < 0.7) sfx.play('crackle', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
      else if (id === B.LAVA && this.world.getBlockW(x, y + 1, z) === B.AIR && Math.random() < 0.35) sfx.play('lavapop', { pos: { x: x + 0.5, y: y + 1, z: z + 0.5 } });
    }
    const sky = this.world.getSkyW(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    if (sky === 0 && p.y < 50 && Math.random() < 0.35 / 60) sfx.play('drone');   // about once a minute, deep down
    const day = this.dayFactor();
    if (day < 0.3 && sky >= 12 && !p.headInWater && Math.random() < 0.12) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
      sfx.play('cricket', { pos: { x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r } });
    }
  }

  // bubbles drift up from the player while their head is underwater
  updateBubbles(dt) {
    const p = this.player;
    this.bubbles ??= [];
    if (p.headInWater && !p.dead) {
      this._bubbleTimer = (this._bubbleTimer ?? 0) - dt;
      if (this._bubbleTimer <= 0) {
        this._bubbleTimer = 0.5 + Math.random() * 0.9;
        this.bubbleTex ??= bubbleTexture();
        const dir = p.lookDir();
        for (let i = 0; i < 1 + ((Math.random() * 3) | 0); i++) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bubbleTex, transparent: true, depthWrite: false }));
          sprite.scale.setScalar(0.04 + Math.random() * 0.05);
          sprite.position.set(p.x + dir.x * 1.1 + (Math.random() - 0.5) * 0.4, p.eyeY - 0.3, p.z + dir.z * 1.1 + (Math.random() - 0.5) * 0.4);
          this.scene.add(sprite);
          this.bubbles.push({ sprite, t: 0, phase: Math.random() * 6 });
        }
      }
    }
    for (const b of this.bubbles) {
      b.t += dt;
      const pos = b.sprite.position;
      pos.y += dt * (1.2 + b.t * 0.6);
      pos.x += Math.sin(b.t * 6 + b.phase) * dt * 0.25;
      // pop at the surface (or after a while)
      if (b.t > 3 || !isWater(this.world.getBlockW(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)))) b.t = 99;   // kelp counts as water
      if (b.t >= 99) { this.scene.remove(b.sprite); b.sprite.material.dispose(); }
    }
    this.bubbles = this.bubbles.filter((b) => b.t < 99);
  }

  tickBlockEntities(dt) {
    tickFurnaces(this.world, dt);
    tickSaplings(this.world, dt);
    tickCampfires(this.world, dt, (x, y, z, drops) => this.entities.spawnDrops(x, y, z, drops));
    tickSpawners(this, dt);
    tickRandomGrowth(this.world, this.player, dt);
    tickFires(this.world, dt);
    this.burnInCampfires(dt);
    if (this.containers.open === 'furnace') {
      this._furnaceUiTimer += dt;
      if (this._furnaceUiTimer > 0.25) {
        this._furnaceUiTimer = 0;
        this.containers.refreshIfFurnace();
      }
    }
  }

  // native pixel ratio we never go above (2× is plenty, even on sharp screens)
  maxPixelRatio() { return Math.min(window.devicePixelRatio || 1, 2); }

  applyPixelRatio() {
    const max = this.maxPixelRatio();
    if (this.renderScale !== 'auto') this.pixelRatio = Math.max(0.5, max * this.renderScale);
    else this.pixelRatio = Math.min(max, Math.max(0.5, this.pixelRatio));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Auto resolution: drop the render resolution while the frame rate is low,
  // raise it back while there's headroom. Checked twice a second, moving in
  // small steps once the frame rate has stayed low (or high) for a while.
  adaptResolution() {
    if (this.renderScale !== 'auto' || this.uiOpen) { this._lowFor = this._highFor = 0; return; }
    const target = Math.min(60, this.maxFps || 60);
    if (this.fps < target * 0.75) { this._lowFor = (this._lowFor ?? 0) + 1; this._highFor = 0; }
    else if (this.fps >= target * 0.95) { this._highFor = (this._highFor ?? 0) + 1; this._lowFor = 0; }
    else { this._lowFor = this._highFor = 0; }
    let next = this.pixelRatio;
    if (this._lowFor >= 3) { next = Math.max(0.5, this.pixelRatio - 0.15); this._lowFor = 0; }
    else if (this._highFor >= 6) { next = Math.min(this.maxPixelRatio(), this.pixelRatio + 0.1); this._highFor = 0; }
    if (Math.abs(next - this.pixelRatio) > 0.01) { this.pixelRatio = next; this.applyPixelRatio(); }
  }

  updateDebug() {
    const p = this.player;
    const biome = this.world.biomeAt(Math.floor(p.x), Math.floor(p.z));
    const light = this.world.getSkyW(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    const bl = this.world.getBlockLightW(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    this.hud.setDebug(
      `BlockVerse 1.0 | FPS ${this.fps}\n` +
      `XYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
      `chunk ${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}  biome ${BIOME_NAMES[biome] ?? '?'}\n` +
      `light sky ${light} block ${bl}  time ${this.clockTime()}\n` +
      `chunks ${this.world.stats.chunks} genQ ${this.world.stats.genQueue} dirty ${this.world.dirtyMeshes.size}\n` +
      `draws ${this.renderer.info.render.calls} tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k ` +
      `res ${Math.round(this.pixelRatio * 100)}%${this.renderScale === 'auto' ? ' (auto)' : ''} ` +
      `mode ${p.mode === GAMEMODE_CREATIVE ? 'creative' : 'survival'}${p.flying ? ' (fly)' : ''}`,
    );
  }

  applySettings(s) {
    this.world.renderDistance = s.renderDistance;
    this.world.centerCx = Infinity; // force re-stream at the new radius
    this.baseFov = s.fov;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.player.sensitivity = s.sensitivity;
    this.player.invertY = !!s.invertY;
    this.hud.showFps(!!s.showFps);
    this.input.bindings = resolveBindings(s.keys);
    this.sfx?.setVolume(s.volume);
    this.world.materials.uniforms.uBrightness.value = s.brightness ?? 0.3;
    this.viewModel.bobbing = s.viewBobbing !== false;
    this.maxFps = s.maxFps ?? 0;
    if ((s.renderScale ?? 'auto') !== this.renderScale) {
      this.renderScale = s.renderScale ?? 'auto';
      if (this.renderScale === 'auto') this.pixelRatio = startPixelRatio();
      this.applyPixelRatio();
    }
    const ch = document.getElementById('crosshair');
    if (ch) ch.dataset.style = s.crosshair ?? 'plus';
  }

  pause() {
    this.paused = true;
    this.setUiOpen(true);
  }

  resume() {
    this.paused = false;
    this.setUiOpen(false);
    this.input.requestLock();
  }

  save() {
    if (!this.store) return;
    // chunks and the world entry go in one transaction: all of it lands or
    // none does (a chest and your inventory can't disagree after a crash)
    const loaded = [...this.world.chunks.values()].filter(needsSaving);
    const evicted = [...this.unsaved.values()];
    for (const c of loaded) c.modified = false;
    // the world entry is already in memory: update it and write it straight
    // out (no read first), so a save made while the tab closes still lands
    Object.assign(this.worldMeta, {
      // tamed pets travel with the save
      pets: this.entities.mobs.filter((m) => m.tamed && !m.dead && m.dying === undefined).map((m) => ({
        kind: m.kind, x: m.x, y: m.y, z: m.z, sitting: m.sitting, health: m.health,
      })),
      animals: this.entities.keptAnimals(),
      timeOfDay: this.time,
      day: this.day,
      difficulty: this.difficulty,
      playerData: this.player.serialize(this.containers.heldStacks()),
      drops: this.entities.savedDrops(),
      lastPlayed: Date.now(),
    });
    const done = this.store.saveWorld(this.worldMeta, [...loaded, ...evicted]).then(() => {
      for (const c of evicted) if (this.unsaved.get(`${c.cx},${c.cz}`) === c) this.unsaved.delete(`${c.cx},${c.cz}`);
      this._saveWarned = false;
      return true;
    }, (err) => {
      // try again next time: evicted ones stay queued, and a chunk unloaded
      // while this save was in flight joins them
      for (const c of loaded) {
        c.modified = true;
        const key = `${c.cx},${c.cz}`;
        if (this.world.chunks.get(chunkKey(c.cx, c.cz)) !== c && !this.unsaved.has(key)) this.unsaved.set(key, c);
      }
      this.lastSaveError = err;
      if (!this._saveWarned) {
        this._saveWarned = true;
        this.hud?.showLabel?.(`Couldn't save the world (${err?.name ?? 'error'}) — is storage full?`, true);
      }
      return false;
    });
    return done;
  }

  stop({ save = true } = {}) {
    this.running = false;
    this.sfx?.setUnderwater(false);
    const saving = this.store && save ? this.save() : null;
    this.ticker.terminate();
    // drop every document/window listener so a later world doesn't inherit them
    this.input.dispose();
    this.containers.dispose();
    this.chat.dispose();
    this.touch.dispose();
    this.viewModel.dispose();
    this.campfireFx.dispose();
    this.signFx.dispose();
    this.sky.dispose();
    this.hud.hide();
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('resize', this._onResize);
    this.entities.dispose();
    this.world.dispose();
    this.highlight.dispose();
    for (const s of [...this.sparkList, ...(this.bubbles ?? [])]) { s.sprite.removeFromParent(); s.sprite.material.dispose(); }
    this.bubbleTex?.dispose();
    this.renderer.renderLists.dispose();
    return saving;
  }
}
