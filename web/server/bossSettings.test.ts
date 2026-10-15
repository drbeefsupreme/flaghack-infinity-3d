/** Real host settings and replication. Only the encounter clock/damage are staged. */
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOSS_DEATH_DURATION } from '../src/sim/boss';
import { SIM_DT } from '../src/sim/constants';
import { normalizeMatch } from '../src/sim/matchSettings';
import { Simulation } from '../src/sim/simulation';
import type { World } from '../src/sim/world';
import { CHANGE_COOLDOWN_MS } from './room';
import { cleanup, connect, hello, host, join, until } from './testkit';

let stage: ((world: World) => void) | null = null;
afterEach(async () => { await cleanup(); vi.restoreAllMocks(); stage = null; });

describe('host-authoritative pregame Boss HP', () => {
  it('replicates custom HP, refuses guests and midfight edits, and uses the next lobby choice after restart', async () => {
    const original = Simulation.prototype.step;
    vi.spyOn(Simulation.prototype, 'step').mockImplementation(function(this: Simulation) {
      stage?.(this.world);
      original.call(this);
    });
    const h = await host();
    const a = await join(h, 'alice'), b = await join(h, 'bob');
    a.c.mirrored = b.c.mirrored = true;
    expect(a.me.lobby.settings.match?.bossHp).toBe(50000);
    const match = normalizeMatch({ active: [0, 1], days: 0, maxSignifiers: 0, bossHp: 72500 });
    a.c.send({ t: 'settings', settings: { seed: 'boss-hp-settings', match } });
    for (const c of [a.c, b.c]) {
      expect((await c.next('lobby', (m) => m.lobby.settings.match?.bossHp === 72500)).lobby.settings.match).toEqual(match);
    }
    b.c.send({ t: 'settings', settings: { match: { ...match, bossHp: 100 } } });
    b.c.send({ t: 'ping', id: 1, clientTime: 0 });
    await b.c.next('pong', (m) => m.id === 1);
    a.c.send({ t: 'start' });
    for (const c of [a.c, b.c]) {
      expect((await c.next('matchStart', undefined, 15000)).options.match?.bossHp).toBe(72500);
    }
    stage = (world) => { world.time = 90 - SIM_DT / 2; world.tide.nextAt = Infinity; stage = null; };
    await until(() => {
      for (const c of [a.c, b.c]) c.mirror!.catchUp();
      return [a.c, b.c].every((c) => c.mirror!.world.boss?.hp === 72500 && c.mirror!.world.boss.maxHp === 72500);
    }, 'custom starting and maximum boss HP on both clients');
    stage = (world) => { world.boss!.hp -= 500; stage = null; };
    await until(() => {
      a.c.mirror!.catchUp();
      return a.c.mirror!.world.boss?.hp === 72000;
    }, 'authoritative boss damage');
    await sleep(CHANGE_COOLDOWN_MS + 10);
    a.c.send({ t: 'settings', settings: { match: { ...match, bossHp: 90000 } } });
    a.c.send({ t: 'ping', id: 2, clientTime: 0 });
    await a.c.next('pong', (m) => m.id === 2);
    const late = await connect(h);
    late.mirrored = true;
    hello(late, 'late watcher');
    await late.next('welcome');
    expect((await late.next('matchStart', undefined, 15000)).options.match?.bossHp).toBe(72500);
    expect(late.mirror!.world.boss).toMatchObject({ hp: 72000, maxHp: 72500 });
    expect(late.mirror!.world.drainEvents()).toEqual([]);

    stage = (world) => {
      world.boss!.hp = 0;
      world.boss!.deathAt = world.time - BOSS_DEATH_DURATION;
      world.boss!.action = 'dead';
      stage = null;
    };
    await a.c.next('lobby', (m) => m.lobby.phase === 'ended');
    a.c.take('lobby');
    a.c.send({ t: 'backToLobby' });
    const lobby = await a.c.next('lobby', (m) => m.lobby.phase === 'lobby');
    expect(lobby.lobby.settings.match?.bossHp).toBe(72500);
    a.c.send({ t: 'settings', settings: { match: { ...match, bossHp: 95000 } } });
    await a.c.next('lobby', (m) => m.lobby.settings.match?.bossHp === 95000);
    a.c.send({ t: 'start' });
    const restart = await a.c.next('matchStart', undefined, 15000);
    expect(restart.options.match?.bossHp).toBe(95000);
    expect(restart.snapshot.time).toBe(0);
    expect(a.c.mirror!.world.boss).toBeNull();
    stage = (world) => { world.time = 90 - SIM_DT / 2; world.tide.nextAt = Infinity; stage = null; };
    await until(() => {
      a.c.mirror!.catchUp();
      return a.c.mirror!.world.boss?.hp === 95000;
    }, 'the new Boss HP choice after restart');
    expect(a.c.mirror!.world.boss?.maxHp).toBe(95000);
  });
});
