/**
 * Client playback timing and remote-motion smoothing for the replicated mirror (net/mirror.ts).
 *
 * PlaybackClock maps the local clock onto host time a little in the past, so a frame is
 * usually already queued when its moment comes: the delay is ~2.5 frame intervals, growing
 * with arrival jitter (50–250 ms). It never runs backwards, fast-forwards when it falls more
 * than SNAP behind, and keeps running through stalls (motion then extrapolates briefly and
 * holds).
 *
 * Motion keeps one track per moving entity (remote avatars, hippies, projectiles, flying
 * Flags, the GCC carts): its authoritative pose at the last applied frame ("from") and at the
 * next queued frame ("to"), and writes the blend into the world entity each render frame.
 * Before frames apply, the authoritative poses are written back so frame data and collision
 * registration always see host values.
 * Owner: NetCore agent.
 */
import { angleDiff } from '../sim/math';
import type { EntityId } from '../sim/types';
import type { World } from '../sim/world';
import type { DeltaSnapshot, EntityDelta } from './codec';
import { NET_HZ } from './protocol';
import { CM, CODECS, dequant, MRAD } from './schema';
import type { Wire } from './schema';

const FRAME = 1 / NET_HZ;
const MIN_DELAY = 0.05;
const MAX_DELAY = 0.25;
/** Arrival samples kept for the best host-clock estimate (~3 s of frames). */
const SAMPLES = 90;
/** Behind the target by more than this (s): jump instead of easing. */
const SNAP = 0.5;
/** Rate at which playback eases onto its target (1/s). */
const CATCH_UP = 4;
/** A frame-to-frame move longer than this (m) is a teleport (respawn, rebuild): no blending. */
const TELEPORT = 6;
/** Without a next frame, motion extrapolates this long (s) and then holds. */
const MAX_EXTRAPOLATION = 0.1;

export class PlaybackClock {
  /** Host time minus local time per arrival (s), newest last. */
  private readonly samples: number[] = [];
  /** Largest recent sample: the least-delayed frame's view of the host clock. */
  private best = NaN;
  /** Smoothed lateness of arrivals behind `best` (s). */
  private jitter = 0;
  private playback = NaN;
  private lastNow = NaN;
  /** Current playback delay behind the estimated host clock (s). */
  delay = 2.5 * FRAME;

  /** A frame stamped `hostTime` arrived at local time `arrival` (s). */
  note(hostTime: number, arrival: number): void {
    const sample = hostTime - arrival;
    this.samples.push(sample);
    if (this.samples.length > SAMPLES) this.samples.shift();
    let best = -Infinity;
    for (const s of this.samples) best = Math.max(best, s);
    this.best = best;
    const late = best - sample;
    this.jitter += (late - this.jitter) * (late > this.jitter ? 0.25 : 0.02);
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, FRAME + Math.max(1.5 * FRAME, 2 * this.jitter)));
  }

  /** Host time to show at local time `now` (s); -Infinity before any frame timing is known. */
  time(now: number): number {
    if (Number.isNaN(this.best)) return -Infinity;
    const target = now + this.best - this.delay;
    if (Number.isNaN(this.playback)) this.playback = target;
    else {
      const dt = Math.min(0.25, Math.max(0, now - this.lastNow));
      const err = target - this.playback;
      if (err > SNAP) this.playback = target;
      else this.playback += Math.max(0, dt + err * Math.min(1, dt * CATCH_UP));
    }
    this.lastNow = now;
    return this.playback;
  }
}

class Track {
  id = 0;
  // Authoritative pose at the last applied frame.
  fx = 0;
  fy = 0;
  fz = 0;
  fa = 0;
  fp = 0;
  // Pose at the next queued frame.
  tx = 0;
  ty = 0;
  tz = 0;
  ta = 0;
  tp = 0;
  /** Extrapolation velocity (m/s). */
  vx = 0;
  vy = 0;
  vz = 0;
  /** A next-frame pose is known. */
  aim = false;
  /** Teleport: hold the authoritative pose until the next frame applies. */
  snap = false;
  seen = 0;
}

type MotionKind = 'avatars' | 'hippies' | 'projectiles' | 'flags' | 'buildings';

/** Field indexes of the pose in each kind's rows (-1: the kind has no such field). */
interface PoseFields {
  x: number;
  y: number;
  z: number;
  a: number;
  p: number;
}

const POSE: Record<MotionKind, PoseFields> = {
  avatars: {
    x: CODECS.avatars.index('x'),
    y: CODECS.avatars.index('y'),
    z: CODECS.avatars.index('z'),
    a: CODECS.avatars.index('yaw'),
    p: CODECS.avatars.index('pitch'),
  },
  hippies: { x: CODECS.hippies.index('x'), y: -1, z: CODECS.hippies.index('z'), a: CODECS.hippies.index('facing'), p: -1 },
  projectiles: { x: CODECS.projectiles.index('x'), y: CODECS.projectiles.index('y'), z: CODECS.projectiles.index('z'), a: -1, p: -1 },
  flags: { x: CODECS.flags.index('x'), y: CODECS.flags.index('y'), z: CODECS.flags.index('z'), a: -1, p: -1 },
  buildings: { x: CODECS.buildings.index('x'), y: -1, z: CODECS.buildings.index('z'), a: -1, p: -1 },
};

