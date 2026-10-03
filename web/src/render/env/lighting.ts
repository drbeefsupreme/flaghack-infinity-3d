/**
 * Scene lights: hemisphere sky/ground fill, one directional sun/moon light with a shadow map
 * that follows the camera's focus (texel-snapped so shadows don't swim), and the effigy's
 * fire light. The light count never changes during a match (the fire light exists from the
 * start at intensity 0), so no material ever recompiles mid-game.
 */
import * as THREE from 'three';
import type { RenderContext } from '../context';
import type { DayState, EnvPart } from './envTypes';

interface ShadowTier {
  mapSize: number;
  /** Half extent (m) of the shadow box in action view. */
  radius: number;
}

const SHADOW_TIERS: Record<RenderContext['quality'], ShadowTier | null> = {
  low: null,
  medium: { mapSize: 1536, radius: 48 },
  high: { mapSize: 2048, radius: 60 },
};

/** Distance from the focus point to the light (the shadow camera's eye). */
const LIGHT_DISTANCE = 220;

export class EnvLighting implements EnvPart {
  readonly fireLight: THREE.PointLight;
  private ctx: RenderContext;
  private day: DayState;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private tier: ShadowTier | null;
  private radius = 0;
  // Scratch (no per-frame allocation).
  private focus = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private lx = new THREE.Vector3();
  private ly = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(ctx: RenderContext, root: THREE.Group, day: DayState) {
    this.ctx = ctx;
    this.day = day;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.tier = SHADOW_TIERS[ctx.quality];
    if (this.tier) {
      const s = this.sun.shadow;
      this.sun.castShadow = true;
      s.mapSize.set(this.tier.mapSize, this.tier.mapSize);
      s.camera.near = 20;
      s.camera.far = LIGHT_DISTANCE + 160;
      s.bias = -0.0004;
      s.normalBias = 0.035;
      s.radius = 2;
    }
    this.fireLight = new THREE.PointLight(0xff7a2a, 0, 140, 1.4);
    this.fireLight.position.set(0, 12, 0);
    root.add(this.hemi, this.sun, this.sun.target, this.fireLight);
    // The hemisphere light is fixed and placeSun() recomposes the sun pair itself; the fire
    // light keeps auto updates because the Burn moves it every frame.
    for (const o of [this.hemi, this.sun, this.sun.target]) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    }
  }

  update(_dt: number): void {
    const day = this.day;
    this.hemi.color.copy(day.hemiSky);
    this.hemi.groundColor.copy(day.hemiGround);
    this.hemi.intensity = day.hemiIntensity;
    this.sun.color.copy(day.lightColor);
    this.sun.intensity = day.lightIntensity;
    this.placeSun();
  }

  /** Centre the light (and its shadow box) on the camera's focus, snapped to shadow texels. */
  private placeSun(): void {
    const cam = this.ctx.camera;
    const dir = this.day.lightDir;
    cam.getWorldDirection(this.fwd);
    const camH = Math.max(1, cam.position.y);
    const base = this.tier?.radius ?? 60;
    // Higher cameras (Command View) see more ground: widen the box, trading resolution.
    const radius = Math.min(150, Math.max(base, camH * 1.05));
    let reach = radius * 0.55;
    if (this.fwd.y < -0.05) reach = Math.min(reach, camH / -this.fwd.y);
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    this.focus.set(cam.position.x + (this.fwd.x / fl) * reach, 0, cam.position.z + (this.fwd.z / fl) * reach);

    if (this.tier) {
      if (radius !== this.radius) {
        this.radius = radius;
        const c = this.sun.shadow.camera;
        c.left = -radius;
        c.right = radius;
        c.top = radius;
        c.bottom = -radius;
        c.updateProjectionMatrix();
      }
      // Snap the focus to whole shadow texels in the light's view plane.
      const texel = (radius * 2) / this.tier.mapSize;
      this.lx.crossVectors(this.up, dir).normalize();
      this.ly.crossVectors(dir, this.lx);
      const u = Math.round(this.focus.dot(this.lx) / texel) * texel;
      const v = Math.round(this.focus.dot(this.ly) / texel) * texel;
      const w = this.focus.dot(dir);
      this.focus.copy(this.lx).multiplyScalar(u).addScaledVector(this.ly, v).addScaledVector(dir, w);
    }
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(dir, LIGHT_DISTANCE);
    this.sun.updateMatrix();
    this.sun.target.updateMatrix();
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.fireLight.dispose();
  }
}
