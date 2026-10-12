/** Read-only attack tells, sampled from durable host clocks. No timers or local hit prediction. */
import { BOSS_EYE_TIMING, BOSS_TIMING, type BossState } from './boss';

export type BossAttackPhaseKind = 'swipeWindup' | 'stompWindup' | 'grabWindup' | 'grabConsume' | 'eyeCharge' | 'eyeBeam';
export interface BossAttackPhase {
  readonly kind: BossAttackPhaseKind;
  readonly label: string;
  readonly clock: 'action' | 'charge' | 'beam';
  readonly offset: number;
  readonly duration: number;
  readonly active: boolean;
}
const phase = (kind: BossAttackPhaseKind, label: string, clock: BossAttackPhase['clock'], duration: number, offset = 0, active = false): BossAttackPhase =>
  Object.freeze({ kind, label, clock, offset, duration, active });
const SWIPE = phase('swipeWindup', 'SWIPE · WINDUP', 'action', BOSS_TIMING.swipeHit);
const STOMP = phase('stompWindup', 'STOMP · WINDUP', 'action', BOSS_TIMING.stompHit);
const GRAB = phase('grabWindup', 'GRAB · REACHING', 'action', BOSS_TIMING.grasp);
const CONSUME = phase('grabConsume', 'GRAB · CONSUMING', 'action', BOSS_TIMING.consume - BOSS_TIMING.grasp, BOSS_TIMING.grasp, true);
const CHARGE = phase('eyeCharge', 'EYE BEAM · CHARGING', 'charge', BOSS_EYE_TIMING.charge);
const BEAM = phase('eyeBeam', 'EYE BEAM · SWEEPING', 'beam', BOSS_EYE_TIMING.beam, 0, true);

function startAt(boss: BossState, phase: BossAttackPhase): number {
  return (phase.clock === 'charge' ? boss.eye.chargeAt! : phase.clock === 'beam' ? boss.eye.firedAt! : boss.actionAt) + phase.offset;
}
function current(boss: BossState, phase: BossAttackPhase, now: number): BossAttackPhase | null {
  const start = startAt(boss, phase);
  return now >= start && now < start + phase.duration ? phase : null;
}

/** Static descriptors avoid allocating on every audio/render frame. Expired snapshots never replay tells. */
export function bossAttackPhase(boss: BossState | null | undefined, now: number): BossAttackPhase | null {
  if (!boss || !Number.isFinite(now) || boss.hp <= 0 || boss.deathAt !== null || boss.action === 'death' || boss.action === 'dead') return null;
  // The eye owns the action slot even if an older snapshot still contains a melee action.
  if (boss.eye.firedAt !== null) return current(boss, BEAM, now);
  if (boss.eye.chargeAt !== null) return current(boss, CHARGE, now);
  if (boss.hitSeq === boss.actionSeq) return null;
  if (boss.action === 'swipe') return current(boss, SWIPE, now);
  if (boss.action === 'stomp') return current(boss, STOMP, now);
  if (boss.action === 'grab') return current(boss, GRAB, now) ?? (boss.held ? current(boss, CONSUME, now) : null);
  return null;
}

/** A single monotonic fill per phase, frozen naturally when simulation time pauses. */
export function bossAttackProgress(boss: BossState, phase: BossAttackPhase, now: number): number {
  return Math.max(0, Math.min(1, (now - startAt(boss, phase)) / phase.duration));
}
