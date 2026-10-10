/** Production WebSocket host and real replicated clients, with only encounter staging accelerated. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../tests/bossFixture';
import { BOSS_DEATH_DURATION } from '../src/sim/boss';
import { bossRevealTime } from '../src/sim/effigyBurn';
import { normalizeMatch } from '../src/sim/matchSettings';
import { spawnHippie } from '../src/sim/factory';
import { Simulation } from '../src/sim/simulation';
import { updateBossOutcome } from '../src/sim/systems/victory';
import type { World } from '../src/sim/world';
import { cleanup, connect, hello, host, join, until } from './testkit';

let stage: ((w: World) => void) | null = null;
afterEach(async () => { await cleanup(); vi.restoreAllMocks(); stage = null; });

describe('boss over real host sockets', () => {
  it('keeps two players and a mid-grab late join aligned through airborne knockback, death and shared victory', async () => {
    const original = Simulation.prototype.step;
    vi.spyOn(Simulation.prototype, 'step').mockImplementation(function(this: Simulation) {
      original.call(this);
      stage?.(this.world);
    });
    const h = await host();
    const a = await join(h, 'alice');
    const b = await join(h, 'bob');
    a.c.mirrored = b.c.mirrored = true;
    a.c.send({ t: 'settings', settings: { seed: 'boss-socket', match: normalizeMatch({ maxSignifiers: 0 }) } });
    await a.c.next('lobby', (m) => m.lobby.settings.seed === 'boss-socket');
    a.c.send({ t: 'start' });
    await Promise.all([a.c.next('matchStart', undefined, 15000), b.c.next('matchStart', undefined, 15000)]);
    let hippieId = -1;
    const boss = bossFixture();
    stage = (w) => {
      w.effigyRevealedAt = bossRevealTime(w.options);
      w.time = Math.max(w.time, w.effigyRevealedAt + 15);
      w.boss = structuredClone(boss);
      w.boss.spawnedAt = w.effigyRevealedAt;
      w.boss.actionAt = w.time;
      if (hippieId < 0) hippieId = spawnHippie(w, 0, { x: 5, z: 6 }).id;
      const unit = w.hippies.get(hippieId)!;
      unit.airborne = { y: 6.25, vy: -3.5 };
    };
    const ready = () => {
      a.c.mirror!.catchUp(); b.c.mirror!.catchUp();
      return [a.c, b.c].every((c) => c.mirror?.world.boss?.action === 'grab');
    };
    await until(ready, 'boss grab on two clients');
    const late = await connect(h);
    late.mirrored = true;
    hello(late, 'late watcher');
    await late.next('welcome');
    await late.next('matchStart', undefined, 15000);
    for (const c of [a.c, b.c, late]) {
      c.mirror!.catchUp();
      expect(c.mirror!.world.boss).toMatchObject({ hp: boss.hp, action: 'grab', crouched: true,
        actionSeq: 8, hitSeq: 7, held: boss.held, barrier: boss.barrier, target: boss.target });
      expect(c.mirror!.world.hippies.get(hippieId)?.airborne).toEqual({ y: 6.25, vy: -3.5 });
    }
    stage = (w) => {
      const dead = structuredClone(boss);
      dead.hp = 0; dead.action = 'death'; dead.deathAt = w.time;
      dead.actionAt = w.time; dead.held = null;
      w.boss = dead;
    };
    await until(() => {
      for (const c of [a.c, b.c, late]) c.mirror!.catchUp();
      return [a.c, b.c, late].every((c) => c.mirror!.world.boss?.action === 'death');
    }, 'death on all clients');
    for (const c of [a.c, b.c, late]) expect(c.mirror!.world.phase).toBe('playing');
    stage = (w) => {
      w.boss!.action = 'dead';
      w.boss!.deathAt = w.time - BOSS_DEATH_DURATION;
      updateBossOutcome(w);
    };
    await until(() => {
      for (const c of [a.c, b.c, late]) c.mirror!.catchUp();
      return [a.c, b.c, late].every((c) => c.mirror!.world.phase === 'ended');
    }, 'shared boss victory');
    for (const c of [a.c, b.c, late]) {
      expect(c.mirror!.world.bossOutcome).toMatchObject({ kind: 'victory', winners: [0, 1, 2, 3] });
      expect(c.mirror!.world.winner).toBeNull();
    }
    // A fresh late join after match end gets the durable outcome without needing an event.
    const after = await connect(h);
    after.mirrored = true;
    hello(after, 'after victory');
    await after.next('welcome');
    await after.next('matchStart', undefined, 15000);
    expect(after.mirror!.world.bossOutcome).toEqual(a.c.mirror!.world.bossOutcome);
  }, 20000);
});
