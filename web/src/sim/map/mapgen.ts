/**
 * Burn map generation: an Alchemy-style Georgia burn on a flat 300 × 300 m field.
 * Deterministic per seed (all randomness comes from `Rng`).
 *
 * - Four corner camps at CAMP_CENTERS. Each camp's zone (everything within FAIR_RADIUS, plus
 *   the map corner behind it) is a rotated copy (C4, small rigid jitter per group) of one
 *   generated zone, so no corner is favoured.
 * - Conquest corridor: no node within CAMP_CLEAR_RADIUS of a camp centre is ever blocked, so
 *   a rival can always close a Ley loop around a Hearth outside its home ring (see the
 *   constant for the geometry). The camp's own tents and shade sit behind it in the corner,
 *   past the corridor; the clutter of the zone rings the corridor and makes routes matter.
 * - The effigy (The Flag) stands on the Omega Node at the origin inside a clear plaza.
 * - Dirt roads: a C4-symmetric ring road, a spoke from the plaza into every camp, meandering
 *   footpaths to the sound camps and past the pond. Obstacles never cover a road, so every
 *   camp keeps a road route to the plaza and to every other camp (nothing is sealed) while
 *   the clutter decides which off-road shortcuts exist.
 * - The middle band (outside the camp zones) is generated per cardinal arm with one recipe and
 *   independent dice: asymmetric but balanced. One sound camp per arm, one pond on the inner
 *   playa.
 *
 * Owner: MapPhysics agent. Consumers: setup.ts, lattice blocking, collision, nav, render env.
 */
import { CAMP_CENTERS, FLAG_YELLOW, LEY_EDGE, MAP_HALF, PILE_COUNT } from '../constants';
import { distToSegment, TAU, yawTo } from '../math';
import type { V2 } from '../math';
import { Rng } from '../rng';
import { FACTION_IDS } from '../types';
import type { FactionId } from '../types';

export type ObstacleKind =
  | 'tent'
  | 'dome'
  | 'art'
  | 'porta'
  | 'tree'
  | 'rock'
  | 'stage'
  | 'shade'
  | 'car'
  | 'effigy';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  /**
   * 'circle' uses radius; 'box' uses hx/hz half extents rotated by yaw (three.js
   * rotation.y = yaw: local +z faces (sin yaw, cos yaw)). For boxes `radius` is the bounding
   * radius.
   */
  shape: 'circle' | 'box';
  radius: number;
  hx: number;
  hz: number;
  yaw: number;
  height: number;
  /** Presentation variation seed. */
  seed: number;
  /** Optional presentation tint (tents, art). */
  color: number;
  /**
   * Presentation sub-type: tent 0 dome tent, 1 bell tent, 2 cabin tent (box); tree 0 Georgia
   * pine, 1 live oak (radius = trunk); car 0 sedan, 1 van, 2 camper bus; art 0..5 sculpture
   * style; 0 for every other kind.
   */
  variant: number;
}

export interface Road {
  points: V2[];
  width: number;
}

