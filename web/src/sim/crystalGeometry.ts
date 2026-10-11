/** Authoritative dimensions of the displayed prism. Decorative orbiting shards are not targets. */
import { groundHeight } from './terrain';
import { CRYSTAL_HEIGHT, MAP_HALF } from './constants';
import type { V3 } from './math';
import type { Crystal } from './types';
export const CRYSTAL_RADIUS = 1.05;
export const CRYSTAL_SHOULDER = .8;
export const CRYSTAL_CAP_SCALE = .86;
export function crystalDimensions(c: Crystal) {
  const grow = 1 - (1 - c.growth) ** 3;
  return { height: CRYSTAL_HEIGHT * c.scale * (.12 + .88 * grow), radius: CRYSTAL_RADIUS * c.scale * (.55 + .45 * grow) };
}
export function crystalRotation(c: Crystal, at: number): number { return (((c.id * .618034) % 1 + 1) % 1) * 6.283 + at * .12; }

/** Two-sided ray/triangle intersection with the same five tapered sides and cap as the shader. */
export function rayCrystal(c: Crystal, now: number, origin: V3, direction: V3, maxDistance: number, mapHalf = MAP_HALF): number | null {
  const { height, radius } = crystalDimensions(c), angle = crystalRotation(c, now), cs = Math.cos(angle), sn = Math.sin(angle);
  const ox = origin.x - c.pos.x, oz = origin.z - c.pos.z;
  const o = { x: (ox * cs + oz * sn) / radius, y: (origin.y - groundHeight(c.pos.x, c.pos.z, mapHalf)) / height, z: (-ox * sn + oz * cs) / radius };
  const d = { x: (direction.x * cs + direction.z * sn) / radius, y: direction.y / height, z: (-direction.x * sn + direction.z * cs) / radius };
  let best = maxDistance, found = false;
  const triangle = (a: V3, b: V3, c: V3) => {
    const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z, fx = c.x - a.x, fy = c.y - a.y, fz = c.z - a.z;
    const px = d.y * fz - d.z * fy, py = d.z * fx - d.x * fz, pz = d.x * fy - d.y * fx;
    const determinant = ex * px + ey * py + ez * pz;
    if (Math.abs(determinant) < 1e-12) return;
    const inverse = 1 / determinant, tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < -1e-9 || u > 1 + 1e-9) return;
    const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inverse;
    if (v < -1e-9 || u + v > 1 + 1e-9) return;
    const distance = (fx * qx + fy * qy + fz * qz) * inverse;
    if (distance >= 0 && distance <= best) { best = distance; found = true; }
  };
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, b = (i + 1) / 5 * Math.PI * 2;
    const p = { x: Math.cos(a), y: -.03, z: Math.sin(a) }, q = { x: Math.cos(b), y: -.03, z: Math.sin(b) };
    const u = { x: p.x * CRYSTAL_CAP_SCALE, y: CRYSTAL_SHOULDER, z: p.z * CRYSTAL_CAP_SCALE };
    const v = { x: q.x * CRYSTAL_CAP_SCALE, y: CRYSTAL_SHOULDER, z: q.z * CRYSTAL_CAP_SCALE };
    triangle(p, q, v); triangle(p, v, u); triangle(u, v, { x: 0, y: 1, z: 0 });
  }
  return found ? best : null;
}
