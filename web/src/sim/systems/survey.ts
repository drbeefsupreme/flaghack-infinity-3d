/**
 * Survey system: keeps SurveyState in sync with planted Flags. When dirty, recomputes
 * implied Flags → holders → Ley Lines → crystallized facets → enclosure per faction →
 * focus nodes, and emits leyLine / facetCrystallized / surveyChanged deltas.
 * Every tick: recompute Zeno observation (nodeObserved) and collapse observed simulacra.
 * Owner: SurveyRules agent (geometry math lives in lattice/geometry.ts).
 */
import type { CommandOf } from '../commands';
import { AVATAR, CRYSTAL_OBSERVE_RADIUS, GCC, HEARTH_OBSERVE_RADIUS, IMPLIED_MAX_ORDER, WARD_OBSERVE_RADIUS } from '../constants';
import {
  computeCrystallized,
  computeEnclosure,
  computeHolders,
  computeLeyLines,
  findFocusNodes,
} from '../lattice/geometry';
import { FACTION_IDS, NEUTRAL } from '../types';
import type { FactionId, Owner } from '../types';
import type { World } from '../world';
import { isAvatarDown } from './avatars';
import { collapseSimulacrum } from './flags';
import { gccActive } from './gcc';
import { isFactionId } from './rules/factions';

/**
 * computeHolders' marker for an ownerless planted Flag: it occupies its node (no implied Flag
 * may appear there) without holding it for anyone. nodeFlagOwner keeps -1 for such nodes.
 */
const NEUTRAL_FLAG = -2;

/** Cached radius query of one observer (see SurveyScratch.observers). */
interface ObserverNodes {
  x: number;
  z: number;
  r: number;
  version: number;
  pass: number;
  nodes: number[];
}

/** Cross-tick private state of the survey system (lives in world.scratch.survey). */
class SurveyScratch {
  /** Derived arrays as of the previous recompute, for delta events. */
  readonly prevEdgeLey: Int8Array;
  readonly prevFacetCrystal: Int8Array;
  readonly prevFacetSurvey: Uint8Array;
  /** Buffer behind geometryOwners(). */
  readonly realOwner: Int8Array;
  /** computeEnclosure output for one faction at a time. */
  readonly enclosure: Uint8Array;
  /** Lattice version the cached focus nodes were computed for. */
  focusVersion = -1;
  /**
   * Observed-node lists per observer entity (avatar, GCC, Hearth, Ward, zone, Crystal). Most
   * observers stand still, so their radius query is reused until they move, their radius
   * changes or the Crystal turns (lattice version).
   */
  readonly observers = new Map<number, ObserverNodes>();
  /** observe() pass counter and the number of observers marked in the current pass. */
  observePass = 0;
  observed = 0;

  constructor(world: World) {
    const lat = world.lattice;
    this.prevEdgeLey = new Int8Array(lat.edges.length).fill(-1);
    this.prevFacetCrystal = new Int8Array(lat.facets.length).fill(-1);
    this.prevFacetSurvey = new Uint8Array(lat.facets.length);
    this.realOwner = new Int8Array(lat.nodes.length);
    this.enclosure = new Uint8Array(lat.facets.length);
  }
}

function scratchOf(world: World): SurveyScratch {
  const s = world.scratch.survey;
  if (s instanceof SurveyScratch) return s;
  const fresh = new SurveyScratch(world);
  world.scratch.survey = fresh;
  return fresh;
}

export function markSurveyDirty(world: World): void {
  world.survey.dirty = true;
}

export function updateSurvey(world: World, dt: number): void {
  const sc = scratchOf(world);
  collapseObservedSimulacra(world);
  if (world.survey.dirty) recompute(world, sc);
  observe(world, sc);
}

/** Plan edit command (the faction's personal Survey Pattern). */
export function cmdPlan(world: World, c: CommandOf<'plan'>): void {
  const plan = world.factions[c.faction].plan;
  if (c.op === 'clear') plan.clear();
  else if (c.op === 'set') {
    plan.clear();
    for (const n of c.nodes) plan.add(n);
  } else if (c.op === 'add') for (const n of c.nodes) plan.add(n);
  else for (const n of c.nodes) plan.delete(n);
}

/** Is `node` observed (Zeno-frozen) for faction f this tick? */
export function isObserved(world: World, node: number, f: FactionId): boolean {
  return (world.survey.nodeObserved[node] & (1 << f)) !== 0;
}

