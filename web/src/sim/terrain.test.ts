import { describe, expect, it } from 'vitest';
import { groundHeight } from './terrain';

describe('gameplay terrain dome', () => {
  for (const half of [64, 128, 150, 192, 256, 512]) {
    it(`has exactly two metres of relief across the entire square at half=${half}`, () => {
      expect(groundHeight(0, 0, half)).toBe(2);
      for (let i = -10; i <= 10; i++) {
        const v = half * i / 10;
        for (const sign of [-1, 1]) {
          expect(groundHeight(sign * half, v, half)).toBe(0);
          expect(groundHeight(v, sign * half, half)).toBe(0);
        }
      }
      expect(groundHeight(half + 1, 0, half)).toBe(0);
      let previous = 2;
      for (let i = 0; i <= 100; i++) {
        const x = half * i / 100;
        const h = groundHeight(x, x * .7, half);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(previous);
        expect(h).toBe(groundHeight(-x, x * .7, half));
        previous = h;
      }
      const e = 1e-3;
      expect((2 - groundHeight(e, 0, half)) / e).toBeLessThan(1e-5);
      expect(groundHeight(half - e, 0, half) / e).toBeLessThan(1e-5);
    });
  }
});
