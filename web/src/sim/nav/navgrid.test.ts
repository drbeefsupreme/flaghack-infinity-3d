import { describe, expect, it } from 'vitest';
import { CAMP_CENTERS, MAP_HALF } from '../constants';
import { footprintDistance, generateMap } from '../map/mapgen';
import type { MapLayout, Obstacle } from '../map/mapgen';
import type { V2 } from '../math';
import { Rng } from '../rng';
import { NAV_PAD, NavGrid } from './navgrid';

function layoutOf(obstacles: Obstacle[]): MapLayout {
  return {
    seed: 'test',
    half: MAP_HALF,
    camps: [],
    obstacles,
    roads: [],
    water: [],
    mud: [],
    soundCamps: [],
    pileSpots: [],
    neutralSpawns: [],
    effigy: { x: 0, z: 0 },
    isBlockedAt: () => false,
    groundAt: () => 'grass',
  };
}

function box(id: number, x: number, z: number, hx: number, hz: number, yaw = 0): Obstacle {
  return { id, kind: 'stage', x, z, shape: 'box', radius: Math.hypot(hx, hz), hx, hz, yaw, height: 3, seed: 0, color: 0, variant: 0 };
}

function length(from: V2, path: V2[]): number {
  let len = 0;
  let prev = from;
  for (const p of path) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return len;
}

/** Every leg of the path is a clear straight line on the grid. */
function legsClear(nav: NavGrid, from: V2, path: V2[]): boolean {
  let prev = from;
  for (const p of path) {
    if (!nav.lineOfSight(prev.x, prev.z, p.x, p.z)) return false;
    prev = p;
  }
  return true;
}