/**
 * Real Flag owners per node as the lattice geometry reads them (computeHolders,
 * criticalNodes): the faction, NEUTRAL_FLAG (-2) for an ownerless planted Flag, -1 for an
 * empty node. nodeFlagOwner alone keeps -1 for neutral Flags, which would let implied Flags
 * appear on them. Refreshed on every call; the returned buffer is reused, copy it to keep it.
 */
export function geometryOwners(world: World): Int8Array {
  const s = world.survey;
  const real = scratchOf(world).realOwner;
  for (let n = 0; n < real.length; n++) {
    real[n] = s.nodeFlag[n] >= 0 && s.nodeFlagOwner[n] < 0 ? NEUTRAL_FLAG : s.nodeFlagOwner[n];
  }
  return real;
}

// ── Geometry recompute ───────────────────────────────────────────────────────

function recompute(world: World, sc: SurveyScratch): void {
  const lat = world.lattice;
  const s = world.survey;
  sc.prevEdgeLey.set(s.edgeLey);
  sc.prevFacetCrystal.set(s.facetCrystal);
  sc.prevFacetSurvey.set(s.facetSurvey);

  computeHolders(lat, geometryOwners(world), s.holder, s.impliedOwner, s.impliedOrder, IMPLIED_MAX_ORDER);
  computeLeyLines(lat, s.holder, s.edgeLey);
  computeCrystallized(lat, s.holder, s.facetCrystal);

  // Crystallized facets come out of computeEnclosure enclosed (their own Ley Lines wall them in).
  const facetCount = lat.facets.length;
  s.facetSurvey.fill(0);
  for (const f of FACTION_IDS) {
    s.surveySize[f] = 0;
    if (!world.factions[f].alive || !s.edgeLey.includes(f)) continue;
    s.surveySize[f] = computeEnclosure(lat, s.edgeLey, f, sc.enclosure);
    const bit = 1 << f;
    for (let i = 0; i < facetCount; i++) if (sc.enclosure[i] === 1) s.facetSurvey[i] |= bit;
  }

  if (sc.focusVersion !== lat.version) {
    findFocusNodes(lat, s.focusNodes);
    sc.focusVersion = lat.version;
  }

  emitDeltas(world, sc);
  s.version++;
  s.dirty = false;
}

function emitDeltas(world: World, sc: SurveyScratch): void {
  const s = world.survey;
  for (let e = 0; e < s.edgeLey.length; e++) {
    const was = sc.prevEdgeLey[e];
    const now = s.edgeLey[e];
    if (was === now) continue;
    if (isFactionId(was)) world.emit({ t: 'leyLine', edge: e, faction: was, on: false });
    if (isFactionId(now)) world.emit({ t: 'leyLine', edge: e, faction: now, on: true });
  }
  for (let i = 0; i < s.facetCrystal.length; i++) {
    const now = s.facetCrystal[i];
    if (now !== sc.prevFacetCrystal[i] && isFactionId(now)) world.emit({ t: 'facetCrystallized', facet: i, faction: now });
  }
  for (const f of FACTION_IDS) {
    const bit = 1 << f;
    let gained: number[] | null = null;
    let lost: number[] | null = null;
    for (let i = 0; i < s.facetSurvey.length; i++) {
      const diff = (s.facetSurvey[i] ^ sc.prevFacetSurvey[i]) & bit;
      if (diff === 0) continue;
      if (s.facetSurvey[i] & bit) (gained ??= []).push(i);
      else (lost ??= []).push(i);
    }
    if (gained || lost) {
      world.emit({ t: 'surveyChanged', faction: f, gained: gained ?? [], lost: lost ?? [], size: s.surveySize[f] });
    }
    const stats = world.factions[f].stats;
    stats.facetsPeak = Math.max(stats.facetsPeak, s.surveySize[f]);
  }
}

// ── Zeno observation ─────────────────────────────────────────────────────────

/**
 * Rebuild nodeObserved. A node is observed by F when it lies within F's living
 * vexillomancer (12 m), standing GCC (Geomantic Advice, 30 m), Hearths (22 m), built Wards
 * (26 m), Stabilize zones or Crystals (10 m), or (Canon III) when its F Flag has Ley Lines
 * to at least two other held nodes: "every Flag had to be within line of sight of two
 * other Flags", so completed loops watch themselves.
 */
