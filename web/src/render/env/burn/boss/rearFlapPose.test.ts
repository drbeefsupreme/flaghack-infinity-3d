import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { prepareBossRearDrapeSeam } from './rearFlapPose';

describe('bounded rear-drape seam repair', () => {
  it('changes only the named cloth seam, preserves the source asset and is idempotent', async () => {
    const bytes = fs.readFileSync(new URL('../../../../../public/models/boss/skeletal-boss.glb', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('9758bbe1180ff8b02c0cad4385d93e3f39aeabb5710ba074a2f89546887f2e4a');
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    const snapshots: { mesh: THREE.SkinnedMesh; rear: boolean; attributes: Record<string, number[]>; indices: number[] | null }[] = [];
    source.traverse(o => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      let rear = false; for (let p: THREE.Object3D | null = o; p; p = p.parent) rear ||= /rear[ _]+drape/i.test(p.name);
      snapshots.push({ mesh: o, rear, attributes: Object.fromEntries(Object.entries(o.geometry.attributes).map(([k, a]) => [k, Array.from((a as THREE.BufferAttribute).array)])),
        indices: o.geometry.index ? Array.from(o.geometry.index.array) : null });
    });
    prepareBossRearDrapeSeam(source);
    let changed = 0;
    for (const { mesh, rear, attributes, indices } of snapshots) {
      expect(mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null).toEqual(indices);
      for (const [name, before] of Object.entries(attributes)) {
        const after = mesh.geometry.getAttribute(name).array;
        if (rear && name === 'normal') continue;
        if (rear && name === 'position') {
          for (let i = 0; i < before.length; i += 3) {
            expect(after[i]).toBe(before[i]); expect(after[i + 1]).toBe(before[i + 1]);
            const delta = after[i + 2] - before[i + 2];
            if (delta === 0) continue;
            changed++; expect(delta).toBeGreaterThanOrEqual(-.180001); expect(delta).toBeLessThan(0);
            expect(before[i + 1]).toBeGreaterThan(25.5); expect(Math.abs(before[i])).toBeLessThan(1.8);
          }
        } else expect(Array.from(after)).toEqual(before);
      }
    }
    expect(changed).toBe(1174);
    expect(source.userData.rearDrapeCorrection.meshes).toHaveLength(7);
    expect(source.userData.rearDrapeCorrection.vertices).toBe(changed);
    const corrected = snapshots.map(({ mesh }) => Array.from(mesh.geometry.getAttribute('position').array));
    prepareBossRearDrapeSeam(source);
    snapshots.forEach(({ mesh }, i) => expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(corrected[i]));
  });
});
