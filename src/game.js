// Game: wires the world, player, entities, UI and render loop together.

import * as THREE from 'three';
import { World } from './world/world.js';
import { chunkKey } from './world/chunk.js';
import { Player } from './player/player.js';
import { Interaction, entityContents, settleWater } from './player/interaction.js';
import { PrimedTnt } from './entities/mobs.js';
import { PET_CLASSES, Chicken } from './entities/animals.js';
import { Thrown, Bobber } from './entities/projectile.js';
import { Input } from './core/input.js';
import { BlockHighlight } from './render/highlight.js';
import { ViewModel } from './render/viewmodel.js';
import { EntityManager, KEPT_KINDS } from './entities/entityManager.js';
import { Hud } from './ui/hud.js';
import { Sky } from './render/sky.js';
import { Containers } from './ui/containers.js';
import { tickFurnaces } from './items/furnace.js';
import { tickSaplings } from './world/saplings.js';
import { tickCampfires } from './items/campfire.js';
import { tickPots } from './items/cookingPot.js';
import { tickSpawners } from './entities/spawners.js';
import { tickRandomGrowth } from './world/randomTicks.js';
import { tickFires } from './world/fire.js';
import { CampfireFx } from './render/campfireFx.js';
import { ScorchFx } from './render/scorchFx.js';
import { WeatherFx } from './render/weatherFx.js';
import { SignFx } from './render/signFx.js';
import { SignEditor } from './ui/signEditor.js';
import { RanchPanel } from './ui/ranchPanel.js';
import { bindStats } from './world/market.js';
import { tickTrader, judge } from './entities/trader.js';
import { tickCustomers, buyAtStall } from './entities/customers.js';
import { MobSpawner } from './entities/mobSpawner.js';
import { itemInfo, isBlockItem, makeStack, maxStack, weaponStats, I, isRare } from './items/items.js';
import { generateTile } from './render/textures.js';
import { resolveBindings, keyLabel } from './core/keybinds.js';
import { REACH_DISTANCE } from './core/constants.js';
import { Chat } from './ui/chat.js';
import { TouchControls } from './ui/touch.js';
import { Hints } from './ui/hints.js';
import { blockInfo } from './blocks/blocks.js';
import { BIOME_NAMES, BIOME } from './world/worldgen.js';
import { dimensionOf, genVersionOf, arrivalPoint, OVERWORLD, SCORCH } from './world/dimensions.js';
import { ScorchDragon } from './entities/scorchMobs.js';
import { BlockUpdates } from './world/blockUpdates.js';
import { worldClock } from './core/clock.js';
import { describeAnimal } from './entities/inspect.js';
import { catchUpChunk } from './world/saplings.js';
import { tickRanch } from './world/ranch.js';
import { checkPortalsNear, forgetPortal, rememberPortal, nearestPortal, portalAt, buildPortal, standSpot } from './world/portal.js';
import { LAVA_LEVEL } from './world/scorchgen.js';
import { DAY_LENGTH_SECONDS, GAMEMODE_CREATIVE, GAMEMODE_SURVIVAL, SEA_LEVEL } from './core/constants.js';
import { B, isWater, isSolid, R_CROSS } from './blocks/blocks.js';
import { raycastBlocks } from './world/raycast.js';
import { isLowEndDevice, isChromeOS } from './ui/display.js';
import { Music } from './audio/music.js';
import { cropFamily } from './world/saplings.js';
import { tickFarmTech } from './world/farmtech.js';

// how light the Scorchlands' endless night is (the overworld's darkest is 0.03)
const SCORCH_DAYLIGHT = 0.13;
// seconds standing in an ember portal before it takes you through
const PORTAL_TIME = 2.5;
// a tree's parts (a spawn mustn't start in one)
const LEAFY = new Set([B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.PALM_LEAVES, B.CHARRED_LEAVES]);
const LOGGY = new Set([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.PALM_LOG, B.CHARRED_LOG]);

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
const BLOCK_SOUNDS = new Set(['hit', 'break', 'place', 'door', 'chest', 'sizzle', 'splash', 'gloop', 'ignite']);

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
// (an idle furnace or empty campfire changes nothing, so it doesn't count)
const TICKING = new Set(['sapling', 'crop', 'fire']);
function needsSaving(c) {
  if (c.modified) return true;
  for (const st of c.blockEntities.values()) {
    if (TICKING.has(st.kind)) return true;
    if (st.kind === 'furnace' && st.burnLeft > 0) return true;
    if (st.kind === 'campfire' && st.slots?.some(Boolean)) return true;
    if (st.kind === 'pot' && st.water && st.items?.length >= 2 && !st.meal) return true;   // simmering
  }
  return false;
}
const BLAST_GEO = new THREE.SphereGeometry(1, 16, 12);   // shared by every explosion flash

