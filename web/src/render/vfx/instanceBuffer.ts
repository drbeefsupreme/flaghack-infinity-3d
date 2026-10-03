/**
 * Interleaved per-instance float storage with partial uploads. Each VFX layer keeps all of
 * its instance attributes in one of these. Writers mark the instance spans they touched;
 * `flush()` hands three.js at most two upload ranges (a ring buffer wraps at most once per
 * frame) through preallocated range records, so steady-state frames allocate nothing.
 * Spans persist until three.js reports the upload, so a frame that is not drawn loses nothing.
 */
import * as THREE from 'three';

export class InstanceBuffer {
  readonly data: Float32Array;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  /** Floats per instance (vec4 attributes × 4). */
  readonly stride: number;
  readonly capacity: number;
  // Pending dirty spans in instances, half-open [lo, hi); hi = 0 means empty.
  private aLo = 0;
  private aHi = 0;
  private bLo = 0;
  private bHi = 0;
  private readonly rangeA = { start: 0, count: 0 };
  private readonly rangeB = { start: 0, count: 0 };

  constructor(capacity: number, vec4s: number) {
    this.capacity = capacity;
    this.stride = vec4s * 4;
    this.data = new Float32Array(capacity * this.stride);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.buffer.onUploadCallback = () => {
      this.aHi = 0;
      this.bHi = 0;
    };
  }

  /** Expose the interleaved vec4s as attributes `${prefix}0..N` on `geometry`. */
  attach(geometry: THREE.InstancedBufferGeometry, prefix: string): void {
    for (let i = 0; i < this.stride / 4; i++) {
      geometry.setAttribute(`${prefix}${i}`, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    }
  }

  /** Mark instances [lo, hi) as written since the last upload. */
  mark(lo: number, hi: number): void {
    if (hi <= lo) return;
    if (this.aHi === 0) {
      this.aLo = lo;
      this.aHi = hi;
    } else if (lo <= this.aHi && hi >= this.aLo) {
      this.aLo = Math.min(this.aLo, lo);
      this.aHi = Math.max(this.aHi, hi);
    } else if (this.bHi === 0) {
      this.bLo = lo;
      this.bHi = hi;
    } else if (lo <= this.bHi && hi >= this.bLo) {
      this.bLo = Math.min(this.bLo, lo);
      this.bHi = Math.max(this.bHi, hi);
    } else {
      // A third disjoint span (rare): fold everything into one covering span.
      this.aLo = Math.min(this.aLo, this.bLo, lo);
      this.aHi = Math.max(this.aHi, this.bHi, hi);
      this.bHi = 0;
    }
  }

  /** Queue the pending spans for upload on the next draw. */
  flush(): void {
    if (this.aHi === 0) return;
    const ranges = this.buffer.updateRanges;
    ranges.length = 0;
    this.rangeA.start = this.aLo * this.stride;
    this.rangeA.count = (this.aHi - this.aLo) * this.stride;
    ranges.push(this.rangeA);
    if (this.bHi !== 0) {
      this.rangeB.start = this.bLo * this.stride;
      this.rangeB.count = (this.bHi - this.bLo) * this.stride;
      ranges.push(this.rangeB);
    }
    this.buffer.needsUpdate = true;
  }
}
