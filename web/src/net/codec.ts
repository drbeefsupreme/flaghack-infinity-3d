/**
 * Host-side snapshot encoding: full snapshots for (re)joining clients and per-frame deltas
 * shared by every client. Positions/angles are quantized; only fields clients read replicate
 * (see net/schema.ts); server-only scratch (hippie brains, system scratch) never leaves the host.
 * Lattice topology replicates as the ordered list of flipped node ids (clients regenerate the
 * lattice from the seed and replay flips).
 *
 * The encoder keeps a shadow of exactly what clients hold (the wire rows of every entity,
 * faction and world scalar, the quantized survey arrays and the flip log as of the last
 * delta). A delta is the difference between the world and that shadow; full() serializes the
 * shadow itself, so a client starting from it and applying the next delta lands exactly on
 * the world, whenever full() was called.
 * Owner: NetCore agent.
 */
import type { GameEvent } from '../sim/events';
import type { EntityId } from '../sim/types';
import type { World } from '../sim/world';
import { CODECS, diffRow, encodeRow, ENTITY_KINDS, FACTION_FIELDS, perKind, SURVEY_ARRAYS, WORLD_FIELDS } from './schema';
import type { EntityKind, SurveyArrayKey, SurveyArraySpec, Wire } from './schema';

/** Rows of one entity kind: [id, …every field in schema order]. */
export type EntityRows = Wire[][];

/** Changes of one entity kind since the previous delta. */
export interface EntityDelta {
  /** Added entities: [id, …every field]. */
  a?: Wire[][];
  /** Updated entities, flat: id, field mask, then the changed values in field order; repeat. */
  u?: Wire[];
  /** Removed ids. */
  r?: number[];
}

export interface SurveySnapshot {
  version: number;
  sizes: number[];
  focus: number[];
  /** Per array: flat [index, value, …] for every entry that differs from the array's fill value. */
  arr: Partial<Record<SurveyArrayKey, number[]>>;
}

export interface SurveyDelta {
  version: number;
  sizes?: number[];
  focus?: number[];
  /** Changed arrays: [0, index, value, …] (sparse) or [1, value, …] (the whole array). */
  arr?: Partial<Record<SurveyArrayKey, number[]>>;
}

/** Everything a client needs on top of createMatch(options) to reach the host's state. */
export interface FullSnapshot {
  tick: number;
  time: number;
  /** Every applied phason flip since generation, in order (node ids). */
  flips: number[];
  ents: Record<EntityKind, EntityRows>;
  /** One row per faction (index = faction id). */
  fac: Wire[][];
  /** World scalar row. */
  w: Wire[];
  survey: SurveySnapshot;
}

/** Changes since the previous delta (incremental: transport is reliable and ordered). */
export interface DeltaSnapshot {
  tick: number;
  time: number;
  /** Phason flips applied since the previous delta, in order (also announced by phasonFlip events). */
  flips?: number[];
  ents?: Partial<Record<EntityKind, EntityDelta>>;
  /** Faction changes, flat: faction id, field mask, then the changed values; repeat. */
  fac?: Wire[];
  /** World scalar changes: [field mask, …changed values]. */
  w?: Wire[];
  survey?: SurveyDelta;
}

/** Above this share of changed entries an array travels whole instead of as index/value pairs. */
const WHOLE_ARRAY_SHARE = 0.3;

