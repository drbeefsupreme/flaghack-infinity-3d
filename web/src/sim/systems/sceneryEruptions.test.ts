import { describe, expect, it } from 'vitest';
import { createMatch } from '../setup';
import { groundHeight } from '../terrain';
import { crushScenery, destroySceneryBlast, destroySceneryHit, syncScenery } from './scenery';

const kinds = ['tent', 'dome', 'art', 'porta', 'tree', 'rock', 'stage', 'shade', 'car'] as const;

describe('per-prop scenery destruction facts', () => {
  it.each(['hit', 'foot', 'blast'] as const)('%s emits one grounded, dimensioned event per new prop, preserving aggregate audio', method => {
    const world = createMatch({ seed: 'scenery-eruptions', difficulty: 'normal', mode: 'standard', humans: [0] });
    const props = kinds.map(kind => world.map.obstacles.find(o => o.kind === kind)!);
    const effigy = world.map.obstacles.find(o => o.kind === 'effigy')!;
    world.map.obstacles = [...props, effigy];
    world.drainEvents();
    for (const prop of props) {
      const destroy = () => method === 'hit' ? destroySceneryHit(world, -1 - prop.id) : method === 'foot'
        ? crushScenery(world, prop, prop, 0) : destroySceneryBlast(world,
          { x: prop.x, y: groundHeight(prop.x, prop.z, world.map.half), z: prop.z }, 0);
      expect(destroy()).toBeTruthy();
      const events = world.drainEvents(), effects = events.filter(e => e.t === 'sceneryDestroyed');
      expect(effects).toEqual([{
        t: 'sceneryDestroyed', sceneryId: prop.id,
        pos: { x: prop.x, y: groundHeight(prop.x, prop.z, world.map.half), z: prop.z },
        size: { x: (prop.shape === 'circle' ? prop.radius : prop.hx) * 2,
          y: prop.height, z: (prop.shape === 'circle' ? prop.radius : prop.hz) * 2 }, yaw: prop.yaw,
      }]);
      expect(events.filter(e => e.t === 'sceneryCrushed')).toEqual([{ t: 'sceneryCrushed', pos: { x: prop.x, z: prop.z }, count: 1 }]);
      expect(destroy()).toBeFalsy(); syncScenery(world);
      expect(world.drainEvents()).toEqual([]);
    }
    expect(destroySceneryHit(world, -1 - effigy.id)).toBe(false);
    expect(crushScenery(world, effigy, effigy, 0)).toBe(0);
    expect(destroySceneryBlast(world, { x: effigy.x, y: 0, z: effigy.z }, 1)).toBe(0);
    expect(world.drainEvents()).toEqual([]);
  });

  it('a mass removal emits one fact for every prop but still just one sound batch', () => {
    const world = createMatch({ seed: 'scenery-eruptions-mass', difficulty: 'normal', mode: 'standard', humans: [0] });
    world.drainEvents();
    const expected = world.map.obstacles.filter(o => o.kind !== 'effigy').map(o => o.id);
    const version = world.nav.version;
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 10000)).toBe(expected.length);
    const events = world.drainEvents();
    expect(events.filter(e => e.t === 'sceneryDestroyed').map(e => e.sceneryId)).toEqual(expected);
    expect(events.filter(e => e.t === 'sceneryCrushed')).toEqual([{ t: 'sceneryCrushed', pos: { x: 0, z: 0 }, count: expected.length }]);
    expect(world.nav.version).toBe(version + 1);
    expect(crushScenery(world, { x: 0, z: 0 }, { x: 0, z: 0 }, 10000)).toBe(0);
    expect(world.drainEvents()).toEqual([]);
  });
});
