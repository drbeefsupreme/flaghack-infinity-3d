/** Brief, dark ground eruptions from the dimensions of actually destroyed scenery.
 * An exclusive ring pool guarantees a fixed GPU cost, including mass beam/stomp hits;
 * oldest particles are replaced deterministically if a whole camp goes up at once. */
import * as THREE from 'three';
import type { EventOf } from '../../sim/events';
import type { SharedUniforms } from './glsl';
import { ParticlePool, ParticleSpec, Shape } from './particles';
import { Prng } from './prng';

export const SCENERY_PARTICLE_CAPACITY = 2048;
export const SCENERY_ERUPTION_MAX_LIFE = 1.1;
const DUST = new THREE.Color(0x302c2a);
const ASH = new THREE.Color(0x504942);
const DEBRIS = new THREE.Color(0x272321);
const TAU = Math.PI * 2;

export class SceneryEruptions {
  readonly mesh: ParticlePool['mesh'];
  private readonly pool: ParticlePool;
  private readonly spec = new ParticleSpec();
  // IDs belong to the fixed map, so this is bounded by its prop count, not elapsed time.
  private readonly seen = new Set<number>();
  private lastTime = -Infinity;
  private endsAt = -Infinity;

  constructor(shared: SharedUniforms, renderOrder = 14, private readonly density = 1) {
    this.pool = new ParticlePool(SCENERY_PARTICLE_CAPACITY, false, shared, renderOrder);
    this.mesh = this.pool.mesh;
    this.mesh.name = 'scenery-destruction-dust';
  }

  onEvent(event: EventOf<'sceneryDestroyed'>, now: number): void {
    const { sceneryId, pos, size, yaw } = event;
    if (!Number.isInteger(sceneryId) ||
        ![now, pos.x, pos.y, pos.z, size.x, size.y, size.z, yaw].every(Number.isFinite) ||
        Math.min(size.x, size.y, size.z) <= 0) return;
    this.clock(now);
    if (this.seen.has(sceneryId)) return;
    this.seen.add(sceneryId);
    this.pool.now = now;
    this.endsAt = Math.max(this.endsAt, now + SCENERY_ERUPTION_MAX_LIFE);
    const rng = new Prng(Math.imul(sceneryId + 1, 0x9e3779b1));
    // Preserve footprint aspect ratio, while enormous artwork remains a local puff.
    const shrink = Math.min(1, 14 / Math.max(size.x, size.z));
    const width = size.x * shrink, depth = size.z * shrink;
    const span = Math.sqrt(width * depth), height = Math.min(size.y, 12);
    const scale = Math.min(1.25, .22 + span * .065 + height * .025);
    const rise = Math.min(2.7, .85 + Math.sqrt(height) * .6);
    const spread = Math.min(2.4, .65 + span * .12);
    const c = Math.cos(yaw), s = Math.sin(yaw), spec = this.spec;
    const quality = Math.max(.25, Math.min(1, this.density));
    const smoke = Math.ceil(Math.min(24, 9 + span * .7 + height * .25) * quality);
    const chips = Math.ceil(Math.min(14, 5 + span * .45 + height * .15) * quality);
    for (let i = 0; i < smoke + chips; i++) {
      const dust = i < smoke, angle = rng.next() * TAU;
      const x = rng.signed() * width * .38, z = rng.signed() * depth * .38;
      const vx = Math.cos(angle) * spread * rng.range(.35, 1);
      const vz = Math.sin(angle) * spread * rng.range(.35, 1);
      spec.reset().at(pos.x + x * c + z * s, pos.y + .12 + rng.next() * Math.min(height * .16, .9), pos.z - x * s + z * c);
      if (dust) {
        const puff = scale * rng.range(.65, 1);
        spec.vel(vx, rise * rng.range(.55, 1), vz).time(rng.range(.65, SCENERY_ERUPTION_MAX_LIFE))
          .size(puff, puff * 1.65).phys(-.25, 1.4)
          .from(DUST, 1, rng.range(.58, .78)).to(ASH, 1, 0)
          .look(Shape.Smoke, rng.signed() * .7, angle).anim(0, 0, .015);
      } else {
        const vy = rng.range(2.7, 4.3), chip = Math.min(.2, scale * .19) * rng.range(.5, 1);
        spec.vel(vx * 1.4, vy, vz * 1.4).time(Math.min(.72, vy * 2 / 9.5))
          .size(chip, chip * .55).phys(9.5, .35)
          .from(DEBRIS, 1, .92).to(ASH, 1, 0)
          .look(i % 2 ? Shape.Chip : Shape.Shard, rng.signed() * 9, angle).anim(0, 7, 0);
      }
      this.pool.emit(spec);
    }
  }

  private clock(now: number): void {
    if (now < this.lastTime) this.reset();
    this.lastTime = now;
  }

  update(now: number): void {
    if (!Number.isFinite(now)) return;
    this.clock(now);
    if (now >= this.endsAt) {
      if (this.endsAt !== -Infinity) this.pool.clear();
      this.endsAt = -Infinity;
    }
    this.pool.flush();
  }

  /** Match resets clear deduplication and stale particles, reusing the same GPU buffers. */
  reset(): void {
    this.pool.clear();
    this.seen.clear();
    this.lastTime = this.endsAt = -Infinity;
  }

  dispose(): void { this.reset(); this.pool.dispose(); }
}
