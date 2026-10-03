/**
 * World staging for the Training Burn: where lessons put things and what they lend the
 * trainee. Every helper goes through the sim's own entry points (factory, flags, planner,
 * survey geometry), so staged Flags, loops and grants obey the same rules as played ones.
 * Called on lesson beats, never per tick, unless noted.
 */
import { IMPLIED_MAX_ORDER } from '../sim/constants';
import { spawnFlag } from '../sim/factory';
import { computeEnclosure, computeHolders, computeLeyLines } from '../sim/lattice/geometry';
import type { V2 } from '../sim/math';
import { CALM_RADIUS } from '../sim/scenarios/tutorial';
import { canPlantAt, depositToStock, plantFlag, pullFlag, takeFromStock } from '../sim/systems/flags';
import { geometryOwners } from '../sim/systems/survey';
import type { EntityId, FactionId, Flag, Owner } from '../sim/types';
import type { World } from '../sim/world';

/**
 * A point `dist` m from the faction's main Hearth, `turn` radians counter-clockwise (x toward
 * z) of the line from that Hearth to the centre of the burn. Lessons lay out their drills
 * with it, so the course reads the same from the camp whatever the map.
 */
export function campPoint(world: World, f: FactionId, dist: number, turn: number): V2 {
  const hearth = world.hearthOf(f);
  const hx = hearth ? hearth.pos.x : 0;
  const hz = hearth ? hearth.pos.z : 0;
  const a = Math.atan2(-hz, -hx) + turn;
  return { x: hx + Math.cos(a) * dist, z: hz + Math.sin(a) * dist };
}

/** campSpots' search grid: metres and radians between candidates, and how far it reaches. */
const SPOT_STEP_DIST = 4;
const SPOT_STEP_TURN = 0.15;
const SPOT_RINGS = 6;
const SPOT_TURNS = 9;

/**
 * Candidate drill spots around campPoint(dist, turn), nearest the wish first: a grid of
 * distances and turns either side of it, never closer than 12 m to the Hearth. Lessons take
 * the first spot that stages cleanly, so a crowded or cluttered patch shifts the drill
 * instead of breaking it.
 */
export function campSpots(world: World, f: FactionId, dist: number, turn: number): V2[] {
  const out: { p: V2; cost: number }[] = [];
  for (let i = -SPOT_RINGS; i <= SPOT_RINGS; i++) {
    const d = dist + i * SPOT_STEP_DIST;
    if (d < 12) continue;
    for (let j = -SPOT_TURNS; j <= SPOT_TURNS; j++) out.push({ p: campPoint(world, f, d, turn + j * SPOT_STEP_TURN), cost: Math.abs(i) + Math.abs(j) });
  }
  // Stable sort: equal costs keep grid order, so the choice is deterministic.
  out.sort((a, b) => a.cost - b.cost);
  return out.map((c) => c.p);
}

/**
 * The node within `r` of (x, z) with the lowest `score` (Infinity rejects). Ties go to the
 * lower node id, so staging is deterministic.
 */
export function bestNode(world: World, x: number, z: number, r: number, score: (n: number, d: number) => number): number {
  const lat = world.lattice;
  const near = lat.nodesInRadius(x, z, r);
  near.sort((a, b) => a - b);
  let best = -1;
  let bestScore = Infinity;
  for (const n of near) {
    const node = lat.nodes[n];
    const s = score(n, Math.hypot(node.x - x, node.z - z));
    if (s < bestScore) {
      bestScore = s;
      best = n;
    }
  }
  return best;
}

/** How far round each drill spot spotNode looks for a node. */
const SPOT_NODE_RADIUS = 6;

/**
 * The node nearest the first drill spot (campSpots around dist/turn) that has one passing
 * `ok`. -1 if the whole grid is unusable.
 */
export function spotNode(world: World, f: FactionId, dist: number, turn: number, ok: (n: number) => boolean): number {
  for (const p of campSpots(world, f, dist, turn)) {
    const n = bestNode(world, p.x, p.z, SPOT_NODE_RADIUS, (m, d) => (ok(m) ? d : Infinity));
    if (n >= 0) return n;
  }
  return -1;
}

/** Is (x, z) within `r` of a Hearth whose owner is not one of `except`? */
export function nearHearth(world: World, x: number, z: number, r: number, except: readonly Owner[]): boolean {
  for (const b of world.buildings.values()) {
    if (b.kind !== 'hearth' || except.includes(b.faction)) continue;
    if ((b.pos.x - x) ** 2 + (b.pos.z - z) ** 2 < r * r) return true;
  }
  return false;
}

/**
 * Plantable for `f` with no planted Flag (anyone's) on a neighbouring node and out of every
 * rival Hearth's threat range: a quiet spot whose Ley Lines are only the ones the lesson asks for.
 */
