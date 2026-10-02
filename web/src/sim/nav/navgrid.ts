/**
 * Ground navigation grid for hippies (and AI avatar route planning).
 * Static blocking from the map; dynamic blocking from pieces (walls) and buildings, tracked
 * per blocker id so raiders can find what to tear down.
 * Owner: MapPhysics agent. Consumers: hippies, ai.
 */
import type { MapLayout } from '../map/mapgen';
import type { V2 } from '../math';

export interface PathOptions {
  /** Max A* expansions before giving up (returns best partial path toward goal if `partial`). */
  maxIter?: number;
  partial?: boolean;
  /** Treat dynamic blockers owned by this faction as passable? (never for walls). */
  ignoreDynamic?: boolean;
}

export class NavGrid {
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  readonly half: number;

  constructor(half: number, cell: number) {
    this.half = half;
    this.cell = cell;
    this.w = Math.ceil((2 * half) / cell);
    this.h = this.w;
  }

  static fromMap(map: MapLayout, cell = 1.5): NavGrid {
    return new NavGrid(map.half, cell);
  }

  /** Register a dynamic circular blocker (building). */
  blockCircle(x: number, z: number, r: number, blocker: number): void {}

  /** Register a dynamic segment blocker (wall) of given thickness. */
  blockSegment(ax: number, az: number, bx: number, bz: number, thickness: number, blocker: number): void {}

  /** Remove every cell registration of a dynamic blocker. */
  unblock(blocker: number): void {}

  isWalkable(x: number, z: number): boolean {
    return Math.abs(x) < this.half && Math.abs(z) < this.half;
  }

  /** Smoothed waypoint path (excluding start, including goal) or null if unreachable. */
  findPath(fromX: number, fromZ: number, toX: number, toZ: number, opts?: PathOptions): V2[] | null {
    return [{ x: toX, z: toZ }];
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    return true;
  }

  nearestWalkable(x: number, z: number): V2 {
    return { x, z };
  }

  /** First dynamic blocker id crossed by the straight segment a→b, or -1. */
  blockerOnSegment(ax: number, az: number, bx: number, bz: number): number {
    return -1;
  }
}