export interface Water {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

/** Walkable mud around the pond (axis-aligned ellipse, like Water). */
export interface MudPatch {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface SoundCamp {
  name: string;
  x: number;
  z: number;
  radius: number;
  color: number;
}

export type GroundType = 'grass' | 'dirt' | 'road' | 'mud' | 'water';

export interface MapLayout {
  seed: string;
  half: number;
  camps: { faction: FactionId; x: number; z: number }[];
  obstacles: Obstacle[];
  roads: Road[];
  water: Water[];
  mud: MudPatch[];
  soundCamps: SoundCamp[];
  pileSpots: V2[];
  neutralSpawns: V2[];
  effigy: V2;
  /** Static blocking (obstacles + water): used for lattice node blocking and nav. */
  isBlockedAt(x: number, z: number): boolean;
  /** Ground surface type (presentation + movement modifiers). */
  groundAt(x: number, z: number): GroundType;
}

// ── Layout constants ──────────────────────────────────────────────────────────
/**
 * Around every Hearth a rival can always close a Ley loop whose nodes all keep at least this
 * far from it: room to enclose a camp outside its home ring, even one grown a band wider.
 */
export const RIVAL_LOOP_RADIUS = 24;
/**
 * The Hearth stands on the thick facet nearest the camp centre (setup), whose centre is never
 * farther than this from it (the worst of 1800 sampled camps: 7.13 m).
 */
export const HEARTH_OFFSET_MAX = 7.5;
/** The longest rhombus diagonal (the thin facet's): no facet spans farther. */
export const FACET_SPAN = 2 * LEY_EDGE * Math.cos(Math.PI / 10);
/**
 * Conquest corridor: no node within this radius of a camp centre is ever blocked (obstacle
 * footprints keep OBSTACLE_PAD beyond it). Why it suffices: the facets around the nodes that
 * lie within r of the Hearth reach at most r + FACET_SPAN from it, so when none of their
 * corners is blocked the outline of that patch is a closed loop of plantable nodes around the
 * Hearth with every node at least r away. With r = RIVAL_LOOP_RADIUS around a Hearth up to
 * HEARTH_OFFSET_MAX off-centre, nothing may block within the sum. The argument holds for any
 * rhombus tiling, so phason flips cannot seal a camp either. Narrow corridors fail because two
 * blocked corners of one rhombus make a link no loop can cross, and chains of such links
 * (tents, shades, the edge tree line) cut thin bands of free nodes.
 */
export const CAMP_CLEAR_RADIUS = RIVAL_LOOP_RADIUS + FACET_SPAN + HEARTH_OFFSET_MAX;
/** Clear plaza around the effigy: the Omega Node's five neighbours (8 m out) stay plantable. */
export const PLAZA_RADIUS = 16;
/** isBlockedAt padding around obstacle footprints (keeps Flags off tent walls). */
export const OBSTACLE_PAD = 0.6;
/**
 * Each camp's zone (this radius around its centre, plus the map corner behind it) is a
 * rotated copy of camp 0's zone.
 */
export const FAIR_RADIUS = 70;
export const RING_ROAD_RADIUS = 62;
export const EFFIGY_RADIUS = 2.5;
export const EFFIGY_HEIGHT = 26;
/** Sound camp entry radius: distracted hippies drift here. */
export const SOUND_CAMP_RADIUS = 14;
export const SOUND_CAMP_NAMES: readonly string[] = [
  'Too Late Show Stage',
  'Noosphere Lounge',
  'Mega Harvard Quad',
  'The Labyrinth',
];
/** Lumber piles never spawn closer than this to a camp centre. */
export const PILE_CAMP_MIN_DIST = 12;

const BORDER_MARGIN = 2.5; // footprints stay this far inside the map edge
const JITTER = 0.5; // rigid per-group translation jitter of each quadrant copy (m)
const CAMP_GROUND_RADIUS = 28; // trampled dirt around a camp centre (presentation)
const SPOKE_WIDTH = 5;
const RING_WIDTH = 6;
const PATH_WIDTH = 2.6;
const ROAD_GAP = 1.5; // obstacle clearance beyond a road's half width
const DANCE_FLOOR = 9.5; // open floor in front of a stage
const PILE_CLEARANCE = 2.5; // pile spot to nearest obstacle footprint
const INDEX_CELL = 8; // spatial hash cell for isBlockedAt / groundAt

const TENT_COLORS: readonly number[] = [
  0xe0662e, 0x2f7fd8, 0x3aa564, 0xc8423a, 0x8a53c1, 0x1f9e95, 0xe2487f, 0x5b6d8a, 0xd0703c, 0x6fb7e6,
];
const TARP_COLORS: readonly number[] = [0xcfd4d6, 0xd8c8a2, 0xb5533f, 0x4b7bb5, 0x7f9a5a];
const CAR_COLORS: readonly number[] = [0xf2f2ef, 0xb9bec4, 0x2b2d31, 0xa8322d, 0x2f5597, 0x4f6b45, 0xcbb994, 0x7d1f3a];
const ART_COLORS: readonly number[] = [0xff4fa3, 0x2fe0ff, 0xff8a2a, 0xf4f0ff, 0xa65cff, 0x45ff9a, 0xff4a4a];
const PORTA_COLORS: readonly number[] = [0x2f6fd6, 0x2e9e5b, 0xe07a2a];
const PINE_COLORS: readonly number[] = [0x2c5228, 0x33602d, 0x27482a];
const OAK_COLORS: readonly number[] = [0x4c7431, 0x587f37, 0x456b2c];
const ROCK_COLORS: readonly number[] = [0x8d8a83, 0x7b776f, 0x9c968b];
const SOUND_COLORS: readonly number[] = [0xff3fb4, 0x35d7ff, 0xffa21f, 0x9b5cff];
const DOME_COLOR = 0xf3f1ea;

// ── Footprint geometry ────────────────────────────────────────────────────────

/** Ground footprint of an obstacle (Obstacle satisfies this). */
export interface Footprint {
  shape: 'circle' | 'box';
  x: number;
  z: number;
  radius: number;
  hx: number;
  hz: number;
  yaw: number;
}

/** Distance from (x, z) to a footprint; 0 inside. */
export function footprintDistance(f: Footprint, x: number, z: number): number {
  const dx = x - f.x;
  const dz = z - f.z;
  if (f.shape === 'circle') return Math.max(0, Math.sqrt(dx * dx + dz * dz) - f.radius);
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const ex = Math.max(0, Math.abs(dx * c - dz * s) - f.hx);
  const ez = Math.max(0, Math.abs(dx * s + dz * c) - f.hz);
  return Math.sqrt(ex * ex + ez * ez);
}

/** Box corner i (0..3) in world space. */
function corner(f: Footprint, i: number, out: V2): V2 {
  const lx = i === 0 || i === 3 ? -f.hx : f.hx;
  const lz = i < 2 ? -f.hz : f.hz;
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  out.x = f.x + lx * c + lz * s;
  out.z = f.z - lx * s + lz * c;
  return out;
}

/** Farthest distance from (x, z) to any point of the footprint. */
function footprintReach(f: Footprint, x: number, z: number): number {
  if (f.shape === 'circle') return Math.hypot(f.x - x, f.z - z) + f.radius;
  let best = 0;
  const p = { x: 0, z: 0 };
  for (let i = 0; i < 4; i++) {
    corner(f, i, p);
    best = Math.max(best, Math.hypot(p.x - x, p.z - z));
  }
  return best;
}

function boxesOverlap(a: Footprint, b: Footprint): boolean {
  const axes = [a.yaw, b.yaw];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  for (const yaw of axes) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Local x axis (c, -s) and local z axis (s, c) of the box that owns `yaw`.
    for (let k = 0; k < 2; k++) {
      const lx = k === 0 ? c : s;
      const lz = k === 0 ? -s : c;
      const ra = a.hx * Math.abs(ca * lx - sa * lz) + a.hz * Math.abs(sa * lx + ca * lz);
      const rb = b.hx * Math.abs(cb * lx - sb * lz) + b.hz * Math.abs(sb * lx + cb * lz);
      if (Math.abs(dx * lx + dz * lz) > ra + rb) return false;
    }
  }
  return true;
}

/** Gap between two footprints (0 when they touch or overlap). */
function footprintGap(a: Footprint, b: Footprint): number {
  if (a.shape === 'circle' && b.shape === 'circle') {
    return Math.max(0, Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius);
  }
  if (a.shape === 'circle') return Math.max(0, footprintDistance(b, a.x, a.z) - a.radius);
  if (b.shape === 'circle') return Math.max(0, footprintDistance(a, b.x, b.z) - b.radius);
  if (boxesOverlap(a, b)) return 0;
  // Disjoint convex polygons: the closest pair always involves a vertex of one of them.
  let best = Infinity;
  const p = { x: 0, z: 0 };
  for (let i = 0; i < 4; i++) {
    corner(a, i, p);
    best = Math.min(best, footprintDistance(b, p.x, p.z));
    corner(b, i, p);
    best = Math.min(best, footprintDistance(a, p.x, p.z));
  }
  return best;
}

/** Gap between a segment and a footprint (0 when they touch). */
function segmentGap(ax: number, az: number, bx: number, bz: number, f: Footprint): number {
  if (f.shape === 'circle') return Math.max(0, distToSegment(f.x, f.z, ax, az, bx, bz) - f.radius);
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const lax = (ax - f.x) * c - (az - f.z) * s;
  const laz = (ax - f.x) * s + (az - f.z) * c;
  const lbx = (bx - f.x) * c - (bz - f.z) * s;
  const lbz = (bx - f.x) * s + (bz - f.z) * c;
  // Liang-Barsky: does the local segment cross the box?
  let t0 = 0;
  let t1 = 1;
  const dx = lbx - lax;
  const dz = lbz - laz;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (clip(-dx, lax + f.hx) && clip(dx, f.hx - lax) && clip(-dz, laz + f.hz) && clip(dz, f.hz - laz)) return 0;
  let best = Infinity;
  for (let e = 0; e < 2; e++) {
    const ex = Math.max(0, Math.abs(e === 0 ? lax : lbx) - f.hx);
    const ez = Math.max(0, Math.abs(e === 0 ? laz : lbz) - f.hz);
    best = Math.min(best, Math.sqrt(ex * ex + ez * ez));
  }
  for (let i = 0; i < 4; i++) {
    const cx = i === 0 || i === 3 ? -f.hx : f.hx;
    const cz = i < 2 ? -f.hz : f.hz;
    best = Math.min(best, distToSegment(cx, cz, lax, laz, lbx, lbz));
  }
  return best;
}

// ── Placement ─────────────────────────────────────────────────────────────────

interface Draft extends Footprint {
  kind: ObstacleKind;
  height: number;
  color: number;
  variant: number;
  /** Rigid jitter group: rows and clusters move together, so they never self-overlap. */
  group: number;
  /** Axis-aligned half extents (broad phase). */
  ex: number;
  ez: number;
}

interface Disk {
  x: number;
  z: number;
  r: number;
}

interface RoadSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
}

function circleDraft(
  kind: ObstacleKind,
  x: number,
  z: number,
  r: number,
  height: number,
  color: number,
  variant: number,
  group: number,
  yaw = 0,
): Draft {
  return { kind, shape: 'circle', x, z, radius: r, hx: r, hz: r, yaw, height, color, variant, group, ex: r, ez: r };
}

function boxDraft(
  kind: ObstacleKind,
  x: number,
  z: number,
  hx: number,
  hz: number,
  yaw: number,
  height: number,
  color: number,
  variant: number,
  group: number,
): Draft {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return {
    kind,
    shape: 'box',
    x,
    z,
    radius: Math.hypot(hx, hz),
    hx,
    hz,
    yaw,
    height,
    color,
    variant,
    group,
    ex: c * hx + s * hz,
    ez: s * hx + c * hz,
  };
}

/** Keep-out zone for placement (plaza, camp clears, dance floors, pond, mud). */
function keepOutDisk(x: number, z: number, r: number): Draft {
  return circleDraft('rock', x, z, r, 0, 0, 0, -1);
}

/*
 * Camp zones: the disk (x, z, r) around a camp centre plus the map corner behind the camp
 * (beyond its centre on both axes). The corner lies outside the fairness disk but belongs to
 * no arm, so the camp's rotated copies own it too.
 */

/** The whole footprint lies in the zone: within r - margin, or margin deep in the corner. */
function zoneHolds(zone: Disk, f: Draft, margin: number): boolean {
  if (footprintReach(f, zone.x, zone.z) <= zone.r - margin) return true;
  return f.x * Math.sign(zone.x) - f.ex >= Math.abs(zone.x) + margin && f.z * Math.sign(zone.z) - f.ez >= Math.abs(zone.z) + margin;
}

/** Some of the footprint reaches into the zone. */
function zoneTouches(zone: Disk, f: Draft): boolean {
  if (footprintDistance(f, zone.x, zone.z) < zone.r) return true;
  return f.x * Math.sign(zone.x) + f.ex > Math.abs(zone.x) && f.z * Math.sign(zone.z) + f.ez > Math.abs(zone.z);
}

