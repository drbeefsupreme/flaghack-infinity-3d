import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { Session } from '../game/session';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import type { AudioEngine } from './engine';
import { createSoundscape, measure } from './soundscape';

describe('boss night audio fallback', () => {
  it('stays nocturnal in a zero-day encounter and fades with dawn, even without environment daylight', () => {
    const w = createMatch({ seed: 'night-audio', mode: 'standard', difficulty: 'normal', humans: [0], match: normalizeMatch({ days: 0, maxSignifiers: 0 }) });
    const session = new Session(); session.screen = 'playing';
    const engine = { lx: 0, lz: 0, panOf: () => 0 } as unknown as AudioEngine;
    const s = createSoundscape(); w.suddenDeath = true; w.effigyRevealedAt = 90; w.boss = bossFixture();
    for (const time of [90, 4000]) { w.time = time; measure(w, session, engine, null, s); expect(s.night).toBe(1); }
    w.boss.hp = 0; w.boss.deathAt = 4000;
    w.time = 4000; measure(w, session, engine, null, s); expect(s.night).toBe(1);
    w.time = 4010; measure(w, session, engine, null, s); expect(s.night).toBeGreaterThan(.3); expect(s.night).toBeLessThan(1);
    w.time = 4012; measure(w, session, engine, null, s); expect(s.night).toBeCloseTo(.3);
    measure(w, session, engine, .42, s); expect(s.night).toBeCloseTo(.58); // Renderer's exact palette still takes precedence.
  });
});
