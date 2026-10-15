import { expect, it } from 'vitest';
import { createMatch } from '../sim/setup';
import { normalizeMatch } from '../sim/matchSettings';
import { damageMelee } from '../sim/systems/meleeImpact';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
it('replicates each melee contact with damage once to both mirrors and never replays it on late join', () => {
  const w = createMatch({ seed: 'melee-net', mode: 'standard', difficulty: 'normal', humans: [0,1], match: normalizeMatch({ maxSignifiers: 0 }) });
  w.drainEvents(); const encoder = new SnapshotEncoder(w);
  const mirrors = [0,1].map(() => NetMirror.create(w.options, wire(encoder.full())));
  w.tick++; w.time += .1;
  damageMelee(w, w.avatarOf(1).id, 20, w.avatarOf(0).id);
  const events = w.drainEvents(); expect(events.filter(e => e.t === 'meleeImpact')).toHaveLength(1);
  const frame = wire({ tick: w.tick, time: w.time, acks: {}, delta: encoder.delta(events), events });
  for (const mirror of mirrors) {
    mirror.push(frame); mirror.catchUp();
    expect(mirror.world.drainEvents()).toEqual(events);
    expect(mirror.world.avatarOf(1).hp).toBe(w.avatarOf(1).hp);
    mirror.push(frame); mirror.catchUp(); expect(mirror.world.drainEvents()).toEqual([]);
  }
  const late = NetMirror.create(w.options, wire(encoder.full()));
  expect(late.world.drainEvents()).toEqual([]); expect(late.world.avatarOf(1).hp).toBe(w.avatarOf(1).hp);
});