export function quietNode(world: World, n: number, f: FactionId): boolean {
  if (!canPlantAt(world, n, f)) return false;
  const lat = world.lattice;
  for (const e of lat.nodes[n].edges) if (world.survey.nodeFlag[lat.other(e, n)] >= 0) return false;
  return !nearHearth(world, lat.nodes[n].x, lat.nodes[n].z, CALM_RADIUS, [f]);
}

/** Ground distance from the faction's vexillomancer to (x, z). */
export function avatarDistance(world: World, f: FactionId, x: number, z: number): number {
  const av = world.avatarOf(f);
  return Math.hypot(av.pos.x - x, av.pos.z - z);
}

/** Ground distance from node `n` to (x, z). */
export function nodeDistance(world: World, n: number, x: number, z: number): number {
  const node = world.lattice.nodes[n];
  return Math.hypot(node.x - x, node.z - z);
}

/**
 * Make sure the vexillomancer carries at least `count` Flags: from the Hearth stock first,
 * fresh ones if the stock runs dry (the Training Burn never runs out of Flags).
 */
export function topUpQuiver(world: World, f: FactionId, count: number): void {
  const av = world.avatarOf(f);
  const hearth = world.hearthOf(f);
  while (av.carried.length < count) {
    if (hearth && takeFromStock(world, hearth.id, av.id)) continue;
    const fl = spawnFlag(world, { state: 'carried', owner: f, holder: av.id, pos: { ...av.pos } });
    av.carried.push(fl.id);
  }
}

/** Make sure the faction's main Hearth stocks at least `count` Flags. */
export function topUpStock(world: World, f: FactionId, count: number): void {
  const hearth = world.hearthOf(f);
  if (!hearth) return;
  for (let have = world.stockOf(hearth.id).length; have < count; have++) {
    spawnFlag(world, { state: 'stock', owner: f, holder: hearth.id, pos: { x: hearth.pos.x, y: 0, z: hearth.pos.z } });
  }
}

/** Plant a fresh Flag of `f` on `node` (a staged Flag: planted by nobody). Returns its id, or -1. */
export function plantFresh(world: World, f: FactionId, node: number): EntityId | -1 {
  const n = world.lattice.nodes[node];
  const fl = spawnFlag(world, { state: 'loose', owner: f, pos: { x: n.x, y: 0, z: n.z } });
  if (plantFlag(world, fl.id, node, f, -1)) return fl.id;
  world.flags.delete(fl.id);
  return -1;
}

/**
 * Send `owner`'s planted Flags that match `pick` home to its Hearth stock. Each is pulled
 * first (flagPulled), so presentation sees it leave the ground.
 */
export function recallFlags(world: World, owner: FactionId, pick: (fl: Flag) => boolean): void {
  const hearth = world.hearthOf(owner);
  if (!hearth) return;
  const ids: EntityId[] = [];
  for (const fl of world.flags.values()) if (fl.owner === owner && fl.state === 'planted' && pick(fl)) ids.push(fl.id);
  for (const id of ids) {
    pullFlag(world, id, -1);
    depositToStock(world, id, hearth.id);
  }
}

/** Order-independent fingerprint of a faction's plan: changes whenever nodes are added or removed. */
export function planPrint(plan: ReadonlySet<number>): number {
  let h = plan.size;
  for (const n of plan) h = (h + Math.imul(n + 1, 0x9e3779b1)) | 0;
  return h;
}

/**
 * "Would `f` enclose `facet` if it also held these nodes?" with the real Survey geometry
 * (implied Flags and rival interference included). Buffers are sized once per lattice; a
 * probe runs on plan changes, not every tick.
 */
export class EnclosureProbe {
  private readonly owner: Int8Array;
  private readonly holder: Int8Array;
  private readonly impliedOwner: Int8Array;
  private readonly impliedOrder: Uint8Array;
  private readonly ley: Int8Array;
  private readonly enclosed: Uint8Array;

  constructor(world: World) {
    const lat = world.lattice;
    this.owner = new Int8Array(lat.nodes.length);
    this.holder = new Int8Array(lat.nodes.length);
    this.impliedOwner = new Int8Array(lat.nodes.length);
    this.impliedOrder = new Uint8Array(lat.nodes.length);
    this.ley = new Int8Array(lat.edges.length);
    this.enclosed = new Uint8Array(lat.facets.length);
  }

  encloses(world: World, f: FactionId, extra: Iterable<number>, facet: number): boolean {
    const lat = world.lattice;
    if (facet < 0 || facet >= lat.facets.length) return false;
    this.owner.set(geometryOwners(world));
    for (const n of extra) {
      // Rival Flags on the way get pulled and replanted ("pull, then plant"); blocked ground never holds.
      if (n >= 0 && n < lat.nodes.length && !lat.nodes[n].blocked) this.owner[n] = f;
    }
    computeHolders(lat, this.owner, this.holder, this.impliedOwner, this.impliedOrder, IMPLIED_MAX_ORDER);
    computeLeyLines(lat, this.holder, this.ley);
    computeEnclosure(lat, this.ley, f, this.enclosed);
    return this.enclosed[facet] === 1;
  }
}
