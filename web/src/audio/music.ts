/**
 * Generative festival-night music in A minor pentatonic at 124 BPM, scheduled a step ahead
 * on the AudioContext clock. Nothing loops identically: chords walk a weighted Markov chain,
 * arpeggios random-walk the chord, drum-circle parts are polymeters (12- and 10-step cycles
 * against the 16-step bar) with ghost notes and fills, the sound camp drops into breakdowns
 * at random, and a mystical melody improvises at night.
 *
 * Layers (each a gain stage on the music bus with its own reverb send):
 * - fest:  distant sound-camp 4/4 thump + offbeat bass + hats, lowpassed and panned by proximity
 * - drums: drum-circle polyrhythm near the player's own Drum Circles
 * - pad:   evolving chord pads (filter follows tension and night)
 * - arp:   pentatonic arpeggio (density follows tension; bell timbre at night) with a dotted delay
 * - mel:   slow night melody
 * - tens:  tension percussion (toms, snares, hats)
 * - burn:  The Burn: drone, taiko and brass stabs
 * Title screen: calmer, wondrous variant (relative-major chords, long pads, sparse bells).
 */
import type { AudioEngine } from './engine';
import { CHORDS, degreeHz, midiHz, MATCH_MOVES, pickChord, TITLE_MOVES, type ChordName } from './scale';
import type { Soundscape } from './soundscape';
import { approach } from './soundscape';
import { bell, choir, fm, noise, tone } from './synth';

export const BPM = 124;
const STEP = 60 / BPM / 4;
/** Schedule this far ahead of the audio clock; covers main-thread stalls up to ~250 ms. */
const LOOKAHEAD = 0.3;
/** Behind by more than this (hidden tab, long stall): resync instead of bursting old steps. */
const MAX_LATE = 0.5;

type Layer = 'fest' | 'drums' | 'pad' | 'arp' | 'mel' | 'tens' | 'burn';
const LAYERS: readonly Layer[] = ['fest', 'drums', 'pad', 'arp', 'mel', 'tens', 'burn'];
/** Overall music make-up gain: layer targets are authored as relative balances. */
const MUSIC_TRIM = 1.7;
const LAYER_WET: Record<Layer, number> = { fest: 0.15, drums: 0.2, pad: 0.6, arp: 0.35, mel: 0.8, tens: 0.15, burn: 0.45 };
/** Tails (s) after the bar each layer's note group needs before it is disconnected. */
const LAYER_TAIL: Record<Layer, number> = { fest: 0.6, drums: 0.6, pad: 3, arp: 1.2, mel: 3, tens: 0.6, burn: 2.5 };

/** Euclidean rhythm: step `i` of a k-in-n pattern. */
function euclid(i: number, k: number, n: number): boolean {
  return (i * k) % n < k;
}

export class Music {
  private e: AudioEngine;
  private ctx: AudioContext;
  private layer: Record<Layer, GainNode>;
  /** JS-side smoothed levels (gate note generation for silent layers). */
  private lvl: Record<Layer, number> = { fest: 0, drums: 0, pad: 0, arp: 0, mel: 0, tens: 0, burn: 0 };
  /** Per-frame layer level targets (reused; no per-frame allocation). */
  private targets: Record<Layer, number> = { fest: 0, drums: 0, pad: 0, arp: 0, mel: 0, tens: 0, burn: 0 };
  /** Current per-bar note group per layer. */
  private group: Record<Layer, GainNode | null> = { fest: null, drums: null, pad: null, arp: null, mel: null, tens: null, burn: null };
  private festLP: BiquadFilterNode;
  private festPan: StereoPannerNode;
  private drumPan: StereoPannerNode;
  private padLP: BiquadFilterNode;
  private padLfo: OscillatorNode;
  private arpDelay: DelayNode;

  private step = 0;
  private nextT = 0;
  private chord: ChordName = 'Am';
  private chordLeft = 0;
  private arpIdx = 4;
  private arpDir = 1;
  private arpDensity = 0.4;
  private breakdownBars = 0;
  private fill = false;
  private melodyBusyUntil = 0;
  private title = true;
  private drone: OscillatorNode[] = [];
  private droneGain: GainNode;
  private droneLP: BiquadFilterNode;
  private silentFor = 0;

