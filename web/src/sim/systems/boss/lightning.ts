/** Host-only defensive lightning. Mirrors present the durable links, never apply damage. */
import { BOSS_TIMING } from '../../boss';
import type { BossState } from '../../boss';
import { BOSS_GAMEPLAY_SCALE } from '../../bossDimensions';
import { BUILDING_HEIGHT, CRYSTAL_HEIGHT, MAP_HALF } from '../../constants';
import { groundHeight } from '../../terrain';
import type { V2, V3 } from '../../math';
import type { Building, Crystal, Flag } from '../../types';
import type { World } from '../../world';
import { damageEntity } from '../combat';
import { wardProtectsFlag } from '../flags';
import { sampleBossHeadPose } from './hitRegions';

export const BOSS_CRYSTAL_LIGHTNING_RANGE = 50;
export const BOSS_CRYSTAL_LIGHTNING_DPS = 25;
export const BOSS_GIANT_CRYSTAL_LIGHTNING_DPS = 35;
/** Wards previously only slowed player pulls; the giant's defensive damage is 25 HP/s. */
export const BOSS_WARD_LIGHTNING_DPS = 25;
const FLAG_ATTACK_REACH = 8 * BOSS_GAMEPLAY_SCALE + .5;

interface LightningClock { boss: number; at: number; pos: V2; }
function live(world: World, boss: BossState): boolean { return world.phase === 'playing' && boss.hp > 0; }
function readyCrystal(world: World, c: Crystal): boolean { return c.growth >= 1 && world.factions[c.faction]?.alive === true; }
const giant = (c: Crystal): boolean => c.scale === 10;

/** Pure query shared by lightning presentation state and crystal-retaliation targeting. */
export function activeBossCrystals(world: World, boss: BossState): Crystal[] {
  if (!live(world, boss)) return [];
  return [...world.crystals.values()].filter(c => readyCrystal(world, c) && (giant(c) ||
    (c.pos.x - boss.pos.x) ** 2 + (c.pos.z - boss.pos.z) ** 2 <= BOSS_CRYSTAL_LIGHTNING_RANGE ** 2));
}

function attackedFlag(world: World, boss: BossState): Flag | null {
  if (!live(world, boss) || boss.action !== 'grab' || boss.hitSeq === boss.actionSeq ||
      boss.eye.chargeAt !== null || boss.target?.kind !== 'flag') return null;
  const flag = world.flags.get(boss.target.id);
  return flag?.state === 'planted' && flag.owner >= 0 && world.factions[flag.owner]?.alive &&
    (flag.pos.x - boss.pos.x) ** 2 + (flag.pos.z - boss.pos.z) ** 2 <= FLAG_ATTACK_REACH ** 2 ? flag : null;
}
function defendingWards(world: World, boss: BossState): Building[] {
  const flag = attackedFlag(world, boss);
  return flag ? [...world.buildings.values()].filter(w => w.hp > 0 && wardProtectsFlag(w, flag)) : [];
}

/** Actual posed head anchor of the 32 m rig, including crouch/attack offsets and yaw. */
export function bossLightningTarget(boss: BossState, now: number, mapHalf = MAP_HALF): V3 {
  const { position: p } = sampleBossHeadPose(boss, now), c = Math.cos(boss.yaw), s = Math.sin(boss.yaw);
  return { x: boss.pos.x + c * p.x + s * p.z, y: groundHeight(boss.pos.x, boss.pos.z, mapHalf) + p.y, z: boss.pos.z - s * p.x + c * p.z };
}

/** Refresh after movement/consumption as well as damage so snapshots never retain ended links. */
export function syncBossLightning(world: World, boss: BossState): void {
  if (!live(world, boss)) { boss.lightning = []; return; }
  const to = bossLightningTarget(boss, world.time, world.map.half);
  boss.lightning = activeBossCrystals(world, boss).map(c => ({ kind: 'crystal' as const, id: c.id, faction: c.faction,
    from: { x: c.pos.x, y: groundHeight(c.pos.x, c.pos.z, world.map.half) + CRYSTAL_HEIGHT * c.scale, z: c.pos.z }, to: { ...to } }));
  if (world.time >= boss.actionAt && world.time < boss.actionAt + BOSS_TIMING.consume) {
    for (const w of defendingWards(world, boss)) boss.lightning.push({ kind: 'ward', id: w.id, faction: w.faction as Crystal['faction'],
      from: { x: w.pos.x, y: groundHeight(w.pos.x, w.pos.z, world.map.half) + BUILDING_HEIGHT.ward, z: w.pos.z }, to: { ...to } });
  }
}

/** Fraction of linear ground movement spent inside the exact 50 m circle, inclusive. */
export function bossCrystalExposure(from: V2, to: V2, crystal: V2): number {
  const x = from.x - crystal.x, z = from.z - crystal.z, dx = to.x - from.x, dz = to.z - from.z;
  const a = dx * dx + dz * dz, c = x * x + z * z - BOSS_CRYSTAL_LIGHTNING_RANGE ** 2;
  if (a <= 1e-18) return c <= 0 ? 1 : 0;
  const h = x * dx + z * dz, discriminant = h * h - a * c;
  if (discriminant < 0) return 0;
  const root = Math.sqrt(discriminant);
  return Math.max(0, Math.min(1, (-h + root) / a) - Math.max(0, (-h - root) / a));
}

/** Apply elapsed exposure once per authoritative timestamp, independently for each source. */
export function updateBossLightning(world: World, boss: BossState, dt: number): void {
  const previous = world.scratch.bossLightningClock as LightningClock | undefined;
  const same = previous?.boss === boss.id;
  const end = world.time, validDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const start = Math.max(end - validDt, boss.spawnedAt, same ? previous.at : -Infinity);
  const elapsed = Math.max(0, end - start);
  // The boss is advanced after this function. Its previous movement is observed at
  // this timestamp; integrate the swept circle so entering/leaving never bills a
  // full coarse tick merely because one endpoint happens to be in range.
  const from = same && end > previous.at ? {
    x: previous.pos.x + (boss.pos.x - previous.pos.x) * (start - previous.at) / (end - previous.at),
    z: previous.pos.z + (boss.pos.z - previous.pos.z) * (start - previous.at) / (end - previous.at),
  } : boss.pos;
  world.scratch.bossLightningClock = { boss: boss.id, at: end, pos: { ...boss.pos } } satisfies LightningClock;
  if (live(world, boss) && elapsed > 0) {
    for (const c of world.crystals.values()) {
      if (!readyCrystal(world, c)) continue;
      const exposure = giant(c) ? 1 : bossCrystalExposure(from, boss.pos, c.pos);
      const dps = giant(c) ? BOSS_GIANT_CRYSTAL_LIGHTNING_DPS : BOSS_CRYSTAL_LIGHTNING_DPS;
      if (exposure > 0) damageEntity(world, boss.id, dps * elapsed * exposure, c.id);
      if (boss.hp <= 0) break;
    }
    const attacking = Math.max(0, Math.min(end, boss.actionAt + BOSS_TIMING.consume) - Math.max(start, boss.actionAt));
    if (attacking > 0) for (const w of defendingWards(world, boss)) {
      damageEntity(world, boss.id, BOSS_WARD_LIGHTNING_DPS * attacking, w.id);
      if (boss.hp <= 0) break;
    }
  }
  syncBossLightning(world, boss);
}