/** Collects drafts and rejects candidates that hit roads, keep-outs or other drafts. */
class Placer {
  readonly drafts: Draft[] = [];
  readonly keepOut: Draft[] = [];
  readonly segs: RoadSeg[] = [];
  /** Footprints must lie inside this camp zone (quadrant generation), `zoneMargin` inside. */
  zone: Disk | null = null;
  zoneMargin = 0;
  /** Footprints must stay out of these camp zones (middle band). */
  readonly outside: Disk[] = [];
  nextGroup = 0;

  /**
   * @param groupMargin extra gap between different groups (absorbs per-copy jitter)
   * @param roadGap clearance beyond each road's half width
   */
  constructor(
    private readonly groupMargin: number,
    private readonly roadGap: number,
  ) {}

  addRoad(road: Road): void {
    for (let i = 0; i + 1 < road.points.length; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      this.segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, hw: road.width / 2 });
    }
  }

  fits(f: Draft, gap: number): boolean {
    const lim = MAP_HALF - BORDER_MARGIN;
    if (Math.abs(f.x) + f.ex > lim || Math.abs(f.z) + f.ez > lim) return false;
    if (this.zone && !zoneHolds(this.zone, f, this.zoneMargin)) return false;
    for (const o of this.outside) if (zoneTouches(o, f)) return false;
    for (const k of this.keepOut) {
      if (Math.abs(k.x - f.x) > k.ex + f.ex || Math.abs(k.z - f.z) > k.ez + f.ez) continue;
      if (footprintGap(f, k) <= 0) return false;
    }
    for (const s of this.segs) {
      const need = s.hw + this.roadGap;
      if (f.x + f.ex < Math.min(s.ax, s.bx) - need || f.x - f.ex > Math.max(s.ax, s.bx) + need) continue;
      if (f.z + f.ez < Math.min(s.az, s.bz) - need || f.z - f.ez > Math.max(s.az, s.bz) + need) continue;
      if (segmentGap(s.ax, s.az, s.bx, s.bz, f) < need) return false;
    }
    for (const d of this.drafts) {
      const need = d.group === f.group ? gap : gap + this.groupMargin;
      if (Math.abs(d.x - f.x) > d.ex + f.ex + need || Math.abs(d.z - f.z) > d.ez + f.ez + need) continue;
      if (footprintGap(f, d) < need) return false;
    }
    return true;
  }

  /** Push the first fitting candidate out of `tries` attempts. */
  place(tries: number, gap: number, make: () => Draft): Draft | null {
    for (let t = 0; t < tries; t++) {
      const d = make();
      if (this.fits(d, gap)) {
        this.drafts.push(d);
        return d;
      }
    }
    return null;
  }

  /** Clearance from (x, z) to the nearest draft footprint. */
  clearance(x: number, z: number): number {
    let best = Infinity;
    for (const d of this.drafts) {
      if (Math.abs(d.x - x) > d.ex + best || Math.abs(d.z - z) > d.ez + best) continue;
      best = Math.min(best, footprintDistance(d, x, z));
    }
    return best;
  }
}

// ── Recipes ───────────────────────────────────────────────────────────────────

function tentDraft(rng: Rng, x: number, z: number, group: number, faceX: number, faceZ: number): Draft {
  const yaw = yawTo(x, z, faceX, faceZ);
  const color = rng.pick(TENT_COLORS);
  const roll = rng.next();
  if (roll < 0.65) return circleDraft('tent', x, z, rng.range(1.3, 2.0), rng.range(1.4, 1.9), color, 0, group, yaw);
  if (roll < 0.85) return circleDraft('tent', x, z, rng.range(2.1, 2.6), rng.range(2.4, 3.0), color, 1, group, yaw);
  return boxDraft('tent', x, z, rng.range(1.4, 2.0), rng.range(1.1, 1.5), yaw, rng.range(1.9, 2.3), color, 2, group);
}

function treeDraft(rng: Rng, x: number, z: number, group: number): Draft {
  const oak = rng.chance(0.35);
  const yaw = rng.range(-Math.PI, Math.PI);
  return oak
    ? circleDraft('tree', x, z, rng.range(0.45, 0.7), rng.range(7, 11), rng.pick(OAK_COLORS), 1, group, yaw)
    : circleDraft('tree', x, z, rng.range(0.35, 0.5), rng.range(10, 16), rng.pick(PINE_COLORS), 0, group, yaw);
}

function artDraft(rng: Rng, x: number, z: number, group: number, rMax: number): Draft {
  return circleDraft(
    'art',
    x,
    z,
    rng.range(1.5, rMax),
    rng.range(3, 12),
    rng.pick(ART_COLORS),
    rng.int(0, 5),
    group,
    rng.range(-Math.PI, Math.PI),
  );
}

function domeDraft(rng: Rng, x: number, z: number, group: number, rMin: number, rMax: number): Draft {
  const r = rng.range(rMin, rMax);
  return circleDraft('dome', x, z, r, r * 0.85, DOME_COLOR, 0, group, rng.range(-Math.PI, Math.PI));
}

function rockDraft(rng: Rng, x: number, z: number, group: number): Draft {
  return circleDraft(
    'rock',
    x,
    z,
    rng.range(0.7, 1.4),
    rng.range(0.7, 1.3),
    rng.pick(ROCK_COLORS),
    0,
    group,
    rng.range(-Math.PI, Math.PI),
  );
}

/** A grove of pines and live oaks (trunks 2.6 m apart) with a boulder or two. */
function placeGrove(p: Placer, rng: Rng, cx: number, cz: number, radius: number, trees: number): number {
  const group = p.nextGroup++;
  let placed = 0;
  for (let i = 0; i < trees; i++) {
    const ok = p.place(10, 2.6, () => {
      const a = rng.range(0, TAU);
      const d = radius * Math.sqrt(rng.next());
      return treeDraft(rng, cx + Math.cos(a) * d, cz + Math.sin(a) * d, group);
    });
    if (ok) placed++;
  }
  if (placed > 0 && rng.chance(0.6)) {
    p.place(6, 1.5, () => {
      const a = rng.range(0, TAU);
      const d = radius * rng.range(0.7, 1.1);
      return rockDraft(rng, cx + Math.cos(a) * d, cz + Math.sin(a) * d, group);
    });
  }
  return placed;
}

/**
 * The Georgia tree line along a map edge: walk a→b (on the edge) placing pines and oaks
 * 3.5-12 m in from the border along the inward normal (inX, inZ), sometimes two deep.
 */
function placeForestEdge(p: Placer, rng: Rng, ax: number, az: number, bx: number, bz: number, inX: number, inZ: number): void {
  const group = p.nextGroup++;
  const len = Math.hypot(bx - ax, bz - az);
  for (let s = rng.range(0, 4); s < len; s += rng.range(4.5, 8)) {
    const ex = ax + ((bx - ax) * s) / len;
    const ez = az + ((bz - az) * s) / len;
    const rows = rng.chance(0.35) ? 2 : 1;
    let depth = rng.range(3.5, 8);
    for (let r = 0; r < rows; r++) {
      p.place(3, 2.6, () => treeDraft(rng, ex + inX * depth + rng.range(-1, 1), ez + inZ * depth + rng.range(-1, 1), group));
      depth += rng.range(4, 6);
    }
  }
}

/** A little tent camp: 2-3 tents around a shared spot, doors facing it. */
function placeTentCamp(p: Placer, rng: Rng, cx: number, cz: number): void {
  const group = p.nextGroup++;
  const tents = rng.int(2, 3);
  for (let i = 0; i < tents; i++) {
    p.place(6, 1.2, () => {
      const a = rng.range(0, TAU);
      const d = rng.range(3, 4.5);
      return tentDraft(rng, cx + Math.cos(a) * d, cz + Math.sin(a) * d, group, cx, cz);
    });
  }
}

