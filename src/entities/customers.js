// Customers at your market stall: by day, while there's something on its
// shelf, now and then someone walks up from out of the countryside, looks
// over what's there, buys what they like (coins into the stall's till),
// and goes on their way. One at a time; nobody comes at night. While you're
// away, the stall's catch-up does the selling (world/stall.js).

import { Mob } from './mob.js';
import { B, isSolid, blockInfo } from '../blocks/blocks.js';
import { worldClock } from '../core/clock.js';
import { itemInfo } from '../items/items.js';
import { forEachBlockEntity } from '../items/campfire.js';
import { stallState, customerBuys, pickCustomer, catchUp, shelfEmpty, CUSTOMER_EVERY } from '../world/stall.js';

const NEAR = 40;          // a stall this close to you has live customers
const GIVE_UP = 90;       // seconds a customer spends trying to get there
const MAX_AGE = 300;      // by the world's clock: however it's gone, it's gone by then
const OFF = 28;           // how far off they head when they leave

export class Customer extends Mob {
  constructor(scene, world, x, y, z, type, stall) {
    Customer.dress = type.colours;   // (the model's built in super(), before `this` is ours)
    super(scene, world, x, y, z);
    this.w = 0.6; this.h = 1.8; this.health = 20;
    this.speed = 1.7; this.fleeSpeed = 1.7;
    this.kind = 'customer';
    this.label = type.label.replace(/^An? /, '').toLowerCase();   // (for the inspect card)
    this.bornAt = worldClock.now;
    this.countsForCap = false;
    this.type = type;
    this.stall = stall;      // {x, y, z}
    this.state = 'come';
    this.stateTime = 0;
    this.trip = 0;
    this.exit = null;
  }

