/**
 * Player controls: keyboard/mouse input, pointer lock, third-person action camera with
 * collision-aware boom, Command View camera (Tab) with the GCC-table transition, title
 * cinematic camera, crosshair picking (node/edge/facet/entity), throw aim arc, build ghosts,
 * context prompts, Command View selection/orders/plan tools, hotkeys → Commands.
 * Owner: Controls agent.
 */
import type { AppApi } from './app';

export class Controls {
  private app: AppApi;
  private canvas: HTMLCanvasElement;
  private t = 0;

  constructor(app: AppApi, canvas: HTMLCanvasElement) {
    this.app = app;
    this.canvas = canvas;
  }

  /** Per frame: input → camera, session (hover/aim/ghost/prompt) and discrete commands. */
  update(dt: number): void {
    this.t += dt;
    const world = this.app.world;
    if (!world) return;
    const av = world.avatarOf(this.app.session.playerFaction);
    const cam = this.app.renderer.camera;
    const a = this.t * 0.08;
    cam.position.set(av.pos.x + Math.cos(a) * 40, 28, av.pos.z + Math.sin(a) * 40);
    cam.lookAt(av.pos.x, 0, av.pos.z);
  }

  /** Per sim tick: submit the player's continuous avatarInput. */
  tick(): void {}

  dispose(): void {}
}
