import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PartsBuilder } from '../geom';
import { terrainHeight } from '../terrain';
import { StaticBatch } from './batch';
import { groundPropGeometry } from './grounding';

describe('prop terrain grounding', () => {
  it('lifts rigid owned triangles together after nested batching without changing dimensions', () => {
    const box = new PartsBuilder().box(8, 3, 8, 0xffffff, { y: 1.5 }).build();
    const inner = new StaticBatch();
    inner.owners = [42, -1];
    inner.add(box, new THREE.Matrix4());
    const merged = inner.build()!;
    const outer = new StaticBatch();
    outer.add(merged, new THREE.Matrix4());
    const geometry = outer.build()!;
    const before = Float32Array.from(geometry.getAttribute('position').array);
    groundPropGeometry(geometry, new Map([[42, 2]]), 150);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i)).toBe(before[i * 3]);
      expect(p.getY(i)).toBe(before[i * 3 + 1] + 2);
      expect(p.getZ(i)).toBe(before[i * 3 + 2]);
    }
    expect(geometry.boundingBox!.min.y).toBe(2);
    expect(geometry.boundingBox!.max.y).toBe(5);
    box.dispose(); merged.dispose(); geometry.dispose();
  });

  it('grounds shared strings and unowned details at their own world coordinates', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 3, 0, 75, 3, 0, 150, 3, 0], 3));
    geometry.userData.sceneryOwners = new Int32Array([1, 2]);
    groundPropGeometry(geometry, new Map([[1, 2], [2, 0]]), 150);
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(3 + terrainHeight(p.getX(i), 0, 150));
    geometry.dispose();
  });
});
