// Procedurally synthesized sound effects (WebAudio). No audio files —
// every sound is generated from noise bursts and oscillators.

// which volume slider each sound answers to
const CATEGORY = {
  hit: 'blocks', break: 'blocks', place: 'blocks', step: 'blocks', splash: 'blocks', explode: 'blocks', fuse: 'blocks',
  zombie: 'mobs', skeleton: 'mobs', spider: 'mobs', mobhurt: 'mobs', mobdeath: 'mobs', shoot: 'mobs', spawner: 'mobs',
  pig: 'mobs', cow: 'mobs', sheep: 'mobs', chicken: 'mobs', dog: 'mobs', cat: 'mobs', dolphin: 'mobs', whale: 'mobs',
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.5;
    this._noiseBuf = null;
  }

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // everything passes a low-pass filter that closes up underwater
      this.muffle = this.ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      this.master.connect(this.muffle).connect(this.ctx.destination);
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
    if (this.ensure() && this.ctx.state === 'suspended') this.ctx.resume();
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
    if (this.master) this.master.gain.value = v;
  }

  // Filtered noise burst: the workhorse for digging/steps.
  noise({ freq = 800, q = 1, dur = 0.1, gain = 0.5, type = 'bandpass', pitchDrop = 0 }) {
    if (!this.ensure() || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (pitchDrop) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq - pitchDrop), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain * (this._k ?? 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  tone({ freq = 440, endFreq = null, dur = 0.15, gain = 0.25, type = 'square' }) {
    if (!this.ensure() || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain * (this._k ?? 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
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

  play(name, opts = {}) {
    const k = this.mix?.[CATEGORY[name] ?? 'ui'] ?? 1;
    if (k <= 0) return;
    this._k = k;   // scales the fixed-gain sounds below (noise/tone read it)
    try { this.playRaw(name, opts); } finally { this._k = 1; }
  }

  // run part of a sound a moment later, at the same category volume
  later(fn, ms) {
    const k = this._k;
    setTimeout(() => { this._k = k; try { fn(); } finally { this._k = 1; } }, ms);
  }

  playRaw(name, opts) {
    const m = this.materialParams(opts.block ?? 'stone');
    const detune = 0.85 + Math.random() * 0.3;
    const vol = opts.vol ?? 1;   // distance falloff for mob sounds
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
        this.tone({ freq: 110 * detune, endFreq: 70, dur: 0.5, gain: 0.07 * vol, type: 'sawtooth' });
        this.noise({ freq: 600, q: 1, dur: 0.3, gain: 0.08 * vol, pitchDrop: 300 });
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
        this.tone({ freq: 260 * detune, endFreq: 130, dur: 0.22, gain: 0.3, type: 'sawtooth' });
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
        this.noise({ freq: 700, q: 0.3, dur: 1.1, gain: 0.9, type: 'lowpass', pitchDrop: 600 });
        this.tone({ freq: 70, endFreq: 28, dur: 0.7, gain: 0.5, type: 'sine' });
        break;
      case 'fuse':
        this.noise({ freq: 3200, q: 0.5, dur: 1.4, gain: 0.22 * vol, type: 'highpass' });
        break;
      case 'zombie':   // low, wavering groan
        this.tone({ freq: 110 * detune, endFreq: 70, dur: 0.7, gain: 0.22 * vol, type: 'sawtooth' });
        this.noise({ freq: 300, q: 1.2, dur: 0.6, gain: 0.08 * vol, type: 'bandpass' });
        break;
      case 'skeleton': // dry rattle of quick clicks
        for (let i = 0; i < 4; i++) {
          this.later(() => this.noise({ freq: 2400 * detune, q: 4, dur: 0.03, gain: 0.2 * vol, type: 'bandpass' }), i * 55);
        }
        break;
      case 'spider':   // hiss
        this.noise({ freq: 5200 * detune, q: 1.5, dur: 0.35, gain: 0.12 * vol, type: 'bandpass' });
        break;
      // passive animals: quiet, so a field of them isn't a racket
      case 'pig':      // two short grunts
        for (let i = 0; i < 2; i++) this.later(() => {
          this.tone({ freq: 210 * detune, endFreq: 150, dur: 0.11, gain: 0.07 * vol, type: 'square' });
          this.noise({ freq: 400, q: 1, dur: 0.1, gain: 0.05 * vol, type: 'lowpass' });
        }, i * 140);
        break;
      case 'cow':      // a long low moo
        this.tone({ freq: 150 * detune, endFreq: 105, dur: 0.9, gain: 0.08 * vol, type: 'sawtooth' });
        break;
      case 'sheep':    // a wavering baa
        for (let i = 0; i < 4; i++) this.later(() => this.tone({ freq: (380 - i * 12) * detune, dur: 0.09, gain: 0.05 * vol, type: 'sawtooth' }), i * 70);
        break;
      case 'chicken':  // clucks
        for (let i = 0; i < 2 + (Math.random() * 2 | 0); i++) this.later(() => this.tone({ freq: 950 * detune, endFreq: 700, dur: 0.06, gain: 0.05 * vol, type: 'triangle' }), i * 110);
        break;
      case 'dog':      // woof
        this.tone({ freq: 260 * detune, endFreq: 150, dur: 0.13, gain: 0.09 * vol, type: 'square' });
        this.noise({ freq: 700, q: 0.8, dur: 0.1, gain: 0.06 * vol });
        break;
      case 'cat':      // meow: up, then down
        this.tone({ freq: 520 * detune, endFreq: 820, dur: 0.18, gain: 0.05 * vol, type: 'triangle' });
        this.later(() => this.tone({ freq: 820 * detune, endFreq: 460, dur: 0.25, gain: 0.05 * vol, type: 'triangle' }), 170);
        break;
      case 'dolphin':  // clicks and a whistle
        for (let i = 0; i < 5; i++) this.later(() => this.noise({ freq: 3800, q: 6, dur: 0.02, gain: 0.08 * vol }), i * 45);
        this.later(() => this.tone({ freq: 1800 * detune, endFreq: 2700, dur: 0.3, gain: 0.04 * vol, type: 'sine' }), 260);
        break;
      case 'whale':    // a slow rising song
        this.tone({ freq: 90 * detune, endFreq: 170, dur: 1.6, gain: 0.08 * vol, type: 'sine' });
        break;
      case 'mobhurt':
        this.tone({ freq: 340 * detune, endFreq: 220, dur: 0.1, gain: 0.12 * vol, type: 'square' });
        break;
      case 'mobdeath': // soft poof
        this.noise({ freq: 900, q: 0.6, dur: 0.35, gain: 0.3, type: 'lowpass', pitchDrop: 600 });
        break;
      case 'shoot':
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
