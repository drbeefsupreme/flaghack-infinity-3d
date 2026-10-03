/**
 * Pure Survey geometry over the Ley Lattice (no World dependency, unit-testable).
 * All arrays are indexed by lattice node/edge/facet id; faction values are 0..3, -1 = none.
 * Hot paths (holders, Ley Lines, enclosure) run on the cached flat topology and module-level
 * scratch buffers, so a survey recompute allocates nothing.
 * Owner: Lattice agent.
 */
import type { Lattice, PerpWindow } from './lattice';
import { latticeTopology } from './topology';

const CLAIM_NONE = -1;
/** Two factions reached the node at the same order: it stays empty for this recompute. */
const CLAIM_INTERFERED = -2;
/** Perp-space slack so hull vertices (fresh nodes) read as inside their window. */
const WINDOW_EPS = 1e-9;

// ── Scratch ──────────────────────────────────────────────────────────────────
// Grown on demand, never shrunk; contents never outlive a call (the sim is single-threaded).

/** Per node; CLAIM_NONE between calls. */
let claim = new Int8Array(0);
let frontier = new Int32Array(0);
let claimed = new Int32Array(0);
let interfered = new Int32Array(0);
let nodeStack = new Int32Array(0);
let nodeMark = new Int32Array(0);
let nodeEpoch = 0;

let facetQueue = new Int32Array(0);
let facetMark = new Int32Array(0);
let facetEpoch = 0;

// criticalNodes: baseline + trial surveys.
let baseHolder = new Int8Array(0);
let baseImpliedOwner = new Int8Array(0);
let baseImpliedOrder = new Uint8Array(0);
let trialOwner = new Int8Array(0);
let trialHolder = new Int8Array(0);
let trialImpliedOwner = new Int8Array(0);
let trialImpliedOrder = new Uint8Array(0);
let baseLey = new Int8Array(0);
let baseEnclosed = new Uint8Array(0);

function ensureNodeScratch(n: number): void {
  if (claim.length >= n) return;
  claim = new Int8Array(n).fill(CLAIM_NONE);
  frontier = new Int32Array(n);
  claimed = new Int32Array(n);
  interfered = new Int32Array(n);
  nodeStack = new Int32Array(n);
  nodeMark = new Int32Array(n);
  nodeEpoch = 0;
}

function ensureFacetScratch(f: number): void {
  if (facetQueue.length >= f) return;
  facetQueue = new Int32Array(f);
  facetMark = new Int32Array(f);
  facetEpoch = 0;
}

/** Fresh visit stamp for nodeMark (stamps avoid clearing the array per sweep). */
function nextNodeEpoch(): number {
  if (nodeEpoch === 0x7fffffff) {
    nodeMark.fill(0);
    nodeEpoch = 0;
  }
  return ++nodeEpoch;
}

/** Fresh visit stamp for facetMark. */
function nextFacetEpoch(): number {
  if (facetEpoch === 0x7fffffff) {
    facetMark.fill(0);
    facetEpoch = 0;
  }
  return ++facetEpoch;
}

/** Push node n onto nodeStack unless already stamped with `mark`; returns the new top. */
function markPush(n: number, mark: number, top: number): number {
  if (nodeMark[n] === mark) return top;
  nodeMark[n] = mark;
  nodeStack[top] = n;
  return top + 1;
}

// ── Survey rules ─────────────────────────────────────────────────────────────

