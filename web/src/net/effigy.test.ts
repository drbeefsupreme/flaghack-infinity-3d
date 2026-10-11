import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../sim/constants';
import { EFFIGY_POLE_CONSUMED_AT, bossRevealTime } from '../sim/effigyBurn';
import { burnTime, normalizeMatch } from '../sim/matchSettings';
import { spawnPiece } from '../sim/factory';
import { moveBuilding } from '../sim/systems/buildings';
import { updateEffigy } from '../sim/systems/effigy';
import { attachPiece } from '../sim/systems/pieces';
import { createMatch } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import type { World } from '../sim/world';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';

function collisionState(world: World) {
  return {
    pole: world.collision.blockedCircle(0, 0, 0.3, 10, 12),
    plinth: world.collision.blockedCircle(2, 0, 0.3, 2.2, 4),
    support: world.collision.supportHeight(0, 0, 40),
    ray: world.collision.raycast(0, 40, 0, 0, -1, 0, 50)?.y,
    map: world.map.isBlockedAt(0, 0),
    path: world.nav.findPath(-10, 0, 10, 0),
    lattice: world.lattice.nodes[world.lattice.omegaNode].blocked,
    buildings: [...world.buildings.values()].map((b) => [b.id,
      world.collision.raycast(b.pos.x, 40, b.pos.z, 0, -1, 0, 50)?.tag]),
  };
}

describe('effigy pole collision replication', () => {
  it('derives pole-only removal from frames and late-join snapshots without transition events', () => {
    const host = createMatch({ seed: 'effigy-pole-network', difficulty: 'normal', humans: [0], mode: 'standard',
      match: normalizeMatch({ bossMode: false, days: 2, dayLength: 600, maxSignifiers: 0 }) });
    const encoder = new SnapshotEncoder(host);
    host.suddenDeath = true;
    host.time = burnTime(host.options) + EFFIGY_POLE_CONSUMED_AT - SIM_DT / 2;
    host.tide.nextAt = Infinity;
    host.tick = 10;
    encoder.delta([]);
    const mirror = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    expect(collisionState(mirror.world)).toEqual(collisionState(host));
    expect(collisionState(mirror.world).pole).toBe(true);

    new Simulation(host).step();
    const delta = encoder.delta(host.drainEvents());
    mirror.push(JSON.parse(JSON.stringify({ tick: host.tick, time: host.time, acks: {}, delta, events: [] })));
    mirror.catchUp();
    const late = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    expect(collisionState(mirror.world)).toEqual(collisionState(host));
    expect(collisionState(late.world)).toEqual(collisionState(host));
    expect(collisionState(late.world)).toMatchObject({ pole: false, plinth: true, support: 5, ray: 5, map: true, lattice: true });
    expect(late.world.drainEvents()).toEqual([]);
  });
});


