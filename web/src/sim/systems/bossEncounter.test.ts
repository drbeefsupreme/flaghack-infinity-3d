import { describe, expect, it } from 'vitest';
import { createMatch } from '../setup';
import { Simulation } from '../simulation';
import { createAi } from '../../ai';
import { bossRevealTime } from '../effigyBurn';
import { SIM_HZ } from '../constants';
import { BOSS_MAX_HP } from '../boss';
import { normalizeMatch } from '../matchSettings';

describe('live boss encounter vertical slice', () => {
  it('runs all systems, traverses the field, blocks/eats defenses and receives cooperative attacks', () => {
    const world = createMatch({ seed: 'boss-live', difficulty: 'normal', humans: [0], mode: 'standard' });
    world.time = bossRevealTime(world.options); world.suddenDeath = true;
    // Keep the human camp alive long enough to observe the encounter, not parked under a foot.
    world.avatarOf(0).pos = { x: -85, y: 0, z: 85 };
    world.factions[2].stats.cmi = 1000;
    const ai = createAi(world, [1, 2, 3]), sim = new Simulation(world);
    const seen = new Set<string>(); let blocked = false, hurt = false, furthest = 0;
    const beforeFlags = world.flags.size, beforeAltars = world.buildings.size;
    const started = performance.now();
    for (let i = 0; i < SIM_HZ * 160 && world.phase === 'playing'; i++) {
      ai.update(); sim.step();
      const b = world.boss!; seen.add(b.action); blocked ||= !!b.barrier; hurt ||= b.hp < BOSS_MAX_HP;
      furthest = Math.max(furthest, Math.hypot(b.pos.x - world.map.effigy.x, b.pos.z - world.map.effigy.z));
      expect(Number.isFinite(b.pos.x + b.pos.z + b.hp)).toBe(true);
      world.drainEvents();
    }
    console.log(JSON.stringify({ bossLive: { seen: [...seen], blocked, hurt, furthest, endTime: world.time,
      hp: world.boss?.hp, phase: world.phase, outcome: world.bossOutcome, flagsConsumedNet: beforeFlags - world.flags.size,
      structuresConsumedNet: beforeAltars - world.buildings.size, wallMs: performance.now() - started } }));
    expect(hurt).toBe(true); expect(furthest).toBeGreaterThan(15); expect(seen.has('walk')).toBe(true);
    expect(seen.has('swipe') || seen.has('stomp')).toBe(true);
    expect(world.boss?.hp).toBeLessThan(BOSS_MAX_HP);
  }, 30000);
  it('completes a cooperative all-system battle and waits for the final burn before ending', () => {
    // Keep this completion regression bounded independently of the configurable
    // default. The live-encounter test above exercises the full 50,000 HP default.
    const world = createMatch({ seed: 'boss-cooperative-finish', difficulty: 'normal', humans: [0, 1], mode: 'standard',
      match: normalizeMatch({ bossHp: 5000 }) });
    world.time = bossRevealTime(world.options); world.suddenDeath = true;
    // Controllers submit ordinary player commands for all four camps to exercise completion.
    const ai = createAi(world, [0, 1, 2, 3]), sim = new Simulation(world);
    let deathAt: number | null = null, hpZeroSeen = false;
    for (let i = 0; i < SIM_HZ * 600 && world.phase === 'playing'; i++) {
      ai.update(); sim.step();
      if (world.boss!.hp <= 0) { hpZeroSeen = true; deathAt = world.boss!.deathAt; }
      world.drainEvents();
    }
    expect(world.phase).toBe('ended');
    expect(world.bossOutcome).not.toBeNull();
    if (world.bossOutcome!.kind === 'victory') {
      expect(hpZeroSeen).toBe(true); expect(world.time - deathAt!).toBeGreaterThanOrEqual(12);
      expect(world.boss!.action).toBe('dead'); expect(world.bossOutcome!.winners.length).toBeGreaterThan(0);
    } else expect(world.options.humans.every(f => !world.factions[f].alive)).toBe(true);
    console.log(JSON.stringify({ bossCompletion: { result: world.bossOutcome, hp: world.boss!.hp, deathAt, endedAt: world.time } }));
  }, 30000);

});
