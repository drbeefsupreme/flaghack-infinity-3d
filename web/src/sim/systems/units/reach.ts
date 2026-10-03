/**
 * Reach geometry for structures: the closest footprint point of a piece (inset wall segment,
 * deck/ramp rhombus) or building, and vertical spans. Used by staff swings and tearing.
 */
import { BUILDINGS, LEVEL_HEIGHT, PIECE } from '../../constants';
import type { Building, Piece } from '../../types';
import type { World } from '../../world';

/** Closest footprint point and horizontal distance from the query point (0 = inside). */
export interface ReachPoint {
  x: number;
  z: number;
  dist: number;
}

export interface Span {
  y0: number;
  y1: number;
}

/** Rough building height for melee reach (carts and Hearths are about head height). */
export const BUILDING_HEIGHT = 3;
const DECK_THICKNESS = 0.3;

function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number, out: ReachPoint): void {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t;
  out.z = az + dz * t;
  out.dist = Math.hypot(px - out.x, pz - out.z);
}

/** Closest point of a piece footprint to (x, z). Walls measure from their faces. */
export function pieceClosest(world: World, p: Piece, x: number, z: number, out: ReachPoint): void {
  const lat = world.lattice;
  if (p.kind === 'wall') {
    const e = lat.edges[p.edge];
    const a = lat.nodes[e.a];
    const b = lat.nodes[e.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const inset = PIECE.wallInset;
    closestOnSegment(x, z, a.x + ux * inset, a.z + uz * inset, b.x - ux * inset, b.z - uz * inset, out);
    out.dist = Math.max(0, out.dist - PIECE.wallThickness / 2);
    return;
  }
  const f = lat.facets[p.facet];
  let inside = true;
  let bestD = Infinity;
  let bx = x;
  let bz = z;
  for (let i = 0; i < 4; i++) {
    const a = lat.nodes[f.nodes[i]];
    const b = lat.nodes[f.nodes[(i + 1) % 4]];
    // Facet nodes are CCW: a point left of every edge is inside.
    if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) inside = false;
    closestOnSegment(x, z, a.x, a.z, b.x, b.z, out);
    if (out.dist < bestD) {
      bestD = out.dist;
      bx = out.x;
      bz = out.z;
    }
  }
  if (inside) {
    out.x = x;
    out.z = z;
    out.dist = 0;
  } else {
    out.x = bx;
    out.z = bz;
    out.dist = bestD;
  }
}

/** Vertical extent of a piece. */
export function pieceSpan(p: Piece, out: Span): void {
  const base = p.level * LEVEL_HEIGHT;
  if (p.kind === 'wall') {
    out.y0 = base;
    out.y1 = base + PIECE.wallHeight;
  } else if (p.kind === 'floor') {
    out.y0 = base - DECK_THICKNESS;
    out.y1 = base;
  } else {
    out.y0 = base;
    out.y1 = base + LEVEL_HEIGHT;
  }
}

/** Closest point of a building's round footprint to (x, z). */
export function buildingClosest(b: Building, x: number, z: number, out: ReachPoint): void {
  const r = BUILDINGS[b.kind].radius;
  const dx = x - b.pos.x;
  const dz = z - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= r) {
    out.x = x;
    out.z = z;
    out.dist = 0;
    return;
  }
  out.x = b.pos.x + (dx / d) * r;
  out.z = b.pos.z + (dz / d) * r;
  out.dist = d - r;
}
