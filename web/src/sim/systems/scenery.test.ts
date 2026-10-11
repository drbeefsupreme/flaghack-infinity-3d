import { describe, expect, it } from 'vitest';
import { createMatch } from '../setup';
import { normalizeMatch } from '../matchSettings';
import { destroySceneryHit, syncScenery } from './scenery';
import { syncEffigy } from './effigy';
import { segmentClearance } from './econ/clearance';

const options = { seed: 'scenery-destruction', difficulty: 'normal' as const, mode: 'standard' as const, humans: [0 as const],
  match: normalizeMatch({ bossMode: true, maxSignifiers: 0 }) };

describe('direct beam scenery destruction', () => {
  it('removes all nine actual prop kinds by stable ID without touching neighbors or canonical definitions', () => {
    const w = createMatch(options);
    const canonical = JSON.stringify(w.map.obstacles);
    const kinds = ['tent', 'dome', 'art', 'porta', 'tree', 'rock', 'stage', 'shade', 'car'];
    for (const kind of kinds) {
      const o = w.map.obstacles.find((o) => o.kind === kind)!;
      expect(o).toBeDefined();
      expect(w.collision.raycast(o.x, 60, o.z, 0, -1, 0, 70)?.tag).toBe(-1 - o.id);
      expect(destroySceneryHit(w, -1 - o.id)).toBe(true);
      expect(w.collision.raycast(o.x, 60, o.z, 0, -1, 0, 70)?.tag).not.toBe(-1 - o.id);
      expect(w.map.isBlockedAt(o.x, o.z)).toBe(false);
      expect(segmentClearance(w, o.x, o.z, o.x, o.z, .01, .1)).not.toBe('obstacle');
      // Every part of multi-shape shade/stage/dome obstacles is removed.
      for (const dx of [-.9, 0, .9]) for (const dz of [-.9, 0, .9]) {
        const x = o.x + dx * o.hx, z = o.z + dz * o.hz;
        expect(w.collision.raycast(x, 60, z, 0, -1, 0, 70)?.tag).not.toBe(-1 - o.id);
      }
      const navVersion = w.nav.version;
      expect(destroySceneryHit(w, -1 - o.id)).toBe(false);
      syncScenery(w);
      expect(w.nav.version).toBe(navVersion);
    }
    expect(w.destroyedScenery.size).toBe(9);
    expect(JSON.stringify(w.map.obstacles)).toBe(canonical);
    const neighbor = w.map.obstacles.find(o => o.kind !== 'effigy' && !w.destroyedScenery.has(o.id))!;
    expect(w.collision.raycast(neighbor.x, 60, neighbor.z, 0, -1, 0, 70)?.tag).toBe(-1 - neighbor.id);
    for (const node of w.lattice.nodes) expect(node.blocked).toBe(w.map.isBlockedAt(node.x, node.z));
  });

  it('ignores terrain, entities, effigy and invalid tags; reset restores the whole map', () => {
    const w = createMatch(options), effigy = w.map.obstacles.find(o => o.kind === 'effigy')!;
    for (const tag of [0, 1, 100, NaN, -1.5, -100000, -1 - effigy.id]) expect(destroySceneryHit(w, tag)).toBe(false);
    const prop = w.map.obstacles.find(o => o.kind === 'dome')!;
    destroySceneryHit(w, -1 - prop.id);
    const fresh = createMatch(options);
    expect(fresh.destroyedScenery.size).toBe(0);
    expect(fresh.collision.raycast(prop.x, 60, prop.z, 0, -1, 0, 70)?.tag).toBe(-1 - prop.id);
    expect(w.collision.raycast(prop.x, 60, prop.z, 0, -1, 0, 70)?.tag).toBe(0);
  });

  it('does not resurrect scenery when the effigy clears, or dynamic blockers when scenery clears', () => {
    const w = createMatch(options), prop = w.map.obstacles.find(o => o.kind === 'dome')!;
    const handle = w.collision.addCylinder(prop.x, prop.z, .1, 0, 2, 999999);
    w.nav.blockCircle(prop.x, prop.z, .1, 999999);
    destroySceneryHit(w, -1 - prop.id);
    w.effigyRevealedAt = 230;
    syncEffigy(w);
    expect(w.map.isBlockedAt(prop.x, prop.z)).toBe(false);
    expect(w.map.isBlockedAt(0, 0)).toBe(false);
    expect(w.collision.raycast(prop.x, 60, prop.z, 0, -1, 0, 70)?.tag).toBe(999999);
    expect(w.nav.blockerOnSegment(prop.x, prop.z, prop.x, prop.z)).toBe(999999);
    w.collision.remove(handle);
  });
});
