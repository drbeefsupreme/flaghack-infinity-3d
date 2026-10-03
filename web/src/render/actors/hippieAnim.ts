/**
 * Procedural hippie animation: maps a hippie's visible status to an animation and writes the
 * 16 joint values (see HJ) plus root motion for the current presentation time. Dancing and
 * drumming also get a beat-locked additive layer (beatHippie) driven by the festival beat
 * clock, applied after pose smoothing so it stays on the kick. Pure maths, no allocation; the
 * renderer blends the result into each hippie's displayed pose.
 */
import type { Hippie } from '../../sim/types';
import { HJ, PROP } from './hippieModel';
import { clamp01, easeOutCubic, hash01b, kickDip } from './util';

export type HippieAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'flee'
  | 'carry'
  | 'haul'
  | 'chop'
  | 'kneel'
  | 'tug'
  | 'shove'
  | 'kick'
  | 'drum'
  | 'dance'
  | 'hammer'
  | 'guard'
  | 'ko';

/** Root motion layered on the instance transform. */
export interface HippieRoot {
  bob: number;
  pitch: number;
  roll: number;
  yaw: number;
}

/** Animations with a beat-locked layer (see beatHippie). */
export const BEAT_ANIMS: Partial<Record<HippieAnim, true>> = { dance: true, drum: true };

/** Arm pitch with a drummer's hand resting on the skin (kneeling, torso leaning in). */
const DRUM_CONTACT = 0.02;
/** Arm pitch lift between strokes for a hand that plays once per beat. */
const DRUM_LIFT = 0.6;

/** Drum-circle patterns: stroke period and offset in beats, left hand then right hand. */
const DRUM_PATTERNS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 1, 0.5], // eighths, hands alternating
  [0.5, 0, 0.5, 0.25], // sixteenths, hands alternating
  [1, 0, 1, 0], // both hands on every beat
  [1, 0, 0.5, 0.25], // tumbao: left on the beat, right on the "e" and "a"
];

/** Locomotion cycle length in metres per full stride pair. */
export const JOG_CYCLE = 2.0;
export const RUN_CYCLE = 2.7;

/** Choose the animation for a hippie from its D.E.G.E.N. status and visible speed. */
export function hippieAnimFor(h: Hippie, speed: number): HippieAnim {
  const moving = speed > 0.6;
  switch (h.status) {
    case 'ko':
      return 'ko';
    case 'fleeing':
      return moving ? 'flee' : 'idle';
    case 'responding':
      return moving ? 'run' : 'guard';
    case 'hauling':
      return 'haul';
    case 'chopping':
      return moving ? 'walk' : 'chop';
    case 'planting':
      return moving ? 'carry' : 'kneel';
    case 'pulling':
      return moving ? 'walk' : 'tug';
    case 'building':
    case 'repairing':
      return moving ? 'walk' : 'hammer';
    case 'fighting':
      return moving ? 'run' : 'shove';
    case 'tearing':
      return moving ? 'walk' : 'kick';
    case 'drumming':
      return moving ? 'walk' : 'drum';
    case 'defending':
      return moving ? 'walk' : 'guard';
    case 'distracted':
      return moving ? 'walk' : 'dance';
    default:
      if (h.carryingFlag >= 0) return 'carry';
      if (h.carryingLumber > 0) return 'haul';
      if (!moving) return 'idle';
      return speed > 6.6 ? 'run' : 'walk';
  }
}

/** Held prop shown for an animation (axe for chopping, bongos for drumming…). */
export function propFor(anim: HippieAnim, h: Hippie): number {
  if (anim === 'chop') return PROP.axe;
  if (anim === 'hammer') return PROP.hammer;
  if (anim === 'drum') return PROP.bongo;
  if (anim === 'haul' || (h.carryingLumber > 0 && anim !== 'ko')) return PROP.lumber;
  return PROP.none;
}

function idle(p: Float32Array, r: HippieRoot, t: number, seed: number): void {
  const br = Math.sin(t * 1.7 + seed * 6);
  p[HJ.torsoPitch] = 0.02 * br;
  p[HJ.headPitch] = 0.04 * Math.sin(t * 0.5 + seed * 3);
  p[HJ.headYaw] = 0.45 * Math.sin(t * 0.33 + seed * 9) * Math.sin(t * 0.21 + seed);
  p[HJ.armLRoll] = 0.1 + 0.02 * br;
  p[HJ.armRRoll] = 0.1 + 0.02 * br;
  p[HJ.armLPitch] = 0.05;
  p[HJ.armRPitch] = 0.05;
  p[HJ.kneeL] = 0.05;
  p[HJ.kneeR] = 0.05;
  r.bob = 0.006 * br;
  r.roll = 0.03 * Math.sin(t * 0.8 + seed * 4) * (seed > 0.5 ? 1 : 0.3);
}

