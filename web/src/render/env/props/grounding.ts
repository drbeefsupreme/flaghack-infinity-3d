import * as THREE from 'three';
import type { Obstacle } from '../../../sim/map/mapgen';
import { terrainHeight } from '../terrain';

/** Keep each rigid prop and its attached decorations on the same level foundation. */
export function propGroundHeights(obstacles: readonly Obstacle[], half: number): Map<number, number> {
  return new Map(obstacles.map(o => [o.id, terrainHeight(o.x, o.z, half)]));
}

/** Lift final world-space batches exactly once, after nested cloth/string merges. */
export function groundPropGeometry(geometry: THREE.BufferGeometry, heights: ReadonlyMap<number, number>, half: number): void {
  const position = geometry.getAttribute('position');
  const owners = geometry.userData.sceneryOwners as Int32Array | undefined;
  for (let i = 0; i < position.count; i++) {
    const owner = owners?.[Math.floor(i / 3) * 2];
    const attachedTo = owners?.[Math.floor(i / 3) * 2 + 1];
    // Inter-prop strings follow the meadow between their two anchored ends.
    const height = attachedTo !== undefined && attachedTo >= 0 && attachedTo !== owner
      ? terrainHeight(position.getX(i), position.getZ(i), half)
      : heights.get(owner ?? -1) ?? terrainHeight(position.getX(i), position.getZ(i), half);
    position.setY(i, position.getY(i) + height);
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
