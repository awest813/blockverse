// Villagers: the people of a village. Each village keeps a record in the
// world entry (worldMeta.villages[id]): who lives there (rolled from its
// beds and workplaces the first time you come near), what each one does,
// and who has been lost. The people themselves are bodies only while you're
// near the village; away, they're just the record, and coming back finds
// each where the day says they'd be (in bed at night, at work in the
// morning and afternoon, on the square at noon, home at dusk and in the
// rain), not where you left them.
//
// They get about by the village's own plan: out of the building they're in,
// along the roads (round the well on the square) and in at the next door,
// opening and closing doors as they go.

import * as THREE from 'three';
import { Mob } from './mob.js';
import { B } from '../blocks/blocks.js';
import { villageIn, plotFrame, REGION } from '../world/villages.js';
import { CHUNK_X, DAY_LENGTH_SECONDS } from '../core/constants.js';
import { coordRng } from '../core/rng.js';
import { worldClock } from '../core/clock.js';
import { isRipe, cropFamily, cropTime } from '../world/saplings.js';
import { TRADES } from '../world/villageTrade.js';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // (as villages.js: a plot's rot indexes these)
const NEAR = 40;          // blocks outside a village's bounds where its people appear...
const FAR = 56;           // ... and where they go back to being a record
const SQUARE = 5;         // (villages.js: the square's half-width)
const GROW_UP = 3 * DAY_LENGTH_SECONDS;   // a child grows up in three days
const MAX_RESIDENTS = 16;
const MOURN = 2 * DAY_LENGTH_SECONDS;     // a loss is spoken of for two days

// workplaces and the jobs they make
const WORKPLACE = { smithy: 'smith', kitchen: 'cook', library: 'librarian', farm: 'farmer', stable: 'stablehand' };
export const JOB_LABEL = { smith: 'smith', cook: 'cook', librarian: 'librarian', farmer: 'farmer', stablehand: 'stable hand', none: 'villager' };

const FIRST = ['Tam', 'Wren', 'Ash', 'Bram', 'Elin', 'Hob', 'Ivy', 'Jory', 'Kit', 'Lark', 'Mabe', 'Ned', 'Orrin', 'Pell', 'Rue', 'Sal', 'Tobin', 'Una', 'Vey', 'Wil', 'Ada', 'Bex', 'Cole', 'Dell', 'Effie', 'Finch', 'Gil', 'Hale', 'Isla', 'Jem', 'Lorn', 'Moss', 'Nell', 'Oak', 'Pip', 'Quill', 'Ros', 'Sorrel', 'Teague', 'Yarrow'];

// ---- the plan, as the villagers see it ----

// Where people stand in each building (local cells: lx along the front, lz
// back from it) and whether it has a door or a gate in the middle of its front.
function spots(p) {
  const { w, depth: d } = p, mid = w >> 1;
  switch (p.name) {
    case 'house': return { beds: [[1, d - 2]], stand: [[1, d - 3]], door: 'door' };
    case 'bighouse': return { beds: [[1, d - 2], [2, d - 2]], stand: [[1, d - 3], [2, d - 3]], door: 'door' };
    case 'smithy': return { work: [[2, d - 3], [3, d - 3]], door: null };
    case 'kitchen': return { work: [[2, d - 3], [3, d - 3]], door: 'door' };
    case 'library': return { work: [[2, 3], [mid, 2]], door: 'door' };
    case 'farm': return { work: [[1, 0], [mid - 1, 0], [mid + 1, 0], [w - 2, 0]], door: null, outside: true };   // (the log rim along its front)
    case 'stable': return { work: [[mid, 2], [mid - 1, 3]], door: 'gate' };
    default: return { door: null };
  }
}

const cell = (x, y, z, extra) => ({ x, y, z, ...extra });

// a point in a plot (local cell) as a world cell at feet height
function inPlot(p, lx, lz) {
  const [x, z] = plotFrame(p).W(lx, lz);
  return cell(x, p.y + 1, z);
}

// a road's centre cell `along` blocks out from the square's middle (feet height)
function onRoad(v, road, along) {
  const r = Math.max(0, Math.min(road.len - SQUARE - 1, along - SQUARE - 1));
  const c = road.cells[r * 3 + 1];
  return c ? cell(c[0], c[2] + 1, c[1]) : null;
}

// the ring round the well, three blocks out: clockwise from the -z side
// (roads leave the square from ring points 0, 2, 4, 6)
const RING = [[0, -3], [3, -3], [3, 0], [3, 3], [0, 3], [-3, 3], [-3, 0], [-3, -3]];
const ringCell = (v, i) => cell(v.x + RING[i][0], v.y + 1, v.z + RING[i][1]);