/** Scale every joint toward zero (used to cross-fade idle into locomotion). */
function fade(p: Float32Array, r: HippieRoot, k: number): void {
  for (let i = 0; i < p.length; i++) p[i] *= k;
  r.bob *= k;
  r.roll *= k;
  r.pitch *= k;
}

/** Leg cycle: thighs swing in antiphase; the swinging leg's knee folds. */
function legs(p: Float32Array, phase: number, gait: number, amp: number, knee: number): void {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  p[HJ.thighL] += amp * s * gait;
  p[HJ.thighR] -= amp * s * gait;
  p[HJ.kneeL] += (0.06 + knee * Math.max(0, c)) * gait;
  p[HJ.kneeR] += (0.06 + knee * Math.max(0, -c)) * gait;
}

function locomotion(p: Float32Array, r: HippieRoot, t: number, phase: number, gait: number, seed: number, run: boolean): void {
  idle(p, r, t, seed);
  fade(p, r, 1 - gait);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const amp = run ? 0.95 : 0.62;
  legs(p, phase, gait, amp, run ? 1.35 : 0.9);
  const arm = run ? 0.85 : 0.55;
  const armBase = run ? 0.35 : 0;
  p[HJ.armLPitch] += (armBase - arm * s) * gait;
  p[HJ.armRPitch] += (armBase + arm * s) * gait;
  p[HJ.armLRoll] += 0.12 * gait;
  p[HJ.armRRoll] += 0.12 * gait;
  p[HJ.torsoPitch] += (run ? 0.28 : 0.08) * gait;
  p[HJ.torsoYaw] += 0.1 * s * gait;
  p[HJ.headPitch] -= (run ? 0.15 : 0.04) * gait;
  r.bob += gait * (run ? 0.07 : 0.04) * (Math.abs(c) - 0.5);
  r.roll += 0.035 * s * gait;
}

/**
 * Write the target pose for `anim` into `p` (16 joints) and `r` (root motion).
 * `phase` is the distance-driven stride phase, `gait` 0..1 the locomotion weight.
 */
