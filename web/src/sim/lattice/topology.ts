/**
 * Flat typed-array views of the Ley Lattice topology, plus the static midpoint table that
 * drives the implied Flag fractal. Survey passes and planners sweep the graph many times
 * per recompute; these views keep their hot loops on contiguous Int32Arrays instead of
 * chasing LeyNode/LeyFacet objects. Cached per lattice and keyed by `lat.version`, which
 * every phason flip (the only topology mutation) bumps.
 * Owner: Lattice agent.
 */
import { PHI } from '../math';
import type { Lattice } from './lattice';

/** Midpoint tolerance as a fraction of the edge length ("exact" midpoint). */
const MIDPOINT_TOLERANCE = 1e-3;
/**
 * Longest parent pair that can imply a Flag, in edges. 2φ covers straight runs at the base
 * scale (two collinear edges) and at the φ-inflated scale (two collinear thick-rhombus long
 * diagonals), the tiling's own self-similarity. At 2 alone, no implied Flag on a canonical
 * Penrose lattice can ever parent another, so the fractal would stop at order 1.
 */
export const IMPLIED_REACH = 2 * PHI;

export interface LatticeTopology {
  readonly version: number;
  /** edgeA[e], edgeB[e]: the two nodes of edge e. */
  readonly edgeA: Int32Array;
  readonly edgeB: Int32Array;
  /** Node adjacency (CSR): for j in [adjStart[n], adjStart[n + 1]), node n meets adjNode[j] via edge adjEdge[j]. */
  readonly adjStart: Int32Array;
  readonly adjNode: Int32Array;
  readonly adjEdge: Int32Array;
  /** Per facet, 4 entries each: facetNodes[4f + i] = facets[f].nodes[i]; likewise edges and neighbours (-1 = map border). */
  readonly facetNodes: Int32Array;
  readonly facetEdges: Int32Array;
  readonly facetNbrs: Int32Array;
  /** Open map border: facet borderFacet[i] has no facet beyond its edge borderEdge[i]. */
  readonly borderFacet: Int32Array;
  readonly borderEdge: Int32Array;
  /**
   * Midpoint table by parent (CSR): for j in [parStart[p], parStart[p + 1]), nodes p and
   * parPartner[j] lie within IMPLIED_REACH·edge of each other and their exact midpoint is node parMid[j].
   */
  readonly parStart: Int32Array;
  readonly parPartner: Int32Array;
  readonly parMid: Int32Array;
  /** The same table by midpoint (CSR): node m is the exact midpoint of midA[j] and midB[j]. */
  readonly midStart: Int32Array;
  readonly midA: Int32Array;
  readonly midB: Int32Array;
}

/**
 * Exact midpoint triples (a < b, midpoint m) as parallel lists, plus the node positions they
 * were found at. Triples depend only on positions, and a phason flip moves a single node, so
 * after flips only the neighbourhood of moved nodes is searched again.
 */
interface MidpointTriples {
  x: Float64Array;
  z: Float64Array;
  a: number[];
  b: number[];
  m: number[];
}

/** The cache's mutable backing store (consumers see it as a read-only LatticeTopology). */
type TopologyStore = { -readonly [K in keyof LatticeTopology]: LatticeTopology[K] };

interface CacheEntry {
  topo: TopologyStore;
  triples: MidpointTriples;
  /** Refresh scratch: nodes whose triples need a fresh search, CSR fill cursors, query buffer. */
  affected: Uint8Array;
  cursor: Int32Array;
  near: number[];
}

const cache = new WeakMap<Lattice, CacheEntry>();

/**
 * Topology views for the lattice's current version. Built once per lattice; after phason
 * flips (which never change node, edge or facet counts) the same arrays are rewritten in
 * place and only the triples around moved nodes are searched again, so a tide's many small
 * flips cost no allocation churn.
 */
