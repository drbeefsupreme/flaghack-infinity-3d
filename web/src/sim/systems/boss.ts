/** Host-only giant AI, movement and once-per-action impact windows. */
import { BOSS_DEATH_DURATION, BOSS_MAX_HP, BOSS_RADIUS, BOSS_TIMING } from '../boss';
import type { BossAction, BossState, BossTarget } from '../boss';
import { BUILDINGS, MAP_HALF } from '../constants';
import { angleDiff, clamp, distToSegment } from '../math';
import type { V2 } from '../math';
import type { Building, EntityId, FactionId, Owner } from '../types';
import type { World } from '../world';
import { barrierFlags, bossLoopEdges, sweepBossLoops } from './boss/barriers';
import { registerBuildingShape } from './buildings';
import { damageEntity } from './combat';
import { applyEffect } from './effects';
import { destroyFlag } from './flags';
import { destroyPiece, piecePosition } from './pieces';
import { eliminateByBoss } from './victory';

const WALK_SPEED = 4.3, CROUCH_SPEED = 2.0, GRAB_REACH = 8, SWIPE_REACH = 9;
const SWIPE_DAMAGE = 55, STOMP_DAMAGE = 140, STOMP_RADIUS = 4.6;

export function spawnBoss(world: World): BossState | null {
  if (world.boss || world.effigyRevealedAt === null || world.phase !== 'playing') return world.boss;
  const at = world.effigyRevealedAt;
  world.boss = { id: world.newId(), pos: { x: world.map.effigy.x, z: world.map.effigy.z }, yaw: 0,
    hp: BOSS_MAX_HP, maxHp: BOSS_MAX_HP, spawnedAt: at, action: 'emerge', crouched: false, actionAt: at,
    actionSeq: 0, hitSeq: -1, target: null, focusFaction: null, retaliateId: null, retaliateUntil: 0,
    nextAttackAt: at + BOSS_TIMING.emerge, deathAt: null, barrier: null, stride: 0, held: null };
  world.emit({ t: 'notify', faction: 'all', text: 'The giant has awakened. Rival camps stand together. Protect your altars and bring it down!', severity: 'epic' });
  return world.boss;
}

/** Highest faction CMI first; altar count never enters this ordering. */
export function bossFocusAltar(world: World): Building | null {
  const factions = world.factions.filter(f => f.alive && f.hearthIds.some(id => world.buildings.has(id)))
    .sort((a, b) => b.stats.cmi - a.stats.cmi || a.id - b.id);
  const f = factions[0], boss = world.boss;
  if (!f) return null;
  return f.hearthIds.map(id => world.buildings.get(id)).filter((b): b is Building => !!b)
    .sort((a, b) => (boss ? distance(boss.pos, a.pos) - distance(boss.pos, b.pos) : 0) || a.id - b.id)[0] ?? null;
}

function distance(a: V2, b: V2): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function face(b: BossState, to: V2, dt: number): void {
  const goal = Math.atan2(to.x - b.pos.x, to.z - b.pos.z);
  b.yaw += clamp(angleDiff(b.yaw, goal), -2.4 * dt, 2.4 * dt);
}
function action(world: World, b: BossState, next: BossAction): void {
  if (b.action === next) return;
  b.action = next; b.actionAt = world.time; b.actionSeq++; b.held = null;
}
export function bossTargetPosition(world: World, t: BossTarget | null): V2 | null {
  if (!t) return null;
  if (t.kind === 'avatar') { const a = world.avatars.get(t.id); return a && a.koUntil === 0 && world.factions[a.faction].alive ? a.pos : null; }
  if (t.kind === 'hippie') { const h = world.hippies.get(t.id); return h && h.status !== 'ko' ? h.pos : null; }
  if (t.kind === 'building') return world.buildings.get(t.id)?.pos ?? null;
  if (t.kind === 'flag') { const f = world.flags.get(t.id); return f && (f.state === 'planted' || f.state === 'loose') ? f.pos : null; }
  const p = world.pieces.get(t.id); return p ? piecePosition(world, p) ?? null : null;
}

