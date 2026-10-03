import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { yawTo } from '../../sim/math';
import { writeTransform } from './util';

describe('writeTransform', () => {
  it('equals three.js compose(T, Euler YXZ, uniform S) for arbitrary poses', () => {
    const out = new Float32Array(32);
    const cases: [number, number, number, number, number, number, number][] = [
      [1, 2, 3, 0.3, -0.7, 1.1, 1.5],
      [-4, 0.5, 9, -2.1, 1.4, -0.2, 0.8],
      [0, 0, 0, Math.PI, -Math.PI / 2, 0, 1],
    ];
    for (const [x, y, z, yaw, pitch, roll, s] of cases) {
      writeTransform(out, 16, x, y, z, yaw, pitch, roll, s);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      m.elements.forEach((e, i) => expect(out[16 + i]).toBeCloseTo(e, 5));
    }
  });

  it('points a model facing +z along the sim yaw toward its target', () => {
    const out = new Float32Array(16);
    const yaw = yawTo(0, 0, 3, -4);
    writeTransform(out, 0, 0, 0, 0, yaw, 0, 0, 1);
    const forward = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().fromArray(out));
    expect(forward.x).toBeCloseTo(3 / 5, 5);
    expect(forward.z).toBeCloseTo(-4 / 5, 5);
  });
});
