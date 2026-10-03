/**
 * Ground navigation grid for hippies (and AI avatar route planning).
 * Static blocking from the map; dynamic blocking from pieces (walls) and buildings, tracked
 * per blocker id so raiders can find what to tear down.
 *
 * Every blocker (static or dynamic) is padded by the hippie radius and rasterized
 * conservatively: a cell is blocked when any part of its square comes within the padded
 * footprint, so every point of a walkable cell is a legal hippie position and a straight
 * segment through walkable cells (supercover) is collision-free. The outermost cell ring is
 * always blocked, which keeps the A* inner loop free of bounds checks.
 *
 * Owner: MapPhysics agent. Consumers: hippies, ai.
 */
import { HIPPIE } from '../constants';
import type { MapLayout, Obstacle, Water } from '../map/mapgen';
import { distToSegment } from '../math';
import type { V2 } from '../math';

export interface PathOptions {
  /** Max A* expansions before giving up (returns best partial path toward goal if `partial`). */
  maxIter?: number;
  partial?: boolean;
  /**
   * Plan through every dynamic blocker (static map only). Raiders use this to route through
   * walls, then `blockerOnSegment` tells them which one to tear down.
   */
  ignoreDynamic?: boolean;
}

/** Clearance added around every blocker: the hippie body radius. */
export const NAV_PAD = HIPPIE.radius;
const DEFAULT_MAX_ITER = 6000;
// Tiny heuristic inflation breaks f-ties toward the goal (far fewer expansions on open ground).
const TIE_BREAK = 1.001;
const SQRT2 = Math.SQRT2;
const OCTILE = SQRT2 - 2;

export class NavGrid {
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  readonly half: number;
  /** Increments whenever dynamic blocking changes (lets callers invalidate cached paths). */
  version = 0;

  /** 1 = blocked by the map (obstacles, water, border ring). */
  private readonly staticBlocked: Uint8Array;
  /** 1 = blocked by the map or by any dynamic blocker. */
  private readonly solid: Uint8Array;
  /** Per-cell list of dynamic blockers (pooled linked list; head = top, latest blocker). */
  private readonly cellHead: Int32Array;
  private nodeBlocker = new Int32Array(1024);
  private nodeNext = new Int32Array(1024);
  private nodeCount = 0;
  private freeNode = -1;
  private readonly blockerCells = new Map<number, number[]>();

  /*
   * Connected components of open cells, so unreachable goals are known without flooding the
   * start's whole region (the costliest A* queries). Labels are 4-connected, which is exact
   * here: a diagonal move needs both orthogonal neighbours open. `comp` labels `solid` and is
   * rebuilt lazily when `solid` differs from the snapshot it was built from (solidDiff counts
   * the differing cells, so a GCC re-registered in place costs nothing).
   */
  private readonly comp: Int32Array;
  private compBuilt = false;
  private readonly labeledSolid: Uint8Array;
  private solidDiff = 0;
  private readonly staticComp: Int32Array;
  private staticCompDirty = true;
  private readonly queue: Int32Array;

  // A* buffers, reused across searches; generation stamps replace clearing.
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private heapIdx = new Int32Array(4096);
  private heapKey = new Float64Array(4096);
  private heapSize = 0;
  private readonly pathBuf: Int32Array;
  // Neighbour tables: 4 orthogonal then 4 diagonal.
  private readonly nOff: Int32Array;
  private readonly nDi = Int32Array.from([1, -1, 0, 0, 1, -1, 1, -1]);
  private readonly nDj = Int32Array.from([0, 0, 1, -1, 1, 1, -1, -1]);