function target(world: World, b: BossState): BossTarget | null {
  const altar = bossFocusAltar(world);
  b.focusFaction = altar && altar.faction >= 0 ? altar.faction as FactionId : null;
  if (b.retaliateId !== null && world.time < b.retaliateUntil) {
    const t: BossTarget = { kind: 'avatar', id: b.retaliateId };
    if (bossTargetPosition(world, t)) return t;
  } else b.retaliateId = null;
  // Once a boundary blocks us, eat its real supporting flags instead of stepping across.
  if (b.barrier && bossLoopEdges(world).includes(b.barrier.edge)) {
    const flags = barrierFlags(world, b.barrier.edge).sort((a, c) => distance(a.pos, b.pos) - distance(c.pos, b.pos) || a.id - c.id);
    if (flags[0]) return { kind: 'flag', id: flags[0].id };
  }
  // A nearby body is a brief opportunity, not a new long-range strategic priority.
  let nearest: BossTarget | null = null, best = SWIPE_REACH - 0.5;
  for (const a of world.avatars.values()) {
    if (a.koUntil || !world.factions[a.faction].alive || a.pos.y > 12) continue;
    const d = distance(a.pos, b.pos); if (d < best) { best = d; nearest = { kind: 'avatar', id: a.id }; }
  }
  for (const h of world.hippies.values()) {
    if (h.status === 'ko' || (h.airborne?.y ?? 0) > 12) continue;
    const d = distance(h.pos, b.pos); if (d < best) { best = d; nearest = { kind: 'hippie', id: h.id }; }
  }
  if (nearest && world.time >= b.nextAttackAt) return nearest;
  // Eat structures directly in our path; avoid wandering away from the CMI altar.
  if (altar) {
    let obstacle: BossTarget | null = null, gap = GRAB_REACH - 0.5;
    for (const s of world.buildings.values()) {
      if (s.id === altar.id || s.kind === 'hearth' || s.gcc && s.gcc.destroyedUntil > world.time) continue;
      const d = distance(s.pos, b.pos);
      if (d < gap && distToSegment(s.pos.x, s.pos.z, b.pos.x, b.pos.z, altar.pos.x, altar.pos.z) < 3) { gap = d; obstacle = { kind: 'building', id: s.id }; }
    }
    for (const p of world.pieces.values()) {
      const at = piecePosition(world, p); if (!at) continue;
      const d = distance(at, b.pos);
      if (d < gap && distToSegment(at.x, at.z, b.pos.x, b.pos.z, altar.pos.x, altar.pos.z) < 3) { gap = d; obstacle = { kind: 'piece', id: p.id }; }
    }
    if (obstacle) return obstacle;
    return { kind: 'building', id: altar.id };
  }
  return nearest;
}

