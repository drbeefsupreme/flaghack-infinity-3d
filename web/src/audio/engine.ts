/**
 * WebAudio engine: context, mix buses (master → glue compressor → limiter, music / sfx / ui / ambience),
 * a generated-impulse convolution reverb, the camera listener, positional voice routing and
 * voice management (a global one-shot cap with priority stealing plus per-sound token-bucket
 * rate limits, so fifty Flags planted in one second ring out instead of clipping).
 */
import type { Settings } from '../game/session';
import type { V2 } from '../sim/math';

export type Bus = 'music' | 'sfx' | 'ui' | 'ambience';

/** Per-sound rate limit: sustained plays per second and the burst allowed on top. */
interface RateRule {
  perSec: number;
  burst: number;
}

/** Rate limits by voice key; unknown keys use DEFAULT_RATE. */
const RATES: Record<string, RateRule> = {
  plant: { perSec: 10, burst: 8 },
  pull: { perSec: 6, burst: 4 },
  throw: { perSec: 8, burst: 4 },
  land: { perSec: 8, burst: 4 },
  ley: { perSec: 4, burst: 3 },
  leyOff: { perSec: 2, burst: 2 },
  facet: { perSec: 8, burst: 5 },
  phason: { perSec: 5, burst: 4 },
  swing: { perSec: 10, burst: 5 },
  hit: { perSec: 10, burst: 5 },
  ko: { perSec: 3, burst: 3 },
  recruit: { perSec: 3, burst: 2 },
  harvest: { perSec: 6, burst: 3 },
  piece: { perSec: 8, burst: 5 },
  crash: { perSec: 4, burst: 3 },
  ward: { perSec: 3, burst: 2 },
  firework: { perSec: 3, burst: 3 },
  cricket: { perSec: 6, burst: 3 },
  ui: { perSec: 20, burst: 6 },
  instability: { perSec: 2, burst: 2 },
  discharge: { perSec: 4, burst: 3 },
  ping: { perSec: 3, burst: 3 },
};
const DEFAULT_RATE: RateRule = { perSec: 6, burst: 4 };

interface Bucket {
  tokens: number;
  last: number;
}

interface Voice {
  out: GainNode;
  /** Routing nodes after `out` (panner, air filter, wet send) to disconnect when done. */
  chain: AudioNode[];
  end: number;
  priority: number;
}

export interface VoiceSpec {
  /** Rate-limit bucket. */
  key: string;
  /** Total length until silent (s), from the voice start. */
  dur: number;
  /** World position; omitted = non-positional (centre, no distance attenuation). */
  at?: V2;
  /** Reference-distance multiplier for big sounds that carry across the burn. */
  range?: number;
  gain?: number;
  /** Reverb send 0..1. */
  wet?: number;
  /** 0 ambient … 3 critical (never stolen by lower priorities). */
  priority?: number;
  /** Start delay (s) from now. */
  delay?: number;
  bus?: Bus;
}

/** What recipes receive: the voice input node, its start time and the shared kit. */
export interface VoiceHandle {
  input: GainNode;
  t: number;
}

