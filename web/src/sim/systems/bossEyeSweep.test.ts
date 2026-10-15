import { groundHeight } from '../terrain';
import { describe, expect, it } from 'vitest';
import { HIPPIE } from '../constants';
import { BOSS_EYE_TIMING } from '../boss';
import { spawnBuilding, spawnFlag, spawnHippie } from '../factory';
import type { Obstacle } from '../map/mapgen';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { spawnBoss } from './boss';
import { blastBossEye, updateBossEye } from './boss/eye';
import { chooseBossEyeTarget, planBossEyeSweep } from './boss/eyeTargeting';
import { bossSceneryBrightness } from './boss/sceneryBrightness';
import { destroySceneryBlast } from './scenery';

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture() {
  const world = createMatch({ seed: 'eye-sweep', mode: 'standard', difficulty: 'normal', humans: [0, 1] });
  world.time = 100; world.effigyRevealedAt = 100;
  const template = world.map.obstacles.find(o => o.kind === 'porta')!, validIds = world.map.obstacles.filter(o => o.kind !== 'effigy').slice(0, 3).map(o => o.id);
  world.map.obstacles = []; world.collision = new CollisionWorld();
  world.buildings.clear(); world.pieces.clear(); world.hippies.clear(); world.flags.clear(); world.projectiles.clear();
  for (const a of world.avatars.values()) { a.pos = { x: 120, y: 0, z: 110 }; a.carried = []; }
  const boss = spawnBoss(world)!; boss.action = 'idle'; boss.pos = { x: 0, z: 0 }; boss.yaw = 0;
  const prop = (id: number, x: number, z: number, extra: Partial<Obstacle> = {}): Obstacle =>
    ({ ...template, id, x, z, kind: 'porta', shape: 'box', hx: .5, hz: .5, radius: Math.SQRT1_2, height: 3, yaw: 0, ...extra });
  return { world, boss, prop, validIds };
}
function start(e: ReturnType<typeof fixture>, route = [{ x: -30, y: 0, z: 40 }, { x: 30, y: 0, z: 40 }]) {
  Object.assign(e.boss.eye, { chargeAt: 127, firedAt: 130, nextFireAt: 160, target: { ...route[0] }, route, sample: -1 });
  e.world.time = 130; updateBossEye(e.world, e.boss, 1 / 60); e.world.drainEvents();
}

describe('continuous authoritative eye sweep', () => {
  it.each([1 / 60, 1 / 30, .2, 1, 5])('covers the same route and damages each target once at dt=%s', dt => {
    const e = fixture(), { world, boss } = e;
    const targets = [-29, -17.3, 0, 13.13, 29].map(x => { const h = spawnHippie(world, -1, { x, z: 40 }); h.hp = 2500; return h; });
    const altar = spawnBuilding(world, 'hearth', 0, 0, 1); altar.pos = { x: 0, z: 40 }; altar.hp = 1;
    const flag = spawnFlag(world, { owner: 1, state: 'loose', pos: { x: 4, y: 0, z: 40 } });
    start(e, [{ x: -30, y: 0, z: 40 }, { x: 30, y: 0, z: 40 }, { x: -30, y: 0, z: 40 }]);
    for (let at = Math.min(dt, 5); ; at = Math.min(at + dt, 5)) {
      world.time = 130 + at; updateBossEye(world, boss, dt); if (at >= 5) break;
    }
    for (const h of targets) expect(h.hp).toBe(1500);
    expect(world.buildings.get(altar.id)).toBe(altar); expect(altar.hp).toBe(1);
    expect(world.flags.get(flag.id)).toMatchObject({ state: 'loose', owner: 1, holder: -1 });
    expect(boss.eye.firedAt).toBeNull(); expect(boss.eye.nextFireAt).toBe(160);
  });

  it('catches a grazing target between two contact positions without inflating the radius', () => {
    const { world, boss } = fixture(); boss.eye.firedAt = 130;
    const on = spawnHippie(world, -1, { x: 0, z: 5 + HIPPIE.radius }), outside = spawnHippie(world, -1, { x: 0, z: 5 + HIPPIE.radius + .001 });
    // HIPPIE.radius is .4; the two endpoint spheres miss this tangent body.
    blastBossEye(world, boss, { x: 2, y: 2.9, z: 0 }, { x: -2, y: 2.9, z: 0 });
    expect(on.hp).toBe(0); expect(outside.hp).toBeGreaterThan(0);
  });

  it('allows newcomers into a sustained impact, but never damages a surviving re-entry twice', () => {
    const e = fixture(), at = { x: 0, y: 0, z: 40 };
    start(e, [at]);
    const h = spawnHippie(e.world, -1, at); h.hp = 2500;
    e.world.time = 131; updateBossEye(e.world, e.boss, 1); expect(h.hp).toBe(1500);
    h.pos.x = 70; e.world.time = 132; updateBossEye(e.world, e.boss, 1);
    h.pos.x = 0; e.world.time = 134.99; updateBossEye(e.world, e.boss, 2.99); expect(h.hp).toBe(1500);
    expect(e.world.drainEvents().filter(v => v.t === 'hit' && v.target === h.id)).toHaveLength(1);
  });

  it('keeps route, sample and hit ledgers durable on live mirrors and mid-beam late joins', () => {
    const e = fixture(), { world, boss } = e;
    const h = spawnHippie(world, -1, { x: 0, z: 40 }); h.hp = 2500;
    start(e); const encoder = new SnapshotEncoder(world), peer = NetMirror.create(world.options, wire(encoder.full()));
    world.time = 132.5; world.tick++; updateBossEye(world, boss, 2.5);
    const frame = wire({ tick: world.tick, time: world.time, acks: {}, delta: encoder.delta([]), events: [] });
    peer.push(frame); peer.catchUp(); peer.push(frame); peer.catchUp();
    const late = NetMirror.create(world.options, wire(encoder.full()));
    for (const p of [peer, late]) {
      expect(p.world.boss!.eye.sample).toBe(150); expect(p.world.boss!.eye.damaged).toContain(h.id);
      expect(p.world.boss!.eye.route).toEqual(boss.eye.route); expect(p.world.hippies.get(h.id)?.hp).toBe(1500);
      expect(p.world.drainEvents()).toEqual([]);
    }
    // Restoring authoritative state also preserves the once-per-beam ledger.
    late.world.time = 133; updateBossEye(late.world, late.world.boss!, .5);
    expect(late.world.hippies.get(h.id)?.hp).toBe(1500);
  });

  it('does not join a vanished foreground surface to a distant impact through intervening bodies', () => {
    const e = fixture(); start(e, [{ x: 0, y: 0, z: 100 }]);
    const h = spawnHippie(e.world, -1, { x: 0, z: 50 });
    e.boss.eye.impact = { x: 0, y: 0, z: 10 }; e.boss.eye.impactTag = -999;
    e.world.time += 1 / 60; updateBossEye(e.world, e.boss, 1 / 60);
    expect(e.boss.eye.impactTag).toBe(0); expect(h.hp).toBeGreaterThan(0);
  });
});

