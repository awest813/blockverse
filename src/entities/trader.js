// The travelling trader: every couple of days, by day, a trader comes by
// your market stall (or wherever you are) for a while, with a few things
// the stall never has, a want or two it pays well over the odds for, and a
// fair: lead an animal up and it's judged on its breeding, for a prize and
// a ribbon.
//
// The visit lives in the world entry, so a reload mid-visit finds the
// trader still there: worldMeta.trader = {next, until, x, y, z, visit,
// offers: [[id, price]], wants: [[id, price, left]], judged: [animal ids]}

import { Mob } from './mob.js';
import { B } from '../blocks/blocks.js';
import { I } from '../items/itemIds.js';
import { worldClock } from '../core/clock.js';
import { DAY_LENGTH_SECONDS } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';
import { SELLS, bump } from '../world/market.js';
import { traitScore } from './traits.js';
import { GAMEMODE_CREATIVE } from '../core/constants.js';
import { forEachBlockEntity } from '../items/campfire.js';
import { startSpot } from './customers.js';

const STAY = 600;                        // seconds a visit lasts
const EVERY = 2 * DAY_LENGTH_SECONDS;    // between visits

// what it might bring (four a visit): [item, price]
const RARE = [
  [I.GOLDEN_APPLE, 20], [I.DIAMOND_HORSE_ARMOR, 70], [I.GOLD_HORSE_ARMOR, 24], [I.SADDLE, 12], [I.NAME_TAG, 4],
  [I.GOLDEN_CARROT, 5], [I.MELON_SEEDS, 2], [I.RICE, 1], [I.BERRIES, 1], [B.CORNFLOWER, 1], [I.SCORCH_PEPPER, 6],
  [I.PURPLE_DYE, 2], [I.CYAN_DYE, 2], [I.BLUE_DYE, 2], [I.LEDGER, 6], [I.WHISTLE, 7], [B.BEEHIVE, 9],
];
// what it might want (two a visit), paid at twice the stall's best
const WANTED = [I.CHEESE, I.BUTTER, I.HONEY_BOWL, I.GOAT_MILK_BUCKET, I.EGG, I.DUCK_EGG, I.LEATHER, I.SCORCH_PEPPER, I.BERRY_PIE, I.CHEESE_SANDWICH, B.PUMPKIN, B.MELON];

export class Trader extends Mob {
  constructor(scene, world, x, y, z) {
    super(scene, world, x, y, z);
    this.w = 0.6; this.h = 1.9; this.health = 20;
    this.speed = 0.8; this.fleeSpeed = 0.8;
    this.kind = 'trader';
    this.countsForCap = false;
    this.spot = { x, z };
  }

  buildModel() {
    const robe = 0x5a3a8a, trim = 0xe0b040, skin = 0xd8a880, hat = 0x6a4a2a, pack = 0x8a5a2c;
    this.part(0.52, 0.8, 0.32, robe, 0, 1.08, 0);              // robe
    this.part(0.54, 0.08, 0.34, trim, 0, 0.72, 0);             // its hem
    this.part(0.42, 0.42, 0.42, skin, 0, 1.72, 0);             // head
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, -0.1, 1.78, -0.22);
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, 0.1, 1.78, -0.22);
    this.part(0.3, 0.12, 0.06, 0x8a6a5a, 0, 1.6, -0.22);       // beard
    this.part(0.8, 0.06, 0.8, hat, 0, 1.96, 0);                // a broad hat
    this.part(0.44, 0.22, 0.44, hat, 0, 2.08, 0);
    this.part(0.44, 0.5, 0.26, pack, 0, 1.2, 0.3);             // the pack on its back
    this.part(0.14, 0.6, 0.16, robe, -0.34, 1.12, 0);          // arms
    this.part(0.14, 0.6, 0.16, robe, 0.34, 1.12, 0);
    const leg = (x) => {
      const l = this.part(0.18, 0.66, 0.2, 0x3a2a20, x, 0.66, 0);
      l.geometry = l.geometry.clone(); l.geometry.translate(0, -0.33, 0); l.position.y = 0.66;
      return l;
    };
    this.legs = [leg(-0.13), leg(0.13)];
  }

  // pottering about its spot; it turns to face you when you come up
  think(dt, player, playerDist) {
    this.stateTime -= dt;
    // still on the road in: walk up to its spot (by your stall), only
    // stopping if you're right in its way
    this.speed = this.arrived ? 0.8 : 1.3;
    if (!this.arrived && !(playerDist < 1.8)) {
      this.arrived = this.goTo(dt, this.spot.x, this.y, this.spot.z, 1.2) || (this.trip = (this.trip ?? 0) + dt) > 60;
      if (this.arrived && this.trip > 60) { this.x = this.spot.x; this.z = this.spot.z; if (Number.isFinite(this.spot.y)) this.y = this.spot.y; }   // (no way through: it finds one)
      return;
    }
    if (playerDist < 5 && !player.dead) { this.moving = false; this.targetYaw = Math.atan2(-(player.x - this.x), -(player.z - this.z)); return; }
    if (this.stateTime > 0) return;
    this.stateTime = 2 + Math.random() * 4;
    const far = Math.hypot(this.spot.x - this.x, this.spot.z - this.z) > 4;
    this.moving = far || Math.random() < 0.4;
    this.targetYaw = far ? Math.atan2(-(this.spot.x - this.x), -(this.spot.z - this.z)) : Math.random() * Math.PI * 2;
  }

  damage() { return false; }   // (nobody harms a trader)

  // right-click: the fair for the animals you're leading, or its wares
  interact(player) {
    const led = (this.fx?.mobs() ?? []).filter((m) => m.leash?.player === player && !m.dead && m.breedItem);
    if (led.length && this.fx?.judge?.(led)) return true;
    this.fx?.openTrader?.();
    return true;
  }
}