  buildModel() {
    const [coat, trim] = Customer.dress ?? [0x8a6a4a, 0x5a4a3a], skin = 0xd8a880;
    this.part(0.5, 0.72, 0.3, coat, 0, 1.06, 0);               // coat
    this.part(0.52, 0.08, 0.32, trim, 0, 0.74, 0);             // belt
    this.part(0.42, 0.42, 0.42, skin, 0, 1.64, 0);             // head
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, -0.1, 1.7, -0.22);
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, 0.1, 1.7, -0.22);
    this.part(0.46, 0.12, 0.46, trim, 0, 1.9, 0);              // a cap
    this.part(0.14, 0.56, 0.16, coat, -0.32, 1.06, 0);         // arms
    this.part(0.14, 0.56, 0.16, coat, 0.32, 1.06, 0);
    this.part(0.3, 0.16, 0.2, 0xb08a50, 0.34, 0.74, -0.08);    // a basket on one arm
    const leg = (x) => {
      const l = this.part(0.18, 0.66, 0.2, 0x3a3a46, x, 0.66, 0);
      l.geometry = l.geometry.clone(); l.geometry.translate(0, -0.33, 0); l.position.y = 0.66;
      return l;
    };
    this.legs = [leg(-0.13), leg(0.13)];
  }

  think(dt, player) {
    this.trip += dt;
    const s = this.stall;
    if (this.state === 'come') {
      const there = this.goTo(dt, s.x + 0.5, s.y, s.z + 0.5, 1.7);
      if (there) { this.state = 'look'; this.stateTime = 2.5; this.moving = false; }
      else if (this.trip > GIVE_UP) this.leave();   // (couldn't find the way)
      return;
    }
    if (this.state === 'look') {
      this.moving = false;
      this.targetYaw = Math.atan2(-(s.x + 0.5 - this.x), -(s.z + 0.5 - this.z));
      this.stateTime -= dt;
      if (this.stateTime <= 0) { this.fx?.customerBuys?.(this); this.leave(); }
      return;
    }
    // off again, the way it came
    if (this.exit) this.goTo(dt, this.exit.x, this.y, this.exit.z, 1.5);
    // stuck on the way (a tree, a wall): note it every few seconds
    this.stuckT = (this.stuckT ?? 0) + dt;
    if (this.stuckT > 3) {
      if (Math.hypot(this.x - (this.lastX ?? 0), this.z - (this.lastZ ?? 0)) < 0.6) this.stuck = (this.stuck ?? 0) + 1;
      this.lastX = this.x; this.lastZ = this.z; this.stuckT = 0;
    }
    // gone once well away and out of your sight (or there, or stuck)
    const dx = this.x - player.x, dz = this.z - player.z, d = Math.hypot(dx, dz);
    const look = player.lookDir(), behind = dx * look.x + dz * look.z < 0;
    const there = this.exit && Math.hypot(this.exit.x - this.x, this.exit.z - this.z) < 2;
    if (this.trip > GIVE_UP * 2.5 || d > OFF || (d > 16 && behind) || (there && d > 12) || (this.stuck >= 2 && d > 10)) this.kill();
  }

  // off along the way it came (away from the stall's middle), well out of the way
  leave(turn = 0) {
    this.state = 'go';
    this.path = null;
    const cx = this.stall.x + 0.5, cz = this.stall.z + 0.5;
    let a = Math.atan2(this.z - cz, this.x - cx) + turn;
    if (!Number.isFinite(a)) a = Math.random() * Math.PI * 2;
    this.exit = { x: cx + Math.cos(a) * OFF, z: cz + Math.sin(a) * OFF };
  }

  // never into lava, water or off a drop: on the way there, give up; on the
  // way off, try another way
  avoidHazards() {
    if (!this.moving || !this.onGround) return;
    const ax = Math.floor(this.x - Math.sin(this.yaw) * (this.w / 2 + 0.6));
    const az = Math.floor(this.z - Math.cos(this.yaw) * (this.w / 2 + 0.6));
    const y = Math.floor(this.y);
    let drop = 0, bad = false;
    for (; drop < 4 && !isSolid(this.world.getBlockW(ax, y - 1 - drop, az)); drop++) {
      const id = this.world.getBlockW(ax, y - 1 - drop, az);
      if (id === B.LAVA || id === B.WATER) { bad = true; break; }
    }
    const here = this.world.getBlockW(ax, y, az);
    if (!(bad || drop >= 4 || here === B.LAVA || here === B.WATER || here === B.FIRE)) return;
    this.moving = false; this.vx = this.vz = 0;
    if (this.state === 'come') this.leave();
    else if (this.state === 'go') this.leave((this.turns = (this.turns ?? 0) + 1) * Math.PI / 2);
  }

  damage() { return false; }   // (customers come in peace, and so should you)

  interact() {
    this.fx?.say?.(this.state === 'go' ? 'Good day to you!' : 'Just looking, thanks');
    return true;
  }
}

// somewhere 14-20 blocks from the stall, on dry open ground (under the
// sky: not in a cave, nor up a tree), to set out from
function startSpot(world, s) {
  for (let k = 0; k < 8; k++) {
    const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 6;
    const x = Math.floor(s.x + Math.cos(a) * d), z = Math.floor(s.z + Math.sin(a) * d);
    if (!world.isLoaded(x, z)) continue;
    let y = s.y + 8;
    while (y > s.y - 10 && !isSolid(world.getBlockW(x, y - 1, z))) y--;
    const below = world.getBlockW(x, y - 1, z);
    if (!isSolid(below) || world.getBlockW(x, y, z) || world.getBlockW(x, y + 1, z)) continue;
    if (world.getSkyW(x, y, z) < 15 || Math.abs(y - s.y) > 4 || /leaves/.test(blockInfo(below).name)) continue;
    return { x: x + 0.5, y, z: z + 0.5 };
  }
  return null;
}

const nextAt = new Map();   // stall key -> clock time the next customer sets out (not saved)
const key = (s) => `${s.x},${s.y},${s.z}`;

// a new world (or the other one): nobody's on their way
export function resetCustomers() { nextAt.clear(); timer = 0; markTimer = 0; }

