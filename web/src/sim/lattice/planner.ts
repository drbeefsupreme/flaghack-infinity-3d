/**
 * Survey planners shared by the player's Command View tools and NPC AI.
 * Owner: Lattice agent.
 */
import type { Lattice } from './lattice';
import { latticeTopology } from './topology';

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

/** planRing's search band beyond `radius`, in edges, and the wider fallback band. */
const RING_BAND = 2.5;
const RING_BAND_WIDE = 6;
/**
 * Tie-break weight per metre from the target: among equal-cost loops the tightest wins.
 * Small enough that a whole map's worth of nodes never outweighs a single Flag.
 */
const TIGHTNESS = 1e-6;

// ── Scratch ──────────────────────────────────────────────────────────────────
// Grown on demand. States are (node, parity) packed as node * 2 + parity.

let weight = new Float64Array(0);
let crossing = new Uint8Array(0);
let dist = new Float64Array(0);
let priority = new Float64Array(0);
let prev = new Int32Array(0);
let seen = new Int32Array(0);
let heap = new Int32Array(0);
let heapPos = new Int32Array(0);
let heapLen = 0;
let runStamp = 0;
/** Per node position on the cycle-extraction stack (-1 between calls). */
let stackPos = new Int32Array(0);

function ensureScratch(nodeCount: number, edgeCount: number): void {
  if (crossing.length < edgeCount) crossing = new Uint8Array(edgeCount);
  if (weight.length >= nodeCount) return;
  weight = new Float64Array(nodeCount);
  dist = new Float64Array(nodeCount * 2);
  priority = new Float64Array(nodeCount * 2);
  prev = new Int32Array(nodeCount * 2);
  seen = new Int32Array(nodeCount * 2);
  heap = new Int32Array(nodeCount * 2);
  heapPos = new Int32Array(nodeCount * 2);
  stackPos = new Int32Array(nodeCount).fill(-1);
  runStamp = 0;
}

/** Heap order: lower priority first, state id breaks ties so plans are reproducible. */
function heapLess(a: number, b: number): boolean {
  return priority[a] < priority[b] || (priority[a] === priority[b] && a < b);
}

function siftUp(i: number): void {
  const s = heap[i];
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const p = heap[parent];
    if (!heapLess(s, p)) break;
    heap[i] = p;
    heapPos[p] = i;
    i = parent;
  }
  heap[i] = s;
  heapPos[s] = i;
}

function popMin(): number {
  const top = heap[0];
  heapPos[top] = -1;
  const last = heap[--heapLen];
  if (heapLen > 0) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= heapLen) break;
      const r = l + 1;
      const c = r < heapLen && heapLess(heap[r], heap[l]) ? r : l;
      if (!heapLess(heap[c], last)) break;
      heap[i] = heap[c];
      heapPos[heap[i]] = i;
      i = c;
    }
    heap[i] = last;
    heapPos[last] = i;
  }
  return top;
}

/**
 * Minimum-cost closed cycle of lattice edges enclosing (x, z): the cheapest set of nodes to
 * hold so the point's facet becomes enclosed. Returns the cycle's node ids in order (first
 * node not repeated) or null if none exists. Use the standard "cut-ray doubled graph"
 * shortest-path technique (a cycle encloses the point iff it crosses a ray from the point an
 * odd number of times).
 *
 * The ray leaves from the centre of the point's facet, so a point lying on a node or edge
 * still yields a loop that encloses `lat.facetAt(x, z)`. Loops come back counter-clockwise;
 * among equal-cost loops the tightest wins. Costs must be >= 0 (negative counts as 0, NaN as
 * impassable).
 */