/**
 * Implied Flag fractal. Given real Flag owners per node, compute effective holders
 * (real or implied). An implied Flag of F appears on a free, unblocked node that is the
 * exact midpoint (tolerance 1e-3·edge) of two nodes held by F within IMPLIED_REACH = 2φ·edge
 * of each other; order = max(parent order)+1, real Flags are order 0, up to `maxOrder`.
 * Real Flags always win their node.
 *
 * On a Penrose lattice those midpoints are exactly the straight runs at two scales: two
 * collinear edges (scale 1) and two collinear φ·edge steps along thick-rhombus long
 * diagonals (scale φ, the edge length of the inflated tiling). The second scale is what lets
 * implied Flags parent further implied Flags: at scale 1 alone a canonical lattice never
 * cascades past order 1.
 *
 * Orders resolve outward one round at a time: a node is taken by the lowest order that
 * reaches it, and if two factions reach it in the same round they interfere and it stays
 * empty (no later round can claim it either).
 *
 * `realOwner`: -1 = empty node; any other negative value = an ownerless (neutral) planted
 * Flag, which occupies the node without holding it for anyone.
 *
 * Cost: a few microseconds per call. The first call on a lattice builds the cached midpoint
 * table (a few ms); after phason flips it is patched around the moved nodes (~0.2 ms).
 */
export function computeHolders(
  lat: Lattice,
  realOwner: Int8Array,
  outHolder: Int8Array,
  outImpliedOwner: Int8Array,
  outImpliedOrder: Uint8Array,
  maxOrder: number,
): void {
  const topo = latticeTopology(lat);
  const nodeCount = lat.nodes.length;
  ensureNodeScratch(nodeCount);
  const { parStart, parPartner, parMid } = topo;
  outImpliedOwner.fill(-1);
  outImpliedOrder.fill(0);

  let frontierLen = 0;
  for (let n = 0; n < nodeCount; n++) {
    const owner = realOwner[n];
    if (owner >= 0) {
      outHolder[n] = owner;
      frontier[frontierLen++] = n;
    } else {
      outHolder[n] = -1;
    }
  }

  let interferedLen = 0;
  for (let order = 1; order <= maxOrder && frontierLen > 0; order++) {
    // Every new pair has at least one parent from the previous round (older pairs were
    // already tried), so scanning the frontier's midpoint entries is exhaustive.
    let claimedLen = 0;
    for (let i = 0; i < frontierLen; i++) {
      const p = frontier[i];
      const f = outHolder[p];
      for (let j = parStart[p], end = parStart[p + 1]; j < end; j++) {
        if (outHolder[parPartner[j]] !== f) continue;
        const m = parMid[j];
        if (realOwner[m] !== -1 || outHolder[m] !== -1 || lat.nodes[m].blocked) continue;
        const c = claim[m];
        if (c === CLAIM_NONE) {
          claim[m] = f;
          claimed[claimedLen++] = m;
        } else if (c !== f) {
          claim[m] = CLAIM_INTERFERED;
        }
      }
    }
    frontierLen = 0;
    for (let i = 0; i < claimedLen; i++) {
      const m = claimed[i];
      const c = claim[m];
      if (c === CLAIM_INTERFERED) {
        // Keep the marker until the call ends so later rounds skip the node too.
        interfered[interferedLen++] = m;
        continue;
      }
      claim[m] = CLAIM_NONE;
      outHolder[m] = c;
      outImpliedOwner[m] = c;
      outImpliedOrder[m] = order;
      frontier[frontierLen++] = m;
    }
  }
  for (let i = 0; i < interferedLen; i++) claim[interfered[i]] = CLAIM_NONE;
}

/** Ley Lines: edge owner when both endpoints share a holder. */
export function computeLeyLines(lat: Lattice, holder: Int8Array, out: Int8Array): void {
  const { edgeA, edgeB } = latticeTopology(lat);
  for (let e = 0; e < edgeA.length; e++) {
    const h = holder[edgeA[e]];
    out[e] = h >= 0 && h === holder[edgeB[e]] ? h : -1;
  }
}

/** Crystallized facets: all four corners share a holder. */
export function computeCrystallized(lat: Lattice, holder: Int8Array, out: Int8Array): void {
  const { facetNodes } = latticeTopology(lat);
  for (let f = 0, i = 0; i < facetNodes.length; f++, i += 4) {
    const h = holder[facetNodes[i]];
    out[f] =
      h >= 0 && h === holder[facetNodes[i + 1]] && h === holder[facetNodes[i + 2]] && h === holder[facetNodes[i + 3]]
        ? h
        : -1;
  }
}

