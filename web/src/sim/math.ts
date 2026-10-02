/** Ground-plane vector (world x, world z). y is implicit (0 unless stated). */
export interface V2 {
  x: number;
  z: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const PHI = (1 + Math.sqrt(5)) / 2;
export const TAU = Math.PI * 2;

export const v2 = (x = 0, z = 0): V2 => ({ x, z });
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function dist(a: V2, b: V2): number {
  return Math.sqrt(dist2(a.x, a.z, b.x, b.z));
}

export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference b - a in radians. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Yaw (radians) that faces from a toward b on the ground plane; 0 = +z, PI/2 = +x. */
export function yawTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx - ax, bz - az);
}

/** Point-in-convex-polygon (CCW or CW) test on the ground plane. */
export function pointInConvex(px: number, pz: number, xs: ArrayLike<number>, zs: ArrayLike<number>): boolean {
  const n = xs.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = (xs[j] - xs[i]) * (pz - zs[i]) - (zs[j] - zs[i]) * (px - xs[i]);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/** Distance from point to segment on the ground plane. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return len2(px - (ax + dx * t), pz - (az + dz * t));
}