export function updateBoss(world: World, dt: number): void {
  const b = spawnBoss(world);
  if (!b || world.phase !== 'playing') return;
  if (b.hp <= 0) {
    if (b.deathAt === null) { b.deathAt = world.time; action(world, b, 'death'); }
    if (world.time - b.deathAt >= BOSS_DEATH_DURATION) action(world, b, 'dead');
    return;
  }
  const age = world.time - b.actionAt + 1e-9;
  if (b.action === 'emerge') { if (age >= BOSS_TIMING.emerge) action(world, b, 'idle'); return; }
  if (b.action === 'crouch' || b.action === 'rise') {
    if (age >= BOSS_TIMING.transition) { b.crouched = b.action === 'crouch'; action(world, b, 'idle'); }
    return;
  }
  if (b.action === 'swipe' || b.action === 'stomp' || b.action === 'grab') {
    const hitAt = b.action === 'swipe' ? BOSS_TIMING.swipeHit : b.action === 'stomp' ? BOSS_TIMING.stompHit : BOSS_TIMING.consume;
    if (b.action === 'grab' && age >= BOSS_TIMING.grasp && age < BOSS_TIMING.consume && !b.held) holdTarget(world, b);
    if (age >= hitAt && b.hitSeq !== b.actionSeq) {
      b.hitSeq = b.actionSeq;
      if (b.action === 'swipe') swipe(world, b);
      else if (b.action === 'stomp') stomp(world, b);
      else consumeTarget(world, b);
    }
    if (age >= BOSS_TIMING[b.action]) { b.nextAttackAt = world.time + 0.55; action(world, b, 'idle'); }
    return;
  }
  b.target = target(world, b);
  const at = bossTargetPosition(world, b.target);
  if (!at || !b.target) { action(world, b, 'idle'); return; }
  const d = distance(at, b.pos), isUnit = b.target.kind === 'avatar' || b.target.kind === 'hippie';
  face(b, at, dt);
  // Stomp a body beneath a standing foot; wider targets get the crouched hand sweep.
  if (isUnit && d < 4.2 && !b.crouched && world.time >= b.nextAttackAt) { action(world, b, 'stomp'); return; }
  const wantCrouch = d < 15;
  if (wantCrouch !== b.crouched) { action(world, b, wantCrouch ? 'crouch' : 'rise'); return; }
  const reach = isUnit ? SWIPE_REACH : GRAB_REACH;
  if (d <= reach && world.time >= b.nextAttackAt) {
    // A small loop must still protect its altar even when a long hand could reach across
    // from outside. The giant exposes and eats the contacted boundary before reaching in.
    const field = sweepBossLoops(world, b.pos, at, 0.05);
    const eatingThisBoundary = field && b.target.kind === 'flag' && barrierFlags(world, field.edge).some(f => f.id === b.target!.id);
    if (field && !eatingThisBoundary) {
      b.barrier = { edge: field.edge, faction: field.faction, x: field.x, z: field.z, at: world.time };
      const flags = barrierFlags(world, field.edge).sort((a, c) => distance(a.pos, b.pos) - distance(c.pos, b.pos));
      if (flags[0]) b.target = { kind: 'flag', id: flags[0].id };
      action(world, b, 'idle'); return;
    }
    action(world, b, isUnit ? 'swipe' : 'grab'); return;
  }
  if (d <= reach) { action(world, b, 'idle'); return; }
  const speed = b.crouched ? CROUCH_SPEED : WALK_SPEED;
  const len = Math.min(speed * dt, Math.max(0, d - reach + 0.2));
  const lim = MAP_HALF - BOSS_RADIUS;
  const next = { x: clamp(b.pos.x + (at.x - b.pos.x) / d * len, -lim, lim), z: clamp(b.pos.z + (at.z - b.pos.z) / d * len, -lim, lim) };
  const old = { ...b.pos }, hit = sweepBossLoops(world, old, next);
  if (hit) {
    const t = Math.max(0, hit.fraction - 0.0001);
    b.pos.x += (next.x - old.x) * t; b.pos.z += (next.z - old.z) * t;
    b.barrier = { edge: hit.edge, faction: hit.faction, x: hit.x, z: hit.z, at: world.time };
    // Implied endpoints can be sustained by real flags beyond arm's reach. Follow the
    // outside of the field toward those flags; every alternative is swept too, so corners,
    // nested loops and a topology edit cannot turn steering into a teleport.
    if (b.target.kind === 'flag' && d > GRAB_REACH && hit.fraction < 0.1) {
      const desired = Math.atan2(at.x - b.pos.x, at.z - b.pos.z);
      let alternative: V2 | null = null, score = Infinity;
      for (let turn = 15; turn <= 150; turn += 15) for (const side of [-1, 1]) {
        const yaw = desired + side * turn * Math.PI / 180;
        const trial = { x: clamp(b.pos.x + Math.sin(yaw) * len, -lim, lim), z: clamp(b.pos.z + Math.cos(yaw) * len, -lim, lim) };
        if (sweepBossLoops(world, b.pos, trial)) continue;
        const cost = distance(trial, at) + turn * 0.0001;
        if (cost < score) { score = cost; alternative = trial; }
      }
      if (alternative) { b.pos.x = alternative.x; b.pos.z = alternative.z; }
    }
  } else {
    b.pos.x = next.x; b.pos.z = next.z;
    if (b.barrier && !bossLoopEdges(world).includes(b.barrier.edge)) b.barrier = null;
  }
  const traveled = distance(old, b.pos);
  b.stride += traveled;
  action(world, b, b.crouched ? 'crouchWalk' : 'walk');
  if (traveled > 1e-6) crushStep(world, b, old);
}

