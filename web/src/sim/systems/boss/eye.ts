/** Fixed-clock eye charge, one ray impact and one radial blast. Mirrors only render the facts. */
import { BOSS_EYE_BLAST_RADIUS, BOSS_EYE_DAMAGE, BOSS_EYE_MAX_RANGE, BOSS_EYE_TIMING, clearBossEyeCharge } from '../../boss';
import type { BossState, BossTarget } from '../../boss';
import { solveBossEyeAim } from '../../bossEyeRig';
import type { BossEyeQuaternion, BossEyeRay } from '../../bossEyeRig';
import { AVATAR, BUILDING_HEIGHT, BUILDINGS, HIPPIE, LEVEL_HEIGHT } from '../../constants';
import { angleDiff, clamp } from '../../math';
import type { V3 } from '../../math';
import type { Flag } from '../../types';
import type { World } from '../../world';
import { bossFocusAltar, consumeBuilding } from '../boss';
import { damageEntity } from '../combat';
import { pieceBottom } from '../econ/pieceGeometry';
import { dropLoose } from '../flags';
import { piecePosition } from '../pieces';
import { destroySceneryHit } from '../scenery';
import { updateSurvey } from '../survey';
import { brainOf, releaseTask } from '../units/brain';
import { breakChannel } from '../units/channel';
import { pieceClosest } from '../units/reach';
import { sampleBossHeadPose } from './hitRegions';

export const cancelBossEye = clearBossEyeCharge;
/** Crowd variants are approximately human height; simulation deliberately avoids renderer imports. */
export const BOSS_EYE_HIPPIE_HEIGHT = 1.8;

function targetPoint(world: World, target: BossTarget | null): V3 | null {
  if (!target) return null;
  if (target.kind === 'avatar') {
    const a = world.avatars.get(target.id);
    // Aim at the support beneath a unit, so the terrain impact lands at the
    // telegraphed spot rather than continuing past a torso that has no ray collider.
    return a && !a.koUntil && world.factions[a.faction].alive ? { x: a.pos.x,
      y: world.collision.supportHeight(a.pos.x, a.pos.z, a.pos.y + .01), z: a.pos.z } : null;
  }
  if (target.kind === 'hippie') {
    const h = world.hippies.get(target.id);
    return h && h.status !== 'ko' ? { x: h.pos.x,
      y: world.collision.supportHeight(h.pos.x, h.pos.z, (h.airborne?.y ?? 0) + .01), z: h.pos.z } : null;
  }
  if (target.kind === 'building') {
    const b = world.buildings.get(target.id);
    return b ? { x: b.pos.x, y: BUILDING_HEIGHT[b.kind] / 2, z: b.pos.z } : null;
  }
  if (target.kind === 'piece') {
    const p = world.pieces.get(target.id), at = p && piecePosition(world, p);
    return at ? { x: at.x, y: at.y, z: at.z } : null;
  }
  const f = world.flags.get(target.id);
  return f && (f.state === 'planted' || f.state === 'loose') ? { x: f.pos.x, y: f.pos.y, z: f.pos.z } : null;
}

function chooseTarget(world: World, boss: BossState): V3 | null {
  if (boss.retaliateId !== null && world.time < boss.retaliateUntil) {
    const retaliate = targetPoint(world, { kind: 'avatar', id: boss.retaliateId });
    if (retaliate) return retaliate;
  }
  const current = targetPoint(world, boss.target);
  if (current) return current;
  const altar = bossFocusAltar(world);
  return altar ? targetPoint(world, { kind: 'building', id: altar.id }) : null;
}

/** Exact actual pupil ray from the zero-breath idle head sample and shared offset-aware aim. */
export function bossEyeRay(_world: World, boss: BossState): BossEyeRay {
  const head = sampleBossHeadPose(boss, boss.spawnedAt), c = Math.cos(boss.yaw), s = Math.sin(boss.yaw);
  const position = { x: boss.pos.x + c * head.position.x + s * head.position.z, y: head.position.y,
    z: boss.pos.z - s * head.position.x + c * head.position.z };
  const half = boss.yaw / 2, sy = Math.sin(half), cy = Math.cos(half), q = head.quaternion;
  const rotation: BossEyeQuaternion = [cy * q[0] + sy * q[2], cy * q[1] + sy * q[3], cy * q[2] - sy * q[0], cy * q[3] - sy * q[1]];
  const target = boss.eye.target ?? { x: position.x + s * 50, y: 0, z: position.z + c * 50 };
  return solveBossEyeAim(position, rotation, target);
}

