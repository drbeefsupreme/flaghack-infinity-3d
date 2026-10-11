import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { BOSS_RADIUS, BOSS_TIMING } from '../boss';
import { AVATAR, SIM_DT } from '../constants';
import { spawnBuilding, spawnHippie, spawnPiece } from '../factory';
import { latticeTopology } from '../lattice/topology';
import { createMatch } from '../setup';
import { normalizeMatch } from '../matchSettings';
import { cmdAbility } from './abilities';
import { cmdGcc } from './gcc';
import { cmdSwing, updateAvatars } from './avatars';
import { barrierFlags, bossLoopEdges, sweepBossLoops } from './boss/barriers';
import { consumeFlag, updateBoss } from './boss';
import { damageEntity } from './combat';
import { canPlantAt, isBuildingCorner, pullFlag } from './flags';
import { captureHearth, updateCapture } from './capture';
import { updateSurvey } from './survey';
import { loopAround, plantFresh } from './rules/testWorld';

function world() {
  return createMatch({ seed: 'boss-deep-audit', difficulty: 'normal', mode: 'standard', humans: [0, 1],
    match: normalizeMatch({ maxSignifiers: 0 }) });
}

describe('cooperative encounter audit', () => {
  it('real staff hit frames cannot hurt or shove allied players/units, while ordinary preboss damage still applies', () => {
    const w = world();
    w.effigyRevealedAt = 230; w.time = 245; w.boss = bossFixture(); w.boss.pos = { x: 80, z: 80 };
    const a = w.avatarOf(0), ally = w.avatarOf(1);
    a.pos = { x: 0, y: 0, z: 60 }; a.input.yaw = a.yaw = 0;
    ally.pos = { x: 0, y: 0, z: 62 };
    const unit = spawnHippie(w, 1, { x: 1, z: 62 });
    cmdSwing(w, { t: 'swing', faction: 0 });
    w.time += AVATAR.swingTime * AVATAR.swingHitAt + .01;
    updateAvatars(w, SIM_DT);
    expect(ally.hp).toBe(AVATAR.maxHp);
    expect(unit.hp).toBe(100);
    expect(ally.vel.x).toBe(0); expect(ally.vel.z).toBe(0);
    expect(unit.vel).toEqual({ x: 0, z: 0 });
    expect(ally.effects.some((e) => e.kind === 'knockback')).toBe(false);
    const altar = w.hearthOf(1)!, hp = altar.hp;
    const piece = spawnPiece(w, 'wall', 1, w.lattice.edges[0].id, -1, 0, 0);
    expect(damageEntity(w, altar.id, 40, a.id)).toBe(false); expect(altar.hp).toBe(hp);
    expect(damageEntity(w, piece.id, 40, a.id)).toBe(false);
    const flag = [...w.flags.values()].find((f) => f.owner === 1 && f.state === 'planted')!;
    expect(pullFlag(w, flag.id, a.id)).toBe(true);
    altar.hearth!.stage = 'overwritten'; altar.hearth!.attacker = 0; altar.hearth!.overwriteAt = w.time - 1;
    updateCapture(w, SIM_DT); captureHearth(w, altar, 0);
    expect(altar.faction).toBe(1); expect(altar.hearth!.stage).toBe('safe');
    w.effigyRevealedAt = null;
    expect(damageEntity(w, ally.id, 25, a.id)).toBe(true);
    expect(ally.hp).toBe(AVATAR.maxHp - 25);
  });
  it('Phason cannot decohere an allied Flag after reveal but still works before the encounter', () => {
    const w = world(), lat = w.lattice;
    const node = lat.nodes.find((n) => lat.flippable(n.id) && canPlantAt(w, n.id, 1) && !isBuildingCorner(w, n.id))!;
    expect(node).toBeDefined();
    const [id] = plantFresh(w, 1, [node.id]);
    updateSurvey(w, SIM_DT);
    w.factions[0].chakras.field = 1;
    w.avatarOf(0).pos = { x: node.x, y: 0, z: node.z };
    w.time = 245; w.effigyRevealedAt = 230; w.boss = bossFixture();
    const version = lat.version;
    const command = { t: 'ability' as const, faction: 0 as const, ability: 'phason' as const,
      at: { x: node.x, z: node.z }, node: node.id };
    cmdAbility(w, command);
    expect(lat.version).toBe(version);
    expect(w.flags.get(id)?.state).toBe('planted');
    w.effigyRevealedAt = null;
    cmdAbility(w, command);
    expect(lat.version).toBeGreaterThan(version);
    expect(w.flags.get(id)?.state).toBe('loose');
  });

  it('Priority Beacon targets the boss and never asks units to attack allied camps; Dialectics refuses allies', () => {
    const w = world();
    w.time = 245; w.effigyRevealedAt = 230; w.boss = bossFixture();
    w.boss.pos = { x: 0, z: 80 };
    w.factions[0].chakras.hoist = 1;
    const allied = spawnHippie(w, 1, { x: 0, z: 50 });
    const own = spawnHippie(w, 0, { x: 0, z: 50 });
    cmdAbility(w, { t: 'ability', faction: 0, ability: 'beacon', at: allied.pos, node: -1 });
    const safe = w.takeCommands().find((c) => c.t === 'order');
    expect(safe?.t === 'order' && safe.order?.kind).not.toBe('attack');
    expect(safe?.t === 'order' && safe.order?.kind).not.toBe('pull');
    w.factions[0].cooldowns.beacon = 0;
    own.pos = { ...w.boss.pos };
    cmdAbility(w, { t: 'ability', faction: 0, ability: 'beacon', at: w.boss.pos, node: -1 });
    const bossOrder = w.takeCommands().find((c) => c.t === 'order');
    expect(bossOrder?.t === 'order' && bossOrder.order).toEqual({ kind: 'attack', target: w.boss.id });
    const gcc = w.gccOf(0)!;
    w.avatarOf(0).pos = { ...gcc.pos, y: 0 };
    cmdGcc(w, { t: 'gcc', faction: 0, action: 'dialectics', target: -1, nodes: [] });
    expect(w.avatarOf(0).action.kind).not.toBe('channel');
    expect(w.drainEvents().some((e) => e.t === 'rejected' && e.reason.includes('allied'))).toBe(true);
    expect(allied.faction).toBe(1);
  });

});

