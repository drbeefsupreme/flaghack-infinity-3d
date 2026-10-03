/**
 * Elimination, match end, The Burn (sudden death) timing.
 * Owner: SurveyRules agent.
 */
import { BURN_TIME, SUDDEN_DEATH_ESCALATE_EVERY, SUDDEN_DEATH_PRESSURE_MULT, TIDE_INTERVAL_SUDDEN_DEATH } from '../constants';
import { NEUTRAL } from '../types';
import type { FactionId } from '../types';
import type { World } from '../world';
import { collapseGcc, isCollapsed } from './buildings';
import { dropLoose, transferFlags } from './flags';
import { FACTION_SHORT } from './rules/factions';

/** Flags from a fallen quiver scatter this far around the vexillomancer. */
const QUIVER_SCATTER = 0.9;

/**
 * A faction with no Hearth is out: its vexillomancer falls Flagless for good (quiver
 * scattered), its Flags orphan (planted ones stand neutral, pullable by anyone), its hippies
 * wander off neutral, its plan is forgotten and its GCC collapses for ever.
 */
export function eliminate(world: World, faction: FactionId, by: FactionId | null): void {
  const fac = world.factions[faction];
  if (!fac.alive) return;
  fac.alive = false;
  fac.eliminatedAt = world.time;
  fac.eliminatedBy = by;
  fac.plan.clear();

  const av = world.avatars.get(fac.avatarId);
  if (av) {
    const wasUp = av.koUntil <= world.time;
    const quiver = av.carried.slice();
    for (let i = 0; i < quiver.length; i++) {
      const a = (i / quiver.length) * Math.PI * 2;
      const at = { x: av.pos.x + Math.cos(a) * QUIVER_SCATTER, y: av.pos.y, z: av.pos.z + Math.sin(a) * QUIVER_SCATTER };
      dropLoose(world, quiver[i], at);
    }
    av.koUntil = Infinity;
    av.hp = 0;
    av.action = { kind: 'idle' };
    av.pushing = -1;
    av.vel.x = 0;
    av.vel.z = 0;
    av.input = { moveX: 0, moveZ: 0, jump: false, sprint: false, yaw: av.yaw, pitch: av.pitch };
    if (wasUp) world.emit({ t: 'ko', id: av.id, kind: 'avatar', faction, by: -1, pos: { ...av.pos } });
  }

  for (const h of world.hippies.values()) {
    if (h.faction !== faction) continue;
    if (h.carryingFlag >= 0) dropLoose(world, h.carryingFlag, { x: h.pos.x, y: 0, z: h.pos.z });
    h.faction = NEUTRAL;
    h.job = null;
    h.order = null;
    h.status = 'idle';
    h.statusTarget = null;
    h.carryingLumber = 0;
    h.beacon = false;
  }

  transferFlags(world, faction, NEUTRAL);
  for (const fl of world.flags.values()) if (fl.owner === faction && fl.state !== 'stock') fl.owner = NEUTRAL;

  // The GCC collapses for ever (a cart already down simply never comes back).
  const gcc = world.gccOf(faction);
  if (gcc && gcc.gcc) {
    if (isCollapsed(gcc)) gcc.gcc.destroyedUntil = Infinity;
    else collapseGcc(world, gcc, Infinity);
  }
  fac.gccId = null;

  world.emit({ t: 'eliminated', faction, by });
  const overwriter = by !== null ? `, overwritten by ${FACTION_SHORT[by]}` : '';
  world.emit({
    t: 'notify',
    faction: 'all',
    text: `${fac.name} is Flagless${overwriter}. "Losing the flags is the first step to finding them."`,
    severity: 'epic',
  });
}

/**
 * Sudden-death pressure multiplier: 1 before The Burn, then SUDDEN_DEATH_PRESSURE_MULT, rising
 * by 1 every SUDDEN_DEATH_ESCALATE_EVERY seconds the Burn rages, so a stand-off always ends.
 */
export function suddenDeathMult(world: World): number {
  if (!world.suddenDeath) return 1;
  return SUDDEN_DEATH_PRESSURE_MULT + Math.max(0, Math.floor((world.time - BURN_TIME) / SUDDEN_DEATH_ESCALATE_EVERY));
}

/** Burn/sudden-death trigger at BURN_TIME and winner detection (one faction with Hearths left). */
export function updateVictory(world: World, dt: number): void {
  if (world.phase !== 'playing') return;
  if (!world.suddenDeath && world.time >= BURN_TIME) startBurn(world);
  if (world.suddenDeath) announceEscalation(world);

  let survivor: FactionId | null = null;
  let survivors = 0;
  for (const fac of world.factions) {
    if (!fac.alive || fac.hearthIds.length === 0) continue;
    survivors++;
    survivor = fac.id;
  }
  if (survivors !== 1 || survivor === null) return;
  world.phase = 'ended';
  world.winner = survivor;
  world.emit({ t: 'victory', faction: survivor });
  world.emit({
    t: 'notify',
    faction: 'all',
    text: `${world.factions[survivor].name} completes the Survey. Flags are the end of Flags, and the beginning of 10 thousand Flags.`,
    severity: 'epic',
  });
}

/** The Burn: the effigy burns and sudden death begins (pressure multiplied and rising, faster tides). */
function startBurn(world: World): void {
  world.suddenDeath = true;
  const soonest = world.time + TIDE_INTERVAL_SUDDEN_DEATH;
  if (world.tide.nextAt > soonest) {
    world.tide.nextAt = soonest;
    world.tide.warned = false;
  }
  world.emit({ t: 'burn' });
  world.emit({
    t: 'notify',
    faction: 'all',
    text:
      `THE BURN. The man burns away but flag remains. Surveys overwrite ×${SUDDEN_DEATH_PRESSURE_MULT}, ` +
      `rising every ${SUDDEN_DEATH_ESCALATE_EVERY} s; the Crystal turns every ${TIDE_INTERVAL_SUDDEN_DEATH} s.`,
    severity: 'epic',
  });
}

/**
 * Announce each step of the Burn's escalation exactly once, so players can read the clock.
 * The first multiplier seen is the one The Burn's own notice already announced.
 */
function announceEscalation(world: World): void {
  const mult = suddenDeathMult(world);
  const last = world.scratch.burnMult;
  if (typeof last === 'number' && mult <= last) return;
  world.scratch.burnMult = mult;
  if (typeof last !== 'number') return;
  world.emit({ t: 'notify', faction: 'all', text: `The Burn rages: Surveys overwrite ×${mult}.`, severity: 'epic' });
}