/** True while the eye owns the boss's action/movement slot. No render callback can enter here. */
export function updateBossEye(world: World, boss: BossState, dt: number): boolean {
  if (boss.hp <= 0 || world.phase !== 'playing' || world.effigyRevealedAt === null) { cancelBossEye(boss); return false; }
  const eye = boss.eye;
  if (eye.firedAt !== null) {
    if (world.time < eye.firedAt + BOSS_EYE_TIMING.beam - 1e-9) return true;
    cancelBossEye(boss);
    boss.nextAttackAt = Math.max(boss.nextAttackAt, world.time + .25);
    return false;
  }
  if (eye.chargeAt === null) {
    if (world.time < eye.nextFireAt - BOSS_EYE_TIMING.charge - 1e-9 ||
        boss.action === 'emerge' || boss.action === 'crouch' || boss.action === 'rise' || boss.action === 'death' || boss.action === 'dead') return false;
    const target = chooseTarget(world, boss);
    if (!target) return false;
    // Even a skipped tick or an interrupted stance must still show a full charge.
    eye.chargeAt = world.time; eye.nextFireAt = world.time + BOSS_EYE_TIMING.charge; eye.target = target;
    eye.origin = null; eye.direction = null; eye.impact = null;
    boss.action = 'idle'; boss.actionAt = world.time; boss.actionSeq++; boss.held = null;
  }
  const target = eye.target!;
  const yaw = Math.atan2(target.x - boss.pos.x, target.z - boss.pos.z);
  boss.yaw += clamp(angleDiff(boss.yaw, yaw), -2.4 * dt, 2.4 * dt);
  if (world.time < eye.nextFireAt - 1e-9) return true;
  const ray = bossEyeRay(world, boss);
  const hit = world.collision.raycast(ray.origin.x, ray.origin.y, ray.origin.z,
    ray.direction.x, ray.direction.y, ray.direction.z, BOSS_EYE_MAX_RANGE, boss.id);
  eye.firedAt = world.time; eye.nextFireAt = world.time + BOSS_EYE_TIMING.period;
  eye.origin = ray.origin; eye.direction = ray.direction;
  eye.impact = hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
  if (hit) destroySceneryHit(world, hit.tag);
  if (eye.impact) blastBossEye(world, boss, eye.impact);
  return true;
}

const radius2 = BOSS_EYE_BLAST_RADIUS ** 2;
function pointInside(at: Readonly<V3>, p: Readonly<V3>): boolean {
  return (at.x - p.x) ** 2 + (at.y - p.y) ** 2 + (at.z - p.z) ** 2 <= radius2 + 1e-9;
}
function bodyInside(at: Readonly<V3>, x: number, z: number, y0: number, y1: number, radius: number): boolean {
  const horizontal = Math.max(0, Math.hypot(at.x - x, at.z - z) - radius);
  const vertical = Math.max(y0 - at.y, 0, at.y - y1);
  return horizontal ** 2 + vertical ** 2 <= radius2 + 1e-9;
}
/** Return the affected representation, rather than a stale stored flag position. */
function flagInside(world: World, at: V3, flag: Flag): V3 | null {
  let pos: V3 = flag.pos;
  if (flag.state === 'stock') {
    const building = world.buildings.get(flag.holder);
    if (building) pos = { ...building.pos, y: 0 };
  } else if (flag.state === 'carried') {
    const avatar = world.avatars.get(flag.holder), hippie = world.hippies.get(flag.holder);
    if (avatar) pos = avatar.pos;
    else if (hippie) pos = { ...hippie.pos, y: hippie.airborne?.y ?? 0 };
  } else if (flag.state === 'flying') {
    for (const projectile of world.projectiles.values()) if (projectile.flagId === flag.id) { pos = projectile.pos; break; }
  }
  if (pointInside(at, pos)) return { ...pos };
  if (flag.state !== 'planted' || flag.altNode < 0) return null;
  const twin = world.lattice.nodes[flag.altNode];
  return twin && pointInside(at, { ...twin, y: 0 }) ? { x: twin.x, y: 0, z: twin.z } : null;
}