  constructor(half: number, cell: number) {
    this.half = half;
    this.cell = cell;
    this.w = Math.ceil((2 * half) / cell);
    this.h = this.w;
    const n = this.w * this.h;
    this.staticBlocked = new Uint8Array(n);
    this.solid = new Uint8Array(n);
    this.cellHead = new Int32Array(n).fill(-1);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.pathBuf = new Int32Array(n);
    this.comp = new Int32Array(n);
    this.labeledSolid = new Uint8Array(n);
    this.staticComp = new Int32Array(n);
    this.queue = new Int32Array(n);
    const w = this.w;
    this.nOff = Int32Array.from([1, -1, w, -w, w + 1, w - 1, -w + 1, -w - 1]);
    for (let i = 0; i < w; i++) {
      this.markStatic(i);
      this.markStatic((this.h - 1) * w + i);
    }
    for (let j = 0; j < this.h; j++) {
      this.markStatic(j * w);
      this.markStatic(j * w + w - 1);
    }
  }

  static fromMap(map: MapLayout, cell = 1.5): NavGrid {
    const grid = new NavGrid(map.half, cell);
    for (const o of map.obstacles) grid.stampObstacle(o);
    for (const water of map.water) grid.stampWater(water);
    return grid;
  }

  /** Register a dynamic circular blocker (building). `r` is the raw footprint radius. */
  blockCircle(x: number, z: number, r: number, blocker: number): void {
    const reach = r + NAV_PAD;
    const half = this.cell / 2;
    const i0 = this.cellCoord(x - reach);
    const i1 = this.cellCoord(x + reach);
    const j1 = this.cellCoord(z + reach);
    for (let j = this.cellCoord(z - reach); j <= j1; j++) {
      const cz = this.centre(j);
      const dz = Math.max(0, Math.abs(z - cz) - half);
      for (let i = i0; i <= i1; i++) {
        const dx = Math.max(0, Math.abs(x - this.centre(i)) - half);
        if (dx * dx + dz * dz < reach * reach) this.addDynamic(j * this.w + i, blocker);
      }
    }
    this.version++;
  }

  /** Register a dynamic segment blocker (wall) of given thickness. */
  blockSegment(ax: number, az: number, bx: number, bz: number, thickness: number, blocker: number): void {
    const reach = thickness / 2 + NAV_PAD;
    const half = this.cell / 2;
    const i0 = this.cellCoord(Math.min(ax, bx) - reach);
    const i1 = this.cellCoord(Math.max(ax, bx) + reach);
    const j1 = this.cellCoord(Math.max(az, bz) + reach);
    for (let j = this.cellCoord(Math.min(az, bz) - reach); j <= j1; j++) {
      const cz = this.centre(j);
      for (let i = i0; i <= i1; i++) {
        const cx = this.centre(i);
        if (segmentSquareDistance(ax, az, bx, bz, cx - half, cz - half, cx + half, cz + half) < reach) {
          this.addDynamic(j * this.w + i, blocker);
        }
      }
    }
    this.version++;
  }

  /** Remove every cell registration of a dynamic blocker. */
  unblock(blocker: number): void {
    const cells = this.blockerCells.get(blocker);
    if (!cells) return;
    for (const c of cells) {
      let prev = -1;
      for (let node = this.cellHead[c]; node >= 0; node = this.nodeNext[node]) {
        if (this.nodeBlocker[node] !== blocker) {
          prev = node;
          continue;
        }
        const next = this.nodeNext[node];
        if (prev < 0) this.cellHead[c] = next;
        else this.nodeNext[prev] = next;
        this.nodeNext[node] = this.freeNode;
        this.freeNode = node;
        break;
      }
      if (this.cellHead[c] < 0) this.setSolid(c, this.staticBlocked[c]);
    }
    this.blockerCells.delete(blocker);
    this.version++;
  }

  isWalkable(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c >= 0 && this.solid[c] === 0;
  }

