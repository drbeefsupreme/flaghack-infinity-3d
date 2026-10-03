import { describe, expect, it } from 'vitest';
import { CAMP_CENTERS, IMPLIED_MAX_ORDER, START_HOME_RING_RADIUS } from '../constants';
import { hash01, Rng } from '../rng';
import { FACTION_IDS } from '../types';
import { computeEnclosure, computeHolders, computeLeyLines } from './geometry';
import { Lattice } from './lattice';
import { type NodeCost, planEnclosure, planRing } from './planner';

const lat = Lattice.generate('planner-seed');
const free: NodeCost = (n) => (lat.nodes[n].blocked ? Infinity : 1);

/** Enclosure when the loop's nodes are held: either exactly (no implied Flags) or through the real fractal. */
function enclosedWhenHeld(loop: number[], withImplied: boolean): Uint8Array {
  const n = lat.nodes.length;
  const real = new Int8Array(n).fill(-1);
  for (const v of loop) real[v] = 0;
  let holder = real;
  if (withImplied) {
    holder = new Int8Array(n);
    computeHolders(lat, real, holder, new Int8Array(n), new Uint8Array(n), IMPLIED_MAX_ORDER);
  }
  const ley = new Int8Array(lat.edges.length);
  computeLeyLines(lat, holder, ley);
  const out = new Uint8Array(lat.facets.length);
  computeEnclosure(lat, ley, 0, out);
  return out;
}

function insideLoop(loop: number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = lat.nodes[loop[i]];
    const b = lat.nodes[loop[j]];
    if (a.z > z !== b.z > z && x < a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

function expectSimpleCcwCycle(loop: number[]): void {
  expect(loop.length).toBeGreaterThanOrEqual(3);
  expect(new Set(loop).size).toBe(loop.length);
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const next = loop[(i + 1) % loop.length];
    expect(lat.edgeBetween(loop[i], next)).toBeGreaterThanOrEqual(0);
    const p = lat.nodes[loop[i]];
    const q = lat.nodes[next];
    area += p.x * q.z - q.x * p.z;
  }
  expect(area).toBeGreaterThan(0);
}

function costOf(loop: number[], cost: NodeCost): number {
  return loop.reduce((sum, n) => sum + cost(n), 0);
}

function radiusOf(n: number, x: number, z: number): number {
  return Math.hypot(lat.nodes[n].x - x, lat.nodes[n].z - z);
}

/**
 * The textbook technique without any pruning: Dijkstra on (node, ray parity) from both
 * endpoints of every ray-crossing edge. Minimum node cost of a loop enclosing the facet.
 */
function bruteForceMinCost(x: number, z: number, minRadius: number, cost: NodeCost, maxRadius = Infinity): number {
  const facet = lat.facets[lat.facetAt(x, z)];
  const n = lat.nodes.length;
  const weight = lat.nodes.map((node) => {
    const r = Math.hypot(node.x - x, node.z - z);
    return r < minRadius || r > maxRadius ? Infinity : cost(node.id);
  });
  const crosses = lat.edges.map((e) => {
    const a = lat.nodes[e.a];
    const b = lat.nodes[e.b];
    if (a.z > facet.cz === b.z > facet.cz) return 0;
    return a.x + ((facet.cz - a.z) * (b.x - a.x)) / (b.z - a.z) > facet.cx ? 1 : 0;
  });
  const starts = new Set<number>();
  for (const e of lat.edges) {
    if (!crosses[e.id]) continue;
    starts.add(e.a);
    starts.add(e.b);
  }
  let best = Infinity;
  for (const s of starts) {
    if (weight[s] === Infinity) continue;
    const dist = new Float64Array(2 * n).fill(Infinity);
    dist[2 * s] = 0;
    const heap: number[][] = [[0, 2 * s]];
    while (heap.length > 0) {
      const top = heap[0];
      const last = heap.pop() ?? top;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let c = i;
          if (l < heap.length && heap[l][0] < heap[c][0]) c = l;
          if (r < heap.length && heap[r][0] < heap[c][0]) c = r;
          if (c === i) break;
          [heap[i], heap[c]] = [heap[c], heap[i]];
          i = c;
        }
      }
      const [d, u] = top;
      if (d > dist[u]) continue;
      if (u === 2 * s + 1) {
        best = Math.min(best, d);
        break;
      }
      const v = u >> 1;
      for (const e of lat.nodes[v].edges) {
        const t = lat.other(e, v);
        if (weight[t] === Infinity) continue;
        const st = 2 * t + ((u & 1) ^ crosses[e]);
        const nd = d + weight[t];
        if (nd >= dist[st]) continue;
        dist[st] = nd;
        heap.push([nd, st]);
        for (let i = heap.length - 1; i > 0; ) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[i], heap[p]] = [heap[p], heap[i]];
          i = p;
        }
      }
    }
  }
  return best;
}