/** One 1,000-damage impact sphere. Flags fall intact; nothing takes corridor damage. */
export function blastBossEye(world: World, boss: BossState, at: V3): void {
  // Capture contents before KO scatter or structure removal changes their positions.
  const hitFlags = new Map<number, V3>();
  for (const flag of world.flags.values()) { const pos = flagInside(world, at, flag); if (pos) hitFlags.set(flag.id, pos); }
  const buildings = [...world.buildings.values()].filter(b => bodyInside(at, b.pos.x, b.pos.z, 0, BUILDING_HEIGHT[b.kind], BUILDINGS[b.kind].radius));
  // A destroyed storage structure spills recoverable Flags as well. Detach before
  // consumeBuilding's ordinary eating lifecycle would remove the held contents.
  for (const b of buildings) if (b.kind !== 'hearth' && b.hp <= BOSS_EYE_DAMAGE) {
    for (const flag of world.flags.values()) if (flag.holder === b.id) hitFlags.set(flag.id, { ...b.pos, y: 0 });
  }
  for (const [id, pos] of hitFlags) dropLoose(world, id, pos);
  for (const projectile of [...world.projectiles.values()]) if (hitFlags.has(projectile.flagId)) world.projectiles.delete(projectile.id);
  for (const avatar of world.avatars.values()) if (avatar.action.kind === 'pull' && hitFlags.has(avatar.action.flagId)) breakChannel(world, avatar);
  for (const hippie of world.hippies.values()) {
    const brain = brainOf(hippie);
    if (hitFlags.has(brain.flag)) {
      releaseTask(world, hippie, brain);
      if (hippie.status !== 'ko') { hippie.status = 'idle'; hippie.statusTarget = null; }
    }
    if (hippie.order?.kind === 'pull' && hitFlags.has(hippie.order.flagId) || hippie.order?.kind === 'attack' && hitFlags.has(hippie.order.target)) hippie.order = null;
  }
  for (const a of world.avatars.values()) if (!a.koUntil && bodyInside(at, a.pos.x, a.pos.z, a.pos.y, a.pos.y + AVATAR.height, AVATAR.radius)) {
    damageEntity(world, a.id, BOSS_EYE_DAMAGE, boss.id);
  }
  for (const h of world.hippies.values()) {
    const y = h.airborne?.y ?? 0;
    if (h.status !== 'ko' && bodyInside(at, h.pos.x, h.pos.z, y, y + BOSS_EYE_HIPPIE_HEIGHT, HIPPIE.radius)) damageEntity(world, h.id, BOSS_EYE_DAMAGE, boss.id);
  }
  for (const building of buildings) {
    // Altars can only be eaten: beam damage keeps their ordinary 1 HP floor.
    // Other buildings are permanently removed only when this 1,000-damage hit is lethal.
    building.hp = Math.max(building.kind === 'hearth' ? 1 : 0, building.hp - BOSS_EYE_DAMAGE);
    world.emit({ t: 'hit', target: building.id, by: boss.id, amount: BOSS_EYE_DAMAGE,
      pos: { ...building.pos, y: BUILDING_HEIGHT[building.kind] / 2 } });
    if (building.hp <= 0) consumeBuilding(world, building, true);
  }
  const reach = { x: 0, z: 0, dist: 0 };
  for (const piece of [...world.pieces.values()]) {
    pieceClosest(world, piece, at.x, at.z, reach);
    const dy = Math.max(pieceBottom(piece.kind, piece.level) - at.y, 0, at.y - (piece.level + 1) * LEVEL_HEIGHT);
    if (reach.dist ** 2 + dy ** 2 <= radius2 + 1e-9) damageEntity(world, piece.id, BOSS_EYE_DAMAGE, boss.id);
  }
  // Re-ground after destroyed decks/buildings retire their collision shapes.
  for (const id of hitFlags.keys()) {
    const flag = world.flags.get(id);
    if (flag) flag.pos.y = world.collision.supportHeight(flag.pos.x, flag.pos.z, flag.pos.y + .1);
  }
  // The boss runs after Survey in a normal tick. Refresh broken loops now so
  // mirrors and the following Crystal system see the changed topology immediately.
  if (world.survey.dirty) updateSurvey(world, 0);
  // Piles have no HP. Crystals follow their normal sustaining-pentacle lifecycle.
}
