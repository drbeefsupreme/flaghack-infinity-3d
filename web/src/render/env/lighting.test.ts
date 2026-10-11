import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../../tests/bossFixture';
import type { RenderContext } from '../context';
import { BOSS_LIGHTNING_INTENSITY, bossLightningLevel } from './bossLightning';
import { EnvLighting } from './lighting';
import { createDayState, computeDayState } from './timeOfDay';

function setup() {
  const boss = bossFixture(), root = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 8, 30); camera.lookAt(0, 10, 0); camera.updateMatrixWorld();
  const day = computeDayState(1000, createDayState());
  const ctx = { camera, quality: 'low', world: { boss, time: boss.spawnedAt }, session: { screen: 'playing' } } as unknown as RenderContext;
  const lighting = new EnvLighting(ctx, root, day);
  const storm = root.getObjectByName('boss-storm-light') as THREE.PointLight;
  let peak = boss.spawnedAt + 4;
  for (let t = peak; t < boss.spawnedAt + 8; t += .001) if (bossLightningLevel(boss, t) > bossLightningLevel(boss, peak)) peak = t;
  return { root, ctx, day, boss, lighting, storm, peak };
}

describe('boss storm scene lighting', () => {
  it('illuminates the real scene near the moving boss and preserves normal lighting', () => {
    const { root, ctx, day, boss, lighting, storm, peak } = setup();
    const children = [...root.children], palette = { sky: day.hemiSky.toArray(), light: day.lightColor.toArray(), intensity: day.lightIntensity };
    expect(storm.isPointLight).toBe(true); expect(storm.intensity).toBe(0); expect(storm.castShadow).toBe(false);
    ctx.world.time = peak; lighting.update(1 / 60);
    expect(storm.intensity).toBeGreaterThan(BOSS_LIGHTNING_INTENSITY * .99);
    expect(storm.intensity).toBeLessThanOrEqual(BOSS_LIGHTNING_INTENSITY);
    expect(storm.position.toArray()).toEqual([boss.pos.x + 24, 38, boss.pos.z + 18]);
    boss.pos.x += 17; boss.pos.z -= 9; lighting.update(1 / 144);
    expect(storm.position.toArray()).toEqual([boss.pos.x + 24, 38, boss.pos.z + 18]);
    expect(day.hemiSky.toArray()).toEqual(palette.sky); expect(day.lightColor.toArray()).toEqual(palette.light);
    expect(root.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!.intensity).toBe(palette.intensity);
    expect(root.children).toEqual(children);
    ctx.world.time += 1; lighting.update(1); expect(storm.intensity).toBe(0);
    lighting.dispose();
  });

  it('clears after death, an end/title/lobby screen, or a world reset without reallocating lights', () => {
    const { root, ctx, boss, lighting, storm, peak } = setup(), children = [...root.children];
    ctx.world.time = peak;
    for (const screen of ['playing', 'paused'] as const) {
      ctx.session.screen = screen; lighting.update(.1); expect(storm.intensity).toBeGreaterThan(0);
    }
    for (const screen of ['title', 'lobby', 'ended'] as const) {
      ctx.session.screen = screen; lighting.update(.1); expect(storm.intensity).toBe(0);
    }
    ctx.session.screen = 'playing'; boss.deathAt = peak; lighting.update(.1); expect(storm.intensity).toBe(0);
    boss.deathAt = null; lighting.update(.1); expect(storm.intensity).toBeGreaterThan(0);
    ctx.world.boss = null; lighting.update(.1); expect(storm.intensity).toBe(0);
    expect(root.children).toEqual(children);
    const dispose = vi.spyOn(storm, 'dispose'); lighting.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
});
