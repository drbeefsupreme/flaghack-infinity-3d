/** Production host/socket coverage. Only time is accelerated; settings and snapshots are real. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BURN_TIME, SIM_DT } from '../src/sim/constants';
import { bossRevealTime } from '../src/sim/effigyBurn';
import { burnTime, dayClock, endTime, normalizeMatch } from '../src/sim/matchSettings';
import { Simulation } from '../src/sim/simulation';
import type { World } from '../src/sim/world';
import { cleanup, connect, hello, host, join, PASSWORD, until } from './testkit';

let stage: ((world: World) => void) | null = null;
afterEach(async () => { await cleanup(); vi.restoreAllMocks(); stage = null; });

function accelerateClock() {
  const original = Simulation.prototype.step;
  vi.spyOn(Simulation.prototype, 'step').mockImplementation(function(this: Simulation) {
    stage?.(this.world);
    original.call(this);
  });
}

describe('zero-day hosted matches', () => {
  it('rejects the old protocol whose zero-day setting meant Unlimited', async () => {
    const h = await host();
    const old = await connect(h);
    hello(old, 'old client', null, PASSWORD, 6);
    expect(await old.next('denied')).toMatchObject({ reason: 'protocol', message: expect.stringMatching(/reload/i) });
  });

  it('starts both clients at ignition and synchronizes the 90-second reveal and late join', async () => {
    accelerateClock();
    const h = await host();
    const a = await join(h, 'alice'), b = await join(h, 'bob');
    a.c.mirrored = b.c.mirrored = true;
    const match = normalizeMatch({ days: 0, dayLength: 300, maxSignifiers: 0 });
    a.c.send({ t: 'settings', settings: { seed: 'zero-boss-socket', match } });
    expect((await a.c.next('lobby', (message) => message.lobby.settings.match?.days === 0)).lobby.settings.match).toEqual(match);
    a.c.send({ t: 'start' });
    const starts = await Promise.all([a.c.next('matchStart', undefined, 15000), b.c.next('matchStart', undefined, 15000)]);
    for (const start of starts) {
      expect(start.options.match).toEqual(match);
      expect(start.snapshot.time).toBe(0);
      expect(bossRevealTime(start.options)).toBe(90);
    }
    for (const c of [a.c, b.c]) {
      const world = c.mirror!.world;
      expect(world.suddenDeath).toBe(true);
      expect(world.effigyRevealedAt).toBeNull();
      expect(world.boss).toBeNull();
      expect(dayClock(world.options, 0)).toBe(BURN_TIME);
    }
    stage = (world) => { world.time = 90 - SIM_DT / 2; world.tide.nextAt = Infinity; stage = null; };
    await until(() => {
      for (const c of [a.c, b.c]) c.mirror!.catchUp();
      return [a.c, b.c].every((c) => c.mirror!.world.boss?.spawnedAt === 90);
    }, 'the exact zero-day reveal on both clients');
    const late = await connect(h);
    late.mirrored = true;
    hello(late, 'late watcher');
    await late.next('welcome');
    const joined = await late.next('matchStart', undefined, 15000);
    expect(joined.options.match).toEqual(match);
    for (const c of [a.c, b.c, late]) {
      const world = c.mirror!.world;
      expect(world.effigyRevealedAt).toBe(90);
      expect(world.boss?.spawnedAt).toBe(90);
      expect(world.collision.supportHeight(0, 0, 40)).toBe(0);
      expect(world.phase).toBe('playing');
    }
    expect(late.mirror!.world.drainEvents()).toEqual([]);
  });

  it('restarts a zero-day normal match at ignition after its complete Burn night', async () => {
    accelerateClock();
    const h = await host();
    const a = await join(h, 'alice');
    a.c.mirrored = true;
    const match = normalizeMatch({ active: [0], days: 0, dayLength: 300, maxSignifiers: 0, bossMode: false });
    a.c.send({ t: 'settings', settings: { seed: 'zero-restart-socket', match } });
    await a.c.next('lobby', (message) => message.lobby.settings.match?.days === 0);
    a.c.send({ t: 'start' });
    await a.c.next('matchStart', undefined, 15000);
    const first = a.c.mirror!.world;
    expect(burnTime(first.options)).toBe(0);
    expect(endTime(first.options)).toBe(160);
    expect(first.suddenDeath).toBe(true);
    expect(first.phase).toBe('playing');
    stage = (world) => { world.time = endTime(world.options) - SIM_DT / 2; world.tide.nextAt = Infinity; stage = null; };
    await a.c.next('lobby', (message) => message.lobby.phase === 'ended');
    await until(() => { a.c.mirror!.catchUp(); return first.phase === 'ended'; }, 'the final normal-match state frame');
    expect(first.phase).toBe('ended');
    expect(first.winner).toBe(0);
    expect(first.boss).toBeNull();
    a.c.take('lobby');
    a.c.send({ t: 'backToLobby' });
    const lobby = await a.c.next('lobby', (message) => message.lobby.phase === 'lobby');
    expect(lobby.lobby.settings.match).toEqual(match);
    a.c.send({ t: 'start' });
    const restarted = await a.c.next('matchStart', undefined, 15000);
    const world = a.c.mirror!.world;
    expect(restarted.options.match).toEqual(match);
    expect(restarted.snapshot.time).toBe(0);
    expect(world).not.toBe(first);
    expect(world.suddenDeath).toBe(true);
    expect(world.phase).toBe('playing');
    expect(world.winner).toBeNull();
    expect(world.boss).toBeNull();
    expect(world.effigyRevealedAt).toBeNull();
  });
});
