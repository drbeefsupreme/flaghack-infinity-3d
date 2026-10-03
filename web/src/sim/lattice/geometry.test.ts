import { describe, expect, it } from 'vitest';
import { IMPLIED_MAX_ORDER } from '../constants';
import { PHI } from '../math';
import { Rng } from '../rng';
import {
  computeCrystallized,
  computeEnclosure,
  computeHolders,
  computeLeyLines,
  criticalNodes,
  enclosureBoundary,
  findFocusNodes,
  perpStrain,
  susceptibility,
} from './geometry';
import { Lattice } from './lattice';
import { planEnclosure } from './planner';
import { IMPLIED_REACH } from './topology';

interface Triple {
  a: number;
  b: number;
  m: number;
}

/**
 * Exact midpoint triples from 5D Ley coordinates: positions are s·Σ k_j e_j and the only
 * integer relation among the e_j is Σ e_j = 0, so m is the midpoint of a and b iff
 * k_a + k_b - 2·k_m is a multiple of (1,1,1,1,1). Independent of the geometric search.
 */
function exactTriples(lat: Lattice): Triple[] {
  const byK = new Map<string, number>();
  for (const n of lat.nodes) byK.set(n.k.join(','), n.id);
  const out: Triple[] = [];
  for (const A of lat.nodes) {
    for (const b of lat.nodesInRadius(A.x, A.z, IMPLIED_REACH * lat.edge + 1e-6)) {
      if (b <= A.id) continue;
      const sum = A.k.map((v, j) => v + lat.nodes[b].k[j]);
      for (let c = -8; c <= 8; c++) {
        if (sum.some((v) => (v - c) % 2 !== 0)) continue;
        const m = byK.get(sum.map((v) => (v - c) / 2).join(','));
        if (m !== undefined) out.push({ a: A.id, b, m });
      }
    }
  }
  return out;
}

/**
 * The implied-Flag rule read literally: every round, each pair of same-faction held nodes
 * claims its free, unblocked midpoint; rivals claiming one node in the same round leave it
 * empty for good.
 */
function referenceHolders(lat: Lattice, triples: Triple[], realOwner: Int8Array, maxOrder: number) {
  const holder = Array.from(realOwner, (o) => (o >= 0 ? o : -1));
  const order = holder.map(() => 0);
  const dead = new Set<number>();
  for (let k = 1; k <= maxOrder; k++) {
    const claims = new Map<number, Set<number>>();
    for (const { a, b, m } of triples) {
      const f = holder[a];
      if (f < 0 || holder[b] !== f) continue;
      if (realOwner[m] !== -1 || holder[m] !== -1 || lat.nodes[m].blocked || dead.has(m)) continue;
      const set = claims.get(m) ?? new Set<number>();
      set.add(f);
      claims.set(m, set);
    }
    for (const [m, fs] of claims) {
      if (fs.size > 1) {
        dead.add(m);
        continue;
      }
      for (const f of fs) holder[m] = f;
      order[m] = k;
    }
  }
  return { holder, order, interfered: dead.size };
}

function owners(lat: Lattice, ...groups: [number, number[]][]): Int8Array {
  const out = new Int8Array(lat.nodes.length).fill(-1);
  for (const [faction, nodes] of groups) for (const n of nodes) out[n] = faction;
  return out;
}

function survey(lat: Lattice, realOwner: Int8Array, maxOrder = IMPLIED_MAX_ORDER) {
  const n = lat.nodes.length;
  const holder = new Int8Array(n);
  const impliedOwner = new Int8Array(n);
  const impliedOrder = new Uint8Array(n);
  computeHolders(lat, realOwner, holder, impliedOwner, impliedOrder, maxOrder);
  const ley = new Int8Array(lat.edges.length);
  computeLeyLines(lat, holder, ley);
  return { holder, impliedOwner, impliedOrder, ley };
}

function enclosedBy(lat: Lattice, ley: Int8Array, faction: number): Uint8Array {
  const out = new Uint8Array(lat.facets.length);
  computeEnclosure(lat, ley, faction, out);
  return out;
}

function stillEnclosed(lat: Lattice, realOwner: Int8Array, faction: number, facet: number): boolean {
  return enclosedBy(lat, survey(lat, realOwner).ley, faction)[facet] === 1;
}

function distance(lat: Lattice, a: number, b: number): number {
  return Math.hypot(lat.nodes[a].x - lat.nodes[b].x, lat.nodes[a].z - lat.nodes[b].z);
}

