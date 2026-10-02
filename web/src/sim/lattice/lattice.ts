/**
 * The Ley Lattice: a Penrose rhombus (P3) tiling generated with de Bruijn's pentagrid,
 * i.e. the projection of the 5-dimensional integer lattice Z^5 onto the burn.
 *
 * Every node carries its 5D Ley coordinate `k` (integer 5-vector). Parallel ("physical")
 * position = s * Σ k_j e_j, perpendicular ("internal") position = Σ k_j e⊥_j.
 *
 * Topology is mutable in place via phason flips (see `flip`): ids are stable, positions and
 * incidences change. `version` increments on every topology change.
 *
 * Orientation: facet `nodes` are in counter-clockwise order in the (x, z) plane, meaning
 * positive signed area Σ (x_i z_{i+1} - x_{i+1} z_i).
 */
import { LATTICE_MARGIN, LEY_EDGE, MAP_HALF } from '../constants';
import { distToSegment, pointInConvex } from '../math';
import { Rng } from '../rng';

/** Parallel-space basis e_j = (cos 2πj/5, sin 2πj/5). */
export const E_PAR: ReadonlyArray<readonly [number, number]> = [0, 1, 2, 3, 4].map(
  (j) => [Math.cos((2 * Math.PI * j) / 5), Math.sin((2 * Math.PI * j) / 5)] as const,
);
/** Perpendicular-space basis e⊥_j = (cos 4πj/5, sin 4πj/5). */
export const E_PERP: ReadonlyArray<readonly [number, number]> = [0, 1, 2, 3, 4].map(
  (j) => [Math.cos((4 * Math.PI * j) / 5), Math.sin((4 * Math.PI * j) / 5)] as const,
);

export interface LeyNode {
  id: number;
  x: number;
  z: number;
  /** 5D Ley coordinate. */
  k: number[];
  perpX: number;
  perpY: number;
  /** Σ k_j: the pentagrid "index" (1..4 for an unflipped Penrose vertex). */
  index: number;
  edges: number[];
  facets: number[];
  /** Unplantable (inside static obstacle / water). */
  blocked: boolean;
  /** On the clipped outer border of the lattice. */
  boundary: boolean;
}

export interface LeyEdge {
  id: number;
  a: number;
  b: number;
  /** Pentagrid family 0..4 of the edge direction (±e_dir). */
  dir: number;
  /** Adjacent facets (1 on the border, else 2). */
  facets: number[];
}

export interface LeyFacet {
  id: number;
  /** CCW node ids. */
  nodes: [number, number, number, number];
  /** edges[i] joins nodes[i] and nodes[(i+1)%4]. */
  edges: [number, number, number, number];
  /** neighbors[i] is the facet across edges[i], or -1 on the border. */
  neighbors: [number, number, number, number];
  thick: boolean;
  /** The two pentagrid families spanning this rhombus. */
  families: [number, number];
  cx: number;
  cz: number;
  boundary: boolean;
}

export interface FlipResult {
  node: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** The three facets re-tiled by the flip. */
  facets: number[];
  /** Every node whose incidence changed (hexagon ring + the flipped node). */
  touchedNodes: number[];
}

export interface LatticeOptions {
  edge?: number;
  half?: number;
  margin?: number;
  /** Static blocking test (obstacles, water). Applied at generation and after flips. */
  isBlockedAt?: (x: number, z: number) => boolean;
}

export class Lattice {
  readonly edge: number;
  readonly half: number;
  nodes: LeyNode[] = [];
  edges: LeyEdge[] = [];
  facets: LeyFacet[] = [];
  /** Pentagrid offsets used (Σ = 0). */
  gamma: number[] = [];
  /** The 5-fold star vertex at the map centre. */
  omegaNode = -1;
  /** Increments on every topology change (phason flip). */
  version = 0;
  isBlockedAt: (x: number, z: number) => boolean;

  private cellSize: number;
  private gridW: number;
  private nodeGrid: number[][] = [];
  private facetGrid: number[][] = [];
  private facetCells: number[][] = [];

  private constructor(edge: number, half: number, isBlockedAt: (x: number, z: number) => boolean) {
    this.edge = edge;
    this.half = half;
    this.isBlockedAt = isBlockedAt;
    this.cellSize = edge;
    this.gridW = Math.ceil((2 * half) / this.cellSize) + 1;
  }