// from ring point i to ring point j, the short way round
function aroundWell(v, i, j) {
  const out = [];
  const step = ((j - i + 8) % 8) <= 4 ? 1 : 7;
  for (let k = i; k !== j; k = (k + step) % 8) out.push(ringCell(v, k));
  out.push(ringCell(v, j));
  return out;
}

// A place in a village: {plot (index into v.pieces) and spot (local cell)},
// or the square ({plot: -1, ring}).
function placeCell(v, place) {
  if (place.plot < 0) return ringCell(v, place.ring);
  return inPlot(v.pieces[place.plot], ...place.spot);
}

// the way out of a plot onto its road: [cells], ending on the road's edge
function wayOut(v, p) {
  const S = spots(p), mid = p.w >> 1;
  const out = [];
  if (!S.outside) {
    out.push(inPlot(p, mid, 1));
    const door = inPlot(p, mid, 0);
    if (S.door) door.door = S.door;
    out.push(door);
  } else out.push(inPlot(p, mid, 0));
  out.push(cell(p.door[0], p.y + 1, p.door[1]));
  const road = v.pieces.filter((q) => q.kind === 'road')[p.road];
  const r = Math.max(0, p.along - SQUARE - 1), c = road?.cells[r * 3 + (p.side > 0 ? 2 : 0)];
  if (c) out.push(cell(c[0], c[2] + 1, c[1]));
  return out;
}

// along a road from one point to another (every few cells, and the ends)
function alongRoad(v, road, from, to) {
  const out = [];
  const dir = to >= from ? 1 : -1;
  for (let a = from; dir > 0 ? a < to : a > to; a += dir * 4) out.push(onRoad(v, road, a));
  out.push(onRoad(v, road, to));
  return out.filter(Boolean);
}

// The cells to walk from one place to another.
export function route(v, from, to) {
  const roads = v.pieces.filter((q) => q.kind === 'road');
  const P1 = from.plot >= 0 ? v.pieces[from.plot] : null, P2 = to.plot >= 0 ? v.pieces[to.plot] : null;
  if (P1 && P2 && from.plot === to.plot) return [placeCell(v, to)];
  if (!P1 && !P2) return aroundWell(v, from.ring, to.ring);
  const out = [];
  // out of the first place: to its road, then toward the square (unless the
  // second is on the same road)
  let ring = from.ring ?? 0;
  if (P1) {
    out.push(...wayOut(v, P1));
    const road = roads[P1.road];
    if (P2 && P2.road === P1.road) {
      out.push(...alongRoad(v, road, P1.along, P2.along));
    } else {
      out.push(...alongRoad(v, road, P1.along, SQUARE + 1));
      ring = road.d * 2;
      out.push(ringCell(v, ring));
    }
  }
  if (!P2) { out.push(...aroundWell(v, ring, to.ring)); return out; }
  // into the second: from the square up its road, then in at its door
  if (!(P1 && P2.road === P1.road)) {
    const road = roads[P2.road];
    out.push(...aroundWell(v, ring, road.d * 2));
    out.push(...alongRoad(v, road, SQUARE + 1, P2.along));
  }
  out.push(...wayOut(v, P2).reverse(), placeCell(v, to));
  return out;
}

// ---- the record ----

const isPlot = (q) => q?.kind === 'plot';

// Roll a village's people from its beds and workplaces (from the seed: the
// same village always starts with the same people).
function rollResidents(gen, v, rx, rz, now) {
  const rng = coordRng(gen.seed, rx, rz, 4242);
  const homes = [], works = [];
  v.pieces.forEach((q, i) => {
    if (!isPlot(q)) return;
    const S = spots(q);
    S.beds?.forEach((_, b) => homes.push([i, b]));
    if (WORKPLACE[q.name]) works.push(i);
  });
  for (let i = works.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [works[i], works[j]] = [works[j], works[i]]; }
  const names = [...FIRST];
  const out = [];
  for (const [plot, bed] of homes.slice(0, MAX_RESIDENTS)) {
    const name = names.splice((rng() * names.length) | 0, 1)[0] ?? 'Tam';
    // the second bed of a family house is a child's, as often as not
    const kid = bed === 1 && rng() < 0.5;
    const r = { id: out.length, name, home: [plot, bed], work: null, job: kid ? 'child' : 'none', kid, born: now - (kid ? rng() * 2.5 : 20 + rng() * 40) * DAY_LENGTH_SECONDS, alive: true, lag: rng() * 0.03 };
    out.push(r);
  }
  for (const r of out) if (!r.kid) giveJob(v, out, r);
  return out;
}

