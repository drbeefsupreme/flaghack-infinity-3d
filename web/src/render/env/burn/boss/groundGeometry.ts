/** Drape broad, ground-bound encounter decals over the shared gameplay surface. */
import type * as THREE from 'three';
import { groundHeight } from '../../../../sim/terrain';
import type { V2 } from '../../../../sim/math';
const restHeights = new WeakMap<THREE.BufferGeometry, Float32Array>();
export function groundBossGeometry(geometry: THREE.BufferGeometry, at: V2, scale: number, half: number): void {
  const position = geometry.getAttribute('position');
  let rest = restHeights.get(geometry);
  if (!rest) {
    rest = Float32Array.from({ length: position.count }, (_, i) => position.getY(i));
    restHeights.set(geometry, rest);
  }
  for (let i = 0; i < position.count; i++) position.setY(i, rest[i] +
    groundHeight(at.x + position.getX(i) * scale, at.z + position.getZ(i) * scale, half) / scale);
  position.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
}
