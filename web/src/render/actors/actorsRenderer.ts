/**
 * Actors: vexillomancer avatars (balaclava + Moebius hat for Dr. Beef Supreme, distinct
 * silhouettes per rival), instanced hippies with procedural animation and tie-dye variety,
 * every Flag (planted/loose/carried quiver bundles/flying) as instanced yellow cloth with a
 * wind shader and faction ribbon, KO/stun/distracted states, D.E.G.E.N. status icons,
 * dropped beacons, Crystals. Publishes ctx.shared.unitAnchors.
 * Owner: RenderActors agent.
 */
import * as THREE from 'three';
import type { RenderContext, RenderModule } from '../context';

export class ActorsRenderer implements RenderModule {
  private ctx: RenderContext;
  private flagMesh: THREE.InstancedMesh;
  private unitMesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.flagMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.6, 0.05).translate(0.45, 2.4, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd400 }),
      2048,
    );
    this.unitMesh = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.4, 1, 4, 8).translate(0, 0.9, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
      1024,
    );
    ctx.scene.add(this.flagMesh, this.unitMesh);
  }

  update(dt: number): void {
    const w = this.ctx.world;
    let i = 0;
    for (const f of w.flags.values()) {
      if (f.state !== 'planted' && f.state !== 'loose' && f.state !== 'flying') continue;
      this.m.makeTranslation(f.pos.x, f.pos.y, f.pos.z);
      this.flagMesh.setMatrixAt(i++, this.m);
    }
    this.flagMesh.count = i;
    this.flagMesh.instanceMatrix.needsUpdate = true;
    let u = 0;
    const c = new THREE.Color();
    for (const h of w.hippies.values()) {
      this.m.makeTranslation(h.pos.x, 0, h.pos.z);
      this.unitMesh.setMatrixAt(u, this.m);
      this.unitMesh.setColorAt(u++, c.setHex(h.faction >= 0 ? w.factions[h.faction].color : 0xd8d2c0));
    }
    for (const a of w.avatars.values()) {
      this.m.makeScale(1.3, 1.3, 1.3).setPosition(a.pos.x, a.pos.y, a.pos.z);
      this.unitMesh.setMatrixAt(u, this.m);
      this.unitMesh.setColorAt(u++, c.setHex(w.factions[a.faction].color));
    }
    this.unitMesh.count = u;
    this.unitMesh.instanceMatrix.needsUpdate = true;
    if (this.unitMesh.instanceColor) this.unitMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.ctx.scene.remove(this.flagMesh, this.unitMesh);
  }
}