// a free workplace (one no living grown-up works at), else the fields, else none
function giveJob(v, people, r) {
  const taken = new Set(people.filter((o) => o !== r && o.alive && !o.kid && Number.isInteger(o.work)).map((o) => o.work));
  const plots = v.pieces.map((q, i) => (isPlot(q) && WORKPLACE[q.name] ? i : -1)).filter((i) => i >= 0);
  const free = plots.find((i) => !taken.has(i)) ?? plots.find((i) => v.pieces[i].name === 'farm');
  r.work = free ?? null;
  r.job = free === undefined ? 'none' : WORKPLACE[v.pieces[free].name];
}

// A record from a save, checked once a session (an imported file may say
// anything): residents with sensible fields pointing at real beds and
// workplaces of this village's plan.
const checked = new WeakSet();
function checkRecord(rec, v) {
  const ok = rec && typeof rec === 'object' && !Array.isArray(rec) && Array.isArray(rec.residents);
  if (!ok) return null;
  const bed = (h) => Array.isArray(h) && isPlot(v.pieces[h[0]]) && Number.isInteger(h[1]) && h[1] >= 0 && h[1] < (spots(v.pieces[h[0]]).beds?.length ?? 0);
  const residents = [];
  for (const r of rec.residents.slice(0, MAX_RESIDENTS)) {
    if (!r || typeof r !== 'object' || !bed(r.home)) continue;
    const work = Number.isInteger(r.work) && WORKPLACE[v.pieces[r.work]?.name] ? r.work : null;
    const kid = !!r.kid;
    residents.push({
      id: residents.length,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 24) : 'Tam',
      home: [r.home[0], r.home[1]], work: kid ? null : work,
      job: kid ? 'child' : work === null ? 'none' : WORKPLACE[v.pieces[work].name],
      kid, born: Number.isFinite(r.born) ? r.born : 0, alive: r.alive !== false,
      lag: Number.isFinite(r.lag) ? Math.max(0, Math.min(0.03, r.lag)) : 0,
    });
  }
  const out = { name: v.name, residents, created: Number.isFinite(rec.created) ? rec.created : 0 };
  if (rec.lost && typeof rec.lost.name === 'string' && Number.isFinite(rec.lost.at)) out.lost = { name: rec.lost.name.slice(0, 24), at: rec.lost.at };
  return out;
}

// the record of village v (made the first time it's asked for)
export function villageRecord(game, v) {
  const meta = game.worldMeta;
  if (!meta.villages || typeof meta.villages !== 'object' || Array.isArray(meta.villages)) meta.villages = {};
  let rec = meta.villages[v.id];
  if (rec && !checked.has(rec)) { rec = meta.villages[v.id] = checkRecord(rec, v); if (rec) checked.add(rec); }
  if (!rec) {
    const [rx, rz] = v.id.split(',').map(Number);
    rec = meta.villages[v.id] = { name: v.name, created: worldClock.now, residents: rollResidents(game.world.gen, v, rx, rz, worldClock.now) };
    checked.add(rec);
    // (a cap on the villages kept: the oldest go first; they'd be rolled again)
    const ids = Object.keys(meta.villages);
    if (ids.length > 64) for (const id of ids.slice(0, ids.length - 64)) delete meta.villages[id];
  }
  return rec;
}

// ---- the day ----

// What resident r is doing at time of day t (0..1, noon 0.25).
export function activity(r, t, raining) {
  const u = (t - r.lag + 1) % 1;
  if (u >= 0.53 && u < 0.98) return 'sleep';
  if (u >= 0.45 || u < 0.03) return 'home';   // dusk, and up at dawn
  if (raining) return 'home';
  if (u >= 0.2 && u < 0.29) return 'square';   // noon on the square
  return r.kid ? 'play' : Number.isInteger(r.work) ? 'work' : 'square';
}

// where an activity puts r (a place), `k` picking among the spots there
export function placeFor(v, r, act, k = 0) {
  if (act === 'square' || act === 'play') return { plot: -1, ring: k % 8 };
  if (act === 'work' && Number.isInteger(r.work)) {
    const S = spots(v.pieces[r.work]);
    return { plot: r.work, spot: S.work[k % S.work.length] };
  }
  const [plot, bed] = r.home, S = spots(v.pieces[plot]);
  return act === 'sleep' ? { plot, spot: S.stand[bed], bed: S.beds[bed] } : { plot, spot: S.stand[bed] };
}

// ---- what they say ----

