/**
 * Ground layer: every flat effect lying on (or floating parallel to) the ground in one
 * instanced draw. Transient rings and decals are analytic (written once, animated by the
 * shader from their start time); persistent halos (pings, beacons, domes, capture vortex)
 * occupy a reserved slot range rewritten each frame.
 */
import * as THREE from 'three';
import { COLLAPSE_GLSL, FOG_FRAG_GLSL, NOISE_GLSL, OUTPUT_GLSL, fxMaterial, quadXZ, type SharedUniforms } from './glsl';
import { InstanceBuffer } from './instanceBuffer';

export const RingStyle = {
  /** Expanding glow ring with a faint inner wash. */
  Glow: 0,
  /** Shockwave: hot front, long wake, radial streaks. */
  Shock: 1,
  /** Phason ripple: glassy triple ring with chromatic fringes. */
  Ripple: 2,
  /** Omega Pulse scorch: charred disc with a pentagram that cools from ember to soot. */
  Pentagram: 3,
  /** TAKE A SHOT: dashed double ring. */
  Dashed: 4,
  /** Persistent halo; `segments` > 0 cuts it into rotating arcs. */
  Halo: 5,
  /** Round scorch mark with a dying ember rim. */
  Scorch: 6,
} as const;
export type RingStyleId = (typeof RingStyle)[keyof typeof RingStyle];

const VEC4S = 4;
/**
 * Layer gain calibrating recipe intensities against the post bloom threshold (1.4 by day):
 * thin ring fronts bloom, broad washes stay under it.
 */
const GAIN = 0.62;
const PERSISTENT = 96;
const NEVER_ENDS = 1e7;

const VERT = /* glsl */ `
uniform float uTime;
attribute vec4 g0; // centre xyz, start
attribute vec4 g1; // duration, r0, r1, width
attribute vec4 g2; // rgb, intensity
attribute vec4 g3; // style, rotation, rotation speed, seed | segments
varying vec2 vLocal;
varying vec4 vColor;
varying vec4 vInfo; // radius, width, t, style
varying vec2 vRot;  // rotation, seed | segments
#include <fog_pars_vertex>

void main() {
  float age = uTime - g0.w;
  if (age < 0.0 || age >= g1.x) { ${COLLAPSE_GLSL} }
  float t = age / g1.x;
  float e = 1.0 - pow(1.0 - t, 3.0);
  float R = mix(g1.y, g1.z, e);
  float ext = R * 1.15 + g1.w * 3.0 + 0.3;
  vec3 wp = g0.xyz + vec3(position.x * ext, 0.0, position.z * ext);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vLocal = position.xz * ext;
  vColor = g2;
  vInfo = vec4(R, g1.w, t, g3.x);
  vRot = vec2(g3.y + g3.z * age, g3.w);
  #ifdef USE_FOG
  vFogDepth = -mv.z;
  #endif
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vLocal;
varying vec4 vColor;
varying vec4 vInfo;
varying vec2 vRot;
#include <fog_pars_fragment>
${NOISE_GLSL}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.000001), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  float R = vInfo.x;
  float W = max(vInfo.y, 0.01);
  float t = vInfo.z;
  float style = vInfo.w;
  float d = length(vLocal);
  // atan(0, 0) is undefined in GLSL (NaN on some drivers): the centre has no angle.
  float ang = d > 0.00001 ? atan(vLocal.y, vLocal.x) : 0.0;
  float life = max(1.0 - t, 0.0);
  vec3 col = vColor.rgb * vColor.a;
  vec3 emit = vec3(0.0);
  float alpha = 0.0;
  const vec3 SOOT = vec3(0.03, 0.022, 0.015);
  if (style < 0.5) {
    float x = (d - R) / W;
    emit = col * (exp(-x * x) + 0.12 * smoothstep(R, 0.0, d)) * pow(life, 1.6);
  } else if (style < 1.5) {
    float x = (d - R) / W;
    float front = x > 0.0 ? exp(-x * x * 3.0) : exp(x * 0.4);
    float streak = 0.55 + 0.45 * fxNoise(vec2(ang * 9.5493 + vRot.y * 40.0, d * 0.12 - t * 4.0));
    emit = (col * front * streak + vec3(vColor.a) * exp(-x * x * 10.0) * 0.6) * pow(life, 1.3);
  } else if (style < 2.5) {
    vec3 c3 = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float Ri = R * (1.0 - float(i) * 0.24);
      float xr = (d - Ri - W * 0.4) / W;
      float xg = (d - Ri) / W;
      float xb = (d - Ri + W * 0.4) / W;
      c3 += vec3(exp(-xr * xr), exp(-xg * xg), exp(-xb * xb)) * (1.0 - float(i) * 0.3);
    }
    emit = c3 * mix(vec3(1.0), vColor.rgb, 0.55) * vColor.a * pow(life, 1.4);
  } else if (style < 3.5) {
    float rr = R * 0.9;
    float dl = 1e5;
    for (int i = 0; i < 5; i++) {
      float a0 = vRot.x + float(i) * 1.2566371;
      float a1 = a0 + 2.5132741; // skip a vertex: the {5/2} star polygon
      dl = min(dl, sdSeg(vLocal, rr * vec2(cos(a0), sin(a0)), rr * vec2(cos(a1), sin(a1))));
    }
    float line = min(dl, abs(d - R * 0.97));
    float lw = 0.18 + R * 0.012;
    float lineM = 1.0 - smoothstep(lw, lw * 2.2, line);
    float blot = smoothstep(R * 1.1, R * 0.15, d) * (0.5 + 0.5 * fxNoise(vLocal * 0.45 + vRot.y * 13.0));
    float fade = 1.0 - smoothstep(0.55, 1.0, t);
    alpha = clamp(blot * 0.5 + lineM * 0.8, 0.0, 0.92) * fade;
    // Burns in with the caster's colour, cools through ember orange, ends as soot.
    float hot = exp(-t * 14.0);
    float ember = exp(-t * 3.0) * (0.6 + 0.4 * fxNoise(vLocal * 2.0 + uTime * 3.0));
    vec3 lineCol = vColor.rgb * hot * 2.0 + vec3(1.0, 0.3, 0.05) * ember * 0.9;
    emit = SOOT * alpha + lineCol * lineM * fade * vColor.a;
  } else if (style < 4.5) {
    float x1 = (d - R) / W;
    float x2 = (d - R * 0.84) / (W * 0.6);
    float dash = smoothstep(0.3, 0.38, fract((ang + vRot.x) * 1.9098593));
    emit = col * (exp(-x1 * x1) * dash + 0.7 * exp(-x2 * x2)) * pow(life, 1.3);
  } else if (style < 5.5) {
    float x = (d - R) / W;
    float seg = 1.0;
    if (vRot.y > 0.5) {
      float f = fract((ang + vRot.x) * vRot.y * 0.15915494);
      seg = 1.0 - smoothstep(0.36, 0.46, abs(f - 0.5));
    }
    emit = col * (exp(-x * x) * seg + 0.06 * smoothstep(R, 0.0, d));
  } else {
    float n = fxNoise(vLocal * 1.3 + vRot.y * 7.0);
    float blot = smoothstep(R, R * 0.25, d + (n - 0.5) * R * 0.5);
    float fade = 1.0 - smoothstep(0.5, 1.0, t);
    alpha = blot * 0.75 * fade;
    float rx = (d - R * 0.7) / (R * 0.18);
    emit = SOOT * alpha + vec3(1.0, 0.35, 0.08) * exp(-rx * rx) * exp(-t * 5.0) * 2.0 * fade * vColor.a;
  }
  if (alpha < 0.002 && emit.r + emit.g + emit.b < 0.002) discard;
  gl_FragColor = vec4(emit, alpha);
  ${FOG_FRAG_GLSL}
  ${OUTPUT_GLSL}
}
`;