describe('beam scenery blast and bright preferences', () => {
  it.each(['tent', 'dome', 'art', 'porta', 'tree', 'rock', 'stage', 'shade', 'car'] as const)('destroys %s collateral, refreshes once, and preserves distant props/effigy/altars', kind => {
    const { world, prop, validIds: [id, far, effigy] } = fixture();
    world.map.obstacles = [prop(id, 0, 0, { kind }), prop(far, 20, 0, { kind }), prop(effigy, 0, 0, { kind: 'effigy' })];
    world.collision = CollisionWorld.fromMap(world.map);
    const altar = spawnBuilding(world, 'hearth', 0, 0, 1); altar.pos = { x: 0, z: 0 }; altar.hp = 1;
    const version = world.nav.version;
    expect(destroySceneryBlast(world, { x: 0, y: 2, z: 0 }, 5)).toBe(1);
    expect([...world.destroyedScenery]).toEqual([id]); expect(world.nav.version).toBe(version + 1);
    expect(destroySceneryBlast(world, { x: 0, y: 2, z: 0 }, 5)).toBe(0); expect(world.nav.version).toBe(version + 1);
    expect(world.buildings.get(altar.id)).toBe(altar); expect(altar.hp).toBe(1);
    const peer = NetMirror.create(world.options, wire(new SnapshotEncoder(world).full()));
    expect([...peer.world.destroyedScenery]).toEqual([id]);
  });

  it('uses inclusive sphere/capsule boundaries, height and exact rotated boxes', () => {
    const { world, prop } = fixture();
    world.map.obstacles = [prop(10000, 6, 0, { shape: 'circle', radius: 1 }), prop(10001, -6.001, 0, { shape: 'circle', radius: 1 }),
      prop(10002, 0, 0, { height: 3 }), prop(10003, 0, 7, { hx: 2, hz: .1, yaw: Math.PI / 2 })];
    expect(destroySceneryBlast(world, { x: 0, y: 10.001, z: 0 }, 5)).toBe(0);
    expect(destroySceneryBlast(world, { x: 0, y: 10, z: 0 }, 5)).toBe(1);
    expect(destroySceneryBlast(world, { x: 0, y: 2, z: 0 }, 5)).toBe(2);
    expect([...world.destroyedScenery]).toEqual([10002, 10000, 10003]);
  });

  it('ranks actual rainbow/LED variants first, then strongly lit scenery and ordinary strategic targets', () => {
    const { world, boss, prop } = fixture();
    const rainbow = prop(10000, -45, 40, { kind: 'art', variant: 1, height: 12 });
    const totem = prop(10001, 45, 40, { kind: 'art', variant: 4, height: 12 });
    const stage = prop(10002, 0, 30, { kind: 'stage', height: 8 });
    const pinwheel = prop(10003, 0, 20, { kind: 'art', variant: 3 });
    world.map.obstacles = [rainbow, totem, stage, pinwheel];
    for (let i = 0; i < 10; i++) spawnHippie(world, -1, { x: 0, z: 40 + i * .1 });
    expect(bossSceneryBrightness(rainbow)).toBe(3); expect(bossSceneryBrightness(pinwheel)).toBe(0);
    expect(bossSceneryBrightness(prop(9, 0, 0, { kind: 'car', variant: 2 }))).toBe(3);
    const target = chooseBossEyeTarget(world, boss)!; expect(target).toEqual({ x: -45, y: groundHeight(-45,40,world.map.half) + 6, z: 40 });
    const route = planBossEyeSweep(world, boss, target); expect(route.length).toBeGreaterThanOrEqual(3);
    expect(route[1]).toEqual({ x: 45, y: groundHeight(45,40,world.map.half) + 6, z: 40 });
    world.destroyedScenery.add(rainbow.id); world.destroyedScenery.add(totem.id);
    expect(chooseBossEyeTarget(world, boss)).toEqual({ x: 0, y: groundHeight(0,30,world.map.half) + 4, z: 30 });
    expect(BOSS_EYE_TIMING).toEqual({ period: 30, charge: 3, beam: 5 });
  });
});
