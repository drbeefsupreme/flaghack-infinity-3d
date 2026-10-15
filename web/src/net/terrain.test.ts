import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim/setup';
import { groundHeight } from '../sim/terrain';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';

describe('terrain replication', () => {
  for (const seed of ['domed-camp', 'alchemy', 'terrain-network']) {
    it(`derives identical ground for authority and late join (${seed})`, () => {
      const host = createMatch({ seed, difficulty: 'normal', humans: [0], mode: 'standard' });
      const encoder = new SnapshotEncoder(host);
      const mirror = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
      for (const world of [host, mirror.world]) {
        expect(world.collision.groundHeight(world.map.effigy.x, world.map.effigy.z)).toBe(2);
        for (const [x, z] of [[0, 0], [40, -25], [-80, 32], [world.map.half, 0], [world.map.half, world.map.half]]) {
          expect(world.collision.groundHeight(x, z)).toBe(groundHeight(x, z, world.map.half));
          expect(world.collision.groundHeight(x, z)).toBe(host.collision.groundHeight(x, z));
        }
        for (const av of world.avatars.values()) {
          expect(av.pos.y).toBeCloseTo(world.collision.groundHeight(av.pos.x, av.pos.z), 2);
        }
        for (const f of world.flags.values()) if (f.state === 'planted') {
          expect(f.pos.y).toBeCloseTo(world.collision.groundHeight(f.pos.x, f.pos.z), 2);
        }
      }
    });
  }
});