  /**
   * Smoothed waypoint path (excluding start, including goal) or null if unreachable.
   * A blocked start or goal resolves to the nearest walkable cell (a snapped start becomes the
   * first waypoint, a snapped goal the last). With `partial`, a goal outside the start's
   * connected region yields the path to the reachable cell nearest it, and a search cut off
   * by maxIter the path to the explored cell closest to it (null if no progress is possible).
   */
  findPath(fromX: number, fromZ: number, toX: number, toZ: number, opts?: PathOptions): V2[] | null {
    const grid = opts?.ignoreDynamic ? this.staticBlocked : this.solid;
    const maxIter = opts?.maxIter ?? DEFAULT_MAX_ITER;
    const out: V2[] = [];

    let start = this.cellAt(fromX, fromZ);
    let sx = fromX;
    let sz = fromZ;
    if (start < 0 || grid[start] !== 0) {
      start = this.nearestOpenCell(fromX, fromZ, grid, null, -1);
      if (start < 0) return null;
      sx = this.centre(start % this.w);
      sz = this.centre(Math.floor(start / this.w));
      out.push({ x: sx, z: sz });
    }
    let goal = this.cellAt(toX, toZ);
    let gx = toX;
    let gz = toZ;
    if (goal < 0 || grid[goal] !== 0) {
      goal = this.nearestOpenCell(toX, toZ, grid, null, -1);
      if (goal < 0) return null;
      gx = this.centre(goal % this.w);
      gz = this.centre(Math.floor(goal / this.w));
    }
    const comp = this.components(grid);
    if (comp[goal] !== comp[start]) {
      if (!opts?.partial) return null;
      goal = this.nearestOpenCell(toX, toZ, grid, comp, comp[start]);
      if (goal === start) return null;
      gx = this.centre(goal % this.w);
      gz = this.centre(Math.floor(goal / this.w));
    }
    if (start === goal || this.walk(grid, sx, sz, gx, gz, false) < 0) {
      out.push({ x: gx, z: gz });
      return out;
    }

    const end = this.search(start, goal, grid, maxIter);
    if (end !== goal && (!opts?.partial || end === start)) return null;
    if (end !== goal) {
      gx = this.centre(end % this.w);
      gz = this.centre(Math.floor(end / this.w));
    }

    // Cells start..end into pathBuf (start at index 0).
    let m = 0;
    for (let c = end; c >= 0; c = this.parent[c]) this.pathBuf[m++] = c;
    for (let a = 0, b = m - 1; a < b; a++, b--) {
      const t = this.pathBuf[a];
      this.pathBuf[a] = this.pathBuf[b];
      this.pathBuf[b] = t;
    }
    const last = m - 1;

    // String pulling: from each anchor, jump to the farthest path point still in sight.
    let ax = sx;
    let az = sz;
    let i = 0;
    while (i < last) {
      let j = i + 1;
      while (j < last) {
        const nx = j + 1 === last ? gx : this.centre(this.pathBuf[j + 1] % this.w);
        const nz = j + 1 === last ? gz : this.centre(Math.floor(this.pathBuf[j + 1] / this.w));
        if (this.walk(grid, ax, az, nx, nz, false) >= 0) break;
        j++;
      }
      ax = j === last ? gx : this.centre(this.pathBuf[j] % this.w);
      az = j === last ? gz : this.centre(Math.floor(this.pathBuf[j] / this.w));
      out.push({ x: ax, z: az });
      i = j;
    }
    return out;
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    return this.walk(this.solid, ax, az, bx, bz, false) < 0;
  }

  /** The point itself when walkable, else the centre of the nearest walkable cell. */
  nearestWalkable(x: number, z: number): V2 {
    if (this.isWalkable(x, z)) return { x, z };
    const c = this.nearestOpenCell(x, z, this.solid, null, -1);
    if (c < 0) return { x, z };
    return { x: this.centre(c % this.w), z: this.centre(Math.floor(c / this.w)) };
  }

