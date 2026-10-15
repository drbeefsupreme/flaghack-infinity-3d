import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BOSS_FORCEFIELD_CENTER_HEIGHT, BOSS_FORCEFIELD_HEIGHT, BOSS_FORCEFIELD_WIDTH } from '../../sim/bossForcefield';
import { FACTION_DEFS } from '../../sim/constants';
import type { EventOf } from '../../sim/events';
import { BARRIER_SHATTER_CAPACITY, BARRIER_SHATTER_DEDUP_CAPACITY, BARRIER_SHATTER_MAX_LIFE, BarrierShatter } from './barrierShatter';
import { Shape } from './particles';
import { VfxRenderer } from './vfxRenderer';

type Break = EventOf<'bossBarrierShattered'>;
const segment = (edge = 7): Break['segments'][number] => ({
  edge, faction: 2, color: FACTION_DEFS[2].color, pos: { x: 30, y: 6 + BOSS_FORCEFIELD_CENTER_HEIGHT, z: -20 }, yaw: .7,
});
const event = (breakId = 1, segments = [segment()]): Break => ({ t: 'bossBarrierShattered', bossId: 99, breakId, at: 3, segments });
const make = (density = 1) => new BarrierShatter({ uTime: { value: 0 }, uViewportH: { value: 720 }, uLight: { value: 1 } }, 17, density);
const attr = (fx: BarrierShatter, index: number) => fx.mesh.geometry.getAttribute(`a${index}`);
const rows = (fx: BarrierShatter, index: number) => Array.from({ length: fx.mesh.geometry.instanceCount }, (_, i) =>
  [attr(fx, index).getX(i), attr(fx, index).getY(i), attr(fx, index).getZ(i), attr(fx, index).getW(i)]);
const buffer = (fx: BarrierShatter) => (attr(fx, 0) as THREE.InterleavedBufferAttribute).data.array;

