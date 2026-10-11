import { describe, expect, it } from 'vitest';
import { BOSS_TIMING } from '../sim/boss';
import type { BossAction } from '../sim/boss';
import { GCC, SIM_DT } from '../sim/constants';
import { spawnBuilding, spawnFlag, spawnPiece } from '../sim/factory';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { spawnBoss, updateBoss } from '../sim/systems/boss';
import { collapseGcc, moveBuilding, registerBuildingShape, updateBuildings } from '../sim/systems/buildings';
import { econ } from '../sim/systems/econ/state';
import { updateGcc } from '../sim/systems/gcc';
import { attachPiece, pieceAt, piecePosition } from '../sim/systems/pieces';
import type { Building, BuildingKind, Piece, PieceKind } from '../sim/types';
import type { World } from '../sim/world';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
import { CODECS, encodeRow, FACTION_FIELDS, WORLD_FIELDS } from './schema';

const BUILDING_KINDS: BuildingKind[] = ['hearth', 'workshop', 'drumcircle', 'ward', 'druglab', 'gcc'];
const PIECE_KINDS: PieceKind[] = ['wall', 'floor', 'ramp'];
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type Structure = Building | Piece;
type Attack = Extract<BossAction, 'grab' | 'stomp' | 'swipe'>;

function encounter() {
  const host = createMatch({ seed: 'boss-structure-sync', difficulty: 'normal', mode: 'standard', humans: [0, 1],
    match: normalizeMatch({ maxSignifiers: 0 }) });
  host.time = 1000;
  host.effigyRevealedAt = 990;
  spawnBoss(host);
  // This matrix isolates melee/eating; periodic eye attacks have their own suite.
  host.boss!.eye.nextFireAt = Infinity;
  host.survey.edgeLey.fill(-1);
  host.survey.version++;
  for (const av of host.avatars.values()) av.pos = { x: -100, y: 0, z: -100 };
  for (const h of host.hippies.values()) h.pos = { x: -100, z: -100 };
  // Real collision/nav are retained on both host and clients. Use an empty patch of the
  // actual generated map so a removed entity cannot hide behind an unrelated blocker.
  const facet = host.lattice.facets.find(f => !f.boundary && Math.hypot(f.cx, f.cz) > 25 &&
    !host.collision.blockedCircle(f.cx, f.cz, 9, .1, 20) &&
    host.nav.blockerOnSegment(f.cx, f.cz, f.cx, f.cz) === -1)!;
  expect(facet).toBeDefined();
  return { host, facet };
}

function position(w: World, s: Structure) {
  return s.type === 'building' ? s.pos : piecePosition(w, s)!;
}

function probe(w: World, at: { x: number; z: number }) {
  return {
    hit: w.collision.raycast(at.x, 40, at.z, 0, -1, 0, 50)?.tag,
    blocked: w.collision.blockedCircle(at.x, at.z, .1, .1, 12),
    blocker: w.nav.blockerOnSegment(at.x, at.z, at.x, at.z),
  };
}

function replicas(host: World) {
  host.drainEvents();
  const encoder = new SnapshotEncoder(host);
  const peers = [NetMirror.create(host.options, wire(encoder.full())), NetMirror.create(host.options, wire(encoder.full()))];
  const lateJoin = () => {
    const late = NetMirror.create(host.options, wire(encoder.full()));
    expect(late.world.drainEvents()).toEqual([]);
    return late;
  };
  const flush = () => {
    host.tick++;
    const events = host.drainEvents();
    const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta(events), events });
    for (const peer of peers) {
      peer.push(frame);
      peer.catchUp();
      expect(peer.world.drainEvents()).toEqual(frame.events);
      expect(encodeRow(WORLD_FIELDS, peer.world, peer.world)).toEqual(encodeRow(WORLD_FIELDS, host, host));
      for (const f of host.factions) {
        expect(encodeRow(FACTION_FIELDS, peer.world.factions[f.id], peer.world)).toEqual(encodeRow(FACTION_FIELDS, f, host));
      }
      const version = peer.world.nav.version;
      peer.push(frame);
      peer.catchUp();
      expect(peer.world.drainEvents()).toEqual([]);
      expect(peer.world.nav.version).toBe(version);
    }
    return frame;
  };
  return { peers, flush, lateJoin };
}

