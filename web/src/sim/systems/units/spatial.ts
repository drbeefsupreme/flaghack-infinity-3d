/**
 * Uniform-grid spatial hash over the burn for hippies. Rebuilt once per tick with a counting
 * sort into typed arrays (no per-tick allocation once capacity is reached); queries write item
 * indices into a caller-provided buffer.
 */
import type { Hippie } from '../../types';

export class SpatialHash {
  readonly cell: number;
  readonly dim: number;
  readonly half: number;
  /** Items of the last build; query results index into this list. */
  items: readonly Hippie[] = [];
  private readonly start: Int32Array;
  private readonly fill: Int32Array;
  private sorted = new Int32Array(256);
  private cellOfItem = new Int32Array(256);

  constructor(half: number, cell: number) {
    this.half = half;
    this.cell = cell;
    this.dim = Math.ceil((2 * half) / cell);
    this.start = new Int32Array(this.dim * this.dim + 1);
    this.fill = new Int32Array(this.dim * this.dim);
  }

  private cellCoord(v: number): number {
    const c = Math.floor((v + this.half) / this.cell);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  rebuild(items: readonly Hippie[]): void {
    this.items = items;
    const n = items.length;
    if (n > this.sorted.length) {
      const cap = Math.max(n, this.sorted.length * 2);
      this.sorted = new Int32Array(cap);
      this.cellOfItem = new Int32Array(cap);
    }
    const start = this.start;
    const fill = this.fill;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const p = items[i].pos;
      const c = this.cellCoord(p.z) * this.dim + this.cellCoord(p.x);
      this.cellOfItem[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < this.dim * this.dim; c++) start[c + 1] += start[c];
    fill.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellOfItem[i];
      this.sorted[start[c] + fill[c]++] = i;
    }
  }

  /**
   * Indices (into `items`) of hippies within r of (x, z), written to `out`. Returns the
   * count (truncated at out.length).
   */
  query(x: number, z: number, r: number, out: Int32Array): number {
    const x0 = this.cellCoord(x - r);
    const x1 = this.cellCoord(x + r);
    const z0 = this.cellCoord(z - r);
    const z1 = this.cellCoord(z + r);
    const r2 = r * r;
    const items = this.items;
    let k = 0;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * this.dim + cx;
        for (let s = this.start[c], e = this.start[c + 1]; s < e; s++) {
          const i = this.sorted[s];
          const p = items[i].pos;
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz > r2) continue;
          if (k >= out.length) return k;
          out[k++] = i;
        }
      }
    }
    return k;
  }
}
