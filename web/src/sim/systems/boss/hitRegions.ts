/** Numeric-only projectile hit shapes baked from the exact dimension-scaled combat rig poses. */
import { BOSS_ATTACK_CORD_ENVELOPES, BOSS_IDLE_MOTION_REGIONS, BOSS_IDLE_MOTION_REGION_INDICES, BOSS_EYE_REAR_DRAPE_DATA, BOSS_HEAD_REGION_COUNT, BOSS_HIT_POSE_DATA, BOSS_HIT_REGION_STRIDE } from '../../bossHitPoseData';
import { MAP_HALF } from '../../constants';
import { groundHeight } from '../../terrain';
import type { BossState } from '../../boss';
import type { V3 } from '../../math';
import { BOSS_EYE_TIMING } from '../../boss';
import { solveBossEyeAim } from '../../bossEyeRig';
import type { BossEyeQuaternion } from '../../bossEyeRig';

export interface BossProjectileImpact { t: number; pos: V3; headshot: boolean; region: number; }

function poseFrames(boss: BossState, now: number) {
  const aiming = boss.eye?.chargeAt != null;
  const key = `${aiming ? 'idle' : boss.action}:${boss.crouched}` as keyof typeof BOSS_HIT_POSE_DATA;
  const fallback = `idle:${boss.crouched}` as keyof typeof BOSS_HIT_POSE_DATA;
  const clip = BOSS_HIT_POSE_DATA[key] ?? BOSS_HIT_POSE_DATA[fallback];
  let t = aiming ? 0 : Math.max(0, now - boss.actionAt);
  if (clip.phaseDistance) t = ((boss.stride / clip.phaseDistance) % 1 + 1) % 1;
  const samples = clip.samples;
  const next = samples.findIndex(s => s.at > t);
  const a = samples[next <= 0 ? (next < 0 ? samples.length - 1 : 0) : next - 1];
  const b = samples[next <= 0 ? (next < 0 ? samples.length - 1 : 0) : next];
  const alpha = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
  return { a, b, alpha };
}

/** Exact posed head anchor, baked from the same approved rig as the hit volumes. */
export function sampleBossHeadPose(boss: BossState, now: number): { position: V3; quaternion: BossEyeQuaternion } {
  const { a, b, alpha } = poseFrames(boss, now);
  const h = a.head.map((v, i) => v + (b.head[i] - v) * alpha);
  let dot = 0; for (let i = 3; i < 7; i++) dot += a.head[i] * b.head[i];
  for (let i = 3; i < 7; i++) h[i] = a.head[i] * (1 - alpha) + b.head[i] * (dot < 0 ? -1 : 1) * alpha;
  const length = Math.hypot(...h.slice(3)) || 1;
  return { position: { x: h[0], y: h[1], z: h[2] }, quaternion: [h[3] / length, h[4] / length, h[5] / length, h[6] / length] };
}