const LINES = {
  farmer: ['Fine day for the fields.', 'The wheat’s coming on nicely.', 'Mind the crops, if you would.', 'Carrots by the row, potatoes by the barrow.'],
  smith: ['Hot work, this.', 'Nothing like an iron horseshoe.', 'Bring me coal and I’ll owe you.', 'Tools go blunt, folk come back.'],
  cook: ['Something’s always on the boil.', 'A stew’s only as good as its mushrooms.', 'Eggs, milk and a bit of patience.', 'Hungry? You look hungry.'],
  librarian: ['Quiet, please.', 'Every book here’s been read twice.', 'Paper’s dear these days.', 'I keep the village’s records. Such as they are.'],
  stablehand: ['The horses are in a fine mood.', 'Hay, water and a kind word.', 'A good saddle’s worth its weight.', 'Mind the hooves.'],
  none: ['Lovely day.', 'Not much doing today.', 'Come far, have you?', 'Welcome to {village}.'],
  child: ['Tag! You’re it!', 'Are you a traveller?', 'I’m going to be a smith when I grow up.', 'Can you catch me?'],
  night: ['It’s late. Off to bed with you.', 'Shouldn’t you be indoors?', 'Mind the dark out there.'],
  rain: ['Wet enough for you?', 'Best get out of the rain.'],
  hurt: ['Ow! What was that for?', 'Hey! Stop that!', 'Help! Help!'],
};

export function lineFor(game, v, rec, r) {
  const t = game.time, pick = (list) => list[(Math.random() * list.length) | 0].replace('{village}', v.name);
  if (rec.lost && worldClock.now - rec.lost.at < MOURN && Math.random() < 0.4) return `We lost ${rec.lost.name}. It’s not the same without them.`;
  if (game.isNight()) return pick(LINES.night);
  if (game.world.raining && Math.random() < 0.5) return pick(LINES.rain);
  if (Math.random() < 0.25) return `Welcome to ${v.name}.`;
  return pick(LINES[r.kid ? 'child' : r.job] ?? LINES.none) + (t > 0.2 && t < 0.29 && !r.kid && Math.random() < 0.3 ? ' Lunch soon, I hope.' : '');
}

// ---- the people ----

// clothes by job (coat, trim), and the village's own touch on them
const DRESS = {
  farmer: [0x6a8a3a, 0xd8c060], smith: [0x4a4a52, 0x2a2a2a], cook: [0xe8e4dc, 0xb04030], librarian: [0x5a3a7a, 0xd8b048],
  stablehand: [0x8a5a34, 0x4a3420], none: [0x5a7aa8, 0x3a4a68], child: [0xd87a4a, 0x4a6aa8],
};
const SKIN = [0xd8a880, 0xc08a60, 0xe8c09a, 0x8a5a3a, 0xa87048];

export class Villager extends Mob {
  constructor(scene, world, x, y, z, village, res) {
    Villager.next = res;   // (the model's built in super(), before `this` is ours)
    super(scene, world, x, y, z);
    this.village = village;
    this.res = res;
    this.resident = true;          // (not despawned when far off: the village keeps its people)
    this.kind = 'villager';
    this.label = res.kid ? 'child' : JOB_LABEL[res.job] ?? 'villager';
    this.w = 0.6; this.h = res.kid ? 1.05 : 1.9; this.health = this.maxHealth = 20;
    this.speed = res.kid ? 2.2 : 1.8; this.fleeSpeed = 3.6;
    this.countsForCap = false;
    this.noLoot = true;
    this.size = res.kid ? 0.55 : 1;
    this.group.scale.setScalar(this.size);
    this.group.rotation.order = 'YXZ';   // (a nod, or lying in bed, tilts it the way it faces)
    this.setName(res.name);
    this.route = null;
    this.act = null;
    this.k = res.id;   // (which of a place's spots: people spread out)
  }

