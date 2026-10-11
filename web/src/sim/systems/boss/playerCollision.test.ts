import { groundHeight } from '../../terrain';
import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../../tests/bossFixture';
import { BOSS_RADIUS, BOSS_TIMING } from '../../boss';
import { AVATAR, MAP_HALF, SIM_DT } from '../../constants';
import { normalizeMatch } from '../../matchSettings';
import { CollisionWorld } from '../../physics/collision';
import { createMatch } from '../../setup';
import { cmdSwing, stepAvatarMotion, updateAvatars } from '../avatars';
import { bossLoopEdges } from './barriers';
import { bossPlayerHull, BOSS_PLAYER_RADIUS, moveBossWithPlayerCollision } from './playerCollision';

const CONTACT = BOSS_PLAYER_RADIUS + AVATAR.radius;
function setup(loops = false) {
  const w = createMatch({ seed: 'boss-player-collision', difficulty: 'normal', humans: [0, 1], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 100; w.collision = new CollisionWorld(MAP_HALF, true);
  w.boss = bossFixture(); Object.assign(w.boss, { pos: { x: 0, z: 0 }, yaw: 0, action: 'idle',
    crouched: false, actionAt: w.time, spawnedAt: 90, deathAt: null, target: null, barrier: null });
  if (!loops) { w.survey.edgeLey.fill(-1); w.survey.version++; }
  for (const av of w.avatars.values()) av.pos = grounded({ x: 80, y: 0, z: 80 });
  return w;
}

describe('solid boss player hull', () => {
  it('blocks walking, sprinting and jumping from all eight directions in both stances', () => {
    const w = setup(), av = w.avatarOf(0);
    for (const crouched of [false, true]) for (const sprint of [false, true]) for (const jump of [false, true]) {
      w.boss!.crouched = crouched; w.boss!.action = crouched ? 'crouchWalk' : 'walk';
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const x = Math.sin(angle), z = Math.cos(angle);
        av.pos = grounded({ x: x * 9, y: 0, z: z * 9 }); av.vel = { x: 0, y: 0, z: 0 }; av.onGround = true;
        for (let i = 0; i < 120; i++) {
          stepAvatarMotion(w, av, { moveX: -x, moveZ: -z, yaw: angle + Math.PI, pitch: 0, sprint, jump: jump && i % 45 === 0 }, SIM_DT);
          expect(Math.hypot(av.pos.x, av.pos.z)).toBeGreaterThanOrEqual(CONTACT - 1e-6);
          expect(av.pos.x * x + av.pos.z * z).toBeGreaterThanOrEqual(CONTACT - 1e-6);
        }
        expect(Math.hypot(av.pos.x, av.pos.z)).toBeCloseTo(CONTACT, 5);
      }
    }
  });

  it('sweeps fast impulses and large time steps at ground, legs and torso heights', () => {
    const w = setup();
    for (const crouched of [false, true]) for (const y of (crouched ? [0, .9, 8, 18] : [0, .9, 8, 18, 25, 31])) for (const dt of [SIM_DT, .25, 1, 3]) {
      w.boss!.crouched = crouched;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const x = Math.sin(angle), z = Math.cos(angle), pos = grounded({ x: x * 12, y, z: z * 12 });
        const vel = { x: -x * 60 / dt, y: 0, z: -z * 60 / dt };
        const result = w.collision.moveCharacter(pos, vel, dt, AVATAR.radius, AVATAR.height, AVATAR.stepHeight,
          undefined, bossPlayerHull(w.boss, w.time));
        expect(result.hitWall).toBe(true);
        expect(pos.x * x + pos.z * z).toBeCloseTo(CONTACT, 5);
        expect(Math.hypot(vel.x, vel.z)).toBeLessThan(1e-8);
      }
    }
  });

  it('slides tangentially and releases immediately when moving away', () => {
    const w = setup(), av = w.avatarOf(0);
    av.pos = grounded({ x: CONTACT, y: 0, z: 0 }); av.vel = { x: 0, y: 0, z: 0 }; av.onGround = true;
    for (let i = 0; i < 60; i++) {
      stepAvatarMotion(w, av, { moveX: -.3, moveZ: 1, yaw: 0, pitch: 0, sprint: true, jump: false }, SIM_DT);
      expect(Math.hypot(av.pos.x, av.pos.z)).toBeGreaterThanOrEqual(CONTACT - 1e-6);
    }
    expect(av.pos.z).toBeGreaterThan(7);
    av.pos = grounded({ x: CONTACT, y: 0, z: 0 }); av.vel = { x: 0, y: 0, z: 0 };
    stepAvatarMotion(w, av, { moveX: 1, moveZ: 0, yaw: 0, pitch: 0, sprint: false, jump: false }, SIM_DT);
    expect(av.pos.x).toBeGreaterThan(CONTACT);
  });

  it('eases height through crouch/rise without opening a foot gap or expanding sideways', () => {
    const w = setup(), b = w.boss!;
    for (const action of ['crouch', 'rise'] as const) {
      b.action = action; b.actionAt = w.time;
      const heights = [0, .25, .5, .75, 1].map(t => bossPlayerHull(b, w.time + t * BOSS_TIMING.transition)!);
      expect(heights.map(h => h.radius)).toEqual([5.2, 5.2, 5.2, 5.2, 5.2]);
      expect(heights.map(h => h.bottom)).toEqual([2, 2, 2, 2, 2]);
      expect(heights[0].top).toBeCloseTo(2 + (action === 'crouch' ? 32 : 19.2));
      expect(heights[2].top).toBeCloseTo(27.6);
      expect(heights[4].top).toBeCloseTo(2 + (action === 'crouch' ? 19.2 : 32));
    }
    b.action = 'idle'; b.crouched = true;
    const pos = grounded({ x: -8, y: 20.2, z: 0 });
    w.collision.moveCharacter(pos, { x: 16, y: 0, z: 0 }, 1, AVATAR.radius, AVATAR.height, AVATAR.stepHeight,
      undefined, bossPlayerHull(b, w.time));
    expect(pos.x).toBeCloseTo(8); // genuinely above the crouched body
  });

  it('gradually recovers a spawn overlap without a velocity boost and never leaves a raycast hull', () => {
    const w = setup(), av = w.avatarOf(0);
    av.pos = grounded({ x: .1, y: 0, z: 0 }); av.vel = { x: 0, y: 0, z: 0 }; av.onGround = true;
    for (let i = 0; i < Math.ceil(CONTACT / .2) + 1; i++) {
      const previous = av.pos.x;
      stepAvatarMotion(w, av, { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, sprint: false, jump: false }, SIM_DT);
      expect(av.pos.x - previous).toBeLessThanOrEqual(.200001);
      expect(av.vel.x).toBe(0); expect(av.vel.z).toBe(0);
      expect(w.collision.raycast(-9, 3, 0, 1, 0, 0, 18)).toBeNull();
      expect(w.collision.blockedCircle(0, 0, .45, .5, 2)).toBe(false);
    }
    expect(av.pos.x).toBeCloseTo(CONTACT);
  });

  it('does not alter ordinary wall, ramp or ceiling movement far from the boss', () => {
    const w = setup(); w.boss!.pos = { x: 60, z: 60 };
    w.collision.addBox(3, 0, .1, 8, 0, 0, 5, 88);
    w.collision.addRamp([-2, 2, 2, -2], [-2, -2, 2, 2], 0, 1, 0, 3, .2, 89);
    w.collision.addSlab([-5, 5, 5, -5], [-5, -5, 5, 5], 5, .2, 90);
    for (const start of [{ x: 0, y: 0, z: -4 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 3, z: 0 }]) {
      const plain = { ...start }, withBoss = { ...start };
      const a = { x: 5, y: 3, z: 8 }, b = { ...a };
      for (let i = 0; i < 120; i++) {
        a.x += .03; b.x += .03; a.y -= .4; b.y -= .4;
        const expected = { ...w.collision.moveCharacter(plain, a, SIM_DT, AVATAR.radius, AVATAR.height, AVATAR.stepHeight) };
        const actual = w.collision.moveCharacter(withBoss, b, SIM_DT, AVATAR.radius, AVATAR.height, AVATAR.stepHeight,
          undefined, bossPlayerHull(w.boss, w.time));
        expect(withBoss).toEqual(plain); expect(b).toEqual(a); expect(actual).toEqual(expected);
      }
    }
  });

  it('leaves normal staff swings in reach at solid contact', () => {
    const w = setup(), av = w.avatarOf(0), b = w.boss!;
    expect(CONTACT).toBeCloseTo(5.65);
    expect(AVATAR.swingReach + BOSS_RADIUS).toBeCloseTo(6.36);
    expect(AVATAR.swingReach + BOSS_RADIUS - CONTACT).toBeCloseTo(.71);
    for (const crouched of [false, true]) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      b.crouched = crouched;
      av.pos = grounded({ x: Math.sin(angle) * CONTACT, y: 0, z: Math.cos(angle) * CONTACT });
      av.vel = { x: 0, y: 0, z: 0 }; av.action = { kind: 'idle' };
      av.input = { moveX: 0, moveZ: 0, yaw: angle + Math.PI, pitch: 0, sprint: false, jump: false };
      const hp = b.hp;
      cmdSwing(w, { t: 'swing', faction: 0 }); w.time += AVATAR.swingTime * AVATAR.swingHitAt + .001;
      updateAvatars(w, SIM_DT);
      expect(b.hp).toBe(hp - AVATAR.swingDamage);
      expect(Math.hypot(av.pos.x, av.pos.z)).toBeCloseTo(CONTACT);
    }
  });

  it('removes collision immediately on death and when the boss is removed', () => {
    const w = setup();
    for (const absent of [false, true]) {
      if (absent) w.boss = null; else w.boss!.hp = 0;
      const av = w.avatarOf(0); av.pos = grounded({ x: -5, y: 0, z: 0 }); av.vel = { x: 11.5, y: 0, z: 0 };
      stepAvatarMotion(w, av, { moveX: 1, moveZ: 0, yaw: 0, pitch: 0, sprint: true, jump: false }, 1);
      expect(av.pos.x).toBeGreaterThan(5);
    }
  });
});

