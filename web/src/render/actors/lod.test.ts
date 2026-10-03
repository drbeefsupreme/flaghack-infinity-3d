import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ACTOR_SHADOW_RANGE, ActorView, InstanceSet, PLACE } from './lod';

/** Write `value` into every float of the instance's slot in each attribute. */
function fill(set: InstanceSet, slot: number, value: number): void {
  set.attrs.forEach((attr) => attr.array.fill(value, slot * attr.itemSize, (slot + 1) * attr.itemSize));
}

/** First float of each drawn instance, per attribute. */
function drawn(set: InstanceSet): number[][] {
  return set.attrs.map((attr) => Array.from({ length: set.count }, (_, i) => attr.array[i * attr.itemSize]));
}

describe('InstanceSet', () => {
  it('lays casters out first and colour-only instances after them, across growth', () => {
    const set = new InstanceSet([16, 3], 2);
    set.begin();
    const casters = [1, 2, 3];
    const plains = [101, 102, 103, 104];
    // Interleave so both blocks straddle each reallocation.
    for (const v of [101, 1, 102, 2, 103, 104, 3]) fill(set, v > 100 ? set.plain() : set.caster(), v);
    set.finish();

    expect(set.generation).toBeGreaterThan(0);
    expect(set.count).toBe(7);
    expect(set.castCount).toBe(3);
    for (const values of drawn(set)) {
      expect(values.slice(0, 3)).toEqual(casters);
      expect([...values.slice(3)].sort((a, b) => a - b)).toEqual(plains);
    }
  });

  it('starts every frame empty and keeps only that frame’s instances', () => {
    const set = new InstanceSet([4], 8);
    set.begin();
    for (let i = 0; i < 6; i++) fill(set, set.plain(), 200 + i);
    set.finish();
    set.begin();
    fill(set, set.plain(), 7);
    fill(set, set.caster(), 5);
    set.finish();

    expect(set.count).toBe(2);
    expect(set.castCount).toBe(1);
    expect(drawn(set)[0]).toEqual([5, 7]);
  });
});

describe('ActorView.place', () => {
  // Eye at the origin looking down -z.
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  camera.updateProjectionMatrix();
  const view = new ActorView(true);
  view.update(camera);

  it('uses the detailed model only in view and within the detail range (wider once detailed)', () => {
    expect(view.place(0, 0, -10, 1, 30, false)).toBe(PLACE.detailed);
    expect(view.place(0, 0, -32, 1, 30, false)).toBe(PLACE.coarseCaster);
    expect(view.place(0, 0, -32, 1, 30, true)).toBe(PLACE.detailed);
    expect(view.place(0, 0, -100, 1, 30, true)).toBe(PLACE.coarse);
  });

  it('keeps off-screen actors near the eye as shadow casters and drops the rest', () => {
    expect(view.place(0, 0, 10, 1, 30, false)).toBe(PLACE.coarseCaster);
    expect(view.place(0, 0, ACTOR_SHADOW_RANGE + 5, 1, 30, false)).toBe(PLACE.skip);
    // A sphere poking into the frustum counts as in view.
    expect(view.place(0, 0, 0.5, 2, 30, false)).toBe(PLACE.detailed);
  });

  it('casts nothing on the shadowless tier', () => {
    const flat = new ActorView(false);
    flat.update(camera);
    expect(flat.place(0, 0, 10, 1, 30, false)).toBe(PLACE.skip);
    expect(flat.place(0, 0, -40, 1, 30, false)).toBe(PLACE.coarse);
    expect(flat.casts(0, 0, -5)).toBe(false);
  });
});
