import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeMatch } from '../../sim/matchSettings';
import type { RenderContext } from '../context';
import type { GradeUniforms } from './grade';
import { PostFx } from './postfx';

function fixture(quality: RenderContext['quality']) {
  const ctx = {
    renderer: { getSize: (size: THREE.Vector2) => size.set(1280, 720), getPixelRatio: () => 1, toneMappingExposure: 1.42 },
    camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), quality, daylight: 0, time: 0, shared: {},
    session: { screen: 'playing' }, world: { options: { mode: 'standard', match: normalizeMatch({ bossMode: true }) }, time: 100, effigyRevealedAt: 100 },
  } as unknown as RenderContext;
  const post = new PostFx(ctx);
  const uniforms = (post as unknown as { uniforms: GradeUniforms }).uniforms;
  return { ctx, post, uniforms };
}
afterEach(() => vi.restoreAllMocks());

describe('one-second awakening final pass', () => {
  it.each(['low', 'medium', 'high'] as const)('samples authority directly on %s quality and clears without history', quality => {
    const render = vi.spyOn(EffectComposer.prototype, 'render').mockImplementation(() => {});
    const { ctx, post, uniforms } = fixture(quality);
    post.render(1 / 144); expect(uniforms.uAwakening.value).toBe(1);
    ctx.world.time = 100.7; post.render(0); expect(uniforms.uAwakening.value).toBeCloseTo(.5);
    // A paused replay sample holds exactly, regardless of presentation time or dt.
    ctx.session.screen = 'paused'; ctx.time = 1e4; post.render(2); expect(uniforms.uAwakening.value).toBeCloseTo(.5);
    ctx.world.time = 101; post.render(1 / 30); expect(uniforms.uAwakening.value).toBe(0);
    ctx.world.time = 100.2; post.render(0); expect(uniforms.uAwakening.value).toBe(1);
    for (const screen of ['title', 'lobby', 'ended'] as const) {
      ctx.session.screen = screen; post.render(0); expect(uniforms.uAwakening.value).toBe(0);
    }
    ctx.session.screen = 'playing'; ctx.world.effigyRevealedAt = null;
    post.render(0); expect(uniforms.uAwakening.value).toBe(0);
    const dispose = vi.spyOn(EffectComposer.prototype, 'dispose'); post.dispose(); expect(dispose).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(9);
  });
});
