/**
 * Environment: sky, sun/moon, day–night cycle, fog, ground (grass/dirt/roads/mud/pond),
 * map props (tents, domes, art, porta rows, trees, sound camps with lights, the Flag effigy
 * and its Burn), lumber piles, ambient particles. Sets ctx.sunDir / ctx.daylight.
 * Owner: RenderWorld agent.
 */
import * as THREE from 'three';
import type { RenderContext, RenderModule } from '../context';

export class EnvRenderer implements RenderModule {
  private ctx: RenderContext;
  private objects: THREE.Object3D[] = [];

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    const scene = ctx.scene;
    scene.background = new THREE.Color(0x8fb8d8);
    scene.fog = new THREE.Fog(0x8fb8d8, 120, 420);
    const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a2a, 1.4);
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sun.position.set(80, 140, 60);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ctx.world.map.half * 2.6, ctx.world.map.half * 2.6),
      new THREE.MeshStandardMaterial({ color: 0x6f8f3f, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.objects.push(hemi, sun, ground);
    for (const o of this.objects) scene.add(o);
    ctx.sunDir.copy(sun.position).normalize();
    ctx.daylight = 1;
  }

  update(dt: number): void {}

  dispose(): void {
    for (const o of this.objects) this.ctx.scene.remove(o);
  }
}