/** Sample a clip from authoritative time/stride. Each 10-float region is center, radii, quaternion. */
export function sampleBossHitRegions(boss: BossState, now: number, mapHalf = MAP_HALF): Float64Array {
  const { a, b, alpha } = poseFrames(boss, now);
  const out = new Float64Array(a.regions.length);
  for (let base = 0; base < out.length; base += BOSS_HIT_REGION_STRIDE) {
    for (let i = 0; i < 6; i++) out[base + i] = a.regions[base + i] + (b.regions[base + i] - a.regions[base + i]) * alpha;
    const qi = base + 6;
    let dot = 0; for (let i = 0; i < 4; i++) dot += a.regions[qi + i] * b.regions[qi + i];
    const sign = dot < 0 ? -1 : 1;
    let length = 0;
    for (let i = 0; i < 4; i++) { out[qi + i] = a.regions[qi + i] * (1 - alpha) + b.regions[qi + i] * sign * alpha; length += out[qi + i] ** 2; }
    length = Math.sqrt(length) || 1;
    for (let i = 0; i < 4; i++) out[qi + i] /= length;
  }
  if (boss.eye?.chargeAt == null) {
    if (boss.action === 'idle') {
      const motion = BOSS_IDLE_MOTION_REGIONS[boss.crouched ? 'true' : 'false'];
      BOSS_IDLE_MOTION_REGION_INDICES.forEach((region, i) => copyMotionRegion(out, region, motion, i * BOSS_HIT_REGION_STRIDE));
    } else if (boss.action === 'swipe' || boss.action === 'stomp' || boss.action === 'grab') {
      // These cords use time since spawn, independently of the attack clock.
      // Their narrow source-motion envelope follows the attack's sampled head.
      const low = boss.action === 'stomp' ? boss.crouched : true;
      const motion = BOSS_ATTACK_CORD_ENVELOPES[low ? 'true' : 'false'];
      const h = motion.head, head = sampleBossHeadPose(boss, now), n = Math.hypot(...h.slice(3)) || 1;
      const delta = multiplyQuaternion(head.quaternion, [-h[3] / n, -h[4] / n, -h[5] / n, h[6] / n]);
      for (const [i, region] of [5, 6].entries()) {
        copyMotionRegion(out, region, motion.regions, i * BOSS_HIT_REGION_STRIDE);
        const base = region * BOSS_HIT_REGION_STRIDE;
        const p = inverseRotate(out[base] - h[0], out[base + 1] - h[1], out[base + 2] - h[2], -delta[0], -delta[1], -delta[2], delta[3]);
        out[base] = p.x + head.position.x; out[base + 1] = p.y + head.position.y; out[base + 2] = p.z + head.position.z;
        const q = multiplyQuaternion(delta, [out[base + 6], out[base + 7], out[base + 8], out[base + 9]]);
        for (let k = 0; k < 4; k++) out[base + 6 + k] = q[k];
      }
    }
  }
  if (boss.eye?.chargeAt != null && boss.eye.target && boss.hp > 0) {
    const head = sampleBossHeadPose(boss, now), target = boss.eye.target;
    const c = Math.cos(boss.yaw), s = Math.sin(boss.yaw), x = target.x - boss.pos.x, z = target.z - boss.pos.z;
    const t = Math.max(0, Math.min(1, (now - boss.eye.chargeAt) / BOSS_EYE_TIMING.charge));
    const blend = boss.eye.firedAt === null ? t * t * (3 - 2 * t) : 1;
    const q = solveBossEyeAim(head.position, head.quaternion, { x: c * x - s * z, y: target.y - groundHeight(boss.pos.x, boss.pos.z, mapHalf), z: s * x + c * z }, blend).headQuaternion;
    const delta = multiplyQuaternion(q, [-head.quaternion[0], -head.quaternion[1], -head.quaternion[2], head.quaternion[3]]);
    for (let region = 0; region < BOSS_HEAD_REGION_COUNT; region++) {
      // The rear drape mixes a head-fastened root with a coat-following lower panel.
      if (region === 4) continue;
      const base = region * BOSS_HIT_REGION_STRIDE;
      const p = inverseRotate(out[base] - head.position.x, out[base + 1] - head.position.y, out[base + 2] - head.position.z, -delta[0], -delta[1], -delta[2], delta[3]);
      out[base] = p.x + head.position.x; out[base + 1] = p.y + head.position.y; out[base + 2] = p.z + head.position.z;
      const rotation = multiplyQuaternion(delta, [out[base + 6], out[base + 7], out[base + 8], out[base + 9]]);
      for (let i = 0; i < 4; i++) out[base + 6 + i] = rotation[i];
    }
    out.set(aimedRearDrape(boss, head.position, q, delta, out), 4 * BOSS_HIT_REGION_STRIDE);
  }
  return out;
}

/** Copy a compact envelope while normalizing its quantized orientation. */
function copyMotionRegion(out: Float64Array, region: number, source: readonly number[], from: number): void {
  const base = region * BOSS_HIT_REGION_STRIDE;
  out.set(source.slice(from, from + BOSS_HIT_REGION_STRIDE), base);
  const n = Math.hypot(out[base + 6], out[base + 7], out[base + 8], out[base + 9]) || 1;
  for (let i = 6; i < 10; i++) out[base + i] /= n;
}

