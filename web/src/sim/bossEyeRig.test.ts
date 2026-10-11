import { describe, expect, it } from 'vitest';
import { bossEyeFromHead, solveBossEyeAim } from './bossEyeRig';
import type { V3 } from './math';

function miss(origin: V3, direction: V3, target: V3): number {
  const x = target.x - origin.x, y = target.y - origin.y, z = target.z - origin.z;
  return Math.hypot(y * direction.z - z * direction.y, z * direction.x - x * direction.z, x * direction.y - y * direction.x);
}
describe('numeric eye socket aiming', () => {
  it('aims the offset pupil exactly at nearby, low, high and side targets', () => {
    const head = { x: 10, y: 15.1, z: -7 }, q = [.0402246548, 0, 0, .9991906611] as const;
    for (const target of [{ x: 10, y: 0, z: 10 }, { x: -40, y: 2, z: 90 }, { x: 10, y: 80, z: -6 }, { x: 12, y: 12, z: -3 }, { x: 10, y: 1, z: -100 }]) {
      const aimed = solveBossEyeAim(head, q, target);
      expect(miss(aimed.origin, aimed.direction, target)).toBeLessThan(1e-8);
      expect(Math.hypot(...aimed.headQuaternion)).toBeCloseTo(1, 12);
      expect(Math.hypot(aimed.direction.x, aimed.direction.y, aimed.direction.z)).toBeCloseTo(1, 12);
      const along = (target.x - aimed.origin.x) * aimed.direction.x + (target.y - aimed.origin.y) * aimed.direction.y + (target.z - aimed.origin.z) * aimed.direction.z;
      expect(along).toBeGreaterThan(0);
    }
  });
  it('starts at the sampled gaze, blends reversibly, and remains finite for coincident targets', () => {
    const head = { x: 1, y: 8, z: 3 }, q = [0, 0, 0, 1] as const, target = { x: 7, y: 0, z: 15 };
    const original = bossEyeFromHead(head, q), start = solveBossEyeAim(head, q, target, 0);
    expect(start.origin).toEqual(original.origin); expect(start.direction).toEqual(original.direction);
    const half = solveBossEyeAim(head, q, target, .5);
    expect(miss(half.origin, half.direction, target)).toBeLessThan(miss(start.origin, start.direction, target));
    expect(solveBossEyeAim(head, q, target, .5)).toEqual(half);
    const same = solveBossEyeAim(head, q, head);
    expect([...same.headQuaternion, ...Object.values(same.origin), ...Object.values(same.direction)].every(Number.isFinite)).toBe(true);
  });
});