  /** First dynamic blocker id crossed by the straight segment a→b, or -1. */
  blockerOnSegment(ax: number, az: number, bx: number, bz: number): number {
    const c = this.walk(this.solid, ax, az, bx, bz, true);
    return c < 0 ? -1 : this.nodeBlocker[this.cellHead[c]];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** World coordinate of the centre of cell column/row i. */
  private centre(i: number): number {
    return -this.half + (i + 0.5) * this.cell;
  }

  /** Cell index of a point, or -1 outside the grid. */
  private cellAt(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  /** Cell column (or row: the grid is square) of a world coordinate, clamped to the grid. */
  private cellCoord(v: number): number {
    return Math.min(this.w - 1, Math.max(0, Math.floor((v + this.half) / this.cell)));
  }

  private markStatic(c: number): void {
    this.staticBlocked[c] = 1;
    this.staticCompDirty = true;
    this.setSolid(c, 1);
  }

  /** Write one `solid` cell, keeping solidDiff (cells differing from the labelled snapshot). */
  private setSolid(c: number, v: number): void {
    if (this.solid[c] === v) return;
    this.solid[c] = v;
    this.solidDiff += v === this.labeledSolid[c] ? -1 : 1;
  }

  /** Component id per open cell of `grid` (static or current), -1 on blocked cells. */
  private components(grid: Uint8Array): Int32Array {
    const isStatic = grid === this.staticBlocked;
    const comp = isStatic ? this.staticComp : this.comp;
    if (isStatic ? !this.staticCompDirty : this.compBuilt && this.solidDiff === 0) return comp;
    comp.fill(-1);
    const w = this.w;
    const q = this.queue;
    let next = 0;
    for (let s = 0; s < grid.length; s++) {
      if (grid[s] !== 0 || comp[s] >= 0) continue;
      const id = next++;
      comp[s] = id;
      let head = 0;
      let tail = 0;
      q[tail++] = s;
      // The border ring is always blocked, so open cells' neighbours stay on the grid.
      while (head < tail) {
        const c = q[head++];
        if (grid[c + 1] === 0 && comp[c + 1] < 0) {
          comp[c + 1] = id;
          q[tail++] = c + 1;
        }
        if (grid[c - 1] === 0 && comp[c - 1] < 0) {
          comp[c - 1] = id;
          q[tail++] = c - 1;
        }
        if (grid[c + w] === 0 && comp[c + w] < 0) {
          comp[c + w] = id;
          q[tail++] = c + w;
        }
        if (grid[c - w] === 0 && comp[c - w] < 0) {
          comp[c - w] = id;
          q[tail++] = c - w;
        }
      }
    }
    if (isStatic) {
      this.staticCompDirty = false;
    } else {
      this.labeledSolid.set(this.solid);
      this.solidDiff = 0;
      this.compBuilt = true;
    }
    return comp;
  }

  private stampObstacle(o: Obstacle): void {
    const half = this.cell / 2;
    if (o.shape === 'circle') {
      const reach = o.radius + NAV_PAD;
      const i0 = this.cellCoord(o.x - reach);
      const i1 = this.cellCoord(o.x + reach);
      const j1 = this.cellCoord(o.z + reach);
      for (let j = this.cellCoord(o.z - reach); j <= j1; j++) {
        const dz = Math.max(0, Math.abs(o.z - this.centre(j)) - half);
        for (let i = i0; i <= i1; i++) {
          const dx = Math.max(0, Math.abs(o.x - this.centre(i)) - half);
          if (dx * dx + dz * dz < reach * reach) this.markStatic(j * this.w + i);
        }
      }
      return;
    }
    const c = Math.cos(o.yaw);
    const s = Math.sin(o.yaw);
    const ex = Math.abs(c) * o.hx + Math.abs(s) * o.hz + NAV_PAD;
    const ez = Math.abs(s) * o.hx + Math.abs(c) * o.hz + NAV_PAD;
    const i0 = this.cellCoord(o.x - ex);
    const i1 = this.cellCoord(o.x + ex);
    const j1 = this.cellCoord(o.z + ez);
    for (let j = this.cellCoord(o.z - ez); j <= j1; j++) {
      const cz = this.centre(j);
      for (let i = i0; i <= i1; i++) {
        const cx = this.centre(i);
        if (squareBoxDistance(cx, cz, half, o.x, o.z, o.hx, o.hz, c, s) < NAV_PAD) this.markStatic(j * this.w + i);
      }
    }
  }

  private stampWater(wa: Water): void {
    // Exact for an axis-aligned ellipse inflated to radii (rx + pad, rz + pad): scaling both axes
    // keeps cell squares axis-aligned, so clamping the centre into the scaled square works.
    const rx = wa.rx + NAV_PAD;
    const rz = wa.rz + NAV_PAD;
    const half = this.cell / 2;
    const i0 = this.cellCoord(wa.x - rx);
    const i1 = this.cellCoord(wa.x + rx);
    const j1 = this.cellCoord(wa.z + rz);
    for (let j = this.cellCoord(wa.z - rz); j <= j1; j++) {
      const dz = Math.max(0, Math.abs(wa.z - this.centre(j)) - half) / rz;
      for (let i = i0; i <= i1; i++) {
        const dx = Math.max(0, Math.abs(wa.x - this.centre(i)) - half) / rx;
        if (dx * dx + dz * dz < 1) this.markStatic(j * this.w + i);
      }
    }
  }

  private addDynamic(c: number, blocker: number): void {
    for (let node = this.cellHead[c]; node >= 0; node = this.nodeNext[node]) {
      if (this.nodeBlocker[node] === blocker) return;
    }
    let node = this.freeNode;
    if (node >= 0) {
      this.freeNode = this.nodeNext[node];
    } else {
      if (this.nodeCount === this.nodeBlocker.length) {
        const blockers = new Int32Array(this.nodeCount * 2);
        const next = new Int32Array(this.nodeCount * 2);
        blockers.set(this.nodeBlocker);
        next.set(this.nodeNext);
        this.nodeBlocker = blockers;
        this.nodeNext = next;
      }
      node = this.nodeCount++;
    }
    this.nodeBlocker[node] = blocker;
    this.nodeNext[node] = this.cellHead[c];
    this.cellHead[c] = node;
    this.setSolid(c, 1);
    let cells = this.blockerCells.get(blocker);
    if (!cells) {
      cells = [];
      this.blockerCells.set(blocker, cells);
    }
    cells.push(c);
  }

  /**
   * Nearest open cell to (x, z) by centre distance (ring search), or -1. With `comp`, only
   * cells of component `want` count.
   */
  private nearestOpenCell(x: number, z: number, grid: Uint8Array, comp: Int32Array | null, want: number): number {
    const ci = Math.min(this.w - 1, Math.max(0, Math.floor((x + this.half) / this.cell)));
    const cj = Math.min(this.h - 1, Math.max(0, Math.floor((z + this.half) / this.cell)));
    const centre = cj * this.w + ci;
    if (grid[centre] === 0 && (!comp || comp[centre] === want)) return centre;
    let best = -1;
    let bestD = Infinity;
    const maxR = Math.max(this.w, this.h);
    for (let r = 1; r < maxR; r++) {
      // Ring r is at least (r - 0.5) cells away from any point inside the centre cell.
      const near = (r - 0.5) * this.cell;
      if (near * near > bestD) break;
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= this.h) continue;
        const edge = j === cj - r || j === cj + r;
        for (let i = ci - r; i <= ci + r; i += edge ? 1 : 2 * r) {
          if (i < 0 || i >= this.w) continue;
          const c = j * this.w + i;
          if (grid[c] !== 0 || (comp && comp[c] !== want)) continue;
          const dx = this.centre(i) - x;
          const dz = this.centre(j) - z;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    return best;
  }

  /**
   * A* (octile, 8-connected, no corner cutting) from start to goal over `grid`. Returns goal
   * when reached, else the closed cell with the smallest heuristic (the partial-path end).
   */
  private search(start: number, goal: number, grid: Uint8Array, maxIter: number): number {
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const w = this.w;
    const g = this.g;
    const parent = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    const off = this.nOff;
    const di = this.nDi;
    const dj = this.nDj;
    const gi = goal % w;
    const gj = (goal - gi) / w;

    this.heapSize = 0;
    g[start] = 0;
    parent[start] = -1;
    seen[start] = gen;
    const si = start % w;
    const sj = (start - si) / w;
    let adx = Math.abs(si - gi);
    let adz = Math.abs(sj - gj);
    let bestH = adx + adz + OCTILE * (adx < adz ? adx : adz);
    let best = start;
    this.push(start, bestH * TIE_BREAK);
    let iter = 0;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) return goal;
      const ci = cur % w;
      const cj = (cur - ci) / w;
      adx = Math.abs(ci - gi);
      adz = Math.abs(cj - gj);
      const hc = adx + adz + OCTILE * (adx < adz ? adx : adz);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      if (++iter > maxIter) break;
      const gc = g[cur];
      for (let k = 0; k < 8; k++) {
        const nb = cur + off[k];
        if (grid[nb] !== 0 || closed[nb] === gen) continue;
        // Diagonal moves need both orthogonal neighbours open (no corner cutting).
        if (k >= 4 && (grid[cur + di[k]] !== 0 || grid[cur + dj[k] * w] !== 0)) continue;
        const ng = gc + (k < 4 ? 1 : SQRT2);
        if (seen[nb] === gen && ng >= g[nb]) continue;
        seen[nb] = gen;
        g[nb] = ng;
        parent[nb] = cur;
        const ndx = Math.abs(ci + di[k] - gi);
        const ndz = Math.abs(cj + dj[k] - gj);
        this.push(nb, ng + (ndx + ndz + OCTILE * (ndx < ndz ? ndx : ndz)) * TIE_BREAK);
      }
    }
    return best;
  }

  private push(idx: number, key: number): void {
    if (this.heapSize === this.heapIdx.length) {
      const ids = new Int32Array(this.heapSize * 2);
      const keys = new Float64Array(this.heapSize * 2);
      ids.set(this.heapIdx);
      keys.set(this.heapKey);
      this.heapIdx = ids;
      this.heapKey = keys;
    }
    const hi = this.heapIdx;
    const hk = this.heapKey;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hi[i] = hi[p];
      hk[i] = hk[p];
      i = p;
    }
    hi[i] = idx;
    hk[i] = key;
  }

