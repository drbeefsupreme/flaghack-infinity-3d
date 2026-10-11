import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { BOSS_DEATH_DURATION } from '../sim/boss';
import { DAWN_TIME } from '../sim/constants';
import { BOSS_NIGHT_CLOCK, worldDayClock } from '../sim/dayCycle';
import { bossRevealTime } from '../sim/effigyBurn';
import { dayClock, endTime, normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { updateEffigy } from '../sim/systems/effigy';
import { computeDayState, createDayState } from '../render/env/timeOfDay';
import { SnapshotEncoder } from './codec';
import { Motion } from './interp';
import { NetMirror } from './mirror';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function setup(days = 1, dayLength = 1800) {
  return createMatch({ seed: 'boss-day-cycle-network', difficulty: 'normal', mode: 'standard', humans: [0, 1],
    match: normalizeMatch({ days, dayLength, maxSignifiers: 0 }) });
}

describe('replicated boss night and sunrise', () => {
  it.each([{ days: 0, dayLength: 300 }, { days: 3, dayLength: 7200 }])(
    'derives the same night and death sunrise from live frames and late joins ($days days, $dayLength seconds)',
    ({ days, dayLength }) => {
      const host = setup(days, dayLength), encoder = new SnapshotEncoder(host);
      const live = NetMirror.create(host.options, wire(encoder.full()));
      const reveal = bossRevealTime(host.options), heldClock = Math.max(BOSS_NIGHT_CLOCK, dayClock(host.options, reveal));
      const flush = (expected: number) => {
        host.tick++;
        live.push(wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] }));
        live.catchUp();
        const late = NetMirror.create(host.options, wire(encoder.full()));
        for (const peer of [live, late]) {
          expect(worldDayClock(peer.world)).toBeCloseTo(expected, 8);
          expect(worldDayClock(peer.world)).toBeCloseTo(worldDayClock(host), 8);
          expect(computeDayState(worldDayClock(peer.world), createDayState()))
            .toEqual(computeDayState(worldDayClock(host), createDayState()));
          expect(peer.world.drainEvents()).toEqual([]);
        }
      };

      host.suddenDeath = true;
      host.time = reveal;
      updateEffigy(host);
      host.boss = bossFixture();
      host.boss.spawnedAt = reveal;
      host.boss.action = 'idle';
      flush(heldClock);
      host.time = endTime(host.options) + 3 * dayLength;
      flush(heldClock);
      expect(computeDayState(worldDayClock(live.world), createDayState()).night).toBe(1);

      // All player camps losing is not a sunrise trigger while the boss remains alive.
      host.phase = 'ended';
      host.bossOutcome = { kind: 'defeat', winners: [], at: host.time };
      flush(heldClock);
      host.phase = 'playing';
      host.bossOutcome = null;

      const deathAt = host.time + .125;
      host.boss.hp = 0;
      host.boss.deathAt = deathAt;
      host.boss.action = 'death';
      for (const age of [0, 3, 6, 9, BOSS_DEATH_DURATION - .001, BOSS_DEATH_DURATION]) {
        host.time = deathAt + age;
        const progress = age / BOSS_DEATH_DURATION;
        const eased = progress * progress * (3 - 2 * progress);
        flush(heldClock + (DAWN_TIME - heldClock) * eased);
      }
      host.boss.action = 'dead';
      host.phase = 'ended';
      host.bossOutcome = { kind: 'victory', winners: [0, 1], at: host.time };
      host.time += 100;
      flush(DAWN_TIME);

      // Clearing the replicated encounter cannot leave a client-local night/sunrise latch.
      host.time = 0;
      host.boss = null;
      host.effigyRevealedAt = null;
      host.bossOutcome = null;
      host.suddenDeath = false;
      host.phase = 'playing';
      flush(dayClock(host.options, 0));
    },
  );

  it('never starts a sunrise from a queued death frame before its authoritative state applies', () => {
    const host = setup();
    host.suddenDeath = true;
    host.effigyRevealedAt = bossRevealTime(host.options);
    host.time = endTime(host.options) + 60;
    host.boss = bossFixture();
    host.boss.action = 'idle';
    const heldClock = worldDayClock(host), encoder = new SnapshotEncoder(host);
    const live = NetMirror.create(host.options, wire(encoder.full()));
    const motion = new Motion();
    motion.capture(live.world, null, host.time);
    host.time += 1;
    host.tick++;
    host.boss.hp = 0;
    host.boss.deathAt = host.time;
    host.boss.action = 'death';
    const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
    motion.aim(frame.delta);
    live.world.time = motion.blend(live.world, host.time - .001);
    expect(live.world.boss!.deathAt).toBeNull();
    expect(worldDayClock(live.world)).toBe(heldClock);
    motion.restore(live.world);
    live.push(frame);
    live.catchUp();
    expect(live.world.boss!.deathAt).toBe(host.time);
    expect(worldDayClock(live.world)).toBe(heldClock);

    motion.capture(live.world, null, host.time);
    host.time += 1;
    host.tick++;
    motion.aim(wire(encoder.delta([])));
    live.world.time = motion.blend(live.world, host.time - .5);
    expect(worldDayClock(live.world)).toBeGreaterThan(heldClock);
    expect(worldDayClock(live.world)).toBeLessThan(DAWN_TIME);
  });

  it('does not infer a reveal from the client clock and starts a fresh match without old encounter state', () => {
    const host = setup();
    host.time = endTime(host.options) + 600;
    const mirror = NetMirror.create(host.options, wire(new SnapshotEncoder(host).full()));
    expect(mirror.world.effigyRevealedAt).toBeNull();
    expect(worldDayClock(mirror.world)).toBe(dayClock(host.options, host.time));

    const fresh = setup();
    const restarted = NetMirror.create(fresh.options, wire(new SnapshotEncoder(fresh).full()));
    expect(restarted.world.boss).toBeNull();
    expect(worldDayClock(restarted.world)).toBe(0);
  });
});
