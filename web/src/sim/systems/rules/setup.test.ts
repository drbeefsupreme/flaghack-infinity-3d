import { describe, expect, it } from 'vitest';
import { START_CARRIED_FLAGS, START_STOCK_FLAGS } from '../../constants';
import { FACTION_IDS } from '../../types';
import { flagProblems, must, newMatch, runRules } from './testWorld';

describe('camp setup', () => {
  for (const seed of ['setup-a', 'setup-b', 'setup-c', 'setup-d', 'setup-e']) {
    it(`starts every camp inside a closed home Survey (${seed})`, () => {
      const world = newMatch(seed);
      expect(flagProblems(world)).toEqual([]);
      // Setup noise (ring planting, initial ley lines) is not replayed to consumers.
      expect(world.drainEvents()).toEqual([]);
      const lat = world.lattice;
      for (const f of FACTION_IDS) {
        const hearth = must(world.hearthOf(f), 'hearth');
        const gcc = must(world.gccOf(f), 'gcc');
        expect(world.inSurvey(hearth.facet, f)).toBe(true);
        // The GCC parks inside the home Survey or just at the ring (a facet touching it).
        const gccFacet = lat.facets[gcc.facet];
        expect(world.inSurvey(gcc.facet, f) || gccFacet.neighbors.some((n) => world.inSurvey(n, f))).toBe(true);
        expect(world.survey.surveySize[f]).toBeGreaterThan(4);
        for (const h of world.hippiesOf(f)) expect(world.inSurvey(lat.facetAt(h.pos.x, h.pos.z), f)).toBe(true);
        const av = world.avatarOf(f);
        expect(world.inSurvey(lat.facetAt(av.pos.x, av.pos.z), f)).toBe(true);
        expect(world.stockCount(f)).toBe(START_STOCK_FLAGS);
        expect(av.carried.length).toBe(START_CARRIED_FLAGS);
        expect(world.factions[f].stats.flagsPlanted).toBe(0);
      }
      runRules(world, 0.5);
      for (const f of FACTION_IDS) expect(must(world.hearthOf(f), 'hearth').hearth?.stage).toBe('safe');
    });
  }
});
