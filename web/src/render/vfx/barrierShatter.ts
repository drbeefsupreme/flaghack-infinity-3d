/** One-shot, loop-colored fragments of a boss-broken forcefield. The event owns the
 * disappearing planes' poses/colors; rebuilding survey topology must not move them. */
import * as THREE from 'three';
import { BOSS_FORCEFIELD_HEIGHT, BOSS_FORCEFIELD_WIDTH } from '../../sim/bossForcefield';
import type { EventOf } from '../../sim/events';
import type { SharedUniforms } from './glsl';
import { ParticlePool, ParticleSpec, Shape } from './particles';
import { Prng } from './prng';

export const BARRIER_SHATTER_CAPACITY = 2048;
export const BARRIER_SHATTER_MAX_LIFE = .95;
export const BARRIER_SHATTER_DEDUP_CAPACITY = 256;
const TAU = Math.PI * 2;
// Match BossCombatFx's p=(uv-.5)*vec2(1,1.65) and its .4–.61 radial fade.
const ELLIPSE_Y = 1.65;
const FRAGMENTS_PER_SEGMENT = 56;

export class BarrierShatter {
  readonly mesh: ParticlePool['mesh'];
  private readonly pool: ParticlePool;
  private readonly spec = new ParticleSpec();
  private readonly color = new THREE.Color();
  private readonly seen = new Set<string>();
  private readonly recent = new Array<string | undefined>(BARRIER_SHATTER_DEDUP_CAPACITY);
  private recentCursor = 0;
  private lastTime = -Infinity;
  private endsAt = -Infinity;
  private disposed = false;

  constructor(shared: SharedUniforms, renderOrder = 17, private readonly density = 1) {
    this.pool = new ParticlePool(BARRIER_SHATTER_CAPACITY, true, shared, renderOrder);
    this.mesh = this.pool.mesh;
    this.mesh.name = 'boss-barrier-shatter';
  }

  onEvent(event: EventOf<'bossBarrierShattered'>, now: number): void {
    if (this.disposed || !Number.isFinite(now) || !Number.isFinite(event.at) ||
        !Number.isSafeInteger(event.bossId) || !Number.isSafeInteger(event.breakId) ||
        event.breakId < 0) return;
    this.clock(now);
    const key = `${event.bossId}:${event.breakId}`;
    if (this.seen.has(key)) return;
    let emitted = false;
    // Presentation time is intentional: a delayed mirrored fact still gets its full burst.
    this.pool.now = now;
    const quality = Number.isFinite(this.density) ? Math.max(.25, Math.min(1, this.density)) : 1;
    const targetCount = Math.ceil(FRAGMENTS_PER_SEGMENT * quality), spec = this.spec;
    const budget = Math.floor(BARRIER_SHATTER_CAPACITY * quality), segments = event.segments.length;
    // A large break shares the pool across its planes instead of allowing the farthest
    // payload entries to overwrite every fragment of the nearest ones.
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex++) {
      const { edge, pos, yaw, color } = event.segments[segmentIndex];
      if (!Number.isSafeInteger(edge) || ![pos.x, pos.y, pos.z, yaw].every(Number.isFinite) ||
          !Number.isInteger(color) || color < 0 || color > 0xffffff) continue;
      const count = Math.min(targetCount, Math.floor(budget / segments) + (segmentIndex < budget % segments ? 1 : 0));
      if (count === 0) continue;
      const seed = Math.imul(event.breakId + 1, 0x9e3779b1) ^ Math.imul(event.bossId + 1, 0x85ebca6b) ^ Math.imul(edge + 1, 0xc2b2ae35);
      const rng = new Prng(seed), phase = rng.next() * TAU;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this.color.set(color);
      for (let i = 0; i < count; i++) {
        // Stratified angles cover the entire ellipse even at low quality. Alternate the
        // bright .4 rim with interior/outer wave fragments; respect the plane's X clip.
        const angle = phase + TAU * (i + rng.range(.15, .85)) / count;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const radius = Math.min(i % 3 === 0 ? rng.range(.385, .415) : rng.range(.10, .58), .49 / Math.max(Math.abs(ca), .001));
        const x = ca * radius * BOSS_FORCEFIELD_WIDTH;
        const y = sa * radius * BOSS_FORCEFIELD_HEIGHT / ELLIPSE_Y;
        const speed = rng.range(7, 14) / Math.hypot(x, y);
        const vx = x * speed, vy = y * speed, normal = rng.signed() * 2.4;
        const size = rng.range(.27, .55);
        spec.reset().at(pos.x + x * c, pos.y + y, pos.z - x * s)
          .vel(vx * c + normal * s, vy, -vx * s + normal * c)
          .time(rng.range(.72, BARRIER_SHATTER_MAX_LIFE)).size(size, size * .22).phys(.6, 1.5)
          .from(this.color, 1.9, .95).to(this.color, .65, 0)
          .look(i % 2 ? Shape.Shard : Shape.Chip, rng.signed() * 10, angle)
          .anim(.08, 5, 0);
        this.pool.emit(spec);
      }
      emitted = true;
    }
    if (!emitted) return;
    const old = this.recent[this.recentCursor];
    if (old !== undefined) this.seen.delete(old);
    this.recent[this.recentCursor] = key;
    this.recentCursor = (this.recentCursor + 1) % BARRIER_SHATTER_DEDUP_CAPACITY;
    this.seen.add(key);
    this.endsAt = Math.max(this.endsAt, now + BARRIER_SHATTER_MAX_LIFE);
  }

  private clock(now: number): void {
    if (now < this.lastTime) this.reset();
    this.lastTime = now;
    if (now >= this.endsAt && this.endsAt !== -Infinity) {
      this.pool.clear();
      this.endsAt = -Infinity;
    }
  }

  update(now: number): void {
    if (this.disposed || !Number.isFinite(now)) return;
    this.clock(now);
    this.pool.flush();
  }

  /** Explicit match reset and clock rewind reuse the existing GPU allocation. */
  reset(): void {
    this.pool.clear();
    this.seen.clear();
    this.recent.fill(undefined);
    this.recentCursor = 0;
    this.lastTime = this.endsAt = -Infinity;
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    this.pool.dispose();
  }
}