/** A theme camp: a shade structure ringed by dome tents (doors facing the shade). */
function placeTentCluster(p: Placer, rng: Rng, cx: number, cz: number, tents: number, dirt: Disk[]): boolean {
  const group = p.nextGroup++;
  const shade = boxDraft(
    'shade',
    cx,
    cz,
    rng.range(2.5, 3.5),
    rng.range(2, 2.8),
    rng.range(-Math.PI, Math.PI),
    rng.range(3, 3.5),
    rng.pick(TARP_COLORS),
    0,
    group,
  );
  if (!p.fits(shade, 1.5)) return false;
  p.drafts.push(shade);
  const ring = rng.range(7, 8.5);
  const phase = rng.range(0, TAU);
  for (let i = 0; i < tents; i++) {
    p.place(4, 1.2, () => {
      const a = phase + (i / tents) * TAU + rng.range(-0.25, 0.25);
      const d = ring + rng.range(-0.6, 0.8);
      return tentDraft(rng, cx + Math.cos(a) * d, cz + Math.sin(a) * d, group, cx, cz);
    });
  }
  dirt.push({ x: cx, z: cz, r: 9 });
  return true;
}

/**
 * A straight row of identical-footprint units (porta-potties) along `dir`, starting at
 * (sx, sz), each facing (fx, fz). Placed only if the whole row fits.
 */
function placePortaRow(p: Placer, rng: Rng, sx: number, sz: number, dirX: number, dirZ: number, fx: number, fz: number): boolean {
  const n = rng.int(6, 10);
  const pitch = 1.42;
  const h = 0.62;
  const len = (n - 1) * pitch;
  const group = p.nextGroup++;
  const rowYaw = Math.atan2(-dirZ, dirX); // local x along the row
  const bound = boxDraft('porta', sx + (dirX * len) / 2, sz + (dirZ * len) / 2, len / 2 + h, h, rowYaw, 2.3, 0, 0, group);
  if (!p.fits(bound, 1.5)) return false;
  const color = rng.pick(PORTA_COLORS);
  const yaw = Math.atan2(fx, fz);
  for (let i = 0; i < n; i++) {
    p.drafts.push(boxDraft('porta', sx + dirX * pitch * i, sz + dirZ * pitch * i, h, h, yaw, 2.3, color, 0, group));
  }
  return true;
}

/**
 * Nose-in parked cars along a map edge. `ox, oz` is the outward (toward the edge) normal;
 * (ux, uz) runs along the row; (cx, cz) is the nose line centre.
 */
function placeCarRow(p: Placer, rng: Rng, cx: number, cz: number, ox: number, oz: number, ux: number, uz: number): boolean {
  const n = rng.int(5, 8);
  const sizes: { hx: number; hz: number; h: number; v: number }[] = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    const roll = rng.next();
    const s =
      roll < 0.7
        ? { hx: 0.95, hz: 2.25, h: 1.45, v: 0 }
        : roll < 0.92
          ? { hx: 1.0, hz: 2.55, h: 2.1, v: 1 }
          : { hx: 1.25, hz: 4.3, h: 3.0, v: 2 };
    sizes.push(s);
    len += 2 * s.hx + (i > 0 ? 0.9 : 0);
  }
  const group = p.nextGroup++;
  const deepest = Math.max(...sizes.map((s) => s.hz));
  const rowYaw = Math.atan2(-uz, ux);
  const bound = boxDraft('car', cx - ox * deepest, cz - oz * deepest, len / 2, deepest, rowYaw, 2, 0, 0, group);
  if (!p.fits(bound, 1.5)) return false;
  const yaw = Math.atan2(ox, oz); // nose toward the edge
  let u = -len / 2;
  for (const s of sizes) {
    u += s.hx;
    const x = cx + ux * u - ox * s.hz;
    const z = cz + uz * u - oz * s.hz;
    p.drafts.push(boxDraft('car', x, z, s.hx, s.hz, yaw, s.h, rng.pick(CAR_COLORS), s.v, group));
    u += s.hx + 0.9;
  }
  return true;
}

// ── Roads ─────────────────────────────────────────────────────────────────────

/**
 * The ring road. Its wobble uses only 4-fold harmonics and n is a multiple of 4, so a quarter
 * turn maps it onto itself: it crosses every camp zone the same way.
 */
function ringRoad(rng: Rng): Road {
  const points: V2[] = [];
  const n = 72;
  const p1 = rng.range(0, TAU);
  const p2 = rng.range(0, TAU);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = RING_ROAD_RADIUS + 0.9 * Math.sin(4 * a + p1) + 0.5 * Math.sin(8 * a + p2);
    points.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  points.push({ x: points[0].x, z: points[0].z });
  return { points, width: RING_WIDTH };
}

/** Straight spoke from inside the plaza to just short of a camp centre. */
function spokeRoad(cx: number, cz: number): Road {
  const d = Math.hypot(cx, cz);
  const ux = cx / d;
  const uz = cz / d;
  const r0 = PLAZA_RADIUS - 4;
  const r1 = d - 5;
  return {
    points: [
      { x: ux * r0, z: uz * r0 },
      { x: ux * r1, z: uz * r1 },
    ],
    width: SPOKE_WIDTH,
  };
}

/** Meandering footpath through the given control points (sampled every ~4 m). */
function meander(rng: Rng, ctrl: V2[], amp: number, width: number): Road {
  const points: V2[] = [{ x: ctrl[0].x, z: ctrl[0].z }];
  for (let k = 0; k + 1 < ctrl.length; k++) {
    const a = ctrl[k];
    const b = ctrl[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(len / 4));
    const px = -(b.z - a.z) / len;
    const pz = (b.x - a.x) / len;
    const f1 = rng.range(0.8, 1.6);
    const ph = rng.range(0, TAU);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Taper to zero at control points so legs join smoothly.
      const off = i === n ? 0 : amp * Math.sin(Math.PI * t) * Math.sin(TAU * f1 * t + ph);
      points.push({ x: a.x + (b.x - a.x) * t + px * off, z: a.z + (b.z - a.z) * t + pz * off });
    }
  }
  return { points, width };
}

// ── Rotation (C4) ─────────────────────────────────────────────────────────────

/** Rotate (x, z) by k quarter turns: R(x, z) = (z, -x) maps camp 0 → 1 → 2 → 3. */
function rot(x: number, z: number, k: number, out: V2): V2 {
  switch (k & 3) {
    case 0:
      out.x = x;
      out.z = z;
      break;
    case 1:
      out.x = z;
      out.z = -x;
      break;
    case 2:
      out.x = -x;
      out.z = -z;
      break;
    default:
      out.x = -z;
      out.z = x;
  }
  return out;
}

function wrapYaw(a: number): number {
  let y = a % TAU;
  if (y > Math.PI) y -= TAU;
  if (y <= -Math.PI) y += TAU;
  return y;
}

function rotateDraft(d: Draft, k: number, dx: number, dz: number, group: number, color: number): Draft {
  const p = rot(d.x, d.z, k, { x: 0, z: 0 });
  // R turns the local +z axis (sin y, cos y) into (cos y, -sin y) = (sin(y + π/2), cos(y + π/2)).
  const yaw = wrapYaw(d.yaw + (k * Math.PI) / 2);
  return d.shape === 'circle'
    ? circleDraft(d.kind, p.x + dx, p.z + dz, d.radius, d.height, color, d.variant, group, yaw)
    : boxDraft(d.kind, p.x + dx, p.z + dz, d.hx, d.hz, yaw, d.height, color, d.variant, group);
}

// ── Camp zone (camp 0's, copied to every camp) ───────────────────────────────

interface Quadrant {
  drafts: Draft[];
  piles: V2[];
  dirt: Disk[];
}

/**
 * Camp 0's zone. Everything stays outside the conquest corridor (CAMP_CLEAR_RADIUS): the
 * camp's own shade and tents in the corner behind it, groves and the tree line along both
 * nearby edges, and a ring of theme camps, art and a porta row around the corridor's rim.
 */
