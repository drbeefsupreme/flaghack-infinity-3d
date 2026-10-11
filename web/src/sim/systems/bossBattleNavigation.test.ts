import { expect, it } from 'vitest';
import { createAi } from '../../ai';
import { SIM_HZ } from '../constants';
import { bossRevealTime } from '../effigyBurn';
import { createMatch } from '../setup';
import { Simulation } from '../simulation';
import { sweepBossLoops } from './boss/barriers';

it.each(['boss-live', 'boss-combat', 'altar-route-1'])('makes altar progress during an actual three-rival battle: %s', seed => {
  const w = createMatch({ seed, difficulty: 'normal', humans: [0], mode: 'standard' });
  w.time = bossRevealTime(w.options)!; w.suddenDeath = true; w.avatarOf(0).pos = { x: -85, y: 0, z: 85 };
  const sim = new Simulation(w), ai = createAi(w, [1, 2, 3]);
  const initial = new Set(w.factions.flatMap(f => f.hearthIds)), eaten = new Set<number>();
  let firstEaten = Infinity, contacts = 0, crushed = 0;
  for (let i = 0; i < SIM_HZ * 600 && w.phase === 'playing'; i++) {
    const prior = w.boss, old = prior ? { ...prior.pos } : null, objective = prior?.objectiveAltarId;
    ai.update(); sim.step();
    const b = w.boss!;
    if (objective != null && w.buildings.has(objective)) expect(b.objectiveAltarId).toBe(objective);
    if (old && Math.hypot(old.x - b.pos.x, old.z - b.pos.z) > 1e-7) expect(sweepBossLoops(w, old, b.pos)).toBeNull();
    for (const id of initial) if (!w.buildings.has(id) && !eaten.has(id)) {
      eaten.add(id); firstEaten = Math.min(firstEaten, w.time - b.spawnedAt);
      expect(b.action).toBe('grab'); expect(b.held?.id).toBe(id);
    }
    for (const e of w.drainEvents()) { if (e.t === 'bossFootfall') contacts++; if (e.t === 'sceneryCrushed') crushed += e.count; }
  }
  expect(firstEaten).toBeLessThan(150); expect(eaten.size).toBeGreaterThanOrEqual(1);
  // A random first choice can be the only human altar and end the match immediately.
  expect(contacts).toBeGreaterThan(20); expect(crushed).toBeGreaterThan(0);
  expect(w.phase).toBe('ended'); expect(w.bossOutcome?.kind).toBe('defeat');
});
