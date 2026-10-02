/**
 * Pure Survey geometry over the Ley Lattice (no World dependency, unit-testable).
 * All arrays are indexed by lattice node/edge/facet id; faction values are 0..3, -1 = none.
 * Owner: Lattice agent.
 */
import type { Lattice } from './lattice';

/**
 * Implied Flag fractal. Given real Flag owners per node, compute effective holders
 * (real or implied). An implied Flag of F appears on a free, unblocked node that is the
 * exact midpoint (tolerance 1e-3·edge) of two nodes held by F; order = max(parent order)+1,
 * real Flags are order 0, up to `maxOrder`. Real Flags always win their node.
 */
export function computeHolders(
  lat: Lattice,
  realOwner: Int8Array,
  outHolder: Int8Array,
  outImpliedOwner: Int8Array,
  outImpliedOrder: Uint8Array,
  maxOrder: number,
): void {
  outHolder.set(realOwner);
  outImpliedOwner.fill(-1);
  outImpliedOrder.fill(0);
}

/** Ley Lines: edge owner when both endpoints share a holder. */
export function computeLeyLines(lat: Lattice, holder: Int8Array, out: Int8Array): void {
  out.fill(-1);
}

/** Crystallized facets: all four corners share a holder. */
export function computeCrystallized(lat: Lattice, holder: Int8Array, out: Int8Array): void {
  out.fill(-1);
}

/**
 * Enclosure for one faction: out[facet] = 1 when the facet cannot reach a boundary facet
 * through facet adjacency without crossing an edge whose edgeLey === faction.
 * Returns the number of enclosed facets.
 */
export function computeEnclosure(lat: Lattice, edgeLey: Int8Array, faction: number, out: Uint8Array): number {
  out.fill(0);
  return 0;
}

/** 5-fold star test: interior node with exactly five thick rhombi meeting at it. */
export function isStar(lat: Lattice, n: number): boolean {
  const node = lat.nodes[n];
  return !node.boundary && node.facets.length === 5 && node.facets.every((f) => lat.facets[f].thick);
}

/** All current 5-fold focus nodes. */
export function findFocusNodes(lat: Lattice): number[] {
  return lat.nodes.filter((n) => isStar(lat, n.id)).map((n) => n.id);
}

/** The five neighbour nodes of a focus (the pentacle). */
export function pentacleOf(lat: Lattice, focus: number): number[] {
  return lat.neighbors(focus);
}

/**
 * Critical nodes for an enclosure: real-Flag nodes of `faction` whose removal (recomputing
 * implied Flags) would make `facet` no longer enclosed. Ordered cheapest-to-break first
 * (fewest supporting ley lines). Used by HUD (highlight), hippie raids and AI defence.
 */
export function criticalNodes(lat: Lattice, realOwner: Int8Array, faction: number, facet: number, maxOrder: number): number[] {
  return [];
}

/** Ley Line edges bounding the enclosed component that contains `facet` (for VFX/HUD). */
export function enclosureBoundary(lat: Lattice, enclosed: Uint8Array, facet: number): number[] {
  return [];
}

/**
 * Perpendicular-space strain of a node: distance of its perp position outside the
 * canonical acceptance window for its index (0 inside). Unflipped nodes are 0.
 */
export function perpStrain(lat: Lattice, n: number): number {
  return 0;
}

/**
 * Phason susceptibility in [0, 1]: how close the node's perp position is to its window
 * boundary (1 = on/over the boundary). Tides prefer susceptible nodes.
 */
export function susceptibility(lat: Lattice, n: number): number {
  return 0;
}