export function latticeTopology(lat: Lattice): LatticeTopology {
  const hit = cache.get(lat);
  if (hit) {
    if (hit.topo.version !== lat.version) {
      updateTriples(lat, hit);
      fillTopology(lat, hit);
    }
    return hit.topo;
  }
  const n = lat.nodes.length;
  const entry: CacheEntry = {
    topo: allocate(lat),
    triples: { x: new Float64Array(n), z: new Float64Array(n), a: [], b: [], m: [] },
    affected: new Uint8Array(n),
    cursor: new Int32Array(n),
    near: [],
  };
  for (let v = 0; v < n; v++) {
    entry.triples.x[v] = lat.nodes[v].x;
    entry.triples.z[v] = lat.nodes[v].z;
    triplesAround(lat, v, entry.triples, entry.near);
  }
  fillTopology(lat, entry);
  cache.set(lat, entry);
  return entry.topo;
}

/** Both parents of a triple lie within this distance of its midpoint. */
function parentReach(lat: Lattice): number {
  return (lat.edge * IMPLIED_REACH) / 2 + lat.edge * MIDPOINT_TOLERANCE;
}

/** Re-derive the triples near every node that moved since they were recorded. */
function updateTriples(lat: Lattice, entry: CacheEntry): void {
  const t = entry.triples;
  const affected = entry.affected;
  const near = entry.near;
  const n = lat.nodes.length;
  const reach = parentReach(lat);
  affected.fill(0);
  let moved = false;
  for (let v = 0; v < n; v++) {
    const node = lat.nodes[v];
    if (node.x === t.x[v] && node.z === t.z[v]) continue;
    // Any triple the node joined before or joins now is centred within reach of it.
    moved = true;
    near.length = 0;
    lat.nodesInRadius(t.x[v], t.z[v], reach, near);
    lat.nodesInRadius(node.x, node.z, reach, near);
    for (const m of near) affected[m] = 1;
    affected[v] = 1;
    t.x[v] = node.x;
    t.z[v] = node.z;
  }
  if (!moved) return;
  let kept = 0;
  for (let i = 0; i < t.m.length; i++) {
    if (affected[t.m[i]]) continue;
    t.a[kept] = t.a[i];
    t.b[kept] = t.b[i];
    t.m[kept] = t.m[i];
    kept++;
  }
  t.a.length = kept;
  t.b.length = kept;
  t.m.length = kept;
  for (let m = 0; m < n; m++) if (affected[m]) triplesAround(lat, m, t, near);
}

/**
 * Append every triple centred on node m: parents a and b within IMPLIED_REACH·edge of each
 * other whose exact midpoint is m. Both lie within half that reach of m, so a local search
 * finds them all; geometric (not combinatorial) so it stays exact on flipped tilings.
 */
function triplesAround(lat: Lattice, m: number, t: MidpointTriples, near: number[]): void {
  const tol = lat.edge * MIDPOINT_TOLERANCE;
  const M = lat.nodes[m];
  near.length = 0;
  lat.nodesInRadius(M.x, M.z, parentReach(lat), near);
  for (const a of near) {
    if (a === m) continue;
    const A = lat.nodes[a];
    const b = lat.nearestNode(2 * M.x - A.x, 2 * M.z - A.z, tol);
    if (b > a) {
      t.a.push(a);
      t.b.push(b);
      t.m.push(m);
    }
  }
}

