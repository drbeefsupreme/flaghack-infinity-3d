import { expect, it } from 'vitest';
import { createAi } from '../ai';
import { SIM_HZ } from '../sim/constants';
import type { GameEvent } from '../sim/events';
import { spawnFlag, spawnHippie } from '../sim/factory';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
import { CODECS } from './schema';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

it('replays allied orders deterministically and replicates recovery to live and late peers', () => {
  const runs = [0, 1].map(() => {
    const world = createMatch({ seed: 'allied-ai-replay', difficulty: 'normal', humans: [0], mode: 'standard',
      match: normalizeMatch({ maxSignifiers: 0, bossMode: false }) });
    const av = world.avatarOf(0);
    const followers = Array.from({ length: 6 }, (_, i) => spawnHippie(world, 0,
      world.nav.nearestWalkable(av.pos.x + i - 3, av.pos.z + 4)));
    const at = world.nav.nearestWalkable(av.pos.x + 12, av.pos.z + 4);
    const flag = spawnFlag(world, { state: 'loose', owner: 0, holder: -1,
      pos: { ...at, y: world.collision.groundHeight(at.x, at.z) } });
    world.submit({ t: 'order', faction: 0, hippies: followers.map(h => h.id), order: { kind: 'follow', avatarId: av.id } });
    const encoder = new SnapshotEncoder(world);
    const peer = NetMirror.create(world.options, wire(encoder.full()));
    return { world, sim: new Simulation(world), ai: createAi(world, [1, 2, 3]), encoder, peer, flag, followers,
      events: [] as GameEvent[] };
  });
  for (let tick = 0; tick < 30 * SIM_HZ; tick++) {
    for (const run of runs) {
      if (tick === 3 * SIM_HZ) run.world.submit({ t: 'order', faction: 0,
        hippies: run.followers.map(h => h.id), order: { kind: 'pull', flagId: run.flag.id } });
      run.ai.update();
      run.sim.step();
      run.events.push(...run.world.drainEvents());
      if (tick % 2 === 1) {
        const events = run.events.splice(0);
        run.peer.push(wire({ tick: run.world.tick, time: run.world.time, acks: {}, delta: run.encoder.delta(events), events }));
        run.peer.catchUp();
      }
    }
    if (tick % SIM_HZ === SIM_HZ - 1) expect(wire(runs[0].encoder.full())).toEqual(wire(runs[1].encoder.full()));
  }
  const { world, peer, encoder, flag } = runs[0];
  expect(flag.state).toBe('stock');
  const late = NetMirror.create(world.options, wire(encoder.full()));
  for (const mirror of [peer, late]) {
    for (const h of world.hippies.values()) {
      expect(CODECS.hippies.row(mirror.world, h.id)).toEqual(CODECS.hippies.row(world, h.id));
    }
    expect(mirror.world.flags.get(flag.id)?.state).toBe('stock');
  }
});
