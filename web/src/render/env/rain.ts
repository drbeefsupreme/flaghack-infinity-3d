/** One bounded GPU-animated draw; no CPU particle updates or collision queries. */
import * as THREE from 'three';
import { hash01 } from '../../sim/rng';
import { TERRAIN_GLSL } from '../../sim/terrain';
import type { RenderContext } from '../context';
import type { EnvContext, EnvPart } from './envTypes';
import { burnStormLevel } from './burnWeather';
export const RAIN_COUNTS: Record<RenderContext['quality'], number> = { low: 700, medium: 1400, high: 2200 };
export const RAIN_BOX = 76;
export const RAIN_HEIGHT = 44;
export const RAIN_VERTEX = /* glsl */ `
${TERRAIN_GLSL}
attribute vec3 aSeed;
attribute float aEnd;
uniform vec3 uFocus;
uniform float uTime;
uniform float uHalf;
uniform float uStorm;
varying float vAlpha;
void main() {
  float speed = 23.0 + aSeed.z * 10.0;
  vec3 p;
  p.xz = uFocus.xz + mod(aSeed.xy * ${RAIN_BOX.toFixed(1)} + vec2(3.6, 1.4) * uTime - uFocus.xz + 38.0, ${RAIN_BOX.toFixed(1)}) - 38.0;
  p.y = uFocus.y - 12.0 + mod(aSeed.z * ${RAIN_HEIGHT.toFixed(1)} - uTime * speed, ${RAIN_HEIGHT.toFixed(1)});
  p += vec3(-0.15, 1.0, -0.06) * aEnd * (0.7 + aSeed.z * 0.65);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rim = 1.0 - smoothstep(25.0, 38.0, length(p.xz - uFocus.xz));
  float vertical = smoothstep(-12.0, -8.0, p.y - uFocus.y) * (1.0 - smoothstep(27.0, 32.0, p.y - uFocus.y));
  vAlpha = uStorm * rim * vertical * smoothstep(1.0, 4.0, -mv.z) * (1.0 - smoothstep(40.0, 65.0, -mv.z));
  vAlpha *= smoothstep(0.0, 0.6, p.y - groundHeight(p.xz, uHalf));
  vAlpha *= mix(0.34, 0.12, aEnd);
  gl_Position = projectionMatrix * mv;
}
`;
export const RAIN_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() { gl_FragColor = vec4(0.40, 0.49, 0.61, vAlpha); }
`;
export class BurnRain implements EnvPart {
  private mesh: THREE.LineSegments;
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private focus = { value: new THREE.Vector3() };
  private storm = { value: 0 };
  private time = { value: 0 };
  private forward = new THREE.Vector3();
  constructor(private env: EnvContext) {
    const count = RAIN_COUNTS[env.ctx.quality];
    const seed = new Float32Array(count * 6), ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 3; j++) seed[i * 6 + j] = seed[i * 6 + 3 + j] = hash01(i * 3 + j + 8741);
      ends[i * 2 + 1] = 1;
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    this.geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uFocus: this.focus, uStorm: this.storm, uTime: this.time, uHalf: { value: env.ctx.world.map.half } },
      vertexShader: RAIN_VERTEX, fragmentShader: RAIN_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      // Composite RGB normally but preserve the opaque boss silhouette alpha mask.
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.LineSegments(this.geometry, this.material);
    this.mesh.name = 'burn-night-rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    env.root.add(this.mesh);
  }
  update(_dt: number): void {
    const { ctx } = this.env;
    this.storm.value = burnStormLevel(ctx.world, ctx.session.screen);
    this.mesh.visible = this.storm.value > 0.001;
    if (!this.mesh.visible) return;
    this.time.value = ctx.world.time;
    ctx.camera.getWorldDirection(this.forward);
    this.focus.value.copy(ctx.camera.position).addScaledVector(this.forward, 16);
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