function smallAltarLoop(closed: boolean) {
  const w = world(), lat = w.lattice;
  const facet = lat.facets.find((f) => !f.thick && Math.hypot(f.cx, f.cz - 85) < 25 &&
    f.nodes.every((n) => canPlantAt(w, n, 0)))!;
  expect(facet).toBeDefined();
  const altar = spawnBuilding(w, 'hearth', 0, facet.id, 1);
  const edge = lat.edges[facet.edges[0]], a = lat.nodes[edge.a], b = lat.nodes[edge.b];
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  let nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
  if ((mid.x - facet.cx) * nx + (mid.z - facet.cz) * nz < 0) { nx = -nx; nz = -nz; }
  w.time = 245; w.effigyRevealedAt = 230; w.boss = bossFixture();
  Object.assign(w.boss, { pos: { x: mid.x + nx * (BOSS_RADIUS + .2), z: mid.z + nz * (BOSS_RADIUS + .2) },
    action: 'idle', crouched: true, actionAt: w.time, target: null, barrier: null, held: null,
    retaliateId: null, retaliateUntil: 0, nextAttackAt: 0 });
  w.factions[0].stats.cmi = 100000;
  for (const av of w.avatars.values()) av.pos = { x: -100, y: 0, z: -100 };
  if (closed) { plantFresh(w, 0, [...facet.nodes]); updateSurvey(w, SIM_DT); }
  return { w, altar, facet };
}

