/**
 * Survey planners shared by the player's Command View tools and NPC AI.
 * Owner: Lattice agent.
 */
import type { Lattice } from './lattice';

/** Cost of using a node in a plan: 0 = already ours, 1 = free node, Infinity = impassable. */
export type NodeCost = (node: number) => number;

export interface EncloseOptions {
  /** Point to enclose (e.g. an enemy Hearth centre). */
  x: number;
  z: number;
  /** Loop must keep at least this distance from (x, z) (stay outside defenders' ring). */
  minRadius: number;
  /** Optional cap: loop nodes farther than this are not considered. */
  maxRadius?: number;
  cost: NodeCost;
}

/**
 * Minimum-cost closed cycle of lattice edges enclosing (x, z): the cheapest set of nodes to
 * hold so the point's facet becomes enclosed. Returns the cycle's node ids in order (first
 * node not repeated) or null if none exists. Use the standard "cut-ray doubled graph"
 * shortest-path technique (a cycle encloses the point iff it crosses a ray from the point an
 * odd number of times).
 */
export function planEnclosure(lat: Lattice, opts: EncloseOptions): number[] | null {
  return null;
}

/** Home-expansion ring: a cheap enclosing loop at roughly `radius` around (x, z). */
export function planRing(lat: Lattice, x: number, z: number, radius: number, cost: NodeCost): number[] | null {
  return null;
}

/** Nodes to plan for a pentacle around a focus node (its five neighbours). */
export function planPentacle(lat: Lattice, focus: number): number[] {
  return lat.neighbors(focus);
}
