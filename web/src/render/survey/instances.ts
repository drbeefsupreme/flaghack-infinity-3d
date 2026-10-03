/**
 * Per-instance attribute bookkeeping for the Survey layer's dynamic instanced meshes:
 * fixed-capacity typed arrays, rebuilt by their owner each time they change and uploaded as
 * a single partial range per attribute (one reused range object each: no allocation).
 */
import * as THREE from 'three';

export class InstanceSet {
  readonly geo: THREE.InstancedBufferGeometry;
  readonly capacity: number;
  private readonly attrs: THREE.InstancedBufferAttribute[] = [];
  private readonly ranges: { start: number; count: number }[] = [];

  constructor(geo: THREE.InstancedBufferGeometry, capacity: number) {
    this.geo = geo;
    this.capacity = capacity;
    geo.instanceCount = 0;
  }

  /** Register an instanced attribute and return its backing array. */
  add(name: string, size: number, fill = 0): Float32Array {
    const arr = new Float32Array(this.capacity * size);
    if (fill !== 0) arr.fill(fill);
    const a = new THREE.InstancedBufferAttribute(arr, size);
    a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute(name, a);
    this.attrs.push(a);
    this.ranges.push({ start: 0, count: 0 });
    return arr;
  }

  /** Draw `count` instances and upload their data. */
  commit(count: number): void {
    this.geo.instanceCount = count;
    if (count === 0) return;
    for (let i = 0; i < this.attrs.length; i++) {
      const a = this.attrs[i];
      const r = this.ranges[i];
      r.count = count * a.itemSize;
      // If last frame's upload never happened, the same range object is still queued.
      if (a.updateRanges.length === 0) a.updateRanges.push(r);
      a.needsUpdate = true;
    }
  }
}
