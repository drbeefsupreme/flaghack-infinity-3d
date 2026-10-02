/**
 * Post-processing: bloom (ley lines, crystals, flags glow at night), colour grading by time
 * of day, Command View parchment/ink grade, drug effects (Luminous Dust shimmer/kaleidoscope,
 * Acid Cop Vision chromatic split/edge-detect, Saffron golden glow / crash desaturation),
 * damage and capture flashes, vignette. Reads ctx.shared.fx.
 * Owner: RenderWorld agent.
 */
import type { RenderContext } from '../context';

export class PostFx {
  private ctx: RenderContext;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
  }

  setSize(w: number, h: number): void {}

  render(dt: number): void {
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  }

  dispose(): void {}
}