function medianMs(runs: number, fn: () => void): number {
  for (let i = 0; i < 5; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)];
}

/** Interior node's link: the facet edges around it that do not touch it (a closed loop). */
function linkEdges(lat: Lattice, v: number): number[] {
  const out: number[] = [];
  for (const f of lat.nodes[v].facets) {
    for (const e of lat.facets[f].edges) if (lat.edges[e].a !== v && lat.edges[e].b !== v) out.push(e);
  }
  return out;
}

describe('implied Flag fractal', () => {
  const lat = Lattice.generate('test-seed');
  const triples = exactTriples(lat);
  const asParent = new Map<number, Triple[]>();
  for (const t of triples) {
    for (const p of [t.a, t.b]) asParent.set(p, [...(asParent.get(p) ?? []), t]);
  }

  it('fills the midpoint of straight runs at scale 1 and scale φ', () => {
    const scale1 = triples.find((t) => Math.abs(distance(lat, t.a, t.b) - 2 * lat.edge) < 1e-6);
    const scalePhi = triples.find((t) => Math.abs(distance(lat, t.a, t.b) - 2 * PHI * lat.edge) < 1e-6);
    expect(scale1).toBeDefined();
    expect(scalePhi).toBeDefined();
    for (const t of [scale1, scalePhi]) {
      if (!t) continue;
      const s = survey(lat, owners(lat, [2, [t.a, t.b]]));
      expect([s.holder[t.m], s.impliedOwner[t.m], s.impliedOrder[t.m]]).toEqual([2, 2, 1]);
      // Every implied Flag sits on an exact midpoint of two holders.
      for (let n = 0; n < lat.nodes.length; n++) {
        if (s.impliedOwner[n] < 0) continue;
        expect(triples.some((u) => u.m === n && s.holder[u.a] === 2 && s.holder[u.b] === 2)).toBe(true);
      }
    }
    // A scale-1 run becomes two Ley Lines from two real Flags.
    if (scale1) {
      const s = survey(lat, owners(lat, [0, [scale1.a, scale1.b]]));
      expect(s.ley[lat.edgeBetween(scale1.a, scale1.m)]).toBe(0);
      expect(s.ley[lat.edgeBetween(scale1.m, scale1.b)]).toBe(0);
    }
  });

  it('cascades to orders 2 and 3, stops at maxOrder and vanishes with a parent', () => {
    let checked = 0;
    for (const t1 of triples) {
      for (const t2 of asParent.get(t1.m) ?? []) {
        const c = t2.a === t1.m ? t2.b : t2.a;
        for (const t3 of asParent.get(t2.m) ?? []) {
          const d = t3.a === t2.m ? t3.b : t3.a;
          const nodes = [t1.a, t1.b, c, d, t1.m, t2.m, t3.m];
          if (new Set(nodes).size !== nodes.length) continue;
          const real = owners(lat, [1, [t1.a, t1.b, c, d]]);
          const pulled = owners(lat, [1, [t1.b, c, d]]);
          const ref = referenceHolders(lat, triples, real, 3);
          const refPulled = referenceHolders(lat, triples, pulled, 3);
          // Only clean chains: no shortcut gives a lower order or survives the pull.
          if (ref.order[t1.m] !== 1 || ref.order[t2.m] !== 2 || ref.order[t3.m] !== 3) continue;
          if ([t1.m, t2.m, t3.m].some((m) => refPulled.holder[m] !== -1)) continue;
          const s = survey(lat, real, 3);
          expect([s.impliedOrder[t1.m], s.impliedOrder[t2.m], s.impliedOrder[t3.m]]).toEqual([1, 2, 3]);
          expect([s.holder[t1.m], s.holder[t2.m], s.holder[t3.m]]).toEqual([1, 1, 1]);
          expect(survey(lat, real, 2).holder[t3.m]).toBe(-1);
          // Pull a root parent: the whole cascade goes with it.
          const sp = survey(lat, pulled, 3);
          expect([sp.holder[t1.m], sp.holder[t2.m], sp.holder[t3.m]]).toEqual([-1, -1, -1]);
          if (++checked >= 12) return;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('never lands on blocked, occupied or neutral nodes', () => {
    const t = triples[0];
    const node = lat.nodes[t.m];
    node.blocked = true;
    try {
      const s = survey(lat, owners(lat, [0, [t.a, t.b]]));
      expect(s.holder[t.m]).toBe(-1);
    } finally {
      node.blocked = false;
    }
    const occupied = survey(lat, owners(lat, [0, [t.a, t.b]], [3, [t.m]]));
    expect([occupied.holder[t.m], occupied.impliedOwner[t.m]]).toEqual([3, -1]);
    const neutral = owners(lat, [0, [t.a, t.b]]);
    neutral[t.m] = -2;
    const sn = survey(lat, neutral);
    expect([sn.holder[t.m], sn.impliedOwner[t.m]]).toEqual([-1, -1]);
  });

  it('leaves a node empty when two factions imply it in the same round', () => {
    const byMid = new Map<number, Triple[]>();
    for (const t of triples) byMid.set(t.m, [...(byMid.get(t.m) ?? []), t]);
    const pair = [...byMid.values()].find((ts) =>
      ts.some((p) => ts.some((q) => new Set([p.a, p.b, q.a, q.b]).size === 4)),
    );
    expect(pair).toBeDefined();
    if (!pair) return;
    const p = pair[0];
    const q = pair.find((u) => new Set([p.a, p.b, u.a, u.b]).size === 4);
    if (!q) return;
    const s = survey(lat, owners(lat, [0, [p.a, p.b]], [1, [q.a, q.b]]));
    expect([s.holder[p.m], s.impliedOwner[p.m]]).toEqual([-1, -1]);
    // Without the rival's second Flag the node is ours.
    const solo = survey(lat, owners(lat, [0, [p.a, p.b]], [1, [q.a]]));
    expect(solo.holder[p.m]).toBe(0);
  });

  it('matches the literal rule on dense random camps', () => {
    const fuzz = Lattice.generate('fuzz-seed');
    const fuzzTriples = exactTriples(fuzz);
    const fuzzAsParent = new Map<number, Triple[]>();
    for (const t of fuzzTriples) {
      for (const p of [t.a, t.b]) fuzzAsParent.set(p, [...(fuzzAsParent.get(p) ?? []), t]);
    }
    const rng = new Rng('implied-fuzz');
    let cascaded = 0;
    let interfered = 0;
    for (let round = 0; round < 40; round++) {
      const cx = rng.range(-100, 100);
      const cz = rng.range(-100, 100);
      const radius = rng.range(25, 50);
      const inside = new Set(fuzz.nodesInRadius(cx, cz, radius));
      const local = fuzzTriples.filter((t) => inside.has(t.a) && inside.has(t.b) && inside.has(t.m));
      const real = new Int8Array(fuzz.nodes.length).fill(-1);
      // Plant both ends of random straight runs, often extending the run's midpoint into a
      // further run (a cascade): rivals sharing a midpoint interfere, chains climb orders.
      for (let i = rng.int(4, 24); i > 0; i--) {
        let t = rng.pick(local);
        const f = rng.int(0, 2);
        real[t.a] = f;
        real[t.b] = f;
        for (let depth = 0; depth < 2 && rng.chance(0.75); depth++) {
          const next = (fuzzAsParent.get(t.m) ?? []).filter((u) => inside.has(u.a) && inside.has(u.b) && inside.has(u.m));
          if (next.length === 0) break;
          const u = rng.pick(next);
          real[u.a === t.m ? u.b : u.a] = f;
          t = u;
        }
      }
      const blocked: number[] = [];
      for (const n of inside) {
        if (real[n] !== -1) continue;
        const r = rng.next();
        if (r < 0.03) real[n] = -2;
        else if (r < 0.06) blocked.push(n);
      }
      for (const n of blocked) fuzz.nodes[n].blocked = true;
      try {
        const ref = referenceHolders(fuzz, fuzzTriples, real, IMPLIED_MAX_ORDER);
        const s = survey(fuzz, real);
        expect(Array.from(s.holder)).toEqual(ref.holder);
        expect(Array.from(s.impliedOrder)).toEqual(ref.order);
        expect(Array.from(s.impliedOwner)).toEqual(ref.order.map((o, n) => (o > 0 ? ref.holder[n] : -1)));
        cascaded += ref.order.filter((o) => o >= 2).length;
        interfered += ref.interfered;
      } finally {
        for (const n of blocked) fuzz.nodes[n].blocked = false;
      }
    }
    expect(cascaded).toBeGreaterThan(10);
    expect(interfered).toBeGreaterThan(10);
  });

  it('stays exact while phason flips re-tile the lattice under it', () => {
    const flipped = Lattice.generate('flip-fuzz');
    const rng = new Rng('flip-fuzz');
    const real = new Int8Array(flipped.nodes.length).fill(-1);
    for (let check = 0; check < 5; check++) {
      // Flip one node at a time with a survey in between, as tides and abilities do.
      for (let i = 0; i < 25; i++) {
        flipped.flip(rng.int(0, flipped.nodes.length - 1));
        survey(flipped, real);
      }
      // Dense camps hold both ends of many midpoint pairs, so a stale or missing midpoint
      // entry anywhere on the lattice shows up as a wrong holder.
      const fresh = exactTriples(flipped);
      for (let n = 0; n < real.length; n++) {
        const r = rng.next();
        real[n] = r < 0.45 ? 0 : r < 0.6 ? 1 : -1;
      }
      const ref = referenceHolders(flipped, fresh, real, IMPLIED_MAX_ORDER);
      const s = survey(flipped, real);
      expect(Array.from(s.holder)).toEqual(ref.holder);
      expect(Array.from(s.impliedOrder)).toEqual(ref.order);
    }
    expect(flipped.version).toBeGreaterThan(20);
  });

  it('recomputes 4 factions × 60 Flags well inside a millisecond', () => {
    const rng = new Rng('holders-bench');
    const real = new Int8Array(lat.nodes.length).fill(-1);
    for (let f = 0; f < 4; f++) {
      for (let placed = 0; placed < 60; ) {
        const n = rng.int(0, lat.nodes.length - 1);
        if (real[n] !== -1) continue;
        real[n] = f;
        placed++;
      }
    }
    const n = lat.nodes.length;
    const holder = new Int8Array(n);
    const impliedOwner = new Int8Array(n);
    const impliedOrder = new Uint8Array(n);
    const ms = medianMs(41, () => computeHolders(lat, real, holder, impliedOwner, impliedOrder, IMPLIED_MAX_ORDER));
    expect(ms).toBeLessThan(2);
  });
});

describe('Ley Lines, crystals and enclosure', () => {
  const lat = Lattice.generate('test-seed');

  it('a hand-made loop encloses exactly its interior facets', () => {
    const interior = lat.nodes.filter((n) => !n.boundary && n.facets.every((f) => !lat.facets[f].boundary));
    for (const v of [lat.omegaNode, ...interior.slice(0, 400).filter((_, i) => i % 40 === 0).map((n) => n.id)]) {
      const loop = linkEdges(lat, v);
      const ley = new Int8Array(lat.edges.length).fill(-1);
      for (const e of loop) ley[e] = 3;
      const out = new Uint8Array(lat.facets.length);
      expect(computeEnclosure(lat, ley, 3, out)).toBe(lat.nodes[v].facets.length);
      const enclosed = [...out.keys()].filter((f) => out[f] === 1);
      expect(enclosed.sort((a, b) => a - b)).toEqual([...lat.nodes[v].facets].sort((a, b) => a - b));
      // The boundary of that component is the loop itself.
      expect(enclosureBoundary(lat, out, enclosed[0]).sort((a, b) => a - b)).toEqual(loop.sort((a, b) => a - b));
      // A rival's lines enclose nothing for us, and an open loop encloses nothing.
      expect(computeEnclosure(lat, ley, 1, out)).toBe(0);
      ley[loop[0]] = -1;
      expect(computeEnclosure(lat, ley, 3, out)).toBe(0);
      expect(enclosureBoundary(lat, out, enclosed[0])).toEqual([]);
    }
  });

  it('a single crystallized facet is enclosed, inland or on the map border', () => {
    const inland = lat.facets.find((f) => !f.boundary && Math.hypot(f.cx, f.cz) > 30);
    const border = lat.facets.find((f) => f.boundary);
    expect(inland).toBeDefined();
    expect(border).toBeDefined();
    for (const facet of [inland, border]) {
      if (!facet) continue;
      const s = survey(lat, owners(lat, [1, facet.nodes]));
      const crystal = new Int8Array(lat.facets.length);
      computeCrystallized(lat, s.holder, crystal);
      expect([...crystal.keys()].filter((f) => crystal[f] >= 0)).toEqual([facet.id]);
      expect(crystal[facet.id]).toBe(1);
      for (const e of facet.edges) expect(s.ley[e]).toBe(1);
      const out = new Uint8Array(lat.facets.length);
      expect(computeEnclosure(lat, s.ley, 1, out)).toBe(1);
      expect(out[facet.id]).toBe(1);
      expect(enclosureBoundary(lat, out, facet.id).sort((a, b) => a - b)).toEqual([...facet.edges].sort((a, b) => a - b));
    }
  });

  it('floods the full lattice well inside its budget', () => {
    const loop = planEnclosure(lat, { x: 0, z: 0, minRadius: 40, cost: () => 1 });
    expect(loop).not.toBeNull();
    const s = survey(lat, owners(lat, [0, loop ?? []]));
    const out = new Uint8Array(lat.facets.length);
    expect(medianMs(101, () => computeEnclosure(lat, s.ley, 0, out))).toBeLessThan(0.6);
  });
});

describe('critical nodes', () => {
  const lat = Lattice.generate('test-seed');
  const target = { x: 22, z: -18 };
  const facet = lat.facetAt(target.x, target.z);
  const free = () => 1;

  /** criticalNodes must name exactly the Flags whose pull opens the facet. */
  function expectExact(real: Int8Array, faction: number, held: number[]): number[] {
    const crit = criticalNodes(lat, real, faction, facet, IMPLIED_MAX_ORDER);
    for (const n of held) {
      const pulled = real.slice();
      pulled[n] = -1;
      expect(stillEnclosed(lat, pulled, faction, facet), `node ${n}`).toBe(!crit.includes(n));
    }
    return crit;
  }

  it('names exactly the Flags whose loss opens a single loop', () => {
    const loop = planEnclosure(lat, { ...target, minRadius: 14, cost: free });
    expect(loop).not.toBeNull();
    if (!loop) return;
    const real = owners(lat, [2, loop]);
    expect(stillEnclosed(lat, real, 2, facet)).toBe(true);
    const crit = expectExact(real, 2, loop);
    expect(crit.length).toBeGreaterThan(loop.length / 2);
  });

  it('a double-thick wall has no critical Flag; a doubled section only shields its own nodes', () => {
    const inner = planEnclosure(lat, { ...target, minRadius: 14, cost: free });
    expect(inner).not.toBeNull();
    if (!inner) return;
    const innerSet = new Set(inner);
    const reach = Math.max(...inner.map((n) => Math.hypot(lat.nodes[n].x - target.x, lat.nodes[n].z - target.z)));
    const outer = planEnclosure(lat, { ...target, minRadius: reach + 10, cost: (n) => (innerSet.has(n) ? Infinity : 1) });
    expect(outer).not.toBeNull();
    if (!outer) return;
    const both = owners(lat, [0, [...inner, ...outer]]);
    expect(expectExact(both, 0, [...inner, ...outer])).toEqual([]);

    // Reroute a short stretch of the inner loop: the detour and the stretch it bypasses back
    // each other up, the rest of the wall stays critical.
    const banned = new Set(inner.slice(0, 3));
    const detour = planEnclosure(lat, {
      ...target,
      minRadius: 14,
      cost: (n) => (banned.has(n) ? Infinity : innerSet.has(n) ? 0 : 1),
    });
    expect(detour).not.toBeNull();
    if (!detour) return;
    const wall = [...new Set([...inner, ...detour])];
    const crit = expectExact(owners(lat, [0, wall]), 0, wall);
    expect(crit.length).toBeGreaterThan(0);
    expect(crit.length).toBeLessThan(wall.length);
    for (const n of banned) expect(crit).not.toContain(n);
  });

  it('names the remote real parents of an implied wall Flag', () => {
    const loop = planEnclosure(lat, { ...target, minRadius: 14, cost: free });
    if (!loop) throw new Error('no loop');
    const onLoop = new Set(loop);
    let found = false;
    for (const t of exactTriples(lat)) {
      if (!onLoop.has(t.m) || onLoop.has(t.a) || onLoop.has(t.b)) continue;
      // The wall node is no longer planted: two Flags elsewhere imply it.
      const held = [...loop.filter((n) => n !== t.m), t.a, t.b];
      const real = owners(lat, [0, held]);
      if (!stillEnclosed(lat, real, 0, facet)) continue;
      const crit = expectExact(real, 0, held);
      if (!crit.includes(t.a) && !crit.includes(t.b)) continue;
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('orders cheapest-to-break first and ignores open facets', () => {
    const loop = planEnclosure(lat, { ...target, minRadius: 14, cost: free });
    if (!loop) throw new Error('no loop');
    const real = owners(lat, [1, loop]);
    const s = survey(lat, real);
    const crit = criticalNodes(lat, real, 1, facet, IMPLIED_MAX_ORDER);
    const fc = lat.facets[facet];
    const key = (n: number) => [
      lat.nodes[n].edges.filter((e) => s.ley[e] === 1).length,
      Math.hypot(lat.nodes[n].x - fc.cx, lat.nodes[n].z - fc.cz),
    ];
    for (let i = 1; i < crit.length; i++) {
      const [la, da] = key(crit[i - 1]);
      const [lb, db] = key(crit[i]);
      expect(la < lb || (la === lb && da <= db)).toBe(true);
    }
    const outside = lat.facetAt(target.x + 60, target.z);
    expect(criticalNodes(lat, real, 1, outside, IMPLIED_MAX_ORDER)).toEqual([]);
    expect(criticalNodes(lat, real, 0, facet, IMPLIED_MAX_ORDER)).toEqual([]);
  });

  it('analyses a 30-node loop within budget', () => {
    let radius = 20;
    let loop = planEnclosure(lat, { ...target, minRadius: radius, cost: free });
    while (loop && loop.length < 30) loop = planEnclosure(lat, { ...target, minRadius: (radius += 2), cost: free });
    if (!loop) throw new Error('no loop');
    const real = owners(lat, [3, loop]);
    expect(medianMs(9, () => criticalNodes(lat, real, 3, facet, IMPLIED_MAX_ORDER))).toBeLessThan(16);
  });
});

describe('phason strain', () => {
  it('records one convex acceptance window per index, pentagon-sized', () => {
    const lat = Lattice.generate('test-seed');
    expect(lat.perpWindows.map((w) => w.index)).toEqual([1, 2, 3, 4]);
    for (const w of lat.perpWindows) {
      expect(w.xs.length).toBeGreaterThanOrEqual(5);
      for (let i = 0; i < w.xs.length; i++) {
        const j = (i + 1) % w.xs.length;
        const k = (i + 2) % w.xs.length;
        const turn = (w.xs[j] - w.xs[i]) * (w.ys[k] - w.ys[i]) - (w.ys[j] - w.ys[i]) * (w.xs[k] - w.xs[i]);
        expect(turn).toBeGreaterThan(0);
      }
    }
    // Index 1/4 windows are the small pentagon, 2/3 the large one: inradii in ratio φ.
    const [w1, w2, w3, w4] = lat.perpWindows;
    expect(Math.abs(w2.inradius / w1.inradius - PHI)).toBeLessThan(0.12);
    expect(Math.abs(w3.inradius / w4.inradius - PHI)).toBeLessThan(0.12);
  });

  it('a fresh lattice is strain-free with susceptibility spread over [0, 1]', () => {
    const lat = Lattice.generate('strain-seed');
    let low = 0;
    let high = 0;
    for (let n = 0; n < lat.nodes.length; n++) {
      expect(perpStrain(lat, n)).toBe(0);
      const s = susceptibility(lat, n);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      if (s < 0.4) low++;
      if (s > 0.8) high++;
    }
    expect(low).toBeGreaterThan(50);
    expect(high).toBeGreaterThan(50);
  });

  it('flips strain the moved node, flipping back heals it, storms leave strain behind', () => {
    const lat = Lattice.generate('strain-seed');
    const v = lat.nodes.find((n) => lat.flippable(n.id))?.id ?? -1;
    expect(lat.flip(v)).not.toBeNull();
    expect(perpStrain(lat, v)).toBeGreaterThan(0);
    expect(susceptibility(lat, v)).toBe(1);
    for (let n = 0; n < lat.nodes.length; n++) if (n !== v) expect(perpStrain(lat, n)).toBe(0);
    lat.flip(v);
    expect(perpStrain(lat, v)).toBe(0);

    for (let i = 0; i < 300; i++) lat.flip((i * 7919) % lat.nodes.length);
    const strained = lat.nodes.filter((n) => perpStrain(lat, n.id) > 0).length;
    expect(strained).toBeGreaterThan(20);
  });
});

describe('Crystal focus points', () => {
  it('finds the Omega Node among the focus points and reuses the output array', () => {
    const lat = Lattice.generate('test-seed');
    const out = [123456];
    const foci = findFocusNodes(lat, out);
    expect(foci).toBe(out);
    expect(foci).not.toContain(123456);
    expect(foci).toContain(lat.omegaNode);
    expect(foci.length).toBeGreaterThan(20);
  });
});
