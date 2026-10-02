/**
 * 2.5D collision world for avatars, thrown Flags, pieces, buildings and static obstacles.
 * Ground is y = 0. Shapes are vertical extrusions (boxes/cylinders) or walkable slabs/ramps.
 * Owner: MapPhysics agent. Consumers: avatars, projectiles, pieces, buildings, render (debug).
 */
import type { V3 } from '../math';
import type { MapLayout } from '../map/mapgen';

export type ShapeId = number;

export interface MoveResult {
  onGround: boolean;
  hitWall: boolean;
  /** Height of the supporting surface under the character (0 = ground). */
  groundY: number;
}

export interface RayHit {
  dist: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  shape: ShapeId;
  /** Tag passed at registration (usually an entity id; static obstacles use -1 - obstacleId). */
  tag: number;
}

export class CollisionWorld {
  static fromMap(map: MapLayout): CollisionWorld {
    void map;
    return new CollisionWorld();
  }

  /** Vertical extrusion of an oriented rectangle (walls, buildings, tents). */
  addBox(cx: number, cz: number, hx: number, hz: number, yaw: number, y0: number, y1: number, tag: number): ShapeId {
    return -1;
  }

  /** Vertical cylinder (trees, posts, round buildings). */
  addCylinder(cx: number, cz: number, r: number, y0: number, y1: number, tag: number): ShapeId {
    return -1;
  }

  /** Flat walkable convex polygon whose top is at y (decks). Thickness extends downward. */
  addSlab(xs: number[], zs: number[], y: number, thickness: number, tag: number): ShapeId {
    return -1;
  }

  /**
   * Sloped walkable convex polygon (ramps). The polygon edge (lowA → lowB) sits at y0, the
   * opposite side at y1, linear in between.
   */
  addRamp(xs: number[], zs: number[], lowA: number, lowB: number, y0: number, y1: number, thickness: number, tag: number): ShapeId {
    return -1;
  }

  remove(id: ShapeId): void {}

  /**
   * Move a vertical-cylinder character by vel*dt with sliding, stepping (≤ stepHeight),
   * gravity-free (caller integrates gravity into vel.y). Mutates pos and vel.
   */
  moveCharacter(pos: V3, vel: V3, dt: number, radius: number, height: number, stepHeight: number): MoveResult {
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    pos.y += vel.y * dt;
    if (pos.y <= 0) {
      pos.y = 0;
      if (vel.y < 0) vel.y = 0;
      return { onGround: true, hitWall: false, groundY: 0 };
    }
    return { onGround: false, hitWall: false, groundY: 0 };
  }

  /** Highest walkable surface at (x, z) whose top is ≤ maxY (0 if none). */
  supportHeight(x: number, z: number, maxY: number): number {
    return 0;
  }

  /** Ray cast against all shapes and the ground plane. Direction need not be normalized. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    return null;
  }

  /** True if a circle (x, z, r) over vertical span [y0, y1] overlaps any blocking shape. */
  blockedCircle(x: number, z: number, r: number, y0: number, y1: number, ignoreTag?: number): boolean {
    return false;
  }

  tagOf(id: ShapeId): number {
    return -1;
  }
}