describe('boss loop-barrier shatter', () => {
  it('covers the visible clipped ellipse with additive loop-colored chips and shards', () => {
    const fx = make(), e = event(), before = JSON.stringify(e), plane = e.segments[0];
    Object.freeze(plane.pos); Object.freeze(plane); Object.freeze(e.segments); Object.freeze(e);
    fx.onEvent(e, 10); fx.update(10);
    expect(fx.mesh.visible).toBe(true);
    expect(fx.mesh.material.defines.ADDITIVE).toBe('');
    expect(fx.mesh.material.depthWrite).toBe(false);
    expect(fx.mesh.children).toHaveLength(0);
    const local = rows(fx, 0).map(([x, y, z, born]) => {
      const dx = x - plane.pos.x, dz = z - plane.pos.z;
      const lx = dx * Math.cos(plane.yaw) - dz * Math.sin(plane.yaw), ly = y - plane.pos.y;
      expect(dx * Math.sin(plane.yaw) + dz * Math.cos(plane.yaw)).toBeCloseTo(0, 5);
      const r = Math.hypot(lx / BOSS_FORCEFIELD_WIDTH, ly * 1.65 / BOSS_FORCEFIELD_HEIGHT);
      expect(r).toBeGreaterThanOrEqual(.09999); expect(r).toBeLessThanOrEqual(.58001);
      expect(Math.abs(lx)).toBeLessThanOrEqual(BOSS_FORCEFIELD_WIDTH * .49001);
      expect(y).toBeGreaterThan(plane.pos.y - BOSS_FORCEFIELD_CENTER_HEIGHT);
      expect(born).toBe(10);
      return [lx, ly, r];
    });
    for (const axis of [0, 1]) {
      expect(local.some(r => r[axis] > 4)).toBe(true);
      expect(local.some(r => r[axis] < -4)).toBe(true);
    }
    expect(local.some(r => r[2] < .3)).toBe(true);
    expect(local.some(r => r[2] > .45)).toBe(true);
    expect(local.filter(r => r[2] >= .385 && r[2] <= .416).length).toBeGreaterThan(12);
    const tint = new THREE.Color(plane.color);
    for (const [r, g, b, alpha] of rows(fx, 3)) {
      expect(r).toBeCloseTo(tint.r * 1.9); expect(g).toBeCloseTo(tint.g * 1.9); expect(b).toBeCloseTo(tint.b * 1.9); expect(alpha).toBeCloseTo(.95);
    }
    for (const [r, g, b, alpha] of rows(fx, 4)) {
      expect(r).toBeCloseTo(tint.r * .65); expect(g).toBeCloseTo(tint.g * .65); expect(b).toBeCloseTo(tint.b * .65); expect(alpha).toBe(0);
    }
    const shapes = rows(fx, 5).map(r => r[0]);
    expect(new Set(shapes)).toEqual(new Set([Shape.Chip, Shape.Shard]));
    for (const [size] of rows(fx, 2)) { expect(size).toBeGreaterThanOrEqual(.26999); expect(size).toBeLessThanOrEqual(.55001); }
    expect(JSON.stringify(e)).toBe(before); fx.dispose();
  });

  it('bursts radially away from every plane center, rather than falling as dust', () => {
    const fx = make(), plane = segment(); fx.onEvent(event(), 0); fx.update(0);
    const positions = rows(fx, 0), velocities = rows(fx, 1);
    for (let i = 0; i < positions.length; i++) {
      const [x, y, z] = positions[i], [vx, vy, vz, life] = velocities[i];
      const dx = x - plane.pos.x, dy = y - plane.pos.y, dz = z - plane.pos.z;
      const dot = dx * vx + dy * vy + dz * vz;
      expect(dot / Math.hypot(dx, dy, dz)).toBeGreaterThanOrEqual(6.9999);
      expect(dot / Math.hypot(dx, dy, dz)).toBeLessThanOrEqual(14.0001);
      expect(dot / (Math.hypot(dx, dy, dz) * Math.hypot(vx, vy, vz))).toBeGreaterThan(.94);
      expect(life).toBeGreaterThanOrEqual(.71999); expect(life).toBeLessThanOrEqual(BARRIER_SHATTER_MAX_LIFE + 1e-6);
    }
    fx.dispose();
  });

  it('preserves event position, yaw and per-segment color, independent of rebuilt topology', () => {
    const a = make(), b = make(), base = segment(), turned = { ...base, yaw: Math.PI / 2 };
    a.onEvent(event(1, [{ ...base, yaw: 0 }]), 0); b.onEvent(event(1, [turned]), 0);
    a.update(0); b.update(0);
    const pa = rows(a, 0), pb = rows(b, 0), va = rows(a, 1), vb = rows(b, 1);
    for (let i = 0; i < pa.length; i++) {
      expect(pb[i][0]).toBeCloseTo(base.pos.x);
      expect(pb[i][1]).toBeCloseTo(pa[i][1]);
      expect(pb[i][2] - base.pos.z).toBeCloseTo(-(pa[i][0] - base.pos.x), 4);
      expect(vb[i][0]).toBeCloseTo(va[i][2]); expect(vb[i][1]).toBeCloseTo(va[i][1]); expect(vb[i][2]).toBeCloseTo(-va[i][0]);
    }
    const c = make(), e = event(2, [base, { ...base, edge: 8, color: 0xff0000, pos: { x: -100, y: 70, z: 200 } }]);
    c.onEvent(e, 0); c.update(0);
    const perSegment = c.mesh.geometry.instanceCount / 2;
    for (const [x, y, z] of rows(c, 0).slice(perSegment)) { expect(x).toBeLessThan(-90); expect(y).toBeGreaterThan(58); expect(z).toBeGreaterThan(190); }
    for (const [r, g, blue] of rows(c, 3).slice(perSegment)) { expect(r).toBeCloseTo(1.9); expect(g).toBe(0); expect(blue).toBe(0); }
    e.segments[0].color = 0; e.segments[0].pos.x = 999; c.update(.1);
    expect(attr(c, 0).getX(0)).toBeLessThan(40); expect(attr(c, 3).getY(0)).toBeGreaterThan(0);
    for (const fx of [a, b, c]) fx.dispose();
  });

  it('deduplicates mirrored boss/break IDs but permits new breaks on the same edge and out-of-order facts', () => {
    const fx = make(); fx.onEvent(event(11), 5); fx.update(5); const count = fx.mesh.geometry.instanceCount;
    fx.onEvent(event(11), 5); fx.update(5); expect(fx.mesh.geometry.instanceCount).toBe(count);
    fx.onEvent(event(10), 5); fx.update(5); expect(fx.mesh.geometry.instanceCount).toBe(count * 2);
    fx.onEvent({ ...event(11), bossId: 100 }, 5); fx.update(5); expect(fx.mesh.geometry.instanceCount).toBe(count * 3);
    fx.update(7); fx.onEvent(event(11), 7); fx.update(7); expect(fx.mesh.visible).toBe(false);
    fx.onEvent(event(12), 7); fx.update(7); expect(fx.mesh.geometry.instanceCount).toBe(count); fx.dispose();
  });

  it('starts delayed network facts at render time, expires the draw, and never reconstructs from state', () => {
    const fx = make(); fx.update(1000); expect(fx.mesh.visible).toBe(false);
    fx.onEvent({ ...event(), at: 1 }, 1000); fx.update(1000);
    for (const [, , , born] of rows(fx, 0)) expect(born).toBe(1000);
    fx.update(1000.5); expect(fx.mesh.visible).toBe(true);
    fx.update(1000 + BARRIER_SHATTER_MAX_LIFE);
    expect(fx.mesh.visible).toBe(false); expect(fx.mesh.geometry.instanceCount).toBe(0);
    fx.update(2000); expect(fx.mesh.visible).toBe(false); fx.dispose();
  });

  it('has deterministic bounded storage and one draw for simultaneous many-segment shatters', () => {
    const a = make(), b = make(), original = buffer(a);
    const e = event(1, Array.from({ length: 300 }, (_, edge) => ({ ...segment(edge), pos: { x: edge * 20, y: 12, z: 0 } })));
    for (const fx of [a, b]) { fx.onEvent(e, 5); fx.update(5); }
    expect(a.mesh.geometry.instanceCount).toBe(BARRIER_SHATTER_CAPACITY);
    expect(buffer(a)).toBe(original); expect(buffer(b)).toEqual(original);
    expect(a.mesh.children).toHaveLength(0);
    // Even a saturated break represents all its planes, including the first/nearest.
    expect(new Set(rows(a, 0).map(([x]) => Math.round(x / 20))).size).toBe(300);
    for (const fx of [a, b]) fx.dispose();
  });

  it('bounds duplicate history for arbitrarily long sessions', () => {
    const fx = make();
    for (let id = 0; id <= BARRIER_SHATTER_DEDUP_CAPACITY; id++) fx.onEvent(event(id), id);
    fx.update(BARRIER_SHATTER_DEDUP_CAPACITY + 2); expect(fx.mesh.visible).toBe(false);
    fx.onEvent(event(BARRIER_SHATTER_DEDUP_CAPACITY), BARRIER_SHATTER_DEDUP_CAPACITY + 2); fx.update(BARRIER_SHATTER_DEDUP_CAPACITY + 2);
    expect(fx.mesh.visible).toBe(false);
    fx.onEvent(event(0), BARRIER_SHATTER_DEDUP_CAPACITY + 2); fx.update(BARRIER_SHATTER_DEDUP_CAPACITY + 2);
    expect(fx.mesh.visible).toBe(true); fx.dispose();
  });

  it('clears particles and IDs on reset/rewind, reuses buffers and disposes exactly once', () => {
    const fx = make(), scene = new THREE.Scene(), original = buffer(fx); scene.add(fx.mesh);
    fx.onEvent(event(), 10); fx.update(10); fx.reset(); expect(fx.mesh.visible).toBe(false);
    fx.onEvent(event(), 11); fx.update(11); expect(fx.mesh.visible).toBe(true);
    fx.update(0); expect(fx.mesh.visible).toBe(false);
    fx.onEvent(event(), 0); fx.update(0); expect(fx.mesh.visible).toBe(true);
    fx.onEvent(event(), -1); fx.update(-1); expect(fx.mesh.visible).toBe(true); expect(attr(fx, 0).getW(0)).toBe(-1);
    expect(buffer(fx)).toBe(original);
    const geometry = vi.spyOn(fx.mesh.geometry, 'dispose'), material = vi.spyOn(fx.mesh.material, 'dispose');
    fx.dispose(); fx.dispose(); fx.onEvent(event(3), 0); fx.update(0);
    expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce(); expect(scene.children).toHaveLength(0);
    expect(fx.mesh.visible).toBe(false); expect(fx.mesh.geometry.instanceCount).toBe(0);
  });

  it('skips malformed input without poisoning the valid event ID', () => {
    const fx = make();
    for (const e of [{ ...event(), breakId: NaN }, { ...event(), bossId: .5 }, { ...event(), at: Infinity }, event(1, []),
      event(1, [{ ...segment(), yaw: NaN }]), event(1, [{ ...segment(), color: NaN }])]) fx.onEvent(e, 10);
    fx.onEvent(event(), NaN); fx.update(10); expect(fx.mesh.visible).toBe(false);
    fx.onEvent(event(), 10); fx.update(10); expect(fx.mesh.visible).toBe(true);
    fx.update(NaN); expect(fx.mesh.visible).toBe(true); fx.dispose();
  });

  it('low quality keeps every segment visible with fewer perceptible fragments', () => {
    const low = make(.45), high = make();
    for (const fx of [low, high]) { fx.onEvent(event(1, [segment(1), segment(2)]), 0); fx.update(0); }
    expect(low.mesh.geometry.instanceCount).toBeGreaterThan(30);
    expect(low.mesh.geometry.instanceCount).toBeLessThan(high.mesh.geometry.instanceCount);
    for (const [size] of rows(low, 2)) expect(size).toBeGreaterThan(.26);
    low.dispose(); high.dispose();
  });

  it('routes authoritative shatters before routine budget or any updated world/topology lookup', () => {
    const fx = make(), spend = vi.fn(() => false), ctx = { time: 3, get world(): never { throw new Error('must not inspect reconstructed topology'); } };
    const stub = { ctx, barrierShatter: fx, syncClock: vi.fn(), spend };
    VfxRenderer.prototype.onEvent.call(stub as unknown as VfxRenderer, event()); fx.update(3);
    expect(fx.mesh.visible).toBe(true); expect(spend).not.toHaveBeenCalled(); fx.dispose();
  });
});
