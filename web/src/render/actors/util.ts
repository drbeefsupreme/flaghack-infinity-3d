/**
 * Small allocation-free helpers shared by the actor renderers: stable hashes, frame-rate
 * independent smoothing, easing curves and a direct column-major transform writer for
 * instanced attribute arrays (cheaper than Matrix4.compose for thousands of instances).
 */
import type * as THREE from 'three';

/** Festival tempo (126 BPM) that dancers, drummers and glowing headphones lock to. */
export const BEAT_HZ = 126 / 60;

/**
 * The scene has no environment map, so strongly metallic surfaces reflect nothing and read as
 * black. Gold and brass are authored as metal but capped here so they keep their colour.
 */
export const METAL_CAP = 0.45;

/** Flag the first `count` instances of an instanced attribute for upload (partial update). */
export function markInstancesDirty(attr: THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.max(1, count) * attr.itemSize);
  attr.needsUpdate = true;
}

/** Stable integer hash → [0, 1). Used for per-entity presentation variety (never gameplay). */
export function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Second independent stream of hash01 for the same id. */
export function hash01b(n: number, salt: number): number {
  return hash01(Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77));
}

/** Exponential smoothing factor for `rate` (1/s) over `dt`, frame-rate independent. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp01(t) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

export function easeOutBounce(t: number): number {
  const x = clamp01(t);
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) {
    const y = x - 1.5 / d1;
    return n1 * y * y + 0.75;
  }
  if (x < 2.5 / d1) {
    const y = x - 2.25 / d1;
    return n1 * y * y + 0.9375;
  }
  const y = x - 2.625 / d1;
  return n1 * y * y + 0.984375;
}

/** Smooth 0→1→0 bump over [0, 1]. */
export function bump(t: number): number {
  const x = clamp01(t);
  return Math.sin(x * Math.PI);
}

/**
 * Write the column-major matrix T(x,y,z) · Ry(yaw) · Rx(pitch) · Rz(roll) · S(s) into `out`
 * at element offset `o`. Yaw follows the sim convention (0 faces +z, π/2 faces +x).
 */
export function writeTransform(
  out: THREE.TypedArray,
  o: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  roll: number,
  s: number,
): void {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cb = Math.cos(pitch);
  const sb = Math.sin(pitch);
  const cc = Math.cos(roll);
  const sc = Math.sin(roll);
  out[o] = (ca * cc + sa * sb * sc) * s;
  out[o + 1] = cb * sc * s;
  out[o + 2] = (-sa * cc + ca * sb * sc) * s;
  out[o + 3] = 0;
  out[o + 4] = (-ca * sc + sa * sb * cc) * s;
  out[o + 5] = cb * cc * s;
  out[o + 6] = (sa * sc + ca * sb * cc) * s;
  out[o + 7] = 0;
  out[o + 8] = sa * cb * s;
  out[o + 9] = -sb * s;
  out[o + 10] = ca * cb * s;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** Shared GLSL helpers (hashing, HSV) injected into several actor shaders. */
export const GLSL_COMMON = /* glsl */ `
float fhHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fhHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 fhHsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 fhSrgbToLinear(vec3 c) {
  return pow(c, vec3(2.2));
}
`;
