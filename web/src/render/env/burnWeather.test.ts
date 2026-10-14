import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import { BOSS_DEATH_DURATION } from '../../sim/boss';
import { bossRevealTime } from '../../sim/effigyBurn';
import { burnTime, endTime, normalizeMatch, UNLIMITED_DAYS } from '../../sim/matchSettings';
import { World } from '../../sim/world';
import { burnStormLevel } from './burnWeather';
import { BurnRain, RAIN_COUNTS } from './rain';
import { SkyDome, STORM_SKY_BRIGHTNESS } from './sky';
import { createDayState } from './timeOfDay';
import type { EnvContext } from './envTypes';

function fixture(days = 1, bossMode = true, dayLength = 1800): World {
  const world = new World({ seed: 'storm-test', difficulty: 'normal', mode: 'standard', humans: [0], match: normalizeMatch({ days, bossMode, dayLength }) });
  world.suddenDeath = true;
  world.time = bossRevealTime(world.options) + 20;
  world.map = { half: 150 } as World['map'];
  return world;
}
function context(world: World, quality: 'low' | 'medium' | 'high' = 'low'): EnvContext {
  return { ctx: { world, quality, camera: new THREE.PerspectiveCamera(), session: { screen: 'playing' } }, root: new THREE.Group(),
    day: createDayState(), noise: new THREE.DataTexture(), uniforms: { uTime: { value: 0 }, uNight: { value: 1 } } } as EnvContext;
}

describe('Burn-night storm lifecycle', () => {
  it.each([0, 1, 3, 5].flatMap(days => [300, 1800, 7200].map(dayLength => ({ days, dayLength }))))('starts with emergence for $days days of $dayLength seconds', ({ days, dayLength }) => {
    const world = fixture(days, true, dayLength), rise = bossRevealTime(world.options) - 5;
    for (const t of [0, burnTime(world.options), rise - .001, rise]) {
      world.time = t; expect(burnStormLevel(world, 'playing')).toBe(0);
    }
    world.time = rise + 2.5; expect(burnStormLevel(world, 'playing')).toBeCloseTo(.5);
    world.time = rise + 5; expect(burnStormLevel(world, 'playing')).toBe(1);
    world.options.match!.bossMode = false;
    for (const t of [rise, rise + 5, endTime(world.options)]) {
      world.time = t; expect(burnStormLevel(world, 'playing')).toBe(0);
    }
    world.options.match!.bossMode = true; world.suddenDeath = false;
    expect(burnStormLevel(world, 'playing')).toBe(0);
  });
  it('uses an authoritative reveal timestamp and reconstructs a partially risen storm', () => {
    const world = fixture(0);
    world.effigyRevealedAt = 150;
    world.time = 144.999; expect(burnStormLevel(world, 'playing')).toBe(0);
    world.time = 147.5; expect(burnStormLevel(world, 'playing')).toBeCloseTo(.5);
    const joined = fixture(0); joined.effigyRevealedAt = 150; joined.time = world.time;
    expect(burnStormLevel(joined, 'playing')).toBe(burnStormLevel(world, 'playing'));
  });
  it('holds through boss nightlock and defeat, clears smoothly with death sunrise, and reconstructs after late join', () => {
    const world = fixture();
    world.effigyRevealedAt = bossRevealTime(world.options);
    world.boss = bossFixture(); world.boss.action = 'idle';
    world.time = endTime(world.options) + 10000;
    expect(burnStormLevel(world, 'ended')).toBe(1);
    world.boss.deathAt = world.time; world.boss.action = 'death';
    let last = 1;
    const death = world.time;
    for (let frame = 0; frame <= BOSS_DEATH_DURATION * 60; frame++) {
      world.time = death + frame / 60;
      const level = burnStormLevel(world, 'playing');
      expect(level).toBeLessThanOrEqual(last);
      expect(last - level).toBeLessThan(.01);
      expect(burnStormLevel(world, 'paused')).toBe(level);
      const joined = fixture(); Object.assign(joined, { time: world.time, boss: world.boss, effigyRevealedAt: world.effigyRevealedAt });
      expect(burnStormLevel(joined, 'playing')).toBe(level);
      last = level;
    }
    expect(last).toBe(0);
    expect(burnStormLevel(world, 'title')).toBe(0);
    world.suddenDeath = false; world.time = 0;
    expect(burnStormLevel(world, 'playing')).toBe(0);
  });
  it('never storms during tutorial or unlimited ordinary nights', () => {
    const world = fixture(); world.options.mode = 'tutorial';
    expect(burnStormLevel(world, 'playing')).toBe(0);
    world.options.mode = 'standard'; world.options.match!.days = UNLIMITED_DAYS;
    expect(burnStormLevel(world, 'playing')).toBe(0);
  });
});