export function planEnclosure(lat: Lattice, opts: EncloseOptions): number[] | null {
  const target = lat.facetAt(opts.x, opts.z);
  if (target < 0) return null;
  const { edgeA, edgeB, adjStart, adjNode, adjEdge } = latticeTopology(lat);
  const nodes = lat.nodes;
  const nodeCount = nodes.length;
  ensureScratch(nodeCount, edgeA.length);

  const minR2 = opts.minRadius > 0 ? opts.minRadius * opts.minRadius : 0;
  const maxR2 = opts.maxRadius === undefined ? Infinity : opts.maxRadius * opts.maxRadius;
  let minWeight = Infinity;
  for (let v = 0; v < nodeCount; v++) {
    const dx = nodes[v].x - opts.x;
    const dz = nodes[v].z - opts.z;
    const d2 = dx * dx + dz * dz;
    let w = Infinity;
    if (d2 >= minR2 && d2 <= maxR2) {
      const c = opts.cost(v);
      if (c < Infinity) w = Math.max(0, c) + TIGHTNESS * Math.sqrt(d2);
    }
    weight[v] = w;
    if (w < minWeight) minWeight = w;
  }

  // Cut ray: +x from the target facet's centre. Half-open in z: nodes exactly on the ray's
  // line count as below it (as if the ray ran a hair above), so every crossing counts once.
  const ox = lat.facets[target].cx;
  const oz = lat.facets[target].cz;
  const starts: { node: number; along: number }[] = [];
  for (let e = 0; e < edgeA.length; e++) {
    const a = nodes[edgeA[e]];
    const b = nodes[edgeB[e]];
    crossing[e] = 0;
    if (a.z > oz === b.z > oz) continue;
    const along = a.x + ((oz - a.z) * (b.x - a.x)) / (b.z - a.z) - ox;
    if (along <= 0) continue;
    crossing[e] = 1;
    if (weight[a.id] === Infinity || weight[b.id] === Infinity) continue;
    // Every enclosing cycle uses a crossing edge, hence its lower endpoint: those suffice
    // as starts.
    starts.push({ node: a.z > oz ? b.id : a.id, along });
  }
  starts.sort((p, q) => p.along - q.along || p.node - q.node);

  // Shortest odd-parity closed walk through each start (A* on the doubled graph). Starts run
  // nearest-first and are then removed: any cycle through an earlier start was already
  // costed in its own run, so later runs may skip it.
  const heuristicPerMetre = minWeight / lat.edge;
  let best = Infinity;
  let bestWalk: number[] | null = null;
  for (const { node: s } of starts) {
    // Removed: a repeat of an earlier start.
    if (weight[s] === Infinity) continue;
    const sx = nodes[s].x;
    const sz = nodes[s].z;
    // A closed walk through s around the target spans at least twice its distance to it.
    if (heuristicPerMetre * 2 * Math.hypot(sx - ox, sz - oz) >= best) {
      weight[s] = Infinity;
      continue;
    }
    const stamp = ++runStamp;
    const source = s * 2;
    const goal = s * 2 + 1;
    heapLen = 0;
    seen[source] = stamp;
    dist[source] = 0;
    priority[source] = 0;
    prev[source] = -1;
    heap[heapLen++] = source;
    siftUp(0);
    let found = false;
    while (heapLen > 0) {
      const u = popMin();
      if (priority[u] >= best) break;
      if (u === goal) {
        found = true;
        break;
      }
      const du = dist[u];
      const v = u >> 1;
      const parity = u & 1;
      for (let j = adjStart[v], end = adjStart[v + 1]; j < end; j++) {
        const w = adjNode[j];
        const ww = weight[w];
        if (ww === Infinity) continue;
        const t = w * 2 + (parity ^ crossing[adjEdge[j]]);
        const nd = du + ww;
        if (seen[t] === stamp) {
          if (heapPos[t] < 0 || nd >= dist[t]) continue;
          priority[t] += nd - dist[t];
          dist[t] = nd;
          prev[t] = u;
          siftUp(heapPos[t]);
          continue;
        }
        const f = nd + heuristicPerMetre * Math.hypot(nodes[w].x - sx, nodes[w].z - sz);
        if (f >= best) continue;
        seen[t] = stamp;
        dist[t] = nd;
        priority[t] = f;
        prev[t] = u;
        heap[heapLen] = t;
        siftUp(heapLen++);
      }
    }
    if (found) {
      best = dist[goal];
      bestWalk = [];
      for (let st = goal; st >= 0; st = prev[st]) bestWalk.push(st);
      bestWalk.reverse();
    }
    weight[s] = Infinity;
  }
  if (!bestWalk) return null;

  const cycle = oddCycleOf(bestWalk);
  // Counter-clockwise in (x, z), matching facet orientation.
  let area = 0;
  for (let i = 0; i < cycle.length; i++) {
    const p = nodes[cycle[i]];
    const q = nodes[cycle[(i + 1) % cycle.length]];
    area += p.x * q.z - q.x * p.z;
  }
  if (area < 0) cycle.reverse();
  return cycle;
}

/**
 * A simple cycle with odd ray parity inside a closed walk of states (node * 2 + parity,
 * from (s, 0) to (s, 1)). Even loops are cut out as the walk revisits nodes; the first odd
 * loop closed is simple and costs no more than the walk, so optimality carries over.
 */
function oddCycleOf(walk: number[]): number[] {
  const stack: number[] = [];
  const parities: number[] = [];
  let cycle: number[] = [];
  for (const state of walk) {
    const v = state >> 1;
    const parity = state & 1;
    const at = stackPos[v];
    if (at < 0) {
      stackPos[v] = stack.length;
      stack.push(v);
      parities.push(parity);
      continue;
    }
    if (parities[at] !== parity) {
      cycle = stack.slice(at);
      break;
    }
    for (let i = at + 1; i < stack.length; i++) stackPos[stack[i]] = -1;
    stack.length = at + 1;
    parities.length = at + 1;
  }
  for (const v of stack) stackPos[v] = -1;
  return cycle;
}

/** Home-expansion ring: a cheap enclosing loop at roughly `radius` around (x, z). */
export function planRing(lat: Lattice, x: number, z: number, radius: number, cost: NodeCost): number[] | null {
  return (
    planEnclosure(lat, { x, z, minRadius: radius, maxRadius: radius + RING_BAND * lat.edge, cost }) ??
    planEnclosure(lat, { x, z, minRadius: radius, maxRadius: radius + RING_BAND_WIDE * lat.edge, cost }) ??
    planEnclosure(lat, { x, z, minRadius: radius, cost })
  );
}

/** Nodes to plan for a pentacle around a focus node (its five neighbours). */
export function planPentacle(lat: Lattice, focus: number): number[] {
  return lat.neighbors(focus);
}
