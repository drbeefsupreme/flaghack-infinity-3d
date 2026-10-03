/**
 * One-shot effect recipes: every event-driven burst is composed here from the particle
 * pools, the ground layer and the shock walls. Recipes take world positions (y = ground or
 * deck level unless noted) and colours, spawn analytic primitives and return; nothing here
 * runs per frame except the small per-emitter helpers (trail, marchTrail, vortexMote, beaconMote).
 * Counts scale with the quality setting through `n()`.
 */
import * as THREE from 'three';
import { WARD_PULSE_RADIUS } from '../../sim/constants';
import { RingStyle, type GroundFx } from './groundFx';
import * as P from './palette';
import { ParticleSpec, Shape, type ParticlePool } from './particles';
import type { Prng } from './prng';
import type { ShockWalls } from './shockWalls';

const TAU = Math.PI * 2;

export class Bursts {
  private readonly add: ParticlePool;
  private readonly grime: ParticlePool;
  private readonly ground: GroundFx;
  private readonly walls: ShockWalls;
  private readonly rng: Prng;
  private readonly density: number;
  private readonly s = new ParticleSpec();
  private readonly dir = new THREE.Vector3();

  /** `add` = additive pool (light), `grime` = alpha pool (dust, smoke, chips, confetti). */
  constructor(add: ParticlePool, grime: ParticlePool, ground: GroundFx, walls: ShockWalls, rng: Prng, density: number) {
    this.add = add;
    this.grime = grime;
    this.ground = ground;
    this.walls = walls;
    this.rng = rng;
    this.density = density;
  }

  /** Quality-scaled particle count (at least one). */
  private n(count: number): number {
    return Math.max(1, Math.round(count * this.density));
  }

  // ── Flags ──────────────────────────────────────────────────────────────────

