/** Closed Ley loops stop the entire boss footprint, including nested and implied loops. */
import { BOSS_RADIUS } from '../../boss';
import { latticeTopology } from '../../lattice/topology';
import { clamp, distToSegment } from '../../math';
import type { V2 } from '../../math';
import type { FactionId, Flag } from '../../types';
import type { World } from '../../world';

interface LoopCache { survey: number; topology: number; edges: number[]; }
const caches = new WeakMap<World, LoopCache>();

/** Edges in a cycle are exactly the non-bridges of each faction's Ley graph. This retains
 * inner loops too (the outer enclosure flood-fill alone would hide nested boundaries). */
export function bossLoopEdges(world: World): number[] {
  const old = caches.get(world), lat = world.lattice, ley = world.survey.edgeLey;
  if (old?.survey === world.survey.version && old.topology === lat.version) return old.edges;
  const seen = new Int32Array(lat.nodes.length), low = new Int32Array(lat.nodes.length);
  const bridge = new Uint8Array(lat.edges.length);
  let stamp = 0;
  // Iterative Tarjan: long player-built loops cannot overflow the JavaScript stack.
  for (let root = 0; root < lat.nodes.length; root++) {
    if (seen[root] || !lat.nodes[root].edges.some(e => ley[e] >= 0)) continue;
    const stack: { n: number; parent: number; i: number }[] = [{ n: root, parent: -1, i: 0 }];
    seen[root] = low[root] = ++stamp;
    while (stack.length) {
      const frame = stack[stack.length - 1], adj = lat.nodes[frame.n].edges;
      if (frame.i >= adj.length) {
        stack.pop();
        if (frame.parent >= 0) {
          const e = lat.edges[frame.parent], p = e.a === frame.n ? e.b : e.a;
          low[p] = Math.min(low[p], low[frame.n]);
          if (low[frame.n] > seen[p]) bridge[e.id] = 1;
        }
        continue;
      }
      const ei = adj[frame.i++];
      if (ei === frame.parent || ley[ei] < 0) continue;
      const e = lat.edges[ei], next = e.a === frame.n ? e.b : e.a;
      if (!seen[next]) {
        seen[next] = low[next] = ++stamp;
        stack.push({ n: next, parent: ei, i: 0 });
      } else low[frame.n] = Math.min(low[frame.n], seen[next]);
    }
  }
  const edges = lat.edges.filter(e => ley[e.id] >= 0 && !bridge[e.id]).map(e => e.id);
  caches.set(world, { survey: world.survey.version, topology: lat.version, edges });
  return edges;
}

/** Earliest exact intersection of moving point with a segment's radius-r capsule. */
export function sweepCircleSegment(from: V2, to: V2, a: V2, b: V2, r: number): number | null {
  const vx = to.x - from.x, vz = to.z - from.z;
  const initial = distToSegment(from.x, from.z, a.x, a.z, b.x, b.z);
  if (initial <= r + 1e-7) {
    // A loop may be planted/flipped into an existing footprint. Never push/teleport the
    // boss across it; moving away is allowed, moving into/through it is stopped immediately.
    const tiny = Math.min(1, 0.001 / Math.max(1e-9, Math.hypot(vx, vz)));
    const after = distToSegment(from.x + vx * tiny, from.z + vz * tiny, a.x, a.z, b.x, b.z);
    if (after <= initial + 1e-9) return 0;
    return null;
  }
  const vv = vx * vx + vz * vz;
  if (vv < 1e-14) return null;
  let first = Infinity;
  const ex = b.x - a.x, ez = b.z - a.z, length = Math.hypot(ex, ez);
  if (length > 1e-9) {
    const nx = -ez / length, nz = ex / length;
    const distance = (from.x - a.x) * nx + (from.z - a.z) * nz;
    const speed = vx * nx + vz * nz;
    if (Math.abs(speed) > 1e-12) for (const side of [-r, r]) {
      const t = (side - distance) / speed;
      if (t < 0 || t > 1) continue;
      const along = ((from.x + vx * t - a.x) * ex + (from.z + vz * t - a.z) * ez) / (length * length);
      if (along >= 0 && along <= 1) first = Math.min(first, t);
    }
  }
  for (const end of [a, b]) {
    const ox = from.x - end.x, oz = from.z - end.z;
    const dot = ox * vx + oz * vz;
    const disc = dot * dot - vv * (ox * ox + oz * oz - r * r);
    if (disc < 0) continue;
    const t = (-dot - Math.sqrt(disc)) / vv;
    if (t >= 0 && t <= 1) first = Math.min(first, t);
  }
  return first <= 1 ? first : null;
}

export interface BossSweep { fraction: number; edge: number; faction: FactionId; x: number; z: number; }
export function sweepBossLoops(world: World, from: V2, to: V2, radius = BOSS_RADIUS): BossSweep | null {
  let hit: BossSweep | null = null;
  for (const ei of bossLoopEdges(world)) {
    const edge = world.lattice.edges[ei], a = world.lattice.nodes[edge.a], b = world.lattice.nodes[edge.b];
    if (Math.max(from.x, to.x) + radius < Math.min(a.x, b.x) || Math.min(from.x, to.x) - radius > Math.max(a.x, b.x) ||
        Math.max(from.z, to.z) + radius < Math.min(a.z, b.z) || Math.min(from.z, to.z) - radius > Math.max(a.z, b.z)) continue;
    const t = sweepCircleSegment(from, to, a, b, radius);
    if (t === null || hit && hit.fraction <= t) continue;
    const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const u = clamp(l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0, 0, 1);
    hit = { fraction: t, edge: ei, faction: world.survey.edgeLey[ei] as FactionId, x: a.x + dx * u, z: a.z + dz * u };
  }
  return hit;
}

/** Real flags underpinning a contacted edge, recursively following implied parents. */
export function barrierFlags(world: World, edgeId: number): Flag[] {
  const edge = world.lattice.edges[edgeId];
  if (!edge) return [];
  const faction = world.survey.edgeLey[edgeId];
  if (faction < 0) return [];
  const s = world.survey, topo = latticeTopology(world.lattice);
  const stack = [edge.a, edge.b], visited = new Set<number>(), flags = new Map<number, Flag>();
  while (stack.length) {
    const n = stack.pop()!;
    if (visited.has(n)) continue;
    visited.add(n);
    const real = world.flags.get(s.nodeFlag[n]);
    if (real && real.owner === faction) { flags.set(real.id, real); continue; }
    if (s.impliedOwner[n] !== faction) continue;
    for (let i = topo.midStart[n]; i < topo.midStart[n + 1]; i++) {
      const a = topo.midA[i], b = topo.midB[i], order = s.impliedOrder[n];
      if (s.holder[a] === faction && s.holder[b] === faction && s.impliedOrder[a] < order && s.impliedOrder[b] < order) stack.push(a, b);
    }
  }
  return [...flags.values()];
}
