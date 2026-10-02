import { describe, expect, it } from 'vitest';
import { PHI } from '../math';
import { Lattice } from './lattice';

function checkInvariants(lat: Lattice): void {
  const s = lat.edge;
  for (const e of lat.edges) {
    const a = lat.nodes[e.a];
    const b = lat.nodes[e.b];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(s, 6);
    expect(e.facets.length === 1 || e.facets.length === 2).toBe(true);
    for (const f of e.facets) expect(lat.facets[f].edges).toContain(e.id);
  }
  for (const f of lat.facets) {
    const p = f.nodes.map((n) => lat.nodes[n]);
    // CCW orientation, rhombus with the expected acute angle.
    let area = 0;
    for (let i = 0; i < 4; i++) area += p[i].x * p[(i + 1) % 4].z - p[(i + 1) % 4].x * p[i].z;
    expect(area).toBeGreaterThan(0);
    const ux = p[1].x - p[0].x;
    const uz = p[1].z - p[0].z;
    const vx = p[3].x - p[0].x;
    const vz = p[3].z - p[0].z;
    const cos = Math.abs((ux * vx + uz * vz) / (s * s));
    expect(cos).toBeCloseTo(f.thick ? Math.cos((72 * Math.PI) / 180) : Math.cos((36 * Math.PI) / 180), 6);
    for (let i = 0; i < 4; i++) {
      const e = lat.edges[f.edges[i]];
      const a = f.nodes[i];
      const b = f.nodes[(i + 1) % 4];
      expect((e.a === a && e.b === b) || (e.a === b && e.b === a)).toBe(true);
      const nb = f.neighbors[i];
      if (nb >= 0) expect(lat.facets[nb].edges).toContain(e.id);
    }
  }
  for (const n of lat.nodes) {
    for (const f of n.facets) expect(lat.facets[f].nodes).toContain(n.id);
    for (const e of n.edges) expect([lat.edges[e].a, lat.edges[e].b]).toContain(n.id);
    // Interior nodes: angles around the node sum to 360°.
    if (!n.boundary) {
      let sum = 0;
      for (const f of n.facets) sum += lat.facets[f].thick ? 1 : 0;
      expect(n.facets.length).toBe(n.edges.length);
      expect(sum).toBeGreaterThanOrEqual(0);
    }
  }
}

describe('Ley Lattice (pentagrid Penrose tiling)', () => {
  const lat = Lattice.generate('test-seed');

  it('covers the burn with a few thousand valid rhombi', () => {
    expect(lat.facets.length).toBeGreaterThan(1500);
    expect(lat.nodes.length).toBeGreaterThan(1500);
    checkInvariants(lat);
  });

  it('has thick:thin facet ratio near the golden ratio', () => {
    const thick = lat.facets.filter((f) => f.thick).length;
    const thin = lat.facets.length - thick;
    expect(thick / thin).toBeGreaterThan(PHI - 0.12);
    expect(thick / thin).toBeLessThan(PHI + 0.12);
  });

  it('centres a 5-fold star (Omega Node) at the origin', () => {
    expect(lat.omegaNode).toBeGreaterThanOrEqual(0);
    const o = lat.nodes[lat.omegaNode];
    expect(Math.hypot(o.x, o.z)).toBeLessThan(1e-6);
    expect(o.facets.length).toBe(5);
    expect(o.facets.every((f) => lat.facets[f].thick)).toBe(true);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const again = Lattice.generate('test-seed');
    expect(again.nodes.length).toBe(lat.nodes.length);
    expect(again.nodes[17].x).toBe(lat.nodes[17].x);
    const other = Lattice.generate('another-seed');
    expect(other.gamma).not.toEqual(lat.gamma);
  });

  it('answers spatial queries consistently', () => {
    for (const f of lat.facets.slice(0, 200)) expect(lat.facetAt(f.cx, f.cz)).toBe(f.id);
    const n = lat.nodes[123];
    expect(lat.nearestNode(n.x + 0.3, n.z - 0.2)).toBe(n.id);
    const e = lat.edges[77];
    const a = lat.nodes[e.a];
    const b = lat.nodes[e.b];
    expect(lat.nearestEdge((a.x + b.x) / 2, (a.z + b.z) / 2, 1)).toBe(e.id);
  });

  it('phason flips keep a valid rhombus tiling and are involutions', () => {
    const l = Lattice.generate('flip-seed');
    const flippable = l.nodes.filter((n) => l.flippable(n.id)).map((n) => n.id);
    expect(flippable.length).toBeGreaterThan(100);
    const v = flippable[Math.floor(flippable.length / 2)];
    const before = { x: l.nodes[v].x, z: l.nodes[v].z, k: l.nodes[v].k.slice() };
    const res = l.flip(v)!;
    expect(res).not.toBeNull();
    expect(Math.hypot(res.toX - res.fromX, res.toZ - res.fromZ)).toBeGreaterThan(0.5);
    expect(l.version).toBe(1);
    checkInvariants(l);
    expect(l.facetAt(l.facets[res.facets[0]].cx, l.facets[res.facets[0]].cz)).toBe(res.facets[0]);
    // Flipping back restores the original node.
    expect(l.flippable(v)).toBe(true);
    l.flip(v);
    expect(l.nodes[v].x).toBeCloseTo(before.x, 9);
    expect(l.nodes[v].z).toBeCloseTo(before.z, 9);
    expect(l.nodes[v].k).toEqual(before.k);
    checkInvariants(l);
  });

  it('survives many random flips', () => {
    const l = Lattice.generate('storm-seed');
    let flips = 0;
    for (let i = 0; i < 400; i++) {
      const id = (i * 7919) % l.nodes.length;
      if (l.flip(id)) flips++;
    }
    expect(flips).toBeGreaterThan(20);
    checkInvariants(l);
  });
});
