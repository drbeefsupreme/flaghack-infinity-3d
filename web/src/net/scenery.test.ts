import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim/setup';
import { normalizeMatch } from '../sim/matchSettings';
import { destroySceneryHit } from '../sim/systems/scenery';
import { syncEffigy } from '../sim/systems/effigy';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('replicated scenery removal', () => {
  it('reconciles live mirrors, late joins and repeated frames without replaying destruction', () => {
    const host = createMatch({ seed: 'scenery-wire', difficulty: 'normal', humans: [0], mode: 'standard',
      match: normalizeMatch({ bossMode: true, maxSignifiers: 0 }) });
    host.effigyRevealedAt = 230; syncEffigy(host);
    const encoder = new SnapshotEncoder(host), mirror = NetMirror.create(host.options, wire(encoder.full()));
    const props = ['dome', 'shade', 'stage'].map(kind => host.map.obstacles.find(o => o.kind === kind)!);
    for (const prop of props) {
      destroySceneryHit(host, -1 - prop.id);
      host.tick++; host.time++;
      const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
      mirror.push(frame); mirror.catchUp();
      const late = NetMirror.create(host.options, wire(encoder.full()));
      for (const peer of [mirror, late]) {
        expect([...peer.world.destroyedScenery]).toEqual([...host.destroyedScenery].sort((a, b) => a - b));
        expect(peer.world.map.obstacles).toEqual(host.map.obstacles);
        expect(peer.world.map.isBlockedAt(0, 0)).toBe(false);
        for (const o of props.filter(o => host.destroyedScenery.has(o.id))) {
          expect(peer.world.collision.raycast(o.x, 60, o.z, 0, -1, 0, 70)?.tag).toBe(0);
          expect(peer.world.map.isBlockedAt(o.x, o.z)).toBe(false);
        }
        expect(peer.world.drainEvents()).toEqual([]);
      }
      const version = mirror.world.nav.version;
      mirror.push(frame); mirror.catchUp();
      expect(mirror.world.nav.version).toBe(version);
    }
  });
});
