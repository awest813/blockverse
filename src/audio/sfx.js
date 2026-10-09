// Procedurally synthesized sound effects (WebAudio). No audio files —
// every sound is generated from noise bursts and oscillators.

// which volume slider each sound answers to
const CATEGORY = {
  hit: 'blocks', break: 'blocks', place: 'blocks', step: 'blocks', splash: 'blocks', explode: 'blocks', fuse: 'blocks',
  door: 'blocks', chest: 'blocks', sizzle: 'blocks', crackle: 'blocks', lavapop: 'blocks', drone: 'blocks', cricket: 'blocks',
  zombie: 'mobs', skeleton: 'mobs', spider: 'mobs', mobhurt: 'mobs', mobdeath: 'mobs', shoot: 'mobs', spawner: 'mobs',
  pig: 'mobs', cow: 'mobs', sheep: 'mobs', chicken: 'mobs', dog: 'mobs', cat: 'mobs', dolphin: 'mobs', whale: 'mobs',
};
// how far away a positioned sound can still be heard (blocks)
const RANGE = { explode: 64, fuse: 20, crackle: 10, lavapop: 12, cricket: 20 };
const RANGE_BY_CATEGORY = { mobs: 20, blocks: 24, ui: 24 };
// at most N copies of a sound per window (seconds): a pile of pickups or a
// sweep through a crowd shouldn't become one deafening burst
const LIMITS = { pickup: [2, 0.06], mobhurt: [3, 0.1], mobdeath: [3, 0.1], explode: [2, 0.12], hit: [3, 0.05], step: [2, 0.08], splash: [2, 0.1] };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.5;
    this._noiseBuf = null;
    this.listener = null;    // {x, y, z, yaw} for distance + panning
    this._recent = new Map();
    // browsers start audio suspended until a user gesture: unlock on any input
    const unlock = () => this.resume();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { passive: true });
    // a background tab goes quiet
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // everything passes a low-pass filter that closes up underwater...
      this.muffle = this.ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      // ...and a limiter, so a chain of explosions can't clip
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -14;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;
      const out = this.ctx.createGain();
      out.gain.value = 0.9;
      this.master.connect(this.muffle).connect(this.limiter).connect(out).connect(this.ctx.destination);
      // 1s of white noise, reused by every noise-based effect
      const len = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  resume() {
    if (document.hidden || !this.ensure()) return;
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume();
  }

  get running() { return this.ctx?.state === 'running'; }

  setListener(x, y, z, yaw) {
    this.listener = { x, y, z, yaw };
  }

  // Underwater: muffle everything and add a low, rolling hum.
  setUnderwater(on) {
    if (on === !!this._under || !this.ctx) return;
    this._under = on;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(on ? 650 : 20000, t, 0.08);
    if (on) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.4);
      src.connect(lp).connect(g).connect(this.master);
      src.start();
      this._hum = { src, g };
    } else if (this._hum) {
      const { src, g } = this._hum;
      g.gain.setTargetAtTime(0, t, 0.1);
      src.stop(t + 0.6);
      this._hum = null;
    }
  }

  // per-category mix: {blockVolume, mobVolume, uiVolume}
  setMix(s) {
    this.mix = { blocks: s.blockVolume ?? 1, mobs: s.mobVolume ?? 1, ui: s.uiVolume ?? 1 };
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);   // no click
  }

  // Filtered noise burst: the workhorse for digging/steps. Every voice goes to
  // the current play()'s output (panned or not), this._when seconds from now.
  noise({ freq = 800, q = 1, dur = 0.1, gain = 0.5, type = 'bandpass', pitchDrop = 0 }) {
    if (!this.running) return;
    const t = this.ctx.currentTime + (this._when ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (pitchDrop) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq - pitchDrop), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    this.envelope(g, gain * (this._k ?? 1), t, dur);
    src.connect(filter).connect(g).connect(this._out ?? this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  tone({ freq = 440, endFreq = null, dur = 0.15, gain = 0.25, type = 'square' }) {
    if (!this.running) return;
    const t = this.ctx.currentTime + (this._when ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    this.envelope(g, gain * (this._k ?? 1), t, dur);
    let node = osc;
    // buzzy waves get their harshest overtones shaved off
    if (type === 'square' || type === 'sawtooth') {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(12000, Math.max(freq, endFreq ?? 0) * 4);
      node = osc.connect(lp);
    }
    node.connect(g).connect(this._out ?? this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // a 4ms fade-in (no click), then the usual exponential decay
  envelope(g, peak, t, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, dur));
  }

  // Per-material noise colors for block sounds.
  materialParams(block) {
    switch (block) {
      case 'stone': return { freq: 520, q: 0.8, type: 'bandpass' };
      case 'dirt': return { freq: 300, q: 0.6, type: 'lowpass' };
      case 'sand': return { freq: 900, q: 0.4, type: 'highpass' };
      case 'wood': return { freq: 380, q: 2.2, type: 'bandpass' };
      case 'leaf': return { freq: 1600, q: 0.5, type: 'highpass' };
      case 'glass': return { freq: 2400, q: 3, type: 'bandpass' };
      case 'cloth': return { freq: 500, q: 0.3, type: 'lowpass' };
      default: return { freq: 600, q: 1, type: 'bandpass' };
    }
  }

  // opts: {vol, block, pos: {x, y, z}, pan, cause, open}
  play(name, opts = {}) {
    const cat = CATEGORY[name] ?? 'ui';
    let k = (this.mix?.[cat] ?? 1) * (opts.vol ?? 1);
    if (k <= 0 || !this.running) return;
    // too many of the same sound right now?
    const [max, win] = LIMITS[name] ?? [6, 0.05];
    const now = this.ctx.currentTime;
    const times = (this._recent.get(name) ?? []).filter((t) => now - t < win);
    if (times.length >= max) return;
    times.push(now);
    this._recent.set(name, times);
    // positioned sounds fade with distance and pan left/right
    let pan = opts.pan ?? 0;
    const L = this.listener;
    if (opts.pos && L) {
      const dx = opts.pos.x - L.x, dy = (opts.pos.y ?? L.y) - L.y, dz = opts.pos.z - L.z;
      const d = Math.hypot(dx, dy, dz);
      const range = RANGE[name] ?? RANGE_BY_CATEGORY[cat];
      if (d >= range) return;
      k *= (1 - d / range) ** 2;
      // the listener's right-hand vector is (cos yaw, -sin yaw) for a -z forward
      const hd = Math.hypot(dx, dz);
      if (hd > 0.5) pan = ((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / hd) * 0.8 * (this._under ? 0.5 : 1);
    }
    let out = this.master;
    if (pan && this.ctx.createStereoPanner) {
      out = this.ctx.createStereoPanner();
      out.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(this.master);
      setTimeout(() => out.disconnect(), 4000);   // after the voices have finished
    }
    this._k = k;
    this._out = out;
    this._when = 0;
    try { this.playRaw(name, opts); } finally { this._k = 1; this._out = null; this._when = 0; }
  }

  // part of a sound a moment later, scheduled on the audio clock
  later(fn, ms) {
    const when = this._when;
    this._when = when + ms / 1000;
    try { fn(); } finally { this._when = when; }
  }

  playRaw(name, opts) {
    const m = this.materialParams(opts.block ?? 'stone');
    const detune = 0.85 + Math.random() * 0.3;
    switch (name) {
      case 'hit':
        this.noise({ ...m, freq: m.freq * detune, dur: 0.06, gain: 0.22 });
        break;
      case 'crit':     // sharp crack with a bright ring
        this.noise({ freq: 2600 * detune, q: 2, dur: 0.07, gain: 0.35 });
        this.tone({ freq: 1400, endFreq: 900, dur: 0.12, gain: 0.08, type: 'triangle' });
        break;
      case 'sweep':    // a blade swishing through the air
        this.noise({ freq: 1800 * detune, q: 0.8, dur: 0.18, gain: 0.22, pitchDrop: 1200 });
        break;
      case 'weak':     // an uncharged swing: a soft thud
        this.noise({ freq: 380 * detune, q: 1, dur: 0.05, gain: 0.12 });
        break;
      case 'spawner':  // something stirs in the cage
        this.tone({ freq: 110 * detune, endFreq: 70, dur: 0.5, gain: 0.07, type: 'sawtooth' });
        this.noise({ freq: 600, q: 1, dur: 0.3, gain: 0.08, pitchDrop: 300 });
        break;
      case 'break':
        this.noise({ ...m, freq: m.freq * detune, dur: 0.16, gain: 0.5, pitchDrop: m.freq * 0.4 });
        break;
      case 'place':
        this.noise({ ...m, freq: m.freq * detune * 1.1, dur: 0.1, gain: 0.4 });
        break;
      case 'step':
        this.noise({ ...m, freq: m.freq * detune * 0.8, dur: 0.05, gain: 0.12 });
        break;
      case 'hurt':
        if (opts.cause === 'fall') {            // a heavy thud
          this.tone({ freq: 90 * detune, endFreq: 40, dur: 0.15, gain: 0.4, type: 'sine' });
          this.noise({ freq: 200, q: 0.7, dur: 0.1, gain: 0.25, type: 'lowpass' });
        } else if (opts.cause === 'fire' || opts.cause === 'lava') {   // a sizzle
          this.noise({ freq: 3000 * detune, q: 0.6, dur: 0.3, gain: 0.18, type: 'highpass' });
          this.tone({ freq: 240 * detune, endFreq: 140, dur: 0.18, gain: 0.18, type: 'sawtooth' });
        } else if (opts.cause === 'drown') {    // a gurgle
          for (let i = 0; i < 3; i++) this.later(() => this.tone({ freq: (300 + i * 40) * detune, endFreq: 200, dur: 0.07, gain: 0.14, type: 'sine' }), i * 70);
        } else {
          this.tone({ freq: 260 * detune, endFreq: 130, dur: 0.22, gain: 0.3, type: 'sawtooth' });
        }
        break;
      case 'heartbeat':  // low health: lub-dub
        this.tone({ freq: 62, endFreq: 48, dur: 0.09, gain: 0.35, type: 'sine' });
        this.later(() => this.tone({ freq: 52, endFreq: 40, dur: 0.09, gain: 0.25, type: 'sine' }), 130);
        break;
      case 'burp':       // finished eating
        this.tone({ freq: 150 * detune, endFreq: 90, dur: 0.2, gain: 0.12, type: 'sawtooth' });
        break;
      case 'door':       // a creak opening, a thump shutting
        if (opts.open) {
          this.noise({ freq: 260 * detune, q: 3, dur: 0.12, gain: 0.25, type: 'bandpass' });
          this.tone({ freq: 190 * detune, endFreq: 140, dur: 0.25, gain: 0.06, type: 'triangle' });
        } else {
          this.noise({ freq: 220 * detune, q: 0.7, dur: 0.12, gain: 0.4, type: 'lowpass' });
        }
        break;
      case 'chest':      // lid creaks up, then a soft wooden tap
        this.tone({ freq: 90 * detune, endFreq: 125, dur: 0.3, gain: 0.08, type: 'sawtooth' });
        this.later(() => this.noise({ freq: 380, q: 2, dur: 0.06, gain: 0.25, type: 'bandpass' }), 260);
        break;
      case 'sizzle':     // water on fire
        this.noise({ freq: 3200 * detune, q: 0.5, dur: 0.5, gain: 0.25, type: 'highpass', pitchDrop: 1500 });
        break;
      case 'crackle':    // a campfire or a burning block, now and then
        for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) {
          this.later(() => this.noise({ freq: 2000 + Math.random() * 2500, q: 5, dur: 0.015, gain: 0.22, type: 'bandpass' }), i * (40 + Math.random() * 90));
        }
        break;
      case 'lavapop':    // a bubble bursting on lava
        this.tone({ freq: 140 * detune, endFreq: 60, dur: 0.1, gain: 0.2, type: 'sine' });
        this.noise({ freq: 600, q: 1, dur: 0.06, gain: 0.08, type: 'lowpass' });
        break;
      case 'drone':      // the deep hum of a cave
        this.tone({ freq: 55 * detune, endFreq: 52, dur: 3.5, gain: 0.07, type: 'sine' });
        this.tone({ freq: 82 * detune, endFreq: 78, dur: 3.2, gain: 0.04, type: 'sine' });
        break;
      case 'cricket':    // a short chirping burst on a summer night
        for (let i = 0; i < 4; i++) this.later(() => this.tone({ freq: 4400 * detune, dur: 0.025, gain: 0.025, type: 'sine' }), i * 38);
        break;
      case 'pickup':
        this.tone({ freq: 620 * detune, endFreq: 1240, dur: 0.09, gain: 0.18, type: 'sine' });
        break;
      case 'eat':
        this.noise({ freq: 420 * detune, q: 1.5, dur: 0.09, gain: 0.3, type: 'bandpass' });
        this.later(() => this.noise({ freq: 380, q: 1.5, dur: 0.09, gain: 0.25, type: 'bandpass' }), 130);
        break;
      case 'click':
        this.tone({ freq: 880, dur: 0.04, gain: 0.12, type: 'square' });
        break;
      case 'toolbreak':
        this.tone({ freq: 500, endFreq: 120, dur: 0.3, gain: 0.35, type: 'square' });
        break;
      case 'explode':
        this.noise({ freq: 700, q: 0.3, dur: 1.1, gain: 0.5, type: 'lowpass', pitchDrop: 600 });
        this.tone({ freq: 70 * detune, endFreq: 28, dur: 0.7, gain: 0.3, type: 'sine' });
        break;
      case 'fuse':
        this.noise({ freq: 3200, q: 0.5, dur: 1.4, gain: 0.22, type: 'highpass' });
        break;
      case 'zombie':   // low, wavering groan
        this.tone({ freq: 110 * detune, endFreq: 70, dur: 0.7, gain: 0.22, type: 'sawtooth' });
        this.noise({ freq: 300, q: 1.2, dur: 0.6, gain: 0.08, type: 'bandpass' });
        break;
      case 'skeleton': // dry rattle of quick clicks
        for (let i = 0; i < 4; i++) {
          this.later(() => this.noise({ freq: 2400 * detune, q: 4, dur: 0.03, gain: 0.2, type: 'bandpass' }), i * 55);
        }
        break;
      case 'spider':   // hiss
        this.noise({ freq: 5200 * detune, q: 1.5, dur: 0.35, gain: 0.12, type: 'bandpass' });
        break;
      // passive animals: quiet, so a field of them isn't a racket
      case 'pig':      // two short grunts
        for (let i = 0; i < 2; i++) this.later(() => {
          this.tone({ freq: 210 * detune, endFreq: 150, dur: 0.11, gain: 0.07, type: 'square' });
          this.noise({ freq: 400, q: 1, dur: 0.1, gain: 0.05, type: 'lowpass' });
        }, i * 140);
        break;
      case 'cow':      // a long low moo
        this.tone({ freq: 150 * detune, endFreq: 105, dur: 0.9, gain: 0.08, type: 'sawtooth' });
        break;
      case 'sheep':    // a wavering baa
        for (let i = 0; i < 4; i++) this.later(() => this.tone({ freq: (380 - i * 12) * detune, dur: 0.09, gain: 0.05, type: 'sawtooth' }), i * 70);
        break;
      case 'chicken':  // clucks
        for (let i = 0; i < 2 + (Math.random() * 2 | 0); i++) this.later(() => this.tone({ freq: 950 * detune, endFreq: 700, dur: 0.06, gain: 0.05, type: 'triangle' }), i * 110);
        break;
      case 'dog':      // woof
        this.tone({ freq: 260 * detune, endFreq: 150, dur: 0.13, gain: 0.09, type: 'square' });
        this.noise({ freq: 700, q: 0.8, dur: 0.1, gain: 0.06 });
        break;
      case 'cat':      // meow: up, then down
        this.tone({ freq: 520 * detune, endFreq: 820, dur: 0.18, gain: 0.05, type: 'triangle' });
        this.later(() => this.tone({ freq: 820 * detune, endFreq: 460, dur: 0.25, gain: 0.05, type: 'triangle' }), 170);
        break;
      case 'dolphin':  // clicks and a whistle
        for (let i = 0; i < 5; i++) this.later(() => this.noise({ freq: 3800, q: 6, dur: 0.02, gain: 0.08 }), i * 45);
        this.later(() => this.tone({ freq: 1800 * detune, endFreq: 2700, dur: 0.3, gain: 0.04, type: 'sine' }), 260);
        break;
      case 'whale':    // a slow rising song
        this.tone({ freq: 90 * detune, endFreq: 170, dur: 1.6, gain: 0.08, type: 'sine' });
        break;
      case 'mobhurt':
        this.tone({ freq: 340 * detune, endFreq: 220, dur: 0.1, gain: 0.12, type: 'square' });
        break;
      case 'mobdeath': // soft poof
        this.noise({ freq: 900, q: 0.6, dur: 0.35, gain: 0.3, type: 'lowpass', pitchDrop: 600 });
        break;
      case 'shoot':      // a skeleton's arrow
      case 'throw':      // the player's own bow, throws and casts (player volume)
        this.tone({ freq: 900 * detune, endFreq: 260, dur: 0.12, gain: 0.14, type: 'triangle' });
        this.noise({ freq: 2000, q: 0.8, dur: 0.08, gain: 0.12, type: 'bandpass' });
        break;
      case 'equip':
        this.tone({ freq: 340, endFreq: 520, dur: 0.08, gain: 0.16, type: 'square' });
        this.noise({ freq: 2600, q: 2, dur: 0.12, gain: 0.18, type: 'bandpass' });
        break;
      case 'splash':
        this.noise({ freq: 1100, q: 0.4, dur: 0.25, gain: 0.35, type: 'highpass', pitchDrop: 600 });
        break;
    }
  }
}
