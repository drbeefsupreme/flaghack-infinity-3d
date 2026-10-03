/**
 * Staff swing arcs: a curved additive ribbon (a slightly tilted annulus sector around the
 * swinger) whose bright head sweeps across in the first ~40% of its life and leaves a
 * fading trail. Analytic and instanced: one draw for every swing on the map.
 */
import * as THREE from 'three';
import { COLLAPSE_GLSL, FOG_FRAG_GLSL, OUTPUT_GLSL, fxMaterial, type SharedUniforms } from './glsl';
import { InstanceBuffer } from './instanceBuffer';

const VEC4S = 3;
const SEGMENTS = 40;
/** Half sweep of the arc (rad). */
const HALF_ARC = 1.3;

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 s0; // centre xyz, start
attribute vec4 s1; // yaw, tilt, reach, duration
attribute vec4 s2; // rgb, intensity
varying vec2 vArc; // along -1..1 (sweep order), across 0 inner .. 1 outer
varying float vT;
varying vec4 vColor;
#include <fog_pars_vertex>

void main() {
  float age = uTime - s0.w;
  if (age < 0.0 || age >= s1.w) { ${COLLAPSE_GLSL} }
  float a = position.x * ${HALF_ARC.toFixed(3)};
  float rad = mix(0.35, s1.z, position.y);
  vec3 local = vec3(sin(a) * rad, sin(a) * s1.y * rad, cos(a) * rad);
  float cy = cos(s1.x);
  float sy = sin(s1.x);
  vec3 wp = s0.xyz + vec3(local.x * cy + local.z * sy, local.y, -local.x * sy + local.z * cy);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  // Sweep from the raised side of the tilted arc down, whichever side that is.
  vArc = vec2(s1.y > 0.0 ? -position.x : position.x, position.y);
  vT = age / s1.w;
  vColor = s2;
  #ifdef USE_FOG
  vFogDepth = -mv.z;
  #endif
}
`;

const FRAG = /* glsl */ `
varying vec2 vArc;
varying float vT;
varying vec4 vColor;
#include <fog_pars_fragment>

void main() {
  float p = clamp(vT / 0.4, 0.0, 1.0);
  float head = mix(-1.15, 1.15, 1.0 - (1.0 - p) * (1.0 - p));
  float behind = head - vArc.x;
  if (behind < 0.0) discard;
  float trail = exp(-behind * 2.4);
  float edge = vArc.y * vArc.y * vArc.y + 0.2 * vArc.y;
  float ends = 1.0 - smoothstep(0.82, 1.0, abs(vArc.x));
  float fade = 1.0 - smoothstep(0.3, 1.0, vT);
  float hot = exp(-behind * 10.0) * smoothstep(0.75, 1.0, vArc.y);
  vec3 emit = (vColor.rgb * trail * edge + vec3(hot * 1.5)) * vColor.a * ends * fade;
  gl_FragColor = vec4(emit, 0.0);
  ${FOG_FRAG_GLSL}
  ${OUTPUT_GLSL}
}
`;

function arcGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = (i / SEGMENTS) * 2 - 1;
    pos.push(u, 0, 0, u, 1, 0);
    if (i < SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

export class SwingArcs {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  now = 0;
  private readonly buf: InstanceBuffer;
  private cursor = 0;
  private used = 0;

  constructor(capacity: number, shared: SharedUniforms, renderOrder: number) {
    const geometry = arcGeometry();
    this.buf = new InstanceBuffer(capacity, VEC4S);
    this.buf.attach(geometry, 's');
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

  /** Arc centred at (x, y, z) facing `yaw` (0 = +z); tilt sign picks the sweep direction. */
  spawn(x: number, y: number, z: number, yaw: number, tilt: number, reach: number, dur: number, color: THREE.Color, intensity: number): void {
    const i = this.cursor;
    const d = this.buf.data;
    let o = i * this.buf.stride;
    d[o++] = x;
    d[o++] = y;
    d[o++] = z;
    d[o++] = this.now;
    d[o++] = yaw;
    d[o++] = tilt;
    d[o++] = reach;
    d[o++] = dur;
    d[o++] = color.r;
    d[o++] = color.g;
    d[o++] = color.b;
    d[o] = intensity;
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
