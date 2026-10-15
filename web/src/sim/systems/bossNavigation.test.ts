import { describe, expect, it, vi } from 'vitest';
import { BOSS_RADIUS, BOSS_TIMING } from '../boss';
import { SIM_DT } from '../constants';
import { spawnBuilding, spawnHippie } from '../factory';
import { normalizeMatch } from '../matchSettings';
import { angleDiff } from '../math';
import { createMatch } from '../setup';
import type { World } from '../world';
import { BOSS_WEAVE_ANGLE, BOSS_WEAVE_STRAIGHTEN, bossFocusAltar, bossTargetPosition, consumeBuilding, spawnBoss, updateBoss } from './boss';
import { sweepBossLoops, sweepCircleSegment } from './boss/barriers';
import { moveBuilding } from './buildings';
import { damageEntity } from './combat';
import { updateSurvey } from './survey';

function encounter(loops = false) {
  const w = createMatch({ seed: 'boss-combat', difficulty: 'normal', humans: [0, 1], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 1000; w.effigyRevealedAt = 990; w.suddenDeath = true;
  const b = spawnBoss(w)!;
  Object.assign(b, { pos: { x: 0, z: 0 }, yaw: 0, action: 'idle', actionAt: w.time, nextAttackAt: 0 });
  b.eye.nextFireAt = Infinity;
  for (const av of w.avatars.values()) av.pos = { x: -105, y: 0, z: 105 };
  for (const h of w.hippies.values()) h.pos = { x: -105, z: 105 };
  if (!loops) {
    w.survey.edgeLey.fill(-1); w.survey.version++;
    for (const s of w.buildings.values()) moveBuilding(w, s, -100, -100);
  }
  w.factions[3].stats.cmi = 100000;
  b.objectiveAltarId = w.hearthOf(3)!.id;
  return { w, b, altar: w.hearthOf(3)! };
}
function step(w: World, loops = false) {
  w.time += SIM_DT; updateBoss(w, SIM_DT);
  if (loops && w.survey.dirty) updateSurvey(w, SIM_DT);
}
function facing(w: World): number {
  const b = w.boss!, at = bossTargetPosition(w, b.target)!;
  return Math.abs(angleDiff(b.yaw, Math.atan2(at.x - b.pos.x, at.z - b.pos.z)));
}

describe('boss altar approach and heading', () => {
  it('turns toward a rear altar before starting its crouched eating animation', () => {
    const { w, b, altar } = encounter(); b.crouched = true;
    moveBuilding(w, altar, 0, -6);
    step(w); expect(b.action).toBe('idle'); expect(w.buildings.has(altar.id)).toBe(true);
    let grabAt: number | null = null;
    for (let i = 0; i < 360 && w.buildings.has(altar.id); i++) {
      step(w);
      if (b.action === 'grab' && grabAt === null) {
        grabAt = w.time; expect(facing(w)).toBeLessThanOrEqual(Math.PI / 12 + 1e-9);
        expect(b.crouched).toBe(true);
      }
    }
    expect(grabAt).not.toBeNull(); expect(w.buildings.has(altar.id)).toBe(false);
    expect(w.time - grabAt!).toBeGreaterThanOrEqual(BOSS_TIMING.consume - SIM_DT);
  });

  it('hits a rear distraction then resumes the altar instead of cycling missed attacks and stances', () => {
    const { w, b, altar } = encounter(); moveBuilding(w, altar, 0, 35);
    const av = w.avatarOf(0); av.pos = { x: 0, y: 0, z: -7 }; av.hp = 100;
    let firstSwipe = 0, backwardSteps = 0;
    for (let i = 0; i < 60 * 35 && w.buildings.has(altar.id); i++) {
      const old = { ...b.pos }; step(w);
      if (b.action === 'swipe' && !firstSwipe) { firstSwipe = w.time; expect(facing(w)).toBeLessThanOrEqual(Math.PI / 12 + 1e-9); }
      const dx = b.pos.x - old.x, dz = b.pos.z - old.z;
      if (dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw) < -1e-8) backwardSteps++;
    }
    expect(firstSwipe).toBeGreaterThan(1000); expect(firstSwipe).toBeLessThan(1003);
    expect(av.koUntil).toBeGreaterThan(0); expect(backwardSteps).toBe(0);
    expect(w.buildings.has(altar.id)).toBe(false);
  });

  it('holds the settled stance and target for the complete attack cooldown', () => {
    const { w, b, altar } = encounter(); moveBuilding(w, altar, 0, 60);
    const av = w.avatarOf(0); av.pos = { x: 0, y: 0, z: -7 };
    Object.assign(b, { crouched: true, target: { kind: 'avatar', id: av.id }, yaw: Math.PI, nextAttackAt: w.time + .55 });
    for (let i = 0; i < 30; i++) { step(w); expect(b.action).toBe('idle'); expect(b.crouched).toBe(true); expect(b.target?.id).toBe(av.id); expect(b.yaw).toBe(Math.PI); }
  });

  it('turns before reversing travel for retaliation and returns to the locked altar afterward', () => {
    const { w, b, altar } = encounter(); moveBuilding(w, altar, 0, 60);
    const av = w.avatarOf(0); av.pos = { x: 0, y: 0, z: -35 };
    const start = { ...b.pos }; damageEntity(w, b.id, 1, av.id); step(w);
    expect(b.target).toEqual({ kind: 'avatar', id: av.id }); expect(b.pos).toEqual(start);
    let negativeMotion = false, returned = false, positiveMotion = false;
    for (let i = 0; i < 60 * 10; i++) {
      const old = { ...b.pos }; step(w);
      const dx = b.pos.x - old.x, dz = b.pos.z - old.z;
      expect(dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw)).toBeGreaterThanOrEqual(-1e-8);
      negativeMotion ||= dz < -1e-5;
      returned ||= b.target?.id === altar.id;
      positiveMotion ||= returned && dz > 1e-5;
    }
    expect(negativeMotion && returned && positiveMotion).toBe(true);
    expect(b.focusFaction).toBe(3);
  });

  it('eats its reached altar ahead of bystanders and can randomly choose the same faction’s other altar', () => {
    const { w, b, altar } = encounter(); moveBuilding(w, altar, 0, 6); b.crouched = true;
    const other = spawnBuilding(w, 'hearth', 3, w.lattice.facets.find(f => !f.boundary)!.id, 1);
    moveBuilding(w, other, 0, 30);
    const rival = w.hearthOf(1)!; moveBuilding(w, rival, 8, 2); w.factions[1].stats.cmi = 50000;
    const body = spawnHippie(w, 0, { x: 0, z: -5 });
    step(w); expect(b.target?.id).toBe(altar.id); expect(b.action).toBe('grab');
    vi.spyOn(w.rng, 'next').mockReturnValue(.999999);
    for (let i = 0; i < 60 * 6 && w.buildings.has(altar.id); i++) step(w);
    expect(w.buildings.has(altar.id)).toBe(false); expect(w.factions[3].alive).toBe(true);
    expect(bossFocusAltar(w)).toBeNull();
    body.status = 'ko';
    for (let i = 0; i < 60 * 25 && w.buildings.has(other.id); i++) step(w);
    expect(w.buildings.has(other.id)).toBe(false); expect(w.factions[3].alive).toBe(false);
    expect(w.buildings.has(rival.id)).toBe(true);
  });

  it('keeps its altar objective through CMI changes, then discards the old route once that altar is gone', () => {
    const { w, b } = encounter(true); w.factions[3].stats.cmi = 0; w.factions[1].stats.cmi = 100000;
    b.objectiveAltarId = w.hearthOf(1)!.id;
    for (let i = 0; i < 60 * 60 && !b.barrier; i++) step(w, true);
    expect(b.barrier).not.toBeNull();
    const oldEdge = w.lattice.edges[b.barrier!.edge], a = w.lattice.nodes[oldEdge.a], c = w.lattice.nodes[oldEdge.b];
    const first = w.buildings.get(b.objectiveAltarId!)!;
    w.factions[3].stats.cmi = 200000;
    expect(bossFocusAltar(w)).toBe(first);
    step(w, true); expect(b.focusFaction).toBe(1); expect(b.objectiveAltarId).toBe(first.id);
    consumeBuilding(w, first); b.action = 'idle'; b.nextAttackAt = 0;
    const altar = w.hearthOf(3)!; vi.spyOn(w.rng, 'next').mockReturnValue(.999999);
    expect(sweepCircleSegment(b.pos, altar.pos, a, c, BOSS_RADIUS)).toBeNull();
    step(w, true);
    expect(b.focusFaction).toBe(3); expect(b.target).toEqual({ kind: 'building', id: altar.id });
    expect(b.barrier).toBeNull();
    for (let i = 0; i < 60 * 130 && w.buildings.has(altar.id); i++) {
      const old = { ...b.pos }; step(w, true);
      if (Math.hypot(b.pos.x - old.x, b.pos.z - old.z) > 1e-7) expect(sweepBossLoops(w, old, b.pos)).toBeNull();
    }
    expect(w.buildings.has(altar.id)).toBe(false);
  });

  it('weaves about15 degrees on long routes, makes monotonic progress and straightens near the altar', () => {
    const { w, b, altar } = encounter(); moveBuilding(w, altar, 0, 100); w.map.obstacles = [];
    const sides = new Set<number>(); let maxOffset = 0, straightSteps = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const old = { ...b.pos }, before = Math.hypot(altar.pos.x - old.x, altar.pos.z - old.z);
      step(w);
      const dx = b.pos.x - old.x, dz = b.pos.z - old.z;
      if (Math.hypot(dx, dz) > 1e-7) {
        const angle = angleDiff(Math.atan2(altar.pos.x - old.x, altar.pos.z - old.z), Math.atan2(dx, dz));
        const after = Math.hypot(altar.pos.x - b.pos.x, altar.pos.z - b.pos.z);
        expect(after).toBeLessThan(before);
        if (before > BOSS_WEAVE_STRAIGHTEN) {
          expect(Math.abs(angle)).toBeCloseTo(BOSS_WEAVE_ANGLE, 8); sides.add(Math.sign(angle));
        } else { expect(Math.abs(angle)).toBeLessThan(1e-8); straightSteps++; }
        maxOffset = Math.max(maxOffset, Math.abs(b.pos.x));
      }
      if (b.action === 'grab') break;
    }
    expect([...sides].sort()).toEqual([-1, 1]); expect(maxOffset).toBeGreaterThan(1); expect(maxOffset).toBeLessThan(3.5);
    expect(straightSteps).toBeGreaterThan(30); expect(b.objectiveAltarId).toBe(altar.id);
  });

  it('stomps reachable scenery along the route without changing or chasing from the altar objective', () => {
    const { w, b, altar } = encounter(); moveBuilding(w, altar, 0, 80);
    const template = w.map.obstacles.find(o => o.kind === 'porta')!;
    w.map.obstacles = [{ ...template, id: 90001, x: 0, z: 4, shape: 'circle', radius: .5 }];
    step(w); expect(b.action).toBe('stomp'); expect(b.objectiveAltarId).toBe(altar.id); expect(b.target?.id).toBe(altar.id);
    expect(b.nextSceneryStompStride).toBe(12.8);
    for (let i = 0; i < 60 * 4; i++) step(w);
    expect(w.destroyedScenery.has(90001)).toBe(true); expect(b.pos.z).toBeGreaterThan(1);
    expect(b.objectiveAltarId).toBe(altar.id); expect(w.buildings.has(altar.id)).toBe(true);
  });
});