  /** Planted: yellow spark fountain from the base, a flare up the pole, a pop at the finial, faction ground ring. */
  plant(x: number, y: number, z: number, faction: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(32); i < n; i++) {
      const a = r.next() * TAU;
      const el = r.range(0.5, 1.35);
      const sp = r.range(4, 10);
      const h = Math.cos(el) * sp;
      s.reset()
        .at(x + r.signed() * 0.15, y + 0.15, z + r.signed() * 0.15)
        .vel(Math.cos(a) * h, Math.sin(el) * sp, Math.sin(a) * h)
        .time(r.range(0.4, 0.7))
        .size(0.1, 0)
        .phys(10, 2.2)
        .from(P.YELLOW, 3, 1)
        .to(P.ORANGE, 1.4, 0)
        .look(Shape.Spark, 0, 0, 0.045);
      this.add.emit(s);
    }
    s.reset().at(x, y + 0.2, z).vel(0, 24, 0).time(0.3).size(0.26, 0.1).phys(0, 7).from(P.YELLOW, 2.6, 1).to(P.WHITE, 1.4, 0).look(Shape.Spark, 0, 0, 0.05);
    this.add.emit(s);
    s.reset().at(x, y + 2.3, z).time(0.22).size(1.5, 0.4).from(P.YELLOW, 1.6, 1).to(P.WHITE, 0.9, 0);
    this.add.emit(s);
    for (let i = 0, n = this.n(6); i < n; i++) {
      s.reset()
        .at(x, y + 2.3, z)
        .orbit(0.15, r.range(3, 5) * (i % 2 === 0 ? 1 : -1), r.range(0.4, 1.2), r.next() * TAU, -2.2)
        .time(r.range(0.5, 0.8))
        .size(0.16, 0.02)
        .from(P.WARM_WHITE, 2.4, 1)
        .to(P.YELLOW, 1.5, 0)
        .look(Shape.Star, r.signed() * 6, r.next() * TAU);
      this.add.emit(s);
    }
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.3, 2.8, 0.22, 0.55, faction, 2.2);
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.2, 1.5, 0.12, 0.38, P.YELLOW, 2.5);
  }

  /** Pulled: sparks yanked upward in the old owner's colour + yellow, dirt clods, a collapsing ring. */
  pull(x: number, y: number, z: number, prev: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(24); i < n; i++) {
      const c = i % 2 === 0 ? prev : P.YELLOW;
      s.reset()
        .at(x + r.signed() * 0.2, y + 0.2, z + r.signed() * 0.2)
        .vel(r.signed() * 1.4, r.range(6, 12.5), r.signed() * 1.4)
        .time(r.range(0.45, 0.8))
        .size(0.08, 0)
        .phys(13, 1.2)
        .from(c, 3, 1)
        .to(c, 1, 0)
        .look(Shape.Spark, 0, 0, 0.045);
      this.add.emit(s);
    }
    s.reset().at(x, y + 0.3, z).vel(0, 18, 0).time(0.25).size(0.18, 0.05).phys(0, 3).from(prev, 3, 1).to(P.YELLOW, 2, 0).look(Shape.Spark, 0, 0, 0.06);
    this.add.emit(s);
    for (let i = 0, n = this.n(8); i < n; i++) {
      const sz = r.range(0.1, 0.16);
      s.reset()
        .at(x + r.signed() * 0.3, y + 0.1, z + r.signed() * 0.3)
        .vel(r.signed() * 2.2, r.range(3, 6), r.signed() * 2.2)
        .time(r.range(0.6, 0.9))
        .size(sz, sz * 0.8)
        .phys(16, 0.5)
        .from(P.DUST_DARK, 1, 1)
        .to(P.DUST_DARK, 0.8, 0.9)
        .look(Shape.Chip, r.signed() * 12, r.next() * TAU)
        .anim(0, r.range(8, 16));
      this.grime.emit(s);
    }
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 2.2, 0.2, 0.2, 0.32, prev, 2.4);
  }

  /** Throw release: a short spray along the throw and a puff of dust. */
  throwLaunch(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const s = this.s;
    const r = this.rng;
    const sp = Math.max(Math.hypot(vx, vy, vz), 0.001);
    for (let i = 0, n = this.n(10); i < n; i++) {
      const k = r.range(3, 7) / sp;
      s.reset()
        .at(x, y, z)
        .vel(vx * k + r.signed() * 1.5, vy * k + r.signed() * 1.5, vz * k + r.signed() * 1.5)
        .time(r.range(0.25, 0.4))
        .size(0.06, 0)
        .phys(8, 3)
        .from(P.YELLOW, 3, 1)
        .to(P.ORANGE, 1.2, 0)
        .look(Shape.Spark, 0, 0, 0.03);
      this.add.emit(s);
    }
    s.reset().at(x, y, z).vel(r.signed() * 0.3, 0.4, r.signed() * 0.3).time(0.6).size(0.3, 0.9).phys(0, 2).from(P.DUST, 1, 0.35).to(P.DUST, 1, 0).look(Shape.Smoke, 0.5, r.next() * TAU);
    this.grime.emit(s);
  }

  /** One glowing point of a thrown Flag's trail (called along the projectile path). */
  trail(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    s.reset()
      .at(x + r.signed() * 0.05, y + r.signed() * 0.05, z + r.signed() * 0.05)
      .vel(r.signed() * 0.4, r.signed() * 0.4, r.signed() * 0.4)
      .time(r.range(0.35, 0.5))
      .size(0.3, 0.05)
      .phys(1.2, 1.5)
      .from(P.YELLOW, 2.4, 0.9)
      .to(P.ORANGE, 1.2, 0);
    this.add.emit(s);
    if (r.next() < 0.3) {
      s.reset()
        .at(x, y, z)
        .vel(r.signed() * 1.5, r.range(-0.5, 1.5), r.signed() * 1.5)
        .time(r.range(0.3, 0.55))
        .size(0.05, 0)
        .phys(7, 1)
        .from(P.WARM_WHITE, 3, 1)
        .to(P.YELLOW, 1.5, 0)
        .look(Shape.Spark, 0, 0, 0.03);
      this.add.emit(s);
    }
  }

  /** Landed: dust puff and a small ring of sparks skidding along the ground. */
  landed(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(6); i < n; i++) {
      const a = r.next() * TAU;
      const sp = r.range(1.5, 3);
      s.reset()
        .at(x, y + 0.2, z)
        .vel(Math.cos(a) * sp, r.range(0.3, 0.8), Math.sin(a) * sp)
        .time(r.range(0.7, 1.1))
        .size(0.5, 1.6)
        .phys(-0.2, 3)
        .from(P.DUST, 1, 0.55)
        .to(P.DUST_DARK, 1, 0)
        .look(Shape.Smoke, r.signed(), r.next() * TAU);
      this.grime.emit(s);
    }
    for (let i = 0, n = this.n(14); i < n; i++) {
      const a = (i / n) * TAU + r.signed() * 0.2;
      const sp = r.range(5, 8);
      s.reset()
        .at(x, y + 0.1, z)
        .vel(Math.cos(a) * sp, r.range(1, 2), Math.sin(a) * sp)
        .time(r.range(0.25, 0.4))
        .size(0.06, 0)
        .phys(8, 3)
        .from(P.YELLOW, 3, 1)
        .to(P.ORANGE, 1, 0)
        .look(Shape.Spark, 0, 0, 0.03);
      this.add.emit(s);
    }
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.2, 1.8, 0.14, 0.4, P.YELLOW, 2.2);
  }

  /** Glassy glitch: tumbling cyan/magenta shards plus flickering digital blocks. */
  glassGlitch(x: number, y: number, z: number, scale: number): void {
    const s = this.s;
    const r = this.rng;
    const d = this.dir;
    const sz = Math.sqrt(scale);
    for (let i = 0, n = this.n(16 * scale); i < n; i++) {
      const c = i % 3 === 0 ? P.CYAN : i % 3 === 1 ? P.MAGENTA : P.WHITE;
      r.unit(d);
      const sp = r.range(2, 5.5) * sz;
      s.reset()
        .at(x + d.x * 0.3, y + d.y * 0.3, z + d.z * 0.3)
        .vel(d.x * sp, d.y * sp + 1.5, d.z * sp)
        .time(r.range(0.7, 1.1))
        .size(r.range(0.22, 0.38) * sz, 0.04)
        .phys(3.5, 1.4)
        .from(c, 2.6, 1)
        .to(c, 1.2, 0)
        .look(Shape.Shard, r.signed() * 7, r.next() * TAU)
        .anim(0.3, r.range(8, 14));
      this.add.emit(s);
    }
    for (let i = 0, n = this.n(12 * scale); i < n; i++) {
      const c = i % 2 === 0 ? P.CYAN : P.MAGENTA;
      const sq = r.range(0.12, 0.35) * sz;
      s.reset()
        .at(x + r.signed() * 1.1 * sz, y + r.signed() * 0.9 * sz, z + r.signed() * 1.1 * sz)
        .vel(r.signed() * 0.8, 0, r.signed() * 0.8)
        .time(r.range(0.08, 0.22), r.range(0, 0.35))
        .size(sq, sq)
        .from(c, 2.6, 1)
        .to(c, 2, 0.6)
        .look(Shape.Glitch)
        .anim(0.6, 0, 0);
      this.add.emit(s);
    }
  }

  // ── Combat ─────────────────────────────────────────────────────────────────

  /** Staff/shove impact: white-hot spark spray and a flash; `heavy` for hits on the player. */
  hit(x: number, y: number, z: number, heavy: boolean): void {
    const s = this.s;
    const r = this.rng;
    const d = this.dir;
    for (let i = 0, n = this.n(heavy ? 22 : 14); i < n; i++) {
      r.unit(d);
      const sp = r.range(5, 11);
      s.reset()
        .at(x, y, z)
        .vel(d.x * sp, d.y * sp + 2, d.z * sp)
        .time(r.range(0.22, 0.42))
        .size(0.06, 0)
        .phys(9, 4)
        .from(P.WARM_WHITE, 3.2, 1)
        .to(P.ORANGE, 1.2, 0)
        .look(Shape.Spark, 0, 0, 0.03);
      this.add.emit(s);
    }
    s.reset().at(x, y, z).time(0.12).size(heavy ? 1.1 : 0.8, 0.2).from(P.WHITE, 1.6, 1).to(P.YELLOW, 1, 0);
    this.add.emit(s);
  }

  /** KO: a low grey puff, a crown of cartoon stars circling the head, a pop of tiny stars. */
  ko(x: number, y: number, z: number, headY: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(9); i < n; i++) {
      s.reset()
        .at(x + r.signed() * 0.35, y + r.range(0.2, 0.8), z + r.signed() * 0.35)
        .vel(r.signed() * 1.3, r.range(0.4, 1.1), r.signed() * 1.3)
        .time(r.range(0.9, 1.4))
        .size(r.range(0.4, 0.6), r.range(1.2, 1.7))
        .phys(-0.2, 2.2)
        .from(P.SMOKE, 1, 0.5)
        .to(P.SMOKE, 0.9, 0)
        .look(Shape.Smoke, r.signed() * 0.8, r.next() * TAU);
      this.grime.emit(s);
    }
    for (let k = 0; k < 5; k++) {
      s.reset()
        .at(x, headY + 0.35, z)
        .orbit(0.75, 4.2, 0.1, (k / 5) * TAU, 0)
        .time(2.6)
        .size(0.36, 0.28)
        .from(P.YELLOW, 2, 1)
        .to(P.GOLD, 1.3, 0)
        .look(Shape.Star, 3)
        .anim(0.12, 0, 0.15);
      this.add.emit(s);
    }
    for (let i = 0, n = this.n(8); i < n; i++) {
      const a = r.next() * TAU;
      const sp = r.range(3, 5);
      s.reset()
        .at(x, headY, z)
        .vel(Math.cos(a) * sp, r.range(2, 4), Math.sin(a) * sp)
        .time(0.6)
        .size(0.18, 0.05)
        .phys(6, 1.5)
        .from(P.YELLOW, 2.5, 1)
        .to(P.WHITE, 1.5, 0)
        .look(Shape.Star, r.signed() * 8, r.next() * TAU);
      this.add.emit(s);
    }
  }

  /** Recruited: a faction-coloured sparkle spiralling up around the hippie. */
  recruit(x: number, y: number, z: number, c: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(22); i < n; i++) {
      s.reset()
        .at(x, y + r.range(0.2, 1.8), z)
        .orbit(r.range(0.3, 0.8), r.range(3, 6) * (i % 2 === 0 ? 1 : -1), r.range(0.8, 2), r.next() * TAU, -0.6)
        .time(r.range(0.8, 1.2))
        .size(0.14, 0.02)
        .from(c, 3, 1)
        .to(P.WHITE, 2, 0)
        .look(i % 3 === 0 ? Shape.Star : Shape.Dot, r.signed() * 5, r.next() * TAU);
      this.add.emit(s);
    }
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.3, 2.4, 0.18, 0.6, c, 2.2);
  }

  /** TAKE A SHOT wobble: a few pink sparkles circling a hippie's head for ~2 s. */
  wobble(x: number, headY: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    for (let k = 0; k < 3; k++) {
      s.reset()
        .at(x, headY + 0.2, z)
        .orbit(0.35, 5, 0.05, (k / 3) * TAU + r.next(), 0)
        .time(2)
        .size(0.18, 0.12)
        .from(P.PING_COLORS.shot, 2.6, 1)
        .to(P.YELLOW, 1.6, 0)
        .look(Shape.Star, 4)
        .anim(0.2, 0, 0.1);
      this.add.emit(s);
    }
  }

  // ── Structures & economy ───────────────────────────────────────────────────

  /** Harvest: brown wood chips tumbling out of the pile, a little sawdust. */
  chips(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(12); i < n; i++) {
      const sz = r.range(0.1, 0.18);
      s.reset()
        .at(x + r.signed() * 0.4, y + r.range(0.5, 1.1), z + r.signed() * 0.4)
        .vel(r.signed() * 3, r.range(2.5, 6), r.signed() * 3)
        .time(r.range(0.7, 1.1))
        .size(sz, sz * 0.8)
        .phys(16, 0.8)
        .from(i % 2 === 0 ? P.WOOD : P.WOOD_LIGHT, 1, 1)
        .to(i % 2 === 0 ? P.WOOD : P.WOOD_LIGHT, 0.9, 0.85)
        .look(Shape.Chip, r.signed() * 14, r.next() * TAU)
        .anim(0, r.range(10, 18));
      this.grime.emit(s);
    }
    for (let i = 0, n = this.n(2); i < n; i++) {
      s.reset()
        .at(x + r.signed() * 0.3, y + 0.8, z + r.signed() * 0.3)
        .vel(r.signed() * 0.4, 0.6, r.signed() * 0.4)
        .time(0.8)
        .size(0.4, 1.1)
        .phys(0, 2)
        .from(P.DUST, 1, 0.45)
        .to(P.DUST, 1, 0)
        .look(Shape.Smoke, r.signed(), r.next() * TAU);
      this.grime.emit(s);
    }
  }

  /** A ring of dust puffs rolling outward from a base (pieces, landings, collapses). */
  dust(x: number, y: number, z: number, count: number, radius: number, strength: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(count); i < n; i++) {
      const a = (i / n) * TAU + r.signed() * 0.3;
      const rad = radius * r.range(0.6, 1);
      const sp = r.range(1, 2.6);
      s.reset()
        .at(x + Math.cos(a) * rad, y + 0.25, z + Math.sin(a) * rad)
        .vel(Math.cos(a) * sp, r.range(0.3, 1.1), Math.sin(a) * sp)
        .time(r.range(0.8, 1.3))
        .size(r.range(0.5, 0.8), r.range(1.4, 2.2))
        .phys(-0.4, 2.2)
        .from(P.DUST, 1, 0.55 * strength)
        .to(P.DUST_DARK, 1, 0)
        .look(Shape.Smoke, r.signed() * 0.6, r.next() * TAU);
      this.grime.emit(s);
    }
  }

  /** Wood splinters flung out of a broken structure. */
  splinters(x: number, y: number, z: number, count: number): void {
    const s = this.s;
    const r = this.rng;
    const d = this.dir;
    for (let i = 0, n = this.n(count); i < n; i++) {
      r.unit(d);
      const sp = r.range(3, 8);
      const len = r.range(0.18, 0.34);
      s.reset()
        .at(x + d.x * 0.4, y + d.y * 0.4, z + d.z * 0.4)
        .vel(d.x * sp, Math.abs(d.y) * sp + 2, d.z * sp)
        .time(r.range(0.9, 1.4))
        .size(len, len * 0.9)
        .phys(15, 0.6)
        .from(i % 2 === 0 ? P.WOOD : P.WOOD_LIGHT, 1, 1)
        .to(P.WOOD, 0.8, 0.8)
        .look(Shape.Shard, r.signed() * 12, r.next() * TAU)
        .anim(0, r.range(6, 14));
      this.grime.emit(s);
    }
  }

  /** Building completed (y = ground): confetti cannon from the roof, sparkle stars, faction ring. */
  confetti(x: number, y: number, z: number, faction: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(80); i < n; i++) {
      const c = P.CONFETTI[i % P.CONFETTI.length];
      const sz = r.range(0.1, 0.17);
      s.reset()
        .at(x + r.signed() * 0.6, y + 3, z + r.signed() * 0.6)
        .vel(r.signed() * 4.5, r.range(7, 13), r.signed() * 4.5)
        .time(r.range(2.6, 3.6))
        .size(sz, sz)
        .phys(5.5, 2.2)
        .from(c, 1.25, 1)
        .to(c, 1.1, 0.15)
        .look(Shape.Chip, r.signed() * 9, r.next() * TAU)
        .anim(0, r.range(9, 16));
      this.grime.emit(s);
    }
    for (let i = 0, n = this.n(14); i < n; i++) {
      s.reset()
        .at(x, y + 3, z)
        .vel(r.signed() * 3, r.range(4, 8), r.signed() * 3)
        .time(0.9)
        .size(0.3, 0.05)
        .phys(3, 1.5)
        .from(i % 2 === 0 ? P.YELLOW : P.WHITE, 2.5, 1)
        .to(P.YELLOW, 1.2, 0)
        .look(Shape.Star, r.signed() * 6, r.next() * TAU);
      this.add.emit(s);
    }
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.5, 5.5, 0.3, 0.8, faction, 2);
  }

  /** Disabled building / destroyed GCC: dark smoke, splinters, embers, a scorch mark. */
  wreck(x: number, y: number, z: number, scale: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(14 * scale); i < n; i++) {
      s.reset()
        .at(x + r.signed() * 1.2 * scale, y + r.range(0.5, 2) * scale, z + r.signed() * 1.2 * scale)
        .vel(r.signed() * 0.8, r.range(1.2, 2.8), r.signed() * 0.8)
        .time(r.range(2.4, 3.8))
        .size(r.range(1, 1.6) * scale, r.range(3.2, 4.8) * scale)
        .phys(-0.3, 0.6)
        .from(P.SMOKE_DARK, 1, 0.75)
        .to(P.SMOKE, 0.8, 0)
        .look(Shape.Smoke, r.signed() * 0.4, r.next() * TAU)
        .anim(0, 0, 0.25);
      this.grime.emit(s);
    }
    this.splinters(x, y + 1, z, 16 * scale);
    for (let i = 0, n = this.n(22 * scale); i < n; i++) {
      s.reset()
        .at(x + r.signed() * scale, y + r.range(0.3, 1.5), z + r.signed() * scale)
        .vel(r.signed() * 2, r.range(2, 5), r.signed() * 2)
        .time(r.range(1.4, 2.6))
        .size(0.09, 0.02)
        .phys(-0.6, 0.9)
        .from(P.ORANGE, 3, 1)
        .to(P.EMBER, 1.5, 0)
        .anim(0.7, 0);
      this.add.emit(s);
    }
    s.reset().at(x, y + 1, z).time(0.2).size(3 * scale, 0.5).from(P.ORANGE, 1.3, 1).to(P.EMBER, 0.7, 0);
    this.add.emit(s);
    this.ground.ring(RingStyle.Scorch, x, y + 0.04, z, 2.2 * scale, 2.2 * scale, 0, 8, P.WHITE, 1);
  }

  /** Hearth Ward vibe-check pulse. */
  wardPulse(x: number, y: number, z: number, c: THREE.Color): void {
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 1, WARD_PULSE_RADIUS, 0.55, 0.85, c, 2.2);
    this.walls.spawn(x, y, z, 1, WARD_PULSE_RADIUS, 1.4, 0.8, c, 1.5);
  }

  // ── Crystal / Survey ───────────────────────────────────────────────────────

  /** Discharge strike point: electric sparks, a flash and a scorch mark. */
  dischargeImpact(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    const d = this.dir;
    for (let i = 0, n = this.n(20); i < n; i++) {
      r.unit(d);
      const sp = r.range(5, 12);
      s.reset()
        .at(x, y + 0.2, z)
        .vel(d.x * sp, Math.abs(d.y) * sp, d.z * sp)
        .time(r.range(0.25, 0.5))
        .size(0.07, 0)
        .phys(9, 3)
        .from(P.LILAC, 3.2, 1)
        .to(P.ELECTRIC, 1.4, 0)
        .look(Shape.Spark, 0, 0, 0.035);
      this.add.emit(s);
    }
    s.reset().at(x, y + 0.5, z).time(0.15).size(3, 0.5).from(P.LILAC, 1.8, 1).to(P.ELECTRIC, 0.8, 0);
    this.add.emit(s);
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.2, 3, 0.25, 0.35, P.ELECTRIC, 2.4);
    this.ground.ring(RingStyle.Scorch, x, y + 0.04, z, 1.3, 1.3, 0, 5, P.ELECTRIC, 1);
  }

  /** A Ley Line snapped: sparks fly both ways along the broken edge. (dx, dz) = unit edge dir. */
  leySnap(x: number, y: number, z: number, dx: number, dz: number, c: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(10); i < n; i++) {
      const sp = r.range(4, 8) * (i % 2 === 0 ? 1 : -1);
      s.reset()
        .at(x, y, z)
        .vel(dx * sp + r.signed() * 1.2, r.range(0.5, 2.5), dz * sp + r.signed() * 1.2)
        .time(r.range(0.3, 0.5))
        .size(0.07, 0)
        .phys(9, 2)
        .from(c, 3, 1)
        .to(P.WHITE, 1, 0)
        .look(Shape.Spark, 0, 0, 0.04);
      this.add.emit(s);
    }
    s.reset().at(x, y, z).time(0.14).size(0.9, 0.1).from(P.WHITE, 2, 1).to(c, 1, 0);
    this.add.emit(s);
  }

  /** Crystal manifests: pink/blue glass shards rising around a flash ring. */
  crystalManifest(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(26); i < n; i++) {
      const c = i % 2 === 0 ? P.PINK : P.GLASS_BLUE;
      const a = r.next() * TAU;
      const rad = r.range(0.5, 3);
      s.reset()
        .at(x + Math.cos(a) * rad, y + r.range(0, 1), z + Math.sin(a) * rad)
        .vel(-Math.cos(a) * 0.4, r.range(3, 7), -Math.sin(a) * 0.4)
        .time(r.range(1.2, 2))
        .size(r.range(0.3, 0.55), 0.05)
        .phys(-0.5, 0.9)
        .from(c, 2.6, 1)
        .to(P.WHITE, 1.4, 0)
        .look(Shape.Shard, r.signed() * 3, r.next() * TAU)
        .anim(0.2, r.range(5, 10));
      this.add.emit(s);
    }
    s.reset().at(x, y + 3, z).time(0.3).size(6, 1).from(P.PINK, 1.2, 1).to(P.GLASS_BLUE, 0.6, 0);
    this.add.emit(s);
    this.ground.ring(RingStyle.Glow, x, y + 0.05, z, 0.5, 8, 0.4, 0.9, P.PINK, 2.4);
    this.walls.spawn(x, y, z, 0.5, 6, 7, 0.9, P.GLASS_BLUE, 1.8);
  }

  /** Crystal shatters: a tumbling glass burst, glitter, a shock ring and a flash. */
  crystalShatter(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    const d = this.dir;
    for (let i = 0, n = this.n(46); i < n; i++) {
      const c = i % 2 === 0 ? P.PINK : P.GLASS_BLUE;
      r.unit(d);
      const sp = r.range(6, 14);
      s.reset()
        .at(x + d.x * 0.5, y + 2 + r.range(0, 4), z + d.z * 0.5)
        .vel(d.x * sp, Math.abs(d.y) * sp * 0.6 + 3, d.z * sp)
        .time(r.range(0.9, 1.6))
        .size(r.range(0.35, 0.7), 0.1)
        .phys(11, 0.9)
        .from(c, 2.8, 1)
        .to(c, 1.2, 0)
        .look(Shape.Shard, r.signed() * 14, r.next() * TAU)
        .anim(0.3, r.range(10, 22));
      this.add.emit(s);
    }
    for (let i = 0, n = this.n(30); i < n; i++) {
      r.unit(d);
      const sp = r.range(2, 7);
      s.reset()
        .at(x, y + 3, z)
        .vel(d.x * sp, d.y * sp, d.z * sp)
        .time(r.range(0.6, 1.2))
        .size(0.1, 0.02)
        .phys(2, 1.5)
        .from(i % 2 === 0 ? P.WHITE : P.PINK, 3, 1)
        .to(P.GLASS_BLUE, 1.5, 0)
        .anim(0.8, 0);
      this.add.emit(s);
    }
    s.reset().at(x, y + 3, z).time(0.22).size(7, 1).from(P.WHITE, 1.3, 1).to(P.PINK, 0.6, 0);
    this.add.emit(s);
    this.ground.ring(RingStyle.Shock, x, y + 0.05, z, 0.5, 9, 0.8, 0.7, P.PINK, 2.6);
  }

  // ── Abilities ──────────────────────────────────────────────────────────────

  /** Omega Pulse: shockwave to radius R, white edge, pentagram scorch, ground-skimming sparks, dust wave. */
  omega(x: number, y: number, z: number, R: number, c: THREE.Color, rotation: number): void {
    const s = this.s;
    const r = this.rng;
    this.ground.ring(RingStyle.Shock, x, y + 0.06, z, 0.6, R * 1.05, Math.max(1.2, R * 0.08), 0.9, c, 3.2);
    this.ground.ring(RingStyle.Glow, x, y + 0.06, z, 0.4, R * 1.18, 0.4, 0.65, P.WHITE, 1.2);
    this.ground.ring(RingStyle.Pentagram, x, y + 0.04, z, R * 0.92, R * 0.92, 0.3, 6, c, 1.4, 0, rotation);
    this.walls.spawn(x, y, z, 0.6, R, 5.5, 0.85, c, 2.4);
    this.walls.spawn(x, y, z, 0.5, R * 1.1, 2.4, 0.6, P.WHITE, 1.6);
    for (let i = 0, n = this.n(110); i < n; i++) {
      const a = (i / n) * TAU + r.signed() * 0.03;
      const sp = r.range(14, 26);
      s.reset()
        .at(x, y + 0.4, z)
        .vel(Math.cos(a) * sp, r.range(0.5, 3), Math.sin(a) * sp)
        .time(r.range(0.5, 0.9))
        .size(0.12, 0)
        .phys(6, 2.4)
        .from(c, 3.2, 1)
        .to(P.YELLOW, 1.4, 0)
        .look(Shape.Spark, 0, 0, 0.05);
      this.add.emit(s);
    }
    for (let i = 0, n = this.n(28); i < n; i++) {
      const a = (i / n) * TAU;
      const sp = r.range(10, 16);
      s.reset()
        .at(x + Math.cos(a) * 1.5, y + 0.4, z + Math.sin(a) * 1.5)
        .vel(Math.cos(a) * sp, r.range(0.2, 1), Math.sin(a) * sp)
        .time(r.range(0.9, 1.4))
        .size(0.8, 2.8)
        .phys(-0.2, 2.6)
        .from(P.DUST, 1, 0.6)
        .to(P.DUST_DARK, 1, 0)
        .look(Shape.Smoke, r.signed() * 0.5, r.next() * TAU);
      this.grime.emit(s);
    }
    // Five stars rise from the pentagram's points as it burns in.
    const rr = R * 0.92 * 0.9;
    for (let k = 0; k < 5; k++) {
      const a = rotation + (k / 5) * TAU;
      s.reset()
        .at(x + Math.cos(a) * rr, y + 0.3, z + Math.sin(a) * rr)
        .vel(0, r.range(3, 5), 0)
        .time(1.4, 0.15)
        .size(0.6, 0.1)
        .phys(0, 1)
        .from(P.YELLOW, 3, 1)
        .to(c, 1.5, 0)
        .look(Shape.Star, 2);
      this.add.emit(s);
    }
    s.reset().at(x, y + 1.5, z).time(0.25).size(R * 0.45, 1).from(c, 1.2, 1).to(P.WHITE, 0.6, 0);
    this.add.emit(s);
    s.reset().at(x, y + 1.2, z).time(0.1).size(3, 0.5).from(P.WHITE, 1.6, 1).to(P.WHITE, 0.8, 0);
    this.add.emit(s);
  }

  /** Phason Shift: glassy ripple plus a glitch where the Crystal turned. */
  phason(x: number, y: number, z: number, R: number, c: THREE.Color): void {
    this.ground.ring(RingStyle.Ripple, x, y + 0.06, z, 0.4, R, 0.45, 1.15, c, 2.2);
    this.ground.ring(RingStyle.Ripple, x, y + 0.06, z, 0.2, R * 0.6, 0.3, 0.9, P.CYAN, 1.6, 0.18);
    this.glassGlitch(x, y + 1, z, 0.8);
  }

  /** Cast flash for zone abilities (Stabilize, Beacon): ring + low wall + outward sparkles. */
  castFlash(x: number, y: number, z: number, c: THREE.Color, R: number): void {
    const s = this.s;
    const r = this.rng;
    this.ground.ring(RingStyle.Glow, x, y + 0.06, z, 0.5, R, 0.5, 0.7, c, 2.2);
    this.walls.spawn(x, y, z, 0.5, R * 0.7, 3, 0.6, c, 1.6);
    for (let i = 0, n = this.n(16); i < n; i++) {
      s.reset()
        .at(x, y + r.range(0.3, 2), z)
        .orbit(r.range(0.5, 1.5), r.range(1.5, 3), r.range(0.5, 2), r.next() * TAU, -1.6)
        .time(r.range(0.8, 1.1))
        .size(0.16, 0.03)
        .from(c, 3, 1)
        .to(P.WHITE, 1.5, 0)
        .look(Shape.Star, r.signed() * 5, r.next() * TAU);
      this.add.emit(s);
    }
  }

  /** Forced March cast: a ring sweeping the affected radius and radial speed lines. */
  marchCast(x: number, y: number, z: number, c: THREE.Color, R: number): void {
    const s = this.s;
    const r = this.rng;
    this.ground.ring(RingStyle.Glow, x, y + 0.06, z, 1, R, 0.5, 0.9, c, 2);
    for (let i = 0, n = this.n(40); i < n; i++) {
      const a = (i / n) * TAU;
      const sp = r.range(12, 20);
      s.reset()
        .at(x + Math.cos(a), y + r.range(0.3, 1.6), z + Math.sin(a))
        .vel(Math.cos(a) * sp, 0, Math.sin(a) * sp)
        .time(r.range(0.4, 0.6))
        .size(0.08, 0.02)
        .phys(0, 2.5)
        .from(c, 3, 1)
        .to(P.WHITE, 1, 0)
        .look(Shape.Spark, 0, 0, 0.08);
      this.add.emit(s);
    }
  }

  /** One Forced March speed line behind a moving hippie (vx, vz = its velocity). */
  marchTrail(x: number, y: number, z: number, vx: number, vz: number, c: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    const sp = Math.hypot(vx, vz);
    const back = sp > 0.1 ? 0.4 / sp : 0;
    s.reset()
      .at(x - vx * back + r.signed() * 0.25, y + r.range(0.3, 1.5), z - vz * back + r.signed() * 0.25)
      .vel(vx * 0.55, 0.15, vz * 0.55)
      .time(r.range(0.28, 0.42))
      .size(0.07, 0.02)
      .phys(0, 5)
      .from(c, 2.6, 0.9)
      .to(P.WHITE, 1.2, 0)
      .look(Shape.Spark, 0, 0, 0.09);
    this.add.emit(s);
  }

  /** One mote of the capture vortex, spiralling in toward the Hearth and up. */
  vortexMote(x: number, y: number, z: number, c: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    s.reset()
      .at(x, y + r.range(0.1, 1.5), z)
      .orbit(r.range(8, 15), r.range(0.5, 0.9), r.range(1.5, 4), r.next() * TAU, r.range(0.9, 1.3))
      .time(r.range(1.4, 2))
      .size(0.16, 0.05)
      .phys(-2.5, 0)
      .from(c, 2.4, 1)
      .to(P.YELLOW, 3, 0.3)
      .look(Shape.Spark, 0, 0, 0.05)
      .anim(0, 0, 0.3);
    this.add.emit(s);
  }

  /** One light mote riding up a Priority Beacon pillar. */
  beaconMote(x: number, y: number, z: number, c: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    s.reset()
      .at(x, y + r.range(0, 2), z)
      .orbit(r.range(1.2, 2.2), r.range(2, 3.2), r.range(5, 9), r.next() * TAU, 0.25)
      .time(r.range(1.6, 2.6))
      .size(0.16, 0.04)
      .from(c, 3, 1)
      .to(P.WHITE, 2, 0)
      .look(Shape.Spark, 0, 0, 0.05)
      .anim(0, 0, 0.2);
    this.add.emit(s);
  }

  // ── Conquest & spectacle ───────────────────────────────────────────────────

  /** Hearth captured: giant shockwave in the captor's colour, spark storm, rising stars, glitch. */
  captured(x: number, y: number, z: number, c: THREE.Color): void {
    const s = this.s;
    const r = this.rng;
    const d = this.dir;
    this.ground.ring(RingStyle.Shock, x, y + 0.06, z, 2, 95, 3.5, 2.4, c, 3);
    this.ground.ring(RingStyle.Glow, x, y + 0.06, z, 1, 70, 1, 1.8, P.WHITE, 2, 0.12);
    this.walls.spawn(x, y, z, 2, 70, 16, 2, c, 2.4);
    this.walls.spawn(x, y, z, 1, 40, 7, 1.2, P.WHITE, 1.4);
    for (let i = 0, n = this.n(260); i < n; i++) {
      r.unit(d);
      const sp = r.range(10, 34);
      s.reset()
        .at(x, y + 2, z)
        .vel(d.x * sp, Math.abs(d.y) * sp, d.z * sp)
        .time(r.range(1, 1.8))
        .size(0.22, 0)
        .phys(7, 1.3)
        .from(i % 3 === 0 ? P.YELLOW : c, 3, 1)
        .to(P.WHITE, 1.2, 0)
        .look(Shape.Spark, 0, 0, 0.05);
      this.add.emit(s);
    }
    for (let i = 0, n = this.n(40); i < n; i++) {
      s.reset()
        .at(x + r.signed() * 6, y + r.range(0, 3), z + r.signed() * 6)
        .vel(0, r.range(4, 12), 0)
        .time(r.range(1.6, 2.6))
        .size(0.5, 0.1)
        .phys(-1, 0.6)
        .from(P.YELLOW, 3, 1)
        .to(c, 1.6, 0)
        .look(Shape.Star, r.signed() * 4, r.next() * TAU)
        .anim(0.2, 0);
      this.add.emit(s);
    }
    this.glassGlitch(x, y + 3, z, 2.5);
    s.reset().at(x, y + 6, z).time(0.4).size(26, 4).from(c, 1.2, 1).to(P.WHITE, 0.6, 0);
    this.add.emit(s);
  }

  /** The Burn begins: an ember shockwave rolls out from the effigy and embers boil up. */
  burnStart(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    this.ground.ring(RingStyle.Shock, x, y + 0.06, z, 3, 60, 3, 2, P.ORANGE, 2.5);
    this.walls.spawn(x, y, z, 2, 45, 12, 1.6, P.EMBER, 2);
    for (let i = 0, n = this.n(60); i < n; i++) {
      const a = r.next() * TAU;
      const rad = r.range(1, 7);
      s.reset()
        .at(x + Math.cos(a) * rad, y + r.range(0.5, 6), z + Math.sin(a) * rad)
        .vel(r.signed() * 1.5, r.range(3, 9), r.signed() * 1.5)
        .time(r.range(2, 3.5))
        .size(0.14, 0.03)
        .phys(-0.8, 0.6)
        .from(P.ORANGE, 3, 1)
        .to(P.EMBER, 1.5, 0)
        .anim(0.7, 0);
      this.add.emit(s);
    }
  }

  /** D.E.G.E.N. mesh tapped: digital glitch blocks and scanlines around the avatar. */
  meshGlitch(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    for (let i = 0, n = this.n(46); i < n; i++) {
      const a = r.next() * TAU;
      const rad = r.range(0.8, 3);
      const sq = r.range(0.12, 0.4);
      const c = i % 2 === 0 ? P.CYAN : P.MAGENTA;
      s.reset()
        .at(x + Math.cos(a) * rad, y + r.range(0.1, 2.6), z + Math.sin(a) * rad)
        .vel(r.signed() * 0.6, 0, r.signed() * 0.6)
        .time(r.range(0.1, 0.32), r.range(0, 0.7))
        .size(sq, sq)
        .from(c, 2.8, 1)
        .to(c, 2.2, 0.6)
        .look(Shape.Glitch)
        .anim(0.5, 0, 0);
      this.add.emit(s);
    }
    for (let i = 0, n = this.n(18); i < n; i++) {
      const a = r.next() * TAU;
      const sp = r.range(10, 18) * (i % 2 === 0 ? 1 : -1);
      s.reset()
        .at(x + r.signed() * 0.6, y + r.range(0.2, 2.6), z + r.signed() * 0.6)
        .vel(-Math.sin(a) * sp, 0, Math.cos(a) * sp)
        .time(r.range(0.12, 0.25), r.range(0, 0.5))
        .size(0.04, 0.04)
        .from(i % 2 === 0 ? P.CYAN : P.MAGENTA, 3, 1)
        .to(P.WHITE, 2, 0)
        .look(Shape.Spark, 0, 0, 0.025);
      this.add.emit(s);
    }
    this.ground.ring(RingStyle.Ripple, x, y + 0.06, z, 0.3, 4, 0.3, 0.8, P.CYAN, 2);
  }

  /** Retransmit "TAKE A SHOT": dashed pulse rings rolling out over the mesh. */
  takeShot(x: number, y: number, z: number): void {
    const s = this.s;
    const r = this.rng;
    const pink = P.PING_COLORS.shot;
    this.ground.ring(RingStyle.Dashed, x, y + 0.06, z, 1, 30, 0.6, 1.5, pink, 2.4, 0, 0, 1.2);
    this.ground.ring(RingStyle.Dashed, x, y + 0.06, z, 1, 22, 0.45, 1.3, P.YELLOW, 1.8, 0.22, 0, -1.6);
    this.walls.spawn(x, y, z, 1, 26, 2.2, 1.2, pink, 1.4);
    for (let i = 0, n = this.n(20); i < n; i++) {
      s.reset()
        .at(x, y + 1.6, z)
        .vel(r.signed() * 3, r.range(3, 7), r.signed() * 3)
        .time(r.range(0.8, 1.2))
        .size(0.26, 0.05)
        .phys(4, 1.2)
        .from(i % 2 === 0 ? pink : P.YELLOW, 2.6, 1)
        .to(P.WHITE, 1.2, 0)
        .look(Shape.Star, r.signed() * 6, r.next() * TAU);
      this.add.emit(s);
    }
  }
}