function quantizeInto(spec: SurveyArraySpec, src: ArrayLike<number>, out: Int32Array): void {
  if (spec.scale === 1) for (let i = 0; i < src.length; i++) out[i] = src[i];
  else for (let i = 0; i < src.length; i++) out[i] = Math.round(src[i] * spec.scale);
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** One encoder per match on the host; full() never disturbs the delta baseline. */
export class SnapshotEncoder {
  private readonly world: World;
  private readonly ents = perKind(() => new Map<EntityId, Wire[]>());
  private readonly fac: Wire[][];
  private readonly scalars: Wire[];
  private readonly survey: Int32Array[];
  private surveyVersion: number;
  private readonly sizes: number[];
  private readonly focus: number[];
  private readonly flips: number[] = [];
  private tick: number;
  private time: number;
  /** Reused per-kind update buffer (copied out when non-empty). */
  private readonly upd: Wire[] = [];

  /** Create right after createMatch(): the flip log starts empty, so the lattice must be unflipped. */
  constructor(world: World) {
    if (world.lattice.version !== 0) throw new Error('SnapshotEncoder must be created before the first phason flip');
    this.world = world;
    for (const kind of ENTITY_KINDS) {
      const codec = CODECS[kind];
      const shadow = this.ents[kind];
      for (const id of codec.ids(world)) shadow.set(id, codec.row(world, id));
    }
    this.fac = world.factions.map((f) => encodeRow(FACTION_FIELDS, f, world));
    this.scalars = encodeRow(WORLD_FIELDS, world, world);
    const s = world.survey;
    this.survey = SURVEY_ARRAYS.map((spec) => {
      const src = spec.get(s);
      const out = new Int32Array(src.length);
      quantizeInto(spec, src, out);
      return out;
    });
    this.surveyVersion = s.version;
    this.sizes = s.surveySize.slice();
    this.focus = s.focusNodes.slice();
    this.tick = world.tick;
    this.time = world.time;
  }

  /** The state clients hold after the last delta (or the baseline before the first one). */
  full(): FullSnapshot {
    const ents = perKind((kind) => this.rowsOf(kind));
    const arr: Partial<Record<SurveyArrayKey, number[]>> = {};
    SURVEY_ARRAYS.forEach((spec, i) => {
      const sh = this.survey[i];
      const pairs: number[] = [];
      for (let k = 0; k < sh.length; k++) if (sh[k] !== spec.fill) pairs.push(k, sh[k]);
      arr[spec.key] = pairs;
    });
    return {
      tick: this.tick,
      time: this.time,
      flips: this.flips.slice(),
      ents,
      fac: this.fac.map((row) => row.slice()),
      w: this.scalars.slice(),
      survey: { version: this.surveyVersion, sizes: this.sizes.slice(), focus: this.focus.slice(), arr },
    };
  }

  /**
   * Changes since the previous call. `events`: every event drained since then, in order (the
   * flip log is taken from their phasonFlip events; a missed one would desync every lattice).
   */
  delta(events: readonly GameEvent[]): DeltaSnapshot {
    const w = this.world;
    const d: DeltaSnapshot = { tick: w.tick, time: w.time };

    let flips: number[] | undefined;
    for (const e of events) if (e.t === 'phasonFlip') (flips ??= []).push(e.node);
    if (flips) {
      for (const n of flips) this.flips.push(n);
      d.flips = flips;
    }
    if (this.flips.length !== w.lattice.version) {
      throw new Error(`phason flip log out of step: ${this.flips.length} logged, lattice at version ${w.lattice.version}`);
    }

    for (const kind of ENTITY_KINDS) {
      const ed = this.diffKind(kind);
      if (ed) (d.ents ??= {})[kind] = ed;
    }

    let fac: Wire[] | undefined;
    for (const f of w.factions) {
      const vals: Wire[] = [];
      const mask = diffRow(FACTION_FIELDS, f, w, this.fac[f.id], vals);
      if (mask !== 0) (fac ??= []).push(f.id, mask, ...vals);
    }
    if (fac) d.fac = fac;

    const vals: Wire[] = [];
    const mask = diffRow(WORLD_FIELDS, w, w, this.scalars, vals);
    if (mask !== 0) d.w = [mask, ...vals];

    const survey = this.diffSurvey();
    if (survey) d.survey = survey;

    this.tick = w.tick;
    this.time = w.time;
    return d;
  }

  private rowsOf(kind: EntityKind): EntityRows {
    const rows: EntityRows = [];
    for (const [id, row] of this.ents[kind]) rows.push([id, ...row]);
    return rows;
  }

  private diffKind(kind: EntityKind): EntityDelta | null {
    const w = this.world;
    const codec = CODECS[kind];
    const shadow = this.ents[kind];
    const u = this.upd;
    u.length = 0;
    let a: Wire[][] | undefined;
    let r: number[] | undefined;
    for (const id of codec.ids(w)) {
      const prev = shadow.get(id);
      if (!prev) {
        const row = codec.row(w, id);
        shadow.set(id, row);
        (a ??= []).push([id, ...row]);
        continue;
      }
      const at = u.length;
      u.push(id, 0);
      const mask = codec.diff(w, id, prev, u);
      if (mask === 0) u.length = at;
      else u[at + 1] = mask;
    }
    for (const id of shadow.keys()) {
      if (codec.has(w, id)) continue;
      shadow.delete(id);
      (r ??= []).push(id);
    }
    if (!a && !r && u.length === 0) return null;
    const ed: EntityDelta = {};
    if (a) ed.a = a;
    if (u.length > 0) ed.u = u.slice();
    if (r) ed.r = r;
    return ed;
  }

  private diffSurvey(): SurveyDelta | null {
    const s = this.world.survey;
    let arr: Partial<Record<SurveyArrayKey, number[]>> | undefined;
    SURVEY_ARRAYS.forEach((spec, i) => {
      const src = spec.get(s);
      const sh = this.survey[i];
      const scale = spec.scale;
      let changes = 0;
      for (let k = 0; k < src.length; k++) if ((scale === 1 ? src[k] : Math.round(src[k] * scale)) !== sh[k]) changes++;
      if (changes === 0) return;
      let out: number[];
      if (changes > src.length * WHOLE_ARRAY_SHARE) {
        quantizeInto(spec, src, sh);
        out = [1];
        for (let k = 0; k < sh.length; k++) out.push(sh[k]);
      } else {
        out = [0];
        for (let k = 0; k < src.length; k++) {
          const q = scale === 1 ? src[k] : Math.round(src[k] * scale);
          if (q === sh[k]) continue;
          sh[k] = q;
          out.push(k, q);
        }
      }
      (arr ??= {})[spec.key] = out;
    });
    const sizesChanged = !sameList(s.surveySize, this.sizes);
    const focusChanged = !sameList(s.focusNodes, this.focus);
    if (!arr && !sizesChanged && !focusChanged && s.version === this.surveyVersion) return null;
    const d: SurveyDelta = { version: s.version };
    this.surveyVersion = s.version;
    if (arr) d.arr = arr;
    if (sizesChanged) {
      for (let f = 0; f < this.sizes.length; f++) this.sizes[f] = s.surveySize[f];
      d.sizes = this.sizes.slice();
    }
    if (focusChanged) {
      this.focus.length = 0;
      for (const n of s.focusNodes) this.focus.push(n);
      d.focus = this.focus.slice();
    }
    return d;
  }
}
