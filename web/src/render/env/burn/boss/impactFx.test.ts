import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BossImpactFx } from './impactFx';
import type { EnvContext } from '../../envTypes';
import type { GameEvent } from '../../../../sim/events';

function env(): EnvContext {
  return { ctx: { world: { time: 100, boss: { id: 99 }, map: { effigy: { x: 20, z: -30 } }, factions: [{ color: 0x33ccff }] },
    renderer: { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280,720) }, camera: { fov: 60 } } } as unknown as EnvContext;
}
const event: GameEvent = { t: 'bossImpact', bossId: 99, by: 12, flagId: 54, faction: 0, pos: { x: 44, y: 17, z: 8 }, headshot: true, amount: 100 };
describe('authoritative boss-impact fireworks', () => {
  it('bursts at the exact impact position and does not emit twice for the same destroyed flag', () => {
    const e = env(), fx = new BossImpactFx(e), before = JSON.stringify(e.ctx.world);
    fx.onEvent(event); fx.onEvent(event); fx.update(100.1);
    const shown = fx.group.children.filter((o) => o.visible) as THREE.Points<THREE.BufferGeometry,THREE.ShaderMaterial>[];
    expect(shown).toHaveLength(1); expect(shown[0].position.toArray()).toEqual([24,17,38]);
    expect(shown[0].material.uniforms.uPower.value).toBe(1.35);
    expect(shown[0].material.uniforms.uColor.value.getHex()).toBe(0x33ccff);
    expect(shown[0].geometry.getAttribute('position').count).toBe(176);
    expect(JSON.stringify(e.ctx.world)).toBe(before);
    fx.update(101.5); expect(fx.group.children.some((o) => o.visible)).toBe(false); fx.dispose();
  });
  it('ignores other bosses and ordinary hits; body-hit bursts are also colorful fireworks', () => {
    const e = env(), fx = new BossImpactFx(e);
    fx.onEvent({ ...event, bossId: 88 });
    fx.onEvent({ t: 'hit', target: 99, by: 12, amount: 50, pos: event.pos });
    expect(fx.group.children.some((o) => o.visible)).toBe(false);
    fx.onEvent({ ...event, headshot: false, amount: 50 });
    const shown = fx.group.children.find((o) => o.visible) as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(shown.material.uniforms.uPower.value).toBe(1); fx.dispose();
  });
});
