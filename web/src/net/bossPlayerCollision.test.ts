import { groundHeight } from '../sim/terrain';
import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../tests/bossFixture';
import { AVATAR, MAP_HALF, SIM_DT } from '../sim/constants';
import { normalizeMatch } from '../sim/matchSettings';
import { CollisionWorld } from '../sim/physics/collision';
import { createMatch } from '../sim/setup';
import { stepAvatarMotion } from '../sim/systems/avatars';
import { BOSS_PLAYER_RADIUS, bossPlayerHull } from '../sim/systems/boss/playerCollision';
import { SnapshotEncoder } from './codec';
import { NetMirror } from './mirror';
import { AvatarPredictor } from './predict';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const input = { moveX: 1, moveZ: 0, yaw: Math.PI / 2, pitch: 0, sprint: true, jump: false };
function setup() {
  const w = createMatch({ seed: 'boss-player-net', difficulty: 'normal', humans: [0, 1], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 100; w.effigyRevealedAt = 90; w.collision = new CollisionWorld(MAP_HALF, true);
  w.boss = bossFixture(); Object.assign(w.boss, { pos: { x: 0, z: 0 }, yaw: 0, crouched: false, action: 'idle', actionAt: 95 });
  const avatar = w.avatarOf(0); avatar.pos = grounded({ x: -8, y: 0, z: 0 }); avatar.vel = { x: 0, y: 0, z: 0 };
  avatar.onGround = true;
  return w;
}

describe('network boss player collision', () => {
  it('shares exact contact across host, two predicting peers and a late joiner in both stances', () => {
    for (const crouched of [false, true]) {
      const host = setup(); host.boss!.crouched = crouched;
      const enc = new SnapshotEncoder(host), avatar = host.avatarOf(0);
      const peers = [0, 1].map(() => {
        const mirror = NetMirror.create(host.options, wire(enc.full()));
        mirror.world.collision = new CollisionWorld(MAP_HALF, true);
        mirror.setPredicted(avatar.id);
        const predict = new AvatarPredictor(mirror.world, avatar.id, 'player');
        predict.frame(mirror, 0, 1);
        return { mirror, predict };
      });
      for (let seq = 1; seq <= 120; seq++) {
        host.time += SIM_DT; host.tick++;
        stepAvatarMotion(host, avatar, input, SIM_DT);
        for (const { mirror, predict } of peers) {
          predict.tick(seq, input); predict.frame(mirror, SIM_DT, 1);
          expect(predict.predictedPos).toEqual(avatar.pos);
        }
      }
      expect(avatar.pos.x).toBeCloseTo(-BOSS_PLAYER_RADIUS - AVATAR.radius);
      expect(avatar.pos.x).toBeCloseTo(-5.65);
      enc.delta([]); // encoder snapshots reflect its most recently captured tick
      const late = NetMirror.create(host.options, wire(enc.full())); late.world.collision = new CollisionWorld(MAP_HALF, true);
      const joined = late.world.avatarOf(0);
      stepAvatarMotion(late.world, joined, input, SIM_DT);
      expect(joined.pos.x).toBeCloseTo(avatar.pos.x);
      expect(bossPlayerHull(late.world.boss, late.world.time)).toEqual(bossPlayerHull(host.boss, host.time));
    }
  });

  it('uses latest authoritative boss contact while render playback lags, and removes it on newest death/removal', () => {
    const host = setup(), avatar = host.avatarOf(0), enc = new SnapshotEncoder(host);
    const mirror = NetMirror.create(host.options, wire(enc.full())); mirror.world.collision = new CollisionWorld(MAP_HALF, true);
    const predictor = new AvatarPredictor(mirror.world, avatar.id, 'player');
    predictor.frame(mirror, 0, 1);
    // Rendering owns a separate delayed/interpolated pose; prediction must never
    // move against that instead of the newest authoritative body.
    mirror.world.boss!.pos.x = 30;
    for (let seq = 1; seq <= 120; seq++) {
      host.tick++; host.time += SIM_DT; stepAvatarMotion(host, avatar, input, SIM_DT);
      predictor.tick(seq, input); predictor.frame(mirror, SIM_DT, 1);
      expect(predictor.predictedPos).toEqual(avatar.pos);
    }
    expect(predictor.predictedPos.x).toBeCloseTo(-BOSS_PLAYER_RADIUS - AVATAR.radius);
    host.boss!.hp = 0; host.tick++; host.time += SIM_DT;
    const frame = wire({ tick: host.tick, time: host.time, acks: { player: 120 }, delta: enc.delta([]), events: [] });
    mirror.push(frame);
    expect(mirror.world.boss!.hp).toBeGreaterThan(0);
    expect(mirror.latestBoss()!.hp).toBe(0);
    predictor.frame(mirror, 0, 1); predictor.tick(121, input);
    expect(predictor.predictedPos.x).toBeGreaterThan(-BOSS_PLAYER_RADIUS - AVATAR.radius);
    expect(mirror.world.boss!.pos.x).toBe(30); // prediction restores the render-owned object
    mirror.catchUp(); expect(bossPlayerHull(mirror.world.boss, mirror.world.time)).toBeNull();
    host.boss = null; host.tick++; host.time += SIM_DT;
    mirror.push(wire({ tick: host.tick, time: host.time, acks: { player: 121 }, delta: enc.delta([]), events: [] }));
    expect(mirror.latestBoss()).toBeNull();
    mirror.catchUp(); expect(mirror.world.boss).toBeNull();
    const late = NetMirror.create(host.options, wire(enc.full()));
    expect(late.latestBoss()).toBeNull(); expect(bossPlayerHull(late.world.boss, late.world.time)).toBeNull();
  });
});

function grounded(p: { x: number; y: number; z: number }) { return { ...p, y: p.y + groundHeight(p.x, p.z, MAP_HALF) }; }