  private pop(): number {
    const hi = this.heapIdx;
    const hk = this.heapKey;
    const top = hi[0];
    const n = --this.heapSize;
    if (n > 0) {
      const idx = hi[n];
      const key = hk[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= key) break;
        hi[i] = hi[c];
        hk[i] = hk[c];
        i = c;
      }
      hi[i] = idx;
      hk[i] = key;
    }
    return top;
  }

  /**
   * Supercover grid walk from a to b (every cell the segment touches; both side cells when it
   * passes exactly through a corner). Returns the first cell that is blocked in `grid`
   * (or, with `dynamicOnly`, the first cell holding a dynamic blocker), else -1.
   * Cells outside the grid count as blocked unless `dynamicOnly`.
   */
  private walk(grid: Uint8Array, ax: number, az: number, bx: number, bz: number, dynamicOnly: boolean): number {
    const gx0 = (ax + this.half) / this.cell;
    const gz0 = (az + this.half) / this.cell;
    const gx1 = (bx + this.half) / this.cell;
    const gz1 = (bz + this.half) / this.cell;
    let i = Math.floor(gx0);
    let j = Math.floor(gz0);
    const iEnd = Math.floor(gx1);
    const jEnd = Math.floor(gz1);
    let hit = this.probe(grid, i, j, dynamicOnly);
    if (hit !== -1) return hit;
    const dx = gx1 - gx0;
    const dz = gz1 - gz0;
    const si = dx > 0 ? 1 : -1;
    const sj = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const tdz = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? i + 1 - gx0 : gx0 - i) * tdx : Infinity;
    let tmz = dz !== 0 ? (dz > 0 ? j + 1 - gz0 : gz0 - j) * tdz : Infinity;
    let steps = Math.abs(iEnd - i) + Math.abs(jEnd - j);
    while (steps > 0) {
      if (Math.abs(tmx - tmz) < 1e-9) {
        hit = this.probe(grid, i + si, j, dynamicOnly);
        if (hit !== -1) return hit;
        hit = this.probe(grid, i, j + sj, dynamicOnly);
        if (hit !== -1) return hit;
        i += si;
        j += sj;
        tmx += tdx;
        tmz += tdz;
        steps -= 2;
      } else if (tmx < tmz) {
        i += si;
        tmx += tdx;
        steps--;
      } else {
        j += sj;
        tmz += tdz;
        steps--;
      }
      hit = this.probe(grid, i, j, dynamicOnly);
      if (hit !== -1) return hit;
    }
    return -1;
  }

  /** Cell index if (i, j) stops a walk, else -1 (see `walk`). */
  private probe(grid: Uint8Array, i: number, j: number, dynamicOnly: boolean): number {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return dynamicOnly ? -1 : this.w * this.h;
    const c = j * this.w + i;
    if (dynamicOnly) return this.cellHead[c] >= 0 ? c : -1;
    return grid[c] !== 0 ? c : -1;
  }
}

