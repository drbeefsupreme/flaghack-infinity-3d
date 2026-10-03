/**
 * Phason Tides and flip application. `applyFlip` is the ONLY way a lattice flip may happen
 * in a running match (abilities, tides, instability storms all route through it): it
 * respects Zeno observation rules, decoheres Flags on the moved node, shatters affected
 * Crystals, emits phasonFlip and marks the survey dirty.
 *
 * A tide is a wave: sampling keys are drawn in slices during the warning, and when the tide
 * breaks its chosen nodes turn as a front sweeps the burn over WAVE_DURATION, a pulse of
 * flips at a time. Every flip invalidates the lattice topology caches, so this keeps each
 * tick to one small batch (one topology rebuild, one survey recompute) instead of one spike.
 * Owner: SurveyRules agent.
 */
import { MAP_HALF, SIM_HZ, TIDE_FRACTION, TIDE_INTERVAL, TIDE_INTERVAL_SUDDEN_DEATH, TIDE_WARNING } from '../constants';
import { isStar, perpStrain, susceptibility } from '../lattice/geometry';
import { TAU } from '../math';
import { FACTION_IDS, NEUTRAL } from '../types';
import type { Owner } from '../types';
import type { World } from '../world';
import { inStabilizeZone } from './abilities';
import { shatterCrystal } from './crystals';
import { collapseSimulacrum, dropLoose, isBuildingCorner } from './flags';
import { isFactionId } from './rules/factions';
import { isObserved, markSurveyDirty } from './survey';

export type FlipCause = 'tide' | 'ability' | 'storm';

/** Tide sampling weight: every flippable node can turn, strained/susceptible ones far more. */
const TIDE_BASE_WEIGHT = 0.25;
const TIDE_STRAIN_WEIGHT = 2;
/** The wave front crosses the whole burn in this many seconds. */
const WAVE_DURATION = 1.8;
/** The front advances in pulses; each pulse turns every chosen node it has passed. */
const WAVE_PULSE = 6 / SIM_HZ;
/** Sampling keys are drawn during the first part of the warning, a slice per tick. */
const KEYING_TIME = TIDE_WARNING / 2;

/** Cross-tick private state of the tide system (lives in world.scratch.tides). */
class TideScratch {
  /** Efraimidis–Spirakis key u^(1/w) per node for the coming tide; -1 = not flippable when keyed. */
  readonly keys: Float64Array;
  /** Per node: position along the wave direction (scratch for ordering the sweep). */
  readonly along: Float64Array;
  /** tide.nextAt the keys are being drawn for, and how many nodes are keyed so far. */
  keyedFor = -1;
  keyed = 0;
  /** The breaking wave: chosen nodes in sweep order and when the front reaches each. */
  readonly wave: number[] = [];
  readonly waveAt: number[] = [];
  waveNext = 0;
  nextPulseAt = 0;
  /** Flags decohered per faction by the current wave (told once it has passed). */
  readonly decohered = [0, 0, 0, 0];

  constructor(world: World) {
    this.keys = new Float64Array(world.lattice.nodes.length);
    this.along = new Float64Array(world.lattice.nodes.length);
  }
}

function scratchOf(world: World): TideScratch {
  const s = world.scratch.tides;
  if (s instanceof TideScratch) return s;
  const fresh = new TideScratch(world);
  world.scratch.tides = fresh;
  return fresh;
}

/**
 * Attempt a flip of `node`. Tides/storms skip nodes whose Flag is observed by its owner;
 * 'ability' flips ignore Canon III self-observation but never pass Stabilize Zones.
 * Corners of building facets never flip (buildings pin the Crystal). Returns true if the
 * lattice changed.
 */
export function applyFlip(world: World, node: number, cause: FlipCause): boolean {
  const lat = world.lattice;
  if (!Number.isInteger(node) || node < 0 || node >= lat.nodes.length || !lat.flippable(node)) return false;
  if (isBuildingCorner(world, node) || inStabilizeZone(world, lat.nodes[node])) return false;
  const fl = world.flags.get(world.survey.nodeFlag[node]);
  if (cause !== 'ability' && fl && isFactionId(fl.owner) && isObserved(world, node, fl.owner)) return false;

  const res = lat.flip(node);
  if (!res) return false;

  if (fl) {
    if (fl.altNode >= 0) {
      // A superposed Flag survives on its twin node.
      collapseSimulacrum(world, fl, fl.node === node ? fl.altNode : fl.node);
    } else {
      dropLoose(world, fl.id, { x: res.fromX, y: 0, z: res.fromZ });
      world.emit({ t: 'flagDecohered', flagId: fl.id, node, pos: { ...fl.pos } });
    }
  }
  // The hexagon ring lost or gained facets: any Crystal standing on it may no longer sit on a
  // 5-fold star. Broken pentacles (decohered Flags) are caught by updateCrystals.
  for (const c of world.crystals.values()) {
    if (res.touchedNodes.includes(c.node) && !isStar(lat, c.node)) shatterCrystal(world, c);
  }
  world.emit({ t: 'phasonFlip', node, from: { x: res.fromX, z: res.fromZ }, to: { x: res.toX, z: res.toZ }, cause });
  markSurveyDirty(world);
  return true;
}

