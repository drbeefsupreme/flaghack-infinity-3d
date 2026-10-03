import { describe, expect, it } from 'vitest';
import { CAMP_CENTERS, MAP_HALF, PILE_COUNT } from '../constants';
import { Lattice } from '../lattice/lattice';
import { NavGrid } from '../nav/navgrid';
import { FACTION_IDS } from '../types';
import {
  CAMP_CLEAR_RADIUS,
  EFFIGY_HEIGHT,
  EFFIGY_RADIUS,
  FAIR_RADIUS,
  footprintDistance,
  generateMap,
  OBSTACLE_PAD,
  PILE_CAMP_MIN_DIST,
  PLAZA_RADIUS,
  SOUND_CAMP_NAMES,
  SOUND_CAMP_RADIUS,
} from './mapgen';
import type { MapLayout, Obstacle } from './mapgen';

const SEEDS = ['alchemy', 'flagistan', 'tartaria', 'noosphere', 'omega-config', 'chronoschism'];

function layoutData(m: MapLayout): string {
  return JSON.stringify([m.obstacles, m.roads, m.water, m.mud, m.soundCamps, m.pileSpots, m.neutralSpawns]);
}

/** R^k with R(x, z) = (z, -x): camp 0 → 1 → 2 → 3. */
function rotate(x: number, z: number, k: number): [number, number] {
  let rx = x;
  let rz = z;
  for (let i = 0; i < k; i++) [rx, rz] = [rz, -rx];
  return [rx, rz];
}

