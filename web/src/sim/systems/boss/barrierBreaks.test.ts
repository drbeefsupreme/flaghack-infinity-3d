import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../../tests/bossFixture';
import { SnapshotEncoder } from '../../../net/codec';
import { NetMirror } from '../../../net/mirror';
import { bossForcefieldContacts } from '../../../render/env/burn/boss/forcefieldContact';
import { BOSS_TIMING } from '../../boss';
import { BOSS_FORCEFIELD_CENTER_HEIGHT } from '../../bossForcefield';
import { SIM_DT } from '../../constants';
import type { EventOf } from '../../events';
import { spawnFlag } from '../../factory';
import { latticeTopology } from '../../lattice/topology';
import { normalizeMatch } from '../../matchSettings';
import { createMatch } from '../../setup';
import { groundHeight } from '../../terrain';
import type { World } from '../../world';
import { consumeFlag, updateBoss } from '../boss';
import { canPlantAt, destroyFlag, dropLoose } from '../flags';
import { loopAround, plantFresh } from '../rules/testWorld';
import { updateSurvey } from '../survey';
import { barrierFlags, bossLoopEdges } from './barriers';
import { captureBossBarrierBreak, recordBossBarrierBreak } from './barrierBreaks';
import { blastBossEye } from './eye';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const events = (w: World): EventOf<'bossBarrierShattered'>[] => w.drainEvents().filter(e => e.t === 'bossBarrierShattered');
function world() {
  const w = createMatch({ seed: 'boss-deep-audit', difficulty: 'normal', mode: 'standard', humans: [0, 1], match: normalizeMatch({ maxSignifiers: 0 }) });
  w.boss = bossFixture(); w.time = 1000; w.effigyRevealedAt = 990;
  Object.assign(w.boss, { action: 'idle', actionAt: w.time, held: null, barrier: null });
  w.boss.eye.nextFireAt = Infinity;
  return w;
}
function fixture() {
  const w = world();
  const facet = w.lattice.facets.find(f => Math.hypot(f.cx, f.cz - 85) < 30 && f.nodes.every(n => canPlantAt(w, n, 0)))!;
  const flags = plantFresh(w, 0, [...facet.nodes]); updateSurvey(w, 0);
  w.boss!.pos = { ...w.flags.get(flags[0])!.pos }; w.drainEvents();
  return { w, boss: w.boss!, facet, flags };
}

