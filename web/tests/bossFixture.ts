import { BOSS_MAX_HP, createBossEyeState } from '../src/sim/boss';
import type { BossState } from '../src/sim/boss';

export function bossFixture(): BossState {
  return { lightning: [], id: 98765, pos: { x: 1, z: 2 }, yaw: 0.4, hp: 5123.4, maxHp: BOSS_MAX_HP,
    spawnedAt: 230, action: 'grab', crouched: true, actionAt: 242.123, actionSeq: 8, hitSeq: 7,
    target: { kind: 'building', id: 100 }, focusFaction: 2, objectiveAltarId: 100,
    routeStartStride: 5.25, nextSceneryStompStride: 21.55, opportunisticAfter: 250,
    retaliateId: 45, retaliateUntil: 251.5,
    nextAttackAt: 248.25, deathAt: null, barrier: { edge: 4, faction: 1, x: 8.1, z: 9.2, at: 241.25 },
    stride: 15.55, held: { kind: 'flag', id: 123, faction: -1, x: 1.25, z: -8.25 }, eye: createBossEyeState(230) };
}