function visitRng(T) {
  return mulberry32((T.visit * 2654435761) >>> 0);
}

// a new visit's wares
function stock(T) {
  const rng = visitRng(T), pick = (list, n) => {
    const pool = [...list], out = [];
    while (out.length < n && pool.length) out.push(pool.splice((rng() * pool.length) | 0, 1)[0]);
    return out;
  };
  T.offers = pick(RARE, 4);
  // (never wanting what it's selling: no buying from it to sell straight back)
  T.wants = pick(WANTED.filter((id) => !T.offers.some(([o]) => o === id)), 2).map((id) => [id, Math.max(1, Math.round((SELLS.get(id) ?? 1) * 2)), 8]);
  T.judged = [];
}

// a spot for the trader to stand: by your market stall if there's one near
// (one you've used within 64 blocks, or any within 24), else near you
function arrivalSpot(world, p) {
  const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
  let at = null, best = 64;
  forEachBlockEntity(world, 'stall', (x, y, z) => {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best && world.getBlockW(x, y, z) === B.MARKET_STALL) { best = d; at = { x, z: z + 2, sy: y, stall: true }; }
  });
  for (let dx = -24; dx <= 24 && !at; dx++) for (let dz = -24; dz <= 24 && !at; dz++) for (let dy = -4; dy <= 4; dy++) {
    if (world.getBlockW(px + dx, py + dy, pz + dz) === B.MARKET_STALL) { at = { x: px + dx, z: pz + dz + 2, sy: py + dy, stall: true }; break; }
  }
  if (!at) { const a = Math.random() * Math.PI * 2; at = { x: Math.floor(p.x + Math.cos(a) * 9), z: Math.floor(p.z + Math.sin(a) * 9) }; }
  // the ground there
  const by = at.sy ?? py;
  let y = by + 6;
  while (y > by - 8 && !world.getBlockW(at.x, y - 1, at.z)) y--;
  if (world.getBlockW(at.x, y, at.z) || world.getBlockW(at.x, y + 1, at.z)) return null;   // (no room: try again later)
  return { x: at.x + 0.5, y, z: at.z + 0.5, stall: at.stall };
}

// A visit from a save, checked once a session (an imported file may say
// anything): times within reason, a real spot, and wares at whole prices.
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const checked = new WeakSet();   // (visits checked this session: not saved, so a reload checks again)
function checkVisit(T, now) {
  if (!T || typeof T !== 'object' || Array.isArray(T)) return { next: now + DAY_LENGTH_SECONDS, visit: 0 };
  const out = { visit: whole(T.visit, 0, 1e9) ? T.visit : 0 };
  out.next = Number.isFinite(T.next) ? Math.min(T.next, now + EVERY) : now + DAY_LENGTH_SECONDS;
  const spot = [T.x, T.y, T.z].every(Number.isFinite);
  if (spot && Number.isFinite(T.until) && T.until > now) {
    Object.assign(out, { until: Math.min(T.until, now + STAY), x: T.x, y: T.y, z: T.z });
    out.offers = (Array.isArray(T.offers) ? T.offers : []).filter((o) => Array.isArray(o) && Number.isInteger(o[0]) && whole(o[1], 1, 999)).slice(0, 4);
    out.wants = (Array.isArray(T.wants) ? T.wants : []).filter((o) => Array.isArray(o) && Number.isInteger(o[0]) && whole(o[1], 1, 999) && whole(o[2], 0, 8)).slice(0, 2);
    out.judged = (Array.isArray(T.judged) ? T.judged : []).filter((id) => typeof id === 'string').slice(0, 64);
  }
  return out;
}

