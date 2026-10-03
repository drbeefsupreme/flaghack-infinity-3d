/**
 * Stabilize Zone domes (Zeno domes): translucent hemispheres etched with de Bruijn's
 * pentagrid (five families of parallel lines at 72°, the construction behind the Ley
 * Lattice itself) laid through a stereographic chart (conformal, so the grid's angles
 * survive on the curved surface), with glowing five-fold nodes where the five plane waves
 * interfere constructively. The grid turns slowly; fresnel rim; a reveal sweep rises from
 * the ground while the dome forms; the CPU fades it over the zone's lifetime.
 */
import * as THREE from 'three';
import { FOG_FRAG_GLSL, OUTPUT_GLSL, fxMaterial, toInstanced, type SharedUniforms } from './glsl';
import { InstanceBuffer } from './instanceBuffer';

const VEC4S = 3;

const VERT = /* glsl */ `
attribute vec4 d0; // centre xyz, radius
attribute vec4 d1; // rgb, alpha
attribute vec4 d2; // seed, reveal 0..1, -, -
varying vec3 vWorld;
varying vec3 vLocal;
varying vec4 vColor;
varying vec3 vInfo; // seed, reveal, radius
#include <fog_pars_vertex>

void main() {
  vec3 wp = d0.xyz + position * d0.w;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vWorld = wp;
  vLocal = position;
  vColor = d1;
  vInfo = vec3(d2.x, d2.y, d0.w);
  #ifdef USE_FOG
  vFogDepth = -mv.z;
  #endif
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec4 vColor;
varying vec3 vInfo;
#include <fog_pars_fragment>

void main() {
  vec3 N = normalize(vLocal);
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(max(1.0 - abs(dot(N, V)), 0.0), 3.0);
  // Stereographic chart from the south pole: the hemisphere maps onto |q| <= 1.
  vec2 q = N.xz / (1.0 + N.y);
  float a = uTime * 0.05 + vInfo.x * 6.2831853;
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q * (vInfo.z * 0.42);
  // Zero offsets give the singular pentagrid: a five-fold star sits on the apex.
  float grid = 0.0;
  float wave = 0.0;
  for (int j = 0; j < 5; j++) {
    float aj = float(j) * 1.2566371;
    float d = dot(q, vec2(cos(aj), sin(aj)));
    float f = abs(fract(d + 0.5) - 0.5);
    grid = max(grid, 1.0 - smoothstep(0.0, fwidth(d) * 1.3 + 0.0001, f));
    wave += cos(d * 6.2831853);
  }
  float node = smoothstep(3.2, 4.6, wave);
  float elev = asin(clamp(N.y, 0.0, 1.0)) / 1.5707963;
  float reveal = vInfo.y;
  float shown = 1.0 - smoothstep(reveal - 0.02, reveal + 0.02, elev);
  float sweepX = (elev - reveal) / 0.035;
  float sweep = reveal < 0.999 ? exp(-sweepX * sweepX) * 2.0 : 0.0;
  float shimmer = 0.8 + 0.2 * sin(uTime * 2.2 + wave * 1.7);
  float base = exp(-N.y * 14.0) * 0.5;
  float lum = (0.035 + grid * 0.55 * shimmer + node * 0.6 + rim * 0.7 + base) * shown + sweep;
  vec3 emit = vColor.rgb * lum * vColor.a;
  gl_FragColor = vec4(emit, 0.0);
  ${FOG_FRAG_GLSL}
  ${OUTPUT_GLSL}
}
`;

export class Domes {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly buf: InstanceBuffer;
  private count = 0;

  constructor(capacity: number, shared: SharedUniforms, renderOrder: number) {
    const geometry = toInstanced(new THREE.SphereGeometry(1, 72, 24, 0, Math.PI * 2, 0, Math.PI / 2));
    this.buf = new InstanceBuffer(capacity, VEC4S);
    this.buf.attach(geometry, 'd');
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

  /** One dome this frame: alpha = lifetime fade, reveal = 0..1 growth sweep. */
  add(x: number, y: number, z: number, radius: number, color: THREE.Color, intensity: number, alpha: number, reveal: number, seed: number): void {
    if (this.count >= this.buf.capacity || alpha <= 0.001) return;
    const d = this.buf.data;
    let o = this.count++ * this.buf.stride;
    d[o++] = x;
    d[o++] = y;
    d[o++] = z;
    d[o++] = radius;
    d[o++] = color.r * intensity;
    d[o++] = color.g * intensity;
    d[o++] = color.b * intensity;
    d[o++] = alpha;
    d[o++] = seed;
    d[o++] = reveal;
    d[o++] = 0;
    d[o] = 0;
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
