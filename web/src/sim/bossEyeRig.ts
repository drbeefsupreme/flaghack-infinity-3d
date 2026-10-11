/** Numeric-only eye socket and aiming shared by host simulation and the real rig. */
import type { V3 } from './math';

export type BossEyeQuaternion = readonly [number, number, number, number];
export const BOSS_EYE_RIG_SCALE = 20 / 32;
/** Front-most center vertex of the original Obsidian pupil, in the head bone's rest-local frame. */
export const BOSS_EYE_HEAD_LOCAL_ORIGIN: Readonly<V3> = {
  x: -3.0107657059508977e-7, y: 4.066181679805435, z: 1.7262217104171163,
};
/** Original model +Z expressed in the same head-local frame, including its imported bone roll. */
export const BOSS_EYE_HEAD_LOCAL_FORWARD: Readonly<V3> = {
  x: -1.738492091854924e-7, y: .08038419028554039, z: .9967639549823758,
};
export interface BossEyeRay { origin: V3; direction: V3; }
export interface BossEyeAim extends BossEyeRay { headQuaternion: [number, number, number, number]; }

const magnitude = (v: V3): number => Math.hypot(v.x, v.y, v.z);
const normalize = (v: V3): V3 => { const n = magnitude(v) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
function normalizedQuaternion(q: BossEyeQuaternion): [number, number, number, number] {
  const n = Math.hypot(...q) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
function rotate(v: Readonly<V3>, q: BossEyeQuaternion): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + y * tz - z * ty, y: v.y + w * ty + z * tx - x * tz, z: v.z + w * tz + x * ty - y * tx };
}
function multiply(a: BossEyeQuaternion, b: BossEyeQuaternion): [number, number, number, number] {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function slerp(a: BossEyeQuaternion, b: BossEyeQuaternion, t: number): [number, number, number, number] {
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const sign = dot < 0 ? -1 : 1; dot = Math.min(1, Math.abs(dot));
  const angle = Math.acos(dot), sine = Math.sin(angle);
  const wa = sine > 1e-7 ? Math.sin((1 - t) * angle) / sine : 1 - t;
  const wb = sign * (sine > 1e-7 ? Math.sin(t * angle) / sine : t);
  return normalizedQuaternion([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb]);
}

/** Position is meters; quaternion is the posed head rotation, with no model scale. */
export function bossEyeFromHead(headPosition: Readonly<V3>, headQuaternion: BossEyeQuaternion): BossEyeRay {
  const q = normalizedQuaternion(headQuaternion);
  const offset = rotate({ x: BOSS_EYE_HEAD_LOCAL_ORIGIN.x * BOSS_EYE_RIG_SCALE,
    y: BOSS_EYE_HEAD_LOCAL_ORIGIN.y * BOSS_EYE_RIG_SCALE, z: BOSS_EYE_HEAD_LOCAL_ORIGIN.z * BOSS_EYE_RIG_SCALE }, q);
  return { origin: { x: headPosition.x + offset.x, y: headPosition.y + offset.y, z: headPosition.z + offset.z },
    direction: normalize(rotate(BOSS_EYE_HEAD_LOCAL_FORWARD, q)) };
}

/**
 * Aim the actual offset pupil, rather than a ray incorrectly starting at the neck.
 * Solve |offset + distance * forward| = |target - head| before rotating the head.
 * Thus a full blend intersects the target exactly, even for steep ground targets.
 */
export function solveBossEyeAim(headPosition: Readonly<V3>, headQuaternion: BossEyeQuaternion, target: Readonly<V3>, blend = 1): BossEyeAim {
  const q = normalizedQuaternion(headQuaternion);
  const toward = { x: target.x - headPosition.x, y: target.y - headPosition.y, z: target.z - headPosition.z };
  const offset = { x: BOSS_EYE_HEAD_LOCAL_ORIGIN.x * BOSS_EYE_RIG_SCALE,
    y: BOSS_EYE_HEAD_LOCAL_ORIGIN.y * BOSS_EYE_RIG_SCALE, z: BOSS_EYE_HEAD_LOCAL_ORIGIN.z * BOSS_EYE_RIG_SCALE };
  const forward = BOSS_EYE_HEAD_LOCAL_FORWARD;
  const projection = offset.x * forward.x + offset.y * forward.y + offset.z * forward.z;
  const distance = Math.max(0, -projection + Math.sqrt(Math.max(0, projection ** 2 + magnitude(toward) ** 2 - magnitude(offset) ** 2)));
  const from = normalize(rotate({ x: offset.x + distance * forward.x, y: offset.y + distance * forward.y, z: offset.z + distance * forward.z }, q));
  const to = normalize(toward);
  let delta: [number, number, number, number] = [from.y * to.z - from.z * to.y, from.z * to.x - from.x * to.z,
    from.x * to.y - from.y * to.x, 1 + from.x * to.x + from.y * to.y + from.z * to.z];
  if (delta[3] < 1e-8) delta = Math.abs(from.x) > Math.abs(from.z) ? [-from.y, from.x, 0, 0] : [0, -from.z, from.y, 0];
  const t = Number.isFinite(blend) ? Math.min(1, Math.max(0, blend)) : 0;
  const aimed = magnitude(toward) > 1e-8 ? slerp(q, multiply(normalizedQuaternion(delta), q), t) : q;
  return { headQuaternion: aimed, ...bossEyeFromHead(headPosition, aimed) };
}