export class GroundFx {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  /** Spawn clock (s); the orchestrator keeps it at ctx.time. */
  now = 0;
  private readonly buf: InstanceBuffer;
  private cursor = PERSISTENT;
  private used = PERSISTENT;
  private persistCount = 0;
  private persistPrev = 0;
  private seedSeq = 0;

  constructor(capacity: number, shared: SharedUniforms, renderOrder: number) {
    const geometry = quadXZ();
    this.buf = new InstanceBuffer(capacity, VEC4S);
    this.buf.attach(geometry, 'g');
    const d = this.buf.data;
    for (let i = 0; i < capacity; i++) d[i * this.buf.stride + 3] = -1e6;
    const material = fxMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: shared.uTime },
      side: THREE.DoubleSide,
    });
    // Lift above the terrain in depth rather than in space so rings hug slopes and decks.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  /**
   * Transient ring/decal expanding r0 → r1 over `dur` (ease-out cubic). `intensity` scales
   * the HDR colour; `delay` postpones the start; `spin` turns dashed/pentagram patterns.
   */
  ring(
    style: RingStyleId,
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    width: number,
    dur: number,
    color: THREE.Color,
    intensity: number,
    delay = 0,
    rotation = 0,
    spin = 0,
  ): void {
    const i = this.cursor;
    this.seedSeq = (this.seedSeq + 0.6180339887) % 1;
    this.write(i, x, y, z, this.now + delay, dur, r0, r1, width, color, intensity, style, rotation, spin, this.seedSeq);
    this.buf.mark(i, i + 1);
    this.cursor = i + 1 === this.buf.capacity ? PERSISTENT : i + 1;
    if (i + 1 > this.used) this.used = i + 1;
  }

  /** Start rebuilding the persistent halos for this frame. */
  beginPersistent(): void {
    this.persistPrev = this.persistCount;
    this.persistCount = 0;
  }

  /** Persistent halo this frame (rotation in radians; segments 0 = solid ring). */
  halo(x: number, y: number, z: number, radius: number, width: number, color: THREE.Color, intensity: number, rotation: number, segments: number): void {
    if (this.persistCount >= PERSISTENT) return;
    const i = this.persistCount++;
    this.write(i, x, y, z, this.now - 0.001, NEVER_ENDS, radius, radius, width, color, intensity, RingStyle.Halo, rotation, 0, segments);
  }

  /** Upload transient spawns and this frame's halos (clearing halos that ended). */
  flush(): void {
    const d = this.buf.data;
    const stride = this.buf.stride;
    for (let i = this.persistCount; i < this.persistPrev; i++) d[i * stride + 3] = -1e6;
    this.buf.mark(0, Math.max(this.persistCount, this.persistPrev));
    this.buf.flush();
    this.mesh.geometry.instanceCount = this.used;
  }

  private write(
    i: number,
    x: number,
    y: number,
    z: number,
    start: number,
    dur: number,
    r0: number,
    r1: number,
    width: number,
    color: THREE.Color,
    intensity: number,
    style: number,
    rotation: number,
    spin: number,
    seed: number,
  ): void {
    const d = this.buf.data;
    let o = i * this.buf.stride;
    d[o++] = x;
    d[o++] = y;
    d[o++] = z;
    d[o++] = start;
    d[o++] = dur;
    d[o++] = r0;
    d[o++] = r1;
    d[o++] = width;
    d[o++] = color.r;
    d[o++] = color.g;
    d[o++] = color.b;
    d[o++] = intensity * GAIN;
    d[o++] = style;
    d[o++] = rotation;
    d[o++] = spin;
    d[o] = seed;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