const MOTION_KINDS: readonly MotionKind[] = ['avatars', 'hippies', 'projectiles', 'flags', 'buildings'];

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Value of field `i` in a flat update record whose values start at `at`. */
function valueAt(u: readonly Wire[], at: number, mask: number, i: number): Wire {
  return u[at + popcount(mask & ((1 << i) - 1))] ?? null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** One coordinate of a track's shown pose (see Motion.write). */
function posed(t: Track, from: number, to: number, v: number, alpha: number, ext: number, blending: boolean): number {
  if (!blending) return from + v * ext;
  return t.snap || !t.aim ? from : from + (to - from) * alpha;
}

function posedAngle(t: Track, from: number, to: number, alpha: number, blending: boolean): number {
  return blending && t.aim && !t.snap ? from + angleDiff(from, to) * alpha : from;
}

export class Motion {
  private readonly tracks: Record<MotionKind, Map<EntityId, Track>> = {
    avatars: new Map(),
    hippies: new Map(),
    projectiles: new Map(),
    flags: new Map(),
    buildings: new Map(),
  };
  private stamp = 0;
  /** Times of the last applied frame and of the next queued one (NaN: none queued). */
  private tA = 0;
  private tB = NaN;

  /** Stop smoothing an entity (e.g. the avatar that client prediction now drives). */
  forget(kind: MotionKind, id: EntityId): void {
    this.tracks[kind].delete(id);
  }

  /** After frames applied: the entities' (authoritative) poses start the next segment. */
  capture(world: World, predicted: EntityId | null, appliedTime: number): void {
    const dt = appliedTime - this.tA;
    this.tA = appliedTime;
    const prev = this.stamp;
    const s = ++this.stamp;
    for (const av of world.avatars.values()) {
      if (av.id === predicted) continue;
      const t = this.track('avatars', av.id);
      t.fx = av.pos.x;
      t.fy = av.pos.y;
      t.fz = av.pos.z;
      t.fa = av.yaw;
      t.fp = av.pitch;
      t.vx = av.vel.x;
      t.vy = av.vel.y;
      t.vz = av.vel.z;
      t.seen = s;
    }
    for (const h of world.hippies.values()) {
      const t = this.track('hippies', h.id);
      // Hippie velocity does not replicate: the last segment's average stands in for it.
      const dx = h.pos.x - t.fx;
      const dz = h.pos.z - t.fz;
      const continuing = t.seen === prev && dt > 0 && dx * dx + dz * dz <= TELEPORT * TELEPORT;
      t.vx = continuing ? dx / dt : 0;
      t.vz = continuing ? dz / dt : 0;
      t.fx = h.pos.x;
      t.fz = h.pos.z;
      t.fa = h.facing;
      t.seen = s;
    }
    for (const p of world.projectiles.values()) {
      const t = this.track('projectiles', p.id);
      t.fx = p.pos.x;
      t.fy = p.pos.y;
      t.fz = p.pos.z;
      t.vx = p.vel.x;
      t.vy = p.vel.y;
      t.vz = p.vel.z;
      t.seen = s;
    }
    for (const fl of world.flags.values()) {
      if (fl.state !== 'flying') continue;
      const t = this.track('flags', fl.id);
      t.fx = fl.pos.x;
      t.fy = fl.pos.y;
      t.fz = fl.pos.z;
      t.vx = 0;
      t.vy = 0;
      t.vz = 0;
      t.seen = s;
    }
    for (const b of world.buildings.values()) {
      if (b.kind !== 'gcc') continue;
      const t = this.track('buildings', b.id);
      t.fx = b.pos.x;
      t.fz = b.pos.z;
      t.seen = s;
    }
    for (const kind of MOTION_KINDS) {
      for (const t of this.tracks[kind].values()) if (t.seen !== s) this.tracks[kind].delete(t.id);
    }
  }

  /** Point every track at the next queued frame (null: nothing queued yet). */
  aim(next: DeltaSnapshot | null): void {
    this.tB = next ? next.time : NaN;
    for (const kind of MOTION_KINDS) {
      for (const t of this.tracks[kind].values()) {
        t.tx = t.fx;
        t.ty = t.fy;
        t.tz = t.fz;
        t.ta = t.fa;
        t.tp = t.fp;
        t.aim = next !== null;
        t.snap = false;
      }
    }
    if (!next) return;
    for (const kind of MOTION_KINDS) this.aimKind(kind, next.ents?.[kind]);
    const span = this.tB - this.tA;
    for (const kind of MOTION_KINDS) {
      for (const t of this.tracks[kind].values()) {
        if (!t.aim) continue;
        const dx = t.tx - t.fx;
        const dy = t.ty - t.fy;
        const dz = t.tz - t.fz;
        t.snap = dx * dx + dy * dy + dz * dz > TELEPORT * TELEPORT;
        if (kind === 'hippies' && !t.snap && span > 0) {
          t.vx = dx / span;
          t.vz = dz / span;
        }
      }
    }
  }

  /** Write the authoritative poses back into the entities. */
  restore(world: World): void {
    this.write(world, 0, 0, false);
  }

  /** Write the poses shown at playback time `pt`; returns the matching display time. */
  blend(world: World, pt: number): number {
    const span = this.tB - this.tA;
    if (span > 0) {
      const alpha = clamp01((pt - this.tA) / span);
      this.write(world, alpha, 0, true);
      return this.tA + span * alpha;
    }
    this.write(world, 0, Math.min(MAX_EXTRAPOLATION, Math.max(0, pt - this.tA)), false);
    return this.tA;
  }

  private track(kind: MotionKind, id: EntityId): Track {
    const map = this.tracks[kind];
    let t = map.get(id);
    if (!t) {
      t = new Track();
      t.id = id;
      map.set(id, t);
    }
    return t;
  }

  private aimKind(kind: MotionKind, ed: EntityDelta | undefined): void {
    if (!ed) return;
    const map = this.tracks[kind];
    if (ed.r) {
      for (const id of ed.r) {
        const t = map.get(id);
        if (t) t.aim = false;
      }
    }
    const u = ed.u;
    if (!u) return;
    const f = POSE[kind];
    for (let k = 0; k + 1 < u.length; ) {
      const id = u[k];
      const mask = u[k + 1];
      if (typeof id !== 'number' || typeof mask !== 'number') return;
      const at = k + 2;
      k = at + popcount(mask);
      const t = map.get(id);
      if (!t) continue;
      if (mask & (1 << f.x)) t.tx = dequant(valueAt(u, at, mask, f.x), CM);
      if (f.y >= 0 && mask & (1 << f.y)) t.ty = dequant(valueAt(u, at, mask, f.y), CM);
      if (mask & (1 << f.z)) t.tz = dequant(valueAt(u, at, mask, f.z), CM);
      if (f.a >= 0 && mask & (1 << f.a)) t.ta = dequant(valueAt(u, at, mask, f.a), MRAD);
      if (f.p >= 0 && mask & (1 << f.p)) t.tp = dequant(valueAt(u, at, mask, f.p), MRAD);
    }
  }

  /**
   * Pose per track: when `blending`, toward its next-frame pose by `alpha`; otherwise the
   * authoritative pose pushed `ext` seconds along its velocity.
   */
  private write(world: World, alpha: number, ext: number, blending: boolean): void {
    for (const t of this.tracks.avatars.values()) {
      const av = world.avatars.get(t.id);
      if (!av) continue;
      av.pos.x = posed(t, t.fx, t.tx, t.vx, alpha, ext, blending);
      av.pos.y = posed(t, t.fy, t.ty, t.vy, alpha, ext, blending);
      av.pos.z = posed(t, t.fz, t.tz, t.vz, alpha, ext, blending);
      av.yaw = posedAngle(t, t.fa, t.ta, alpha, blending);
      av.pitch = posed(t, t.fp, t.tp, 0, alpha, 0, blending);
    }
    for (const t of this.tracks.hippies.values()) {
      const h = world.hippies.get(t.id);
      if (!h) continue;
      h.pos.x = posed(t, t.fx, t.tx, t.vx, alpha, ext, blending);
      h.pos.z = posed(t, t.fz, t.tz, t.vz, alpha, ext, blending);
      h.facing = posedAngle(t, t.fa, t.ta, alpha, blending);
      h.vel.x = t.vx;
      h.vel.z = t.vz;
    }
    for (const t of this.tracks.projectiles.values()) {
      const p = world.projectiles.get(t.id);
      if (!p) continue;
      p.pos.x = posed(t, t.fx, t.tx, t.vx, alpha, ext, blending);
      p.pos.y = posed(t, t.fy, t.ty, t.vy, alpha, ext, blending);
      p.pos.z = posed(t, t.fz, t.tz, t.vz, alpha, ext, blending);
    }
    for (const t of this.tracks.flags.values()) {
      const fl = world.flags.get(t.id);
      if (!fl) continue;
      fl.pos.x = posed(t, t.fx, t.tx, 0, alpha, ext, blending);
      fl.pos.y = posed(t, t.fy, t.ty, 0, alpha, ext, blending);
      fl.pos.z = posed(t, t.fz, t.tz, 0, alpha, ext, blending);
    }
    for (const t of this.tracks.buildings.values()) {
      const b = world.buildings.get(t.id);
      if (!b) continue;
      b.pos.x = posed(t, t.fx, t.tx, 0, alpha, ext, blending);
      b.pos.z = posed(t, t.fz, t.tz, 0, alpha, ext, blending);
    }
  }
}
