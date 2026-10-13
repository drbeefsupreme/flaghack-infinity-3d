/** Durable, host-owned encounter state. Renderers never advance gameplay. */
import type { EntityId, FactionId, Owner } from './types';
import type { V2, V3 } from './math';
import { BOSS_GAMEPLAY_SCALE } from './bossDimensions';
/** Default encounter health; each new boss reads the pregame Boss HP setting. */
export const BOSS_MAX_HP = 50000;
export const BOSS_FLAG_BODY_DAMAGE = 100;
/** Existing face/head/hat region, including its attached drape. */
export const BOSS_FLAG_HEAD_DAMAGE = 300;
export const BOSS_RADIUS = 2.35 * BOSS_GAMEPLAY_SCALE;
export const BOSS_DEATH_DURATION = 12;
/** Boss-only Omega tuning; ordinary targets keep the original pulse damage. */
export const BOSS_OMEGA_DAMAGE = 500;
export const BOSS_RECOIL_DURATION = 1;
export const BOSS_INTERRUPT_IMMUNITY = 20;
export const BOSS_EYE_TIMING = { period: 30, charge: 3, beam: 5 } as const;
export const BOSS_EYE_BLAST_RADIUS = 5;
export const BOSS_EYE_DAMAGE = 1000;
export const BOSS_EYE_MAX_RANGE = 240;
export interface BossEyeState {
  nextFireAt: number;
  chargeAt: number | null;
  firedAt: number | null;
  /** Current world aim along the locked, host-sampled sweep route. */
  target: V3 | null;
  origin: V3 | null;
  direction: V3 | null;
  impact: V3 | null;
  impactTag: number | null;
  /** Ordered points selected at charge start; sampled on the host's fixed attack clock. */
  route: V3[];
  sample: number;
  /** Per-beam hit ledgers survive snapshots; a re-entering target is never damaged twice. */
  damaged: EntityId[];
  knockedFlags: EntityId[];
}
export function createBossEyeState(spawnedAt: number): BossEyeState {
  return { nextFireAt: spawnedAt + BOSS_EYE_TIMING.period, chargeAt: null, firedAt: null,
    target: null, origin: null, direction: null, impact: null, impactTag: null, route: [], sample: -1, damaged: [], knockedFlags: [] };
}
export function clearBossEyeCharge(boss: BossState): void {
  boss.eye.chargeAt = null; boss.eye.firedAt = null; boss.eye.target = null;
  boss.eye.origin = null; boss.eye.direction = null; boss.eye.impact = null; boss.eye.impactTag = null;
  boss.eye.route = []; boss.eye.sample = -1; boss.eye.damaged = []; boss.eye.knockedFlags = [];
}
export const BOSS_ACTIONS = ['emerge', 'idle', 'walk', 'crouch', 'crouchWalk', 'rise', 'swipe', 'stomp', 'grab', 'recoil', 'death', 'dead'] as const;
export type BossAction = typeof BOSS_ACTIONS[number];
export type BossTargetKind = 'avatar' | 'hippie' | 'building' | 'piece' | 'flag';
export interface BossTarget { kind: BossTargetKind; id: EntityId; }
export interface BossBarrier { edge: number; faction: FactionId; x: number; z: number; at: number; }
export interface BossLightning { kind: 'crystal' | 'ward'; id: EntityId; faction: FactionId; from: V3; to: V3; }
export interface BossState {
  /** Active defensive emitters, derived on the host and rendered by live/late peers. */
  lightning: BossLightning[];
  id: EntityId;
  pos: V2;
  yaw: number;
  hp: number;
  maxHp: number;
  spawnedAt: number;
  action: BossAction;
  /** Current stable stance; transitions interpolate from this state. Swipe/grab stay crouched through recovery. */
  crouched: boolean;
  actionAt: number;
  /** Monotonic attack sequence; each hit is consumed exactly once on the host. */
  actionSeq: number;
  hitSeq: number;
  target: BossTarget | null;
  focusFaction: FactionId | null;
  /** Strategic altar remains locked through distractions and CMI changes. */
  objectiveAltarId: EntityId | null;
  routeStartStride: number;
  nextSceneryStompStride: number;
  opportunisticAfter: number;
  retaliateId: EntityId | null;
  retaliateUntil: number;
  nextAttackAt: number;
  /** Shared across every attacker; damage still lands while further grab interrupts are blocked. */
  interruptImmuneUntil: number;
  deathAt: number | null;
  barrier: BossBarrier | null;
  /** Ground-space stride distance drives in-place animation on every peer. */
  stride: number;
  /** Attached target stays readable even after removal from the live entity maps. */
  held: { kind: BossTargetKind; id: EntityId; faction: Owner; x: number; z: number } | null;
  eye: BossEyeState;
}
export interface BossOutcome { kind: 'victory' | 'defeat'; winners: FactionId[]; at: number; }

export const BOSS_TIMING = { emerge: 1.1, transition: 0.65, swipe: 1.2, swipeHit: .55, stomp: 2.2, stompHit: 1.0, grab: 3.8, grasp: 1.35, consume: 2.8 } as const;
