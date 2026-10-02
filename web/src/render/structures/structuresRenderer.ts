/**
 * Structures: the Geomantic Command Center (pentagonal black cart, five-Flag pinwheel
 * sigils, Flag-spoke wheels, scroll, banner poles with the canvas-lettered yellow banner,
 * live miniature-map tabletop), Flag Hearths (stock visibly piled, stage-coloured flame),
 * Workshop, Drum Circle, Hearth Ward, Drug Lab, construction/damaged/disabled states,
 * Fortnite pieces (tarp walls, decks, ramps) with pop-in, building placement ghosts.
 * Owner: RenderStructures agent.
 */
import * as THREE from 'three';
import type { RenderContext, RenderModule } from '../context';

export class StructuresRenderer implements RenderModule {
  private ctx: RenderContext;
  private meshes = new Map<number, THREE.Mesh>();

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
  }

  update(dt: number): void {
    const w = this.ctx.world;
    for (const b of w.buildings.values()) {
      if (this.meshes.has(b.id)) continue;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2.4, b.kind === 'hearth' ? 4 : 2.5, 5),
        new THREE.MeshStandardMaterial({ color: b.faction >= 0 ? w.factions[b.faction].color : 0x888888 }),
      );
      m.position.set(b.pos.x, 1.2, b.pos.z);
      this.ctx.scene.add(m);
      this.meshes.set(b.id, m);
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) this.ctx.scene.remove(m);
  }
}