describe('boss driven contact', () => {
  it('sweeps a moving boss into a player from all angles without tunnelling or imparting velocity', () => {
    const w = setup(), b = w.boss!, av = w.avatarOf(0);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const x = Math.sin(angle), z = Math.cos(angle);
      av.pos = grounded({ x: 0, y: 0, z: 0 }); av.vel = { x: 0, y: 0, z: 0 };
      const end = moveBossWithPlayerCollision(w, b, { x: -x * 10, z: -z * 10 }, { x: x * 10, z: z * 10 });
      expect(end.x).toBeCloseTo(x * 10); expect(end.z).toBeCloseTo(z * 10);
      expect(av.pos.x * x + av.pos.z * z).toBeCloseTo(10 + CONTACT, 3);
      expect(av.vel).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('stops before pinning a player into scenery or across the map edge and permits escape', () => {
    const w = setup(), b = w.boss!, av = w.avatarOf(0);
    const wallZ = CONTACT + 3;
    w.collision.addBox(0, wallZ, 10, .1, 0, 0, 10, 999);
    av.pos = grounded({ x: 0, y: 0, z: CONTACT + 1 }); av.vel = { x: 0, y: 0, z: 0 };
    const end = moveBossWithPlayerCollision(w, b, { x: 0, z: 0 }, { x: 0, z: 12 });
    expect(end.z).toBeLessThan(3); expect(av.pos.z).toBeLessThanOrEqual(wallZ - .1 - AVATAR.radius + .00001);
    expect(Math.hypot(av.pos.x - end.x, av.pos.z - end.z)).toBeGreaterThanOrEqual(CONTACT - .0001);
    b.pos = end;
    for (let i = 0; i < 60; i++) stepAvatarMotion(w, av,
      { moveX: 1, moveZ: 0, yaw: 0, pitch: 0, sprint: true, jump: false }, SIM_DT);
    expect(av.pos.x).toBeGreaterThan(8);
    av.pos = grounded({ x: MAP_HALF - AVATAR.radius, y: 0, z: 30 });
    const edge = moveBossWithPlayerCollision(w, b, { x: MAP_HALF - CONTACT - 1, z: 30 }, { x: MAP_HALF, z: 30 });
    expect(edge.x).toBeLessThanOrEqual(MAP_HALF - AVATAR.radius - CONTACT + .001);
  });

  it('never shoves a player through a defended closed Ley boundary', () => {
    const w = setup(true), boss = w.boss!, av = w.avatarOf(0);
    const id = bossLoopEdges(w)[0]; expect(id).toBeDefined();
    const edge = w.lattice.edges[id], a = w.lattice.nodes[edge.a], b = w.lattice.nodes[edge.b];
    const length = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    av.pos = grounded({ x: midpoint.x - nx * .5, y: 0, z: midpoint.z - nz * .5 });
    const before = { ...av.pos }, from = { x: av.pos.x - nx * CONTACT, z: av.pos.z - nz * CONTACT };
    const result = moveBossWithPlayerCollision(w, boss, from, { x: from.x + nx * 2, z: from.z + nz * 2 });
    expect(result).toEqual(from); expect(av.pos).toEqual(before);
  });

  it('does not let KO or eliminated players pin the boss, and never shoves another player on a rejected step', () => {
    const w = setup(), b = w.boss!, av = w.avatarOf(0), other = w.avatarOf(1);
    av.pos = grounded({ x: 0, y: 0, z: 4 }); av.koUntil = w.time + 10;
    expect(moveBossWithPlayerCollision(w, b, { x: 0, z: 0 }, { x: 0, z: 8 }).z).toBe(8);
    expect(av.pos.z).toBe(4);
    av.koUntil = 0; w.factions[0].alive = false;
    expect(moveBossWithPlayerCollision(w, b, { x: 0, z: 0 }, { x: 0, z: 8 }).z).toBe(8);
    w.factions[0].alive = true; av.pos = grounded({ x: 0, y: 0, z: CONTACT }); other.pos = { ...av.pos };
    w.collision.addBox(0, CONTACT + AVATAR.radius + .1, 1, .1, 0, 0, 10, 999);
    const before = { ...av.pos };
    expect(moveBossWithPlayerCollision(w, b, { x: 0, z: 0 }, { x: 0, z: .2 })).toEqual({ x: 0, z: 0 });
    expect(av.pos).toEqual(before); expect(other.pos).toEqual(before);
  });
});

function grounded(p: { x: number; y: number; z: number }) { return { ...p, y: p.y + groundHeight(p.x, p.z, MAP_HALF) }; }
