import { describe, expect, it } from 'vitest';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { finalMode } from './endscreen';

describe('durable boss end screen verdict', () => {
  it('shows shared victory for survivors, defeat for eliminated players, and an explicit all-player loss', () => {
    const w = createMatch({ seed: 'boss-ui', difficulty: 'normal', mode: 'standard', humans: [0, 1],
      match: normalizeMatch({ maxSignifiers: 0 }) });
    w.phase = 'ended';
    w.winner = null;
    w.bossOutcome = { kind: 'victory', winners: [0, 2, 3], at: 300 };
    expect(finalMode(w, 0)).toBe('victory');
    expect(finalMode(w, 2)).toBe('victory');
    expect(finalMode(w, 1)).toBe('defeat');
    expect(finalMode(w, null)).toBe('over');
    w.bossOutcome = { kind: 'defeat', winners: [], at: 300 };
    expect(finalMode(w, 0)).toBe('defeat');
    expect(finalMode(w, 1)).toBe('defeat');
  });
});
