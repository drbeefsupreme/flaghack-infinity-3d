import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { BOSS_DEATH_DURATION } from '../../sim/boss';
import { DAWN_TIME } from '../../sim/constants';
import { BOSS_NIGHT_CLOCK, BOSS_NIGHT_SETTLE_SECONDS, worldDayClock } from '../../sim/dayCycle';
import { bossRevealTime } from '../../sim/effigyBurn';
import { dayClock, endTime, normalizeMatch, UNLIMITED_DAYS } from '../../sim/matchSettings';
import type { MatchOptions } from '../../sim/types';
import { World } from '../../sim/world';
import type { RenderContext } from '../context';
import { EnvRenderer } from './envRenderer';
import { ATTRACT_CLOCK, computeDayState, createDayState } from './timeOfDay';

// Keep the real environment coordinator and scene lights; omit only geometry/assets/GL.
const { EmptyPart } = vi.hoisted(() => ({ EmptyPart: class { update() {} dispose() {} } }));
vi.mock('./burn/effigy', () => ({ Effigy: EmptyPart }));
vi.mock('./grass', () => ({ GrassField: EmptyPart }));
vi.mock('./ground', () => ({ Ground: EmptyPart }));
vi.mock('./noise', () => ({ createNoiseTexture: () => ({ dispose() {} }) }));
vi.mock('./particles', () => ({ AmbientParticles: EmptyPart }));
vi.mock('./piles/lumberPiles', () => ({ LumberPiles: EmptyPart }));
vi.mock('./props/propField', () => ({ PropField: EmptyPart }));
vi.mock('./sky', () => ({ SkyDome: EmptyPart }));

function setup(days = 1, dayLength = 1800) {
  const options: MatchOptions = { seed: 'boss-day-cycle-render', difficulty: 'normal', mode: 'standard', humans: [0],
    match: normalizeMatch({ days, dayLength, maxSignifiers: 0 }) };
  const world = new World(options);
  world.suddenDeath = true;
  world.effigyRevealedAt = bossRevealTime(options);
  world.time = world.effigyRevealedAt + 20;
  world.boss = bossFixture();
  world.boss.action = 'idle';
  world.boss.spawnedAt = world.effigyRevealedAt;
  return world;
}

const palette = (world: World) => computeDayState(worldDayClock(world), createDayState());

describe('boss encounter palette', () => {
  it.each([0, 1, 3, 5].flatMap(days => [300, 1800, 7200].map(dayLength => ({ days, dayLength }))))(
    'freezes settled night and raises the sun through death ($days days, $dayLength seconds)',
    ({ days, dayLength }) => {
      const world = setup(days, dayLength), reveal = world.effigyRevealedAt!;
      const heldClock = Math.max(BOSS_NIGHT_CLOCK, dayClock(world.options, reveal));
      const held = computeDayState(heldClock, createDayState());
      expect(held.night).toBe(1);
      for (const time of [reveal, reveal + 60, endTime(world.options), endTime(world.options) + 10 * dayLength]) {
        world.time = time;
        expect(palette(world)).toEqual(held);
      }

      const deathAt = world.time;
      world.boss!.hp = 0;
      world.boss!.deathAt = deathAt;
      world.boss!.action = 'death';
      expect(palette(world)).toEqual(held);
      world.time += 1 / 120;
      const firstFrame = palette(world);
      expect(firstFrame.sunDir.distanceTo(held.sunDir)).toBeLessThan(.001);
      expect(firstFrame.horizon.toArray().every((value, i) => Math.abs(value - held.horizon.toArray()[i]) < .001)).toBe(true);
      expect(Math.abs(firstFrame.exposure - held.exposure)).toBeLessThan(.001);

      let lastSunY = held.sunDir.y;
      let lastDaylight = held.daylight;
      for (let frame = 1; frame <= BOSS_DEATH_DURATION * 60; frame++) {
        world.time = deathAt + frame / 60;
        const day = palette(world);
        expect(day.sunDir.y).toBeGreaterThanOrEqual(lastSunY - 1e-12);
        expect(day.daylight).toBeGreaterThanOrEqual(lastDaylight - 1e-12);
        lastSunY = day.sunDir.y;
        lastDaylight = day.daylight;
      }

      world.time = deathAt + BOSS_DEATH_DURATION * .8;
      const rising = palette(world);
      expect(rising.daylight).toBeGreaterThan(.1);
      expect(rising.stars).toBeLessThan(.7);
      expect(rising.horizon.r).toBeGreaterThan(held.horizon.r * 5);
      expect(rising.clock).toBeLessThan(DAWN_TIME);
      world.time = deathAt + BOSS_DEATH_DURATION;
      const dawn = palette(world);
      expect(dawn).toEqual(computeDayState(DAWN_TIME, createDayState()));
      expect(dawn.sunDir.y).toBeGreaterThan(0);
      expect(dawn.lightIntensity).toBeGreaterThan(2);
      expect(dawn.stars).toBe(0);
    },
  );

  it('preserves ordinary day/night cycles before reveal, in normal mode, and in the tutorial', () => {
    for (const mode of ['unrevealed', 'normal', 'tutorial', 'unlimited'] as const) {
      const world = setup();
      if (mode === 'unrevealed') { world.suddenDeath = false; world.effigyRevealedAt = null; world.boss = null; }
      if (mode === 'normal') world.options.match!.bossMode = false;
      if (mode === 'tutorial') world.options.mode = 'tutorial';
      if (mode === 'unlimited') {
        world.options.match!.days = UNLIMITED_DAYS;
        world.effigyRevealedAt = null;
        world.boss = null;
      }
      for (const time of [0, 110, 600, 1200, 1799, 1800, 2500, 5400]) {
        world.time = time;
        expect(worldDayClock(world)).toBe(dayClock(world.options, time));
      }
    }
    const future = setup();
    future.time = future.effigyRevealedAt! - BOSS_NIGHT_SETTLE_SECONDS - 1;
    expect(worldDayClock(future)).toBe(dayClock(future.options, future.time));
  });

  it.each([300, 1800, 7200])('settles continuously through the five-second reveal lead-in (%s-second days)', dayLength => {
    const world = setup(0, dayLength), reveal = world.effigyRevealedAt!;
    const start = reveal - BOSS_NIGHT_SETTLE_SECONDS;
    for (const boundary of [start, reveal]) {
      world.time = boundary - .0001;
      const before = palette(world);
      world.time = boundary;
      const at = palette(world);
      world.time = boundary + .0001;
      const after = palette(world);
      expect(Math.abs(at.clock - before.clock)).toBeLessThan(.001);
      expect(Math.abs(after.clock - at.clock)).toBeLessThan(.001);
      expect(before.sunDir.distanceTo(after.sunDir)).toBeLessThan(.0001);
      expect(before.horizon.toArray().every((value, i) => Math.abs(value - after.horizon.toArray()[i]) < .0001)).toBe(true);
    }
    world.time = start;
    expect(worldDayClock(world)).toBe(dayClock(world.options, start));
    world.time = reveal;
    expect(worldDayClock(world)).toBe(Math.max(BOSS_NIGHT_CLOCK, dayClock(world.options, reveal)));
  });

  it('holds night after player defeat and forgets the encounter immediately on reset', () => {
    const world = setup();
    const held = palette(world);
    world.phase = 'ended';
    world.bossOutcome = { kind: 'defeat', winners: [], at: world.time };
    world.time += 10000;
    expect(palette(world)).toEqual(held);
    world.time = 0;
    world.phase = 'playing';
    world.effigyRevealedAt = null;
    world.boss = null;
    world.bossOutcome = null;
    world.suddenDeath = false;
    expect(palette(world)).toEqual(computeDayState(0, createDayState()));
  });
});