export function poseHippie(anim: HippieAnim, t: number, phase: number, gait: number, seed: number, p: Float32Array, r: HippieRoot): void {
  p.fill(0);
  r.bob = 0;
  r.pitch = 0;
  r.roll = 0;
  r.yaw = 0;
  switch (anim) {
    case 'idle':
      idle(p, r, t, seed);
      return;
    case 'walk':
      locomotion(p, r, t, phase, gait, seed, false);
      return;
    case 'run':
      locomotion(p, r, t, phase, gait, seed, true);
      return;
    case 'flee':
      locomotion(p, r, t, phase, gait, seed, true);
      p[HJ.armLPitch] = 2.5 + 0.4 * Math.sin(phase * 2);
      p[HJ.armRPitch] = 2.5 + 0.4 * Math.sin(phase * 2 + 1.3);
      p[HJ.armLRoll] = 0.45;
      p[HJ.armRRoll] = 0.45;
      p[HJ.headYaw] = 0.7 * Math.sin(t * 2.3 + seed * 5);
      return;
    case 'carry':
      locomotion(p, r, t, phase, gait, seed, false);
      p[HJ.armRPitch] = 0.75;
      p[HJ.armRRoll] = -0.25;
      p[HJ.torsoYaw] *= 0.5;
      return;
    case 'haul':
      locomotion(p, r, t, phase, gait * 0.85, seed, false);
      p[HJ.armRPitch] = 2.4;
      p[HJ.armRRoll] = 0.15;
      p[HJ.armLPitch] = 2.0;
      p[HJ.armLRoll] = -0.55;
      p[HJ.torsoPitch] += 0.1;
      p[HJ.torsoYaw] = 0;
      return;
    case 'chop': {
      const k = (t / 1.0 + seed) % 1;
      let arm: number;
      let lean: number;
      let knee = 0.12;
      if (k < 0.55) {
        const u = easeOutCubic(k / 0.55);
        arm = 0.5 + 2.6 * u;
        lean = 0.25 - 0.45 * u;
      } else if (k < 0.68) {
        const u = (k - 0.55) / 0.13;
        arm = 3.1 - 2.65 * u * u;
        lean = -0.2 + 0.7 * u;
        knee += 0.25 * u;
      } else {
        const u = (k - 0.68) / 0.32;
        arm = 0.45 + 0.05 * u;
        lean = 0.5 - 0.25 * easeOutCubic(u);
        knee += 0.25 * (1 - u);
      }
      p[HJ.armLPitch] = arm;
      p[HJ.armRPitch] = arm;
      p[HJ.armLRoll] = -0.28;
      p[HJ.armRRoll] = -0.28;
      p[HJ.torsoPitch] = lean;
      p[HJ.headPitch] = 0.15;
      p[HJ.spread] = 0.12;
      p[HJ.kneeL] = knee;
      p[HJ.kneeR] = knee;
      r.bob = -0.02 - knee * 0.05;
      return;
    }
    case 'kneel': {
      const push = Math.sin(t * 7 + seed * 4);
      r.bob = -0.42;
      p[HJ.thighL] = 1.57;
      p[HJ.kneeL] = 1.57;
      p[HJ.kneeR] = 1.57;
      p[HJ.torsoPitch] = 0.35 + 0.05 * push;
      p[HJ.armLPitch] = 0.85 + 0.12 * push;
      p[HJ.armRPitch] = 0.85 + 0.12 * push;
      p[HJ.armLRoll] = -0.2;
      p[HJ.armRRoll] = -0.2;
      p[HJ.headPitch] = 0.35;
      return;
    }
    case 'tug': {
      const tug = Math.sin(t * 6 + seed * 3);
      r.bob = -0.06;
      r.pitch = -0.12;
      p[HJ.torsoPitch] = -0.3 + 0.12 * tug;
      p[HJ.armLPitch] = 1.0 + 0.15 * tug;
      p[HJ.armRPitch] = 1.0 + 0.15 * tug;
      p[HJ.armLRoll] = -0.22;
      p[HJ.armRRoll] = -0.22;
      p[HJ.thighL] = 0.4;
      p[HJ.kneeL] = 0.35;
      p[HJ.thighR] = -0.25;
      p[HJ.kneeR] = 0.25;
      p[HJ.headPitch] = 0.2;
      return;
    }
    case 'shove': {
      const k = (t / 0.8 + seed) % 1;
      const thrust = k < 0.25 ? easeOutCubic(k / 0.25) : 1 - (k - 0.25) / 0.75;
      p[HJ.armLPitch] = 0.9 + 0.75 * thrust;
      p[HJ.armRPitch] = 0.9 + 0.75 * thrust;
      p[HJ.armLRoll] = -0.1;
      p[HJ.armRRoll] = -0.1;
      p[HJ.torsoPitch] = 0.15 + 0.25 * thrust;
      p[HJ.thighL] = 0.3;
      p[HJ.kneeL] = 0.2;
      p[HJ.thighR] = -0.2;
      p[HJ.kneeR] = 0.1;
      r.bob = -0.03;
      return;
    }
    case 'kick': {
      const k = (t / 0.9 + seed) % 1;
      let thigh: number;
      let knee: number;
      if (k < 0.3) {
        const u = k / 0.3;
        thigh = -0.3 * u;
        knee = 1.0 * u;
      } else if (k < 0.45) {
        const u = (k - 0.3) / 0.15;
        thigh = -0.3 + 1.55 * u;
        knee = 1.0 - 0.9 * u;
      } else {
        const u = (k - 0.45) / 0.55;
        thigh = 1.25 * (1 - u);
        knee = 0.1 * (1 - u);
      }
      const kick = clamp01(thigh / 1.25);
      p[HJ.thighR] = thigh;
      p[HJ.kneeR] = knee;
      p[HJ.kneeL] = 0.15;
      p[HJ.armLRoll] = 0.5 + 0.25 * kick;
      p[HJ.armRRoll] = 0.5 + 0.25 * kick;
      p[HJ.torsoPitch] = -0.15 * kick;
      return;
    }
    case 'drum':
      // Kneeling with both hands on the skins; the strokes are the beat layer (beatHippie).
      r.bob = -0.42;
      p[HJ.kneeL] = 1.57;
      p[HJ.kneeR] = 1.57;
      p[HJ.torsoPitch] = 0.3;
      p[HJ.armLPitch] = DRUM_CONTACT;
      p[HJ.armRPitch] = DRUM_CONTACT;
      p[HJ.armLRoll] = -0.12;
      p[HJ.armRRoll] = -0.12;
      p[HJ.headPitch] = 0.1;
      return;
    case 'dance': {
      // Each style's stance; the bounce, pumps and half-time steps are the beat layer.
      const style = Math.floor(seed * 4);
      r.bob = -0.015;
      p[HJ.kneeL] = 0.16;
      p[HJ.kneeR] = 0.16;
      if (style === 0) {
        // Arms up, waving and spinning freely: the one style whose flourish ignores the beat.
        p[HJ.armLRoll] = 2.3 + 0.35 * Math.sin(t * 4);
        p[HJ.armRRoll] = 2.3 + 0.35 * Math.sin(t * 4 + 1.2);
        p[HJ.armLPitch] = 0.2;
        p[HJ.armRPitch] = 0.2;
        p[HJ.headPitch] = -0.2;
        r.yaw = t * 1.6;
        r.roll = 0.08 * Math.sin(t * 4.4);
      } else if (style === 1) {
        p[HJ.armLRoll] = 0.6;
        p[HJ.armRRoll] = 0.6;
        p[HJ.armLPitch] = 0.35;
        p[HJ.armRPitch] = 0.35;
      } else if (style === 2) {
        p[HJ.armRPitch] = 2.65;
        p[HJ.armRRoll] = 0.1;
        p[HJ.armLPitch] = 0.3;
        p[HJ.armLRoll] = 0.25;
      } else {
        p[HJ.armLRoll] = 0.35;
        p[HJ.armRRoll] = 0.35;
        p[HJ.kneeL] = 0.2;
        p[HJ.kneeR] = 0.2;
      }
      return;
    }
    case 'hammer': {
      const s = Math.sin(t * 8 + seed * 5);
      p[HJ.torsoPitch] = 0.5;
      p[HJ.headPitch] = 0.3;
      p[HJ.armRPitch] = 1.0 + 0.7 * s;
      p[HJ.armLPitch] = 0.9;
      p[HJ.armLRoll] = -0.2;
      p[HJ.kneeL] = 0.35;
      p[HJ.kneeR] = 0.35;
      p[HJ.spread] = 0.1;
      r.bob = -0.08;
      return;
    }
    case 'guard':
      p[HJ.spread] = 0.18;
      p[HJ.kneeL] = 0.18;
      p[HJ.kneeR] = 0.18;
      p[HJ.armLPitch] = 1.15;
      p[HJ.armRPitch] = 1.15;
      p[HJ.armLRoll] = -0.95;
      p[HJ.armRRoll] = -0.95;
      p[HJ.headYaw] = 0.6 * Math.sin(t * 0.7 + seed * 5);
      p[HJ.torsoPitch] = -0.05;
      r.bob = -0.03;
      return;
    case 'ko':
      r.pitch = -1.5;
      r.bob = 0.13;
      p[HJ.armLRoll] = 1.2;
      p[HJ.armRRoll] = 1.2;
      p[HJ.armLPitch] = 0.3;
      p[HJ.armRPitch] = 0.3;
      p[HJ.spread] = 0.15;
      p[HJ.headYaw] = 0.4;
      p[HJ.kneeL] = 0.2;
      p[HJ.torsoPitch] = 0.03 * Math.sin(t * 1.2);
      return;
  }
}