  constructor(engine: AudioEngine) {
    this.e = engine;
    const ctx = engine.ctx;
    this.ctx = ctx;
    const mk = (l: Layer): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(engine.buses.music);
      const send = ctx.createGain();
      send.gain.value = LAYER_WET[l];
      g.connect(send).connect(engine.wet.music);
      return g;
    };
    this.layer = { fest: mk('fest'), drums: mk('drums'), pad: mk('pad'), arp: mk('arp'), mel: mk('mel'), tens: mk('tens'), burn: mk('burn') };

    // The sound camp is heard through air and tents: lowpassed, panned, its own little slap echo.
    this.festLP = ctx.createBiquadFilter();
    this.festLP.type = 'lowpass';
    this.festLP.frequency.value = 220;
    this.festLP.Q.value = 0.9;
    this.festPan = ctx.createStereoPanner();
    this.festLP.connect(this.festPan).connect(this.layer.fest);

    this.drumPan = ctx.createStereoPanner();
    this.drumPan.connect(this.layer.drums);

    this.padLP = ctx.createBiquadFilter();
    this.padLP.type = 'lowpass';
    this.padLP.frequency.value = 900;
    this.padLP.Q.value = 1.5;
    this.padLP.connect(this.layer.pad);
    this.padLfo = ctx.createOscillator();
    this.padLfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 350;
    this.padLfo.connect(lfoDepth).connect(this.padLP.frequency);
    this.padLfo.start();

    // Dotted-eighth feedback delay on the arpeggio.
    this.arpDelay = ctx.createDelay(1);
    this.arpDelay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const fbLP = ctx.createBiquadFilter();
    fbLP.type = 'lowpass';
    fbLP.frequency.value = 2400;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.45;
    this.layer.arp.connect(this.arpDelay);
    this.arpDelay.connect(fbLP).connect(fb).connect(this.arpDelay);
    this.arpDelay.connect(delayOut).connect(engine.buses.music);