function multiplyQuaternion(a: BossEyeQuaternion, b: BossEyeQuaternion): [number, number, number, number] {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

function inverseRotate(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): V3 {
  // Quaternion inverse is its conjugate; all sampled orientations are normalized.
  const tx = 2 * (-qy * z + qz * y), ty = 2 * (-qz * x + qx * z), tz = 2 * (-qx * y + qy * x);
  return { x: x + qw * tx - qy * tz + qz * ty, y: y + qw * ty - qz * tx + qx * tz, z: z + qw * tz - qx * ty + qy * tx };
}

const drapeCache = new WeakMap<BossState, { crouched: boolean; delta: BossEyeQuaternion; shape: Float64Array }>();
/** Reconstruct the exact source skinning of the head-fastened upper drape and
 * coat-targeted lower segment, then fit only their own narrow hit volume. */
function aimedRearDrape(boss: BossState, head: V3, aimedHead: BossEyeQuaternion, delta: BossEyeQuaternion, regions: Float64Array): Float64Array {
  const cached = drapeCache.get(boss);
  if (cached?.crouched === boss.crouched && delta.every((value, i) => value === cached.delta[i])) return cached.shape;
  const rig = BOSS_EYE_REAR_DRAPE_DATA[boss.crouched ? 'true' : 'false'];
  const rotate = (x: number, y: number, z: number, q: BossEyeQuaternion): V3 => inverseRotate(x, y, z, -q[0], -q[1], -q[2], q[3]);
  const unit = (q: BossEyeQuaternion): [number, number, number, number] => {
    const n = Math.hypot(...q) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  };
  // Match the render helper's small extra coat clearance and skull-wrap relief.
  const restHead = unit(rig.restHeadQuaternion as BossEyeQuaternion);
  const dot = Math.abs(aimedHead.reduce((sum, value, i) => sum + value * restHead[i], 0));
  const bend = 2 * Math.acos(Math.min(1, dot));
  const t = Math.max(0, Math.min(1, (bend - .6) / .25)), clearance = .45 * t * t * (3 - 2 * t);
  const wrap = Math.max(0, Math.min(1, (bend - .9) / .25)), bow = wrap * wrap * (3 - 2 * wrap);
  const chest = unit(rig.chestQuaternion as BossEyeQuaternion);
  const fromRest = multiplyQuaternion(aimedHead, [-restHead[0], -restHead[1], -restHead[2], restHead[3]]);
  const chestDelta = multiplyQuaternion(multiplyQuaternion([-chest[0], -chest[1], -chest[2], chest[3]], fromRest), chest);
  const forward = rotate(0, 0, 1, chestDelta);
  const down = Math.max(0, Math.min(1, (-Math.atan2(forward.y, forward.z) - .9) / .35));
  const up = Math.max(0, Math.min(1, (Math.atan2(forward.y, forward.z) - 1.15) / .15));
  const pitch = 1.5 * down * down * (3 - 2 * down) - .6 * up * up * (3 - 2 * up);
  const rootOffset = rotate(rig.rootOffset[0] + rig.rootBowAxis[0] * bow + rig.rootPitchAxis[0] * pitch,
    rig.rootOffset[1] + rig.rootBowAxis[1] * bow + rig.rootPitchAxis[1] * pitch,
    rig.rootOffset[2] + rig.rootBowAxis[2] * bow + rig.rootPitchAxis[2] * pitch, delta);
  const root = { x: head.x + rootOffset.x, y: head.y + rootOffset.y, z: head.z + rootOffset.z };
  const raw = unit(multiplyQuaternion(delta, rig.restQuaternion as BossEyeQuaternion));
  const from = rotate(0, 1, 0, raw), toward = { x: rig.target[0] + rig.backAxis[0] * clearance - root.x,
    y: rig.target[1] + rig.backAxis[1] * clearance - root.y, z: rig.target[2] + rig.backAxis[2] * clearance - root.z };
  const distance = Math.hypot(toward.x, toward.y, toward.z) || 1e-9;
  const to = { x: toward.x / distance, y: toward.y / distance, z: toward.z / distance };
  let swing: [number, number, number, number] = [from.y * to.z - from.z * to.y, from.z * to.x - from.x * to.z,
    from.x * to.y - from.y * to.x, 1 + from.x * to.x + from.y * to.y + from.z * to.z];
  if (swing[3] < 1e-8) swing = Math.abs(from.x) > Math.abs(from.z) ? [-from.y, from.x, 0, 0] : [0, -from.z, from.y, 0];
  const lower = unit(multiplyQuaternion(unit(swing), raw)), scaleY = distance / rig.tailLength;
  const qi = 4 * BOSS_HIT_REGION_STRIDE + 6;
  const frame = unit(multiplyQuaternion(delta, [regions[qi], regions[qi + 1], regions[qi + 2], regions[qi + 3]]));
  const local = new Float64Array(rig.points.length / 8 * 3), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rig.points.length; i += 8) {
    const p = rig.points, upper = rotate(p[i + 1], p[i + 2], p[i + 3], delta), tail = rotate(p[i + 5], p[i + 6] * scaleY, p[i + 7], lower);
    const at = inverseRotate(p[i] * head.x + upper.x + p[i + 4] * root.x + tail.x,
      p[i] * head.y + upper.y + p[i + 4] * root.y + tail.y,
      p[i] * head.z + upper.z + p[i + 4] * root.z + tail.z, frame[0], frame[1], frame[2], frame[3]);
    for (const [k, value] of [at.x, at.y, at.z].entries()) {
      local[i / 8 * 3 + k] = value; min[k] = Math.min(min[k], value); max[k] = Math.max(max[k], value);
    }
  }
  const center = min.map((value, i) => (value + max[i]) / 2), radius = min.map((value, i) => Math.max(.06, (max[i] - value) / 2));
  let factor = 1;
  for (let i = 0; i < local.length; i += 3) factor = Math.max(factor,
    Math.hypot((local[i] - center[0]) / radius[0], (local[i + 1] - center[1]) / radius[1], (local[i + 2] - center[2]) / radius[2]));
  const p = rotate(center[0], center[1], center[2], frame);
  const shape = new Float64Array([p.x, p.y, p.z, ...radius.map(value => value * factor + .06), ...frame]);
  drapeCache.set(boss, { crouched: boss.crouched, delta: [...delta], shape });
  return shape;
}