/**
 * Arm lift for a hand striking every `period` beats from `offset`: 0 on the skin at each
 * stroke, arcing up in between (faster patterns lift less). The stroke into the bar's
 * downbeat (beat index divisible by 4) is played bigger.
 */
function strike(beat: number, period: number, offset: number): number {
  const x = (beat - offset) / period;
  const n = Math.floor(x);
  const next = offset + (n + 1) * period;
  const bar = Math.round(next);
  const downbeat = Math.abs(next - bar) < 1e-6 && ((bar % 4) + 4) % 4 === 0;
  return Math.sin(Math.PI * (x - n)) * Math.sqrt(period) * (downbeat ? 1.35 : 1);
}

/**
 * Beat-locked additive layer for an animation in BEAT_ANIMS, from the festival beat clock
 * (RenderContext.beat, in beats): dancers bounce down on every kick (each with its own depth
 * and a few milliseconds of human slop), pump, sway and two-step on half-time; drummers play
 * their pattern on beat subdivisions and nod on the kick. Writes joint deltas into `d` and
 * root deltas into `r` (all zero for other animations).
 */
export function beatHippie(anim: HippieAnim, beat: number, seed: number, d: Float32Array, r: HippieRoot): void {
  d.fill(0);
  r.bob = 0;
  r.pitch = 0;
  r.roll = 0;
  r.yaw = 0;
  const k = Math.floor(seed * 4294967296);
  const slop = (hash01b(k, 23) - 0.5) * 0.06;
  if (anim === 'drum') {
    const pattern = DRUM_PATTERNS[Math.floor(hash01b(k, 24) * DRUM_PATTERNS.length)];
    const b = beat + slop * 0.5;
    d[HJ.armLPitch] = DRUM_LIFT * strike(b, pattern[0], pattern[1]);
    d[HJ.armRPitch] = DRUM_LIFT * strike(b, pattern[2], pattern[3]);
    const nod = kickDip(b);
    d[HJ.headPitch] = 0.1 * nod;
    d[HJ.torsoPitch] = 0.04 * nod;
    return;
  }
  if (anim !== 'dance') return;
  const b = beat + slop;
  const dip = kickDip(b) * (0.75 + 0.5 * hash01b(k, 21));
  // Half-time: the weight lands on alternate feet on alternate beats.
  const sway = Math.cos(Math.PI * (b + (hash01b(k, 22) < 0.5 ? 0 : 1)));
  r.bob = -0.035 * dip;
  d[HJ.kneeL] = 0.24 * dip;
  d[HJ.kneeR] = 0.24 * dip;
  d[HJ.headPitch] = 0.12 * dip;
  const style = Math.floor(seed * 4);
  if (style === 1) {
    d[HJ.torsoRoll] = 0.22 * sway;
    d[HJ.armLRoll] = 0.5 * sway;
    d[HJ.armRRoll] = -0.5 * sway;
    d[HJ.armLPitch] = 0.35 * dip;
    d[HJ.armRPitch] = 0.35 * dip;
    d[HJ.headYaw] = 0.3 * sway;
  } else if (style === 2) {
    // Fist pump: the arm thrusts straight up on the kick.
    d[HJ.armRPitch] = 0.45 * dip;
    d[HJ.torsoPitch] = 0.05 * dip;
  } else if (style === 3) {
    d[HJ.thighL] = 0.35 * sway;
    d[HJ.thighR] = -0.35 * sway;
    d[HJ.kneeL] += 0.3 * Math.max(0, sway);
    d[HJ.kneeR] += 0.3 * Math.max(0, -sway);
    d[HJ.armLPitch] = -0.35 * sway;
    d[HJ.armRPitch] = 0.35 * sway;
    r.roll = 0.08 * sway;
  }
}

/** Layer status effects (stun, TAKE A SHOT wobble, overstimulation, knockback) on a pose. */
export function applyHippieEffects(
  p: Float32Array,
  r: HippieRoot,
  t: number,
  seed: number,
  stun: boolean,
  wobble: boolean,
  jitter: boolean,
  knockback: boolean,
): void {
  if (stun) {
    p[HJ.headPitch] += 0.25;
    p[HJ.headYaw] += 0.5 * Math.sin(t * 9);
    p[HJ.armLRoll] = 0.1;
    p[HJ.armRRoll] = 0.1;
    r.roll += 0.08 * Math.sin(t * 5);
  }
  if (wobble) {
    r.roll += 0.18 * Math.sin(t * 4.2 + seed * 3);
    r.pitch += 0.08 * Math.sin(t * 3.1);
    p[HJ.torsoRoll] += 0.15 * Math.sin(t * 4.2);
  }
  if (jitter) {
    p[HJ.armLPitch] += 0.15 * Math.sin(t * 23);
    p[HJ.armRPitch] += 0.15 * Math.sin(t * 21 + 1);
    p[HJ.headYaw] += 0.12 * Math.sin(t * 19 + 2);
  }
  if (knockback) p[HJ.torsoPitch] -= 0.3;
}
