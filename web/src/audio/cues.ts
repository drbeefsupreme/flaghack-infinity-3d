/**
 * Interface cues outside the battle: the Seals of Flagistan (Training Burn lesson rewards),
 * graduation when the Seal is whole, and the online burn's lobby/chat/connection sounds.
 * All play on the UI bus (centred, unaffected by the listener) through the engine's voice
 * limiting; every pitched note stays in A minor pentatonic so cues sit on top of the music.
 */
import { FESTIVAL_BPM } from '../sim/constants';
import type { AudioEngine } from './engine';
import { degreeHz, midiHz } from './scale';
import { bell, brass, choir, fm, noise, tone } from './synth';

/** Lessons in the Training Burn; seal pitches climb across this range. */
const SEAL_STEPS = 12;

export class Cues {
  private e: AudioEngine;

  constructor(engine: AudioEngine) {
    this.e = engine;
  }

  /**
   * A Seal of Flagistan is pressed: wax thump, an ascending bell arpeggio whose root climbs
   * with the lesson index, a brass swell and a shimmer. Later seals sound higher and fuller.
   */
  sealAwarded(index: number): void {
    const i = Math.max(0, Math.min(SEAL_STEPS - 1, Math.floor(index)));
    const v = this.e.voice({ key: 'seal', dur: 3.4, gain: 0.9, wet: 0.5, priority: 3, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    tone(c, v.input, v.t, { f: 120, f2: 55, glide: 0.12, env: { a: 0.002, d: 0.2, peak: 0.55 } });
    noise(c, v.input, v.t, { buf: this.e.white, filter: 'lowpass', f: 900, env: { a: 0.001, d: 0.06, peak: 0.3 } });
    const root = 15 + Math.floor(i / 2);
    const steps = [0, 2, 4, 5, 7];
    const n = 3 + Math.min(2, Math.floor(i / 4));
    for (let k = 0; k < n; k++) bell(c, v.input, v.t + 0.08 + k * 0.075, degreeHz(root + steps[k]), 1.4, 0.16, 3);
    const tb = v.t + 0.08 + n * 0.075;
    brass(c, v.input, tb, [degreeHz(root - 5), degreeHz(root - 3), degreeHz(root - 1)], 0.08, 0.5, 1.2, 0.35 + i * 0.015, 2200 + i * 120);
    bell(c, v.input, tb + 0.05, degreeHz(root + 10), 2, 0.1, 3);
    noise(c, v.input, tb, { buf: this.e.white, filter: 'highpass', f: 6000, f2: 11000, sweep: 1, env: { a: 0.05, d: 1.2, peak: 0.08 } });
    this.e.duck(0.3, 1.4);
  }

  /**
   * The Seal of Flagistan is whole: a choir blooms on the relative major, a five-bell peal
   * (one bell per point of the pentagram) rings twice, brass crowns it and a gong closes.
   */
  graduation(): void {
    const v = this.e.voice({ key: 'graduation', dur: 9, gain: 1, wet: 0.65, priority: 3, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    choir(c, v.input, v.t, [midiHz(48), midiHz(55), midiHz(60), midiHz(64), midiHz(67)], 'a', { a: 1.2, h: 3.5, d: 3, peak: 0.34 });
    tone(c, v.input, v.t, { f: midiHz(36), env: { a: 1.5, h: 3, d: 3, peak: 0.22 } });
    const peal = [25, 23, 22, 20, 18];
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < peal.length; k++) bell(c, v.input, v.t + 0.6 + r * 1.3 + k * 0.22, degreeHz(peal[(k + r * 2) % 5]), 2.4, 0.15);
    }
    brass(c, v.input, v.t + 3.2, [midiHz(48), midiHz(55), midiHz(60), midiHz(64), midiHz(72)], 0.12, 1.8, 2.6, 0.75, 3400);
    fm(c, v.input, v.t + 3.2, 92, 1.41, 2.6, { a: 0.004, d: 5, peak: 0.32 });
    noise(c, v.input, v.t + 3.2, { buf: this.e.white, filter: 'highpass', f: 5000, env: { a: 0.01, d: 3, peak: 0.16 } });
    this.e.duck(0.65, 6);
  }

  /** A chat line arrives: a soft two-note bloop. */
  chatBlip(): void {
    const v = this.e.voice({ key: 'chat', dur: 0.3, gain: 0.55, wet: 0.15, priority: 1, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    tone(c, v.input, v.t, { type: 'triangle', f: midiHz(76), env: { a: 0.003, d: 0.07, peak: 0.12 } });
    tone(c, v.input, v.t + 0.07, { type: 'triangle', f: midiHz(81), env: { a: 0.003, d: 0.14, peak: 0.12 } });
  }

  /** Someone joins the burn: a rising three-bell welcome. */
  playerJoined(): void {
    const v = this.e.voice({ key: 'join', dur: 1.4, gain: 0.7, wet: 0.4, priority: 2, bus: 'ui' });
    if (!v) return;
    const degs = [17, 20, 22];
    for (let k = 0; k < 3; k++) bell(this.e.ctx, v.input, v.t + k * 0.09, degreeHz(degs[k]), 1, 0.14, 3);
  }

  /** Someone leaves: two falling notes that sag a little. */
  playerLeft(): void {
    const v = this.e.voice({ key: 'leave', dur: 0.9, gain: 0.65, wet: 0.35, priority: 2, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    const a = degreeHz(22);
    const b = degreeHz(17);
    tone(c, v.input, v.t, { type: 'triangle', f: a, env: { a: 0.004, d: 0.18, peak: 0.13 } });
    tone(c, v.input, v.t + 0.14, { type: 'triangle', f: b, f2: b * 0.97, glide: 0.5, env: { a: 0.004, d: 0.5, peak: 0.13 } });
  }

  /** The D.E.G.E.N. link drops: a LoRa chirp that fails into static and a low sag. */
  connectionLost(): void {
    const v = this.e.voice({ key: 'netLost', dur: 1.6, gain: 0.8, wet: 0.25, priority: 3, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    tone(c, v.input, v.t, { f: 2700, f2: 900, glide: 0.09, env: { a: 0.004, h: 0.07, d: 0.02, peak: 0.1 } });
    tone(c, v.input, v.t + 0.12, { type: 'square', f: 900, f2: 300, glide: 0.5, vib: 60, vibRate: 13, env: { a: 0.005, h: 0.2, d: 0.35, peak: 0.05 } });
    noise(c, v.input, v.t + 0.1, { buf: this.e.crackle, filter: 'highpass', f: 1500, env: { a: 0.01, h: 0.5, d: 0.4, peak: 1 } });
    noise(c, v.input, v.t + 0.1, { buf: this.e.white, filter: 'bandpass', f: 2500, q: 0.7, env: { a: 0.02, h: 0.4, d: 0.4, peak: 0.08 } });
    tone(c, v.input, v.t + 0.2, { f: degreeHz(5), f2: degreeHz(3), glide: 1, env: { a: 0.02, d: 1.1, peak: 0.25 } });
  }

  /** The link comes back: static clears into a rising chirp and a bell. */
  reconnected(): void {
    const v = this.e.voice({ key: 'netBack', dur: 1.4, gain: 0.75, wet: 0.3, priority: 3, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    noise(c, v.input, v.t, { buf: this.e.white, filter: 'bandpass', f: 2500, q: 0.7, env: { a: 0.01, d: 0.25, peak: 0.08 } });
    for (let k = 0; k < 2; k++) tone(c, v.input, v.t + 0.2 + k * 0.1, { f: 900, f2: 2700, glide: 0.09, env: { a: 0.004, h: 0.07, d: 0.015, peak: 0.11 } });
    bell(c, v.input, v.t + 0.45, degreeHz(22), 0.9, 0.15, 3);
  }

  /** The leader starts the burn: a riser, three countdown kicks on the festival beat, a stab. */
  matchStarting(): void {
    const beat = 60 / FESTIVAL_BPM;
    const v = this.e.voice({ key: 'matchStart', dur: beat * 4 + 2, gain: 0.9, wet: 0.4, priority: 3, bus: 'ui' });
    if (!v) return;
    const c = this.e.ctx;
    noise(c, v.input, v.t, { buf: this.e.white, filter: 'bandpass', f: 400, f2: 6000, sweep: beat * 3, q: 2, env: { a: beat * 3, d: 0.05, peak: 0.22 } });
    for (let k = 0; k < 3; k++) tone(c, v.input, v.t + k * beat, { f: 150, f2: 45, glide: 0.09, env: { a: 0.002, d: 0.3, peak: 0.7 } });
    const ts = v.t + beat * 3;
    brass(c, v.input, ts, [midiHz(45), midiHz(52), midiHz(57), midiHz(60)], 0.03, 0.3, 0.9, 0.6, 3000);
    bell(c, v.input, ts, degreeHz(20), 1.6, 0.18);
    tone(c, v.input, ts, { f: 72, f2: 30, glide: 0.5, env: { a: 0.002, d: 0.7, peak: 0.6 } });
    this.e.duck(0.4, beat * 3.5);
  }
}
