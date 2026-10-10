/** Durable, host-owned encounter state. Renderers never advance gameplay. */
import type { EntityId, FactionId, Owner } from './types';
import type { V2 } from './math';
export const BOSS_MAX_HP = 8800;
export const BOSS_RADIUS = 2.35;
export const BOSS_DEATH_DURATION = 12;
export const BOSS_ACTIONS = ['emerge', 'idle', 'walk', 'crouch', 'crouchWalk', 'rise', 'swipe', 'stomp', 'grab', 'death', 'dead'] as const;
export type BossAction = typeof BOSS_ACTIONS[number];
export type BossTargetKind = 'avatar' | 'hippie' | 'building' | 'piece' | 'flag';
export interface BossTarget { kind: BossTargetKind; id: EntityId; }
export interface BossBarrier { edge: number; faction: FactionId; x: number; z: number; at: number; }
export interface BossState {
  id: EntityId;
  pos: V2;
  yaw: number;
  hp: number;
  maxHp: number;
  spawnedAt: number;
  action: BossAction;
  /** Current stable stance; transitions interpolate from this state. */
  crouched: boolean;
  actionAt: number;
  /** Monotonic attack sequence; each hit is consumed exactly once on the host. */
  actionSeq: number;
  hitSeq: number;
  target: BossTarget | null;
  focusFaction: FactionId | null;
  retaliateId: EntityId | null;
  retaliateUntil: number;
  nextAttackAt: number;
  deathAt: number | null;
  barrier: BossBarrier | null;
  /** Ground-space stride distance drives in-place animation on every peer. */
  stride: number;
  /** Attached target stays readable even after removal from the live entity maps. */
  held: { kind: BossTargetKind; id: EntityId; faction: Owner; x: number; z: number } | null;
}
export interface BossOutcome { kind: 'victory' | 'defeat'; winners: FactionId[]; at: number; }

export const BOSS_TIMING = { emerge: 1.1, transition: 0.65, swipe: 2.4, swipeHit: 1.1, stomp: 2.2, stompHit: 1.0, grab: 3.8, grasp: 1.35, consume: 2.8 } as const;
