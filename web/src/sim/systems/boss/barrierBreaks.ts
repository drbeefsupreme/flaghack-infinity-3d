/** Boss-only cosmetic break facts. Projection never advances or mutates gameplay Survey. */
import type { BossState } from '../../boss';
import { BOSS_FORCEFIELD_CENTER_HEIGHT, FORCEFIELD_EXIT_DISTANCE, projectBossForcefield } from '../../bossForcefield';
import { IMPLIED_MAX_ORDER } from '../../constants';
import type { EventOf } from '../../events';
import { computeHolders, computeLeyLines } from '../../lattice/geometry';
import type { V2 } from '../../math';
import { groundHeight } from '../../terrain';
import type { FactionId } from '../../types';
import type { World } from '../../world';
import { bossLoopEdges, cyclicLeyEdges } from './barriers';

type Segment = EventOf<'bossBarrierShattered'>['segments'][number];
interface CapturedEdge { segment: Segment; group: number; near: boolean; distance: number; }
export interface BossBarrierBreakSnapshot { bossId: number; edges: CapturedEdge[]; }
interface BreakState { bossId: number; time: number; sequence: number; pending: Map<number, CapturedEdge>; }
interface Projection { owner: Int8Array; holder: Int8Array; implied: Int8Array; order: Uint8Array; ley: Int8Array; }
const states = new WeakMap<World, BreakState>();
const projections = new WeakMap<World, Projection>();
/** Even pathological dense player graphs have bounded event payloads. Nearest contacts win. */
export const BOSS_SHATTER_MAX_SEGMENTS = 128;

function stateOf(world: World, boss: BossState): BreakState {
  let state = states.get(world);
  if (!state || state.bossId !== boss.id || world.time < state.time) {
    state = { bossId: boss.id, time: world.time, sequence: 0, pending: new Map() }; states.set(world, state);
  }
  state.time = world.time;
  return state;
}
function live(boss: BossState | null | undefined): boss is BossState {
  return !!boss && boss.hp > 0 && boss.deathAt === null && boss.action !== 'death' && boss.action !== 'dead';
}
/** Same real/neutral/implied rules as Survey, but only the inexpensive holder/Ley stages.
 * Dedicated reusable arrays mean flag impacts never modify derived gameplay state. */
function projectedLey(world: World): Int8Array {
  let p = projections.get(world);
  const nodes = world.lattice.nodes.length, edges = world.lattice.edges.length, s = world.survey;
  if (!p || p.owner.length !== nodes || p.ley.length !== edges) {
    p = { owner: new Int8Array(nodes), holder: new Int8Array(nodes), implied: new Int8Array(nodes), order: new Uint8Array(nodes), ley: new Int8Array(edges) };
    projections.set(world, p);
  }
  for (let n = 0; n < nodes; n++) p.owner[n] = s.nodeFlag[n] >= 0 && s.nodeFlagOwner[n] < 0 ? -2 : s.nodeFlagOwner[n];
  computeHolders(world.lattice, p.owner, p.holder, p.implied, p.order, IMPLIED_MAX_ORDER);
  computeLeyLines(world.lattice, p.holder, p.ley);
  return p.ley;
}

/** Call immediately before a boss mutation, only with the flags it will actually remove.
 * An already-broken or not-yet-visible loop cannot produce a second cosmetic break. */
