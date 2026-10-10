import { describe, expect, it } from 'vitest';
import { AVATAR, SIM_DT } from '../constants';
import { EFFIGY_BOSS_REVEAL_AT, bossRevealEnabled, bossRevealTime } from '../effigyBurn';
import { burnTime, endTime, normalizeMatch } from '../matchSettings';
import { createMatch } from '../setup';
import { Simulation } from '../simulation';
import type { MatchOptions } from '../types';
import { canPlaceBuilding } from './buildings';
import { canBuildPiece } from './pieces';
import { polygonClearance, segmentClearance } from './econ/clearance';
import { syncEffigy, updateEffigy } from './effigy';
import { updateVictory } from './victory';

const options = (patch = {}): MatchOptions => ({
  seed: 'boss-reveal', difficulty: 'normal', humans: [0], mode: 'standard',
  match: normalizeMatch({ maxSignifiers: 0, ...patch }),
});

describe('authoritative boss reveal', () => {
  it('transitions once exactly 90 seconds after The Burn and keeps the scheduled time after skipped ticks', () => {
    for (const skip of [0, 27, 1000]) {
      const world = createMatch(options());
      world.suddenDeath = true;
      const at = burnTime(world.options) + EFFIGY_BOSS_REVEAL_AT;
      expect(bossRevealTime(world.options)).toBe(at);
      world.time = at - 0.001;
      updateEffigy(world);
      expect(world.effigyRevealedAt).toBeNull();
      expect(world.collision.supportHeight(0, 0, 40)).toBe(26);
      world.time = at + skip;
      updateEffigy(world);
      expect(world.effigyRevealedAt).toBe(at);
      const version = world.nav.version;
      world.time += 100;
      updateEffigy(world);
      expect(world.effigyRevealedAt).toBe(at);
      expect(world.nav.version).toBe(version);
    }
  });

  it('clears the full effigy collision, static nav and lattice while preserving other props and dynamic blockers', () => {
    const world = createMatch(options());
    const effigy = world.map.obstacles.find((o) => o.kind === 'effigy')!;
    const originalMap = JSON.stringify(world.map);
    const oldNodeBlocks = world.lattice.nodes.map((n) => n.blocked);
    const otherNodes = world.lattice.nodes.filter((n) => Math.hypot(n.x, n.z) > 8);
    const props = world.map.obstacles.filter((o) => o !== effigy);
    const propHits = props.map((o) => world.collision.raycast(o.x, o.height + 2, o.z, 0, -1, 0, o.height + 3)?.tag);
    expect(world.nav.isWalkable(0, 0)).toBe(false);
    expect(world.lattice.nodes[world.lattice.omegaNode].blocked).toBe(true);
    const originalCollision = world.collision;
    const originalNav = world.nav;
    const version = world.nav.version;
    // Exercise components once before rebuilding so stale cache invalidation is covered.
    world.nav.findPath(-12, 0, 12, 0);
    world.nav.findPath(-12, 0, 12, 0, { ignoreDynamic: true });
    const overlappingShape = world.collision.addCylinder(2, 0, 0.7, 0, 5, 87651);
    world.nav.blockCircle(2, 0, 0.7, 87651);
    world.nav.blockSegment(-3, -4, 3, -4, 0.2, 87652);
    world.suddenDeath = true;
    world.time = bossRevealTime(world.options);
    updateEffigy(world);
    expect(world.collision).toBe(originalCollision);
    expect(world.nav).toBe(originalNav);
    expect(world.nav.version).toBeGreaterThan(version);
    expect(world.collision.blockedCircle(0, 0, 0.2, 10, 12)).toBe(false);
    expect(world.collision.supportHeight(0, 0, 40)).toBe(0);
    expect(world.collision.raycast(0, 40, 0, 0, -1, 0, 50)).toMatchObject({ tag: 0, y: 0 });
    expect(world.collision.raycast(2, 40, 0, 0, -1, 0, 50)).toMatchObject({ tag: 87651, y: 5 });
    expect(world.nav.isWalkable(2, 0)).toBe(false);
    expect(world.nav.isWalkable(0, -4)).toBe(false);
    expect(world.nav.blockerOnSegment(2, -2, 2, 2)).toBe(87651);
    expect(world.map.isBlockedAt(0, 0)).toBe(false);
    expect(world.lattice.isBlockedAt(0, 0)).toBe(false);
    expect(world.lattice.nodes[world.lattice.omegaNode].blocked).toBe(false);
    expect(world.lattice.nodes.map((n) => n.blocked)).not.toEqual(oldNodeBlocks);
    expect(otherNodes.every((n) => n.blocked === oldNodeBlocks[n.id])).toBe(true);
    expect(props.map((o) => world.collision.raycast(o.x, o.height + 2, o.z, 0, -1, 0, o.height + 3)?.tag)).toEqual(propHits);
    expect(JSON.stringify(world.map)).toBe(originalMap);
    // Removing the dynamic blockers must expose the cleared ground, not a stale static mask.
    world.collision.remove(overlappingShape);
    world.nav.unblock(87651);
    world.nav.unblock(87652);
    expect(world.nav.isWalkable(0, 0)).toBe(true);
    expect(world.nav.lineOfSight(-5, 0, 5, 0)).toBe(true);
    expect(world.nav.findPath(-5, 0, 5, 0)).toEqual([{ x: 5, z: 0 }]);
    expect(world.nav.findPath(-5, 0, 5, 0, { ignoreDynamic: true })).toEqual([{ x: 5, z: 0 }]);
    const pos = { x: -5, y: 0, z: 0 };
    expect(world.collision.moveCharacter(pos, { x: 10, y: 0, z: 0 }, 1, AVATAR.radius, AVATAR.height, AVATAR.stepHeight).hitWall).toBe(false);
    expect(pos.x).toBeCloseTo(5);
    // Retired shape handles may now be recycled; repeat syncs must never remove them.
    world.collision.addCylinder(0, 0, 1, 0, 6, 87653);
    const stableVersion = world.nav.version;
    syncEffigy(world);
    updateEffigy(world);
    expect(world.collision.supportHeight(0, 0, 40)).toBe(6);
    expect(world.nav.version).toBe(stableVersion);
  });

  it('permits construction through the cleared crater while retaining ordinary static-prop checks', () => {
    const world = createMatch(options({ gridScale: 6 }));
    const omega = world.lattice.nodes[world.lattice.omegaNode];
    const edge = omega.edges[0];
    const facet = world.lattice.facets[omega.facets[0]];
    world.avatarOf(0).pos = { x: 0, y: 0, z: 0 };
    world.factions[0].lumber = 1000;
    world.survey.facetSurvey[facet.id] = 1;
    const squareX = [-1, 1, 1, -1];
    const squareZ = [-1, -1, 1, 1];
    expect(segmentClearance(world, -2, 0, 2, 0, 0.1, 0)).toBe('obstacle');
    expect(polygonClearance(world, squareX, squareZ, 0)).toBe('obstacle');
    expect(canBuildPiece(world, 0, 'wall', edge, -1, 0, 0).ok).toBe(false);
    expect(canBuildPiece(world, 0, 'floor', -1, facet.id, 0, 0).ok).toBe(false);
    expect(canPlaceBuilding(world, 0, 'workshop', facet.id).ok).toBe(false);
    const prop = world.map.obstacles.find((o) => o.kind !== 'effigy' && o.height > 1)!;
    const beforeProp = segmentClearance(world, prop.x, prop.z, prop.x, prop.z, 0.1, 0);
    world.suddenDeath = true;
    world.time = bossRevealTime(world.options);
    updateEffigy(world);
    expect(segmentClearance(world, -2, 0, 2, 0, 0.1, 0)).toBe('clear');
    expect(polygonClearance(world, squareX, squareZ, 0)).toBe('clear');
    expect(canBuildPiece(world, 0, 'wall', edge, -1, 0, 0).ok).toBe(true);
    expect(canBuildPiece(world, 0, 'floor', -1, facet.id, 0, 0).ok).toBe(true);
    expect(canPlaceBuilding(world, 0, 'workshop', facet.id).ok).toBe(true);
    expect(segmentClearance(world, prop.x, prop.z, prop.x, prop.z, 0.1, 0)).toBe(beforeProp);
  });

  it('excludes tutorial, explicit attract opt-out, unscheduled Burn and matches already ended', () => {
    const cases = [
      { ...options(), mode: 'tutorial' as const },
      { ...options({ bossMode: false }), humans: [] },
      options({ days: 0 }),
    ];
    for (const opts of cases) {
      const world = createMatch(opts);
      world.suddenDeath = true;
      world.time = 1e6;
      updateEffigy(world);
      expect(world.effigyRevealedAt).toBeNull();
      expect(world.map.isBlockedAt(0, 0)).toBe(true);
      expect(world.nav.isWalkable(0, 0)).toBe(false);
    }
    const ended = createMatch(options());
    ended.phase = 'ended';
    ended.suddenDeath = true;
    ended.time = bossRevealTime(ended.options) + 100;
    updateEffigy(ended);
    expect(ended.effigyRevealedAt).toBeNull();
    const waiting = createMatch(options());
    waiting.time = bossRevealTime(waiting.options);
    updateEffigy(waiting);
    expect(waiting.effigyRevealedAt).toBeNull();
    expect(bossRevealEnabled({ ...options(), humans: [] })).toBe(true);
  });

  it('resolves the reveal during a normal step and when a skipped clock starts the Burn late', () => {
    for (const suddenDeath of [false, true]) {
      const world = createMatch(options());
      world.suddenDeath = suddenDeath;
      world.tide.nextAt = Infinity;
      world.time = bossRevealTime(world.options) - SIM_DT / 2;
      new Simulation(world).step();
      expect(world.suddenDeath).toBe(true);
      expect(world.effigyRevealedAt).toBe(bossRevealTime(world.options));
      expect(world.collision.supportHeight(0, 0, 40)).toBe(0);
    }
  });

  it('keeps the minimum-length boss encounter running after Dawn and conquest, without changing non-boss endings', () => {
    const world = createMatch(options({ dayLength: 300 }));
    expect(burnTime(world.options)).toBe(140);
    expect(bossRevealTime(world.options)).toBe(230);
    expect(endTime(world.options)).toBe(300);
    world.time = 230;
    updateVictory(world, 0);
    expect(world.effigyRevealedAt).toBe(230);
    world.time = 300;
    updateVictory(world, 0);
    expect(world.phase).toBe('playing');
    expect(world.winner).toBeNull();
    for (const faction of world.factions.slice(1)) faction.hearthIds.length = 0;
    updateVictory(world, 0);
    expect(world.phase).toBe('playing');
    expect(world.drainEvents().some((e) => e.t === 'victory')).toBe(false);
    const early = createMatch(options());
    for (const faction of early.factions.slice(1)) faction.hearthIds.length = 0;
    updateVictory(early, 0);
    expect(early.phase).toBe('ended');
    for (const ending of ['dawn', 'conquest']) {
      const legacy = createMatch(options({ bossMode: false, dayLength: 300 }));
      legacy.time = ending === 'dawn' ? 300 : 230;
      if (ending === 'conquest') for (const faction of legacy.factions.slice(1)) faction.hearthIds.length = 0;
      updateVictory(legacy, 0);
      expect(legacy.effigyRevealedAt).toBeNull();
      expect(legacy.phase).toBe('ended');
      expect(legacy.drainEvents().find((e) => e.t === 'victory')).toMatchObject({ reason: ending });
    }
  });
});