function stageAttack(w: World, s: Structure, attack: Attack) {
  const b = w.boss!, at = position(w, s);
  w.time += 5;
  Object.assign(b, { pos: { x: at.x, z: at.z - (attack === 'stomp' ? 2 : 6) }, yaw: 0,
    action: attack, actionAt: w.time, actionSeq: b.actionSeq + 1, crouched: attack !== 'stomp',
    target: { kind: s.type, id: s.id }, held: null, barrier: null });
}

function expectRemoved(w: World, s: Structure, at: { x: number; z: number }, baseline: ReturnType<typeof probe>) {
  if (s.type === 'building') {
    expect(w.buildings.has(s.id)).toBe(false);
    expect(econ(w).buildingShapes.get(s.id) ?? []).toEqual([]);
    expect(w.factions[s.faction].hearthIds).not.toContain(s.id);
    expect(w.factions[s.faction].gccId).not.toBe(s.id);
    expect([...w.flags.values()].some(f => f.holder === s.id)).toBe(false);
    expect([...w.avatars.values()].some(av => av.pushing === s.id)).toBe(false);
  } else {
    expect(w.pieces.has(s.id)).toBe(false);
    expect(pieceAt(w, s.kind, s.edge, s.facet, s.level)).toBeUndefined();
    expect(econ(w).pieceInfo.has(s.id)).toBe(false);
  }
  expect(probe(w, at)).toEqual(baseline);
}