function holdTarget(world: World, b: BossState): void {
  const t = b.target, pos = bossTargetPosition(world, t);
  if (!t || !pos || distance(pos, b.pos) > GRAB_REACH + 0.5) return;
  if (t.kind !== 'flag' && !attackReaches(world, b, pos)) return;
  let faction: Owner = -1;
  if (t.kind === 'flag') faction = world.flags.get(t.id)?.owner ?? -1;
  else if (t.kind === 'building') faction = world.buildings.get(t.id)?.faction ?? -1;
  else if (t.kind === 'piece') faction = world.pieces.get(t.id)?.faction ?? -1;
  b.held = { ...t, faction, x: pos.x, z: pos.z };
}

function consumeTarget(world: World, b: BossState): void {
  if (!b.held) holdTarget(world, b); // safe when a diagnostic skips directly over the grasp frame
  const t = b.held;
  if (!t) return;
  if (t.kind === 'flag') consumeFlag(world, t.id);
  else if (t.kind === 'piece') { const p = world.pieces.get(t.id); if (p) destroyPiece(world, p); }
  else if (t.kind === 'building') {
    const building = world.buildings.get(t.id);
    if (building) consumeBuilding(world, building);
  }
  // Keep the held cue until the animation finishes swallowing.
}

export function consumeFlag(world: World, id: EntityId): void {
  destroyFlag(world, id);
}

export function consumeBuilding(world: World, building: Building): void {
  if (world.buildings.get(building.id) !== building) return;
  for (const f of [...world.flags.values()]) if (f.holder === building.id) consumeFlag(world, f.id);
  world.buildings.delete(building.id);
  registerBuildingShape(world, building);
  for (const av of world.avatars.values()) if (av.pushing === building.id) av.pushing = -1;
  if (building.faction >= 0) {
    const fac = world.factions[building.faction];
    if (building.kind === 'hearth') {
      fac.hearthIds = fac.hearthIds.filter(id => id !== building.id && world.buildings.has(id));
      if (fac.hearthIds.length === 0) eliminateByBoss(world, fac.id);
      else world.emit({ t: 'notify', faction: fac.id, text: 'The giant swallowed an altar. Your remaining altars keep your camp alive.', severity: 'danger' });
    }
    if (fac.gccId === building.id) fac.gccId = null;
  }
  world.emit({ t: 'buildingDisabled', buildingId: building.id, kind: building.kind, faction: building.faction, pos: { ...building.pos } });
}

function inSwipe(b: BossState, p: V2): boolean {
  const dx = p.x - b.pos.x, dz = p.z - b.pos.z, d = Math.hypot(dx, dz);
  return d <= SWIPE_REACH && (d < 2 || (dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)) / d >= -0.25);
}
function launch(world: World, b: BossState, id: number): void {
  const h = world.hippies.get(id), av = world.avatars.get(id), unit = h ?? av;
  if (!unit) return;
  const d = Math.hypot(unit.pos.x - b.pos.x, unit.pos.z - b.pos.z);
  const dx = d > 1e-6 ? (unit.pos.x - b.pos.x) / d : Math.sin(b.yaw);
  const dz = d > 1e-6 ? (unit.pos.z - b.pos.z) / d : Math.cos(b.yaw);
  // Even a knockout gets launched. KO teardown happens before this impulse, so it
  // cannot zero the velocity and leave a fatal swipe's victim stuck under the hand.
  unit.vel.x = dx * 30; unit.vel.z = dz * 30;
  if (h) {
    h.airborne = { y: h.airborne?.y ?? 0, vy: 15 };
    applyEffect(world, h, 'knockback', 2.2, 30, b.id);
  }
  if (av) { av.vel.y = 12; av.onGround = false; applyEffect(world, av, 'knockback', 1.6, 30, b.id); }
}