// Every couple of seconds: does the trader come, stay or go?
let timer = 0;
export function tickTrader(game, dt) {
  timer -= dt;
  if (timer > 0 || game.dimension !== 'overworld') return;
  timer = 2;
  const meta = game.worldMeta, now = worldClock.now, p = game.player;
  if (!meta.trader || typeof meta.trader !== 'object' || !checked.has(meta.trader)) { meta.trader = checkVisit(meta.trader, now); checked.add(meta.trader); }
  const T = meta.trader;
  const live = game.entities.mobs.find((m) => m.kind === 'trader' && !m.dead);
  const night = game.isNight();
  if (Number.isFinite(T.until) && T.until > now && !night) {
    if (!live && Math.hypot(T.x - p.x, T.z - p.z) < 48 && game.world.isLoaded(Math.floor(T.x), Math.floor(T.z))) {
      const t = new Trader(game.scene, game.world, T.x, T.y, T.z);
      game.entities.addMob(t);
    }
    return;
  }
  if (live) {   // its time's up (or night's falling): off it goes
    live.kill();
    T.until = 0;
    game.hud.showLabel('The travelling trader packs up and moves on');
    return;
  }
  if (!(now >= T.next) || night || p.dead) return;
  const at = arrivalSpot(game.world, p);
  if (!at) return;
  T.visit = (Number.isInteger(T.visit) ? T.visit : 0) + 1;
  T.next = now + EVERY; T.until = now + STAY;
  Object.assign(T, { x: at.x, y: at.y, z: at.z });
  stock(T);
  // to a stall, it walks in from up the road; otherwise it's just come up behind you
  const from = at.stall && startSpot(game.world, { x: Math.floor(at.x), y: at.y, z: Math.floor(at.z) });
  const t = new Trader(game.scene, game.world, from?.x ?? at.x, from?.y ?? at.y, from?.z ?? at.z);
  t.spot = { x: at.x, y: at.y, z: at.z };
  t.arrived = !from;
  game.entities.addMob(t);
  game.sfx?.play('pickup', { pitch: 0.8 });
  game.hud.showLabel(at.stall ? (from ? 'A travelling trader is on its way to your market stall' : 'A travelling trader has come by your market stall') : 'A travelling trader has come by — and holds a fair: lead an animal to it', true);
}

// ---- the fair ----

const RIBBONS = ['yellow', 'red', 'blue'];
export const ribbonName = (r) => ({ blue: 'Blue ribbon (first)', red: 'Red ribbon (second)', yellow: 'Yellow ribbon (third)' }[r] ?? null);

// Judge the animals you've led up (each once a visit): true if any were.
export function judge(game, led) {
  const T = game.worldMeta.trader;
  if (!T) return false;
  T.judged = Array.isArray(T.judged) ? T.judged : [];
  // grown animals of your own, three entries a visit
  const yours = led.filter((m) => m.persistent && !m.baby);
  if (!yours.length) { game.hud.showLabel('Only grown animals of your own can be entered in the fair'); return false; }
  const room = Math.max(0, 3 - T.judged.length);
  const fresh = yours.filter((m) => !T.judged.includes(m.ensureId())).slice(0, room);
  if (!fresh.length) { game.hud.showLabel(room ? 'Those have been judged this visit: come back next time' : 'The fair\u2019s full this visit: three entries a visit'); return false; }
  const p = game.player, said = [];
  for (const m of fresh) {
    T.judged.push(m.id);
    let score = traitScore(m);
    if (Number.isFinite(m.mood) && m.pen) score += (m.mood / 100 - 0.5) * 0.2;   // (a contented beast shows well)
    if (m.golden || m.dye === 'black' || /bald/.test(m.coatName ?? '')) score += 0.15;   // (and a rare one stands out)
    score = Math.max(0, Math.min(1, score));
    const place = score >= 0.72 ? 2 : score >= 0.5 ? 1 : 0;
    const prize = Math.round(4 + score * 26);
    if (RIBBONS.indexOf(m.ribbon) < place) m.ribbon = RIBBONS[place];
    if (p.mode !== GAMEMODE_CREATIVE) {
      const left = p.give(I.COIN, prize);
      if (left > 0) game.entities.spawnDrops(p.x, p.y + 1, p.z, [{ id: I.COIN, count: left }]);
    }
    bump(game.worldMeta, 'coins', prize);
    said.push(`${m.name ?? 'Your ' + (m.label ?? m.kind)}: ${RIBBONS[place]} ribbon, ${prize} coins`);
    game.sparks?.(m.x, m.y + m.h + 0.3, m.z, place === 2 ? 0x4060e0 : place === 1 ? 0xd04040 : 0xe0c040, 12);
  }
  p.events.dispatchEvent(new CustomEvent('inventory'));
  game.sfx?.play('pickup', { pitch: 1.5 });
  game.hud.showLabel(said.join(' · '), false);
  return true;
}