describe('planEnclosure', () => {
  const cases = [
    { x: 0, z: 0, minRadius: 8 },
    { x: -100, z: 100, minRadius: 13 },
    { x: 61.3, z: -42.7, minRadius: 25 },
    { x: -35, z: -105, minRadius: 18 },
  ];

  it('returns a simple CCW loop that, once held, encloses exactly the facets inside it', () => {
    for (const c of cases) {
      const loop = planEnclosure(lat, { ...c, cost: free });
      expect(loop, JSON.stringify(c)).not.toBeNull();
      if (!loop) continue;
      expectSimpleCcwCycle(loop);
      for (const n of loop) expect(radiusOf(n, c.x, c.z)).toBeGreaterThanOrEqual(c.minRadius);
      const exact = enclosedWhenHeld(loop, false);
      for (const f of lat.facets) expect(exact[f.id] === 1).toBe(insideLoop(loop, f.cx, f.cz));
      const target = lat.facetAt(c.x, c.z);
      expect(exact[target]).toBe(1);
      expect(enclosedWhenHeld(loop, true)[target]).toBe(1);
    }
  });

  it('finds the true minimum cost, including Flags already ours and impassable nodes', () => {
    const mixed: NodeCost = (n) => {
      if (lat.nodes[n].blocked) return Infinity;
      const h = hash01(n * 7 + 3);
      return h < 0.15 ? 0 : h < 0.25 ? Infinity : 1;
    };
    // All-positive costs keep the A* heuristic and the start-skipping bound active.
    const rough: NodeCost = (n) => (lat.nodes[n].blocked || hash01(n * 13 + 5) < 0.3 ? Infinity : 1);
    const rng = new Rng('planner-optimality');
    const scenarios: { x: number; z: number; minRadius: number; maxRadius?: number }[] = [...cases.slice(0, 3)];
    for (let i = 0; i < 6; i++) {
      const minRadius = rng.range(4, 30);
      scenarios.push({ x: rng.range(-90, 90), z: rng.range(-90, 90), minRadius, maxRadius: minRadius + rng.range(16, 60) });
    }
    for (const c of scenarios) {
      for (const cost of [free, mixed, rough]) {
        const loop = planEnclosure(lat, { ...c, cost });
        const best = bruteForceMinCost(c.x, c.z, c.minRadius, cost, c.maxRadius);
        expect(loop === null, JSON.stringify(c)).toBe(best === Infinity);
        if (!loop) continue;
        for (const n of loop) expect(cost(n)).toBeLessThan(Infinity);
        expect(costOf(loop, cost), JSON.stringify(c)).toBe(best);
      }
    }
  });

  it('reuses a distant, nearly finished loop instead of building a tight new one', () => {
    const c = { x: 5, z: -8, minRadius: 10 };
    const far = planEnclosure(lat, { ...c, minRadius: 34, cost: free });
    if (!far) throw new Error('no far loop');
    // Ours except a two-node gap.
    const ours = new Set(far.slice(2));
    const cost: NodeCost = (n) => (ours.has(n) ? 0 : free(n));
    const loop = planEnclosure(lat, { ...c, cost });
    expect(loop).not.toBeNull();
    if (!loop) return;
    expect(costOf(loop, cost)).toBeLessThanOrEqual(2);
    expect(costOf(loop, cost)).toBe(bruteForceMinCost(c.x, c.z, c.minRadius, cost));
  });

  it('routes around impassable nodes and is cheaper when part of the loop is already ours', () => {
    const c = cases[2];
    const base = planEnclosure(lat, { ...c, cost: free });
    if (!base) throw new Error('no base loop');
    const banned = new Set(base.filter((_, i) => i % 2 === 0));
    const around = planEnclosure(lat, { ...c, cost: (n) => (banned.has(n) ? Infinity : free(n)) });
    expect(around).not.toBeNull();
    if (!around) return;
    for (const n of around) expect(banned.has(n)).toBe(false);
    expect(enclosedWhenHeld(around, false)[lat.facetAt(c.x, c.z)]).toBe(1);

    const ours = new Set(base.slice(0, Math.floor(base.length / 2)));
    const owned: NodeCost = (n) => (ours.has(n) ? 0 : free(n));
    const reuse = planEnclosure(lat, { ...c, cost: owned });
    expect(reuse).not.toBeNull();
    if (!reuse) return;
    expect(costOf(reuse, owned)).toBeLessThanOrEqual(base.length - ours.size);
    expect(costOf(reuse, owned)).toBeLessThan(costOf(base, free));
  });

  it('honours maxRadius', () => {
    const loop = planEnclosure(lat, { x: 10, z: 20, minRadius: 16, maxRadius: 36, cost: free });
    expect(loop).not.toBeNull();
    for (const n of loop ?? []) {
      expect(radiusOf(n, 10, 20)).toBeGreaterThanOrEqual(16);
      expect(radiusOf(n, 10, 20)).toBeLessThanOrEqual(36);
    }
  });

  it('encloses the facet under a point lying exactly on a node or an edge', () => {
    const node = lat.nodes[lat.nearestNode(30, 30, 20)];
    const edge = lat.edges[node.edges[0]];
    const mid = { x: (lat.nodes[edge.a].x + lat.nodes[edge.b].x) / 2, z: (lat.nodes[edge.a].z + lat.nodes[edge.b].z) / 2 };
    for (const p of [{ x: node.x, z: node.z }, mid]) {
      for (const minRadius of [0, 6]) {
        const loop = planEnclosure(lat, { ...p, minRadius, cost: free });
        expect(loop).not.toBeNull();
        if (!loop) continue;
        expectSimpleCcwCycle(loop);
        expect(enclosedWhenHeld(loop, false)[lat.facetAt(p.x, p.z)]).toBe(1);
      }
    }
  });

  it('returns null when no loop exists', () => {
    // No room between the band and the map corner.
    expect(planEnclosure(lat, { x: 138, z: 138, minRadius: 30, cost: free })).toBeNull();
    // Everything impassable.
    expect(planEnclosure(lat, { x: 0, z: 0, minRadius: 5, cost: () => Infinity })).toBeNull();
    // A wall of impassable nodes from the inner disk to the border cuts every loop.
    const wall: NodeCost = (n) => (Math.abs(lat.nodes[n].z) < 9 && lat.nodes[n].x > -20 ? Infinity : 1);
    expect(planEnclosure(lat, { x: 0, z: 0, minRadius: 12, cost: wall })).toBeNull();
    // Off the lattice.
    expect(planEnclosure(lat, { x: 400, z: 0, minRadius: 5, cost: free })).toBeNull();
  });

  it('plans across the whole burn within budget', () => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) planEnclosure(lat, { x: 0, z: 0, minRadius: 20, cost: free });
    for (const c of [...cases, { x: 20, z: -10, minRadius: 45 }, { x: -60, z: 30, minRadius: 30 }]) {
      const t = performance.now();
      expect(planEnclosure(lat, { ...c, cost: free })).not.toBeNull();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(30);
  });
});

