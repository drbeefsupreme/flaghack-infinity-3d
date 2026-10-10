/** Numeric-only projectile hit shapes baked from the exact 20 m combat rig poses. */
import { BOSS_HEAD_REGION_COUNT, BOSS_HIT_POSE_DATA, BOSS_HIT_REGION_STRIDE } from '../../bossHitPoseData';
import type { BossState } from '../../boss';
import type { V3 } from '../../math';

export interface BossProjectileImpact { t: number; pos: V3; headshot: boolean; region: number; }

/** Sample a clip from authoritative time/stride. Each 10-float region is center, radii, quaternion. */
export function sampleBossHitRegions(boss: BossState, now: number): Float64Array {
  const key = `${boss.action}:${boss.crouched}` as keyof typeof BOSS_HIT_POSE_DATA;
  const fallback = `idle:${boss.crouched}` as keyof typeof BOSS_HIT_POSE_DATA;
  const clip = BOSS_HIT_POSE_DATA[key] ?? BOSS_HIT_POSE_DATA[fallback];
  let t = Math.max(0, now - boss.actionAt);
  if (clip.phaseDistance) t = ((boss.stride / clip.phaseDistance) % 1 + 1) % 1;
  const samples = clip.samples;
  const next = samples.findIndex(s => s.at > t);
  const a = samples[next <= 0 ? (next < 0 ? samples.length - 1 : 0) : next - 1];
  const b = samples[next <= 0 ? (next < 0 ? samples.length - 1 : 0) : next];
  const alpha = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
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
  return out;
}

function inverseRotate(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): V3 {
  // Quaternion inverse is its conjugate; all sampled orientations are normalized.
  const tx = 2 * (-qy * z + qz * y), ty = 2 * (-qz * x + qx * z), tz = 2 * (-qx * y + qy * x);
  return { x: x + qw * tx - qy * tz + qz * ty, y: y + qw * ty - qz * tx + qx * tz, z: z + qw * tz - qx * ty + qy * tx };
}

/** Swept ellipsoid test, all roots considered; long/high-speed segments cannot tunnel. */
export function intersectBossRegions(boss: BossState, now: number, from: V3, to: V3, maxT = 1): BossProjectileImpact | null {
  if (boss.hp <= 0 || maxT < 0) return null;
  const shapes = sampleBossHitRegions(boss, now), c = Math.cos(boss.yaw), s = Math.sin(boss.yaw);
  const local = (p: V3): V3 => { const x = p.x - boss.pos.x, z = p.z - boss.pos.z; return { x: c * x - s * z, y: p.y, z: s * x + c * z }; };
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