function generateQuadrant(rng: Rng, ring: Road): Quadrant {
  const c = CAMP_CENTERS[0];
  const base = Math.atan2(-c.z, -c.x); // toward the map centre
  // Camp-local polar: phi = 0 toward the centre, ±π/2 along the flanks, π the corner.
  const at = (rho: number, phi: number): V2 => ({
    x: c.x + rho * Math.cos(base + phi),
    z: c.z + rho * Math.sin(base + phi),
  });
  const p = new Placer(2 * JITTER + 0.2, ROAD_GAP + JITTER);
  p.zone = { x: c.x, z: c.z, r: FAIR_RADIUS };
  p.zoneMargin = JITTER + 0.2;
  // Rim of the corridor: footprints (and their jittered copies) start beyond it.
  const rim = CAMP_CLEAR_RADIUS + OBSTACLE_PAD + JITTER + 0.3;
  p.keepOut.push(keepOutDisk(c.x, c.z, rim));
  p.addRoad(spokeRoad(c.x, c.z));
  p.addRoad(ring);
  const dirt: Disk[] = [];
  const toward = { x: Math.cos(base), z: Math.sin(base) };
  // Signs of camp 0's corner: its two nearby map edges are x = sx·MAP_HALF and z = sz·MAP_HALF.
  const sx = Math.sign(c.x);
  const sz = Math.sign(c.z);

  // The camp's own shade and 2-4 tents in the corner behind it, doors facing the shade.
  const clutter = p.nextGroup++;
  const shade = p.place(60, 1.5, () => {
    const q = at(rng.range(rim + 5, rim + 11), Math.PI + rng.range(-0.3, 0.3));
    return boxDraft(
      'shade',
      q.x,
      q.z,
      rng.range(3, 4),
      rng.range(2.2, 3),
      yawTo(q.x, q.z, c.x, c.z),
      rng.range(3, 3.5),
      rng.pick(TARP_COLORS),
      0,
      clutter,
    );
  });
  if (shade) {
    // Fanned around the shade's far side: the near side is the corridor.
    const away = Math.atan2(shade.z - c.z, shade.x - c.x);
    const tents = rng.int(2, 4);
    for (let i = 0; i < tents; i++) {
      p.place(40, 1.4, () => {
        const a = away + ((i + 0.5) / tents - 0.5) * 2.8 + rng.range(-0.25, 0.25);
        const d = rng.range(7, 9.5);
        return tentDraft(rng, shade.x + Math.cos(a) * d, shade.z + Math.sin(a) * d, clutter, shade.x, shade.z);
      });
    }
    dirt.push({ x: shade.x, z: shade.z, r: 10 });
  }

  // Parked cars nose-in along one of the two nearby map edges, clear of the corridor.
  for (let t = 0; t < 60; t++) {
    const topEdge = rng.chance(0.5);
    const bd = rng.range(4, 7);
    const along = (rng.chance(0.5) ? 1 : -1) * rng.range(20, 55);
    const placed = topEdge
      ? placeCarRow(p, rng, c.x + along, sz * (MAP_HALF - bd), 0, sz, 1, 0)
      : placeCarRow(p, rng, sx * (MAP_HALF - bd), c.z + along, sx, 0, 0, 1);
    if (placed) break;
  }

  // Porta-potty row on the corridor rim beside the spoke, running across it, doors toward
  // the ring road.
  for (let t = 0; t < 40; t++) {
    const side = rng.chance(0.5) ? 1 : -1;
    const nx = -toward.z * side;
    const nz = toward.x * side;
    const off = SPOKE_WIDTH / 2 + ROAD_GAP + JITTER + 1 + rng.range(0, 3);
    const rho = rng.range(rim + 1.5, rim + 6);
    if (placePortaRow(p, rng, c.x + toward.x * rho + nx * off, c.z + toward.z * rho + nz * off, nx, nz, toward.x, toward.z)) {
      break;
    }
  }

  // A theme camp on one flank, a geodesic dome on the other.
  const side = rng.chance(0.5) ? 1 : -1;
  for (let t = 0; t < 60; t++) {
    const q = at(rng.range(rim + 6, rim + 13), side * rng.range(1.1, 2.0));
    if (placeTentCluster(p, rng, q.x, q.z, rng.int(4, 7), dirt)) break;
  }
  const dome = p.place(60, 3, () => {
    const q = at(rng.range(rim + 5, rim + 15), -side * rng.range(0.9, 2.1));
    return domeDraft(rng, q.x, q.z, p.nextGroup++, 4, 5.5);
  });
  if (dome) dirt.push({ x: dome.x, z: dome.z, r: dome.radius + 2.5 });

  // Art on the approach toward the plaza, boulders anywhere around the rim.
  const art = rng.int(1, 2);
  for (let i = 0; i < art; i++) {
    p.place(40, 4, () => {
      const q = at(rng.range(rim + 2, rim + 10), rng.range(-0.9, 0.9));
      return artDraft(rng, q.x, q.z, p.nextGroup++, 3.2);
    });
  }
  const rocks = rng.int(1, 3);
  for (let i = 0; i < rocks; i++) {
    p.place(20, 2, () => {
      const q = at(rng.range(rim + 1, rim + 20), rng.range(-Math.PI, Math.PI));
      return rockDraft(rng, q.x, q.z, p.nextGroup++);
    });
  }
  // Little tent camps around the flanks (cover and route variety).
  const tentCamps = rng.int(2, 3);
  for (let i = 0; i < tentCamps; i++) {
    const q = at(rng.range(rim + 4, rim + 16), (rng.chance(0.5) ? 1 : -1) * rng.range(0.7, 2.4));
    placeTentCamp(p, rng, q.x, q.z);
  }

  // Groves in the corner pocket and along both nearby edges, then the tree line itself.
  const groves = rng.int(2, 3);
  for (let i = 0; i < groves; i++) {
    for (let t = 0; t < 40; t++) {
      const g = at(rng.range(rim + 8, rim + 30), Math.PI + rng.range(-1.3, 1.3));
      if (MAP_HALF - Math.max(Math.abs(g.x), Math.abs(g.z)) > 20) continue;
      if (placeGrove(p, rng, g.x, g.z, rng.range(6, 10), rng.int(5, 9)) >= 3) break;
    }
  }
  placeForestEdge(p, rng, sx * (MAP_HALF - 3), sz * MAP_HALF, sx * 30, sz * MAP_HALF, 0, -sz);
  placeForestEdge(p, rng, sx * MAP_HALF, sz * (MAP_HALF - 3), sx * MAP_HALF, sz * 30, -sx, 0);

  // Lumber pile spots: two at home, two along the spoke, two anywhere in the zone.
  const piles: V2[] = [];
  const pileAt = (make: () => V2): void => {
    for (let t = 0; t < 60; t++) {
      const q = make();
      const lim = MAP_HALF - BORDER_MARGIN - 2;
      if (Math.abs(q.x) > lim || Math.abs(q.z) > lim) continue;
      if (Math.hypot(q.x - c.x, q.z - c.z) < PILE_CAMP_MIN_DIST + 1) continue;
      if (p.clearance(q.x, q.z) < PILE_CLEARANCE + 2 * JITTER) continue;
      if (piles.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 8)) continue;
      piles.push(q);
      return;
    }
  };
  const homeSide = rng.chance(0.5) ? 1 : -1;
  pileAt(() => at(rng.range(14, 22), homeSide * rng.range(0.9, 2.4)));
  pileAt(() => at(rng.range(14, 22), -homeSide * rng.range(0.9, 2.4)));
  for (const s of [1, -1]) {
    pileAt(() => {
      const rho = rng.range(32, 56);
      const off = s * rng.range(4.5, 7);
      return { x: c.x + toward.x * rho - toward.z * off, z: c.z + toward.z * rho + toward.x * off };
    });
  }
  pileAt(() => at(rng.range(30, 64), rng.range(-Math.PI, Math.PI)));
  pileAt(() => at(rng.range(30, 64), rng.range(-Math.PI, Math.PI)));

  return { drafts: p.drafts, piles, dirt };
}