describe('planRing', () => {
  it('plans a home ring around every camp inside the first band', () => {
    for (const f of FACTION_IDS) {
      const { x, z } = CAMP_CENTERS[f];
      const ring = planRing(lat, x, z, START_HOME_RING_RADIUS, free);
      expect(ring).not.toBeNull();
      if (!ring) continue;
      expectSimpleCcwCycle(ring);
      for (const n of ring) {
        expect(radiusOf(n, x, z)).toBeGreaterThanOrEqual(START_HOME_RING_RADIUS);
        expect(radiusOf(n, x, z)).toBeLessThanOrEqual(START_HOME_RING_RADIUS + 2.5 * lat.edge);
      }
      expect(enclosedWhenHeld(ring, true)[lat.facetAt(x, z)]).toBe(1);
    }
  });

  it('falls back to a wider band when the first one is cut', () => {
    const { x, z } = CAMP_CENTERS[1];
    const outer = START_HOME_RING_RADIUS + 2.5 * lat.edge;
    // Block the whole first band across one sector.
    const cut: NodeCost = (n) => {
      const node = lat.nodes[n];
      const r = Math.hypot(node.x - x, node.z - z);
      return r <= outer + 1 && node.z - z > -10 && node.z - z < 10 && node.x < x ? Infinity : free(n);
    };
    const ring = planRing(lat, x, z, START_HOME_RING_RADIUS, cut);
    expect(ring).not.toBeNull();
    if (!ring) return;
    expect(Math.max(...ring.map((n) => radiusOf(n, x, z)))).toBeGreaterThan(outer);
    expect(enclosedWhenHeld(ring, false)[lat.facetAt(x, z)]).toBe(1);
  });
});