/** Swept ellipsoid test, all roots considered; long/high-speed segments cannot tunnel. */
export function intersectBossRegions(boss: BossState, now: number, from: V3, to: V3, maxT = 1, mapHalf = MAP_HALF): BossProjectileImpact | null {
  if (boss.hp <= 0 || maxT < 0) return null;
  const shapes = sampleBossHitRegions(boss, now, mapHalf), c = Math.cos(boss.yaw), s = Math.sin(boss.yaw);
  const local = (p: V3): V3 => { const x = p.x - boss.pos.x, z = p.z - boss.pos.z; return { x: c * x - s * z, y: p.y - groundHeight(boss.pos.x, boss.pos.z, mapHalf), z: s * x + c * z }; };
  const start = local(from), end = local(to);
  let first = Infinity, region = -1;
  for (let base = 0; base < shapes.length; base += BOSS_HIT_REGION_STRIDE) {
    const qi = base + 6;
    const a = inverseRotate(start.x - shapes[base], start.y - shapes[base + 1], start.z - shapes[base + 2], shapes[qi], shapes[qi + 1], shapes[qi + 2], shapes[qi + 3]);
    const b = inverseRotate(end.x - shapes[base], end.y - shapes[base + 1], end.z - shapes[base + 2], shapes[qi], shapes[qi + 1], shapes[qi + 2], shapes[qi + 3]);
    const rx = Math.max(.025, shapes[base + 3]) + .035, ry = Math.max(.025, shapes[base + 4]) + .035, rz = Math.max(.025, shapes[base + 5]) + .035;
    const ox = a.x / rx, oy = a.y / ry, oz = a.z / rz;
    const dx = (b.x - a.x) / rx, dy = (b.y - a.y) / ry, dz = (b.z - a.z) / rz;
    const A = dx * dx + dy * dy + dz * dz, C = ox * ox + oy * oy + oz * oz - 1;
    let t = C <= 0 ? 0 : Infinity;
    if (A > 1e-16) {
      const h = ox * dx + oy * dy + oz * dz, D = h * h - A * C;
      if (D >= 0) { const root = (-h - Math.sqrt(D)) / A; if (root >= 0) t = Math.min(t, root); }
    }
    if (t <= maxT && t < first) { first = t; region = base / BOSS_HIT_REGION_STRIDE; }
  }
  if (region < 0) return null;
  return { t: first, pos: { x: from.x + (to.x - from.x) * first, y: from.y + (to.y - from.y) * first, z: from.z + (to.z - from.z) * first }, headshot: region < BOSS_HEAD_REGION_COUNT, region };
}