  /** Generate the burn's Ley Lattice from a seed. Deterministic. */
  static generate(seed: string, opts: LatticeOptions = {}): Lattice {
    const s = opts.edge ?? LEY_EDGE;
    const half = opts.half ?? MAP_HALF;
    const margin = opts.margin ?? LATTICE_MARGIN;
    const lat = new Lattice(s, half, opts.isBlockedAt ?? (() => false));
    const rng = new Rng(`lattice:${seed}`);

    // Generic offsets with Σγ = 0 (true Penrose tiling, avoids triple intersections).
    const gamma: number[] = [];
    for (let j = 0; j < 4; j++) gamma.push(rng.range(0.05, 0.95));
    gamma.push(-(gamma[0] + gamma[1] + gamma[2] + gamma[3]));
    lat.gamma = gamma;

    // Tile positions ≈ 2.5 · s · p for pentagrid point p; cover the map plus translation slack.
    const reach = (half * 1.75) / (2.5 * s);
    const N = Math.ceil(reach) + 3;

    const keyToId = new Map<string, number>();
    const rawX: number[] = [];
    const rawZ: number[] = [];
    const rawK: number[][] = [];
    const rawFacets: { nodes: number[]; thick: boolean; families: [number, number] }[] = [];

    const vertexId = (k: number[]): number => {
      const key = k.join(',');
      let id = keyToId.get(key);
      if (id === undefined) {
        id = rawX.length;
        keyToId.set(key, id);
        let x = 0;
        let z = 0;
        for (let j = 0; j < 5; j++) {
          x += k[j] * E_PAR[j][0];
          z += k[j] * E_PAR[j][1];
        }
        rawX.push(x * s);
        rawZ.push(z * s);
        rawK.push(k.slice());
      }
      return id;
    };

    const limit = half * 1.6;
    for (let r = 0; r < 5; r++) {
      for (let q = r + 1; q < 5; q++) {
        const er = E_PAR[r];
        const eq = E_PAR[q];
        const det = er[0] * eq[1] - er[1] * eq[0];
        const thick = q - r === 1 || q - r === 4;
        for (let kr = -N; kr <= N; kr++) {
          for (let kq = -N; kq <= N; kq++) {
            const br = kr - gamma[r];
            const bq = kq - gamma[q];
            const px = (br * eq[1] - bq * er[1]) / det;
            const py = (er[0] * bq - eq[0] * br) / det;
            const K = [0, 0, 0, 0, 0];
            for (let j = 0; j < 5; j++) {
              // `|| 0` folds -0 into 0 so 5D coordinates compare and hash cleanly.
              K[j] = j === r ? kr : j === q ? kq : Math.ceil(px * E_PAR[j][0] + py * E_PAR[j][1] + gamma[j]) || 0;
            }
            // Rhombus centre in tiling space: Σ K e + (e_r + e_q)/2, scaled.
            let cx = 0;
            let cz = 0;
            for (let j = 0; j < 5; j++) {
              cx += K[j] * E_PAR[j][0];
              cz += K[j] * E_PAR[j][1];
            }
            cx = (cx + (er[0] + eq[0]) / 2) * s;
            cz = (cz + (er[1] + eq[1]) / 2) * s;
            if (Math.abs(cx) > limit || Math.abs(cz) > limit) continue;
            const k00 = K.slice();
            const k10 = K.slice();
            k10[r] += 1;
            const k11 = k10.slice();
            k11[q] += 1;
            const k01 = K.slice();
            k01[q] += 1;
            rawFacets.push({
              nodes: [vertexId(k00), vertexId(k10), vertexId(k11), vertexId(k01)],
              thick,
              families: [r, q],
            });
          }
        }
      }
    }

    // Find the 5-fold star vertex nearest the tiling origin: degree 5, all five rhombi thick.
    const rawDeg = new Map<number, { count: number; thick: number }>();
    for (const f of rawFacets) {
      for (const n of f.nodes) {
        const d = rawDeg.get(n) ?? { count: 0, thick: 0 };
        d.count++;
        if (f.thick) d.thick++;
        rawDeg.set(n, d);
      }
    }
    let star = -1;
    let starD = Infinity;
    for (const [n, d] of rawDeg) {
      if (d.count === 5 && d.thick === 5) {
        const dd = rawX[n] * rawX[n] + rawZ[n] * rawZ[n];
        if (dd < starD) {
          starD = dd;
          star = n;
        }
      }
    }
    const offX = star >= 0 ? rawX[star] : 0;
    const offZ = star >= 0 ? rawZ[star] : 0;

    // Clip to the map and reindex.
    const lim = half - margin;
    const remap = new Map<number, number>();
    const keep = (n: number) => {
      let id = remap.get(n);
      if (id === undefined) {
        id = lat.nodes.length;
        remap.set(n, id);
        const k = rawK[n];
        let perpX = 0;
        let perpY = 0;
        for (let j = 0; j < 5; j++) {
          perpX += k[j] * E_PERP[j][0];
          perpY += k[j] * E_PERP[j][1];
        }
        const x = rawX[n] - offX;
        const z = rawZ[n] - offZ;
        lat.nodes.push({
          id,
          x,
          z,
          k: k.slice(),
          perpX,
          perpY,
          index: k[0] + k[1] + k[2] + k[3] + k[4],
          edges: [],
          facets: [],
          blocked: false,
          boundary: false,
        });
      }
      return id;
    };

    for (const f of rawFacets) {
      let inside = true;
      for (const n of f.nodes) {
        const x = rawX[n] - offX;
        const z = rawZ[n] - offZ;
        if (x < -lim || x > lim || z < -lim || z > lim) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      const ids = f.nodes.map(keep);
      // Normalize to CCW in (x, z).
      if (signedArea(lat, ids) < 0) ids.reverse();
      const facet: LeyFacet = {
        id: lat.facets.length,
        nodes: [ids[0], ids[1], ids[2], ids[3]],
        edges: [-1, -1, -1, -1],
        neighbors: [-1, -1, -1, -1],
        thick: f.thick,
        families: f.families,
        cx: 0,
        cz: 0,
        boundary: false,
      };
      lat.facets.push(facet);
      for (const n of ids) lat.nodes[n].facets.push(facet.id);
    }
    lat.omegaNode = star >= 0 ? (remap.get(star) ?? -1) : -1;

    // Edges.
    const edgeKey = new Map<number, number>();
    const big = lat.nodes.length + 1;
    for (const f of lat.facets) {
      for (let i = 0; i < 4; i++) {
        const a = f.nodes[i];
        const b = f.nodes[(i + 1) % 4];
        const key = a < b ? a * big + b : b * big + a;
        let e = edgeKey.get(key);
        if (e === undefined) {
          e = lat.edges.length;
          edgeKey.set(key, e);
          lat.edges.push({ id: e, a, b, dir: edgeDir(lat, a, b), facets: [] });
          lat.nodes[a].edges.push(e);
          lat.nodes[b].edges.push(e);
        }
        lat.edges[e].facets.push(f.id);
        f.edges[i] = e;
      }
    }
    for (const f of lat.facets) lat.refreshFacetDerived(f.id);
    for (const e of lat.edges) {
      if (e.facets.length < 2) {
        lat.nodes[e.a].boundary = true;
        lat.nodes[e.b].boundary = true;
      }
    }
    for (const n of lat.nodes) {
      n.blocked = lat.isBlockedAt(n.x, n.z);
      sortEdgesByAngle(lat, n);
    }

    lat.gridInit();
    return lat;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Nearest node within maxDist (default: unbounded within the search grid), or -1. */
  nearestNode(x: number, z: number, maxDist = this.edge * 2, filter?: (n: LeyNode) => boolean): number {
    let best = -1;
    let bestD = maxDist * maxDist;
    const r = Math.ceil(maxDist / this.cellSize);
    const ci = this.cellOf(x);
    const cj = this.cellOf(z);
    for (let j = cj - r; j <= cj + r; j++) {
      if (j < 0 || j >= this.gridW) continue;
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || i >= this.gridW) continue;
        for (const id of this.nodeGrid[j * this.gridW + i]) {
          const n = this.nodes[id];
          const dx = n.x - x;
          const dz = n.z - z;
          const d = dx * dx + dz * dz;
          if (d <= bestD && (!filter || filter(n))) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    return best;
  }

  /** Node ids within radius r of (x, z). */
  nodesInRadius(x: number, z: number, r: number, out: number[] = []): number[] {
    const r2 = r * r;
    const c0 = this.cellOf(x - r);
    const c1 = this.cellOf(x + r);
    const d0 = this.cellOf(z - r);
    const d1 = this.cellOf(z + r);
    for (let j = Math.max(0, d0); j <= Math.min(this.gridW - 1, d1); j++) {
      for (let i = Math.max(0, c0); i <= Math.min(this.gridW - 1, c1); i++) {
        for (const id of this.nodeGrid[j * this.gridW + i]) {
          const n = this.nodes[id];
          const dx = n.x - x;
          const dz = n.z - z;
          if (dx * dx + dz * dz <= r2) out.push(id);
        }
      }
    }
    return out;
  }

  /** Facet containing (x, z), or -1 outside the lattice. */
  facetAt(x: number, z: number): number {
    const i = this.cellOf(x);
    const j = this.cellOf(z);
    if (i < 0 || j < 0 || i >= this.gridW || j >= this.gridW) return -1;
    const xs = [0, 0, 0, 0];
    const zs = [0, 0, 0, 0];
    for (const id of this.facetGrid[j * this.gridW + i]) {
      const f = this.facets[id];
      for (let q = 0; q < 4; q++) {
        xs[q] = this.nodes[f.nodes[q]].x;
        zs[q] = this.nodes[f.nodes[q]].z;
      }
      if (pointInConvex(x, z, xs, zs)) return id;
    }
    return -1;
  }

  /** Facet ids whose centre lies within radius r. */
  facetsInRadius(x: number, z: number, r: number, out: number[] = []): number[] {
    const seen = new Set<number>();
    const r2 = r * r;
    const c0 = this.cellOf(x - r);
    const c1 = this.cellOf(x + r);
    const d0 = this.cellOf(z - r);
    const d1 = this.cellOf(z + r);
    for (let j = Math.max(0, d0); j <= Math.min(this.gridW - 1, d1); j++) {
      for (let i = Math.max(0, c0); i <= Math.min(this.gridW - 1, c1); i++) {
        for (const id of this.facetGrid[j * this.gridW + i]) {
          if (seen.has(id)) continue;
          seen.add(id);
          const f = this.facets[id];
          const dx = f.cx - x;
          const dz = f.cz - z;
          if (dx * dx + dz * dz <= r2) out.push(id);
        }
      }
    }
    return out;
  }

  /** Nearest edge (by distance to segment) within maxDist, or -1. */
  nearestEdge(x: number, z: number, maxDist = this.edge): number {
    const near = this.nodesInRadius(x, z, maxDist + this.edge);
    let best = -1;
    let bestD = maxDist;
    const seen = new Set<number>();
    for (const nid of near) {
      for (const eid of this.nodes[nid].edges) {
        if (seen.has(eid)) continue;
        seen.add(eid);
        const e = this.edges[eid];
        const a = this.nodes[e.a];
        const b = this.nodes[e.b];
        const d = distToSegment(x, z, a.x, a.z, b.x, b.z);
        if (d <= bestD) {
          bestD = d;
          best = eid;
        }
      }
    }
    return best;
  }

  /** Edge id joining nodes a and b, or -1. */
  edgeBetween(a: number, b: number): number {
    for (const e of this.nodes[a].edges) {
      const ed = this.edges[e];
      if ((ed.a === a && ed.b === b) || (ed.a === b && ed.b === a)) return e;
    }
    return -1;
  }

  /** The node at the other end of edge e from node n. */
  other(e: number, n: number): number {
    const ed = this.edges[e];
    return ed.a === n ? ed.b : ed.a;
  }

  /** Neighbouring node ids of n (via edges). */
  neighbors(n: number): number[] {
    return this.nodes[n].edges.map((e) => this.other(e, n));
  }

  // ── Phason flips ───────────────────────────────────────────────────────────

  /**
   * A node is flippable when it is interior with exactly three edges and three rhombi
   * (the centre of a hexagon made of three rhombi).
   */
  flippable(n: number): boolean {
    const node = this.nodes[n];
    return !node.boundary && node.edges.length === 3 && node.facets.length === 3;
  }

  /**
   * Phason flip: move node v (neighbours v+e1, v+e2, v+e3) to v' = v + e1 + e2 + e3,
   * re-tiling the hexagon. Node/edge/facet ids are reused in place. Returns null if not
   * flippable. Callers (survey system) must handle any Flag that sat on the node.
   */
  flip(v: number): FlipResult | null {
    if (!this.flippable(v)) return null;
    const V = this.nodes[v];
    const [ea, eb, ec] = V.edges;
    const a = this.other(ea, v);
    const b = this.other(eb, v);
    const c = this.other(ec, v);
    const A = this.nodes[a];
    const B = this.nodes[b];
    const C = this.nodes[c];

    // Old facets: the rhombus containing v, x, y has far corner p_xy = x + y - v.
    const facetWith = (x: number, y: number): number => {
      for (const f of V.facets) {
        const ns = this.facets[f].nodes;
        if (ns.includes(x) && ns.includes(y)) return f;
      }
      return -1;
    };
    const fab = facetWith(a, b);
    const fbc = facetWith(b, c);
    const fca = facetWith(c, a);
    if (fab < 0 || fbc < 0 || fca < 0) return null;
    const far = (f: number, x: number, y: number): number =>
      this.facets[f].nodes.find((n) => n !== v && n !== x && n !== y)!;
    const pab = far(fab, a, b);
    const pbc = far(fbc, b, c);
    const pca = far(fca, c, a);

    const fromX = V.x;
    const fromZ = V.z;
    const oldFacetCells = [fab, fbc, fca].map((f) => this.facetCells[f]);

    // New position and 5D coordinate: v' = a + b + c - 2v.
    V.x = A.x + B.x + C.x - 2 * V.x;
    V.z = A.z + B.z + C.z - 2 * V.z;
    const k = V.k.map((kv, j) => A.k[j] + B.k[j] + C.k[j] - 2 * kv);
    V.k = k;
    V.index = k[0] + k[1] + k[2] + k[3] + k[4];
    V.perpX = 0;
    V.perpY = 0;
    for (let j = 0; j < 5; j++) {
      V.perpX += k[j] * E_PERP[j][0];
      V.perpY += k[j] * E_PERP[j][1];
    }
    V.blocked = this.isBlockedAt(V.x, V.z);

    // Re-tile: [c, p_ca, v', p_bc] reuses fab (edges e_a, e_b); [a, p_ab, v', p_ca] reuses fbc;
    // [b, p_bc, v', p_ab] reuses fca. Orientation re-normalized below.
    this.setFacetNodes(fab, [c, pca, v, pbc]);
    this.setFacetNodes(fbc, [a, pab, v, pca]);
    this.setFacetNodes(fca, [b, pbc, v, pab]);

    // Re-point the three spokes: v–a → v'–p_bc (dir e_a), v–b → v'–p_ca, v–c → v'–p_ab.
    this.repointEdge(ea, a, pbc, v);
    this.repointEdge(eb, b, pca, v);
    this.repointEdge(ec, c, pab, v);

    const touched = [v, a, b, c, pab, pbc, pca];
    const hexFacets = [fab, fbc, fca];
    // Node facet incidences.
    for (const n of touched) {
      const nd = this.nodes[n];
      nd.facets = nd.facets.filter((f) => !hexFacets.includes(f));
    }
    for (const f of hexFacets) for (const n of this.facets[f].nodes) this.nodes[n].facets.push(f);
    // Facet edges and edge facet incidences.
    const touchedEdges = new Set<number>();
    for (const n of touched) for (const e of this.nodes[n].edges) touchedEdges.add(e);
    for (const e of touchedEdges) {
      const ed = this.edges[e];
      ed.facets = ed.facets.filter((f) => !hexFacets.includes(f));
    }
    for (const f of hexFacets) {
      const fc = this.facets[f];
      for (let i = 0; i < 4; i++) {
        const e = this.edgeBetween(fc.nodes[i], fc.nodes[(i + 1) % 4]);
        fc.edges[i] = e;
        this.edges[e].facets.push(f);
      }
    }
    // Neighbours for the hexagon facets and everything bordering them.
    const refresh = new Set<number>(hexFacets);
    for (const f of hexFacets) for (const e of this.facets[f].edges) for (const g of this.edges[e].facets) refresh.add(g);
    for (const f of refresh) this.refreshFacetDerived(f);
    for (const n of touched) sortEdgesByAngle(this, this.nodes[n]);

    // Spatial index.
    this.gridMoveNode(v, fromX, fromZ);
    hexFacets.forEach((f, i) => this.gridReindexFacet(f, oldFacetCells[i]));

    this.version++;
    return { node: v, fromX, fromZ, toX: V.x, toZ: V.z, facets: hexFacets, touchedNodes: touched };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private setFacetNodes(f: number, ids: number[]): void {
    if (signedArea(this, ids) < 0) ids.reverse();
    this.facets[f].nodes = [ids[0], ids[1], ids[2], ids[3]];
  }

  private repointEdge(e: number, oldOther: number, newOther: number, v: number): void {
    const ed = this.edges[e];
    const on = this.nodes[oldOther];
    on.edges = on.edges.filter((x) => x !== e);
    this.nodes[newOther].edges.push(e);
    ed.a = v;
    ed.b = newOther;
  }

  /** Recompute centre, neighbours and boundary flag of a facet from its nodes/edges. */
  private refreshFacetDerived(f: number): void {
    const fc = this.facets[f];
    let cx = 0;
    let cz = 0;
    for (const n of fc.nodes) {
      cx += this.nodes[n].x;
      cz += this.nodes[n].z;
    }
    fc.cx = cx / 4;
    fc.cz = cz / 4;
    let boundary = false;
    for (let i = 0; i < 4; i++) {
      const e = this.edges[fc.edges[i]];
      const other = e.facets.find((g) => g !== f);
      fc.neighbors[i] = other === undefined ? -1 : other;
      if (other === undefined) boundary = true;
    }
    fc.boundary = boundary;
  }

  private cellOf(v: number): number {
    return Math.floor((v + this.half) / this.cellSize);
  }

  private gridInit(): void {
    const total = this.gridW * this.gridW;
    this.nodeGrid = Array.from({ length: total }, () => []);
    this.facetGrid = Array.from({ length: total }, () => []);
    this.facetCells = this.facets.map(() => []);
    for (const n of this.nodes) {
      const c = this.cellIndex(n.x, n.z);
      if (c >= 0) this.nodeGrid[c].push(n.id);
    }
    for (const f of this.facets) this.gridReindexFacet(f.id, []);
  }

  private cellIndex(x: number, z: number): number {
    const i = this.cellOf(x);
    const j = this.cellOf(z);
    if (i < 0 || j < 0 || i >= this.gridW || j >= this.gridW) return -1;
    return j * this.gridW + i;
  }

  private gridMoveNode(id: number, oldX: number, oldZ: number): void {
    const oc = this.cellIndex(oldX, oldZ);
    if (oc >= 0) this.nodeGrid[oc] = this.nodeGrid[oc].filter((n) => n !== id);
    const n = this.nodes[id];
    const nc = this.cellIndex(n.x, n.z);
    if (nc >= 0) this.nodeGrid[nc].push(id);
  }

  private gridReindexFacet(f: number, oldCells: number[]): void {
    for (const c of oldCells) this.facetGrid[c] = this.facetGrid[c].filter((x) => x !== f);
    const fc = this.facets[f];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const n of fc.nodes) {
      const nd = this.nodes[n];
      x0 = Math.min(x0, nd.x);
      x1 = Math.max(x1, nd.x);
      z0 = Math.min(z0, nd.z);
      z1 = Math.max(z1, nd.z);
    }
    const cells: number[] = [];
    for (let j = Math.max(0, this.cellOf(z0)); j <= Math.min(this.gridW - 1, this.cellOf(z1)); j++) {
      for (let i = Math.max(0, this.cellOf(x0)); i <= Math.min(this.gridW - 1, this.cellOf(x1)); i++) {
        const c = j * this.gridW + i;
        this.facetGrid[c].push(f);
        cells.push(c);
      }
    }
    this.facetCells[f] = cells;
  }
}

function signedArea(lat: Lattice, ids: number[]): number {
  let s = 0;
  for (let i = 0; i < ids.length; i++) {
    const p = lat.nodes[ids[i]];
    const q = lat.nodes[ids[(i + 1) % ids.length]];
    s += p.x * q.z - q.x * p.z;
  }
  return s / 2;
}

/** Pentagrid family of the edge a→b: the j with |(b - a)/s · e_j| ≈ 1. */
function edgeDir(lat: Lattice, a: number, b: number): number {
  const dx = (lat.nodes[b].x - lat.nodes[a].x) / lat.edge;
  const dz = (lat.nodes[b].z - lat.nodes[a].z) / lat.edge;
  let best = 0;
  let bestDot = -1;
  for (let j = 0; j < 5; j++) {
    const d = Math.abs(dx * E_PAR[j][0] + dz * E_PAR[j][1]);
    if (d > bestDot) {
      bestDot = d;
      best = j;
    }
  }
  return best;
}

function sortEdgesByAngle(lat: Lattice, n: LeyNode): void {
  n.edges.sort((e1, e2) => {
    const o1 = lat.nodes[lat.other(e1, n.id)];
    const o2 = lat.nodes[lat.other(e2, n.id)];
    return Math.atan2(o1.z - n.z, o1.x - n.x) - Math.atan2(o2.z - n.z, o2.x - n.x);
  });
}