/**
 * Enclosure for one faction: out[facet] = 1 when the facet cannot reach a boundary facet
 * through facet adjacency without crossing an edge whose edgeLey === faction.
 * Returns the number of enclosed facets.
 *
 * Flood fill from the open map border: a boundary facet seeds the fill unless every border
 * edge it has is the faction's Ley Line, so crystallized facets come out enclosed for free.
 */
export function computeEnclosure(lat: Lattice, edgeLey: Int8Array, faction: number, out: Uint8Array): number {
  const { facetEdges, facetNbrs, borderFacet, borderEdge } = latticeTopology(lat);
  const facetCount = lat.facets.length;
  ensureFacetScratch(facetCount);
  const queue = facetQueue;
  out.fill(1);
  let tail = 0;
  for (let i = 0; i < borderFacet.length; i++) {
    const f = borderFacet[i];
    if (out[f] === 1 && edgeLey[borderEdge[i]] !== faction) {
      out[f] = 0;
      queue[tail++] = f;
    }
  }
  for (let head = 0; head < tail; head++) {
    const base = queue[head] * 4;
    for (let i = base; i < base + 4; i++) {
      const g = facetNbrs[i];
      if (g >= 0 && out[g] === 1 && edgeLey[facetEdges[i]] !== faction) {
        out[g] = 0;
        queue[tail++] = g;
      }
    }
  }
  return facetCount - tail;
}

// ── Crystal focus points ─────────────────────────────────────────────────────

/** 5-fold star test: interior node with exactly five thick rhombi meeting at it. */
export function isStar(lat: Lattice, n: number): boolean {
  const node = lat.nodes[n];
  if (node.boundary || node.facets.length !== 5) return false;
  for (const f of node.facets) if (!lat.facets[f].thick) return false;
  return true;
}

/** All current 5-fold focus nodes, written into `out` (cleared first) and returned. */
export function findFocusNodes(lat: Lattice, out: number[] = []): number[] {
  out.length = 0;
  for (let n = 0; n < lat.nodes.length; n++) if (isStar(lat, n)) out.push(n);
  return out;
}

/** The five neighbour nodes of a focus (the pentacle). */
export function pentacleOf(lat: Lattice, focus: number): number[] {
  return lat.neighbors(focus);
}

// ── Enclosure analysis ───────────────────────────────────────────────────────

/**
 * Critical nodes for an enclosure: real-Flag nodes of `faction` whose removal (recomputing
 * implied Flags) would make `facet` no longer enclosed. Ordered cheapest-to-break first
 * (fewest supporting ley lines, then nearest the facet). Used by HUD (highlight), hippie
 * raids and AI defence.
 *
 * Breaking the enclosure must break one of the Ley Lines walling in the facet's sealed
 * region, so candidates are those lines' real endpoints plus the real ancestors of implied
 * endpoints. Each candidate is verified by recomputing the whole implied fractal without it
 * (interference with rivals included), so the answer matches what the Survey would do.
 * Returns [] when the facet is not enclosed.
 */