// ── Spatial index ─────────────────────────────────────────────────────────────

/** Compressed per-cell item lists (items keep insertion order inside a cell). */
interface CellIndex {
  dim: number;
  start: Int32Array;
  items: Int32Array;
}

function buildCellIndex(minX: Float64Array, minZ: Float64Array, maxX: Float64Array, maxZ: Float64Array): CellIndex {
  const dim = Math.ceil((2 * MAP_HALF) / INDEX_CELL);
  const n = minX.length;
  const cellOf = (v: number): number => Math.min(dim - 1, Math.max(0, Math.floor((v + MAP_HALF) / INDEX_CELL)));
  const start = new Int32Array(dim * dim + 1);
  for (let i = 0; i < n; i++) {
    for (let cz = cellOf(minZ[i]); cz <= cellOf(maxZ[i]); cz++) {
      for (let cx = cellOf(minX[i]); cx <= cellOf(maxX[i]); cx++) start[cz * dim + cx + 1]++;
    }
  }
  for (let c = 0; c < dim * dim; c++) start[c + 1] += start[c];
  const fill = start.slice(0, dim * dim);
  const items = new Int32Array(start[dim * dim]);
  for (let i = 0; i < n; i++) {
    for (let cz = cellOf(minZ[i]); cz <= cellOf(maxZ[i]); cz++) {
      for (let cx = cellOf(minX[i]); cx <= cellOf(maxX[i]); cx++) items[fill[cz * dim + cx]++] = i;
    }
  }
  return { dim, start, items };
}

function cellAt(index: CellIndex, x: number, z: number): number {
  const cx = Math.min(index.dim - 1, Math.max(0, Math.floor((x + MAP_HALF) / INDEX_CELL)));
  const cz = Math.min(index.dim - 1, Math.max(0, Math.floor((z + MAP_HALF) / INDEX_CELL)));
  return cz * index.dim + cx;
}

function hash2(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]: organic edges for dirt, mud and road verges. */
function wobble(x: number, z: number, salt: number): number {
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const tx = x - fx;
  const tz = z - fz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(fx, fz, salt);
  const b = hash2(fx + 1, fz, salt);
  const c = hash2(fx, fz + 1, salt);
  const d = hash2(fx + 1, fz + 1, salt);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

const G_WATER = 0;
const G_MUD = 1;
const G_ROAD = 2;
const G_DIRT = 3;
const MUD_WOBBLE = 0.2; // relative ellipse radius
const ROAD_WOBBLE = 0.35; // m
const DIRT_WOBBLE = 2.2; // m

function makeIsBlockedAt(obstacles: Obstacle[], water: Water[]): (x: number, z: number) => boolean {
  const n = obstacles.length;
  const total = n + water.length;
  const ox = new Float64Array(n);
  const oz = new Float64Array(n);
  const orad = new Float64Array(n);
  const ohx = new Float64Array(n);
  const ohz = new Float64Array(n);
  const ocos = new Float64Array(n);
  const osin = new Float64Array(n);
  const obox = new Uint8Array(n);
  const minX = new Float64Array(total);
  const minZ = new Float64Array(total);
  const maxX = new Float64Array(total);
  const maxZ = new Float64Array(total);
  for (let i = 0; i < n; i++) {
    const o = obstacles[i];
    ox[i] = o.x;
    oz[i] = o.z;
    orad[i] = o.radius;
    ohx[i] = o.hx;
    ohz[i] = o.hz;
    ocos[i] = Math.cos(o.yaw);
    osin[i] = Math.sin(o.yaw);
    obox[i] = o.shape === 'box' ? 1 : 0;
    const ex = (o.shape === 'box' ? Math.abs(ocos[i]) * o.hx + Math.abs(osin[i]) * o.hz : o.radius) + OBSTACLE_PAD;
    const ez = (o.shape === 'box' ? Math.abs(osin[i]) * o.hx + Math.abs(ocos[i]) * o.hz : o.radius) + OBSTACLE_PAD;
    minX[i] = o.x - ex;
    maxX[i] = o.x + ex;
    minZ[i] = o.z - ez;
    maxZ[i] = o.z + ez;
  }
  for (let j = 0; j < water.length; j++) {
    const w = water[j];
    minX[n + j] = w.x - w.rx;
    maxX[n + j] = w.x + w.rx;
    minZ[n + j] = w.z - w.rz;
    maxZ[n + j] = w.z + w.rz;
  }
  const index = buildCellIndex(minX, minZ, maxX, maxZ);
  const pad2 = OBSTACLE_PAD * OBSTACLE_PAD;
  return (x: number, z: number): boolean => {
    if (x < -MAP_HALF || x > MAP_HALF || z < -MAP_HALF || z > MAP_HALF) return true;
    const cell = cellAt(index, x, z);
    for (let k = index.start[cell]; k < index.start[cell + 1]; k++) {
      const i = index.items[k];
      if (x < minX[i] || x > maxX[i] || z < minZ[i] || z > maxZ[i]) continue;
      if (i >= n) {
        const w = water[i - n];
        const ux = (x - w.x) / w.rx;
        const uz = (z - w.z) / w.rz;
        if (ux * ux + uz * uz <= 1) return true;
        continue;
      }
      const dx = x - ox[i];
      const dz = z - oz[i];
      if (obox[i] === 0) {
        const r = orad[i] + OBSTACLE_PAD;
        if (dx * dx + dz * dz <= r * r) return true;
      } else {
        const ex = Math.max(0, Math.abs(dx * ocos[i] - dz * osin[i]) - ohx[i]);
        const ez = Math.max(0, Math.abs(dx * osin[i] + dz * ocos[i]) - ohz[i]);
        if (ex * ex + ez * ez <= pad2) return true;
      }
    }
    return false;
  };
}

function makeGroundAt(water: Water[], mud: MudPatch[], roads: Road[], dirt: Disk[], salt: number): (x: number, z: number) => GroundType {
  // Items in priority order (water > mud > road > dirt); each cell keeps that order.
  const type: number[] = [];
  const geo: number[] = [];
  const bounds: number[] = [];
  const push = (t: number, a: number, b: number, c: number, d: number, e: number, x0: number, z0: number, x1: number, z1: number): void => {
    type.push(t);
    geo.push(a, b, c, d, e);
    bounds.push(x0, z0, x1, z1);
  };
  for (const w of water) push(G_WATER, w.x, w.z, w.rx, w.rz, 0, w.x - w.rx, w.z - w.rz, w.x + w.rx, w.z + w.rz);
  for (const m of mud) {
    const ex = m.rx * (1 + MUD_WOBBLE);
    const ez = m.rz * (1 + MUD_WOBBLE);
    push(G_MUD, m.x, m.z, m.rx, m.rz, 0, m.x - ex, m.z - ez, m.x + ex, m.z + ez);
  }
  for (const r of roads) {
    const hw = r.width / 2;
    const e = hw + ROAD_WOBBLE;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      push(G_ROAD, a.x, a.z, b.x, b.z, hw, Math.min(a.x, b.x) - e, Math.min(a.z, b.z) - e, Math.max(a.x, b.x) + e, Math.max(a.z, b.z) + e);
    }
  }
  for (const d of dirt) {
    const e = d.r + DIRT_WOBBLE;
    push(G_DIRT, d.x, d.z, d.r, 0, 0, d.x - e, d.z - e, d.x + e, d.z + e);
  }
  const n = type.length;
  const minX = new Float64Array(n);
  const minZ = new Float64Array(n);
  const maxX = new Float64Array(n);
  const maxZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    minX[i] = bounds[4 * i];
    minZ[i] = bounds[4 * i + 1];
    maxX[i] = bounds[4 * i + 2];
    maxZ[i] = bounds[4 * i + 3];
  }
  const index = buildCellIndex(minX, minZ, maxX, maxZ);
  const types = Uint8Array.from(type);
  const g = Float64Array.from(geo);
  return (x: number, z: number): GroundType => {
    const cell = cellAt(index, x, z);
    const end = index.start[cell + 1];
    if (index.start[cell] === end) return 'grass';
    const w = wobble(x * 0.12, z * 0.12, salt);
    for (let k = index.start[cell]; k < end; k++) {
      const i = index.items[k];
      if (x < minX[i] || x > maxX[i] || z < minZ[i] || z > maxZ[i]) continue;
      const o = 5 * i;
      switch (types[i]) {
        case G_WATER: {
          const ux = (x - g[o]) / g[o + 2];
          const uz = (z - g[o + 1]) / g[o + 3];
          if (ux * ux + uz * uz <= 1) return 'water';
          break;
        }
        case G_MUD: {
          const ux = (x - g[o]) / g[o + 2];
          const uz = (z - g[o + 1]) / g[o + 3];
          const lim = 1 + MUD_WOBBLE * w;
          if (ux * ux + uz * uz <= lim * lim) return 'mud';
          break;
        }
        case G_ROAD:
          if (distToSegment(x, z, g[o], g[o + 1], g[o + 2], g[o + 3]) <= g[o + 4] + ROAD_WOBBLE * w) return 'road';
          break;
        default: {
          const dx = x - g[o];
          const dz = z - g[o + 1];
          const r = g[o + 2] + DIRT_WOBBLE * w;
          if (dx * dx + dz * dz <= r * r) return 'dirt';
        }
      }
    }
    return 'grass';
  };
}

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * Generate the burn. Guarantees: four corner camps at CAMP_CENTERS whose conquest corridor
 * (CAMP_CLEAR_RADIUS) blocks no node, so every Hearth can be enclosed from outside its home
 * ring; C4-symmetric camp zones; the effigy at the centre with a clear plaza; contested
 * neutral space; roads linking every camp to the centre (obstacles never cover a road, so no
 * camp is sealed); scattered obstacles that make routes matter.
 */