    this.droneLP = ctx.createBiquadFilter();
    this.droneLP.type = 'lowpass';
    this.droneLP.frequency.value = 380;
    this.droneLP.Q.value = 3;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneLP.connect(this.droneGain).connect(this.layer.burn);
    // GameAudio lives for the whole app, so the scheduler timer never needs clearing.
    setInterval(this.tick, 25);
  }

  /** Forget per-match state (new match / back to title). */
  reset(): void {
    this.stopDrone();
    this.breakdownBars = 0;
    this.chordLeft = 0;
  }

  update(s: Soundscape, dt: number): void {
    const t = this.ctx.currentTime;
    this.title = s.mode === 'title';
    const night = s.night;
    const ten = s.tension;
    const target = this.targets;
    if (this.title) {
      target.fest = 0.1;
      target.drums = 0;
      target.pad = 0.55;
      target.arp = 0.3;
      target.mel = 0.45;
      target.tens = 0;
      target.burn = 0;
    } else {
      target.fest = (0.2 + 0.85 * s.fest) * (1 - 0.5 * s.burn);
      target.drums = 0.95 * s.drum;
      target.pad = (0.3 + 0.25 * night + 0.15 * ten) * (1 - 0.3 * s.burn);
      target.arp = 0.12 + 0.35 * ten + 0.1 * night;
      target.mel = 0.45 * night * (1 - 0.6 * ten);
      target.tens = Math.max(0, Math.min(1, (ten - 0.35) / 0.5)) * 0.7;
      target.burn = 0.85 * s.burn;
    }
    for (const l of LAYERS) {
      this.lvl[l] = approach(this.lvl[l], target[l], 1.2, dt);
      this.layer[l].gain.setTargetAtTime(target[l] * MUSIC_TRIM, t, 0.8);
    }
    this.festLP.frequency.setTargetAtTime(this.title ? 160 : 180 + 3200 * s.fest * s.fest, t, 0.4);
    this.festPan.pan.setTargetAtTime(s.festPan * (1 - 0.5 * s.fest), t, 0.3);
    this.drumPan.pan.setTargetAtTime(s.drumPan * 0.7, t, 0.3);
    this.padLP.frequency.setTargetAtTime(this.title ? 1100 : 550 + 1500 * ten + 700 * night, t, 1.5);
    this.arpDensity = this.title ? 0.22 : 0.3 + 0.5 * ten;

    // The Burn drone lives while the layer is audible.
    if (target.burn > 0.01 && this.drone.length === 0) this.startDrone();
    if (this.drone.length) {
      this.droneGain.gain.setTargetAtTime(target.burn > 0.01 ? 0.22 : 0, t, 1.2);
      this.droneLP.frequency.setTargetAtTime(300 + 900 * ten, t, 2);
      this.silentFor = target.burn > 0.01 ? 0 : this.silentFor + dt;
      if (this.silentFor > 6) this.stopDrone();
    }
  }

  /**
   * Look-ahead scheduler on the audio clock, driven by its own 25 ms timer rather than the
   * render loop so render hitches never stutter the groove ("a tale of two clocks").
   * Slightly late steps play at once; after a long stall (hidden tab) it resyncs instead of
   * bursting the missed steps.
   */
  private tick = (): void => {
    const t = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return;
    if (this.nextT < t - MAX_LATE) this.nextT = t + 0.05;
    while (this.nextT < t + LOOKAHEAD) {
      this.schedule(this.step, Math.max(this.nextT, t + 0.005));
      this.nextT += STEP;
      this.step++;
    }
  };

  private startDrone(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [m, det] of [
      [33, -6],
      [33, 6],
      [40, 3],
      [45, -4],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiHz(m);
      o.detune.value = det;
      o.connect(this.droneLP);
      o.start(t);
      this.drone.push(o);
    }
    this.silentFor = 0;
  }

  private stopDrone(): void {
    const t = this.ctx.currentTime;
    for (const o of this.drone) {
      o.stop(t + 0.1);
      o.disconnect();
    }
    this.drone.length = 0;
    this.droneGain.gain.setValueAtTime(0, t);
  }

  /** A fresh note group for a layer bar; disconnected after the bar plus the layer's tail. */
  private newGroup(l: Layer, t: number, len: number): GainNode {
    const g = this.ctx.createGain();
    const dest = l === 'fest' ? this.festLP : l === 'drums' ? this.drumPan : l === 'pad' ? this.padLP : this.layer[l];
    g.connect(dest);
    this.e.track(g, t + len + LAYER_TAIL[l]);
    this.group[l] = g;
    return g;
  }

  private out(l: Layer): GainNode | null {
    return this.lvl[l] > 0.01 ? this.group[l] : null;
  }

  private schedule(i: number, t: number): void {
    const s16 = i % 16;
    if (s16 === 0) this.bar(i, t);
    const chord = CHORDS[this.chord];

    const fest = this.out('fest');
    if (fest) this.festStep(fest, s16, t, chord);
    const drums = this.out('drums');
    if (drums) this.drumStep(drums, i, s16, t);
    const arp = this.out('arp');
    if (arp) this.arpStep(arp, s16, t, chord);
    const tens = this.out('tens');
    if (tens) this.tensionStep(tens, s16, t);
    const burn = this.out('burn');
    if (burn) this.burnStep(burn, s16, t);
  }

  /** Bar boundary: new note groups, chord walk, breakdowns, fills, melody phrases. */
  private bar(i: number, t: number): void {
    const barLen = STEP * 16;
    for (const l of LAYERS) if (l !== 'pad' && l !== 'mel') this.newGroup(l, t, barLen);

    if (this.chordLeft <= 0) {
      this.chord = pickChord(this.chord, this.title ? TITLE_MOVES : MATCH_MOVES);
      // Chords last 2 bars (4 on the title); under pressure they sometimes move every bar.
      this.chordLeft = this.title ? 4 : Math.random() < this.lvl.tens * 0.6 ? 1 : 2;
      this.padChord(t, this.chordLeft * barLen);
      if (this.lvl.burn > 0.05) this.burnStab(t);
    }
    this.chordLeft--;

    if (this.breakdownBars > 0) this.breakdownBars--;
    else if (!this.title && Math.random() < 0.07) this.breakdownBars = 1 + Math.floor(Math.random() * 2);
    this.fill = this.chordLeft === 0 && Math.random() < 0.3;

    if (Math.random() < 0.3) this.arpDir = -this.arpDir;
    if (t > this.melodyBusyUntil && this.lvl.mel > 0.03 && Math.random() < (this.title ? 0.45 : 0.35)) this.melody(t);
  }

  private padChord(t: number, len: number): void {
    const g = this.newGroup('pad', t, len);
    const c = this.ctx;
    const notes = CHORDS[this.chord];
    const atk = this.title ? 2.4 : 1.1;
    const rel = this.title ? 3 : 1.8;
    const env = { a: atk, h: Math.max(0.1, len - atk), d: rel, peak: 0.032 };
    for (const m of notes) {
      const f = midiHz(m);
      if (this.title) {
        tone(c, g, t, { type: 'triangle', f, env: { ...env, peak: 0.05 } });
        tone(c, g, t, { f: f * 2, detune: 5, env: { ...env, peak: 0.02 } });
      } else {
        tone(c, g, t, { type: 'sawtooth', f, detune: -7, env });
        tone(c, g, t, { type: 'sawtooth', f, detune: 7, env });
      }
    }
    // Night shimmer: an airy octave on the top voices.
    if (this.lvl.mel > 0.1 || this.title) {
      const top = notes[notes.length - 1];
      tone(c, g, t, { f: midiHz(top + 12), vib: 6, vibRate: 0.3, env: { ...env, peak: 0.012 } });
    }
  }

  private festStep(g: GainNode, s16: number, t: number, chord: readonly number[]): void {
    const c = this.ctx;
    if (this.breakdownBars > 0) {
      // Breakdown: pads of noise rising into the drop.
      if (s16 === 0 && this.breakdownBars === 1) noise(c, g, t, { buf: this.e.white, filter: 'bandpass', f: 400, f2: 5000, sweep: STEP * 16, q: 2, env: { a: STEP * 15, d: 0.05, peak: 0.25 } });
      return;
    }
    if (s16 % 4 === 0) {
      tone(c, g, t, { f: 150, f2: 45, glide: 0.09, env: { a: 0.002, d: 0.28, peak: 0.9 } });
    } else if (s16 % 4 === 2) {
      const f = midiHz(chord[0] - 12);
      tone(c, g, t, { type: 'sawtooth', f, env: { a: 0.005, h: STEP * 0.8, d: 0.12, peak: 0.22 } });
      tone(c, g, t, { f, env: { a: 0.005, h: STEP * 0.8, d: 0.12, peak: 0.35 } });
      noise(c, g, t, { buf: this.e.white, filter: 'highpass', f: 7000, env: { d: 0.04, peak: 0.12 } });
    }
    if (s16 === 4 || s16 === 12) noise(c, g, t, { buf: this.e.white, filter: 'bandpass', f: 1500, q: 0.8, env: { a: 0.001, d: 0.12, peak: 0.3 } });
  }

  private drumStep(g: GainNode, i: number, s16: number, t: number): void {
    const c = this.ctx;
    if (this.fill && s16 >= 8) {
      // Fill: rolling tones crescendo into the next phrase.
      this.djembe(g, t, s16 % 2 === 0 ? 'tone' : 'slap', 0.4 + (s16 - 8) * 0.07);
      return;
    }
    // Dundun: 16-step bell pattern with drops.
    if ((s16 === 0 || s16 === 3 || s16 === 6 || s16 === 10 || s16 === 12) && Math.random() > 0.08) this.djembe(g, t, 'bass', s16 === 0 ? 1 : 0.8);
    // Djembe A: 5-in-12 polymeter (realigns with the bar every 3 bars).
    const a = i % 12;
    if (euclid(a, 5, 12)) this.djembe(g, t, a % 2 === 0 ? 'tone' : 'slap', a === 0 ? 0.9 : 0.7);
    else if (Math.random() < 0.12) this.djembe(g, t, 'tone', 0.2 + Math.random() * 0.15);
    // Djembe B: 3-in-10 polymeter (realigns every 5 bars: the pentagonal one).
    const b = i % 10;
    if (euclid((b + 3) % 10, 3, 10) && Math.random() > 0.1) this.djembe(g, t, 'slap', 0.55);
    // Shaker 16ths with accents on the offbeats.
    noise(c, g, t, { buf: this.e.white, filter: 'highpass', f: 6500, env: { a: 0.004, d: 0.035, peak: s16 % 4 === 2 ? 0.14 : 0.06 } });
  }

  private djembe(g: GainNode, t: number, kind: 'bass' | 'tone' | 'slap', vel: number): void {
    const c = this.ctx;
    if (kind === 'bass') {
      tone(c, g, t, { f: 88, f2: 58, glide: 0.08, env: { a: 0.002, d: 0.26, peak: 0.75 * vel } });
      noise(c, g, t, { buf: this.e.white, filter: 'lowpass', f: 320, env: { d: 0.05, peak: 0.3 * vel } });
    } else if (kind === 'tone') {
      tone(c, g, t, { f: 245, f2: 205, glide: 0.06, env: { a: 0.002, d: 0.13, peak: 0.42 * vel } });
      noise(c, g, t, { buf: this.e.white, filter: 'bandpass', f: 900, env: { d: 0.03, peak: 0.2 * vel } });
    } else {
      noise(c, g, t, { buf: this.e.white, filter: 'bandpass', f: 2700, q: 1.2, env: { a: 0.001, d: 0.055, peak: 0.6 * vel } });
      tone(c, g, t, { type: 'triangle', f: 430, env: { d: 0.03, peak: 0.14 * vel } });
    }
  }

  private arpStep(g: GainNode, s16: number, t: number, chord: readonly number[]): void {
    const eighth = s16 % 2 === 0;
    const p = this.title ? (s16 % 4 === 0 ? this.arpDensity : 0) : eighth ? this.arpDensity : Math.max(0, this.arpDensity - 0.45);
    if (Math.random() >= p) return;
    // Walk over chord tones spread across two octaves above the pad.
    const n = chord.length * 2;
    this.arpIdx += this.arpDir * (Math.random() < 0.2 ? 2 : 1);
    if (this.arpIdx >= n) {
      this.arpIdx = n - 2;
      this.arpDir = -1;
    } else if (this.arpIdx < 0) {
      this.arpIdx = 1;
      this.arpDir = 1;
    }
    const m = chord[this.arpIdx % chord.length] + 12 * (1 + Math.floor(this.arpIdx / chord.length));
    const f = midiHz(m);
    const accent = s16 === 0 ? 1.3 : 1;
    const c = this.ctx;
    if (this.title || this.lvl.mel > 0.15) {
      fm(c, g, t, f, 3.5, 1.4, { a: 0.003, d: 0.9, peak: 0.07 * accent });
    } else {
      tone(c, g, t, { type: 'triangle', f, env: { a: 0.003, d: 0.24, peak: 0.12 * accent } });
      tone(c, g, t, { type: 'square', f, env: { a: 0.002, d: 0.07, peak: 0.022 * accent } });
    }
  }

  /** A slow improvised night phrase: one sine voice gliding between pentatonic degrees. */
  private melody(t: number): void {
    const c = this.ctx;
    const n = 3 + Math.floor(Math.random() * 4);
    const durs = [4, 6, 8, 4, 2, 8];
    let deg = 15 + Math.floor(Math.random() * 5);
    // Group lifetime uses the longest possible phrase (every note 8 steps).
    const g = this.newGroup('mel', t, n * 8 * STEP);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(degreeHz(deg), t);
    const vib = c.createOscillator();
    vib.frequency.value = 5;
    const vd = c.createGain();
    vd.gain.value = 9;
    vib.connect(vd).connect(o.detune);
    const eg = c.createGain();
    eg.gain.setValueAtTime(0, t);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const d = durs[Math.floor(Math.random() * durs.length)] * STEP;
      o.frequency.setTargetAtTime(degreeHz(deg), tt, 0.04);
      eg.gain.setTargetAtTime(0.09, tt, 0.06);
      eg.gain.setTargetAtTime(0.05, tt + d * 0.6, 0.2);
      tt += d;
      deg += Math.random() < 0.5 ? -1 : Math.random() < 0.7 ? 1 : 2;
      deg = Math.max(13, Math.min(23, deg));
    }
    // The phrase sighs onto one last neighbouring degree as it fades.
    o.frequency.setTargetAtTime(degreeHz(deg), tt, 0.08);
    eg.gain.setTargetAtTime(0, tt, 0.5);
    o.connect(eg).connect(g);
    o.start(t);
    vib.start(t);
    o.stop(tt + 3);
    vib.stop(tt + 3);
    this.melodyBusyUntil = tt + STEP * 8;
  }

  private tensionStep(g: GainNode, s16: number, t: number): void {
    const c = this.ctx;
    if (s16 === 0 || s16 === 6 || s16 === 10) tone(c, g, t, { f: 118, f2: 70, glide: 0.12, env: { a: 0.002, d: 0.22, peak: 0.5 } });
    if (s16 === 4 || s16 === 12) noise(c, g, t, { buf: this.e.white, filter: 'bandpass', f: 1600, q: 0.7, env: { a: 0.001, d: 0.11, peak: 0.35 } });
    if (this.lvl.tens > 0.4) noise(c, g, t, { buf: this.e.white, filter: 'highpass', f: 7500, env: { a: 0.001, d: 0.025, peak: s16 % 2 ? 0.04 : 0.07 } });
    if (this.lvl.tens > 0.55 && s16 >= 13) noise(c, g, t, { buf: this.e.white, filter: 'bandpass', f: 1700, q: 0.7, env: { a: 0.001, d: 0.07, peak: 0.15 + (s16 - 13) * 0.06 } });
  }

  private burnStep(g: GainNode, s16: number, t: number): void {
    const c = this.ctx;
    const hit = s16 === 0 || s16 === 3 || s16 === 8 || s16 === 11 || (s16 === 14 && Math.random() < 0.6);
    if (!hit) return;
    const v = s16 === 0 ? 1 : 0.7;
    tone(c, g, t, { f: 72, f2: 38, glide: 0.2, env: { a: 0.002, d: 0.5, peak: 0.9 * v } });
    noise(c, g, t, { buf: this.e.pink, filter: 'lowpass', f: 520, env: { a: 0.002, d: 0.16, peak: 0.45 * v } });
  }

  /** The Burn: brass stab + choir on each chord change. */
  private burnStab(t: number): void {
    const g = this.group.burn;
    if (!g) return;
    const c = this.ctx;
    const notes = CHORDS[this.chord];
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(2400, t + 0.08);
    lp.frequency.setTargetAtTime(600, t + 0.1, 0.4);
    lp.connect(g);
    for (let i = 0; i < 3; i++) {
      const f = midiHz(notes[i]);
      tone(c, lp, t, { type: 'sawtooth', f, detune: -8, env: { a: 0.02, h: 0.3, d: 0.9, peak: 0.08 } });
      tone(c, lp, t, { type: 'sawtooth', f, detune: 8, env: { a: 0.02, h: 0.3, d: 0.9, peak: 0.08 } });
    }
    choir(c, g, t, [midiHz(notes[0]), midiHz(notes[2]), midiHz(notes[3])], 'o', { a: 0.6, h: STEP * 16, d: 1.5, peak: 0.18 });
    bell(c, g, t, midiHz(notes[notes.length - 1] + 12), 2, 0.06, 2);
  }
}