export function criticalNodes(lat: Lattice, realOwner: Int8Array, faction: number, facet: number, maxOrder: number): number[] {
  const facetCount = lat.facets.length;
  if (facet < 0 || facet >= facetCount) return [];
  const topo = latticeTopology(lat);
  const { edgeA, edgeB, facetEdges, facetNbrs, adjStart, adjEdge, midStart, midA, midB } = topo;
  const nodeCount = lat.nodes.length;
  ensureNodeScratch(nodeCount);
  ensureFacetScratch(facetCount);
  if (baseHolder.length < nodeCount) {
    baseHolder = new Int8Array(nodeCount);
    baseImpliedOwner = new Int8Array(nodeCount);
    baseImpliedOrder = new Uint8Array(nodeCount);
    trialOwner = new Int8Array(nodeCount);
    trialHolder = new Int8Array(nodeCount);
    trialImpliedOwner = new Int8Array(nodeCount);
    trialImpliedOrder = new Uint8Array(nodeCount);
  }
  if (baseLey.length < edgeA.length) baseLey = new Int8Array(edgeA.length);
  if (baseEnclosed.length < facetCount) baseEnclosed = new Uint8Array(facetCount);

  computeHolders(lat, realOwner, baseHolder, baseImpliedOwner, baseImpliedOrder, maxOrder);
  computeLeyLines(lat, baseHolder, baseLey);
  computeEnclosure(lat, baseLey, faction, baseEnclosed);
  if (baseEnclosed[facet] === 0) return [];

  // Sealed region around the facet; its walls give the candidates.
  const candidates: number[] = [];
  const candidateMark = nextNodeEpoch();
  const region = nextFacetEpoch();
  const queue = facetQueue;
  queue[0] = facet;
  facetMark[facet] = region;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const base = queue[head] * 4;
    for (let i = base; i < base + 4; i++) {
      const e = facetEdges[i];
      if (baseLey[e] !== faction) {
        const g = facetNbrs[i];
        if (g >= 0 && facetMark[g] !== region) {
          facetMark[g] = region;
          queue[tail++] = g;
        }
        continue;
      }
      // Wall: collect real endpoints, or walk implied endpoints up to their real ancestors.
      // Nodes are marked when pushed, so the stack never exceeds the node count.
      let top = markPush(edgeB[e], candidateMark, markPush(edgeA[e], candidateMark, 0));
      while (top > 0) {
        const n = nodeStack[--top];
        if (realOwner[n] === faction) {
          candidates.push(n);
          continue;
        }
        if (baseImpliedOwner[n] !== faction) continue;
        const order = baseImpliedOrder[n];
        for (let j = midStart[n]; j < midStart[n + 1]; j++) {
          const a = midA[j];
          const b = midB[j];
          if (baseHolder[a] !== faction || baseHolder[b] !== faction) continue;
          if (baseImpliedOrder[a] >= order || baseImpliedOrder[b] >= order) continue;
          top = markPush(b, candidateMark, markPush(a, candidateMark, top));
        }
      }
    }
  }

  // Verify each candidate by pulling it and re-running the fractal.
  const critical: number[] = [];
  trialOwner.set(realOwner.subarray(0, nodeCount));
  for (const c of candidates) {
    trialOwner[c] = -1;
    computeHolders(lat, trialOwner, trialHolder, trialImpliedOwner, trialImpliedOrder, maxOrder);
    trialOwner[c] = realOwner[c];
    if (!staysSealed(lat, faction, facet, nodeCount)) critical.push(c);
  }

  // Cheapest to break first: fewest supporting Ley Lines, then nearest the facet.
  const fc = lat.facets[facet];
  return critical
    .map((n) => {
      let ley = 0;
      for (let j = adjStart[n]; j < adjStart[n + 1]; j++) if (baseLey[adjEdge[j]] === faction) ley++;
      const node = lat.nodes[n];
      return { n, ley, d2: (node.x - fc.cx) ** 2 + (node.z - fc.cz) ** 2 };
    })
    .sort((p, q) => p.ley - q.ley || p.d2 - q.d2 || p.n - q.n)
    .map((p) => p.n);
}

/**
 * After a trial pull (trialHolder), is `facet` still sealed for the faction? Flood from the
 * facet: escaping through the open border means un-enclosed. When the trial only lost
 * holders (the usual case), reaching any facet that was open in the baseline also proves
 * escape, which keeps the fill inside the old enclosure.
 */