// a customer for this stall soon (just stocked: don't keep them waiting long)
export function hurryCustomer(s) {
  const k = key(s), soon = worldClock.now + 10 + Math.random() * 15;
  if (!(nextAt.get(k) <= soon)) nextAt.set(k, soon);
}

let timer = 0, markTimer = 0;
export function tickCustomers(game, dt) {
  timer -= dt;
  if (timer > 0) return;
  timer = 1;
  markTimer -= 1;
  const w = game.world, p = game.player, now = worldClock.now, meta = game.worldMeta;
  let live = game.entities.mobs.filter((m) => m.kind === 'customer' && !m.dead);
  if (game.dimension !== 'overworld') return;
  const night = game.isNight();
  // the stalls near you: catch up on who came while you were gone, and keep
  // their clocks current while you're here (now and then: it's a save)
  // (a customer left in a chunk that's gone, or out too long, is gone too:
  // one stuck somewhere would keep everyone else away)
  for (const c of live) if (!w.isLoaded(Math.floor(c.x), Math.floor(c.z)) || !(now - c.bornAt < MAX_AGE)) c.kill();
  const stalls = [];
  forEachBlockEntity(w, 'stall', (x, y, z) => {
    if (Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) > NEAR || w.getBlockW(x, y, z) !== B.MARKET_STALL) return;
    const st = stallState(w, x, y, z), s = { x, y, z, st };
    // back after a while away: who came meanwhile (nothing if you never left)
    const { came } = catchUp(meta, st, now);
    if (came || markTimer <= 0) w.setBlockEntity(x, y, z, st);   // (its clock: saved now and then)
    if (came) game.hud.showLabel(`While you were away, ${came} customer${came === 1 ? '' : 's'} came by your stall: ${Math.floor(st.till)} coin${Math.floor(st.till) === 1 ? '' : 's'} in the till`, true);
    stalls.push(s);
  });
  if (markTimer <= 0) markTimer = 30;
  // customers whose stall's gone (or night's falling) head off
  for (const c of live) if (c.state !== 'go' && (night || w.getBlockW(c.stall.x, c.stall.y, c.stall.z) !== B.MARKET_STALL)) c.leave();
  live = live.filter((c) => !c.dead);
  if (night || p.dead || live.length) return;
  // one at a time, to the nearest stall with something on its shelf
  const s = stalls.filter((q) => !shelfEmpty(q.st)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  if (!s) return;
  const k = key(s);
  if (!nextAt.has(k)) nextAt.set(k, now + CUSTOMER_EVERY * (0.3 + Math.random() * 0.5));
  if (now < nextAt.get(k)) return;
  const type = pickCustomer(s.st);
  const at = type && startSpot(w, s);
  if (!at) return;
  nextAt.set(k, now + CUSTOMER_EVERY * (0.6 + Math.random() * 0.8));
  game.entities.addMob(new Customer(game.scene, w, at.x, at.y, at.z, type, { x: s.x, y: s.y, z: s.z }));
}

// at the stall: buy, and say so if you're about
export function buyAtStall(game, c) {
  const { x, y, z } = c.stall, w = game.world;
  if (w.getBlockW(x, y, z) !== B.MARKET_STALL) return;
  const st = stallState(w, x, y, z);
  const got = customerBuys(game.worldMeta, st, c.type);
  st.at = worldClock.now;
  w.setBlockEntity(x, y, z, st);
  if (!got.length) return;
  const p = game.player;
  if (Math.hypot(p.x - c.x, p.z - c.z) < 32) {
    const what = got.map((g) => `${g.n} ${itemInfo(g.id)?.display.toLowerCase() ?? '?'}`).join(' and ');
    const coins = got.reduce((a, b) => a + b.coins, 0);
    game.hud.showLabel(`${c.type.label} bought ${what} from your stall: ${coins >= 10 ? Math.round(coins) : coins.toFixed(1).replace(/\.0$/, '')} coins in the till`);
    game.sfx?.play('pickup', { pitch: 1.6 });
  }
  if (game.ranchPanel?.kind === 'market') game.ranchPanel.renderMarket();
}