const REF_DISTANCE = 10;
const MIN_AUDIBLE = 0.015;
/** The camera's height counts for only part of the listener distance, so the high Command View camera still hears the ground. */
const HEIGHT_WEIGHT = 0.25;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly muffle: BiquadFilterNode;
  readonly compressor: DynamicsCompressorNode;
  /** Final fast limiter: keeps pile-ups (a Tide over a capture over an Omega) off the 0 dBFS rail. */
  readonly limiter: DynamicsCompressorNode;
  readonly buses: Record<Bus, GainNode>;
  /** Reverb send inputs per bus; their gains follow the bus volume so tails respect settings. */
  readonly wet: Record<Bus, GainNode>;
  /** Extra gain on the music bus for ducking under huge moments. */
  readonly musicDuck: GainNode;
  readonly reverb: ConvolverNode;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly crackle: AudioBuffer;
  quality: Settings['quality'] = 'high';

  /** Listener (camera) position and horizontal right/forward axes. */
  lx = 0;
  ly = 0;
  lz = 0;
  rx = 1;
  rz = 0;

  private voices: Voice[] = [];
  /** Uncapped groups (music notes, ambience chirps) disconnected after their end time. */
  private tracked: AudioNode[] = [];
  private trackedEnd: number[] = [];
  private buckets = new Map<string, Bucket>();

  stats = { started: 0, rateDropped: 0, stolen: 0, capDropped: 0, inaudible: 0 };

  constructor() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.master.connect(this.muffle).connect(this.compressor).connect(this.limiter).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8);
    const ret = ctx.createGain();
    ret.gain.value = 0.55;
    this.reverb.connect(ret).connect(this.master);

    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.master);
    this.buses = {
      music: ctx.createGain(),
      sfx: ctx.createGain(),
      ui: ctx.createGain(),
      ambience: ctx.createGain(),
    };
    this.wet = {
      music: ctx.createGain(),
      sfx: ctx.createGain(),
      ui: ctx.createGain(),
      ambience: ctx.createGain(),
    };
    this.buses.music.connect(this.musicDuck);
    this.buses.sfx.connect(this.master);
    this.buses.ui.connect(this.master);
    this.buses.ambience.connect(this.master);
    for (const b of ['music', 'sfx', 'ui', 'ambience'] as const) this.wet[b].connect(this.reverb);

    this.white = this.makeNoise(2, 1, 'white');
    this.pink = this.makeNoise(4, 2, 'pink');
    this.crackle = this.makeCrackle(3);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Voice-count cap by quality (one-shot SFX only). */
  get maxVoices(): number {
    return this.quality === 'high' ? 48 : this.quality === 'medium' ? 32 : 20;
  }

  get activeVoices(): number {
    return this.voices.length;
  }

  get trackedCount(): number {
    return this.tracked.length;
  }

  /** `worldScale` trims world SFX (e.g. the attract match behind the title screen). */
  setVolumes(s: Settings, muffled: boolean, worldScale: number): void {
    const t = this.ctx.currentTime;
    this.quality = s.quality;
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    const music = s.musicVolume;
    const sfx = s.sfxVolume * worldScale;
    this.buses.music.gain.setTargetAtTime(music, t, 0.05);
    this.wet.music.gain.setTargetAtTime(music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(sfx, t, 0.05);
    this.wet.sfx.gain.setTargetAtTime(sfx, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(s.sfxVolume * 0.8, t, 0.05);
    this.wet.ui.gain.setTargetAtTime(s.sfxVolume * 0.8, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(s.sfxVolume * 0.85, t, 0.05);
    this.wet.ambience.gain.setTargetAtTime(s.sfxVolume * 0.85, t, 0.05);
    this.muffle.frequency.setTargetAtTime(muffled ? 700 : 20000, t, 0.15);
  }

  /** Listener from a camera: position + world matrix columns (right = col 0, forward = -col 2). */
  setListener(px: number, py: number, pz: number, m: ArrayLike<number>): void {
    this.lx = px;
    this.ly = py * HEIGHT_WEIGHT;
    this.lz = pz;
    const rl = Math.hypot(m[0], m[2]) || 1;
    this.rx = m[0] / rl;
    this.rz = m[2] / rl;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(this.ly, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(-m[8], t, 0.02);
      l.forwardY.setTargetAtTime(-m[9], t, 0.02);
      l.forwardZ.setTargetAtTime(-m[10], t, 0.02);
      l.upX.setTargetAtTime(m[4], t, 0.02);
      l.upY.setTargetAtTime(m[5], t, 0.02);
      l.upZ.setTargetAtTime(m[6], t, 0.02);
    }
  }

  /** Inverse-distance gain from the listener (1 inside the reference radius). */
  distanceGain(x: number, z: number, range = 1): number {
    const ref = REF_DISTANCE * range;
    const d = Math.hypot(x - this.lx, z - this.lz, this.ly);
    return d <= ref ? 1 : ref / (ref + 1.1 * (d - ref));
  }

  /** Stereo pan (-1..1) of a world point relative to the listener's right axis. */
  panOf(x: number, z: number): number {
    const dx = x - this.lx;
    const dz = z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return 0;
    const p = (dx * this.rx + dz * this.rz) / d;
    return p < -1 ? -1 : p > 1 ? 1 : p * 0.85;
  }

  /**
   * Start a one-shot voice. Returns null when rate-limited, inaudible, or the voice cap is
   * full of higher-priority sounds. Recipes connect their sources into `input` and schedule
   * everything from `t`.
   */
  voice(spec: VoiceSpec): VoiceHandle | null {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005 + (spec.delay ?? 0);
    const priority = spec.priority ?? 1;
    let gain = spec.gain ?? 1;

    // Positional attenuation first: inaudible voices never take a slot or a token.
    let dist = 1;
    if (spec.at) {
      dist = this.distanceGain(spec.at.x, spec.at.z, spec.range ?? 1);
      if (dist * gain < MIN_AUDIBLE) {
        this.stats.inaudible++;
        return null;
      }
    }

    // Token bucket: repeated sounds thin out and duck instead of stacking into clipping.
    const rule = RATES[spec.key] ?? DEFAULT_RATE;
    let b = this.buckets.get(spec.key);
    if (!b) {
      b = { tokens: rule.burst, last: t };
      this.buckets.set(spec.key, b);
    }
    b.tokens = Math.min(rule.burst, b.tokens + (t - b.last) * rule.perSec);
    b.last = t;
    if (b.tokens < 1 && priority < 3) {
      this.stats.rateDropped++;
      return null;
    }
    b.tokens = Math.max(0, b.tokens - 1);
    gain *= 0.55 + 0.45 * Math.min(1, b.tokens / rule.burst);

    if (this.voices.length >= this.maxVoices && !this.steal(priority)) {
      this.stats.capDropped++;
      return null;
    }

    const input = ctx.createGain();
    const out = ctx.createGain();
    input.connect(out);
    const chain: AudioNode[] = [];
    const bus = spec.bus ?? 'sfx';
    let tail: AudioNode = out;
    if (spec.at) {
      const x = spec.at.x;
      const z = spec.at.z;
      // Air absorption: distant sounds lose their top end.
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(900, 18000 * dist * dist);
      tail.connect(air);
      chain.push(air);
      tail = air;
      if (this.quality === 'high') {
        const p = ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.refDistance = REF_DISTANCE * (spec.range ?? 1);
        p.rolloffFactor = 1.1;
        p.maxDistance = 10000;
        p.positionX.value = x;
        p.positionY.value = 0;
        p.positionZ.value = z;
        tail.connect(p);
        chain.push(p);
        tail = p;
      } else {
        const p = ctx.createStereoPanner();
        p.pan.value = this.panOf(x, z);
        out.gain.value = dist;
        tail.connect(p);
        chain.push(p);
        tail = p;
      }
    }
    input.gain.value = gain;
    tail.connect(this.buses[bus]);
    const wet = spec.wet ?? 0.15;
    if (wet > 0) {
      const send = ctx.createGain();
      // Distant sounds are relatively wetter: the reverb carries further than the dry path.
      send.gain.value = wet * (spec.at ? Math.min(1, 0.4 + 0.6 * Math.sqrt(dist)) : 1);
      tail.connect(send).connect(this.wet[bus]);
      chain.push(send);
    }
    this.voices.push({ out, chain, end: t + spec.dur + 0.1, priority });
    this.stats.started++;
    return { input, t };
  }

  /** Steal the oldest voice with priority ≤ `priority`; false if none qualifies. */
  private steal(priority: number): boolean {
    let idx = -1;
    let bestEnd = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.priority <= priority && v.end < bestEnd) {
        bestEnd = v.end;
        idx = i;
      }
    }
    if (idx < 0) return false;
    const v = this.voices[idx];
    const t = this.ctx.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.015);
    // Keep its routing alive for the fade, but free the slot now.
    this.track(v.out, t + 0.1);
    for (const n of v.chain) this.track(n, t + 0.1);
    this.voices[idx] = this.voices[this.voices.length - 1];
    this.voices.pop();
    this.stats.stolen++;
    return true;
  }

  /** Disconnect `node` once `end` passes (uncapped music/ambience groups). */
  track(node: AudioNode, end: number): void {
    this.tracked.push(node);
    this.trackedEnd.push(end);
  }

  /** Free finished voices and tracked nodes (in-place compaction, no allocation). */
  prune(): void {
    const t = this.ctx.currentTime;
    let w = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.end < t) {
        v.out.disconnect();
        for (const n of v.chain) n.disconnect();
      } else this.voices[w++] = v;
    }
    this.voices.length = w;
    w = 0;
    for (let i = 0; i < this.tracked.length; i++) {
      if (this.trackedEnd[i] < t) this.tracked[i].disconnect();
      else {
        this.tracked[w] = this.tracked[i];
        this.trackedEnd[w] = this.trackedEnd[i];
        w++;
      }
    }
    this.tracked.length = w;
    this.trackedEnd.length = w;
  }

  /** Briefly pull the music down under a huge moment (capture, Omega, The Burn). */
  duck(amount: number, hold: number): void {
    const g = this.musicDuck.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - amount, t, 0.04);
    g.setTargetAtTime(1, t + hold, 0.6);
  }

  /** Stereo room impulse: dense exponentially decaying noise with a darkening tail. */
  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        // One-pole lowpass whose coefficient falls over time: high frequencies die first.
        const k = 0.9 - 0.75 * x;
        lp += k * (Math.random() * 2 - 1 - lp);
        const early = i < rate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 1.5 : 0;
        d[i] = (lp + early) * Math.pow(1 - x, 2.2) * Math.exp(-x * 3);
      }
    }
    return buf;
  }

  private makeNoise(seconds: number, channels: number, color: 'white' | 'pink'): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(channels, len, rate);
    for (let c = 0; c < channels; c++) {
      const d = buf.getChannelData(c);
      if (color === 'white') {
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        continue;
      }
      // Paul Kellet's economy pink filter.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return buf;
  }

  /** Sparse random impulses (fire crackle / firework sparkle bed). */
  private makeCrackle(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0009) {
        const amp = Math.random() * Math.random();
        const n = 20 + Math.floor(Math.random() * 120);
        for (let j = 0; j < n && i + j < len; j++) d[i + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / (n * 0.25));
      }
    }
    return buf;
  }
}