function observe(world: World, sc: SurveyScratch): void {
  const lat = world.lattice;
  const s = world.survey;
  s.nodeObserved.fill(0);
  sc.observePass++;
  sc.observed = 0;

  for (const fac of world.factions) {
    if (!fac.alive) continue;
    const av = world.avatars.get(fac.avatarId);
    if (av && !isAvatarDown(world, av)) markRadius(world, sc, av.id, fac.id, av.pos.x, av.pos.z, AVATAR.observeRadius);
    const gcc = world.gccOf(fac.id);
    if (gcc && gccActive(world, fac.id)) markRadius(world, sc, gcc.id, fac.id, gcc.pos.x, gcc.pos.z, GCC.adviceRadius);
  }
  for (const b of world.buildings.values()) {
    const f = b.faction;
    if (f === NEUTRAL || !world.factions[f].alive) continue;
    if (b.kind === 'hearth') markRadius(world, sc, b.id, f, b.pos.x, b.pos.z, HEARTH_OBSERVE_RADIUS);
    else if (b.kind === 'ward' && b.built >= 1 && !b.disabled) markRadius(world, sc, b.id, f, b.pos.x, b.pos.z, WARD_OBSERVE_RADIUS);
  }
  for (const z of world.zones.values()) {
    if (z.kind === 'stabilize' && z.until > world.time) markRadius(world, sc, z.id, z.faction, z.pos.x, z.pos.z, z.radius);
  }
  for (const c of world.crystals.values()) markRadius(world, sc, c.id, c.faction, c.pos.x, c.pos.z, CRYSTAL_OBSERVE_RADIUS);
  // Forget observers that are gone or stopped observing (only when some did).
  if (sc.observers.size > sc.observed) {
    for (const [id, e] of sc.observers) if (e.pass !== sc.observePass) sc.observers.delete(id);
  }

  // Canon III self-observation.
  for (let n = 0; n < lat.nodes.length; n++) {
    const f = s.nodeFlagOwner[n];
    if (f < 0) continue;
    const edges = lat.nodes[n].edges;
    let lines = 0;
    for (let i = 0; i < edges.length; i++) if (s.edgeLey[edges[i]] === f) lines++;
    if (lines >= 2) s.nodeObserved[n] |= 1 << f;
  }
}

/** Mark faction f's bit on every node within r of observer entity `observer` at (x, z). */
function markRadius(world: World, sc: SurveyScratch, observer: number, f: FactionId, x: number, z: number, r: number): void {
  const lat = world.lattice;
  let e = sc.observers.get(observer);
  if (!e) {
    e = { x: NaN, z: NaN, r: -1, version: -1, pass: 0, nodes: [] };
    sc.observers.set(observer, e);
  }
  if (e.x !== x || e.z !== z || e.r !== r || e.version !== lat.version) {
    e.nodes.length = 0;
    lat.nodesInRadius(x, z, r, e.nodes);
    e.x = x;
    e.z = z;
    e.r = r;
    e.version = lat.version;
  }
  e.pass = sc.observePass;
  sc.observed++;
  const obs = world.survey.nodeObserved;
  const bit = 1 << f;
  const nodes = e.nodes;
  for (let i = 0; i < nodes.length; i++) obs[nodes[i]] |= bit;
}

// ── Superposition ────────────────────────────────────────────────────────────

/** A simulacrum collapses (seeded 50/50) the moment a living enemy unit comes near either node. */
function collapseObservedSimulacra(world: World): void {
  const r2 = GCC.simulacraObserveRadius * GCC.simulacraObserveRadius;
  for (const fl of world.flags.values()) {
    if (fl.state !== 'planted' || fl.altNode < 0) continue;
    if (!enemyNear(world, fl.owner, fl.node, r2) && !enemyNear(world, fl.owner, fl.altNode, r2)) continue;
    collapseSimulacrum(world, fl, world.rng.chance(0.5) ? fl.node : fl.altNode);
  }
}

function enemyNear(world: World, owner: Owner, node: number, r2: number): boolean {
  const n = world.lattice.nodes[node];
  for (const av of world.avatars.values()) {
    if (av.faction === owner || isAvatarDown(world, av) || !world.factions[av.faction].alive) continue;
    const dx = av.pos.x - n.x;
    const dz = av.pos.z - n.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  for (const h of world.hippies.values()) {
    if (h.faction === NEUTRAL || h.faction === owner || h.koUntil > world.time) continue;
    const dx = h.pos.x - n.x;
    const dz = h.pos.z - n.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}
