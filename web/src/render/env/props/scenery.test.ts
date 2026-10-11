import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatch } from '../../../sim/setup';
import { normalizeMatch } from '../../../sim/matchSettings';
import { destroySceneryHit } from '../../../sim/systems/scenery';
import { createDayState } from '../timeOfDay';
import type { EnvContext } from '../envTypes';
import { PropField } from './propField';

function environment(): EnvContext {
  const world = createMatch({ seed: 'scenery-render', difficulty: 'normal', humans: [0], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  // Real generated props from every builder, including the stage's signs/show and tree canopy.
  world.map.obstacles = ['tent', 'dome', 'art', 'porta', 'tree', 'rock', 'stage', 'shade', 'car']
    .map(kind => world.map.obstacles.find(o => o.kind === kind)!);
  return {
    ctx: { world, quality: 'low', beat: 0, time: 0 } as EnvContext['ctx'],
    root: new THREE.Group(), day: createDayState(),
    uniforms: { uTime: { value: 0 }, uNight: { value: 1 }, uBeat: { value: 0 }, uWind: { value: new THREE.Vector2() },
      uBurn: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() } },
  } as EnvContext;
}

afterEach(() => vi.unstubAllGlobals());

describe('destroyed scenery rendering', () => {
  it('drops every prop part, attached light show, signs and canopy, preserves forest, and cleans up rebuilds', () => {
    const ctx = new Proxy({ measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }) },
      { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
    vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) });
    const env = environment(), world = env.ctx.world;
    const field = new PropField(env);
    expect(env.root.getObjectByName('props-rough')).toBeDefined();
    expect(env.root.getObjectByName('tree-canopies')).toBeDefined();
    const forestCount = env.root.getObjectByName('props')!.children.filter(o => o.name.startsWith('forest-')).length;
    expect(forestCount).toBeGreaterThan(0);
    const old = env.root.getObjectByName('props')!;
    for (const o of world.map.obstacles) destroySceneryHit(world, -1 - o.id);
    field.update(0);
    expect(old.parent).toBeNull();
    expect(env.root.getObjectByName('props-rough')).toBeUndefined();
    expect(env.root.getObjectByName('props-gloss')).toBeUndefined();
    expect(env.root.getObjectByName('tree-canopies')).toBeUndefined();
    expect(env.root.children).toHaveLength(1);
    expect(env.root.getObjectByName('props')!.children.every(o => o.name.startsWith('forest-'))).toBe(true);
    expect(env.root.getObjectByName('props')!.children).toHaveLength(forestCount);
    const rebuilt = env.root.getObjectByName('props');
    field.update(0);
    expect(env.root.getObjectByName('props')).toBe(rebuilt);
    field.dispose();
    expect(env.root.children).toHaveLength(0);
    // Late render construction reads durable IDs immediately, without an event replay.
    const late = new PropField(env);
    expect(env.root.getObjectByName('props')!.children.every(o => o.name.startsWith('forest-'))).toBe(true);
    late.dispose();
    const reset = environment();
    const resetField = new PropField(reset);
    expect(reset.ctx.world.destroyedScenery.size).toBe(0);
    expect(reset.root.getObjectByName('props-rough')).toBeDefined();
    expect(reset.root.getObjectByName('tree-canopies')).toBeDefined();
    expect(reset.root.children.length).toBeGreaterThan(1); // Stage light show restored, too.
    resetField.dispose();
  });
});
