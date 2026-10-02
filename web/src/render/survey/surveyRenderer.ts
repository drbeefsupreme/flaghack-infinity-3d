/**
 * Survey layer: Ley Lattice lines + node markers (near the player in action mode, full map in
 * Command View with the 2017 cyan/red noise ground tint), Ley Lines (glowing faction beams),
 * crystallized/enclosed facets (translucent faction-tinted crystal glass with sweeping fill
 * on surveyChanged), plan ghost Flags, implied Flags (ghost yellow with halo), focus points
 * (when revealed), interference moiré on unstable facets, phason flip animations, Hearth
 * stage rings and containment beams, build ghosts and throw arc.
 * Owner: RenderSurvey agent.
 */
import * as THREE from 'three';
import type { RenderContext, RenderModule } from '../context';

export class SurveyRenderer implements RenderModule {
  private ctx: RenderContext;
  private lines: THREE.LineSegments;
  private builtVersion = -1;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    ctx.scene.add(this.lines);
  }

  update(dt: number): void {
    const lat = this.ctx.world.lattice;
    if (lat.version === this.builtVersion) return;
    this.builtVersion = lat.version;
    const pos = new Float32Array(lat.edges.length * 6);
    lat.edges.forEach((e, i) => {
      const a = lat.nodes[e.a];
      const b = lat.nodes[e.b];
      pos.set([a.x, 0.05, a.z, b.x, 0.05, b.z], i * 6);
    });
    this.lines.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }

  dispose(): void {
    this.ctx.scene.remove(this.lines);
    this.lines.geometry.dispose();
  }
}
