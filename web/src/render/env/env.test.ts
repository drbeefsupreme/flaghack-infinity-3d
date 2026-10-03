import { describe, expect, it } from 'vitest';
import { BURN_TIME, DAWN_TIME } from '../../sim/constants';
import type { GroundType, MapLayout } from '../../sim/map/mapgen';
import { bakeGroundTypes } from './ground';
import { terrainHeight } from './terrain';
import { ATTRACT_CLOCK, computeDayState, createDayState } from './timeOfDay';

describe('time of day', () => {
  it('runs golden afternoon → night, darkening monotonically, deep night at The Burn', () => {
    const day = createDayState();
    let last = Infinity;
    for (let t = 0; t <= BURN_TIME + 120; t += 10) {
      computeDayState(t, day);
      expect(day.daylight).toBeLessThanOrEqual(last + 1e-9);
      last = day.daylight;
    }
    computeDayState(0, day);
    expect(day.daylight).toBe(1);
    expect(day.sunDir.y).toBeGreaterThan(0.3);
    computeDayState(BURN_TIME, day);
    expect(day.daylight).toBe(0);
    expect(day.night).toBe(1);
    expect(day.sunDir.y).toBeLessThan(0);
  });

  it('deepens the night after The Burn, then breaks dawn at DAWN_TIME opposite the sunset', () => {
    const day = createDayState();
    const zenith = () => day.zenith.r * 0.2126 + day.zenith.g * 0.7152 + day.zenith.b * 0.0722;
    const bearing = () => {
      const l = Math.hypot(day.sunDir.x, day.sunDir.z);
      return { x: day.sunDir.x / l, z: day.sunDir.z / l };
    };
    // Where the sun went down: its bearing as it crosses the horizon at dusk.
    let t = 0;
    for (computeDayState(t, day); day.sunDir.y > 0; computeDayState(++t, day));
    const set = bearing();

    // The darkest moment falls between The Burn and Dawn, darker than the night at The Burn.
    computeDayState(BURN_TIME, day);
    const atBurn = zenith();
    let darkest = BURN_TIME;
    let darkestLum = atBurn;
    for (t = BURN_TIME; t <= DAWN_TIME; t += 5) {
      computeDayState(t, day);
      if (zenith() < darkestLum) {
        darkest = t;
        darkestLum = zenith();
      }
    }
    expect(darkestLum).toBeLessThan(atBurn * 0.8);
    expect(darkest).toBeGreaterThan(BURN_TIME);
    expect(darkest).toBeLessThan(DAWN_TIME - 300);

    // From then on the sky only brightens, all the way to Dawn.
    let lastDay = -Infinity;
    let lastLum = -Infinity;
    for (t = darkest; t <= DAWN_TIME; t += 5) {
      computeDayState(t, day);
      expect(day.daylight).toBeGreaterThanOrEqual(lastDay - 1e-9);
      expect(zenith()).toBeGreaterThanOrEqual(lastLum - 1e-9);
      lastDay = day.daylight;
      lastLum = zenith();
    }

    // Pre-dawn: the sun still below the horizon, stars fading, the glow gathering opposite the sunset.
    computeDayState(DAWN_TIME - 150, day);
    expect(day.sunDir.y).toBeLessThan(0);
    expect(day.stars).toBeGreaterThan(0);
    expect(day.stars).toBeLessThan(1);
    const glow = bearing();
    expect(glow.x * set.x + glow.z * set.z).toBeLessThan(-0.95);

    // Dawn: the disc is up, the stars are gone and warm daylight returns.
    computeDayState(DAWN_TIME, day);
    expect(day.sunDir.y).toBeGreaterThan(Math.sin((4 * Math.PI) / 180));
    expect(day.stars).toBe(0);
    expect(day.daylight).toBeGreaterThan(0.5);
    expect(day.lightIntensity).toBeGreaterThan(2);
    const rise = bearing();
    expect(rise.x * set.x + rise.z * set.z).toBeLessThan(-0.95);
  });

  it('keeps the shadow light above the horizon, only swinging across while faint, and a sunny title', () => {
    const day = createDayState();
    computeDayState(0, day);
    let prevDir = day.lightDir.clone();
    let prevI = day.lightIntensity;
    for (let t = 0; t <= DAWN_TIME + 120; t += 1) {
      computeDayState(t, day);
      expect(day.lightDir.y).toBeGreaterThan(0.15);
      expect(Math.abs(day.lightDir.length() - 1)).toBeLessThan(1e-9);
      // A sun ↔ moon hand-off flips the shadows across the map: only allowed with both lights faint.
      if (day.lightDir.dot(prevDir) < Math.cos((20 * Math.PI) / 180)) {
        expect(Math.min(day.lightIntensity, prevI)).toBeLessThan(0.1);
      }
      prevDir = prevDir.copy(day.lightDir);
      prevI = day.lightIntensity;
    }
    computeDayState(ATTRACT_CLOCK, day);
    expect(day.sunDir.y).toBeGreaterThan(0.1);
    expect(day.lightIntensity).toBeGreaterThan(2);
    expect(day.night).toBeLessThan(0.01);
  });
});

describe('terrain relief', () => {
  it('is exactly flat across the playable map (edges included), rising only beyond', () => {
    const half = 150;
    for (let x = -half - 4; x <= half + 4; x += 2) {
      for (let z = -half - 4; z <= half + 4; z += 2) expect(terrainHeight(x, z, half)).toBe(0);
    }
    expect(terrainHeight(half + 12, 0, half)).toBe(0);
    expect(terrainHeight(half + 120, 0, half)).toBeGreaterThan(5);
    expect(terrainHeight(-(half + 120), half + 120, half)).toBeGreaterThan(5);
  });
});

describe('ground type bake', () => {
  /** Quadrant map: road for x > 0, water for z > 0 (water wins), grass elsewhere. */
  function quadrantMap(): MapLayout {
    const groundAt = (x: number, z: number): GroundType => (z > 0 ? 'water' : x > 0 ? 'road' : 'grass');
    return {
      seed: 't',
      half: 100,
      camps: [],
      obstacles: [],
      roads: [],
      water: [],
      mud: [],
      soundCamps: [],
      pileSpots: [],
      neutralSpawns: [],
      effigy: { x: 0, z: 0 },
      isBlockedAt: () => false,
      groundAt,
    };
  }

  it('maps texel columns to world x and rows to world z, one channel per surface type', () => {
    const n = 64;
    const data = bakeGroundTypes(quadrantMap(), n);
    const texel = (col: number, row: number) => data.subarray((row * n + col) * 4, (row * n + col) * 4 + 4);
    // Row 8 is at negative z (land), column 56 at positive x → road (G).
    expect(Array.from(texel(56, 8))).toEqual([0, 255, 0, 0]);
    // Column 8 at negative x, row 8 → plain grass: all channels empty.
    expect(Array.from(texel(8, 8))).toEqual([0, 0, 0, 0]);
    // Row 56 at positive z → water (A) on both sides.
    expect(texel(8, 56)[3]).toBe(255);
    expect(texel(56, 56)[3]).toBe(255);
    // Boundaries are blurred, never exceeding a full weight in total.
    for (let i = 0; i < n * n; i++) {
      const sum = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + data[i * 4 + 3];
      expect(sum).toBeLessThanOrEqual(256);
    }
    expect(texel(32, 8)[1]).toBeGreaterThan(0);
    expect(texel(32, 8)[1]).toBeLessThan(255);
  });
});
