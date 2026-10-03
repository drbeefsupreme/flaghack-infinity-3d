/**
 * Light columns: Priority Beacon pillars, D.E.G.E.N. ping beams and the capture-vortex
 * column. Persistent: the orchestrator rebuilds the visible set every frame (a few dozen
 * instances at most), so fades and flashes are plain CPU values.
 */
import * as THREE from 'three';
import { FOG_FRAG_GLSL, NOISE_GLSL, OUTPUT_GLSL, fxMaterial, toInstanced, type SharedUniforms } from './glsl';
import { InstanceBuffer } from './instanceBuffer';

export const ColumnStyle = {
  /** Priority Beacon: banded pillar climbing fast. */
  Beacon: 0,
  /** Ping beam: thin, pulses travelling up. */
  Ping: 1,
  /** Capture vortex: swirling noise column. */
  Vortex: 2,
} as const;
export type ColumnStyleId = (typeof ColumnStyle)[keyof typeof ColumnStyle];

const VEC4S = 3;
/** Layer gain against the post bloom threshold: the beam core blooms, its body does not. */
const GAIN = 0.55;

const VERT = /* glsl */ `
attribute vec4 c0; // base xyz, radius
attribute vec4 c1; // height, alpha, style, phase
attribute vec4 c2; // rgb, intensity
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vY;
varying vec4 vColor;
varying vec3 vInfo; // height, style, phase
#include <fog_pars_vertex>

void main() {
  vec3 wp = c0.xyz + vec3(position.x * c0.w, position.y * c1.x, position.z * c0.w);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vWorld = wp;
  vNormal2 = normal;
  vY = position.y;
  vColor = vec4(c2.rgb * c2.a, c1.y);
  vInfo = vec3(c1.x, c1.z, c1.w);
  #ifdef USE_FOG
  vFogDepth = -mv.z;
  #endif
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vY;
varying vec4 vColor;
varying vec3 vInfo;
#include <fog_pars_fragment>
${NOISE_GLSL}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormal2), V));
  // A beam is brightest along its axis: weight surfaces that face the viewer.
  float core = facing * facing;
  float top = 1.0 - vY;
  float vert = top * top * smoothstep(0.0, 0.02, vY);
  float H = vInfo.x;
  float h = vY * H;
  float pattern;
  if (vInfo.y < 0.5) {
    pattern = 0.6 + 0.4 * sin(h * 0.9 - uTime * 7.0 + vInfo.z);
    pattern += 0.8 * smoothstep(0.9, 1.0, fract(h * 0.035 - uTime * 0.8 + vInfo.z));
  } else if (vInfo.y < 1.5) {
    pattern = 0.55 + 1.1 * smoothstep(0.82, 1.0, fract(h * 0.06 - uTime * 0.9 + vInfo.z));
  } else {
    float ang = atan(vNormal2.z, abs(vNormal2.x) + abs(vNormal2.z) > 0.00001 ? vNormal2.x : 1.0);
    pattern = 0.35 + 1.1 * fxNoise(vec2(ang * 2.0 + h * 0.25 - uTime * 5.0, h * 0.15 - uTime * 2.5));
  }
  vec3 emit = vColor.rgb * vColor.a * (core * 0.85 + 0.15) * vert * pattern;
  gl_FragColor = vec4(emit, 0.0);
  ${FOG_FRAG_GLSL}
  ${OUTPUT_GLSL}
}
`;

export class Columns {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly buf: InstanceBuffer;
  private count = 0;

  constructor(capacity: number, shared: SharedUniforms, renderOrder: number) {
    const geometry = toInstanced(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0));
    this.buf = new InstanceBuffer(capacity, VEC4S);
    this.buf.attach(geometry, 'c');
    geometry.instanceCount = 0;
    const material = fxMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: shared.uTime },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  begin(): void {
    this.count = 0;
  }

  add(style: ColumnStyleId, x: number, y: number, z: number, radius: number, height: number, color: THREE.Color, intensity: number, alpha: number, phase: number): void {
    if (this.count >= this.buf.capacity || alpha <= 0.001) return;
    const d = this.buf.data;
    let o = this.count++ * this.buf.stride;
    d[o++] = x;
    d[o++] = y;
    d[o++] = z;
    d[o++] = radius;
    d[o++] = height;
    d[o++] = alpha;
    d[o++] = style;
    d[o++] = phase;
    d[o++] = color.r;
    d[o++] = color.g;
    d[o++] = color.b;
    d[o] = intensity * GAIN;
  }

  flush(): void {
    this.buf.mark(0, this.count);
    this.buf.flush();
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
