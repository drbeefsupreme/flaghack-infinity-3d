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

/**
 * One instanced geometry drawn twice: normally, and only where it is hidden behind opaque
 * geometry (depth GREATER; the material is compiled with FH_OCCLUDED), so a marker stays
 * findable through walls at a fraction of its strength. Transparent layers write no depth,
 * so only opaque occluders (props, buildings, units) trigger the second draw.
 */
export class XrayMeshes {
  private readonly scene: THREE.Scene;
  private readonly front: THREE.Mesh;
  private readonly behind: THREE.Mesh;
  private readonly frontMat: THREE.ShaderMaterial;
  private readonly behindMat: THREE.ShaderMaterial;

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    frontMat: THREE.ShaderMaterial,
    behindMat: THREE.ShaderMaterial,
    renderOrder: number,
  ) {
    this.scene = scene;
    this.frontMat = frontMat;
    this.behindMat = behindMat;
    behindMat.depthFunc = THREE.GreaterDepth;
    this.front = new THREE.Mesh(geo, frontMat);
    this.behind = new THREE.Mesh(geo, behindMat);
    this.front.frustumCulled = false;
    this.behind.frustumCulled = false;
    this.front.renderOrder = renderOrder;
    this.behind.renderOrder = renderOrder;
    this.front.visible = false;
    this.behind.visible = false;
    scene.add(this.front, this.behind);
  }

  set visible(on: boolean) {
    this.front.visible = on;
    this.behind.visible = on;
  }

  /** Removes both meshes and disposes both materials; the geometry belongs to the caller. */
  dispose(): void {
    this.scene.remove(this.front, this.behind);
    this.frontMat.dispose();
    this.behindMat.dispose();
  }
}