export function captureBossBarrierBreak(world: World, ids: Iterable<number>, boss = world.boss): BossBarrierBreakSnapshot | null {
  if (!live(boss)) return null;
  const positions: V2[] = [];
  for (const id of ids) {
    const flag = world.flags.get(id);
    if (flag?.state !== 'planted') continue;
    positions.push({ x: flag.pos.x, z: flag.pos.z });
    if (flag.altNode >= 0) {
      const twin = world.lattice.nodes[flag.altNode]; if (twin) positions.push({ x: twin.x, z: twin.z });
    }
  }
  if (!positions.length) return null;
  stateOf(world, boss);
  const ley = world.survey.dirty ? projectedLey(world) : world.survey.edgeLey;
  const current = world.survey.dirty ? cyclicLeyEdges(world.lattice, ley) : bossLoopEdges(world);
  const visible = new Set(bossLoopEdges(world));
  const cycle = new Set(current.filter(e => visible.has(e) && ley[e] === world.survey.edgeLey[e]));
  if (!cycle.size) return null;
  // Connected cycle components keep unrelated/nested barriers and remote fallback bursts separate.
  const groups = new Map<number, number>();
  for (const root of cycle) {
    if (groups.has(root)) continue;
    const stack = [root]; groups.set(root, root);
    while (stack.length) {
      const edge = world.lattice.edges[stack.pop()!];
      for (const node of [edge.a, edge.b]) for (const ei of world.lattice.nodes[node].edges) {
        if (!cycle.has(ei) || groups.has(ei) || ley[ei] !== ley[root]) continue;
        groups.set(ei, root); stack.push(ei);
      }
    }
  }
  const edges: CapturedEdge[] = [];
  for (const id of cycle) {
    const edge = world.lattice.edges[id], a = world.lattice.nodes[edge.a], b = world.lattice.nodes[edge.b];
    const contact = projectBossForcefield(boss.pos, a, b), near = contact.distance <= FORCEFIELD_EXIT_DISTANCE;
    // Far beam impacts have no proximity field. Burst locally on their broken segment,
    // rather than fabricating a giant curtain around the whole distant enclosure.
    let pose = contact;
    if (!near) for (const point of positions) {
      const candidate = projectBossForcefield(point, a, b);
      if (pose === contact || candidate.distance < pose.distance) pose = candidate;
    }
    const faction = ley[id] as FactionId;
    edges.push({ group: groups.get(id)!, near, distance: pose.distance,
      segment: { edge: id, faction, color: world.factions[faction].color,
        pos: { x: pose.x, y: groundHeight(pose.x, pose.z, world.map.half) + BOSS_FORCEFIELD_CENTER_HEIGHT, z: pose.z }, yaw: pose.yaw } });
  }
  return { bossId: boss.id, edges };
}

/** Causal comparison runs immediately after the authoritative flag mutation. Other
 * players, ordinary fades, phason edits and death cannot be mistaken for boss damage. */
export function recordBossBarrierBreak(world: World, before: BossBarrierBreakSnapshot | null): void {
  if (!before || !live(world.boss) || world.boss.id !== before.bossId) return;
  const ley = projectedLey(world), after = new Set(cyclicLeyEdges(world.lattice, ley));
  const state = stateOf(world, world.boss);
  for (const edge of before.edges) {
    const old = edge.segment;
    if (after.has(old.edge) && ley[old.edge] === old.faction || state.pending.has(old.edge)) continue;
    state.pending.set(old.edge, edge);
  }
}

/** Flush only after the existing Survey refresh, exactly when intact planes disappear.
 * Reclosing before that refresh cancels the burst; no old event lives in snapshots. */
export function flushBossBarrierBreaks(world: World): void {
  const state = states.get(world);
  if (!state?.pending.size) return;
  if (!live(world.boss) || world.boss.id !== state.bossId || world.time < state.time) { states.delete(world); return; }
  const remaining = new Set(bossLoopEdges(world)), groups = new Map<number, CapturedEdge[]>();
  for (const edge of state.pending.values()) {
    if (remaining.has(edge.segment.edge) && world.survey.edgeLey[edge.segment.edge] === edge.segment.faction) continue;
    const group = groups.get(edge.group) ?? []; group.push(edge); groups.set(edge.group, group);
  }
  state.pending.clear();
  for (const group of groups.values()) {
    const contacts = group.filter(e => e.near);
    // Stable distance/edge ordering preserves both planes at corners and bounds floods.
    const chosen = (contacts.length ? contacts : group).sort((a, b) => a.distance - b.distance || a.segment.edge - b.segment.edge)
      .slice(0, contacts.length ? BOSS_SHATTER_MAX_SEGMENTS : 1);
    world.emit({ t: 'bossBarrierShattered', bossId: state.bossId, breakId: ++state.sequence, at: world.time,
      segments: chosen.map(e => e.segment) });
  }
}