describe('NavGrid', () => {
  it('paths around a static obstacle with clear, padded legs', () => {
    const wall = box(0, 0, 0, 1, 20, 0.3);
    const nav = NavGrid.fromMap(layoutOf([wall]));
    expect(nav.w).toBe(200);
    expect(nav.isWalkable(0, 0)).toBe(false);
    expect(nav.lineOfSight(-20, 0, 20, 0)).toBe(false);
    const from = { x: -20, z: 0 };
    const path = nav.findPath(from.x, from.z, 20, 0);
    expect(path).not.toBeNull();
    if (!path) return;
    expect(path[path.length - 1]).toEqual({ x: 20, z: 0 });
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path.length).toBeLessThan(6);
    expect(legsClear(nav, from, path)).toBe(true);
    for (const p of path) expect(footprintDistance(wall, p.x, p.z)).toBeGreaterThanOrEqual(NAV_PAD);
    // Around the end of the 40 m wall: never shorter than the true shortest route past its
    // corners (≈ 56.5 m), and grid detours stay modest.
    const len = length(from, path);
    expect(len).toBeGreaterThan(56);
    expect(len).toBeLessThan(65);
  });

  it('routes around a dynamic wall, finds it on the straight line, and forgets it on unblock', () => {
    const nav = new NavGrid(MAP_HALF, 1.5);
    const from = { x: -20, z: 0 };
    expect(nav.findPath(from.x, from.z, 20, 0)).toEqual([{ x: 20, z: 0 }]);
    const v0 = nav.version;
    nav.blockSegment(0, -15, 0, 15, 0.2, 42);
    expect(nav.version).toBeGreaterThan(v0);
    expect(nav.isWalkable(0, 0)).toBe(false);
    expect(nav.isWalkable(0.2 + NAV_PAD + 1.5, 0)).toBe(true);
    const path = nav.findPath(from.x, from.z, 20, 0);
    expect(path).not.toBeNull();
    if (!path) return;
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(legsClear(nav, from, path)).toBe(true);
    expect(length(from, path)).toBeGreaterThan(45);
    expect(nav.blockerOnSegment(-20, 0, 20, 0)).toBe(42);
    expect(nav.blockerOnSegment(-20, 20, 20, 20)).toBe(-1);
    // Raiders plan straight through walls, then ask which one is in the way.
    expect(nav.findPath(from.x, from.z, 20, 0, { ignoreDynamic: true })).toEqual([{ x: 20, z: 0 }]);

    nav.unblock(42);
    expect(nav.findPath(from.x, from.z, 20, 0)).toEqual([{ x: 20, z: 0 }]);
    expect(nav.blockerOnSegment(-20, 0, 20, 0)).toBe(-1);
    expect(nav.isWalkable(0, 0)).toBe(true);
  });

  it('reports the first blocker crossed, the top one where registrations overlap', () => {
    const nav = NavGrid.fromMap(layoutOf([box(0, 0, 10, 2, 2)]));
    nav.blockCircle(0, 0, 2, 7);
    nav.blockSegment(-5, 0, 5, 0, 0.2, 9);
    nav.blockSegment(-5, 0, 5, 0, 0.2, 10);
    // From the south the circle's rim comes first; along the walls' own line the latest wall.
    expect(nav.blockerOnSegment(0, -10, 0, 10)).toBe(7);
    expect(nav.blockerOnSegment(-10, 0, 10, 0)).toBe(10);
    nav.unblock(10);
    expect(nav.blockerOnSegment(-10, 0, 10, 0)).toBe(9);
    nav.unblock(9);
    nav.unblock(7);
    expect(nav.blockerOnSegment(0, -10, 0, 10)).toBe(-1);
    expect(nav.isWalkable(0, 0)).toBe(true);
    // A blocker over static ground: unblocking leaves the static obstacle in place.
    nav.blockCircle(0, 10, 4, 11);
    nav.unblock(11);
    expect(nav.isWalkable(0, 10)).toBe(false);
    expect(nav.isWalkable(0, 16)).toBe(true);
  });

  it('returns partial paths toward sealed goals and snaps blocked endpoints', () => {
    const nav = new NavGrid(MAP_HALF, 1.5);
    // A closed square pen of walls around (30, 0).
    nav.blockSegment(25, -5, 35, -5, 0.2, 1);
    nav.blockSegment(35, -5, 35, 5, 0.2, 2);
    nav.blockSegment(35, 5, 25, 5, 0.2, 3);
    nav.blockSegment(25, 5, 25, -5, 0.2, 4);
    expect(nav.findPath(0, 0, 30, 0)).toBeNull();
    const partial = nav.findPath(0, 0, 30, 0, { partial: true, maxIter: 3000 });
    expect(partial).not.toBeNull();
    if (!partial) return;
    // Ends on open ground beside the pen; the wall between it and the goal is reported.
    const end = partial[partial.length - 1];
    expect(nav.isWalkable(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - 30, end.z)).toBeLessThan(9);
    expect([1, 2, 3, 4]).toContain(nav.blockerOnSegment(end.x, end.z, 30, 0));

    // Goal inside a building: the path ends on the nearest walkable cell beside it.
    nav.blockCircle(-30, 0, 3, 5);
    const toBuilding = nav.findPath(0, 0, -30, 0);
    expect(toBuilding).not.toBeNull();
    if (!toBuilding) return;
    const last = toBuilding[toBuilding.length - 1];
    expect(nav.isWalkable(last.x, last.z)).toBe(true);
    expect(Math.hypot(last.x + 30, last.z)).toBeLessThan(3 + NAV_PAD + 2.2);

    // Start inside a blocker: first waypoint steps out to walkable ground.
    const out = nav.findPath(-30, 0, -50, 0);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(nav.isWalkable(out[0].x, out[0].z)).toBe(true);
    expect(out[out.length - 1]).toEqual({ x: -50, z: 0 });

    const near = nav.nearestWalkable(-30, 0);
    expect(nav.isWalkable(near.x, near.z)).toBe(true);
    expect(Math.hypot(near.x + 30, near.z)).toBeLessThan(3 + NAV_PAD + 2.2);
    expect(nav.nearestWalkable(10, 10)).toEqual({ x: 10, z: 10 });
  });

  it('plans cross-map paths on a real burn within budget', () => {
    const map = generateMap('alchemy');
    const nav = NavGrid.fromMap(map);
    const rng = new Rng('paths');
    const pick = (cx: number, cz: number): V2 => {
      for (;;) {
        const x = cx + rng.range(-40, 40);
        const z = cz + rng.range(-40, 40);
        if (nav.isWalkable(x, z)) return { x, z };
      }
    };
    const pairs: [V2, V2][] = [];
    for (let i = 0; i < 100; i++) {
      const a = CAMP_CENTERS[([0, 1, 2, 3] as const)[i % 4]];
      const b = CAMP_CENTERS[([2, 3, 0, 1] as const)[i % 4]];
      pairs.push([pick(a.x, a.z), pick(b.x * 0.9, b.z * 0.9)]);
    }
    let found = 0;
    const t0 = performance.now();
    for (const [a, b] of pairs) {
      const path = nav.findPath(a.x, a.z, b.x, b.z);
      if (path && legsClear(nav, a, path)) found++;
    }
    const avg = (performance.now() - t0) / pairs.length;
    expect(found).toBe(pairs.length);
    // Budget 1.5 ms per cross-map path; asserted loosely for noisy CI.
    expect(avg).toBeLessThan(4);
  });
});