/** Distance between an axis-aligned square (centre, half size) and an oriented box. */
function squareBoxDistance(
  qx: number,
  qz: number,
  q: number,
  bx: number,
  bz: number,
  hx: number,
  hz: number,
  c: number,
  s: number,
): number {
  const dx = bx - qx;
  const dz = bz - qz;
  const ac = Math.abs(c);
  const as = Math.abs(s);
  // Separating axes: world x, world z, box local x (c, -s), box local z (s, c).
  const sepX = Math.abs(dx) > q + ac * hx + as * hz;
  const sepZ = Math.abs(dz) > q + as * hx + ac * hz;
  const sepU = Math.abs(dx * c - dz * s) > q * (ac + as) + hx;
  const sepV = Math.abs(dx * s + dz * c) > q * (ac + as) + hz;
  if (!sepX && !sepZ && !sepU && !sepV) return 0;
  // Disjoint convex polygons: the closest pair involves a vertex of one of them.
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    const sx = k === 0 || k === 3 ? -q : q;
    const sz = k < 2 ? -q : q;
    // Square corner → box.
    const px = qx + sx - bx;
    const pz = qz + sz - bz;
    const ex = Math.max(0, Math.abs(px * c - pz * s) - hx);
    const ez = Math.max(0, Math.abs(px * s + pz * c) - hz);
    best = Math.min(best, Math.sqrt(ex * ex + ez * ez));
    // Box corner → square.
    const lx = k === 0 || k === 3 ? -hx : hx;
    const lz = k < 2 ? -hz : hz;
    const wx = bx + lx * c + lz * s;
    const wz = bz - lx * s + lz * c;
    const fx = Math.max(0, Math.abs(wx - qx) - q);
    const fz = Math.max(0, Math.abs(wz - qz) - q);
    best = Math.min(best, Math.sqrt(fx * fx + fz * fz));
  }
  return best;
}

