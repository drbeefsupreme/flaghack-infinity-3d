/**
 * Event-driven VFX: GPU-instanced particle pools (plant bursts, pull sparks, staff hits,
 * splinters, KO puffs, harvest chips, crystal shards, discharge lightning arcs, phason ripples,
 * Omega Pulse shockwave, Stabilize dome, Priority Beacon pillar, Forced March trails, capture
 * vortex + "OVERWRITTEN" burst, fireworks at The Burn, ping beacons), screen shake requests.
 * Owner: RenderSurvey agent.
 */
import type { GameEvent } from '../../sim/events';
import type { RenderContext, RenderModule } from '../context';

export class VfxRenderer implements RenderModule {
  private ctx: RenderContext;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
  }

  onEvent(e: GameEvent): void {}

  update(dt: number): void {}

  dispose(): void {}
}