  buildModel() {
    const r = Villager.next, [coat, trim] = DRESS[r.kid ? 'child' : r.job] ?? DRESS.none;
    const skin = SKIN[(r.id * 7 + r.name.length) % SKIN.length];
    this.part(0.5, 0.72, 0.3, coat, 0, 1.06, 0);               // coat
    this.part(0.52, 0.08, 0.32, trim, 0, 0.74, 0);             // belt
    this.part(0.42, 0.42, 0.42, skin, 0, 1.64, 0);             // head
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, -0.1, 1.7, -0.22);   // eyes
    this.part(0.08, 0.08, 0.02, 0x1a1a1a, 0.1, 1.7, -0.22);
    this.part(0.1, 0.12, 0.06, shade(skin), 0, 1.6, -0.23);    // nose
    // what they do, at a glance
    switch (r.kid ? 'child' : r.job) {
      case 'farmer': this.part(0.7, 0.05, 0.7, 0xd8c060, 0, 1.88, 0); this.part(0.42, 0.14, 0.42, 0xd8c060, 0, 1.96, 0); break;   // a straw hat
      case 'smith': this.part(0.44, 0.6, 0.04, 0x3a2a1a, 0, 0.98, -0.17); this.part(0.44, 0.08, 0.44, 0x2a2a2a, 0, 1.88, 0); break;   // an apron, a cap
      case 'cook': this.part(0.36, 0.3, 0.36, 0xf4f2ec, 0, 2.0, 0); this.part(0.44, 0.5, 0.04, 0xf4f2ec, 0, 0.98, -0.17); break;   // a tall cap, an apron
      case 'librarian': this.part(0.12, 0.08, 0.02, 0x2a2a2a, -0.1, 1.71, -0.235); this.part(0.12, 0.08, 0.02, 0x2a2a2a, 0.1, 1.71, -0.235); this.part(0.44, 0.1, 0.44, 0x5a3a7a, 0, 1.88, 0); break;   // spectacles
      case 'stablehand': this.part(0.46, 0.12, 0.46, 0x4a3420, 0, 1.9, 0); this.part(0.46, 0.04, 0.2, 0x4a3420, 0, 1.86, -0.3); break;   // a cap with a peak
      default: this.part(0.44, 0.12, 0.44, trim, 0, 1.88, 0);   // hair
    }
    this.part(0.14, 0.56, 0.16, coat, -0.32, 1.06, 0);         // arms
    this.part(0.14, 0.56, 0.16, coat, 0.32, 1.06, 0);
    const leg = (x) => {
      const l = this.part(0.18, 0.66, 0.2, 0x3a3a46, x, 0.66, 0);
      l.geometry = l.geometry.clone(); l.geometry.translate(0, -0.33, 0); l.position.y = 0.66;
      return l;
    };
    this.legs = [leg(-0.13), leg(0.13)];
  }

  update(dt, player) {
    if (!this.sleeping || this.dead || this.dying !== undefined) { super.update(dt, player); return; }
    // asleep in bed: lying still (no walking, no falling), lit where it lies
    this.age += dt;
    this.think(dt, player, Math.hypot(this.x - player.x, this.z - player.z));
    if (this.dead || !this.sleeping) return;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;
    if (this.nameSprite) this.nameSprite.visible = false;
    this.animate(dt);   // (its speech bubble: "Zzz...")
    const light = this.world.lightAt(this.x, this.y + 0.3, this.z);
    for (const e of this.materials) e.mat.color.copy(e.base).multiplyScalar(light);
  }

  // A villager's day: the record says what it should be doing; it walks
  // there by the roads, and potters about when it's there.
  think(dt, player, playerDist) {
    const r = this.res, g = this.fx?.game;
    if (!g) return;
    this.stateTime -= dt;
    if (this.state === 'flee') {   // (hurt: away for a moment, then back to the day)
      this.moving = true;
      if (this.stateTime <= 0) { this.state = 'idle'; this.route = null; this.act = null; }
      return;
    }
    if (this.talkT > 0) {   // talking: facing you, still
      this.talkT -= dt;
      this.moving = false;
      this.targetYaw = Math.atan2(-(player.x - this.x), -(player.z - this.z));
      return;
    }
    // every second or so: is it time for something else?
    this.checkT = (this.checkT ?? 0) - dt;
    if (this.checkT <= 0) {
      this.checkT = 1 + Math.random();
      const act = activity(r, g.time, g.world.raining);
      if (act !== this.act) this.setAct(act);
    }
    if (this.route) { this.walk(dt, player); return; }
    this.whenThere(dt, player, playerDist);
  }

  // head for the place an activity says
  setAct(act) {
    const v = this.village;
    if (this.sleeping) this.wake();
    if (this.route?.open) this.door(this.route.open, false);   // (a change of plan in a doorway)
    // a new spot among the place's spots now and then: people spread out
    if (act === 'square' || act === 'play') this.k = (Math.random() * 8) | 0;
    const to = placeFor(v, this.res, act, this.k);
    const from = this.at ?? this.nearestPlace();
    this.route = { pts: route(v, from, to), i: 0, t: 0, best: Infinity, open: null };
    this.at = to;
    this.act = act;
  }

  // where it stands now, as a place (it may have been put down anywhere)
  nearestPlace() {
    const v = this.village;
    for (let i = 0; i < v.pieces.length; i++) {
      const p = v.pieces[i];
      if (isPlot(p) && this.x >= p.x0 - 0.5 && this.x <= p.x1 + 1.5 && this.z >= p.z0 - 0.5 && this.z <= p.z1 + 1.5) {
        const S = spots(p);
        return { plot: i, spot: (S.stand ?? S.work ?? [[p.w >> 1, 1]])[0] };
      }
    }
    // the square's nearest ring point (also the way onto it from a road)
    let best = 0, bd = Infinity;
    RING.forEach(([dx, dz], i) => { const d = Math.hypot(v.x + dx - this.x, v.z + dz - this.z); if (d < bd) { bd = d; best = i; } });
    return { plot: -1, ring: best };
  }

  // follow the route's cells, opening doors on the way and shutting them behind
  walk(dt, player) {
    const R = this.route, wp = R.pts[R.i];
    if (!wp) { this.arrive(); return; }
    if (wp.door && !R.open) this.door(wp, true) && (R.open = wp);
    const last = R.i === R.pts.length - 1;
    if (this.goTo(dt, wp.x + 0.5, wp.y, wp.z + 0.5, last ? 0.45 : 0.8)) {
      R.i++; R.t = 0; R.best = Infinity;
      // through a door and a step past it: shut it behind
      if (R.open && R.pts[R.i - 2] === R.open) { this.door(R.open, false); R.open = null; }
      return;
    }
    // no closer for a while (a block in the way, a crowd): a hop to the
    // next cell, if you're not right there watching
    const d = Math.hypot(wp.x + 0.5 - this.x, wp.z + 0.5 - this.z);
    R.t += dt;
    if (d < R.best - 0.3) { R.best = d; R.t = 0; }
    if (R.t > 8 && (Math.hypot(player.x - this.x, player.z - this.z) > 14 || !this.canSee(player))) {
      this.x = wp.x + 0.5; this.y = wp.y + 0.05; this.z = wp.z + 0.5; this.vx = this.vz = this.vy = 0;
      R.t = 0;
    }
  }

  arrive() {
    if (this.route?.open) this.door(this.route.open, false);
    this.route = null;
    this.moving = false;
    this.stateTime = 1 + Math.random() * 3;
    if (this.act === 'sleep') this.lieDown();
  }

  // open or shut the door (or gate) at cell c: true if it did
  door(c, open) {
    const w = this.world, id = w.getBlockW(c.x, c.y, c.z);
    if (id !== B.OAK_DOOR && id !== B.OAK_FENCE_GATE) return false;
    const meta = w.getMetaW(c.x, c.y, c.z);
    if (!!(meta & 4) === open) return false;
    // (never shut on the player standing in the doorway)
    const p = this.fx.game.player;
    if (!open && Math.abs(p.x - (c.x + 0.5)) < 0.9 && Math.abs(p.z - (c.z + 0.5)) < 0.9 && p.y < c.y + 2 && p.y > c.y - 1.8) return false;
    w.setBlock(c.x, c.y, c.z, id, meta ^ 4);
    if (id === B.OAK_DOOR && w.getBlockW(c.x, c.y + 1, c.z) === B.OAK_DOOR_TOP) w.setBlock(c.x, c.y + 1, c.z, B.OAK_DOOR_TOP, meta ^ 4);
    this.fx.sound?.('door', { open, pos: this, vol: 0.6 });
    return true;
  }

  // in bed for the night (and out of it in the morning)
  lieDown() {
    const at = this.at;
    if (!at?.bed) return;
    const p = this.village.pieces[at.plot], b = inPlot(p, ...at.bed);
    if (this.world.getBlockW(b.x, b.y, b.z) !== B.BED) return;   // (no bed now: it stands by where it was)
    this.sleeping = true;
    this.moving = false;
    this.vx = this.vy = this.vz = 0;
    // on its back, head to the back wall, small enough to fit the bed (its
    // feet half a block toward the door from the bed's middle)
    const [bx, bz] = DIRS[(p.rot + 2) % 4];
    this.yaw = Math.atan2(bx, bz);
    this.x = b.x + 0.5 - bx * 0.5; this.z = b.z + 0.5 - bz * 0.5; this.y = b.y + 1.02;
    this.group.scale.setScalar(this.size * 0.55);
    this.group.rotation.x = Math.PI / 2;
    this.group.position.set(this.x, this.y, this.z);
  }

  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.group.rotation.x = 0;
    this.group.scale.setScalar(this.size);
    const s = placeCell(this.village, { plot: this.at.plot, spot: this.at.spot });
    this.x = s.x + 0.5; this.y = s.y + 0.05; this.z = s.z + 0.5;
  }

  // at its place: potter about, look at you, do a bit of work
  whenThere(dt, player, playerDist) {
    this.moving = false;
    if (playerDist < 4 && !player.dead && !this.sleeping) { this.targetYaw = Math.atan2(-(player.x - this.x), -(player.z - this.z)); return; }
    if (this.stateTime > 0) return;
    this.stateTime = 3 + Math.random() * 5;
    const act = this.act;
    if (act === 'sleep') { if (!this.sleeping) this.lieDown(); return; }
    // kids at play dash about the square, and come to see a visitor
    if (act === 'play' && playerDist < 10 && Math.random() < 0.5) { this.route = { pts: [cell(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z))], i: 0, t: 0, best: Infinity }; this.stateTime = 1; return; }
    // move on to another spot of the place now and then
    if ((act === 'work' || act === 'square' || act === 'play') && Math.random() < (act === 'play' ? 0.8 : 0.35)) {
      const from = this.at;
      this.k = act === 'work' ? this.k + 1 : (this.at.ring + 1 + ((Math.random() * 3) | 0)) % 8;
      const to = placeFor(this.village, this.res, act, this.k);
      this.route = { pts: route(this.village, from, to), i: 0, t: 0, best: Infinity };
      this.at = to;
      return;
    }
    if (act === 'work' && this.res.job === 'farmer') this.tend();
    this.targetYaw = this.yaw + (Math.random() - 0.5) * 2.4;
  }

  // a farmer reaps a ripe crop near it and sows it again (the village's own:
  // nothing drops for you)
  tend() {
    const w = this.world, x0 = Math.floor(this.x), y0 = Math.floor(this.y), z0 = Math.floor(this.z);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const x = x0 + dx, z = z0 + dz, id = w.getBlockW(x, y0, z);
      if (!isRipe(id)) continue;
      w.setBlock(x, y0, z, cropFamily(id)[0]);
      w.setBlockEntity(x, y0, z, { kind: 'crop', grow: cropTime(w, x, y0, z, Math.random) });
      this.targetYaw = Math.atan2(-dx, -dz);
      this.fx.game.sparks?.(x + 0.5, y0 + 0.5, z + 0.5, 0x8fcf5a, 4);
      return;
    }
  }

  // the inspect card (sneak and look)
  describe() {
    const r = this.res, v = this.village;
    const doing = { sleep: 'Asleep', home: 'At home', work: 'At work', square: 'On the square', play: 'Playing' }[this.act] ?? 'About the village';
    const lines = [r.kid ? `A child of ${v.name}: grows up in ${Math.max(1, Math.ceil((GROW_UP - (worldClock.now - r.born)) / DAY_LENGTH_SECONDS))} day(s)` : `The ${this.label} of ${v.name}`];
    lines.push(this.route ? `On the way: ${doing.toLowerCase()}` : doing);
    lines.push(`Health ${Math.ceil(this.health)}/${this.maxHealth}`);
    return { title: `${r.name} (${this.label})`, lines };
  }

  // use: a word, and its trades if it has a trade (by day: at night it
  // wants its bed; sneak to just talk)
  interact(player) {
    const g = this.fx?.game;
    if (!g || this.sleeping) { this.say(this.sleeping ? 'Zzz…' : '…'); return true; }
    if (this.state === 'flee') { this.say('Keep away from me!'); return true; }
    const rec = villageRecord(g, this.village), line = lineFor(g, this.village, rec, this.res);
    this.talkT = 3;
    if (TRADES[this.res.job] && !this.res.kid && !player.sneaking) {
      if (g.isNight()) { this.say('Come back in the morning: I’m done for the day.'); return true; }
      this.nod();
      this.fx.openVillager?.(this, line);
      return true;
    }
    this.say(line);
    return true;
  }

  // a nod (after a trade): it bows a little for a moment
  nod() {
    this.nodT = 0.5;
    this.talkT = Math.max(this.talkT ?? 0, 2);
  }

  // a speech bubble over its head for a few seconds
  say(text) {
    this.unsay();
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    const font = '500 26px system-ui, sans-serif';
    ctx.font = font;
    // (wrapped to lines of about 26 characters)
    const words = text.split(' '), lines = [];
    for (const wd of words) { const l = lines.at(-1); if (l && (l + ' ' + wd).length <= 26) lines[lines.length - 1] = l + ' ' + wd; else lines.push(wd); }
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 28, h = lines.length * 32 + 20;
    c.width = w; c.height = h + 12;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w / 2 - 10, h); ctx.lineTo(w / 2 + 10, h); ctx.lineTo(w / 2, h + 12); ctx.fill();
    ctx.font = font; ctx.fillStyle = '#222'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, 14, 12 + i * 32));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sprite.scale.set(0.0075 * w, 0.0075 * (h + 12), 1);
    sprite.renderOrder = 3;
    this.scene.add(sprite);
    this.bubble = { sprite, t: 4 };
  }

  unsay() {
    if (!this.bubble) return;
    this.scene.remove(this.bubble.sprite);
    this.bubble.sprite.material.map.dispose();
    this.bubble.sprite.material.dispose();
    this.bubble = null;
  }

  animate(dt) {
    super.animate(dt);
    // (the nod: the whole villager bows a little, there being no neck)
    if (!this.sleeping) {
      this.nodT = Math.max(0, (this.nodT ?? 0) - dt);
      this.group.rotation.x = this.nodT > 0 ? Math.sin((this.nodT / 0.5) * Math.PI) * 0.18 : 0;
    }
    if (this.bubble) {
      this.bubble.t -= dt;
      this.bubble.sprite.position.set(this.x, this.y + this.h * (this.sleeping ? 0.3 : 1) + 0.9, this.z);
      if (this.bubble.t <= 0) this.unsay();
    }
  }

  damage(amount, source) {
    if (this.sleeping) this.wake();
    const hit = super.damage(amount, source);
    if (hit && !this.dead && this.dying === undefined) {
      this.say(LINES.hurt[(Math.random() * LINES.hurt.length) | 0]);
      this.route = null; this.act = null; this.at = null;
      this.state = 'flee'; this.stateTime = 4;
    }
    return hit;
  }

  die() {
    if (this.dying !== undefined) return;
    const g = this.fx?.game;
    this.res.alive = false;
    if (g) {
      const rec = villageRecord(g, this.village);
      rec.lost = { name: this.res.name, at: worldClock.now };
      g.hud.showLabel(`${this.res.name} the ${this.label} of ${this.village.name} has died`, true);
    }
    const name = this.name;
    this.name = null;   // (the line above says it: not Mob's "has died" as well)
    super.die();
    this.name = name;
  }

  kill() {
    this.unsay();
    super.kill();
  }
}

