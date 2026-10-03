import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PartsBuilder } from '../geom';
import { StaticBatch } from './batch';

/** Tile index of a point on the n × n grid over [-half, half]² (clamped to the border tiles). */
function tileOf(x: number, z: number, half: number, n: number): number {
  const cell = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(((v + half) / (2 * half)) * n)));
  return cell(z) * n + cell(x);
}

describe('StaticBatch.buildTiles', () => {
  it('keeps every triangle exactly once, in the tile holding its centroid', () => {
    const half = 150;
    const n = 8;
    const box = new PartsBuilder().box(2, 2, 2, 0xffffff, { y: 1 }).build();
    const src = box.getAttribute('position');
    // Boxes inside single tiles, straddling tile corners (they must split), sharing a tile,
    // and far beyond the map edge (clamped into a border tile).
    const spots: [number, number][] = [[-140, -140], [-140, 130], [0, 0], [37.5, 37.5], [100, -20], [100, -21], [149, 149], [400, -400]];
    const batch = new StaticBatch();
    const expected = new Set<number>();
    for (const [x, z] of spots) {
      batch.add(box, new THREE.Matrix4().makeTranslation(x, 0, z));
      for (let v = 0; v < src.count; v += 3) {
        const cx = (src.getX(v) + src.getX(v + 1) + src.getX(v + 2)) / 3 + x;
        const cz = (src.getZ(v) + src.getZ(v + 1) + src.getZ(v + 2)) / 3 + z;
        expected.add(tileOf(cx, cz, half, n));
      }
    }
    const tiles = batch.buildTiles(half, n);

    let vertices = 0;
    const seen = new Set<number>();
    for (const geo of tiles) {
      const pos = geo.getAttribute('position');
      vertices += pos.count;
      const first = tileOf((pos.getX(0) + pos.getX(1) + pos.getX(2)) / 3, (pos.getZ(0) + pos.getZ(1) + pos.getZ(2)) / 3, half, n);
      for (let v = 0; v < pos.count; v += 3) {
        const cx = (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3;
        const cz = (pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2)) / 3;
        expect(tileOf(cx, cz, half, n)).toBe(first);
      }
      expect(seen.has(first)).toBe(false);
      seen.add(first);
    }
    expect(vertices).toBe(src.count * spots.length);
    expect([...seen].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
    // The corner-straddling boxes really were split across tiles.
    expect(tiles.length).toBeGreaterThan(spots.length);
  });
});