describe('boss day clock environment wiring', () => {
  it('drives the actual fog, sun, exposure and shared daylight through night, death and title reset', () => {
    const world = setup();
    world.map = { half: 150 } as World['map'];
    world.time = endTime(world.options) + 60;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 8, 30);
    camera.lookAt(0, 0, 0);
    const ctx = { world, camera, quality: 'low', scene: new THREE.Scene(), renderer: { toneMappingExposure: 1 },
      session: { screen: 'playing' }, shared: {}, sunDir: new THREE.Vector3(), daylight: 1, time: 0, beat: 0 } as unknown as RenderContext;
    const renderer = new EnvRenderer(ctx);
    const sun = ctx.scene.getObjectByName('env')!.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!;
    const sample = (clock: number) => {
      renderer.update(1 / 60);
      const expected = computeDayState(clock, createDayState());
      expect(ctx.daylight).toBe(expected.daylight);
      expect(ctx.shared.sunDisc!.toArray()).toEqual(expected.sunDir.toArray());
      expect(ctx.sunDir.toArray()).toEqual(expected.lightDir.toArray());
      expect(ctx.scene.fog!.color.toArray()).toEqual(expected.fogColor.toArray());
      expect(ctx.renderer.toneMappingExposure).toBe(expected.exposure);
      expect(sun.intensity).toBe(expected.lightIntensity);
    };
    try {
      const held = Math.max(BOSS_NIGHT_CLOCK, dayClock(world.options, world.effigyRevealedAt!));
      sample(held);
      const deathAt = world.time;
      world.boss!.hp = 0;
      world.boss!.deathAt = deathAt;
      world.boss!.action = 'death';
      sample(held);
      world.time = deathAt + BOSS_DEATH_DURATION * .8;
      sample(worldDayClock(world));
      expect(ctx.daylight).toBeGreaterThan(.1);
      world.time = deathAt + BOSS_DEATH_DURATION;
      world.phase = 'ended';
      ctx.session.screen = 'ended';
      sample(DAWN_TIME);
      ctx.session.screen = 'title';
      sample(ATTRACT_CLOCK);
      expect(ctx.daylight).toBeGreaterThan(.9);
      ctx.session.screen = 'playing';
      world.time = 0;
      world.effigyRevealedAt = null;
      world.boss = null;
      world.suddenDeath = false;
      sample(0);
    } finally {
      renderer.dispose();
    }
  });
});