/** Arrays sized by the lattice's (flip-invariant) counts; triple tables grow on demand. */
function allocate(lat: Lattice): TopologyStore {
  const nodeCount = lat.nodes.length;
  const edgeCount = lat.edges.length;
  const facetCount = lat.facets.length;
  let borderCount = 0;
  for (const fc of lat.facets) for (const g of fc.neighbors) if (g < 0) borderCount++;
  return {
    version: -1,
    edgeA: new Int32Array(edgeCount),
    edgeB: new Int32Array(edgeCount),
    adjStart: new Int32Array(nodeCount + 1),
    adjNode: new Int32Array(edgeCount * 2),
    adjEdge: new Int32Array(edgeCount * 2),
    facetNodes: new Int32Array(facetCount * 4),
    facetEdges: new Int32Array(facetCount * 4),
    facetNbrs: new Int32Array(facetCount * 4),
    borderFacet: new Int32Array(borderCount),
    borderEdge: new Int32Array(borderCount),
    parStart: new Int32Array(nodeCount + 1),
    parPartner: new Int32Array(0),
    parMid: new Int32Array(0),
    midStart: new Int32Array(nodeCount + 1),
    midA: new Int32Array(0),
    midB: new Int32Array(0),
  };
}

/** Rewrite every view from the lattice and the triple lists, reusing the arrays. */
function fillTopology(lat: Lattice, entry: CacheEntry): void {
  const topo = entry.topo;
  const nodeCount = lat.nodes.length;
  const edgeCount = lat.edges.length;
  const facetCount = lat.facets.length;
  const { edgeA, edgeB, adjStart, adjNode, adjEdge, facetNodes, facetEdges, facetNbrs } = topo;

  for (let e = 0; e < edgeCount; e++) {
    edgeA[e] = lat.edges[e].a;
    edgeB[e] = lat.edges[e].b;
  }
  adjStart[0] = 0;
  for (let n = 0; n < nodeCount; n++) adjStart[n + 1] = adjStart[n] + lat.nodes[n].edges.length;
  for (let n = 0; n < nodeCount; n++) {
    const edges = lat.nodes[n].edges;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      adjEdge[adjStart[n] + i] = e;
      adjNode[adjStart[n] + i] = edgeA[e] === n ? edgeB[e] : edgeA[e];
    }
  }

  let b = 0;
  for (let f = 0; f < facetCount; f++) {
    const fc = lat.facets[f];
    for (let i = 0; i < 4; i++) {
      facetNodes[f * 4 + i] = fc.nodes[i];
      facetEdges[f * 4 + i] = fc.edges[i];
      facetNbrs[f * 4 + i] = fc.neighbors[i];
      if (fc.neighbors[i] >= 0) continue;
      // Flips only turn interior nodes, so the border keeps its length; its facets may change.
      topo.borderFacet[b] = f;
      topo.borderEdge[b] = fc.edges[i];
      b++;
    }
  }

  const { a: triA, b: triB, m: triM } = entry.triples;
  const triCount = triM.length;
  if (topo.midA.length < triCount) {
    const cap = Math.ceil(triCount * 1.25) + 16;
    topo.parPartner = new Int32Array(cap * 2);
    topo.parMid = new Int32Array(cap * 2);
    topo.midA = new Int32Array(cap);
    topo.midB = new Int32Array(cap);
  }
  const { parStart, midStart, parPartner, parMid, midA, midB } = topo;
  parStart.fill(0);
  midStart.fill(0);
  for (let t = 0; t < triCount; t++) {
    parStart[triA[t] + 1]++;
    parStart[triB[t] + 1]++;
    midStart[triM[t] + 1]++;
  }
  for (let n = 0; n < nodeCount; n++) {
    parStart[n + 1] += parStart[n];
    midStart[n + 1] += midStart[n];
  }
  const cursor = entry.cursor;
  for (let n = 0; n < nodeCount; n++) cursor[n] = parStart[n];
  for (let t = 0; t < triCount; t++) {
    const a = triA[t];
    const c = triB[t];
    parPartner[cursor[a]] = c;
    parMid[cursor[a]++] = triM[t];
    parPartner[cursor[c]] = a;
    parMid[cursor[c]++] = triM[t];
  }
  for (let n = 0; n < nodeCount; n++) cursor[n] = midStart[n];
  for (let t = 0; t < triCount; t++) {
    const m = triM[t];
    midA[cursor[m]] = triA[t];
    midB[cursor[m]++] = triB[t];
  }
  topo.version = lat.version;
}