// These tests assert actual eating/beam lifecycles, not a cosmetic diff of arbitrary renders.
describe('boss-caused intact-loop shatter facts', () => {
  it('eats a supporting Flag once and waits for normal Survey refresh without altering its timing', () => {
    const { w, boss, flags } = fixture(), id = flags[0], flag = w.flags.get(id)!;
    const contacts = bossForcefieldContacts(w, boss), version = w.survey.version, before = w.survey.edgeLey.slice();
    Object.assign(boss, { action: 'grab', actionAt: w.time - BOSS_TIMING.consume, actionSeq: 20, hitSeq: 19,
      target: { kind: 'flag', id }, held: { kind: 'flag', id, faction: 0, x: flag.pos.x, z: flag.pos.z } });
    updateBoss(w, SIM_DT);
    expect(w.flags.has(id)).toBe(false); expect(w.survey.version).toBe(version); expect(w.survey.edgeLey).toEqual(before);
    expect(events(w)).toEqual([]); updateSurvey(w, 0);
    const broken = events(w); expect(broken).toHaveLength(1);
    const lost = new Set(contacts.filter(c => !bossLoopEdges(w).includes(c.edge)).map(c => c.edge));
    expect(broken[0].segments.map(s => s.edge).sort()).toEqual([...lost].sort()); expect(lost.size).toBeGreaterThanOrEqual(2);
    for (const s of broken[0].segments) {
      const c = contacts.find(c => c.edge === s.edge)!;
      expect(s.pos).toEqual({ x: c.x, y: groundHeight(c.x, c.z, w.map.half) + BOSS_FORCEFIELD_CENTER_HEIGHT, z: c.z });
      expect(s.yaw).toBe(c.yaw); expect(s.color).toBe(w.factions[0].color);
    }
    updateBoss(w, SIM_DT); updateSurvey(w, 0); expect(events(w)).toEqual([]);
  });

  it('deduplicates several eaten Flags in one tick, retaining the prebreak color and frozen geometry', () => {
    const { w, flags } = fixture(), before = bossForcefieldContacts(w, w.boss), color = w.factions[0].color;
    for (const id of flags) consumeFlag(w, id);
    w.factions[0].color = 0x123456;
    // A topology edit before the ordinary refresh must not relocate the old fragments.
    const node = w.lattice.nodes[w.lattice.edges[before[0].edge].a]; node.x += .01; w.lattice.version++;
    updateSurvey(w, 0); const broken = events(w); expect(broken).toHaveLength(1);
    const ids = broken[0].segments.map(s => s.edge); expect(new Set(ids).size).toBe(ids.length);
    for (const s of broken[0].segments) {
      const c = before.find(c => c.edge === s.edge)!;
      expect(s.color).toBe(color); expect(s.pos.x).toBe(c.x); expect(s.pos.z).toBe(c.z); expect(s.yaw).toBe(c.yaw);
    }
  });

  it('batches multiple beam knockdowns into one break while leaving Flags recoverable', () => {
    const { w, boss, flags } = fixture(); const a = { ...w.flags.get(flags[0])!.pos }, b = { ...w.flags.get(flags[1])!.pos };
    boss.eye.firedAt = w.time;
    blastBossEye(w, boss, a, b);
    expect(w.flags.get(flags[0])?.state).toBe('loose'); expect(w.flags.get(flags[1])?.state).toBe('loose');
    const broken = events(w); expect(broken).toHaveLength(1); expect(broken[0].segments.length).toBeGreaterThanOrEqual(2);
    expect(w.survey.dirty).toBe(false);
    blastBossEye(w, boss, a, b); expect(events(w)).toEqual([]);
  });

  it('gives a distant beam one bounded local segment burst, without spawning an entire remote curtain', () => {
    const { w, boss, flags } = fixture(), at = { ...w.flags.get(flags[0])!.pos };
    boss.pos = { x: 0, z: -40 }; expect(bossForcefieldContacts(w, boss)).toEqual([]);
    blastBossEye(w, boss, at); const broken = events(w); expect(broken).toHaveLength(1);
    expect(broken[0].segments).toHaveLength(1); const pos = broken[0].segments[0].pos;
    expect(Math.hypot(pos.x - at.x, pos.z - at.z)).toBeLessThan(1e-6);
  });

  it('does not burst for ordinary removal, walking away, death, or nonplanted Flags', () => {
    const { w, boss, flags } = fixture();
    boss.pos = { x: -100, z: -100 }; updateBoss(w, SIM_DT); updateSurvey(w, 0); expect(events(w)).toEqual([]);
    destroyFlag(w, flags[0]); updateSurvey(w, 0); expect(events(w)).toEqual([]);
    const loose = spawnFlag(w, { state: 'loose', owner: 0, pos: { x: 0, y: 0, z: 0 } });
    expect(captureBossBarrierBreak(w, [loose.id])).toBeNull(); consumeFlag(w, loose.id); updateSurvey(w, 0); expect(events(w)).toEqual([]);
    boss.hp = 0; boss.deathAt = w.time; updateBoss(w, SIM_DT); updateSurvey(w, 0); expect(events(w)).toEqual([]);
  });

  it('keeps actual stomp-protected loop Flags intact and emits no shatter', () => {
    const { w, boss, flags } = fixture();
    Object.assign(boss, { action: 'stomp', actionAt: w.time - BOSS_TIMING.stompHit, actionSeq: 30, hitSeq: 29 });
    updateBoss(w, SIM_DT); updateSurvey(w, 0);
    expect(flags.every(id => w.flags.get(id)?.state === 'planted')).toBe(true); expect(events(w)).toEqual([]);
  });

  it('does not turn a topology-only edit or a clock reset into a historical burst', () => {
    const { w, flags } = fixture();
    const node = w.lattice.nodes.find(n => n.edges.length === 3 && w.survey.nodeFlag[n.id] < 0 && w.lattice.flip(n.id));
    expect(node).toBeDefined(); w.survey.dirty = true; updateSurvey(w, 0); expect(events(w)).toEqual([]);
    consumeFlag(w, flags[0]); w.time = 0; updateSurvey(w, 0); expect(events(w)).toEqual([]);
  });

  it('cancels a pending break when the same barrier is reclosed before its field disappears', () => {
    const { w, flags } = fixture(), node = w.flags.get(flags[0])!.node;
    consumeFlag(w, flags[0]); plantFresh(w, 0, [node]); updateSurvey(w, 0); expect(events(w)).toEqual([]);
    consumeFlag(w, w.survey.nodeFlag[node]); updateSurvey(w, 0); const broken = events(w); expect(broken).toHaveLength(1);
    expect(broken[0].breakId).toBe(1);
  });

  it('never credits a later player-caused break to eating an unrelated planted Flag', () => {
    const { w, flags } = fixture();
    const node = w.lattice.nodes.find(n => canPlantAt(w, n.id, 0) && [...w.flags.values()].every(f => f.state !== 'planted' || Math.hypot(f.pos.x - n.x, f.pos.z - n.z) > 20))!;
    const [unrelated] = plantFresh(w, 0, [node.id]); updateSurvey(w, 0); w.drainEvents();
    consumeFlag(w, unrelated); destroyFlag(w, flags[0]); updateSurvey(w, 0); expect(events(w)).toEqual([]);
  });

  it('clears pending facts on boss death/replacement and never emits them after reviving', () => {
    const { w, boss, flags } = fixture(); consumeFlag(w, flags[0]); boss.hp = 0; updateSurvey(w, 0); expect(events(w)).toEqual([]);
    boss.hp = 100; w.survey.dirty = true; updateSurvey(w, 0); expect(events(w)).toEqual([]);
    const next = fixture(); consumeFlag(next.w, next.flags[0]); next.boss.id++; updateSurvey(next.w, 0); expect(events(next.w)).toEqual([]);
  });

  it('keeps the inner nested loop intact when an outer loop is broken', () => {
    const w = world(), inner = loopAround(w, 0, 0, 85, 10); updateSurvey(w, 0);
    const outer = loopAround(w, 0, 0, 85, 30); updateSurvey(w, 0);
    const innerEdges = inner.map((n, i) => w.lattice.edgeBetween(n, inner[(i + 1) % inner.length]));
    w.drainEvents(); const broken: EventOf<'bossBarrierShattered'>[] = [];
    for (const node of outer) {
      const id = w.survey.nodeFlag[node]; if (id < 0) continue;
      w.boss!.pos = { ...w.flags.get(id)!.pos }; consumeFlag(w, id); updateSurvey(w, 0); broken.push(...events(w));
      if (broken.length) break;
    }
    expect(broken.length).toBeGreaterThan(0);
    expect(innerEdges.every(e => bossLoopEdges(w).includes(e))).toBe(true);
    expect(broken.flatMap(e => e.segments).every(s => !innerEdges.includes(s.edge))).toBe(true);
  });

  it('uses implied parent topology and suppresses removal of a redundant real Flag', () => {
    const w = world(), lat = w.lattice, topo = latticeTopology(lat);
    let implied = -1, a = -1, b = -1;
    for (const n of lat.nodes) {
      if (Math.hypot(n.x, n.z - 85) > 30 || !canPlantAt(w, n.id, 0)) continue;
      for (let i = topo.midStart[n.id]; i < topo.midStart[n.id + 1]; i++) {
        const p = topo.midA[i], q = topo.midB[i];
        if (lat.edgeBetween(p, n.id) >= 0 && lat.edgeBetween(q, n.id) >= 0 && canPlantAt(w, p, 0) && canPlantAt(w, q, 0)) {
          implied = n.id; a = p; b = q; break;
        }
      }
      if (implied >= 0) break;
    }
    const parents = new Map([[a, -1]]), queue = [a];
    for (let i = 0; i < queue.length && !parents.has(b); i++) for (const n of lat.neighbors(queue[i])) {
      if (n === implied || parents.has(n) || !canPlantAt(w, n, 0)) continue;
      parents.set(n, queue[i]); queue.push(n);
    }
    const path: number[] = []; for (let n = b; n >= 0; n = parents.get(n)!) path.push(n);
    plantFresh(w, 0, path); updateSurvey(w, 0); const edge = lat.edgeBetween(a, implied);
    expect(bossLoopEdges(w)).toContain(edge); expect(w.survey.impliedOwner[implied]).toBe(0);
    const [redundant] = plantFresh(w, 0, [implied]); updateSurvey(w, 0); w.boss!.pos = { ...lat.nodes[implied] }; w.drainEvents();
    consumeFlag(w, redundant); updateSurvey(w, 0); expect(events(w)).toEqual([]); expect(bossLoopEdges(w)).toContain(edge);
    const supports = barrierFlags(w, edge); for (const flag of supports) consumeFlag(w, flag.id);
    updateSurvey(w, 0); const broken = events(w); expect(broken).toHaveLength(1);
    expect(broken[0].segments.some(s => s.edge === edge)).toBe(true); expect(bossLoopEdges(w)).not.toContain(edge);
  });

  it('delivers exactly once to live mirrors, with no late-join replay and fresh IDs on rebreak', () => {
    const { w, flags } = fixture(), encoder = new SnapshotEncoder(w);
    const mirrors = [NetMirror.create(w.options, wire(encoder.full())), NetMirror.create(w.options, wire(encoder.full()))];
    const node = w.flags.get(flags[0])!.node;
    consumeFlag(w, flags[0]); updateSurvey(w, 0); const facts = w.drainEvents(); w.tick++; w.time += SIM_DT;
    const frame = wire({ tick: w.tick, time: w.time, acks: {}, delta: encoder.delta(facts), events: facts });
    for (const mirror of mirrors) {
      mirror.push(frame); mirror.catchUp(); expect(mirror.world.drainEvents()).toEqual(frame.events);
      mirror.push(frame); mirror.catchUp(); expect(mirror.world.drainEvents()).toEqual([]);
    }
    const late = NetMirror.create(w.options, wire(encoder.full())); expect(late.world.drainEvents()).toEqual([]);
    expect(bossForcefieldContacts(late.world, late.world.boss).map(c => c.edge)).toEqual(bossForcefieldContacts(w, w.boss).map(c => c.edge));
    const [replacement] = plantFresh(w, 0, [node]); updateSurvey(w, 0); w.drainEvents();
    consumeFlag(w, replacement); updateSurvey(w, 0); const second = events(w); expect(second).toHaveLength(1);
    expect(second[0].breakId).toBeGreaterThan(facts.find(e => e.t === 'bossBarrierShattered')!.breakId);
  });

  it('does not compute or change Survey when capturing and recording cosmetic causal geometry', () => {
    const { w, flags } = fixture(), snapshot = { version: w.survey.version, ley: w.survey.edgeLey.slice(), holder: w.survey.holder.slice() };
    const before = captureBossBarrierBreak(w, [flags[0]]); const flag = w.flags.get(flags[0])!; dropLoose(w, flag.id, flag.pos);
    recordBossBarrierBreak(w, before);
    expect(w.survey.version).toBe(snapshot.version); expect(w.survey.edgeLey).toEqual(snapshot.ley); expect(w.survey.holder).toEqual(snapshot.holder);
    expect(events(w)).toEqual([]); updateSurvey(w, 0); expect(events(w)).toHaveLength(1);
  });
});
