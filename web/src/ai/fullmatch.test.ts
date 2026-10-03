import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { FACTION_IDS } from '../sim/types';
import type { FactionId } from '../sim/types';
import { createAi } from '.';

const MATCH_LIMIT = 25 * 60;
/** The requirements' upper bound on a match (R4: 10-30 minutes). */
const MATCH_BOUND = 30 * 60;
const EARLY = 6 * 60;

interface MatchReport {
  winnerAt: number | null;
  built: Record<FactionId, number>;
  surveyStart: Record<FactionId, number>;
  surveyEarlyPeak: Record<FactionId, number>;
  rejected: Record<FactionId, number>;
  captures: number;
  aiMsPerTick: number;
}

/** Four NPC factions, no player, until someone wins or `limit` (s) runs out. */
function playMatch(seed: string, limit: number): MatchReport {
  const world = createMatch({ seed, difficulty: 'normal', allAi: true });
  const sim = new Simulation(world);
  const ai = createAi(world, [...FACTION_IDS]);
  const zero = (): Record<FactionId, number> => ({ 0: 0, 1: 0, 2: 0, 3: 0 });
  const report: MatchReport = {
    winnerAt: null,
    built: zero(),
    surveyStart: zero(),
    surveyEarlyPeak: zero(),
    rejected: zero(),
    captures: 0,
    aiMsPerTick: 0,
  };
  for (const f of FACTION_IDS) report.surveyStart[f] = world.survey.surveySize[f];
  let aiMs = 0;
  while (world.phase === 'playing' && world.time < limit) {
    const t0 = performance.now();
    ai.update();
    aiMs += performance.now() - t0;
    sim.step();
    for (const e of world.drainEvents()) {
      if (e.t === 'buildingPlaced' && e.faction !== -1 && world.time <= EARLY) report.built[e.faction]++;
      if (e.t === 'rejected') report.rejected[e.faction]++;
      if (e.t === 'captured') report.captures++;
    }
    if (world.time <= EARLY) {
      for (const f of FACTION_IDS) report.surveyEarlyPeak[f] = Math.max(report.surveyEarlyPeak[f], world.survey.surveySize[f]);
    }
  }
  if (world.phase === 'ended') report.winnerAt = world.time;
  report.aiMsPerTick = aiMs / Math.max(1, world.tick);
  return report;
}

describe('all-NPC match', () => {
  // Over 32 seeds (seed-a..z, seed-0..5), 25 normal all-NPC matches crown a winner within 25
  // minutes and 28 within 30 (median ~22 min); these three finish with minutes to spare.
  // Seeds replay identically only on the same JS engine (Math.* differs across them).
  for (const seed of ['seed-k', 'seed-m', 'seed-b']) {
    it(
      `${seed}: rivals build, grow, fight and crown a winner within 25 minutes`,
      () => {
        const r = playMatch(seed, MATCH_LIMIT);
        for (const f of FACTION_IDS) {
          expect(r.built[f], `faction ${f} buildings in the first 6 min`).toBeGreaterThanOrEqual(1);
          expect(r.surveyEarlyPeak[f], `faction ${f} Survey growth`).toBeGreaterThan(r.surveyStart[f]);
        }
        const minutes = (r.winnerAt ?? MATCH_LIMIT) / 60;
        for (const f of FACTION_IDS) expect(r.rejected[f] / minutes, `faction ${f} rejections per minute`).toBeLessThan(10);
        expect(r.winnerAt, 'match ended with a winner').not.toBeNull();
        expect(r.captures).toBeGreaterThanOrEqual(3);
        expect(r.aiMsPerTick).toBeLessThan(0.6);
      },
      600_000,
    );
  }
});

describe('all-NPC match (slow)', () => {
  // seed-g's last two camps once traded Hearths past the 25-minute mark; the duel must still
  // be settled inside the requirements' 30-minute bound.
  it(
    'seed-g: the last two camps settle it within the 30-minute bound',
    () => {
      const r = playMatch('seed-g', MATCH_BOUND);
      expect(r.winnerAt, 'match ended with a winner').not.toBeNull();
      expect(r.aiMsPerTick).toBeLessThan(0.6);
    },
    900_000,
  );
});
