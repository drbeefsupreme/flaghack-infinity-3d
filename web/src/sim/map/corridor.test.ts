/**
 * Conquest corridor invariant: every Hearth can always be enclosed by a rival from outside its
 * home ring, on the real map + lattice, at match start and after the Crystal turns.
 */
import { describe, expect, it } from 'vitest';
import { CAMP_CENTERS, IMPLIED_MAX_ORDER, LATTICE_MARGIN, MAP_HALF } from '../constants';
import { computeEnclosure, computeHolders, computeLeyLines } from '../lattice/geometry';
import { Lattice } from '../lattice/lattice';
import { planEnclosure } from '../lattice/planner';
import { Rng } from '../rng';
import { createMatch } from '../setup';
import { canPlantAt } from '../systems/flags';
import { geometryOwners } from '../systems/survey';
import { FACTION_IDS } from '../types';
import type { FactionId } from '../types';
import { CAMP_CLEAR_RADIUS, generateMap, HEARTH_OFFSET_MAX, RIVAL_LOOP_RADIUS } from './mapgen';

/** Rivals loop at least this far from a Hearth: just outside a starting home ring. */
const HOME_RING_REACH = 19;
/** The brute-force oracle holds every free node in [HOME_RING_REACH, ORACLE_REACH]. */
const ORACLE_REACH = 50;

/** setup's Hearth rule: the thick, interior facet nearest the camp centre with free corners. */
function hearthFacet(lat: Lattice, x: number, z: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const f of lat.facets) {
    if (!f.thick || f.boundary || f.nodes.some((n) => lat.nodes[n].blocked)) continue;
    const d = Math.hypot(f.cx - x, f.cz - z);
    if (d < bestD) {
      bestD = d;
      best = f.id;
    }
  }
  return best;
}

/** Facets `faction` encloses when it holds `held` on top of `owners` (implied Flags included). */
function enclosure(lat: Lattice, owners: Int8Array, held: number[], faction: FactionId): Uint8Array {
  const n = lat.nodes.length;
  const real = Int8Array.from(owners);
  for (const node of held) real[node] = faction;
  const holder = new Int8Array(n);
  computeHolders(lat, real, holder, new Int8Array(n), new Uint8Array(n), IMPLIED_MAX_ORDER);
  const ley = new Int8Array(lat.edges.length);
  computeLeyLines(lat, holder, ley);
  const out = new Uint8Array(lat.facets.length);
  computeEnclosure(lat, ley, faction, out);
  return out;
}

/**
 * Checks one Hearth at (x, z) on a bare lattice: planned rival loops at both radii exist, keep
 * their distance and enclose the Hearth's facet when held; and holding every free node in the
 * oracle band encloses it too.
 */
function expectEnclosable(lat: Lattice, x: number, z: number, label: string): void {
  const target = lat.facetAt(x, z);
  const empty = new Int8Array(lat.nodes.length).fill(-1);
  const cost = (n: number): number => (lat.nodes[n].blocked ? Infinity : 1);
  for (const minRadius of [HOME_RING_REACH, RIVAL_LOOP_RADIUS]) {
    const loop = planEnclosure(lat, { x, z, minRadius, cost });
    expect(loop, `${label}: loop at ${minRadius} m`).not.toBeNull();
    if (!loop) continue;
    for (const node of loop) expect(Math.hypot(lat.nodes[node].x - x, lat.nodes[node].z - z)).toBeGreaterThanOrEqual(minRadius);
    expect(enclosure(lat, empty, loop, 1)[target], `${label}: loop at ${minRadius} m encloses`).toBe(1);
  }
  const band: number[] = [];
  for (const n of lat.nodes) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (!n.blocked && d >= HOME_RING_REACH && d <= ORACLE_REACH) band.push(n.id);
  }
  expect(enclosure(lat, empty, band, 1)[target], `${label}: oracle band encloses`).toBe(1);
}

describe('conquest corridor', () => {
  it('fits between every camp and the lattice border', () => {
    for (const f of FACTION_IDS) {
      const c = CAMP_CENTERS[f];
      const toBorder = MAP_HALF - LATTICE_MARGIN - Math.max(Math.abs(c.x), Math.abs(c.z));
      expect(toBorder).toBeGreaterThan(CAMP_CLEAR_RADIUS);
    }
  });

  it('lets a rival enclose every Hearth from outside its home ring (24 burns)', () => {
    for (let s = 0; s < 24; s++) {
      const seed = `corridor-${s}`;
      const map = generateMap(seed);
      const lat = Lattice.generate(seed, { isBlockedAt: map.isBlockedAt });
      for (const f of FACTION_IDS) {
        const c = CAMP_CENTERS[f];
        const hearth = lat.facets[hearthFacet(lat, c.x, c.z)];
        expect(Math.hypot(hearth.cx - c.x, hearth.cz - c.z)).toBeLessThanOrEqual(HEARTH_OFFSET_MAX);
        expectEnclosable(lat, hearth.cx, hearth.cz, `${seed} camp ${f}`);
      }
    }
  });

  it('keeps every Hearth enclosable while the Crystal turns (phason flips)', () => {
    for (let s = 0; s < 6; s++) {
      const seed = `corridor-turn-${s}`;
      const map = generateMap(seed);
      const lat = Lattice.generate(seed, { isBlockedAt: map.isBlockedAt });
      const hearths = FACTION_IDS.map((f) => {
        const h = lat.facets[hearthFacet(lat, CAMP_CENTERS[f].x, CAMP_CENTERS[f].z)];
        return { x: h.cx, z: h.cz };
      });
      const rng = new Rng(seed);
      let flips = 0;
      for (let i = 0; i < 4000 && flips < 400; i++) if (lat.flip(rng.int(0, lat.nodes.length - 1))) flips++;
      expect(flips).toBe(400);
      for (const [f, h] of hearths.entries()) expectEnclosable(lat, h.x, h.z, `${seed} camp ${f} after ${flips} flips`);
    }
  });

  it('starts every match with each Hearth enclosable by every rival around its home ring', () => {
    for (let s = 0; s < 6; s++) {
      const world = createMatch({ seed: `corridor-match-${s}`, difficulty: 'normal', humans: [], mode: 'standard' });
      const lat = world.lattice;
      const owners = geometryOwners(world);
      for (const b of world.buildings.values()) {
        if (b.kind !== 'hearth') continue;
        for (const rival of FACTION_IDS) {
          if (rival === b.faction) continue;
          const loop = planEnclosure(lat, {
            x: b.pos.x,
            z: b.pos.z,
            minRadius: HOME_RING_REACH,
            cost: (n) => (canPlantAt(world, n, rival) ? 1 : Infinity),
          });
          expect(loop, `match ${s}: ${rival} around Hearth of ${b.faction}`).not.toBeNull();
          if (loop) expect(enclosure(lat, owners, loop, rival)[b.facet]).toBe(1);
        }
      }
    }
  });
});
