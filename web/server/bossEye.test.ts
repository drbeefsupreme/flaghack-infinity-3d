/** Production WebSocket path; stage the encounter and clock, but use the real simulation to fire. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR, SIM_DT } from '../src/sim/constants';
import { bossRevealTime } from '../src/sim/effigyBurn';
import { spawnFlag } from '../src/sim/factory';
import { normalizeMatch } from '../src/sim/matchSettings';
import { CollisionWorld } from '../src/sim/physics/collision';
import { Simulation } from '../src/sim/simulation';
import { spawnBoss } from '../src/sim/systems/boss';
import { dropLoose, giveFlag } from '../src/sim/systems/flags';
import type { World } from '../src/sim/world';
import { cleanup, connect, hello, host, join, until } from './testkit';
import type { Client } from './testkit';

let stage: ((world: World) => void) | null = null;
afterEach(async () => { await cleanup(); vi.restoreAllMocks(); stage = null; });

function catchUp(clients: Client[]) { for (const client of clients) client.mirror!.catchUp(); }
function damageEvents(client: Client, targetId: number) {
  return client.frames.flatMap(frame => frame.events).filter(e => (e.t === 'hit' && e.target === targetId) || (e.t === 'ko' && e.id === targetId));
}

describe('boss eye over real host sockets', () => {
  it('synchronizes two players and mid-charge/beam late joins with exactly one host blast', async () => {
    const original = Simulation.prototype.step;
    vi.spyOn(Simulation.prototype, 'step').mockImplementation(function(this: Simulation) {
      stage?.(this.world); original.call(this);
    });
    const h = await host(), alice = await join(h, 'alice'), bob = await join(h, 'bob');
    alice.c.mirrored = bob.c.mirrored = true;
    alice.c.send({ t: 'settings', settings: { seed: 'boss-eye-socket', match: normalizeMatch({ days: 0, maxSignifiers: 0 }) } });
    await alice.c.next('lobby', message => message.lobby.settings.seed === 'boss-eye-socket');
    alice.c.send({ t: 'start' });
    await Promise.all([alice.c.next('matchStart', undefined, 15000), bob.c.next('matchStart', undefined, 15000)]);
    const players = [alice.c, bob.c];
    let staged = false, phase: 'charge' | 'beam' | 'cooldown' = 'charge', authoritative: World | null = null;
    let chargedAt = 0, targetId = -1, flagId = -1, survivorPlaced = false;
    stage = world => {
      authoritative = world;
      const reveal = bossRevealTime(world.options);
      chargedAt = reveal + 27;
      world.time = chargedAt + (phase === 'charge' ? 0 : phase === 'beam' ? 3 : 3.6) - SIM_DT;
      world.tide.nextAt = Infinity;
      if (!staged) {
        staged = true; world.effigyRevealedAt = reveal; world.suddenDeath = true;
        const boss = spawnBoss(world)!;
        boss.action = 'idle'; boss.actionAt = world.time; boss.pos = { x: 0, z: 0 }; boss.yaw = 0;
        // A clear test lane isolates the weapon from the random map's decorations.
        world.collision = new CollisionWorld();
        const target = world.avatarOf(0); targetId = target.id;
        target.pos = { x: 0, y: 0, z: 40 }; target.vel = { x: 0, y: 0, z: 0 };
        for (const id of [...target.carried]) dropLoose(world, id, { x: 100, y: 0, z: 100 });
        const flag = spawnFlag(world, { state: 'loose', owner: 0, pos: { ...target.pos } }); flagId = flag.id;
        expect(giveFlag(world, flag.id, target.id)).toBe(true);
        boss.target = { kind: 'avatar', id: target.id }; boss.retaliateId = target.id; boss.retaliateUntil = world.time + 100;
      }
      if (phase === 'beam' && world.boss!.eye.firedAt !== null && !survivorPlaced) {
        survivorPlaced = true;
        // Arriving after the shot must not be damaged by its remaining visual frames.
        const survivor = world.avatarOf(1);
        survivor.pos = { ...world.boss!.eye.impact! }; survivor.vel = { x: 0, y: 0, z: 0 };
      }
    };
    await until(() => {
      catchUp(players);
      return players.every(c => c.mirror!.world.boss?.eye.chargeAt === chargedAt && c.mirror!.world.boss?.eye.firedAt === null);
    }, 'charged eye on both players');
    const chargeLate = await connect(h); chargeLate.mirrored = true; hello(chargeLate, 'charge watcher');
    await chargeLate.next('welcome'); await chargeLate.next('matchStart', undefined, 15000);
    const beforeFire = [...players, chargeLate];
    catchUp(beforeFire);
    for (const c of beforeFire) {
      expect(c.mirror!.world.boss!.eye).toMatchObject({ chargeAt: chargedAt, firedAt: null, origin: null, impact: null });
      expect(c.mirror!.world.avatarOf(0).hp).toBe(AVATAR.maxHp);
      expect(c.mirror!.world.flags.get(flagId)).toMatchObject({ state: 'carried', holder: targetId });
    }
    expect(chargeLate.mirror!.world.drainEvents()).toEqual([]);
    phase = 'beam';
    await until(() => {
      catchUp(beforeFire);
      return beforeFire.every(c => c.mirror!.world.boss?.eye.firedAt === chargedAt + 3 && c.mirror!.world.avatarOf(0).hp === 0);
    }, 'host eye blast on players and charge late join');
    await until(() => survivorPlaced && beforeFire.every(c => { c.mirror!.catchUp(); return Math.abs(c.mirror!.world.avatarOf(1).pos.z - 40) < .1; }), 'surviving late arrival in blast sphere');
    const beamLate = await connect(h); beamLate.mirrored = true; hello(beamLate, 'beam watcher');
    await beamLate.next('welcome'); await beamLate.next('matchStart', undefined, 15000);
    const all = [...beforeFire, beamLate]; catchUp(all);
    const shot = beamLate.mirror!.world.boss!.eye;
    expect(shot.firedAt).toBe(chargedAt + 3); expect(shot.nextFireAt).toBe(chargedAt + 33);
    expect(shot.origin!.y).toBeGreaterThan(10); expect(shot.impact).toEqual({ x: 0, y: 0, z: 40 });
    for (const c of all) {
      expect(c.mirror!.world.boss!.eye).toEqual(shot);
      expect(c.mirror!.world.avatarOf(0).hp).toBe(0); expect(c.mirror!.world.avatarOf(1).hp).toBe(AVATAR.maxHp);
      expect(c.mirror!.world.flags.get(flagId)).toMatchObject({ state: 'loose', holder: -1, owner: 0 });
      expect(c.mirror!.world.avatarOf(0).carried).not.toContain(flagId);
    }
    expect(beamLate.mirror!.world.drainEvents()).toEqual([]);
    for (const c of beforeFire) {
      expect(damageEvents(c, targetId).filter(e => e.t === 'hit')).toHaveLength(1);
      expect(damageEvents(c, targetId).filter(e => e.t === 'hit')).toMatchObject([{ amount: 1000 }]);
      expect(damageEvents(c, targetId).filter(e => e.t === 'ko')).toHaveLength(1);
    }
    expect(damageEvents(beamLate, targetId)).toHaveLength(0);
    phase = 'cooldown';
    await until(() => { catchUp(all); return all.every(c => c.mirror!.world.boss?.eye.chargeAt === null); }, 'beam expiry on every socket');
    for (const c of all) {
      expect(c.mirror!.world.boss!.eye.origin).toBeNull(); expect(c.mirror!.world.boss!.eye.impact).toBeNull();
      expect(c.mirror!.world.avatarOf(1).hp).toBe(AVATAR.maxHp);
    }
    expect(authoritative!.boss!.eye.nextFireAt).toBe(chargedAt + 33);
    for (const c of beforeFire) expect(damageEvents(c, targetId).filter(e => e.t === 'ko')).toHaveLength(1);
  }, 20000);
});
