/**
 * Throw solver for NPC vexillomancers: the aim (yaw, pitch) whose flight comes down on a
 * target point. Flights are simulated with exactly the steps the projectile system runs
 * (semi-implicit Euler at SIM_DT, launch from the hand via throwOrigin/throwVelocity), so a
 * solved throw lands where the sim will land it, not where a textbook parabola would.
 * Owner: AI agent.
 */
import { AVATAR, PROJECTILE, SIM_DT } from '../sim/constants';
import type { V3 } from '../sim/math';
import { throwOrigin, throwVelocity } from '../sim/systems/avatars';

export interface ThrowAim {
  yaw: number;
  pitch: number;
  /** Seconds to the target; survey throws use its descending height crossing. */
  flight: number;
}

/** Pitch bounds searched (radians); the sim clamps aim to ±AVATAR.pitchLimit. */
const PITCH_MIN = -0.8;
const PITCH_MAX: number = AVATAR.pitchLimit;
const BISECT_STEPS = 28;
/** Yaw refinements for the hand's sideways offset (converges in two). */
const YAW_PASSES = 3;

const origin: V3 = { x: 0, y: 0, z: 0 };
const vel: V3 = { x: 0, y: 0, z: 0 };

/**
 * Horizontal distance from the launch point to where a throw at `pitch` falls through
 * height `y` (descending), or -1 if it never does within the projectile lifetime.
 * `launchY` is the hand height above the ground plane the target height is measured on.
 */
function throwReach(pitch: number, launchY: number, y: number, outFlight?: { t: number }): number {
  throwVelocity(0, pitch, vel);
  let px = 0;
  let py = launchY;
  let vx = vel.z;
  let vy = vel.y;
  const steps = Math.ceil(PROJECTILE.lifetime / SIM_DT);
  for (let i = 1; i <= steps; i++) {
    vy -= AVATAR.gravity * SIM_DT;
    const ny = py + vy * SIM_DT;
    const nx = px + vx * SIM_DT;
    if (vy < 0 && ny <= y) {
      const t = py - ny > 1e-9 ? (py - y) / (py - ny) : 1;
      if (outFlight) outFlight.t = (i - 1 + t) * SIM_DT;
      return px + (nx - px) * t;
    }
    px = nx;
    py = ny;
  }
  return -1;
}

/** Pitch of the longest throw (reach rises to it, then falls). */
function pitchOfMaxReach(launchY: number, y: number): number {
  let lo = 0;
  let hi = PITCH_MAX;
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (throwReach(a, launchY, y) < throwReach(b, launchY, y)) lo = a;
    else hi = b;
  }
  return (lo + hi) / 2;
}

/**
 * Aim for a vexillomancer standing at `feet` to land a Flag on (tx, ty, tz). `high` picks the
 * lob (over obstacles) instead of the flat throw. Returns false when out of range.
 */
export function solveThrow(feet: Readonly<V3>, tx: number, ty: number, tz: number, high: boolean, out: ThrowAim): boolean {
  let yaw = Math.atan2(tx - feet.x, tz - feet.z);
  let along = 0;
  for (let pass = 0; pass < YAW_PASSES; pass++) {
    throwOrigin(feet, yaw, origin);
    const dx = tx - origin.x;
    const dz = tz - origin.z;
    // Flight runs from the hand along the facing: turn until the target is dead ahead of it.
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    along = dx * fx + dz * fz;
    const side = dx * fz - dz * fx;
    if (along <= 0.1) return false;
    yaw += Math.atan2(side, along);
  }
  throwOrigin(feet, yaw, origin);
  const dist = Math.hypot(tx - origin.x, tz - origin.z);
  const launchY = origin.y;
  const peak = pitchOfMaxReach(launchY, ty);
  if (throwReach(peak, launchY, ty) < dist) return false;
  // Reach is monotone on each side of the peak: bisect the flat or the lobbed branch.
  let lo = high ? peak : PITCH_MIN;
  let hi = high ? PITCH_MAX : peak;
  const rising = !high;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    const r = throwReach(mid, launchY, ty);
    const short = r < dist;
    if (short === rising) lo = mid;
    else hi = mid;
  }
  const pitch = (lo + hi) / 2;
  const flight = { t: 0 };
  if (throwReach(pitch, launchY, ty, flight) < 0) return false;
  out.yaw = yaw;
  out.pitch = pitch;
  out.flight = flight.t;
  return true;
}

/**
 * Intercept an elevated point, on either the rising or falling part of the arc. Survey
 * throws use the descending-only solver above; combat targets can be above the hand and
 * closer than the apex. Evaluate height at horizontal range with the exact SIM_DT gravity
 * steps, including the fractional final segment used by swept projectile collisions.
 */
export function solveThrowAtPoint(feet: Readonly<V3>, target: Readonly<V3>, high: boolean, out: ThrowAim): boolean {
  let yaw = Math.atan2(target.x - feet.x, target.z - feet.z);
  for (let pass = 0; pass < YAW_PASSES; pass++) {
    throwOrigin(feet, yaw, origin);
    const dx = target.x - origin.x, dz = target.z - origin.z;
    const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (along <= 0.1) return false;
    yaw += Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), along);
  }
  throwOrigin(feet, yaw, origin);
  const distance = Math.hypot(target.x - origin.x, target.z - origin.z), launchY = origin.y;
  const height = (pitch: number): number => {
    const angle = pitch + AVATAR.throwPitchBias;
    const flight = distance / (AVATAR.throwSpeed * Math.cos(angle));
    if (flight > PROJECTILE.lifetime) return -Infinity;
    const steps = flight / SIM_DT, full = Math.floor(steps), fraction = steps - full;
    return launchY + AVATAR.throwSpeed * Math.sin(angle) * flight -
      AVATAR.gravity * SIM_DT * SIM_DT * (full * (full + 1) / 2 + (full + 1) * fraction);
  };
  let lo: number = -AVATAR.pitchLimit, hi: number = AVATAR.pitchLimit;
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (height(a) < height(b)) lo = a;
    else hi = b;
  }
  const peak = (lo + hi) / 2;
  if (height(peak) < target.y) return false;
  lo = high ? peak : -AVATAR.pitchLimit;
  hi = high ? AVATAR.pitchLimit : peak;
  if (height(high ? hi : lo) > target.y) return false;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if ((height(mid) < target.y) === !high) lo = mid;
    else hi = mid;
  }
  const pitch = (lo + hi) / 2;
  if (Math.abs(height(pitch) - target.y) > 0.001) return false;
  out.yaw = yaw; out.pitch = pitch;
  out.flight = distance / (AVATAR.throwSpeed * Math.cos(pitch + AVATAR.throwPitchBias));
  return true;
}

/** Longest flat-ground throw from standing height (for range checks before solving). */
export const MAX_THROW_RANGE = (() => {
  const launchY = AVATAR.throwHandHeight;
  return throwReach(pitchOfMaxReach(launchY, 0), launchY, 0);
})();