describe('boss structure destruction replication', () => {
  it.each<Attack>(['grab', 'stomp', 'swipe'])('%s replicates structure removal while altars survive until eaten', attack => {
    const { host, facet } = encounter();
    const { peers, flush, lateJoin } = replicas(host);
    const removed: { structure: Structure; at: { x: number; z: number }; baseline: ReturnType<typeof probe> }[] = [];
    for (const kind of [...BUILDING_KINDS, ...PIECE_KINDS]) {
      const isBuilding = BUILDING_KINDS.includes(kind as BuildingKind);
      const wall = kind === 'wall';
      const edge = host.lattice.edges[facet.edges[0]];
      const nodes = [host.lattice.nodes[edge.a], host.lattice.nodes[edge.b]];
      const at = wall ? { x: (nodes[0].x + nodes[1].x) / 2, z: (nodes[0].z + nodes[1].z) / 2 }
        : { x: facet.cx, z: facet.cz };
      const baseline = probe(host, at);
      const s = isBuilding ? spawnBuilding(host, kind as BuildingKind, 0, facet.id, 1)
        : spawnPiece(host, kind as PieceKind, 0, wall ? edge.id : -1, wall ? -1 : facet.id, 0, kind === 'ramp' ? 0 : -1);
      // Eating is never damage-limited. Altars survive stomp/swipe damage; other
      // structures disappear on a stomp or an exactly lethal structural swipe.
      s.hp = s.maxHp = attack === 'swipe' ? (isBuilding ? 110 : 150) : 100000;
      if (s.type === 'building') {
        registerBuildingShape(host, s);
        spawnFlag(host, { state: 'stock', owner: 0, holder: s.id, pos: { ...s.pos, y: 0 } });
        if (s.gcc) { host.avatarOf(0).pushing = s.id; s.gcc.pushedBy = host.avatarOf(0).id; }
      } else attachPiece(host, s);
      stageAttack(host, s, attack);
      flush();
      for (const w of [host, ...peers.map(p => p.world)]) {
        expect(probe(w, at).hit).toBe(s.id);
        if (kind !== 'floor') expect(probe(w, at).blocker).toBe(s.id);
      }
      if (attack === 'grab') {
        host.time = host.boss!.actionAt + BOSS_TIMING.grasp;
        updateBoss(host, SIM_DT);
        flush();
        expect(host.boss!.held).toMatchObject({ kind: s.type, id: s.id, faction: 0 });
        if (kind === 'hearth') {
          const midGrab = lateJoin();
          expect(midGrab.world.boss!.held).toMatchObject({ kind: 'building', id: s.id });
          expect(midGrab.world.buildings.has(s.id)).toBe(true);
          peers.push(midGrab);
        }
      }
      const hitAt = attack === 'grab' ? BOSS_TIMING.consume : attack === 'stomp' ? BOSS_TIMING.stompHit : BOSS_TIMING.swipeHit;
      host.time = host.boss!.actionAt + hitAt - .001;
      updateBoss(host, SIM_DT);
      expect((s.type === 'building' ? host.buildings : host.pieces).has(s.id)).toBe(true);
      host.time = host.boss!.actionAt + hitAt;
      updateBoss(host, SIM_DT);
      updateBoss(host, SIM_DT); // Repeating the impact frame cannot repeat the deletion/events.
      let frame = flush();
      if (s.type === 'building' && s.kind === 'hearth' && attack !== 'grab') {
        expect(frame.delta.ents?.buildings?.r ?? []).not.toContain(s.id);
        expect(frame.events.some(e => e.t === 'buildingDisabled' && e.buildingId === s.id)).toBe(false);
        for (const w of [host, ...peers.map(p => p.world), lateJoin().world]) {
          expect(w.buildings.get(s.id)?.hp).toBe(attack === 'stomp' ? 100000 - 250 : 1);
          expect(w.buildings.get(s.id)?.disabled).toBe(false);
          expect(w.factions[0].hearthIds).toContain(s.id);
          expect(w.factions[0].alive).toBe(true);
          expect(w.stockOf(s.id)).toHaveLength(1);
          expect(probe(w, at)).toMatchObject({ hit: s.id, blocked: true, blocker: s.id });
        }
        // Only a subsequent swallow can free this footprint and remove ownership.
        stageAttack(host, s, 'grab');
        host.time = host.boss!.actionAt + BOSS_TIMING.consume;
        updateBoss(host, SIM_DT);
        frame = flush();
      }
      expect(frame.delta.ents?.[s.type === 'building' ? 'buildings' : 'pieces']?.r).toContain(s.id);
      expect(frame.events.filter(e => e.t === 'buildingDisabled' && e.buildingId === s.id ||
        e.t === 'pieceDestroyed' && e.pieceId === s.id)).toHaveLength(1);
      expect(frame.events.some(e => e.t === 'eliminated')).toBe(false);
      for (const w of [host, ...peers.map(p => p.world)]) {
        expectRemoved(w, s, at, baseline);
        expect(w.factions[0].alive).toBe(true); // The original owned altar still stands.
      }
      removed.push({ structure: s, at, baseline });
    }
    host.time += GCC.rebuildTime + 1;
    updateBuildings(host, SIM_DT);
    updateGcc(host, SIM_DT);
    flush();
    const late = lateJoin();
    for (const w of [host, ...peers.map(p => p.world), late.world]) {
      for (const r of removed) expectRemoved(w, r.structure, r.at, r.baseline);
    }
  });

  it('consumes disabled, unfinished and collapsed buildings and preserves the durable held cue after removal', () => {
    const { host, facet } = encounter();
    const { peers, flush, lateJoin } = replicas(host);
    const cases = [
      { kind: 'workshop' as const, built: 1, disabled: true },
      { kind: 'ward' as const, built: .1, disabled: false },
      { kind: 'gcc' as const, built: 1, disabled: false },
    ];
    for (const c of cases) {
      const baseline = probe(host, { x: facet.cx, z: facet.cz });
      const s = spawnBuilding(host, c.kind, 0, facet.id, c.built);
      s.disabled = c.disabled;
      if (s.disabled) s.hp = 0;
      if (s.gcc) collapseGcc(host, s, host.time + GCC.rebuildTime);
      else registerBuildingShape(host, s);
      stageAttack(host, s, 'grab');
      flush();
      host.time = host.boss!.actionAt + BOSS_TIMING.consume;
      updateBoss(host, SIM_DT); // Skipping the grasp tick must still capture and consume.
      flush();
      const late = lateJoin();
      for (const w of [host, ...peers.map(p => p.world), late.world]) {
        expectRemoved(w, s, s.pos, baseline);
        expect(w.boss!.held).toMatchObject({ kind: 'building', id: s.id, faction: 0 });
        expect(w.factions[0].alive).toBe(true);
      }
    }
  });

  it.each(['stomp', 'swipe'] as const)('%s leaves the final altar, stock and collision intact at high and low HP for peers and late joins', attack => {
    const { host, facet } = encounter();
    const altar = host.hearthOf(0)!;
    moveBuilding(host, altar, facet.cx, facet.cz);
    const stock = host.stockOf(altar.id).map(f => f.id);
    const { peers, flush, lateJoin } = replicas(host);
    for (const hp of [100000, 250, 110, 2, 1]) {
      altar.hp = hp;
      stageAttack(host, altar, attack);
      flush();
      const before = probe(host, altar.pos);
      host.time = host.boss!.actionAt + (attack === 'stomp' ? BOSS_TIMING.stompHit : BOSS_TIMING.swipeHit);
      updateBoss(host, SIM_DT);
      updateBoss(host, SIM_DT);
      const frame = flush();
      expect(frame.delta.ents?.buildings?.r ?? []).not.toContain(altar.id);
      expect(frame.events.some(e => e.t === 'eliminated' || e.t === 'buildingDisabled' && e.buildingId === altar.id)).toBe(false);
      for (const w of [host, ...peers.map(p => p.world), lateJoin().world]) {
        expect(w.buildings.get(altar.id)?.hp).toBe(Math.max(1, hp - (attack === 'stomp' ? 250 : 110)));
        expect(w.buildings.get(altar.id)?.disabled).toBe(false);
        expect(w.factions[0].hearthIds).toEqual([altar.id]);
        expect(w.factions[0].alive).toBe(true);
        expect(w.avatarOf(0).koUntil).toBe(0);
        expect(w.stockOf(altar.id).map(f => f.id)).toEqual(stock);
        expect(probe(w, altar.pos)).toEqual(before);
      }
    }
  });

  it('eating eliminates only when the last currently owned altar is removed and replicates teardown once', () => {
    const { host, facet } = encounter();
    const first = host.hearthOf(0)!;
    const second = spawnBuilding(host, 'hearth', 0, facet.id, 1);
    registerBuildingShape(host, second);
    const { peers, flush, lateJoin } = replicas(host);
    for (const [index, altar] of [second, first].entries()) {
      altar.hp = index === 0 ? 1 : 100000;
      stageAttack(host, altar, 'grab');
      host.time = host.boss!.actionAt + BOSS_TIMING.consume;
      updateBoss(host, SIM_DT);
      const frame = flush();
      expect(frame.events.filter(e => e.t === 'eliminated' && e.faction === 0)).toHaveLength(index);
      const late = lateJoin();
      for (const w of [host, ...peers.map(p => p.world), late.world]) {
        expect(w.buildings.has(altar.id)).toBe(false);
        expect(w.factions[0].alive).toBe(index === 0);
        expect(w.factions[0].hearthIds).toEqual(index === 0 ? [first.id] : []);
        if (index === 1) {
          expect(w.factions[0].eliminatedBy).toBeNull();
          expect(w.factions[0].gccId).toBeNull();
          expect(w.avatarOf(0).hp).toBe(0);
          expect(w.avatarOf(0).koUntil).toBe(Infinity);
        }
      }
    }
    // The host action sequence, duplicate network frame and a fresh late snapshot all
    // agree that elimination is a durable fact, not a repeated client-side effect.
    updateBoss(host, SIM_DT);
    expect(flush().events.some(e => e.t === 'eliminated')).toBe(false);
    const late = lateJoin();
    expect(CODECS.buildings.ids(late.world)).not.toContain(first.id);
    expect(late.world.factions[1].alive).toBe(true);
  });
});
