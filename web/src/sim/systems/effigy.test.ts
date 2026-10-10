import { describe, expect, it } from 'vitest';
import { AVATAR, SIM_DT } from '../constants';
import { EFFIGY_POLE_CONSUMED_AT, effigyPoleConsumed } from '../effigyBurn';
import { burnTime, normalizeMatch } from '../matchSettings';
import { createMatch } from '../setup';
import { Simulation } from '../simulation';
import type { MatchOptions } from '../types';
import { syncEffigyPole } from './effigy';

function options(): MatchOptions {
  return { seed: 'effigy-pole-clearance', difficulty: 'normal', humans: [0], mode: 'standard',
    match: normalizeMatch({ bossMode: false, days: 3, dayLength: 600, maxSignifiers: 0 }) };
}

describe('consumed effigy pole collision', () => {
  it('removes only the mast at completion, retaining the pedestal and original map/nav/lattice', () => {
    const world = createMatch(options());
    const effigy = world.map.obstacles.find((o) => o.kind === 'effigy')!;
    const originalMap = JSON.stringify(world.map);
    const originalBlocked = world.lattice.nodes.map((n) => n.blocked);
    const navVersion = world.nav.version;
    const originalPath = world.nav.findPath(-10, 0, 10, 0);
    const props = world.map.obstacles.filter((o) => o !== effigy);
    const originalHits = props.map((o) => world.collision.raycast(o.x, o.height + 2, o.z, 0, -1, 0, o.height + 3)?.tag);
    world.suddenDeath = true;
    world.time = burnTime(world.options) + EFFIGY_POLE_CONSUMED_AT - 0.001;
    syncEffigyPole(world);
    expect(world.collision.blockedCircle(0, 0, 0.3, 10, 12)).toBe(true);
    expect(world.collision.raycast(0, 40, 0, 0, -1, 0, 50)?.y).toBe(effigy.height);

    world.time += 0.001;
    syncEffigyPole(world);
    expect(world.collision.blockedCircle(0, 0, 0.3, 10, 12)).toBe(false);
    expect(world.collision.raycast(-2, 10, 0, 1, 0, 0, 4)).toBeNull();
    expect(world.collision.raycast(0, 40, 0, 0, -1, 0, 50)).toMatchObject({ tag: -1 - effigy.id, y: 3 });
    expect(world.collision.supportHeight(0, 0, 40)).toBe(3);
    expect(world.collision.blockedCircle(2, 0, 0.3, 0.2, 2)).toBe(true);
    const above = { x: -2, y: 4, z: 0 };
    expect(world.collision.moveCharacter(above, { x: 4, y: 0, z: 0 }, 1, AVATAR.radius, AVATAR.height, AVATAR.stepHeight).hitWall).toBe(false);
    expect(above.x).toBeCloseTo(2);
    const ground = { x: -5, y: 0, z: 0 };
    expect(world.collision.moveCharacter(ground, { x: 10, y: 0, z: 0 }, 1, AVATAR.radius, AVATAR.height, AVATAR.stepHeight).hitWall).toBe(true);
    expect(JSON.stringify(world.map)).toBe(originalMap);
    expect(world.nav.version).toBe(navVersion);
    expect(world.nav.findPath(-10, 0, 10, 0)).toEqual(originalPath);
    expect(world.map.isBlockedAt(0, 0)).toBe(true);
    expect(world.lattice.nodes.map((n) => n.blocked)).toEqual(originalBlocked);
    expect(world.lattice.version).toBe(0);
    expect(props.map((o) => world.collision.raycast(o.x, o.height + 2, o.z, 0, -1, 0, o.height + 3)?.tag)).toEqual(originalHits);
  });

  it('retains overlapping dynamic colliders and cannot remove recycled mast handles on repeat calls', () => {
    const world = createMatch(options());
    const mastId = world.collision.raycast(0, 40, 0, 0, -1, 0, 50)!.shape;
    const dynamic = world.collision.addCylinder(0, 0, 1, 7, 9, 987654);
    world.suddenDeath = true;
    world.time = burnTime(world.options) + EFFIGY_POLE_CONSUMED_AT;
    syncEffigyPole(world);
    expect(world.collision.raycast(0, 10, 0, 0, -1, 0, 11)?.tag).toBe(987654);
    const reused = world.collision.addCylinder(8, 0, 1, 0, 4, 987655);
    expect(reused).toBe(mastId);
    syncEffigyPole(world);
    world.time += 100;
    syncEffigyPole(world);
    expect(world.collision.raycast(8, 10, 0, 0, -1, 0, 11)?.tag).toBe(987655);
    expect(world.collision.raycast(0, 10, 0, 0, -1, 0, 11)?.tag).toBe(987654);
    world.collision.remove(dynamic);
    expect(world.collision.supportHeight(0, 0, 40)).toBe(3);
  });

  it('synchronizes ordinary ticks and catch-up without changing victory rules or unscheduled burns', () => {
    for (const suddenDeath of [false, true]) {
      const world = createMatch(options());
      world.suddenDeath = suddenDeath;
      world.time = burnTime(world.options) + EFFIGY_POLE_CONSUMED_AT - SIM_DT / 2;
      world.tide.nextAt = Infinity;
      new Simulation(world).step();
      expect(world.suddenDeath).toBe(true);
      expect(world.collision.blockedCircle(0, 0, 0.3, 10, 12)).toBe(false);
      expect(world.collision.supportHeight(0, 0, 40)).toBe(3);
      expect(world.phase).toBe('playing');
      expect(world.winner).toBeNull();
    }
    for (const opts of [options(), { ...options(), mode: 'tutorial' as const },
      { ...options(), match: normalizeMatch({ bossMode: false, days: 0 }) }]) {
      expect(effigyPoleConsumed({ options: opts, time: 1e6, suddenDeath: false })).toBe(false);
      if (opts.mode === 'tutorial' || opts.match!.days === 0) {
        expect(effigyPoleConsumed({ options: opts, time: 1e6, suddenDeath: true })).toBe(false);
      }
    }
  });
});