function staysSealed(lat: Lattice, faction: number, facet: number, nodeCount: number): boolean {
  const { edgeA, edgeB, facetEdges, facetNbrs } = latticeTopology(lat);
  let shrunk = true;
  for (let n = 0; n < nodeCount; n++) {
    if (trialHolder[n] === faction && baseHolder[n] !== faction) {
      shrunk = false;
      break;
    }
  }
  const mark = nextFacetEpoch();
  const queue = facetQueue;
  queue[0] = facet;
  facetMark[facet] = mark;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const base = queue[head] * 4;
    for (let i = base; i < base + 4; i++) {
      const e = facetEdges[i];
      if (trialHolder[edgeA[e]] === faction && trialHolder[edgeB[e]] === faction) continue;
      const g = facetNbrs[i];
      if (g < 0 || (shrunk && baseEnclosed[g] === 0)) return false;
      if (facetMark[g] !== mark) {
        facetMark[g] = mark;
        queue[tail++] = g;
      }
    }
  }
  return true;
}

/** Ley Line edges bounding the enclosed component that contains `facet` (for VFX/HUD). */
export function enclosureBoundary(lat: Lattice, enclosed: Uint8Array, facet: number): number[] {
  const out: number[] = [];
  const facetCount = lat.facets.length;
  if (facet < 0 || facet >= facetCount || enclosed[facet] === 0) return out;
  const { facetEdges, facetNbrs } = latticeTopology(lat);
  ensureFacetScratch(facetCount);
  const mark = nextFacetEpoch();
  const queue = facetQueue;
  queue[0] = facet;
  facetMark[facet] = mark;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const base = queue[head] * 4;
    for (let i = base; i < base + 4; i++) {
      const g = facetNbrs[i];
      if (g < 0 || enclosed[g] === 0) {
        out.push(facetEdges[i]);
      } else if (facetMark[g] !== mark) {
        facetMark[g] = mark;
        queue[tail++] = g;
      }
    }
  }
  return out;
}

// ── Phason strain ────────────────────────────────────────────────────────────

/**
 * The acceptance window measuring node n: its index's window, or the nearest one for
 * indices outside 1..4 (only reachable through flips).
 */
function windowOf(lat: Lattice, n: number): PerpWindow {
  const windows = lat.perpWindows;
  return windows[Math.min(windows.length, Math.max(1, lat.nodes[n].index)) - 1];
}

/**
 * Signed depth of node n's perp position in window `win`: > 0 inside (distance to the
 * nearest side), < 0 outside (minus the distance to the window).
 */
function perpDepth(lat: Lattice, win: PerpWindow, n: number): number {
  const { xs, ys } = win;
  const px = lat.nodes[n].perpX;
  const py = lat.nodes[n].perpY;
  let depth = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const j = i + 1 === xs.length ? 0 : i + 1;
    const ex = xs[j] - xs[i];
    const ey = ys[j] - ys[i];
    depth = Math.min(depth, (ex * (py - ys[i]) - ey * (px - xs[i])) / Math.hypot(ex, ey));
  }
  if (depth >= -WINDOW_EPS) return Math.max(0, depth);
  // Outside a convex window: the distance to it is the distance to its nearest side.
  let outside = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const j = i + 1 === xs.length ? 0 : i + 1;
    const ex = xs[j] - xs[i];
    const ey = ys[j] - ys[i];
    const t = Math.min(1, Math.max(0, ((px - xs[i]) * ex + (py - ys[i]) * ey) / (ex * ex + ey * ey)));
    outside = Math.min(outside, Math.hypot(px - xs[i] - ex * t, py - ys[i] - ey * t));
  }
  return -outside;
}

/**
 * Perpendicular-space strain of a node: distance of its perp position outside the
 * canonical acceptance window for its index (0 inside). Unflipped nodes are 0.
 */
export function perpStrain(lat: Lattice, n: number): number {
  return Math.max(0, -perpDepth(lat, windowOf(lat, n), n));
}

/**
 * Phason susceptibility in [0, 1]: how close the node's perp position is to its window
 * boundary (1 = on/over the boundary, 0 at the window's inradius depth). Tides prefer
 * susceptible nodes.
 */
export function susceptibility(lat: Lattice, n: number): number {
  const win = windowOf(lat, n);
  const depth = perpDepth(lat, win, n);
  if (depth <= 0 || win.inradius <= 0) return 1;
  return Math.max(0, 1 - depth / win.inradius);
}