/** Recheck barriers at impact: a loop completed during the wind-up is already protective. */
function attackReaches(world: World, b: BossState, pos: V2): boolean {
  const hit = sweepBossLoops(world, b.pos, pos, .05);
  if (!hit) return true;
  b.barrier = { edge: hit.edge, faction: hit.faction, x: hit.x, z: hit.z, at: world.time };
  return false;
}
function swipe(world: World, b: BossState): void {
  for (const av of world.avatars.values()) if (!av.koUntil && av.pos.y < 12 && inSwipe(b, av.pos) && attackReaches(world, b, av.pos)) {
    damageEntity(world, av.id, SWIPE_DAMAGE, b.id); launch(world, b, av.id);
  }
  for (const h of world.hippies.values()) if (h.status !== 'ko' && (h.airborne?.y ?? 0) < 12 && inSwipe(b, h.pos) && attackReaches(world, b, h.pos)) {
    damageEntity(world, h.id, SWIPE_DAMAGE, b.id); launch(world, b, h.id);
  }
  for (const s of [...world.buildings.values()]) if (inSwipe(b, s.pos) && attackReaches(world, b, s.pos)) damageEntity(world, s.id, 110, b.id);
  for (const p of [...world.pieces.values()]) { const at = piecePosition(world, p); if (at && inSwipe(b, at) && attackReaches(world, b, at)) damageEntity(world, p.id, 150, b.id); }
}
function stomp(world: World, b: BossState): void {
  for (const av of world.avatars.values()) if (!av.koUntil && av.pos.y < 2.8 && distance(av.pos, b.pos) <= STOMP_RADIUS && attackReaches(world, b, av.pos)) damageEntity(world, av.id, STOMP_DAMAGE, b.id);
  for (const h of world.hippies.values()) if (h.status !== 'ko' && (h.airborne?.y ?? 0) < 2.8 && distance(h.pos, b.pos) <= STOMP_RADIUS && attackReaches(world, b, h.pos)) damageEntity(world, h.id, STOMP_DAMAGE, b.id);
  crushObjects(world, b, b.pos, STOMP_RADIUS);
}
function crushObjects(world: World, b: BossState, at: V2, radius: number): void {
  for (const s of [...world.buildings.values()]) if (distance(s.pos, at) < radius + BUILDINGS[s.kind].radius && attackReaches(world, b, s.pos)) {
    if (s.kind === 'hearth') damageEntity(world, s.id, 250, b.id);
    else consumeBuilding(world, s);
  }
  for (const p of [...world.pieces.values()]) { const pos = piecePosition(world, p); if (pos && distance(pos, at) < radius + 1.5 && attackReaches(world, b, pos)) destroyPiece(world, p); }
  // Boundary flags are dismantled by the grab/eat action; foot impacts cannot bypass a field.
  const protectedIds = new Set<number>();
  for (const edge of bossLoopEdges(world)) for (const f of barrierFlags(world, edge)) protectedIds.add(f.id);
  for (const f of [...world.flags.values()]) if ((f.state === 'planted' || f.state === 'loose') && !protectedIds.has(f.id) && distance(f.pos, at) <= radius) consumeFlag(world, f.id);
}
function crushStep(world: World, b: BossState, from: V2): void {
  // Swept feet, not a render callback: no tunnelling or frame-rate-dependent damage.
  for (const av of world.avatars.values()) if (!av.koUntil && av.pos.y < 1.7 && distToSegment(av.pos.x, av.pos.z, from.x, from.z, b.pos.x, b.pos.z) < 1.65) damageEntity(world, av.id, STOMP_DAMAGE, b.id);
  for (const h of world.hippies.values()) if (h.status !== 'ko' && (h.airborne?.y ?? 0) < 1.7 && distToSegment(h.pos.x, h.pos.z, from.x, from.z, b.pos.x, b.pos.z) < 1.65) damageEntity(world, h.id, STOMP_DAMAGE, b.id);
  // Object crushes are sampled at a small fixed travel interval, not every simulation tick.
  const oldStep = Math.floor((b.stride - distance(from, b.pos)) / 1.2), newStep = Math.floor(b.stride / 1.2);
  if (newStep > oldStep) crushObjects(world, b, b.pos, 1.55);
}