describe('boss reveal state replication', () => {
  it('replicates the exact authoritative start across frames and late joins without replaying an event', () => {
    const host = createMatch({ seed: 'boss-reveal-network', difficulty: 'normal', humans: [0], mode: 'standard',
      match: normalizeMatch({ dayLength: 300, maxSignifiers: 0 }) });
    host.suddenDeath = true;
    host.tide.nextAt = Infinity;
    host.time = bossRevealTime(host.options) - SIM_DT / 2;
    host.tick = 10;
    const encoder = new SnapshotEncoder(host);
    const mirror = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    expect(mirror.world.effigyRevealedAt).toBeNull();
    expect(collisionState(mirror.world)).toEqual(collisionState(host));
    new Simulation(host).step();
    const delta = encoder.delta(host.drainEvents());
    // Deliberately no transition event: durable state is enough.
    const frame = JSON.parse(JSON.stringify({ tick: host.tick, time: host.time, acks: {}, delta, events: [] }));
    mirror.push(frame);
    mirror.catchUp();
    const late = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    for (const peer of [mirror, late]) {
      expect(peer.world.effigyRevealedAt).toBe(230);
      expect(collisionState(peer.world)).toEqual(collisionState(host));
      expect(collisionState(peer.world)).toMatchObject({ pole: false, plinth: false, support: 2, ray: 2, map: false, lattice: false });
      expect(peer.world.nav.isWalkable(0, 0)).toBe(true);
      expect(peer.world.drainEvents()).toEqual([]);
    }
    const version = mirror.world.nav.version;
    mirror.push(frame);
    mirror.catchUp();
    host.tick++;
    host.time += 120;
    updateEffigy(host);
    mirror.push({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
    mirror.catchUp();
    expect(mirror.world.effigyRevealedAt).toBe(230);
    expect(mirror.world.nav.version).toBe(version);
    expect(collisionState(mirror.world)).toEqual(collisionState(host));
    const muchLater = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    expect(muchLater.world.effigyRevealedAt).toBe(230);
    expect(collisionState(muchLater.world)).toEqual(collisionState(host));
  });

  it('never infers a boss transition merely from a client clock or a missing host field', () => {
    const host = createMatch({ seed: 'boss-authority', difficulty: 'normal', humans: [0], mode: 'standard',
      match: normalizeMatch({ maxSignifiers: 0 }) });
    host.suddenDeath = true;
    host.time = bossRevealTime(host.options) + 100;
    // No authoritative simulation tick has recorded a reveal yet.
    const encoder = new SnapshotEncoder(host);
    const mirror = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    mirror.world.time += 1000;
    expect(mirror.world.effigyRevealedAt).toBeNull();
    expect(mirror.world.map.isBlockedAt(0, 0)).toBe(true);
    expect(mirror.world.collision.supportHeight(0, 0, 40)).toBe(28);
  });

  it('retains replicated buildings and pieces overlapping the old footprint on live frames and late joins', () => {
    const host = createMatch({ seed: 'boss-dynamic-network', difficulty: 'normal', humans: [0], mode: 'standard',
      match: normalizeMatch({ maxSignifiers: 0 }) });
    const gcc = host.gccOf(0)!;
    moveBuilding(host, gcc, 0, 0);
    const edge = host.lattice.edges[host.lattice.nodes[host.lattice.omegaNode].edges[0]];
    const piece = spawnPiece(host, 'wall', 0, edge.id, -1, 0, 0);
    attachPiece(host, piece);
    const midpoint = {
      x: (host.lattice.nodes[edge.a].x + host.lattice.nodes[edge.b].x) / 2,
      z: (host.lattice.nodes[edge.a].z + host.lattice.nodes[edge.b].z) / 2,
    };
    host.suddenDeath = true;
    host.time = bossRevealTime(host.options) - 0.001;
    const encoder = new SnapshotEncoder(host);
    const mirror = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    host.time += 0.001;
    host.tick++;
    updateEffigy(host);
    mirror.push({ tick: host.tick, time: host.time, acks: {}, delta: encoder.delta([]), events: [] });
    mirror.catchUp();
    const late = NetMirror.create(host.options, JSON.parse(JSON.stringify(encoder.full())));
    for (const world of [host, mirror.world, late.world]) {
      expect(world.effigyRevealedAt).toBe(bossRevealTime(host.options));
      expect(world.map.isBlockedAt(0, 0)).toBe(false);
      expect(world.nav.isWalkable(0, 0)).toBe(false);
      expect(world.collision.raycast(0, 40, 0, 0, -1, 0, 50)?.tag).toBe(gcc.id);
      expect(world.nav.isWalkable(midpoint.x, midpoint.z)).toBe(false);
      expect(world.collision.raycast(midpoint.x, 40, midpoint.z, 0, -1, 0, 50)?.tag).toBe(piece.id);
      expect(world.pieces.get(piece.id)?.shapeIds.length).toBeGreaterThan(0);
    }
  });
});