/** Distance between segment a→b and an axis-aligned rectangle (0 when they touch). */
function segmentSquareDistance(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): number {
  // Liang-Barsky: does the segment enter the rectangle?
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  let crosses = true;
  for (let k = 0; k < 4 && crosses; k++) {
    const p = k === 0 ? -dx : k === 1 ? dx : k === 2 ? -dz : dz;
    const q = k === 0 ? ax - minX : k === 1 ? maxX - ax : k === 2 ? az - minZ : maxZ - az;
    if (p === 0) {
      if (q < 0) crosses = false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) crosses = false;
        else if (r > t0) t0 = r;
      } else if (r < t0) {
        crosses = false;
      } else if (r < t1) {
        t1 = r;
      }
    }
  }
  if (crosses) return 0;
  let best = Infinity;
  for (let k = 0; k < 2; k++) {
    const px = k === 0 ? ax : bx;
    const pz = k === 0 ? az : bz;
    const ex = Math.max(0, minX - px, px - maxX);
    const ez = Math.max(0, minZ - pz, pz - maxZ);
    best = Math.min(best, Math.sqrt(ex * ex + ez * ez));
  }
  for (let k = 0; k < 4; k++) {
    const cx = k === 0 || k === 3 ? minX : maxX;
    const cz = k < 2 ? minZ : maxZ;
    best = Math.min(best, distToSegment(cx, cz, ax, az, bx, bz));
  }
  return best;
}