describe('bounded weather renderer', () => {
  it.each(['low', 'medium', 'high'] as const)('uses one reusable rain draw at %s quality, hides on reset and frees resources', quality => {
    const env = context(fixture(0), quality), rain = new BurnRain(env);
    const mesh = env.root.getObjectByName('burn-night-rain') as THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(mesh.geometry.getAttribute('position').count).toBe(RAIN_COUNTS[quality] * 2);
    expect(RAIN_COUNTS[quality]).toBeLessThanOrEqual(2200);
    expect(mesh.material.depthWrite).toBe(false); expect(mesh.material.depthTest).toBe(true);
    const attributes = mesh.geometry.attributes;
    env.ctx.camera.position.set(20, 6, 30);
    rain.update(1 / 60);
    expect(mesh.visible).toBe(true); expect(mesh.material.uniforms.uStorm.value).toBe(1);
    const focus = mesh.material.uniforms.uFocus.value.clone();
    env.ctx.camera.position.x += 1000; rain.update(1 / 60);
    expect(mesh.material.uniforms.uFocus.value.x - focus.x).toBe(1000);
    expect(mesh.geometry.attributes).toBe(attributes);
    env.ctx.session.screen = 'title'; rain.update(1 / 60); expect(mesh.visible).toBe(false);
    env.ctx.session.screen = 'playing'; env.ctx.world.suddenDeath = false; rain.update(1 / 60); expect(mesh.visible).toBe(false);
    const gd = vi.spyOn(mesh.geometry, 'dispose'), md = vi.spyOn(mesh.material, 'dispose');
    rain.dispose(); expect(gd).toHaveBeenCalledOnce(); expect(md).toHaveBeenCalledOnce(); expect(env.root.children).toHaveLength(0);
  });
  it('keeps rain during awakening while preserving the silhouette alpha mask', () => {
    const env = context(fixture(0)), rain = new BurnRain(env);
    env.ctx.world.effigyRevealedAt = env.ctx.world.time;
    rain.update(0);
    const mesh = env.root.getObjectByName('burn-night-rain') as THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(mesh.visible).toBe(true);
    expect(mesh.material.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(mesh.material.blendDstAlpha).toBe(THREE.OneFactor);
    env.ctx.world.time += 5; rain.update(0);
    expect(env.root.getObjectByName('burn-night-rain')!.visible).toBe(true);
    rain.dispose();
  });
  it('wires full overcast to actual sky uniforms and restores clear title sky', () => {
    const env = context(fixture(0)), sky = new SkyDome(env);
    const mesh = env.root.getObjectByName('sky') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    sky.update(0); expect(mesh.material.uniforms.uStorm.value).toBe(1);
    expect(STORM_SKY_BRIGHTNESS).toBe(0.8);
    expect(mesh.material.fragmentShader).toContain('overcast *= 0.8;\n    col = mix(col, overcast, uStorm)');
    env.ctx.session.screen = 'title'; sky.update(0); expect(mesh.material.uniforms.uStorm.value).toBe(0);
    sky.dispose();
  });
});