export class Game {
  constructor({ canvas, atlas, worldMeta, store = null, sfx = null, onExit = null }) {
    Game.building = this;   // so a constructor that throws part-way can be torn down (main.js)
    this.canvas = canvas;
    this.atlas = atlas;
    this.worldMeta = worldMeta;
    this.store = store;
    this.music = sfx ? new Music(sfx) : null;
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

    // which side of the portal: the overworld or the Scorchlands (one at a time)
    this.dimension = dimensionOf(worldMeta);
    this.world = new World({
      seed: worldMeta.seed,
      genVersion: genVersionOf(worldMeta),   // worlds from before versioning keep their terrain
      dimension: this.dimension,
      atlas,
      renderDistance: worldMeta.renderDistance ?? 8,
      // a chunk that left memory before its save landed is read back from here
      loadChunk: store ? (cx, cz) => {
        const c = this.unsaved.get(`${cx},${cz}`);
        if (c) {
          this.unsaved.delete(`${cx},${cz}`);
          return { blocks: c.blocks, meta: c.meta, blockEntities: [...c.blockEntities.entries()], dirty: true, t: c.evictedAt };
        }
        return store.loadChunk(worldMeta.id, cx, cz, this.dimension);
      } : null,
      onChunkEvicted: store ? (c) => {
        if (!needsSaving(c)) return;
        c.evictedAt = worldClock.now;
        this.unsaved.set(`${c.cx},${c.cz}`, c);
        this.saveEvery = Math.min(this.saveEvery, 3000);   // an evicted chunk is written within a few seconds
      } : null,
    });
    // a saved chunk read back in: its crops catch up on the time it was away
    this.world.onChunkLoaded = (c, t) => catchUpChunk(this.world, c, t, worldClock.now);
    this.scene.add(this.world.group);
    this.campfireFx = new CampfireFx(this.scene, this.world, atlas, (name, opts) => this.sfx?.play(name, opts));
    this.signFx = new SignFx(this.scene, this.world);

    this.player = new Player(this.world);
    this.player.mode = worldMeta.mode ?? GAMEMODE_SURVIVAL;

    this.entities = new EntityManager(this.scene, this.world);
    this.entities.onPickup = (d) => {
      if (d && isRare(d.id) && !d.owned) {
        this.sfx?.play('rare');
        this.hud.showLabel(`Rare find: ${itemInfo(d.id)?.display ?? 'something special'}!`);
      } else this.sfx?.play('pickup');
    };
    this.entities.fx.glint = (x, y, z) => this.sparks(x, y, z, 0xffe27a, 2);
    this.entities.fx.explode = (x, y, z, power) => this.explode(x, y, z, power);
    this.entities.fx.sound = (name, opts) => this.sfx?.play(name, opts);
    this.entities.fx.notify = (text) => this.hud.showLabel(text);
    this.entities.fx.hearts = (x, y, z, n = 4) => this.sparks(x, y, z, 0xff6a8a, n);
    this.entities.fx.dust = (x, y, z) => this.sparks(x, y, z, 0x8a7a64, 18);
    this.entities.fx.puff = (x, y, z) => this.sparks(x, y, z, 0xf2f2f2, 5);   // a panda's sneeze
    this.entities.fx.spark = (x, y, z, color, n) => this.sparks(x, y, z, color, n);
    this.entities.fx.openBags = (mob) => this.containers.openBags(mob);
    this.entities.fx.openTrader = () => this.ranchPanel.openTrader();
    this.entities.fx.customerBuys = (c) => buyAtStall(this, c);
    this.entities.fx.say = (text) => this.hud.showLabel(text);
    this.entities.fx.judge = (led) => judge(this, led);
    this.entities.fx.flame = (x, y, z, vx, vy, vz) => this.flame(x, y, z, vx, vy, vz);
    this.entities.fx.drop = (x, y, z, stacks) => this.entities.spawnDrops(x, y, z, stacks);
    // a dungeon boss beaten: its cage remembers, so it stays beaten
    this.entities.fx.bossDown = (boss) => {
      const c = boss.home?.cage?.split(',').map(Number);
      const st = c && this.world.blockEntityAt(c[0], c[1], c[2]);
      if (st?.kind === 'spawner') { st.boss = 'defeated'; this.world.markModified(c[0], c[2]); }
      // its cage's chunk may be unloaded (you led it far away): the world
      // remembers, and the cage learns when it next loads
      else if (boss.home?.cage) (this.worldMeta.defeatedCages ??= []).push(boss.home.key ?? boss.home.cage);
      if (boss.kind === 'dragon') this.worldMeta.dragonSlain = true;   // (until you next come to the Scorchlands)
      this.hud.showLabel(`${boss.boss.name} defeated!`);
      this.sfx?.play('victory');
      this.sparks(boss.x, boss.y + boss.h * 0.6, boss.z, 0xffd84a, 30);
    };
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
      openMarket: (t) => this.ranchPanel.openMarket(t),
      openLedger: () => this.ranchPanel.openLedger(),
      fireBow: (power) => this.fireBow(power),
      notify: (text) => this.hud.showLabel(text),
      tieLeashes: (t) => this.tieLeashes(t),
      mobInBlock: (x, y, z) => this.entities.mobs.some((m) => !m.dead && m.dying === undefined
        && m.x + m.w / 2 > x && m.x - m.w / 2 < x + 1 && m.z + m.w / 2 > z && m.z - m.w / 2 < z + 1 && m.y + m.h > y && m.y < y + 1),
      blowHorn: () => this.blowHorn(),
      whistle: (home) => this.whistle(home),
      sparkle: (x, y, z) => this.sparks(x, y, z, 0x9fe870, 8),   // bone meal, compost
      crumbs: (id) => this.crumbs(id),
      steam: (x, y, z) => this.sparks(x, y, z, 0xe8e8ec, 12),
      portalLit: (f) => this.portalLit(f),
      hatch: (kind, x, y, z) => this.hatchPet(kind, x, y, z),
      blockBits: (x, y, z, id, n) => this.blockBits(x, y, z, id, n),
      playSound: (name, opts) => {
        if (name === 'place' || name === 'eat') this.viewModel.swing();
        // block sounds come from the block you're working on (a little to the
        // left or right), not from the middle of your head
        const t = this.interaction.target ?? this.interaction.breakTarget;
        if (!opts?.pos && t && BLOCK_SOUNDS.has(name)) opts = { ...opts, pos: { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 } };
        this.sfx?.play(name, opts);
      },
    });

    this.hud = new Hud(atlas, this.player);
    this.sky = new Sky(this.scene, this.world.materials.uniforms);
    this.sky.setScorch(this.dimension === SCORCH);
    this.scorchFx = this.dimension === SCORCH ? new ScorchFx(this.scene) : null;
    // weather (the overworld's): clear spells and showers, each for a while
    const wm = worldMeta.weather;
    this.weather = { kind: wm?.kind === 'rain' ? 'rain' : 'clear', t: Number.isFinite(wm?.t) ? wm.t : 600 + Math.random() * 900 };
    this.rainAmt = this.weather.kind === 'rain' ? 1 : 0;
    this.weatherFx = this.dimension === SCORCH ? null : new WeatherFx(this.scene);
    this.containers = new Containers(this);
    this.signEditor = new SignEditor(this);
    this.ranchPanel = new RanchPanel(this);
    bindStats(worldMeta);
    this._furnaceUiTimer = 0;
    this.mobSpawner = new MobSpawner(this.scene, this.world, this.entities);
    this.mobSpawner.dimension = this.dimension;
    this.chat = new Chat(this);
    this.touch = new TouchControls(this);
    // sneaking off a horse: let go of a toggled sneak (touch button, gamepad stick),
    // or the next tap on the horse would take its saddle off instead of climbing on
    this.player.events.addEventListener('dismount', () => {
      if (this.touch?.sneak) { this.touch.sneak = false; this.touch.sneakBtn?.classList.remove('on'); }
      this.input.sneakReleased = true;
      this.input.holdAction('sneak', false);
    });
    this.hints = new Hints(this);
    this._stepDistance = 0;
    canvas.addEventListener('mousedown', () => this.sfx?.resume(), { signal: this.input.signal });

    // attack mobs on left click (takes priority over starting to mine)
    this.input.onMouseDown = (button) => {
      // (drawing a bow isn't a swing)
      if ((button === 0 || (button === 2 && !itemInfo(this.player.heldStack()?.id)?.bow)) && !this.uiOpen && !this.player.dead) this.viewModel.swing();
      if (button === 1 && !this.uiOpen && !this.player.dead) { this.pickBlock(); return; }
      // right-click an animal: tame / sit / follow
      if (button === 2 && !this.uiOpen && !this.player.dead) {
        const m = this.mobUnderCrosshair();
        const held = this.player.heldStack();
        if (m && held?.id === I.NAME_TAG && !m.hostile && m.kind !== 'falling') {
          this.nameAnimal(m);
          this.interaction.placeCooldown = 0.35;
          this.interaction.useCooldown = 0.35;
        } else if (m && this.useLead(m, held)) {
          this.interaction.placeCooldown = 0.35;
          this.interaction.useCooldown = 0.35;
        } else if (m?.interact?.(this.player, held)) {
          this.interaction.placeCooldown = 0.35;
          this.interaction.useCooldown = 0.35;
        } else if (m?.breedItem && !m.tamed && held && itemInfo(held.id)?.food) {
          // the wrong food: say what it does eat
          const foods = (m.diet ?? [m.breedItem, ...(m.breedAlso ?? [])]).map((id) => itemInfo(id)?.display.toLowerCase()).filter(Boolean);
          const list = foods.length > 1 ? `${foods.slice(0, -1).join(', ')} or ${foods.at(-1)}` : foods[0];
          const who = m.kind === 'sheep' ? 'Sheep' : `${m.kind[0].toUpperCase()}${m.kind.slice(1)}s`;
          this.hud.showLabel(`${who} eat ${list}`);
        }
        return;
      }
      if (button !== 0 || this.uiOpen || this.player.dead) return;
      this.attackMob();
    };

    // fraction of a day, 0 = sunrise (a damaged save's NaN/Infinity: morning)
    this.time = Number.isFinite(worldMeta.timeOfDay) ? ((worldMeta.timeOfDay % 1) + 1) % 1 : 0.05;
    // seconds of game time since the world began (crops catching up, animals' ages)
    worldClock.now = Number.isFinite(worldMeta.clock) && worldMeta.clock >= 0 ? worldMeta.clock : 0;
    this.day = Number.isInteger(worldMeta.day) && worldMeta.day > 0 ? worldMeta.day : 1;   // days survived, shown at each sunrise
    this.sleeping = false;
    this.setDifficulty(worldMeta.difficulty ?? 2);
    this.paused = false;
    this.uiOpen = false;
    this.uiHooks = null;   // set by ui/screens module
    this.running = false;
    this.statTimer = 0;
    this.lastSaveAt = performance.now();
    this.saveEvery = 10000;
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    this.player.events.addEventListener('hurt', (e) => {
      this.sfx?.play('hurt', { cause: e.detail?.cause });
      // the venom's first bite: say what's happening and what helps
      if (e.detail?.cause === 'poison' && !this._poisonTold) {
        this._poisonTold = true;
        this.hud.showLabel('Poisoned! It wears off after a while — milk cures it at once', true);
      }
      this.hud.renderStats();
      this.flashDamage();
    });
    // the first chill: say how to warm up
    this.player.events.addEventListener('cold', () => {
      this.hud.showLabel('You\u2019re getting cold \u2014 warm up by a fire or a torch, or wear leather', true);
    });
    this.player.events.addEventListener('toolbreak', (e) => {
      this.sfx?.play('toolbreak');
      this.hud.showLabel(`${itemInfo(e.detail.id)?.display ?? 'Tool'} broke!`, true);
    });
    // jumping on farmland tramples it (and whatever was growing there)
    this.player.events.addEventListener('trample', (e) => {
      const { x, y, z } = e.detail, w = this.world;
      const above = w.getBlockW(x, y + 1, z);
      if (cropFamily(above)) {
        w.setBlock(x, y + 1, z, B.AIR);
        this.interaction.spawnBlockDrops(x, y + 1, z, blockInfo(above), true);
      }
      w.setBlock(x, y, z, B.DIRT);
      this.sfx?.play('break', { block: 'dirt', pos: { x: x + 0.5, y: y + 1, z: z + 0.5 } });
      this.blockBits(x, y, z, B.FARMLAND, 8);
    });
    this.player.events.addEventListener('death', (e) => {
      // close any open window first: a stack on the cursor or in the crafting
      // grid goes back into the inventory, so it drops with the rest
      this.containers.close();
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
      if (document.hidden && !this.loading) this.save();   // phones often close a hidden tab without warning
      else this.queueFrame();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  setupSpawn() {
    const saved = this.worldMeta.playerData;
    // just come through from the other side: stand where we arrive
    const arrive = this.worldMeta.arrive;
    delete this.worldMeta.arrive;
    if (saved) {
      const p = this.player;
      p.deserialize(saved);
      if (arrive) {
        this.justArrived = true;
        if (this.dimension === SCORCH) delete this.worldMeta.dragonSlain;   // (come back to the Scorchlands: so has the dragon)
        if (p.dead) p.respawn();
        // home after a death there: by the bed if there is one (finishArrival checks it)
        const spot = arrive.home ? (p.bedPos ? { x: p.bedPos.x + 0.5, y: p.bedPos.y + 1.05, z: p.bedPos.z + 0.5 } : p.spawnPoint)
          : arrive.exact ? arrive
            : this.arrivalSpot(arrive.x, arrive.z, arrive.portal && this.dimension === SCORCH ? 14 : 40);
        p.x = spot.x; p.y = spot.y; p.z = spot.z;
        this.arrived = { ...arrive, spot };   // (a portal to find or build there: finishArrival)
        p.vx = p.vy = p.vz = 0; p.fallStart = null; p.flying = false;
        return;
      }
      // saved on the death screen: wake up at the spawn point (from the
      // Scorchlands, at home: finishArrival sends you)
      if (p.dead) {
        p.respawn();
        if (this.dimension === SCORCH) { this.sendHome = true; p.x = saved.x; p.y = saved.y; p.z = saved.z; }
      }
      const ok = (q) => q && [q.x, q.y, q.z].every(Number.isFinite);
      if (ok(p) && p.y > -8) return;
      // a damaged position: back to the spawn point (or find one afresh)
      if (ok(p.spawnPoint) && this.dimension !== SCORCH) { p.x = p.spawnPoint.x; p.y = p.spawnPoint.y; p.z = p.spawnPoint.z; p.vx = p.vy = p.vz = 0; return; }
    }
    if (this.dimension === SCORCH) {   // (a save that somehow opened here first)
      const s = this.arrivalSpot(8.5, 8.5);
      this.player.x = s.x; this.player.y = s.y; this.player.z = s.z;
      return;
    }
    // find a dry spawn column near origin
    const gen = this.world.gen;
    let sx = 8, sz = 8, found = false;
    // dry land that isn't a cave mouth, with land round it (not a speck of an island)
    const land = (x, z) => gen.heightAt(x, z) > SEA_LEVEL + 1;
    const dry = (x, z) => {
      const h = Math.floor(gen.heightAt(x, z));
      if (h <= SEA_LEVEL + 1 || !gen.groundOk(x, h, z)) return false;
      let n = 0;
      for (let k = 0; k < 8; k++) if (land(x + Math.round(Math.cos(k * Math.PI / 4) * 24), z + Math.round(Math.sin(k * Math.PI / 4) * 24))) n++;
      return n >= 6;
    };
    for (let r = 0; r < 40 && !found; r++) {
      const x = 8 + ((r * 13) % 160) - 80;
      const z = 8 + ((r * 29) % 160) - 80;
      if (dry(x, z)) { sx = x; sz = z; found = true; }
    }
    // all sea round the middle: look further out, ring by ring, for a shore
    for (let r = 96; r <= 1536 && !found; r += 32) {
      for (let k = 0, n = Math.ceil(r / 4); k < n && !found; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = Math.round(8 + Math.cos(a) * r), z = Math.round(8 + Math.sin(a) * r);
        if (dry(x, z)) { sx = x; sz = z; found = true; }
      }
    }
    this.freshSpawn = true;   // (checked against the real blocks once they load: finishArrival)
    const sy = Math.floor(gen.heightAt(sx, sz)) + 2;
    this.player.x = sx + 0.5; this.player.y = sy; this.player.z = sz + 0.5;
    this.player.spawnPoint = { x: sx + 0.5, y: sy + 1, z: sz + 0.5 };
    this.player.worldSpawn = { ...this.player.spawnPoint };
  }

  // somewhere to stand near (x, z) on arrival: dry ground (not a lava lake,
  // not the sea), the nearest within 40 blocks, on top of the terrain
  arrivalSpot(x, z, range = 40) {
    const gen = this.world.gen;
    const dry = (wx, wz) => {
      const col = gen.columnAt(wx, wz);
      const h = Math.floor(col.h);
      // (not in a castle or on the dragon's roost: the land's height there isn't the generator's)
      return !col.lava && h > (this.dimension === SCORCH ? LAVA_LEVEL : SEA_LEVEL) && gen.groundOk(wx, h, wz) && !gen.nearStructure?.(wx, wz) ? h : null;
    };
    for (let r = 0; r <= range; r += 2) {
      for (let k = 0; k < Math.max(1, r * 3); k++) {
        const a = (k / Math.max(1, r * 3)) * Math.PI * 2;
        const wx = Math.floor(x + Math.cos(a) * r), wz = Math.floor(z + Math.sin(a) * r);
        const h = dry(wx, wz);
        if (h !== null) return { x: wx + 0.5, y: h + 1, z: wz + 0.5 };
      }
    }
    // nowhere dry: on top of the water (the sea) rather than its floor
    const ground = Math.floor(gen.heightAt(Math.floor(x), Math.floor(z)));
    return { x, y: Math.max(ground, this.dimension === SCORCH ? LAVA_LEVEL : SEA_LEVEL) + 1, z };
  }

  // a word on arriving (the first time, a little more)
  arrivalNote() {
    if (this.dimension === SCORCH) {
      const first = !this.worldMeta.seenScorch;
      this.worldMeta.seenScorch = true;
      this.hud.showLabel(first ? 'The Scorchlands. The night never ends here.' : 'The Scorchlands', true);
      // the first time: which way the dragon's roost lies
      const r = this.world.gen.roost?.(), p = this.player;
      if (first && r) {
        const dx = r.x - p.x, dz = r.z - p.z;
        const dir = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];
        setTimeout(() => { if (this.running) this.hud.toast('A dragon\u2019s roost', `A crown of smouldering spires stands to the ${dir}, about ${Math.round(Math.hypot(dx, dz) / 10) * 10} blocks away. Something huge circles over it.`, I.DRAGON_SCALE); }, 4500);
      }
    } else this.hud.showLabel('Home again', false);
  }

  // Go through to the other dimension (main.js saves this one and opens
  // that one). arrive: {x, z} to land on the ground there, or {x, y, z, exact}.
  travel(to, arrive) {
    if (this.travelling || to === this.dimension) return;
    this.travelling = true;
    // pets following close by come too
    const p = this.player;
    for (const m of this.entities.mobs) {
      if (m.tamed && !m.sitting && !m.dead && m.dying === undefined && Math.hypot(m.x - p.x, m.z - p.z) < 8) m.travelling = true;
      // and so do the animals on your lead, and the horse you're riding
      if ((m.leash?.player === p || p.mount === m) && !m.dead && m.dying === undefined && KEPT_KINDS.has(m.kind)) { m.travelling = true; m.persistent = true; }
    }
    // (after this frame: the Game is closed down on the way, and the rest of
    // the frame mustn't run on a disposed world)
    setTimeout(() => this.uiHooks?.travel?.(to, arrive), 0);
  }

  // a pet hatched (an ember whelp from its egg): tame from the start
  hatchPet(kind, x, y, z) {
    const Cls = PET_CLASSES[kind];
    if (!Cls) return;
    const pet = new Cls(this.scene, this.world, x, y, z);
    pet.tamed = true;
    pet.onTamed();
    pet.health = pet.maxTamedHealth;
    this.entities.addMob(pet);
    this.sparks(x, y + 0.4, z, 0xff8a2a, 18);
    this.sfx?.play('drake', { pos: { x, y, z }, pitch: 1.6 });
    this.hud.showLabel(`An ${pet.petName ?? kind} hatches! It follows you; right-click it to have it perch.`);
  }

  clearSpawn() {
    const p = this.player, w = this.world;
    const PLANT = (id) => LEAFY.has(id) || LOGGY.has(id);
    const okAt = (x, y, z) => {
      const below = w.getBlockW(x, y - 1, z);
      return isSolid(below) && !PLANT(below) && !isSolid(w.getBlockW(x, y, z)) && !isSolid(w.getBlockW(x, y + 1, z))
        && !PLANT(w.getBlockW(x, y, z)) && !isWater(w.getBlockW(x, y, z));
    };
    const fx = Math.floor(p.x), fz = Math.floor(p.z);
    if (okAt(fx, Math.floor(p.y), fz)) return;
    for (let r = 0; r <= 12; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = fx + dx, z = fz + dz;
        // the ground there as it is: the highest solid block that isn't a tree
        let y = Math.floor(p.y) + 12;
        while (y > 1 && (!isSolid(w.getBlockW(x, y - 1, z)) || PLANT(w.getBlockW(x, y - 1, z)))) y--;
        if (!okAt(x, y, z)) continue;
        p.x = x + 0.5; p.y = y; p.z = z + 0.5; p.vx = p.vy = p.vz = 0; p.fallStart = null;
        p.spawnPoint = { x: p.x, y: y + 1, z: p.z };
        p.worldSpawn = { ...p.spawnPoint };
        return;
      }
    }
  }

  // ---------- the Scorch Dragon ----------

  // Come near its roost and the dragon rises, unless you've beaten it this
  // visit (it's back the next time you come to the Scorchlands).
  updateDragon(dt) {
    this._dragonT = (this._dragonT ?? 0) - dt;
    if (this._dragonT > 0 || this.worldMeta.dragonSlain || this.mobSpawner.difficulty === 0) return;
    this._dragonT = 1;
    const roost = this.world.gen.roost?.(), p = this.player;
    if (!roost || p.dead || Math.hypot(p.x - roost.x, p.z - roost.z) > 40 || !this.world.isLoaded(roost.x, roost.z)) return;
    if (this.entities.mobs.some((m) => m.kind === 'dragon' && !m.dead && m.dying === undefined)) return;
    const d = new ScorchDragon(this.scene, this.world, roost.x + 0.5, roost.y + 18, roost.z + 0.5).setDifficulty(this.mobSpawner.difficulty);
    // its spoils land on the roost, not wherever it falls (over lava, say)
    d.dropFn = (drops) => this.entities.spawnDrops(roost.x + 0.5, roost.y + 1, roost.z + 0.5, drops);
    this.entities.addMob(d);
    this.sfx?.play('dragon', { pos: d, vol: 1.3 });
    this.hud.showLabel(this.worldMeta.metDragon ? 'The Scorch Dragon has come back to its roost!' : 'The Scorch Dragon rises from its roost!', true);
    this.worldMeta.metDragon = true;
  }

  // ---------- ember portals ----------

  portalLit(f) {
    rememberPortal(this.worldMeta, this.dimension, f);
    const c = standSpot(f);
    this.sfx?.play('portallight', { pos: { x: c.x, y: c.y + 1.5, z: c.z } });
    this.sparks(c.x, c.y + 1.5, c.z, 0xff9a40, 16);
    if (!this.worldMeta.litPortal) {
      this.worldMeta.litPortal = true;
      this.hud.showLabel('The portal flares into life. Stand in it to cross to the Scorchlands.', true);
    }
  }

  // Each frame: put out portals whose frames were broken, and take you
  // through when you've stood in one long enough. You must step out of the
  // one you arrive in before it will take you back.
  updatePortals(dt) {
    const w = this.world, pc = w.portalChecks;
    if (pc.length) {
      const cells = pc.splice(0);
      for (let i = 0; i < cells.length; i += 3) {
        for (const f of checkPortalsNear(w, cells[i], cells[i + 1], cells[i + 2])) {
          forgetPortal(this.worldMeta, this.dimension, f);
          const c = standSpot(f);
          this.sfx?.play('portalout', { pos: { x: c.x, y: c.y + 1.5, z: c.z } });
        }
      }
    }
    const p = this.player;
    const inPortal = !p.dead && !this.travelling
      && [0.2, 1.3].some((dy) => w.getBlockW(Math.floor(p.x), Math.floor(p.y + dy), Math.floor(p.z)) === B.EMBER_PORTAL);
    if (!inPortal) {
      this.portalArmed = true;
      this.portalTime = Math.max(0, (this.portalTime ?? 0) - dt * 2);
    } else if (this.portalArmed !== false) {
      this.portalTime = (this.portalTime ?? 0) + dt;
      if (this.portalTime >= (p.mode === GAMEMODE_CREATIVE ? 1 : PORTAL_TIME)) this.enterPortal();
    }
    // the screen glows as it takes hold
    if (!this.portalEl) this.portalEl = document.getElementById('portal-overlay');
    const glow = Math.min(1, (this.portalTime ?? 0) / PORTAL_TIME);
    if (this.portalEl && Math.abs(glow - (this._portalGlow ?? 0)) > 0.01) { this._portalGlow = glow; this.portalEl.style.opacity = glow.toFixed(2); }
    // the hum, and motes of flame drifting off the sheet, near a portal
    this._portalFx = (this._portalFx ?? 0) - dt;
    if (this._portalFx > 0) return;
    this._portalFx = 0.25;
    let near = null, nd = 14;
    for (const q of this.worldMeta.portals ?? []) {
      if (q.dim !== this.dimension) continue;
      const c = standSpot(q), d = Math.hypot(c.x - p.x, c.y + 1.5 - p.y, c.z - p.z);
      if (d < nd && w.getBlockW(q.x, q.y, q.z) === B.EMBER_PORTAL) { near = c; nd = d; }
    }
    if (!near) return;
    this._portalHum = (this._portalHum ?? 0) - 0.25;
    if (this._portalHum <= 0) { this._portalHum = 2.2; this.sfx?.play('portalhum', { pos: { x: near.x, y: near.y + 1.5, z: near.z } }); }
    for (let i = 0; i < 2; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: Math.random() < 0.5 ? 0xff7a2a : 0xffc060, transparent: true, depthWrite: false, fog: false }));
      sprite.scale.setScalar(0.07);
      sprite.position.set(near.x + (Math.random() - 0.5) * 2, near.y + Math.random() * 3, near.z + (Math.random() - 0.5) * 2);
      this.scene.add(sprite);
      this.sparkList.push({ sprite, t: 0, g: -0.6, life: 1.4, vx: (Math.random() - 0.5) * 0.3, vy: 0.2 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.3 });
    }
  }

  // Through the portal: to the remembered portal on the other side nearest
  // where you'd come out (8:1), or to open ground there, where a new one is
  // built for you (finishArrival).
  enterPortal() {
    const p = this.player;
    const here = portalAt(this.world, Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z))
      ?? portalAt(this.world, Math.floor(p.x), Math.floor(p.y + 1.3), Math.floor(p.z));
    const to = this.dimension === SCORCH ? OVERWORLD : SCORCH;
    const pt = arrivalPoint(this.dimension, to, p.x, p.z);
    const link = nearestPortal(this.worldMeta, to, pt.x, pt.z);
    this.portalTime = 0;
    this.sfx?.play('portalgo');
    const portal = link ? { x: link.x, y: link.y, z: link.z, axis: link.axis } : { axis: here?.axis ?? 0, build: true };
    this.travel(to, link ? { ...standSpot(link), exact: true, portal } : { x: pt.x, z: pt.z, portal });
  }

  // Once the land around you has loaded: if you came by portal, stand in the
  // one you came out of (building it if it isn't there); then the animals
  // that came with you join you.
  finishArrival() {
    this.arriveAt();
    this.landAnimals();
  }

  // the kept animals that came through with you (on a lead, or ridden):
  // beside you, on the step in front of the portal if you came by one
  landAnimals() {
    const p = this.player, front = this.arrivalFront;
    this.arrivalFront = null;
    let i = 0;
    for (const a of this.entities.stash) {
      if (!a.arriving) continue;
      delete a.arriving;
      const k = i++;
      if (front) { a.x = front.x + front.side[0] * ((k % 3) - 1) * 1.4; a.z = front.z + front.side[1] * ((k % 3) - 1) * 1.4; }
      else { a.x = p.x + Math.cos(k * 1.3) * 2; a.z = p.z + Math.sin(k * 1.3) * 2; }
      a.y = p.y + 0.1;
    }
    if (i) this.entities.stashTimer = 0;   // (in at once)
  }

  arriveAt() {
    // a brand-new world: the spawn column came from the terrain's height,
    // which knows nothing of trees and structures; if that put you in a
    // trunk, a canopy or a shrine's wall, step out onto open ground nearby
    if (this.freshSpawn) { this.freshSpawn = false; this.clearSpawn(); }
    // reloaded on the death screen in the Scorchlands: home you go
    if (this.sendHome) { this.sendHome = false; this.travel(OVERWORLD, { home: true }); return; }
    const a = this.arrived;
    this.arrived = null;
    const pets = this.arrivingPets ?? [];
    this.arrivingPets = null;
    const p = this.player, w = this.world;
    // woken at home after dying over there: the bed if it's still there
    if (a?.home) { this.respawnPlayer(); return; }
    // the land as it is (a build, a hill the generator didn't know): stand on top of it
    const up = (x, y, z) => {
      let n = 0;
      while (n++ < 24 && (isSolid(w.getBlockW(Math.floor(x), Math.floor(y), Math.floor(z))) || isSolid(w.getBlockW(Math.floor(x), Math.floor(y) + 1, Math.floor(z))))) y = Math.floor(y) + 1;
      return y;
    };
    if (!a?.portal) {
      if (a && !a.exact) { p.y = up(p.x, p.y, p.z); p.vy = 0; p.fallStart = null; }
      return;
    }
    let f = a.portal.build ? null : portalAt(w, a.portal.x, a.portal.y, a.portal.z);
    if (!f) {
      if (!a.portal.build) forgetPortal(this.worldMeta, this.dimension, a.portal);   // gone since: a new one
      f = buildPortal(w, Math.floor(a.spot.x), up(a.spot.x, a.spot.y, a.spot.z), Math.floor(a.spot.z), a.portal.axis ?? 0, this.dimension);
      rememberPortal(this.worldMeta, this.dimension, f);
    }
    const s = standSpot(f);
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.vx = p.vy = p.vz = 0; p.fallStart = null;
    this.portalArmed = false;   // step out before it takes you back
    // pets that came along wait on the step in front (animals a step further)
    const [nx, nz] = f.axis ? [1, 0] : [0, 1];
    this.arrivalFront = { x: s.x + nx * 2.5, z: s.z + nz * 2.5, side: f.axis ? [0, 1] : [1, 0] };
    pets.forEach((m, i) => {
      m.x = s.x + nx * 1.5 + (f.axis ? 0 : (i % 2) - 0.5);
      m.z = s.z + nz * 1.5 + (f.axis ? (i % 2) - 0.5 : 0);
      m.y = s.y; m.vx = m.vy = m.vz = 0;
    });
  }

  bindKeys() {
    const input = this.input;
    this.input.onKeyDown = (code, e) => {
      if (this.ranchPanel.isOpen()) {
        if (code === 'Escape' || input.is(code, 'inventory')) this.ranchPanel.close();
        return true;
      }
      if (this.signEditor.isOpen()) {
        if (code === 'Escape') this.signEditor.close(!!this.signEditor.prompt);   // (Escape cancels a name)
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
            [{ ...s, count }], true);
          this.player.consumeHeld(count);
          this.sfx?.play('drop');
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
  // Leads: put one on an animal, or take it back off (a horse you climb on
  // gives its lead back by itself).
  // Sneaking while looking at an animal shows its card (a few times a second)
  updateInspect(dt) {
    this._inspectT = (this._inspectT ?? 0) - dt;
    if (this._inspectT > 0) return;
    this._inspectT = 0.2;
    const p = this.player;
    // saddlebags close when their horse is gone or has wandered off
    const bags = this.containers.bagsOf;
    if (bags && (bags.dead || bags.dying !== undefined || Math.hypot(bags.x - p.x, bags.z - p.z) > 6)) this.containers.close();
    const m = p.sneaking && !p.dead ? this.mobUnderCrosshair(3) : null;
    this.hud.setInspect(m && !m.hostile && m.kind !== 'falling' && m.kind !== 'tnt' ? describeAnimal(m) : null);
  }

  // A name tag on an animal: type a name; it's yours from then on.
  nameAnimal(m) {
    const species = m.petName ?? m.label ?? m.kind;
    // only what can be kept (farm animals, horses, your pets): a named fox would still wander off for good
    if (!m.tamed && !KEPT_KINDS.has(m.kind)) { this.hud.showLabel(`A ${species} won\u2019t answer to a name — try a farm animal or a pet of yours`); return; }
    this.signEditor.openPrompt(m.name ? `Rename ${m.name}` : `Name this ${species}`, m.name ?? '', 24, (text) => {
      const name = text.trim();
      if (!name || m.dead || m.dying !== undefined) return;
      const tagged = this.player.heldStack()?.id === I.NAME_TAG;
      if (!tagged) return;   // (put away while typing)
      if (this.player.mode !== GAMEMODE_CREATIVE) this.player.consumeHeld(1);
      m.setName(name);
      m.persistent = true;
      m.ensureId();
      this.sfx?.play('place', { block: 'cloth' });
      this.hud.showLabel(`${name} the ${species} is yours`);
    });
  }

  useLead(m, held) {
    const p = this.player;
    if (m.leash) {
      const horseToRide = m.rideable && !held && !p.sneaking;   // (horses and camels)
      if (horseToRide || (held && held.id !== I.LEAD && !p.sneaking)) return false;   // ride it, feed it...
      m.unleash();
      if (p.mode !== GAMEMODE_CREATIVE && p.give(I.LEAD, 1) > 0) this.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id: I.LEAD, count: 1 }], true);
      this.sfx?.play('place', { block: 'cloth', vol: 0.6 });
      return true;
    }
    if (held?.id !== I.LEAD) return false;
    if (!m.breedItem || m.tamed || m.boss || m.hostile || m.dying !== undefined) { this.hud.showLabel('A lead only goes on farm animals'); return true; }
    m.leashTo({ player: p });
    if (p.mode !== GAMEMODE_CREATIVE) p.consumeHeld(1);
    this.sfx?.play('place', { block: 'cloth', vol: 0.6 });
    return true;
  }

  // Use a fence post: tie up everything you're leading, or (leading nothing)
  // take up the leads of whatever's tied there.
  tieLeashes(t) {
    const p = this.player, knot = { x: t.x, y: t.y, z: t.z };
    const led = this.entities.mobs.filter((m) => m.leash?.player === p && !m.dead);
    if (led.length) {
      for (const m of led) m.leashTo({ knot });
      this.hud.showLabel(led.length === 1 ? 'Tied to the fence' : `${led.length} animals tied to the fence`);
    } else {
      const tied = this.entities.mobs.filter((m) => m.leash?.knot && m.leash.knot.x === t.x && m.leash.knot.y === t.y && m.leash.knot.z === t.z && !m.dead);
      if (!tied.length) return false;
      for (const m of tied) m.leashTo({ player: p });
    }
    this.sfx?.play('place', { block: 'cloth', vol: 0.6 });
    return true;
  }

  // a goat horn: a long call that brings your horses and camels running
  blowHorn() {
    const p = this.player;
    this.sfx?.play('horn');
    const called = [];
    for (const m of this.entities.mobs) {
      if (!m.rideable || !m.owned || m.rider || m.dead || m.dying !== undefined) continue;   // your horses and camels come
      if (Math.hypot(m.x - p.x, m.z - p.z) > 64) continue;
      m.called = 25;
      called.push(m);
    }
    const n = called.length, one = called.every((m) => m.label === called[0]?.label) ? called[0]?.label : 'animal';
    this.hud.showLabel(n ? (n === 1 ? `Your ${one} is coming` : `${n} ${one}s are coming`) : 'The call echoes… no horse or camel of yours is in earshot');
  }

  // the shepherd's whistle: your farm animals in earshot come to you, or
  // (sneaking) go home to their pens; a dog of yours nearby rounds them up
  whistle(home) {
    const p = this.player, mobs = this.entities.mobs;
    this.sfx?.play('whistle');
    const dog = home ? null : mobs.find((m) => m.kind === 'dog' && m.tamed && !m.sitting && !m.dead && Math.hypot(m.x - p.x, m.z - p.z) < 20);
    const reach = dog ? 48 : 32;
    let n = 0, homeless = 0;
    for (const m of mobs) {
      if (!m.breedItem || m.tamed || !m.persistent || m.leash || m.rider || m.dead || m.dying !== undefined) continue;
      if (Math.hypot(m.x - p.x, m.z - p.z) > reach) continue;
      if (home && !m.home) { homeless++; continue; }
      m.whistled = { mode: home ? 'home' : 'come', t: home ? 40 : 30 };
      m.path = null;
      n++;
    }
    if (dog && n) { dog.herding = 25; dog.herded = null; dog.herdTarget = null; }
    const one = n === 1 ? 'animal' : 'animals';
    if (home) this.hud.showLabel(n ? `${n} ${one} head home (leave the gate open)` : homeless ? 'None of them has a pen to go home to' : 'No animal of yours is in earshot');
    else this.hud.showLabel(n ? `${n} ${one} coming${dog ? ' — your dog rounds them up' : ''}` : 'No animal of yours is in earshot');
  }

  mobUnderCrosshair(extraReach = 0) {
    const origin = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const dir = this.player.lookDir();
    let best = null, bestDist = Infinity;
    for (const m of this.entities.mobs) {
      if (m === this.player.mount) continue;   // not the horse you're sitting on
      const d = m.rayHit(origin, dir, REACH_DISTANCE + extraReach);
      if (d !== null && d < bestDist) { best = m; bestDist = d; }
    }
    if (!best) return null;
    // a wall stops the swing: the first solid block out to the weapon's reach
    // (a spear's reach is longer than the block cursor's, so that alone let
    // it hit through walls), looking past grass and flowers a chicken stands in
    const wall = raycastBlocks(this.world, origin, dir, REACH_DISTANCE + extraReach, false, (b) => !b.solid && (b.replaceable || b.render === R_CROSS));
    if (wall && bestDist >= wall.dist) return null;
    return best;
  }

  // How charged the next swing is (0..1): weapons hit hardest once their
  // cooldown has passed since the last swing.
  attackCharge() {
    const held = this.player.heldStack();
    return Math.min(1, this.sinceAttack / weaponStats(held?.id).cooldown);
  }

  attackMob() {
    // no swinging with food at your mouth or a bow drawn
    if (this.player.usingItem || this.interaction.bowCharge > 0) return false;
    const held = this.player.heldStack();
    const w = weaponStats(held?.id);
    const best = this.mobUnderCrosshair(w.reach);
    if (!best) return false;
    const p = this.player;
    // don't swat your own pets or horse (sneak to mean it)
    if ((best.tamed || best.owned) && !p.sneaking) return true;
    const charge = this.attackCharge();
    const base = held ? itemInfo(held.id)?.tool?.damage ?? 1 : 1;
    // spamming does little; a full swing does full damage
    let dmg = base * (0.2 + 0.8 * charge * charge);
    // critical hit: a full-strength blow while falling
    const crit = charge > 0.9 && !p.onGround && !p.flying && p.vy < 0 && !p.inWater && !p.onLadder && !p.inLava && !p.mount;
    if (crit) dmg *= 1.5;
    if (!best.damage(dmg, p)) return true;
    this.sinceAttack = 0;
    // the Ember Blade sets what it strikes alight
    const ignites = held ? itemInfo(held.id)?.tool?.ignites : 0;
    if (ignites && !best.fireproof && !best.dead) best.fireTime = Math.max(best.fireTime ?? 0, ignites);
    const dir = p.lookDir();
    const hd = Math.hypot(dir.x, dir.z) || 1;
    // extra knockback for heavy weapons (scaled by charge)
    // (bosses shrug most of it off, as they do the blow's own knockback)
    if (w.knockback) {
      const k = w.knockback * charge * (best.boss ? 0.3 : 1);
      best.vx += (dir.x / hd) * k;
      best.vz += (dir.z / hd) * k;
    }
    this.sfx?.play(crit ? 'crit' : charge < 0.5 ? 'weak' : 'hit', { block: 'cloth' });
    if (crit) this.sparks(best.x, best.y + best.h * 0.7, best.z, 0xfff2a8, 8);
    // swords sweep: a full swing on the ground also clips mobs beside the target
    const cls = held ? itemInfo(held.id)?.tool?.class : null;
    if (cls === 'sword' && charge > 0.9 && p.onGround && !crit) {
      let swept = 0;
      for (const m of this.entities.mobs) {
        if (m === best || m.dead || m.tamed || m.owned || m === p.mount) continue;
        if (Math.hypot(m.x - best.x, m.z - best.z) > 2.2 || Math.abs(m.y - best.y) > 1.5) continue;
        if (Math.hypot(m.x - p.x, m.z - p.z) > REACH_DISTANCE) continue;
        if (!m.canSee(p)) continue;   // not through a wall
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

  // a tongue of dragon fire, flying out along (vx, vy, vz) and fading
  flame(x, y, z, vx, vy, vz) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: Math.random() < 0.5 ? 0xff7a20 : 0xffc048, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    sprite.scale.setScalar(0.35 + Math.random() * 0.3);
    sprite.position.set(x, y, z);
    this.scene.add(sprite);
    this.sparkList.push({ sprite, t: 0, g: -2, life: 0.7, vx, vy, vz });
  }

  // the colours of a block's or item's own tile (for crumbs and chips)
  tileColors(id) {
    let colors = this._crumbColors?.get(id);
    if (!colors) {
      colors = [];
      const info = itemInfo(id);
      const b = info?.block;
      const tile = b ? (b.icon ?? (typeof b.textures === 'string' ? b.textures : b.textures.side)) : info?.texture;
      if (tile) {
        const d = generateTile(tile).getContext('2d').getImageData(0, 0, 16, 16).data;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) colors.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      if (!colors.length) colors.push(0xc8a060);
      (this._crumbColors ??= new Map()).set(id, colors);
    }
    return colors;
  }

  // chips of a block flying off as you dig it (n: a few per strike, a burst when it breaks)
  blockBits(x, y, z, id, n = 12) {
    if (!id || this.sparkList.length > 240) return;
    const colors = this.tileColors(id);
    const light = this.world.lightAt(x + 0.5, y + 0.5, z + 0.5);
    for (let i = 0; i < n; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: colors[(Math.random() * colors.length) | 0], transparent: true, depthWrite: false, fog: false }));
      sprite.material.color.multiplyScalar(light);
      sprite.scale.setScalar(0.07 + Math.random() * 0.06);
      sprite.position.set(x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7);
      this.scene.add(sprite);
      const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 1.6;
      this.sparkList.push({ sprite, t: 0, life: 0.55 + Math.random() * 0.3, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * s });
    }
  }

  // a bite of food: a few crumbs in its own colours fall from in front of your face
  crumbs(id) {
    const colors = this.tileColors(id);
    const p = this.player, dir = p.lookDir();
    const x = p.x + dir.x * 0.45, y = p.eyeY - 0.22 + dir.y * 0.3, z = p.z + dir.z * 0.45;
    for (let i = 0; i < 5; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: colors[(Math.random() * colors.length) | 0], transparent: true, depthWrite: false, fog: false }));
      sprite.scale.setScalar(0.04 + Math.random() * 0.03);
      sprite.position.set(x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.15);
      // lit like the terrain around you, so crumbs don't glow in a cave
      sprite.material.color.multiplyScalar(this.world.lightAt(x, y, z));
      this.scene.add(sprite);
      this.sparkList.push({ sprite, t: 0, vx: dir.x * 0.8 + (Math.random() - 0.5) * 1.2, vy: 0.6 + Math.random() * 1.2, vz: dir.z * 0.8 + (Math.random() - 0.5) * 1.2 });
    }
  }

  updateSparks(dt) {
    for (const s of this.sparkList) {
      s.t += dt;
      s.vy -= (s.g ?? 9) * dt;
      s.sprite.position.x += s.vx * dt; s.sprite.position.y += s.vy * dt; s.sprite.position.z += s.vz * dt;
      s.sprite.material.opacity = Math.max(0, 1 - s.t / (s.life ?? 0.5));
      if (s.t >= (s.life ?? 0.5)) { this.scene.remove(s.sprite); s.sprite.material.dispose(); }
    }
    this.sparkList = this.sparkList.filter((s) => s.t < (s.life ?? 0.5));
  }

  // Middle click: select the targeted block in the hotbar (creative: conjure it).
  pickBlock() {
    const t = this.interaction.target;
    if (!t) return;
    let id = t.id === B.FURNACE_LIT ? B.FURNACE : t.id;
    if (cropFamily(id)) id = cropFamily(id)[2];   // crops pick their seed (or carrot / potato)
    else if (id === B.OAK_DOOR_TOP) id = B.OAK_DOOR;
    else if (id === B.COCONUT) id = I.COCONUT;   // a hanging coconut picks the nut
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
      // a pet that came through the portal with you appears at your side
      const k = pets.indexOf(p) % 4;
      const at = p.arriving ? { x: this.player.x + [1, -1, 0, 0][k], y: this.player.y, z: this.player.z + [0, 0, 1, -1][k] } : p;
      const pet = new Cls(this.scene, this.world, at.x, at.y, at.z);
      if (p.arriving) (this.arrivingPets ??= []).push(pet);
      pet.tamed = true;
      pet.onTamed();
      pet.sitting = !!p.sitting;
      pet.health = p.health ?? pet.maxTamedHealth;
      if (Number.isInteger(p.coat)) pet.setCoat?.(p.coat);
      if (typeof p.name === 'string') pet.setName(p.name);
      if (typeof p.id === 'string') pet.id = p.id;
      if (Number.isFinite(p.born)) pet.born = p.born;
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
    this.viewModel.loose();
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
    // how much of each body the blast can reach, measured before any blocks
    // go: a wall between you and it shields you (damage used to go through)
    const reach = power * 2;
    const near = (e, h) => Math.hypot(e.x - x, e.y + h / 2 - y, e.z - z) < reach;
    const pExposure = near(this.player, 1.8) ? this.blastExposure(x, y, z, this.player.x, this.player.y, this.player.z, 0.6, 1.8) : 0;
    const mobExposure = new Map();
    for (const m of this.entities.mobs) if (!m.dead && near(m, m.h)) mobExposure.set(m, this.blastExposure(x, y, z, m.x, m.y, m.z, m.w, m.h));
    const removed = [];
    // underwater, the water takes the blast: it hurts but breaks no blocks
    const wet = isWater(this.world.getBlockW(cx, cy, cz)) || isWater(this.world.getBlockW(cx, cy + 1, cz));
    if (wet) settleWater(this.world, cx, cy, cz);   // a lit TNT block's empty cell
    for (let dx = -r; dx <= r && !wet; dx++) {
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
    // water beside the crater runs in (a few rounds, so it fills downward and inward)
    for (let pass = 0, more = true; pass < 4 && more; pass++) {
      more = false;
      for (let i = 0; i < removed.length; i += 3) more = settleWater(this.world, removed[i], removed[i + 1], removed[i + 2]) || more;
    }
    // torches, ladders, doors and the like left hanging fall off
    for (let i = 0; i < removed.length; i += 3) this.interaction.dropUnsupported(removed[i], removed[i + 1], removed[i + 2]);
    // damage falls off over twice the blast radius, and with cover
    const hurt = (ex, ey, ez, exposure) => {
      const d = Math.hypot(ex - x, ey - y, ez - z);
      return d < reach && exposure > 0 ? { d, dmg: Math.round((1 - d / reach) * (power * 4 + 2) * exposure), k: exposure } : null;
    };
    const p = this.player;
    const ph = hurt(p.x, p.y + 0.9, p.z, pExposure);
    if (ph && ph.dmg > 0) {
      p.hurtCooldown = 0;
      p.damage(ph.dmg, 'explosion');
      const k = (1 - ph.d / reach) * 9 * ph.k;
      p.vx += ((p.x - x) / (ph.d || 1)) * k;
      p.vz += ((p.z - z) / (ph.d || 1)) * k;
      p.vy = Math.max(p.vy, k * 0.7);
    }
    for (const m of this.entities.mobs) {
      const mh = hurt(m.x, m.y + m.h / 2, m.z, mobExposure.get(m) ?? 0);
      if (mh && mh.dmg > 0) { m.hurtCooldown = 0; m.damage(mh.dmg, { x, z, kind: 'explosion' }); }   // (a blast isn't a player: no grudges)
    }
    this.addBlast(x, y, z, power);
  }

  // Share (0..1) of 8 points on a body's box that a blast at (x, y, z) has a
  // clear line to through the blocks.
  blastExposure(x, y, z, ex, ey, ez, w, h) {
    let open = 0;
    for (const fx of [-0.35, 0.35]) for (const fy of [0.15, 0.85]) for (const fz of [-0.35, 0.35]) {
      const tx = ex + fx * w, ty = ey + fy * h, tz = ez + fz * w;
      const dx = tx - x, dy = ty - y, dz = tz - z, len = Math.hypot(dx, dy, dz);
      const steps = Math.ceil(len / 0.25);
      let clear = true;
      for (let i = 1; i < steps && clear; i++) {
        const t = i / steps;
        if (isSolid(this.world.getBlockW(Math.floor(x + dx * t), Math.floor(y + dy * t), Math.floor(z + dz * t)))) clear = false;
      }
      if (clear) open++;
    }
    return open / 8;
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
    // no rest in the Scorchlands (and no waking up there: you die home)
    if (this.dimension === SCORCH) {
      this.hud.showLabel('You can\u2019t sleep here \u2014 the night never ends', true);
      return;
    }
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
      // the night passes for the farm too: crops and saplings nearby grow as
      // if you'd stayed up (a stage at a time, as they would)
      const skipped = ((1 - this.time) % 1) * DAY_LENGTH_SECONDS;
      worldClock.now += skipped;
      for (let t = 0; t < skipped; t += 20) tickSaplings(this.world, Math.min(20, skipped - t));
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
    this.entities.spawnDrops(p.x, p.y + 0.5, p.z, stacks.map((s) => ({ ...s })), true);
    p.inventory.fill(null);
    p.armor.fill(null);
    p.events.dispatchEvent(new CustomEvent('inventory'));
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  }

  // Somewhere to stand by a bed: on it if there's headroom (two clear cells),
  // else beside it on solid ground; null if it's boxed in. (A bed in a
  // 2-high room used to put your head in the ceiling and pop you onto the roof.)
  bedSpawnSpot(bed) {
    const w = this.world;
    if (!w.isLoaded(bed.x, bed.z)) return { x: bed.x + 0.5, y: bed.y + 1.05, z: bed.z + 0.5 };
    // room to stand: not solid, and not water or lava either
    const free = (id) => !isSolid(id) && id !== B.WATER && id !== B.LAVA;
    const clear = (x, y, z) => free(w.getBlockW(x, y, z)) && free(w.getBlockW(x, y + 1, z));
    if (clear(bed.x, bed.y + 1, bed.z)) return { x: bed.x + 0.5, y: bed.y + 1.05, z: bed.z + 0.5 };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = bed.x + dx, z = bed.z + dz;
      for (const y of [bed.y, bed.y + 1, bed.y - 1]) {
        if (isSolid(w.getBlockW(x, y - 1, z)) && clear(x, y, z)) return { x: x + 0.5, y: y + 0.05, z: z + 0.5 };
      }
    }
    return null;
  }

  // Respawn at the bed if it's still there, otherwise at the world spawn.
  respawnPlayer() {
    const p = this.player;
    // died in the Scorchlands: you wake at home (bed or world spawn)
    if (this.dimension === SCORCH) {
      p.respawn();
      this.travel(OVERWORLD, { home: true });
      return;
    }
    const bed = p.bedPos;
    let note = null;
    // a bed in an unloaded chunk can't be checked: trust it rather than forget it
    const bedOk = bed && (!this.world.isLoaded(bed.x, bed.z) || this.world.getBlockW(bed.x, bed.y, bed.z) === B.BED);
    const spot = bedOk ? this.bedSpawnSpot(bed) : null;
    if (spot) {
      p.spawnPoint = spot;
    } else if (bedOk) {
      note = 'Your bed was blocked in, so you woke up at the world spawn.';
      p.spawnPoint = { ...p.worldSpawn ?? p.spawnPoint };
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
      sneak: { touch: 'tap Sneak', gamepad: 'click the right stick', key: `press ${keyLabel(this.input.bindings.sneak)}` },
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
    if (this.dimension === SCORCH) return SCORCH_DAYLIGHT;   // the night never ends there
    const t = this.time % 1;
    // sun elevation: sin over the day half
    const el = Math.sin(t * Math.PI * 2);
    return Math.max(0.03, Math.min(1, 0.5 + el * 2.2)) * (1 - 0.3 * (this.rainAmt ?? 0));   // (a grey day under rain)
  }

  // Showers come and go (minutes of rain, then a long clear spell). Rain
  // falls as snow where it's cold and not at all over a desert; it puts out
  // fires (and you) under the open sky, keeps the undead from burning and
  // the farmland wet.
  updateWeather(dt) {
    if (this.dimension === SCORCH) return;
    const w = this.weather;
    w.t -= dt;
    if (w.t <= 0) this.setWeather(w.kind === 'rain' ? 'clear' : 'rain');
    const target = w.kind === 'rain' ? 1 : 0;
    this.rainAmt += Math.sign(target - this.rainAmt) * Math.min(Math.abs(target - this.rainAmt), dt / 20);   // (twenty seconds to come on or clear)
    this.sky.setOvercast(this.rainAmt);
    const p = this.player, x = Math.floor(p.x), z = Math.floor(p.z);
    const exposed = this.world.getSkyW(x, Math.floor(p.eyeY), z) >= 15;
    this._cover = (this._cover ?? 0) + ((exposed ? 0 : 1) - (this._cover ?? 0)) * Math.min(1, dt * 3);
    const biome = this.world.biomeAt(x, z);
    const kind = biome === BIOME.DESERT ? null : this.world.gen.climateAt(x, z).t < 0.28 || p.y > 96 ? 'snow' : 'rain';
    this.weatherKindHere = kind;
    // (rain's effects where it falls: not in a desert, and snow puts out no fires)
    this.world.raining = this.rainAmt > 0.5 && kind === 'rain';
    this.weatherFx?.update(dt, p, this.rainAmt, p.headInWater ? null : kind, this._cover);
    if (kind === 'rain' && this.world.raining && exposed && p.fireTime > 0) { p.fireTime = 0; p.events.dispatchEvent(new CustomEvent('extinguish')); }
  }

  setWeather(kind, secs) {
    this.weather = { kind, t: secs ?? (kind === 'rain' ? 180 + Math.random() * 300 : 600 + Math.random() * 1200) };
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
    // in a background tab only furnaces, crops and the like carry on: you,
    // the mobs and the clock wait (you used to drown, or be killed, behind
    // the pause menu, and night fell while it was up)
    const away = this.paused || document.hidden;

    if (!away) { this.time += dt / DAY_LENGTH_SECONDS; worldClock.now += dt; }
    if (this.time >= 1) {
      this.time %= 1;
      this.newDay();
    }
    const day = this.dayFactor();
    this.world.materials.uniforms.uDay.value = day;
    this.world.materials.uniforms.uTime.value = (performance.now() / 1000) % 1000;

    // fog follows render distance
    const R = this.world.renderDistance * 16;
    this.world.materials.uniforms.uFogNear.value = R * (this.dimension === SCORCH ? 0.3 : 0.6 - 0.3 * (this.rainAmt ?? 0));   // (smoke hangs over the Scorchlands; rain closes in)
    this.world.materials.uniforms.uFogFar.value = R * 0.95;

    if (gamePaused || document.hidden) {
      // furnaces, crops and pots carry on in a background tab, and while an
      // inventory or furnace window is open (you watch the furnace work)
      if (document.hidden || (this.uiOpen && !this.paused && !this.sleeping)) this.tickBlockEntities(dt, true);
    } else {
      const wasInWater = this.player.inWater;
      const px0 = this.player.x, pz0 = this.player.z;
      this.player.update(this.input, dt, gamePaused);
      this.interaction.update(this.input, dt, gamePaused);
      this.entities.update(dt, this.player);
      if (this.player.mount) this.player.syncToMount();
      this.mobSpawner.update(dt, this.player, day);
      this.tickBlockEntities(dt);
      this.updatePortals(dt);
      this.updateWeather(dt);
      this.updateInspect(dt);
      (this.blockUpdates ??= new BlockUpdates(this)).update(dt);
      tickRanch(this, dt);   // (after the block updates: a fence just knocked down is seen)
      tickTrader(this, dt);
      tickCustomers(this, dt);
      if (this.dimension === SCORCH) this.updateDragon(dt);

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
      // swimming: a stroke every couple of blocks
      if (this.player.inWater && !this.player.onGround && !this.player.flying) {
        this._swimDistance = (this._swimDistance ?? 0) + Math.hypot(this.player.x - px0, this.player.z - pz0, this.player.vy * dt * 0.5);
        if (this._swimDistance > 2.4) { this._swimDistance = 0; this.sfx?.play('swim'); }
      }
    }

    this.highlight.update(this.interaction.target, this.interaction.breakProgress, this.world);
    this.updateBlasts(dt);
    this.updateSparks(dt);
    // putting the rod away reels the line in
    if (this.bobber && (this.bobber.dead || this.player.heldStack()?.id !== I.FISHING_ROD)) { this.bobber.kill(); this.bobber = null; }
    this.updateBubbles(dt);
    this.sfx?.setUnderwater(this.player.headInWater && !this.player.dead && !this.paused);
    if (!gamePaused) this.updateAmbience(dt);
    // the nearest boss you're fighting (or close to) gets a health bar
    let boss = null, bd = 24;
    for (const m of this.entities.mobs) {
      if (!m.boss || m.dead || m.dying !== undefined) continue;
      const d = Math.hypot(m.x - this.player.x, m.y - this.player.y, m.z - this.player.z);
      if (d < bd && (d < 14 || m.state === 'chase' || (m.kind === 'dragon' && d < 64))) { boss = m; bd = d; }
    }
    this.hud.setBoss(this.player.dead ? null : boss);
    this.sinceAttack += dt;
    if (!this.fireEl) this.fireEl = document.getElementById('fire-overlay');
    this.fireEl?.classList.toggle('on', this.player.fireTime > 0 && !this.player.dead);
    // frost at the edges as you chill (from a third of the way)
    if (!this.frostEl) this.frostEl = document.getElementById('frost-overlay');
    const frost = this.player.dead ? 0 : Math.max(0, ((this.player.freeze ?? 0) - 0.15) / 0.85);
    if (this.frostEl && Math.abs(frost - (this._frost ?? 0)) > 0.01) { this._frost = frost; this.frostEl.style.opacity = frost.toFixed(2); }
    if (!this.chargeEl) { this.chargeEl = document.getElementById('attack-charge'); this.chargeBar = this.chargeEl?.firstElementChild; }
    if (this.chargeEl) {
      const c = this.attackCharge();
      this.chargeEl.classList.toggle('hidden', c >= 1 || this.player.dead);
      if (c < 1) this.chargeBar.style.width = `${(c * 100) | 0}%`;
    }
    this.campfireFx.update(gamePaused ? 0 : dt, this.player);
    this.scorchFx?.update(gamePaused ? 0 : dt, this.player, !this.player.headInWater);
    this.signFx.update(dt, this.player);

    // camera follows player eye
    this.camera.position.set(this.player.x, this.player.eyeY, this.player.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotateY(this.player.yaw);
    this.camera.rotateX(this.player.pitch);
    this.updateViewModel(dt, gamePaused);
    // drawing a bow zooms in a little and fills a meter under the crosshair
    // (and sprinting widens it a touch)
    const charge = this.interaction.bowCharge;
    if (charge !== this._lastCharge) { this._lastCharge = charge; this.hud.setBowCharge(charge); }
    const sprint = this.player.sprinting && !this.player.mount && Math.hypot(this.player.vx, this.player.vz) > 4 && this.viewModel?.bobbing !== false ? 1 : 0;
    this._sprintFov = (this._sprintFov ?? 0) + (sprint - (this._sprintFov ?? 0)) * Math.min(1, dt * 8);
    const fov = (this.baseFov ?? 75) * (1 - 0.12 * charge) * (1 + 0.07 * this._sprintFov);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // sky, then the underwater tint over it: after the player has moved, so
    // the frame you dive or surface doesn't flash the other one's look
    this.sky.update(this.time, day, this.player, this.player.headInWater);
    this.applyUnderwaterEffect();
    const fu = this.world.materials.uniforms, fog = this.scene.fog;
    fog.color.copy(fu.uFogColor.value);
    fog.near = fu.uFogNear.value;
    fog.far = fu.uFogFar.value;

    // a hidden tab keeps the world ticking (and loading) but draws nothing
    // (which way you're looking: the chunks in front are lit and meshed first)
    this.world.update(this.player.x, this.player.z, now, document.hidden || this.loading ? 3 : 1, -Math.sin(this.player.yaw), -Math.cos(this.player.yaw));   // (behind the loading screen: a bigger share of each frame)
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
      // real time, not game time: a slow device runs the game slowly, but the
      // edits you made are just as worth keeping every 10 seconds
      if (now - this.lastSaveAt > this.saveEvery && !this.loading) {   // (not while it's still loading: Cancel leaves the save as it was)   // only changed chunks are written, so this is cheap
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
      eatTime: this.interaction.eating ? Math.max(1e-3, this.interaction.eating.t) : 0,
      drinking: !!(this.interaction.eating && itemInfo(this.interaction.eating.id)?.drink),
      mining: !paused && !!this.interaction.breakTarget && this.input.mouseDown(0),
      speed: Math.hypot(p.vx, p.vz),
      onGround: p.onGround && !p.flying,
      light,
      visible: !p.dead && !this.hud.root.classList.contains('bare'),
      chest: (p.armor[1] && itemInfo(p.armor[1].id)?.armor?.material) ?? null,
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
    // underground: caves echo, and the music turns low and sparse
    const sky = this.world.getSkyW(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    const cave = p.headInWater ? 0 : sky === 0 && p.y < 60 ? 1 : sky < 6 ? 0.4 : 0;
    sfx.setCave(cave);
    const bossNear = this.entities.mobs.some((m) => m.boss && !m.dead && m.dying === undefined && m.state === 'chase');
    const scorch = this.dimension === SCORCH;
    // rain on the roof (or all round you, out in it)
    if (this.rainAmt > 0.05 && this.weatherKindHere === 'rain' && cave < 1) {
      this._rainT = (this._rainT ?? 0) - dt;
      if (this._rainT <= 0) { this._rainT = 2; sfx.play('rain', { vol: this.rainAmt * (this._cover > 0.5 ? 0.4 : 1) }); }
    }
    this.music?.update(dt, p.dead || bossNear ? null : cave >= 1 ? 'cave' : scorch ? 'scorch' : this.dayFactor() < 0.35 ? 'night' : 'day');
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
      if ((id === B.FIRE || id === B.CAMPFIRE || id === B.SMOULDERING_STUMP) && Math.random() < 0.7) sfx.play('crackle', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
      else if (id === B.LAVA && this.world.getBlockW(x, y + 1, z) === B.AIR && Math.random() < 0.35) sfx.play('lavapop', { pos: { x: x + 0.5, y: y + 1, z: z + 0.5 } });
    }
    if (sky === 0 && p.y < 50 && Math.random() < 0.35 / 60) sfx.play('drone');   // about once a minute, deep down
    // the Scorchlands: hot wind through dead trees, and their trunks creaking
    if (scorch) {
      if (sky >= 10 && Math.random() < 0.35 / 14) sfx.play('wind');
      if (sky >= 10 && Math.random() < 0.35 / 20) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 12;
        sfx.play('creak', { pos: { x: p.x + Math.cos(a) * r, y: p.y + 3, z: p.z + Math.sin(a) * r } });
      }
      return;
    }
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

  // `away`: a background tab - the world's own ticks only, nothing that
  // touches the player (a campfire burning you, a spawner's monsters)
  tickBlockEntities(dt, away = false) {
    tickFurnaces(this.world, dt);
    tickSaplings(this.world, dt);
    tickCampfires(this.world, dt, (x, y, z, drops) => this.entities.spawnDrops(x, y, z, drops));
    tickPots(this.world, dt, (x, y, z) => this.sfx?.play('simmer', { pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, vol: 1.5 }));
    if (!away) tickSpawners(this, dt);
    tickFarmTech(this, dt);
    tickRandomGrowth(this.world, this.player, dt);
    tickFires(this.world, dt);
    if (!away) this.burnInCampfires(dt);
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
    this.settings = s;   // (shared with the settings screen; /rd writes to it)
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
    this.lastSaveAt = performance.now();
    this.saveEvery = 10000;
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
        kind: m.kind, x: m.x, y: m.y, z: m.z, sitting: m.sitting, health: m.health, ...(Number.isInteger(m.coat) ? { coat: m.coat } : {}),
        ...(m.name ? { name: m.name } : {}), ...(m.id ? { id: m.id } : {}), ...(Number.isFinite(m.born) ? { born: m.born } : {}),
        ...(m.travelling ? { travel: true } : {}),   // coming through the portal with you
      })),
      animals: this.entities.keptAnimals(),
      timeOfDay: this.time,
      clock: Math.round(worldClock.now),
      ...(this.dimension === SCORCH ? {} : { weather: { kind: this.weather.kind, t: Math.round(this.weather.t) } }),
      day: this.day,
      difficulty: this.difficulty,
      mode: this.player.mode,   // the world list shows it (after /gamemode too)
      playerData: this.player.serialize(this.containers.heldStacks()),
      drops: this.entities.savedDrops(),
      lastPlayed: Date.now(),
    });
    const done = this.store.saveWorld(this.worldMeta, [...loaded, ...evicted], this.dimension).then(() => {
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
    this.sfx?.setCave(0);
    this.music?.stop(1);
    const saving = this.store && save ? this.save() : null;
    this.teardown();
    return saving;
  }

  // Release everything the game holds. Each step stands alone, so this also
  // cleans up a game whose constructor threw part-way (missing parts skipped).
  teardown() {
    this.running = false;
    const steps = [
      () => this.ticker?.terminate(),
      // drop every document/window listener so a later world doesn't inherit them
      () => this.input?.dispose(),
      () => this.containers?.dispose(),
      () => this.chat?.dispose(),
      () => this.touch?.dispose(),
      () => this.viewModel?.dispose(),
      () => this.campfireFx?.dispose(),
      () => this.scorchFx?.dispose(),
      () => this.weatherFx?.dispose(),
      () => this.signFx?.dispose(),
      () => this.sky?.dispose(),
      () => this.hud?.setInspect(null),
      () => this.hud?.hide(),
      () => { for (const id of ['frost-overlay', 'portal-overlay']) { const f = document.getElementById(id); if (f) f.style.opacity = '0'; } },   // (shared: not into the next world)
      () => document.removeEventListener('visibilitychange', this._onVisibility),
      () => window.removeEventListener('resize', this._onResize),
      () => this.entities?.dispose(),
      () => this.world?.dispose(),
      () => this.highlight?.dispose(),
      () => { for (const s of [...(this.sparkList ?? []), ...(this.bubbles ?? [])]) { s.sprite.removeFromParent(); s.sprite.material.dispose(); } },
      () => { for (const b of this.blasts ?? []) { b.mesh.removeFromParent(); b.mesh.material.dispose(); } },
      () => this.bubbleTex?.dispose(),
      () => this.renderer?.renderLists.dispose(),
    ];
    for (const step of steps) { try { step(); } catch (err) { console.warn('teardown:', err); } }
  }
}