export function generateMap(seed: string): MapLayout {
  const rng = new Rng(`burn:${seed}`);
  const camps = FACTION_IDS.map((faction) => ({ faction, x: CAMP_CENTERS[faction].x, z: CAMP_CENTERS[faction].z }));
  const ring = ringRoad(rng);
  const roads: Road[] = [ring];
  for (const c of camps) roads.push(spokeRoad(c.x, c.z));
  const dirt: Disk[] = [{ x: 0, z: 0, r: PLAZA_RADIUS + 3 }];
  for (const c of camps) dirt.push({ x: c.x, z: c.z, r: CAMP_GROUND_RADIUS });

  const p = new Placer(0, ROAD_GAP);
  for (const r of roads) p.addRoad(r);
  p.drafts.push(circleDraft('effigy', 0, 0, EFFIGY_RADIUS, EFFIGY_HEIGHT, FLAG_YELLOW, 0, p.nextGroup++));
  p.keepOut.push(keepOutDisk(0, 0, PLAZA_RADIUS + OBSTACLE_PAD));
  for (const c of camps) p.keepOut.push(keepOutDisk(c.x, c.z, CAMP_CLEAR_RADIUS + OBSTACLE_PAD));

  // Camp zone copies: identical up to a small rigid jitter per group.
  const quad = generateQuadrant(rng.fork('quadrant'), ring);
  const jit = rng.fork('jitter');
  const pileSpots: V2[] = [];
  const tmp = { x: 0, z: 0 };
  for (let k = 0; k < 4; k++) {
    const groups = new Map<number, { group: number; dx: number; dz: number }>();
    for (const d of quad.drafts) {
      let g = groups.get(d.group);
      if (!g) {
        g = { group: p.nextGroup++, dx: jit.range(-JITTER, JITTER), dz: jit.range(-JITTER, JITTER) };
        groups.set(d.group, g);
      }
      const color =
        d.kind === 'tent' ? jit.pick(TENT_COLORS) : d.kind === 'car' ? jit.pick(CAR_COLORS) : d.color;
      p.drafts.push(rotateDraft(d, k, g.dx, g.dz, g.group, color));
    }
    for (const s of quad.piles) {
      rot(s.x, s.z, k, tmp);
      pileSpots.push({ x: tmp.x + jit.range(-0.4, 0.4), z: tmp.z + jit.range(-0.4, 0.4) });
    }
    for (const d of quad.dirt) {
      rot(d.x, d.z, k, tmp);
      dirt.push({ x: tmp.x, z: tmp.z, r: d.r });
    }
  }
  for (const c of camps) p.outside.push({ x: c.x, z: c.z, r: FAIR_RADIUS });

  // Middle band, arm k between camp k and camp k+1 (the +z arm rotated k quarter turns).
  const arms: { ax: number; az: number; tx: number; tz: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const a = rot(0, 1, k, { x: 0, z: 0 });
    arms.push({ ax: a.x, az: a.z, tx: a.z, tz: -a.x });
  }
  const armAt = (k: number, radial: number, tangential: number): V2 => ({
    x: arms[k].ax * radial + arms[k].tx * tangential,
    z: arms[k].az * radial + arms[k].tz * tangential,
  });

  // Sound camps: a stage behind an open dance floor facing the effigy.
  const names = rng.shuffle([...SOUND_CAMP_NAMES]);
  const colors = rng.shuffle([...SOUND_COLORS]);
  const soundCamps: SoundCamp[] = [];
  const neutralSpawns: V2[] = [];
  for (let k = 0; k < 4; k++) {
    const { ax, az, tx, tz } = arms[k];
    const s = armAt(k, rng.range(97, 104), rng.range(-5, 5));
    const hx = rng.range(5, 6.5);
    const hz = rng.range(3, 3.8);
    const stage = boxDraft(
      'stage',
      s.x + ax * (10 + hz),
      s.z + az * (10 + hz),
      hx,
      hz,
      Math.atan2(-ax, -az),
      rng.range(5.5, 7),
      colors[k],
      0,
      p.nextGroup++,
    );
    p.drafts.push(stage);
    p.keepOut.push(keepOutDisk(s.x, s.z, DANCE_FLOOR));
    soundCamps.push({ name: names[k], x: s.x, z: s.z, radius: SOUND_CAMP_RADIUS, color: colors[k] });
    neutralSpawns.push({ x: s.x + tx * 4, z: s.z + tz * 4 }, { x: s.x - tx * 4, z: s.z - tz * 4 });
    dirt.push({ x: s.x, z: s.z, r: SOUND_CAMP_RADIUS });
  }
  // Interleave so a round-robin over spawns visits every sound camp before repeating.
  const spawnOrder: V2[] = [];
  for (let i = 0; i < 2; i++) for (let k = 0; k < 4; k++) spawnOrder.push(neutralSpawns[2 * k + i]);

  // The pond on the inner playa between two spokes, with mud on its shore.
  const pk = rng.int(0, 3);
  const pa = Math.atan2(arms[pk].az, arms[pk].ax) + rng.range(-0.2, 0.2);
  const pr = rng.range(34, 40);
  const big = rng.range(8, 12);
  const small = rng.range(6, 8.5);
  const wide = rng.chance(0.5);
  const pond: Water = { x: Math.cos(pa) * pr, z: Math.sin(pa) * pr, rx: wide ? big : small, rz: wide ? small : big };
  const water = [pond];
  p.keepOut.push(keepOutDisk(pond.x, pond.z, Math.max(pond.rx, pond.rz) + 2));
  const mud: MudPatch[] = [];
  const mudCount = rng.int(2, 4);
  const mudPhase = rng.range(0, TAU);
  for (let i = 0; i < mudCount; i++) {
    const a = mudPhase + (i / mudCount) * TAU + rng.range(-0.4, 0.4);
    const m = {
      x: pond.x + Math.cos(a) * pond.rx * 0.95,
      z: pond.z + Math.sin(a) * pond.rz * 0.95,
      rx: rng.range(2.5, 5),
      rz: rng.range(2.5, 5),
    };
    mud.push(m);
    p.keepOut.push(keepOutDisk(m.x, m.z, Math.max(m.rx, m.rz)));
  }

  // Footpaths: from the ring road to every sound camp, and one past the pond.
  for (let k = 0; k < 4; k++) {
    const sc = soundCamps[k];
    const from = armAt(k, RING_ROAD_RADIUS + RING_WIDTH / 2, rng.range(-4, 4));
    const path = meander(rng, [from, { x: sc.x, z: sc.z }], rng.range(2.5, 4.5), PATH_WIDTH);
    roads.push(path);
    p.addRoad(path);
  }
  {
    const side = rng.chance(0.5) ? 1 : -1;
    const tx = -Math.sin(pa) * side;
    const tz = Math.cos(pa) * side;
    const reach = Math.max(pond.rx, pond.rz) + 5;
    const mid = { x: pond.x + tx * reach, z: pond.z + tz * reach };
    const ml = Math.hypot(mid.x, mid.z);
    const from = { x: (mid.x / ml) * (PLAZA_RADIUS + 1), z: (mid.z / ml) * (PLAZA_RADIUS + 1) };
    const to = { x: (mid.x / ml) * (RING_ROAD_RADIUS - 2), z: (mid.z / ml) * (RING_ROAD_RADIUS - 2) };
    const path = meander(rng, [from, mid, to], 2, PATH_WIDTH);
    // Keep the path on dry land: push any point inside the pond (+1.5 m) back out to the shore.
    for (const q of path.points) {
      const ux = (q.x - pond.x) / (pond.rx + 1.5);
      const uz = (q.z - pond.z) / (pond.rz + 1.5);
      const e = Math.hypot(ux, uz);
      if (e < 1 && e > 0) {
        q.x = pond.x + (ux / e) * (pond.rx + 1.5);
        q.z = pond.z + (uz / e) * (pond.rz + 1.5);
      }
    }
    roads.push(path);
    p.addRoad(path);
  }

  // Per-arm theme camps: same recipe, independent dice.
  for (let k = 0; k < 4; k++) {
    const { ax, az, tx, tz } = arms[k];
    const sc = soundCamps[k];
    const scRadial = sc.x * ax + sc.z * az;
    const scTan = sc.x * tx + sc.z * tz;
    const side = rng.chance(0.5) ? 1 : -1;
    // Crew tents behind and beside the stage.
    const crew = p.nextGroup++;
    const crewTents = rng.int(2, 4);
    for (let i = 0; i < crewTents; i++) {
      p.place(30, 1.4, () => {
        const q = armAt(k, scRadial + rng.range(16, 28), scTan + rng.range(-20, 20));
        return tentDraft(rng, q.x, q.z, crew, sc.x, sc.z);
      });
    }
    const dome = p.place(40, 3, () => {
      const q = armAt(k, rng.range(74, 90), side * rng.range(10, 22));
      return domeDraft(rng, q.x, q.z, p.nextGroup++, 4.5, 6);
    });
    if (dome) dirt.push({ x: dome.x, z: dome.z, r: dome.radius + 2.5 });
    for (let t = 0; t < 40; t++) {
      const q = armAt(k, rng.range(72, 90), -side * rng.range(10, 22));
      if (placeTentCluster(p, rng, q.x, q.z, rng.int(3, 5), dirt)) break;
    }
    for (let t = 0; t < 40; t++) {
      const s2 = rng.chance(0.5) ? 1 : -1;
      const q = armAt(k, scRadial + rng.range(-6, 2), scTan + s2 * rng.range(17, 22));
      // Row runs radially, doors face the dance floor.
      if (placePortaRow(p, rng, q.x, q.z, ax, az, -tx * s2, -tz * s2)) break;
    }
    p.place(40, 4, () => {
      const q = armAt(k, rng.range(66, 80), rng.range(-14, 14));
      return artDraft(rng, q.x, q.z, p.nextGroup++, 4);
    });
    const groves = rng.int(1, 2);
    for (let i = 0; i < groves; i++) {
      for (let t = 0; t < 30; t++) {
        const q = armAt(k, rng.range(132, 141), rng.range(-42, 42));
        if (placeGrove(p, rng, q.x, q.z, rng.range(6, 10), rng.int(4, 8)) >= 2) break;
      }
    }
    const camp = armAt(k, rng.range(110, 128), scTan + (rng.chance(0.5) ? 1 : -1) * rng.range(22, 34));
    placeTentCamp(p, rng, camp.x, camp.z);
    // Tree line along this arm's stretch of the map edge (camp fairness disks clip it).
    const e0 = armAt(k, MAP_HALF, -60);
    const e1 = armAt(k, MAP_HALF, 60);
    placeForestEdge(p, rng, e0.x, e0.z, e1.x, e1.z, -ax, -az);
  }

  // Art on the inner playa: two pieces per sector, kept apart so the playa stays open.
  for (let k = 0; k < 4; k++) {
    const a0 = Math.atan2(arms[k].az, arms[k].ax);
    for (let i = 0; i < 2; i++) {
      p.place(40, 6, () => {
        const a = a0 + rng.range(-0.65, 0.65);
        const r = rng.range(22, 55);
        return artDraft(rng, Math.cos(a) * r, Math.sin(a) * r, p.nextGroup++, 4);
      });
    }
  }

  // Middle-band lumber: one canonical set of spots per arm, nudged off obstacles.
  const perArm = Math.max(0, Math.round(PILE_COUNT / 4) - quad.piles.length);
  const canon: { r: number; d: number }[] = [];
  const canonRanges: [number, number, number][] = [
    [18, 26, 0.6],
    [52, 56, 0.7],
    [68, 72, 0.5],
    [30, 48, 0.7],
    [76, 86, 0.3],
  ];
  for (let i = 0; i < perArm; i++) {
    const [r0, r1, spread] = canonRanges[i % canonRanges.length];
    canon.push({ r: rng.range(r0, r1), d: rng.range(-spread, spread) });
  }
  const freeSpot = (x: number, z: number): boolean => {
    const lim = MAP_HALF - BORDER_MARGIN - 2;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    for (const c of camps) if (Math.hypot(x - c.x, z - c.z) < PILE_CAMP_MIN_DIST + 1) return false;
    const ux = (x - pond.x) / (pond.rx + 2);
    const uz = (z - pond.z) / (pond.rz + 2);
    if (ux * ux + uz * uz <= 1) return false;
    if (pileSpots.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) return false;
    return p.clearance(x, z) >= PILE_CLEARANCE;
  };
  for (let k = 0; k < 4; k++) {
    const a0 = Math.atan2(arms[k].az, arms[k].ax);
    for (const s of canon) {
      const x0 = Math.cos(a0 + s.d) * s.r;
      const z0 = Math.sin(a0 + s.d) * s.r;
      // Spiral outward until a free spot turns up (fixed probe order keeps it deterministic).
      for (let probe = 0; probe < 64; probe++) {
        const rr = probe === 0 ? 0 : 1 + probe * 0.12;
        const aa = probe * 2.39996;
        const x = x0 + Math.cos(aa) * rr;
        const z = z0 + Math.sin(aa) * rr;
        if (freeSpot(x, z)) {
          pileSpots.push({ x, z });
          break;
        }
      }
    }
  }

  const obstacles: Obstacle[] = p.drafts.map((d, id) => ({
    id,
    kind: d.kind,
    x: d.x,
    z: d.z,
    shape: d.shape,
    radius: d.radius,
    hx: d.hx,
    hz: d.hz,
    yaw: d.yaw,
    height: d.height,
    seed: Math.floor(rng.next() * 0x7fffffff),
    color: d.color,
    variant: d.variant,
  }));
  const salt = Math.floor(rng.next() * 0x7fffffff);

  return {
    seed,
    half: MAP_HALF,
    camps,
    obstacles,
    roads,
    water,
    mud,
    soundCamps,
    pileSpots,
    neutralSpawns: spawnOrder,
    effigy: { x: 0, z: 0 },
    isBlockedAt: makeIsBlockedAt(obstacles, water),
    groundAt: makeGroundAt(water, mud, roads, dirt, salt),
  };
}
