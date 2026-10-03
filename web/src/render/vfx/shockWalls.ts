/**
 * Shock walls: expanding open cylinders of light (Omega Pulse, captures, crystal flashes,
 * Hearth Ward pulses). Analytic like the particles: written once, the shader grows the
 * radius (ease-out) and shrinks the height while the band fades. Brightest at silhouettes,
 * so a wall reads as a ring of light from any angle and hugs uneven ground naturally.
 */
import * as THREE from 'three';
import { COLLAPSE_GLSL, FOG_FRAG_GLSL, NOISE_GLSL, OUTPUT_GLSL, fxMaterial, toInstanced, type SharedUniforms } from './glsl';
import { InstanceBuffer } from './instanceBuffer';

const VEC4S = 3;
/** Layer gain against the post bloom threshold: walls are large, keep them mostly below it. */
const GAIN = 0.5;

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 w0; // base centre xyz, start
attribute vec4 w1; // duration, r0, r1, height
attribute vec4 w2; // rgb, intensity
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vY;
varying float vT;
varying vec4 vColor;
#include <fog_pars_vertex>

void main() {
  float age = uTime - w0.w;
  if (age < 0.0 || age >= w1.x) { ${COLLAPSE_GLSL} }
  float t = age / w1.x;
  float e = 1.0 - pow(1.0 - t, 2.6);
  float R = mix(w1.y, w1.z, e);
  float H = w1.w * (1.0 - 0.55 * t);
  vec3 wp = w0.xyz + vec3(position.x * R, position.y * H, position.z * R);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vWorld = wp;
  vNormal2 = normal;
  vY = position.y;
  vT = t;
  vColor = w2;
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
varying float vT;
varying vec4 vColor;
#include <fog_pars_fragment>
${NOISE_GLSL}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormal2), V));
  float rim = 0.25 + 0.75 * pow(max(1.0 - facing, 0.0), 1.5);
  float rise = 1.0 - vY;
  float vert = rise * rise * smoothstep(0.0, 0.05, vY);
  float ang = atan(vNormal2.z, abs(vNormal2.x) + abs(vNormal2.z) > 0.00001 ? vNormal2.x : 1.0);
  float n = 0.6 + 0.4 * fxNoise(vec2(ang * 7.0, vY * 3.0 - uTime * 2.5));
  vec3 emit = vColor.rgb * vColor.a * rim * vert * n * pow(max(1.0 - vT, 0.0), 1.6);
  gl_FragColor = vec4(emit, 0.0);
  ${FOG_FRAG_GLSL}
  ${OUTPUT_GLSL}
}
`;

export class ShockWalls {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  now = 0;
  private readonly buf: InstanceBuffer;
  private cursor = 0;
  private used = 0;

  constructor(capacity: number, shared: SharedUniforms, renderOrder: number) {
    const geometry = toInstanced(new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0));
    this.buf = new InstanceBuffer(capacity, VEC4S);
    this.buf.attach(geometry, 'w');
    const d = this.buf.data;
    for (let i = 0; i < capacity; i++) d[i * this.buf.stride + 3] = -1e6;
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

  /** Wall expanding r0 → r1 over `dur`, starting `height` tall. */
  spawn(x: number, y: number, z: number, r0: number, r1: number, height: number, dur: number, color: THREE.Color, intensity: number, delay = 0): void {
    const i = this.cursor;
    const d = this.buf.data;
    let o = i * this.buf.stride;
    d[o++] = x;
    d[o++] = y;
    d[o++] = z;
    d[o++] = this.now + delay;
    d[o++] = dur;
    d[o++] = r0;
    d[o++] = r1;
    d[o++] = height;
    d[o++] = color.r;
    d[o++] = color.g;
    d[o++] = color.b;
    d[o] = intensity * GAIN;
    this.buf.mark(i, i + 1);
    this.cursor = i + 1 === this.buf.capacity ? 0 : i + 1;
    if (i + 1 > this.used) this.used = i + 1;
  }

  flush(): void {
    this.buf.flush();
    this.mesh.geometry.instanceCount = this.used;
    this.mesh.visible = this.used > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
