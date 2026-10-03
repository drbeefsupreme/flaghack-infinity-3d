/**
 * Synthesis primitives shared by SFX, music and ambience. Each schedules its nodes from time
 * `t` into `out` and stops its sources itself; callers own the routing lifetime of `out`.
 */

/** Attack / hold / decay envelope (exponential decay to silence). */
export interface Env {
  a?: number;
  h?: number;
  d: number;
  peak?: number;
}

/** Apply an AHD envelope to a gain param; returns the time it reaches silence. */
export function envelope(g: AudioParam, t: number, e: Env): number {
  const a = e.a ?? 0.004;
  const h = e.h ?? 0;
  const peak = e.peak ?? 1;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  if (h > 0) g.setValueAtTime(peak, t + a + h);
  const end = t + a + h + e.d;
  g.exponentialRampToValueAtTime(0.0001, end);
  g.setValueAtTime(0, end + 0.01);
  return end;
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** Glide target frequency, reached exponentially over `glide` seconds. */
  f2?: number;
  glide?: number;
  detune?: number;
  /** Vibrato depth (cents) and rate (Hz). */
  vib?: number;
  vibRate?: number;
  env: Env;
}

export function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts): number {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.glide ?? o.env.d));
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const end = envelope(g.gain, t, o.env);
  if (o.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibRate ?? 5.5;
    const depth = ctx.createGain();
    depth.gain.value = o.vib;
    lfo.connect(depth).connect(osc.detune);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(end + 0.05);
  return end;
}

export interface NoiseOpts {
  buf: AudioBuffer;
  filter?: BiquadFilterType;
  f?: number;
  /** Filter sweep target, reached exponentially over `sweep` seconds. */
  f2?: number;
  sweep?: number;
  q?: number;
  rate?: number;
  /** Buffer start offset (s); random by default so repeated hits never share a waveform. */
  offset?: number;
  env: Env;
}

export function noise(ctx: BaseAudioContext, out: AudioNode, t: number, o: NoiseOpts): number {
  const src = ctx.createBufferSource();
  src.buffer = o.buf;
  src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  const g = ctx.createGain();
  const end = envelope(g.gain, t, o.env);
  let head: AudioNode = src;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.f ?? 1000, t);
    if (o.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.sweep ?? o.env.d));
    f.Q.value = o.q ?? 1;
    head.connect(f);
    head = f;
  }
  head.connect(g).connect(out);
  src.start(t, o.offset ?? Math.random() * 1.5);
  src.stop(end + 0.05);
  return end;
}

/** Inharmonic struck-glass/bell partials (ratios of a free bar / glass). */
const BELL_PARTIALS: readonly [number, number, number][] = [
  // ratio, relative gain, relative decay
  [1, 1, 1],
  [2.76, 0.45, 0.55],
  [5.4, 0.25, 0.3],
  [8.93, 0.12, 0.18],
];

export function bell(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, d: number, peak: number, partials = 4): number {
  let end = t;
  for (let i = 0; i < partials && i < BELL_PARTIALS.length; i++) {
    const p = BELL_PARTIALS[i];
    const pf = f * p[0];
    if (pf > 16000) break;
    end = Math.max(end, tone(ctx, out, t, { f: pf, env: { a: 0.002, d: d * p[2], peak: peak * p[1] } }));
  }
  return end;
}

/** Two-operator FM: a glassy/metallic tone whose brightness decays with the note. */
export function fm(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  f: number,
  ratio: number,
  index: number,
  env: Env,
  type: OscillatorType = 'sine',
): number {
  const car = ctx.createOscillator();
  car.type = type;
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f * ratio;
  const depth = ctx.createGain();
  const dur = (env.a ?? 0.004) + (env.h ?? 0) + env.d;
  depth.gain.setValueAtTime(f * index, t);
  depth.gain.exponentialRampToValueAtTime(Math.max(0.01, f * index * 0.08), t + dur);
  mod.connect(depth).connect(car.frequency);
  const g = ctx.createGain();
  const end = envelope(g.gain, t, env);
  car.connect(g).connect(out);
  car.start(t);
  mod.start(t);
  car.stop(end + 0.05);
  mod.stop(end + 0.05);
  return end;
}

/** Vowel formants (Hz, gain) for the crystal choir. */
export type Vowel = 'a' | 'o' | 'u' | 'e';
const VOWELS: Record<Vowel, readonly [number, number][]> = {
  a: [
    [730, 1],
    [1090, 0.5],
    [2440, 0.25],
  ],
  o: [
    [570, 1],
    [840, 0.45],
    [2410, 0.18],
  ],
  u: [
    [300, 1],
    [870, 0.3],
    [2240, 0.12],
  ],
  e: [
    [530, 1],
    [1840, 0.45],
    [2480, 0.25],
  ],
};

/**
 * Choir: a detuned sawtooth stack per note through parallel vowel formant filters, with slow
 * attack and release. Returns the end time.
 */
export function choir(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  freqs: readonly number[],
  vowel: Vowel,
  env: Env,
): number {
  const sum = ctx.createGain();
  sum.gain.value = 1;
  const g = ctx.createGain();
  const end = envelope(g.gain, t, env);
  for (const f of freqs) {
    for (const det of [-9, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.5 + Math.random() * 1.5;
      const lg = ctx.createGain();
      lg.gain.value = 12;
      lfo.connect(lg).connect(o.detune);
      o.connect(sum);
      o.start(t);
      lfo.start(t);
      o.stop(end + 0.05);
      lfo.stop(end + 0.05);
    }
  }
  const scale = 0.5 / Math.max(1, freqs.length);
  for (const [ff, fg] of VOWELS[vowel]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = ff;
    bp.Q.value = 9;
    const fgain = ctx.createGain();
    fgain.gain.value = fg * scale * 4;
    sum.connect(bp).connect(fgain).connect(g);
  }
  g.connect(out);
  return end;
}
