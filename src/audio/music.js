// Gentle generative music. Every few minutes a short piece drifts in: a slow
// pad of two soft notes moving through a few chords, with a sparse melody
// wandering over a pentatonic scale, all through a long echo. Brighter by
// day, lower and darker at night, sparse and low underground. Fighting a
// boss (or pausing the music setting at 0) lets it fade out. No files:
// oscillators scheduled ahead on the audio clock.

const MOODS = {
  // root (MIDI note), scale and chord roots (semitones above the root), tempo (s per step)
  day:   { root: 60, scale: [0, 2, 4, 7, 9], chords: [0, 9, 5, 7], step: 0.9, wave: 'triangle', density: 0.7 },
  night: { root: 57, scale: [0, 3, 5, 7, 10], chords: [0, 8, 5, 3], step: 1.2, wave: 'sine', density: 0.55 },
  cave:  { root: 50, scale: [0, 2, 3, 7, 8], chords: [0, 3, 8, 7], step: 1.6, wave: 'sine', density: 0.4 },
  // the Scorchlands: low, slow and uneasy (a flat second in the scale)
  scorch: { root: 45, scale: [0, 1, 3, 7, 8], chords: [0, 1, 8, 7], step: 1.8, wave: 'triangle', density: 0.35 },
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.wait = 25 + Math.random() * 35;   // first piece a little after you start playing
    this.piece = null;                     // {gain, ends}
  }

  // mood: 'day' | 'night' | 'cave' | null (nothing should play: a boss fight)
  update(dt, mood) {
    const sfx = this.sfx;
    if (!sfx.running) return;
    const ctx = sfx.ctx;
    if (this.piece) {
      if (ctx.currentTime > this.piece.ends) { this.release(this.piece); this.piece = null; }
      else if (!mood) this.stop(2);
      return;
    }
    if (!mood || (sfx.musicVolume ?? 0.5) <= 0 || sfx.volume <= 0) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 120 + Math.random() * 180;   // then two to five minutes of quiet
    this.play(mood);
  }

  play(mood) {
    const sfx = this.sfx, ctx = sfx.ctx, bus = sfx.musicBus();
    if (!bus) return;
    const m = MOODS[mood] ?? MOODS.day;
    const t0 = ctx.currentTime + 0.1;
    const len = 40 + Math.random() * 25;

    // piece -> long echo -> music bus, with a fade in and out
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(1, t0 + 4);
    gain.gain.setValueAtTime(1, t0 + len - 6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = m.step * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    gain.connect(bus);
    gain.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(bus);
    const voices = [];

    const voice = (freq, start, dur, peak, wave) => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.6, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(gain);
      o.start(start);
      o.stop(start + dur + 0.05);
      voices.push(o);
    };

    // the pad: root and fifth of each chord, slow and quiet
    const bar = m.step * 8;
    for (let b = 0, t = t0; t < t0 + len - 2; b++, t += bar) {
      const r = m.root - 12 + m.chords[b % m.chords.length];
      voice(hz(r), t, bar + 1.5, 0.05, 'sine');
      voice(hz(r + 7), t + 0.2, bar + 1.2, 0.035, 'sine');
    }
    // the melody: a random walk over the scale, resting now and then
    let deg = 2 + ((Math.random() * 3) | 0);
    for (let t = t0 + bar * 0.5; t < t0 + len - 4; t += m.step * (Math.random() < 0.25 ? 2 : 1)) {
      if (Math.random() > m.density) continue;
      deg = Math.max(0, Math.min(9, deg + [-2, -1, -1, 0, 1, 1, 2][(Math.random() * 7) | 0]));
      const note = m.root + m.scale[deg % 5] + 12 * Math.floor(deg / 5);
      voice(hz(note), t, m.step * (1.5 + Math.random() * 1.5), 0.06, m.wave);
    }
    // the echo loop holds itself alive while connected: unhook it all after
    this.piece = { gain, ends: t0 + len + 4, nodes: [gain, delay, damp, fb], voices };
  }

  // take a finished (or faded) piece's echo loop apart
  release(piece) {
    for (const n of piece.nodes) { try { n.disconnect(); } catch { /* already */ } }
  }

  // fade out whatever is playing (a boss fight, quitting)
  stop(fade = 1.5) {
    if (!this.piece || !this.sfx.ctx) return;
    const t = this.sfx.ctx.currentTime;
    const g = this.piece.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.exponentialRampToValueAtTime(0.0001, t + fade);
    // the notes scheduled for later in the piece needn't play on, silent
    for (const o of this.piece.voices) { try { o.stop(t + fade); } catch { /* not started / done */ } }
    const piece = this.piece;
    setTimeout(() => this.release(piece), (fade + 0.2) * 1000);
    this.piece = null;
    this.wait = Math.max(this.wait, 60);   // and leave a gap before the next one
  }
}
