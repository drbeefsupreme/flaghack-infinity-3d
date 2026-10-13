import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../constants';
import { spawnHippie } from '../../factory';
import { normalizeMatch } from '../../matchSettings';
import { NavGrid } from '../../nav/navgrid';
import { CollisionWorld } from '../../physics/collision';
import { createMatch } from '../../setup';
import type { World } from '../../world';
import { cmdOrder, updateHippies } from '../hippies';
import { beginTask, brainOf, releaseTask } from './brain';
import { locomote, moveTo, routeExhausted, servicePathQueue } from './move';
import { unitsState } from './state';

/** Real task systems on a small, deterministic open nav grid. */
function arena(): World {
  const world = createMatch({ seed: 'allied-navigation', difficulty: 'normal', humans: [0], mode: 'standard',
    match: normalizeMatch({ startingSignifiers: 0, maxSignifiers: 0, bossMode: false }) });
  world.nav = new NavGrid(40, 0.5);
  world.collision = new CollisionWorld();
  world.hippies.clear();
  const avatar = world.avatarOf(0);
  world.avatars.clear();
  world.avatars.set(avatar.id, avatar);
  avatar.pos = { x: 0, y: 0, z: 0 };
  avatar.yaw = 0;
  return world;
}

function tick(world: World, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / SIM_DT); i++) {
    world.time += SIM_DT;
    world.tick++;
    updateHippies(world, SIM_DT);
  }
}

describe('allied navigation', () => {
  it('recognizes a snapped path endpoint as blocked even less than three metres from the goal', () => {
    const world = arena();
    world.avatars.clear();
    world.nav.blockCircle(0, 0, 0.5, 99999);
    const h = spawnHippie(world, 0, { x: -8, z: 0 });
    const b = brainOf(h), sys = unitsState(world);
    moveTo(world, sys, h, b, 0, 0, 0.1);
    servicePathQueue(world, sys);
    const end = b.path!.at(-1)!;
    expect(Math.hypot(end.x, end.z)).toBeLessThan(3);
    expect(world.nav.isWalkable(end.x, end.z)).toBe(true);
    expect(b.route).toBe('blocked');
    for (let i = 0; i < 5 / SIM_DT && !routeExhausted(h, b); i++) {
      world.time += SIM_DT;
      moveTo(world, sys, h, b, 0, 0, 0.1);
      servicePathQueue(world, sys);
      locomote(world, sys, h, b, SIM_DT);
    }
    expect(routeExhausted(h, b)).toBe(true);
    expect(world.nav.isWalkable(h.pos.x, h.pos.z)).toBe(true);
  });

  it('replans when a nearby moving goal crosses behind an obstacle', () => {
    const world = arena();
    world.avatars.clear();
    world.nav.blockSegment(0, -3, 0, 3, 0.1, 99999);
    const h = spawnHippie(world, 0, { x: -5, z: 0 });
    const b = brainOf(h), sys = unitsState(world);
    moveTo(world, sys, h, b, -0.75, 0, 0.1);
    expect(b.route).toBe('direct');
    expect(world.nav.isWalkable(0.75, 0)).toBe(true);
    moveTo(world, sys, h, b, 0.75, 0, 0.1);
    expect(b.route).toBe('queued');
    servicePathQueue(world, sys);
    for (let i = 0; i < 10 / SIM_DT && !moveTo(world, sys, h, b, 0.75, 0, 0.2); i++) {
      world.time += SIM_DT;
      servicePathQueue(world, sys);
      locomote(world, sys, h, b, SIM_DT);
      expect(world.nav.isWalkable(h.pos.x, h.pos.z)).toBe(true);
    }
    expect(Math.hypot(h.pos.x - 0.75, h.pos.z)).toBeLessThan(0.3);
  });

  it('keeps every leg clear when refining a snapped endpoint near an obstacle corner', () => {
    const world = arena();
    world.avatars.clear();
    world.nav = new NavGrid(20, 1.5);
    world.nav.blockCircle(-2.5, 4.75, 0.625, 99998);
    const goal = { x: 7.5, z: 6.4 };
    world.nav.blockCircle(goal.x, goal.z, 0.2, 99999);
    const h = spawnHippie(world, 0, { x: -14.25, z: -1.3 });
    const b = brainOf(h), sys = unitsState(world);
    const original = world.nav.findPath(h.pos.x, h.pos.z, goal.x, goal.z, { partial: true })!;
    expect(original).toHaveLength(1);
    moveTo(world, sys, h, b, goal.x, goal.z, 0.1);
    servicePathQueue(world, sys);
    expect(b.path).toHaveLength(2);
    let previous = h.pos;
    for (const waypoint of b.path!) {
      expect(world.nav.lineOfSight(previous.x, previous.z, waypoint.x, waypoint.z)).toBe(true);
      previous = waypoint;
    }
    for (let i = 0; i < 10 / SIM_DT && !routeExhausted(h, b); i++) {
      world.time += SIM_DT;
      moveTo(world, sys, h, b, goal.x, goal.z, 0.1);
      servicePathQueue(world, sys);
      locomote(world, sys, h, b, SIM_DT);
      expect(world.nav.isWalkable(h.pos.x, h.pos.z)).toBe(true);
    }
    expect(routeExhausted(h, b)).toBe(true);
  });

  it('settles followers on walkable ground when a formation slot lies inside a prop', () => {
    const world = arena();
    const avatar = world.avatarOf(0);
    const a = Math.PI - 2.5 * 0.45;
    const goal = { x: Math.sin(a) * 2.6, z: Math.cos(a) * 2.6 };
    world.nav.blockCircle(goal.x, goal.z, 0.8, 99999);
    const h = spawnHippie(world, 0, { x: -10, z: 0 });
    cmdOrder(world, { t: 'order', faction: 0, hippies: [h.id], order: { kind: 'follow', avatarId: avatar.id } });
    tick(world, 12);
    expect(h.order?.kind).toBe('follow');
    expect(h.status).toBe('following');
    expect(world.nav.isWalkable(h.pos.x, h.pos.z)).toBe(true);
    expect(brainOf(h).moving).toBe(false);
    expect(Math.hypot(h.pos.x - avatar.pos.x, h.pos.z - avatar.pos.z)).toBeLessThan(5);
  });

  it('keeps distinct formation positions after an interrupted follow order resumes', () => {
    const world = arena();
    const avatar = world.avatarOf(0);
    const crowd = Array.from({ length: 6 }, (_, i) => spawnHippie(world, 0, { x: -8 + i, z: -8 }));
    cmdOrder(world, { t: 'order', faction: 0, hippies: crowd.map(h => h.id), order: { kind: 'follow', avatarId: avatar.id } });
    tick(world, 0.5);
    const original = crowd.map(h => ({ x: brainOf(h).goalX, z: brainOf(h).goalZ }));
    expect(new Set(original.map(p => `${p.x},${p.z}`)).size).toBe(crowd.length);
    for (const h of crowd) {
      const b = brainOf(h);
      beginTask(world, h, b, 'engage');
      releaseTask(world, h, b);
    }
    tick(world, SIM_DT);
    expect(crowd.map(h => ({ x: brainOf(h).goalX, z: brainOf(h).goalZ }))).toEqual(original);
    tick(world, 8);
    for (const h of crowd) {
      expect(h.order?.kind).toBe('follow');
      expect(brainOf(h).moving).toBe(false);
    }
  });
});