/** Schedules tides (TIDE_INTERVAL, warning TIDE_WARNING before) and executes them. */
export function updateTides(world: World, dt: number): void {
  const tide = world.tide;
  const sc = scratchOf(world);
  const nodeCount = world.lattice.nodes.length;
  if (sc.waveNext < sc.wave.length) advanceWave(world, sc, false);
  if (!tide.warned && world.time >= tide.nextAt - TIDE_WARNING) {
    tide.warned = true;
    sc.keyedFor = tide.nextAt;
    sc.keyed = 0;
    world.emit({ t: 'tideWarning', at: tide.nextAt });
    world.emit({ t: 'notify', faction: 'all', text: 'The Crystal is turning…', severity: 'warn' });
  }
  if (sc.keyedFor === tide.nextAt && sc.keyed < nodeCount) {
    keyNodes(world, sc, Math.ceil(nodeCount / (KEYING_TIME * SIM_HZ)));
  }
  if (world.time < tide.nextAt) return;
  breakWave(world, sc);
  tide.count++;
  tide.nextAt = world.time + (world.suddenDeath ? TIDE_INTERVAL_SUDDEN_DEATH : TIDE_INTERVAL);
  tide.warned = false;
}

/**
 * Draw sampling keys for the next `count` nodes: weight 0.25 + susceptibility + 2·strain, so
 * the lattice tends to heal back toward perfect Penrose order.
 */
function keyNodes(world: World, sc: TideScratch, count: number): void {
  const lat = world.lattice;
  const end = Math.min(lat.nodes.length, sc.keyed + count);
  for (let n = sc.keyed; n < end; n++) {
    if (!lat.flippable(n)) {
      sc.keys[n] = -1;
      continue;
    }
    const w = TIDE_BASE_WEIGHT + susceptibility(lat, n) + TIDE_STRAIN_WEIGHT * perpStrain(lat, n);
    sc.keys[n] = Math.pow(world.rng.next(), 1 / w);
  }
  sc.keyed = end;
}

/**
 * The tide breaks: the ≈TIDE_FRACTION highest-keyed nodes that are still flippable (a
 * weighted draw without replacement) are queued along a seeded direction, each turning when
 * the front sweeping the burn reaches it.
 */
function breakWave(world: World, sc: TideScratch): void {
  const lat = world.lattice;
  if (sc.waveNext < sc.wave.length) advanceWave(world, sc, true);
  if (sc.keyedFor !== world.tide.nextAt) {
    // The warning never ran for this tide (it was rescheduled): key everything now.
    sc.keyedFor = world.tide.nextAt;
    sc.keyed = 0;
  }
  keyNodes(world, sc, lat.nodes.length - sc.keyed);

  const ids: number[] = [];
  for (let n = 0; n < lat.nodes.length; n++) if (sc.keys[n] >= 0 && lat.flippable(n)) ids.push(n);
  const want = Math.min(ids.length, Math.max(1, Math.round(ids.length * TIDE_FRACTION)));
  ids.sort((a, b) => sc.keys[b] - sc.keys[a] || a - b);
  ids.length = want;

  const angle = world.rng.range(0, TAU);
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  // Projection of the map square onto the direction: the front runs from -reach to +reach.
  const reach = MAP_HALF * (Math.abs(dx) + Math.abs(dz));
  for (const n of ids) sc.along[n] = lat.nodes[n].x * dx + lat.nodes[n].z * dz;
  ids.sort((a, b) => sc.along[a] - sc.along[b] || a - b);
  sc.wave.length = 0;
  sc.waveAt.length = 0;
  for (const n of ids) {
    sc.wave.push(n);
    sc.waveAt.push(world.time + ((sc.along[n] + reach) / (2 * reach)) * WAVE_DURATION);
  }
  sc.waveNext = 0;
  sc.nextPulseAt = world.time;
  sc.decohered.fill(0);
  world.emit({ t: 'tide', flips: ids.length, dir: { x: dx, z: dz }, duration: WAVE_DURATION });
  advanceWave(world, sc, false);
}

/** Turn every queued node the front has reached (all of them when `all`), once per pulse. */
function advanceWave(world: World, sc: TideScratch, all: boolean): void {
  if (!all && world.time < sc.nextPulseAt) return;
  sc.nextPulseAt = world.time + WAVE_PULSE;
  while (sc.waveNext < sc.wave.length && (all || sc.waveAt[sc.waveNext] <= world.time)) {
    const node = sc.wave[sc.waveNext++];
    const fl = world.flags.get(world.survey.nodeFlag[node]);
    const loser: Owner = fl && fl.altNode < 0 ? fl.owner : NEUTRAL;
    if (applyFlip(world, node, 'tide') && isFactionId(loser)) sc.decohered[loser]++;
  }
  if (sc.waveNext < sc.wave.length) return;
  sc.wave.length = 0;
  sc.waveAt.length = 0;
  sc.waveNext = 0;
  for (const f of FACTION_IDS) {
    const n = sc.decohered[f];
    if (n === 0 || !world.factions[f].alive) continue;
    world.emit({
      t: 'notify',
      faction: f,
      text: `The Phason Tide decohered ${n} of your Flag${n === 1 ? '' : 's'}. Finish your casting.`,
      severity: 'warn',
    });
  }
  sc.decohered.fill(0);
}