describe('burn map generator', () => {
  const maps = SEEDS.map((s) => generateMap(s));

  it('is deterministic per seed and differs across seeds', () => {
    expect(layoutData(generateMap('alchemy'))).toBe(layoutData(maps[0]));
    expect(layoutData(maps[1])).not.toBe(layoutData(maps[0]));
    const probe = generateMap('alchemy');
    for (let i = 0; i < 500; i++) {
      const x = ((i * 37) % 300) - 150;
      const z = ((i * 91) % 300) - 150;
      expect(probe.isBlockedAt(x, z)).toBe(maps[0].isBlockedAt(x, z));
      expect(probe.groundAt(x, z)).toBe(maps[0].groundAt(x, z));
    }
  });

  it('keeps every conquest corridor clear, with the camp clutter in the corner behind it', () => {
    for (const m of maps) {
      for (const f of FACTION_IDS) {
        const c = CAMP_CENTERS[f];
        for (const o of m.obstacles) expect(footprintDistance(o, c.x, c.z)).toBeGreaterThan(CAMP_CLEAR_RADIUS + OBSTACLE_PAD);
        for (let r = 0; r <= CAMP_CLEAR_RADIUS; r += 2) {
          for (let a = 0; a < 64; a++) {
            const x = c.x + Math.cos((a / 64) * Math.PI * 2) * r;
            const z = c.z + Math.sin((a / 64) * Math.PI * 2) * r;
            expect(m.isBlockedAt(x, z)).toBe(false);
          }
        }
        // The camp's shade sits within 40° of the corner direction, just past the corridor,
        // with at least two tents around it.
        const ux = Math.sign(c.x) / Math.SQRT2;
        const uz = Math.sign(c.z) / Math.SQRT2;
        const shade = m.obstacles.find((o) => {
          const d = Math.hypot(o.x - c.x, o.z - c.z);
          const along = (o.x - c.x) * ux + (o.z - c.z) * uz;
          return o.kind === 'shade' && d < CAMP_CLEAR_RADIUS + 18 && along > d * Math.cos((40 * Math.PI) / 180);
        });
        expect(shade, `camp ${f}`).toBeDefined();
        if (!shade) continue;
        const tents = m.obstacles.filter((o) => o.kind === 'tent' && Math.hypot(o.x - shade.x, o.z - shade.z) < 11);
        expect(tents.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('stands the effigy alone on a clear plaza and keeps the Omega Node neighbours plantable', () => {
    for (const [i, m] of maps.entries()) {
      const effigies = m.obstacles.filter((o) => o.kind === 'effigy');
      expect(effigies).toHaveLength(1);
      const e = effigies[0];
      expect([e.x, e.z, e.radius, e.height]).toEqual([0, 0, EFFIGY_RADIUS, EFFIGY_HEIGHT]);
      expect(m.effigy).toEqual({ x: 0, z: 0 });
      for (const o of m.obstacles) if (o !== e) expect(footprintDistance(o, 0, 0)).toBeGreaterThanOrEqual(PLAZA_RADIUS);

      const lat = Lattice.generate(SEEDS[i], { isBlockedAt: m.isBlockedAt });
      const omega = lat.nodes[lat.omegaNode];
      expect(Math.hypot(omega.x, omega.z)).toBeLessThan(1e-6);
      expect(omega.blocked).toBe(true); // The Flag stands on it.
      expect(omega.edges).toHaveLength(5);
      for (const id of omega.edges) {
        const edge = lat.edges[id];
        const n = lat.nodes[edge.a === omega.id ? edge.b : edge.a];
        expect(Math.hypot(n.x, n.z)).toBeCloseTo(lat.edge, 6);
        expect(n.blocked).toBe(false);
      }
    }
  });

  it('copies camp zones under C4 rotation (fairness)', () => {
    /** Camp k's zone: within FAIR_RADIUS of its centre, or beyond it on both axes (its corner). */
    const inZone = (x: number, z: number, k: number): boolean => {
      const c = CAMP_CENTERS[FACTION_IDS[k]];
      return Math.hypot(x - c.x, z - c.z) < FAIR_RADIUS || (x * Math.sign(c.x) > Math.abs(c.x) && z * Math.sign(c.z) > Math.abs(c.z));
    };
    for (const m of maps) {
      let zoned = 0;
      for (const o of m.obstacles) {
        const home = [0, 1, 2, 3].find((k) => inZone(o.x, o.z, k));
        if (home === undefined) continue;
        zoned++;
        // Every zone obstacle has a twin in every other zone; middle-band leaks would not.
        for (let k = 1; k < 4; k++) {
          const [x, z] = rotate(o.x, o.z, k);
          const twin = m.obstacles.find(
            (q) =>
              q !== o &&
              q.kind === o.kind &&
              q.shape === o.shape &&
              Math.abs(q.radius - o.radius) < 1e-9 &&
              Math.abs(q.height - o.height) < 1e-9 &&
              Math.hypot(q.x - x, q.z - z) < 1.5,
          );
          expect(twin, `${o.kind} #${o.id} of zone ${home} rotated ${k}`).toBeDefined();
        }
      }
      expect(zoned).toBeGreaterThan(4 * 40);
    }
  });

  it('builds an Alchemy burn: roads, sound camps, pond, rows, groves and art', () => {
    for (const m of maps) {
      const kinds = new Set(m.obstacles.map((o) => o.kind));
      for (const k of ['tent', 'dome', 'art', 'porta', 'tree', 'stage', 'shade', 'car', 'effigy'] as const) {
        expect(kinds.has(k), k).toBe(true);
      }
      for (const o of m.obstacles) {
        if (o.kind === 'dome') expect(o.radius).toBeGreaterThanOrEqual(4);
        if (o.kind === 'dome') expect(o.radius).toBeLessThanOrEqual(6);
        if (o.kind === 'art') expect([o.radius >= 1.5, o.radius <= 4, o.height >= 3, o.height <= 12]).toEqual([true, true, true, true]);
      }

      // Porta-potty rows of 6-10 (touching units chain into one row).
      const portas = m.obstacles.filter((o) => o.kind === 'porta');
      const seen = new Set<Obstacle>();
      let rows = 0;
      for (const start of portas) {
        if (seen.has(start)) continue;
        rows++;
        let size = 0;
        const stack = [start];
        seen.add(start);
        while (stack.length > 0) {
          const o = stack.pop();
          if (!o) break;
          size++;
          for (const q of portas) {
            if (!seen.has(q) && Math.hypot(q.x - o.x, q.z - o.z) < 1.6) {
              seen.add(q);
              stack.push(q);
            }
          }
        }
        expect(size).toBeGreaterThanOrEqual(6);
        expect(size).toBeLessThanOrEqual(10);
      }
      expect(rows).toBeGreaterThanOrEqual(4);

      // Cars park near the edge; most trees grow near the border.
      for (const o of m.obstacles.filter((q) => q.kind === 'car')) {
        expect(MAP_HALF - Math.max(Math.abs(o.x), Math.abs(o.z))).toBeLessThan(20);
      }
      const trees = m.obstacles.filter((o) => o.kind === 'tree');
      const border = trees.filter((o) => MAP_HALF - Math.max(Math.abs(o.x), Math.abs(o.z)) < 30);
      expect(border.length / trees.length).toBeGreaterThan(0.6);

      // Sound camps: 3-4 named stages with an open dance floor.
      expect(m.soundCamps.length).toBeGreaterThanOrEqual(3);
      expect(m.soundCamps.length).toBeLessThanOrEqual(4);
      expect(new Set(m.soundCamps.map((s) => s.name)).size).toBe(m.soundCamps.length);
      for (const s of m.soundCamps) {
        expect(SOUND_CAMP_NAMES).toContain(s.name);
        expect(s.radius).toBe(SOUND_CAMP_RADIUS);
        expect(m.obstacles.some((o) => o.kind === 'stage' && Math.hypot(o.x - s.x, o.z - s.z) < 22)).toBe(true);
        for (let a = 0; a < 16; a++) {
          expect(m.isBlockedAt(s.x + Math.cos(a) * 7, s.z + Math.sin(a) * 7)).toBe(false);
        }
      }

      // One pond with mud on its shore; water blocks, mud does not.
      expect(m.water).toHaveLength(1);
      const pond = m.water[0];
      expect(m.isBlockedAt(pond.x, pond.z)).toBe(true);
      expect(m.groundAt(pond.x, pond.z)).toBe('water');
      expect(m.mud.length).toBeGreaterThanOrEqual(1);
      for (const mud of m.mud) {
        expect(Math.hypot(mud.x - pond.x, mud.z - pond.z)).toBeLessThan(Math.max(pond.rx, pond.rz) + 2);
      }
      const outside = m.mud.find((mud) => ((mud.x - pond.x) / pond.rx) ** 2 + ((mud.z - pond.z) / pond.rz) ** 2 > 1.4);
      if (outside) expect(m.groundAt(outside.x, outside.z)).toBe('mud');

      // Ring road (closed, r ≈ 62), a spoke into every camp, meandering paths.
      const ring = m.roads[0];
      expect(ring.points[0]).toEqual(ring.points[ring.points.length - 1]);
      for (const p of ring.points) expect(Math.abs(Math.hypot(p.x, p.z) - 62)).toBeLessThan(2);
      for (const f of FACTION_IDS) {
        const c = CAMP_CENTERS[f];
        expect(m.roads.some((r) => r.points.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 8))).toBe(true);
        expect(m.groundAt(c.x * 0.6, c.z * 0.6)).toBe('road');
      }
      expect(m.roads.filter((r) => r.points.length > 4).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('spreads lumber spots and neutral spawns over open ground', () => {
    for (const m of maps) {
      expect(Math.abs(m.pileSpots.length - PILE_COUNT)).toBeLessThanOrEqual(4);
      for (const p of m.pileSpots) {
        expect(m.isBlockedAt(p.x, p.z)).toBe(false);
        for (const o of m.obstacles) expect(footprintDistance(o, p.x, p.z)).toBeGreaterThan(1);
        for (const f of FACTION_IDS) {
          expect(Math.hypot(p.x - CAMP_CENTERS[f].x, p.z - CAMP_CENTERS[f].z)).toBeGreaterThanOrEqual(PILE_CAMP_MIN_DIST);
        }
      }
      // Denser toward the centre: the inner half of the map (by area) holds over half the piles.
      const inner = m.pileSpots.filter((p) => Math.hypot(p.x, p.z) < 100).length;
      expect(inner / m.pileSpots.length).toBeGreaterThan(0.4);

      expect(m.neutralSpawns.length).toBeGreaterThanOrEqual(4);
      for (const s of m.neutralSpawns) {
        expect(m.isBlockedAt(s.x, s.z)).toBe(false);
        expect(m.soundCamps.some((c) => Math.hypot(c.x - s.x, c.z - s.z) <= c.radius)).toBe(true);
      }
    }
  });

  it('never seals a camp: camps and the plaza are mutually reachable on the NavGrid', () => {
    for (const m of maps) {
      const nav = NavGrid.fromMap(m);
      const spots = [...FACTION_IDS.map((f) => CAMP_CENTERS[f]), { x: PLAZA_RADIUS - 4, z: 0 }];
      for (const a of spots) {
        expect(nav.isWalkable(a.x, a.z)).toBe(true);
        for (const b of spots) {
          if (a === b) continue;
          const path = nav.findPath(a.x, a.z, b.x, b.z);
          expect(path, `${a.x},${a.z} → ${b.x},${b.z}`).not.toBeNull();
          const end = path?.[path.length - 1];
          expect(end).toEqual({ x: b.x, z: b.z });
        }
      }
      // Each camp opens toward the burn: most ground in its fairness disk is walkable.
      for (const f of FACTION_IDS) {
        const c = CAMP_CENTERS[f];
        let open = 0;
        let total = 0;
        for (let x = c.x - FAIR_RADIUS; x <= c.x + FAIR_RADIUS; x += 3) {
          for (let z = c.z - FAIR_RADIUS; z <= c.z + FAIR_RADIUS; z += 3) {
            if (Math.hypot(x - c.x, z - c.z) > FAIR_RADIUS || Math.abs(x) > MAP_HALF || Math.abs(z) > MAP_HALF) continue;
            total++;
            if (nav.isWalkable(x, z)) open++;
          }
        }
        expect(open / total).toBeGreaterThan(0.75);
      }
    }
  });

  it('answers isBlockedAt and groundAt quickly', () => {
    const m = maps[0];
    let blocked = 0;
    const counts: Record<string, number> = { grass: 0, dirt: 0, road: 0, mud: 0, water: 0 };
    const t0 = performance.now();
    for (let i = 0; i < 200_000; i++) {
      const x = ((i * 7919) % 30000) / 100 - 150;
      const z = ((i * 104729) % 30000) / 100 - 150;
      if (m.isBlockedAt(x, z)) blocked++;
    }
    const t1 = performance.now();
    for (let i = 0; i < 200_000; i++) {
      const x = ((i * 7919) % 30000) / 100 - 150;
      const z = ((i * 104729) % 30000) / 100 - 150;
      counts[m.groundAt(x, z)]++;
    }
    const t2 = performance.now();
    expect(blocked).toBeGreaterThan(0);
    expect(counts.road).toBeGreaterThan(0);
    expect(counts.dirt).toBeGreaterThan(0);
    expect(counts.grass).toBeGreaterThan(counts.road);
    // ~1 µs per query budget, asserted loosely for noisy CI.
    expect(t1 - t0).toBeLessThan(400);
    expect(t2 - t1).toBeLessThan(400);
    expect(m.isBlockedAt(MAP_HALF + 1, 0)).toBe(true);
  });
});
