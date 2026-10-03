/**
 * Ambience beds: gusting wind, crowd murmur near sound camps and busy hippies, flag-flap
 * texture scaled by nearby planted Flags, crickets at night and the effigy fire during The
 * Burn. Persistent looped noise sources whose filters and gains follow the Soundscape.
 */
import type { AudioEngine } from './engine';
import type { Soundscape } from './soundscape';
import { approach } from './soundscape';

const FORMANT_RANGES: readonly [number, number][] = [
  [280, 820],
  [900, 2100],
  [2200, 2900],
];

export class Ambience {
  private e: AudioEngine;
  private ctx: AudioContext;
  private windBP: BiquadFilterNode;
  private windGain: GainNode;
  private whistleBP: BiquadFilterNode;
  private whistleGain: GainNode;
  private crowdFormants: BiquadFilterNode[] = [];
  private crowdGain: GainNode;
  private crowdPan: StereoPannerNode;
  private flapLfo: OscillatorNode;
  private flapGain: GainNode;
  private fireGain: GainNode;
  private crackleGain: GainNode;
  private firePan: StereoPannerNode;

  private gust = 0.3;
  private gustTarget = 0.3;
  private gustTimer = 0;
  private babbleTimer = 0;

  constructor(engine: AudioEngine) {
    this.e = engine;
    const ctx = engine.ctx;
    this.ctx = ctx;
    const bus = engine.buses.ambience;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    wet.connect(engine.wet.ambience);

    const loop = (buf: AudioBuffer): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, Math.random() * buf.duration);
      return s;
    };

    // Wind: stereo pink noise through a gusting bandpass, plus a thin whistle on strong gusts.
    const wind = loop(engine.pink);
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.Q.value = 0.6;
    this.windBP.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windBP).connect(this.windGain).connect(bus);
    this.windGain.connect(wet);
    this.whistleBP = ctx.createBiquadFilter();
    this.whistleBP.type = 'bandpass';
    this.whistleBP.Q.value = 9;
    this.whistleBP.frequency.value = 1400;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    wind.connect(this.whistleBP).connect(this.whistleGain).connect(bus);

    // Crowd murmur: noise through three wandering vowel formants, each amplitude-modulated.
    const crowd = loop(engine.white);
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.crowdPan = ctx.createStereoPanner();
    this.crowdGain.connect(this.crowdPan).connect(bus);
    this.crowdPan.connect(wet);
    for (let i = 0; i < FORMANT_RANGES.length; i++) {
      const [lo, hi] = FORMANT_RANGES[i];
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      bp.frequency.value = (lo + hi) / 2;
      const am = ctx.createGain();
      am.gain.value = 0.5 / (i + 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.4 + Math.random() * 1.6;
      const depth = ctx.createGain();
      depth.gain.value = 0.35 / (i + 1);
      lfo.connect(depth).connect(am.gain);
      lfo.start();
      crowd.connect(bp).connect(am).connect(this.crowdGain);
      this.crowdFormants.push(bp);
    }

    // Flag flap: bright noise chopped by a fluttering LFO.
    const flap = loop(engine.white);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    this.flapLfo = ctx.createOscillator();
    this.flapLfo.type = 'square';
    this.flapLfo.frequency.value = 9;
    const flapDepth = ctx.createGain();
    flapDepth.gain.value = 0.45;
    this.flapLfo.connect(flapDepth).connect(chop.gain);
    this.flapLfo.start();
    this.flapGain = ctx.createGain();
    this.flapGain.gain.value = 0;
    flap.connect(hp).connect(bp).connect(chop).connect(this.flapGain).connect(bus);

    // Fire: low roar + crackle, panned toward the effigy.
    this.firePan = ctx.createStereoPanner();
    this.firePan.connect(bus);
    this.firePan.connect(wet);
    const roar = loop(engine.pink);
    const roarLP = ctx.createBiquadFilter();
    roarLP.type = 'lowpass';
    roarLP.frequency.value = 480;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    roar.connect(roarLP).connect(this.fireGain).connect(this.firePan);
    const crackle = loop(engine.crackle);
    const crackleHP = ctx.createBiquadFilter();
    crackleHP.type = 'highpass';
    crackleHP.frequency.value = 1200;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    crackle.connect(crackleHP).connect(this.crackleGain).connect(this.firePan);
  }

  update(s: Soundscape, dt: number): void {
    const t = this.ctx.currentTime;
    const title = s.mode === 'title';

    // Gusts: a random walk toward a new target every few seconds.
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTarget = Math.random() * Math.random() + (Math.random() < 0.15 ? 0.6 : 0);
      this.gustTimer = 2 + Math.random() * 5;
    }
    this.gust = approach(this.gust, this.gustTarget, 0.5, dt);
    const g = Math.min(1, this.gust);
    this.windGain.gain.setTargetAtTime((0.1 + 0.2 * g) * (1 + 0.35 * s.night), t, 0.3);
    this.windBP.frequency.setTargetAtTime(280 + 750 * g, t, 0.4);
    this.whistleGain.gain.setTargetAtTime(0.025 * g * g, t, 0.4);
    this.whistleBP.frequency.setTargetAtTime(1100 + 900 * g, t, 0.6);

    // Crowd: babble by wandering the formants a few times a second.
    this.crowdGain.gain.setTargetAtTime(s.crowd * (title ? 0.12 : 0.26) * (0.8 + 0.4 * s.night), t, 0.5);
    this.crowdPan.pan.setTargetAtTime(s.festPan * 0.6, t, 0.5);
    this.babbleTimer -= dt;
    if (this.babbleTimer <= 0) {
      this.babbleTimer = 0.12 + Math.random() * 0.25;
      for (let i = 0; i < this.crowdFormants.length; i++) {
        const [lo, hi] = FORMANT_RANGES[i];
        this.crowdFormants[i].frequency.setTargetAtTime(lo + Math.random() * (hi - lo), t, 0.08);
      }
    }

    // Flags flapping: more Flags nearby, more cloth in the wind.
    const flags = Math.min(1, s.flags / 8);
    this.flapGain.gain.setTargetAtTime(flags * 0.1 * (0.4 + g), t, 0.3);
    this.flapLfo.frequency.setTargetAtTime(6 + 8 * g + Math.random() * 1.5, t, 0.2);

    // The Burn.
    this.fireGain.gain.setTargetAtTime(s.fire * 0.5, t, 1);
    this.crackleGain.gain.setTargetAtTime(s.fire * 0.9, t, 1);
    this.firePan.pan.setTargetAtTime(s.firePan * (1 - s.fire * 0.5), t, 0.3);

    // Crickets: chirp clusters scattered around the listener at night.
    if (s.night > 0.25 && Math.random() < s.night * 2.2 * dt * (1 - 0.7 * s.burn)) this.cricket(s.night);
  }

  private cricket(night: number): void {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const o = c.createOscillator();
    o.frequency.value = 4200 + Math.random() * 1000;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    const pulses = 3 + Math.floor(Math.random() * 3);
    const peak = 0.012 * night * (0.5 + Math.random());
    for (let i = 0; i < pulses; i++) {
      const p = t + i * 0.045;
      g.gain.setValueAtTime(0, p);
      g.gain.linearRampToValueAtTime(peak, p + 0.008);
      g.gain.linearRampToValueAtTime(0, p + 0.03);
    }
    const end = t + pulses * 0.045 + 0.05;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    o.connect(g).connect(pan).connect(this.e.buses.ambience);
    o.start(t);
    o.stop(end);
    this.e.track(pan, end + 0.05);
  }
}