const shade = (c) => {
  const r = ((c >> 16) & 255) * 0.85, g = ((c >> 8) & 255) * 0.85, b = (c & 255) * 0.85;
  return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
};

// ---- present or away ----

// The villages near (x, z): this region's and its neighbours'.
function villagesNear(gen, x, z) {
  const R = REGION * CHUNK_X, rx = Math.floor(x / R), rz = Math.floor(z / R), out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const v = villageIn(gen, rx + dx, rz + dz);
    if (v) out.push(v);
  }
  return out;
}
const outside = (v, x, z) => Math.max(v.bounds.x0 - x, x - v.bounds.x1, v.bounds.z0 - z, z - v.bounds.z1, 0);

// Every second: villages you've come near get their people; ones you've
// left behind put them away.
let timer = 0;
export function tickVillagers(game, dt) {
  timer -= dt;
  if (timer > 0) return;
  timer = 1;
  const gen = game.world.gen, p = game.player, mobs = game.entities.mobs;
  const live = mobs.filter((m) => m.kind === 'villager' && !m.dead);
  if (game.dimension !== 'overworld' || !gen || gen.version < 12) { for (const m of live) m.kill(); return; }
  // gone from villages left behind
  for (const m of live) if (outside(m.village, p.x, p.z) > FAR) m.kill();
  for (const v of villagesNear(gen, p.x, p.z)) {
    if (outside(v, p.x, p.z) > NEAR) continue;
    const rec = villageRecord(game, v);
    // children grow up, into a free job
    for (const r of rec.residents) {
      if (r.kid && r.alive && worldClock.now - r.born > GROW_UP) { r.kid = false; giveJob(v, rec.residents, r); for (const m of live) if (m.res === r) m.kill(); }
    }
    const here = new Set(live.filter((m) => m.village.id === v.id && !m.dead).map((m) => m.res.id));
    for (const r of rec.residents) {
      if (!r.alive || here.has(r.id)) continue;
      // where the day says it is (in bed, at work, on the square, at home)
      const act = activity(r, game.time, game.world.raining);
      const place = placeFor(v, r, act, r.id);
      const c = placeCell(v, place);
      if (!game.world.isLoaded(c.x, c.z)) continue;
      const m = new Villager(game.scene, game.world, c.x + 0.5, c.y + 0.05, c.z + 0.5, v, r);
      m.at = place; m.act = act;
      game.entities.addMob(m);
      if (act === 'sleep') m.lieDown();
    }
  }
}