describe('boss barriers on actual lattice topology', () => {
  it('a small closed cycle within hand reach redirects the boss to a boundary Flag before it can eat the altar', () => {
    const { w, altar } = smallAltarLoop(true), boss = w.boss!;
    expect(Math.hypot(boss.pos.x - altar.pos.x, boss.pos.z - altar.pos.z)).toBeLessThan(8);
    expect(sweepBossLoops(w, boss.pos, boss.pos)).toBeNull(); // feet are still outside the field
    expect(sweepBossLoops(w, boss.pos, altar.pos, .05)).not.toBeNull();
    updateBoss(w, SIM_DT);
    expect(boss.barrier).not.toBeNull();
    expect(boss.target?.kind).toBe('flag');
    expect(w.buildings.has(altar.id)).toBe(true);
    const flag = boss.target!.id;
    updateBoss(w, SIM_DT);
    expect(boss.action).toBe('grab');
    w.time = boss.actionAt + BOSS_TIMING.grasp;
    updateBoss(w, SIM_DT);
    expect(boss.held?.id).toBe(flag);
    w.time = boss.actionAt + BOSS_TIMING.consume;
    updateBoss(w, SIM_DT);
    expect(w.flags.has(flag)).toBe(false);
    expect(w.buildings.has(altar.id)).toBe(true);
    expect(w.factions[0].alive).toBe(true);
  });

  it('a loop completed during the grab windup prevents the hand reaching a protected altar', () => {
    const { w, altar, facet } = smallAltarLoop(false), boss = w.boss!;
    boss.action = 'grab'; boss.actionAt = w.time; boss.actionSeq++;
    boss.target = { kind: 'building', id: altar.id };
    plantFresh(w, 0, [...facet.nodes]); updateSurvey(w, SIM_DT);
    w.time = boss.actionAt + BOSS_TIMING.grasp;
    updateBoss(w, SIM_DT);
    expect(boss.held).toBeNull();
    w.time = boss.actionAt + BOSS_TIMING.consume;
    updateBoss(w, SIM_DT);
    expect(w.buildings.has(altar.id)).toBe(true);
    expect(w.factions[0].alive).toBe(true);
  });

  it('retains and blocks inner and outer nested loops even though both surround the same Survey', () => {
    const w = world();
    const inner = loopAround(w, 0, 0, 85, 10);
    updateSurvey(w, SIM_DT);
    const outer = loopAround(w, 0, 0, 85, 30);
    updateSurvey(w, SIM_DT);
    const closed = new Set(bossLoopEdges(w));
    const loopEdges = (nodes: number[]) => nodes.map((n, i) => w.lattice.edgeBetween(n, nodes[(i + 1) % nodes.length]));
    for (const nodes of [inner, outer]) {
      const edges = loopEdges(nodes);
      expect(edges.every((e) => e >= 0 && closed.has(e))).toBe(true);
      const edge = w.lattice.edges[edges[0]], a = w.lattice.nodes[edge.a], b = w.lattice.nodes[edge.b];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const len = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      const hit = sweepBossLoops(w, { x: mx - nx, z: mz - nz }, { x: mx + nx, z: mz + nz }, .2);
      expect(hit?.edge).toBe(edge.id);
      expect(hit?.fraction).toBeCloseTo(.4);
    }
  });

  it('blocks a loop completed by an implied Flag and follows its real parent flags for consumption', () => {
    const w = world(), lat = w.lattice, topo = latticeTopology(lat);
    // Choose a genuine scale-1 midpoint, then close its two implied edges with the
    // shortest real-flag path between its parents that does not visit the midpoint.
    let implied = -1, previous = -1, next = -1;
    for (const n of lat.nodes) {
      if (Math.hypot(n.x, n.z - 85) > 30 || !canPlantAt(w, n.id, 0)) continue;
      for (let j = topo.midStart[n.id]; j < topo.midStart[n.id + 1]; j++) {
        const a = topo.midA[j], b = topo.midB[j];
        if (lat.edgeBetween(a, n.id) >= 0 && lat.edgeBetween(b, n.id) >= 0 &&
            canPlantAt(w, a, 0) && canPlantAt(w, b, 0)) {
          implied = n.id; previous = a; next = b; break;
        }
      }
      if (implied >= 0) break;
    }
    expect(implied).toBeGreaterThanOrEqual(0);
    const parents = new Map<number, number>([[previous, -1]]), queue = [previous];
    for (let i = 0; i < queue.length && !parents.has(next); i++) {
      for (const n of lat.neighbors(queue[i])) {
        if (n === implied || parents.has(n) || !canPlantAt(w, n, 0)) continue;
        parents.set(n, queue[i]); queue.push(n);
      }
    }
    expect(parents.has(next)).toBe(true);
    const path: number[] = [];
    for (let n = next; n >= 0; n = parents.get(n)!) path.push(n);
    plantFresh(w, 0, path);
    updateSurvey(w, SIM_DT);
    expect(w.survey.nodeFlag[implied]).toBe(-1);
    expect(w.survey.impliedOwner[implied]).toBe(0);
    expect(w.survey.impliedOrder[implied]).toBe(1);
    const edge = lat.edgeBetween(previous, implied);
    expect(bossLoopEdges(w)).toContain(edge);
    const supports = barrierFlags(w, edge);
    expect(supports.map((f) => f.node)).toEqual(expect.arrayContaining([previous, next]));
    expect(supports.every((f) => f.state === 'planted' && f.owner === 0)).toBe(true);
    for (const f of supports) consumeFlag(w, f.id);
    updateSurvey(w, SIM_DT);
    expect(w.survey.holder[implied]).toBe(-1);
    expect(bossLoopEdges(w)).not.toContain(edge);
  });
});
