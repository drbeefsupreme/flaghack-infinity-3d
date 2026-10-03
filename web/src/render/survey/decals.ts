/**
 * Instanced ground decals: every flat marker of the Survey layer (implied-Flag halos, plan
 * rings, focus pentacles, flip ripples, Hearth stage rings, landing reticles, order chevrons,
 * critical-Flag rings, the tide wave) is one instance of a single SDF "uber" shader, so a
 * whole frame of markers costs one draw call per DecalLayer. Instances may be anchored to a
 * lattice node (its display position), so markers follow phason flip glides for free.
 * Instance data is rebuilt by the owner (reset → push… → commit) and uploaded as one range.
 */
import * as THREE from 'three';
import { MAP_HALF } from '../../sim/constants';
import { GLSL_COMMON, GLSL_FRAG, GLSL_VERT, GLSL_OUTPUT, LIFT, cornerQuad, surveyMaterial } from './glsl';
import type { SurveyUniforms } from './glsl';
import { InstanceSet } from './instances';

/** Decal shape ids (match the fragment shader branches). */
export const DECAL = {
  halo: 0,
  dash: 1,
  star: 2,
  ripple: 3,
  hearth: 4,
  target: 5,
  node: 6,
  chevron: 7,
  critical: 8,
  wave: 9,
  pull: 10,
} as const;
export type DecalShape = (typeof DECAL)[keyof typeof DECAL];

const VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
attribute vec2 aCorner;
attribute vec4 iA;
attribute vec4 iColor;
attribute vec4 iColor2;
attribute vec4 iParam;
attribute float iAnchor;
varying vec2 vQ;
varying vec2 vWorld;
flat varying vec4 vColor;
flat varying vec4 vColor2;
flat varying vec4 vParam;
flat varying float vR;

void main() {
  vec2 c = iA.xy;
  int an = fhId(iAnchor);
  if (an >= 0) c += fhNode(an).xy;
  float cs = cos(iA.w);
  float sn = sin(iA.w);
  vec2 q = aCorner;
  vec2 w = c + vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * iA.z;
  vec4 mv = viewMatrix * vec4(w.x, ${LIFT.decal} + 0.004 * iParam.x, w.y, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
  vQ = q;
  vWorld = w;
  vColor = iColor;
  vColor2 = iColor2;
  vParam = iParam;
  vR = iA.z;
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_FRAG}
varying vec2 vQ;
varying vec2 vWorld;
flat varying vec4 vColor;
flat varying vec4 vColor2;
flat varying vec4 vParam;
flat varying float vR;

float band(float x, float c, float w) { return fhGauss((x - c) / w); }
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
/** A stroke of constant width in metres, independent of the decal radius. */
float stroke(float d, float metres) { return smoothstep(metres / vR, metres / vR * 0.35, d); }

void main() {
  vec2 q = vQ;
  float r = length(q);
  if (r > 1.0) discard;
  int shape = fhId(vParam.x);
  float p0 = vParam.y;
  float p1 = vParam.z;
  float p2 = vParam.w;
  // atan(0, 0) is undefined (NaN on some drivers): pin the exact centre texel.
  float ang = r > 1e-5 ? atan(q.y, q.x) : 0.0;
  vec3 col = vColor.rgb;
  float a = 0.0;
  float add = vColor2.w;

  if (shape == 0) {
    // Halo: soft ring + core (implied Flags, crystal bases).
    float rr = p0 > 0.0 ? p0 : 0.72;
    float ring = band(r, rr, 0.09);
    float core = exp(-r * r * 5.0) * (p1 > 0.0 ? p1 : 0.4);
    a = (ring + core) * (0.85 + 0.15 * sin(uTime * 3.0 + p2 * 6.283));
    col *= 1.0 + ring * 0.8;
  } else if (shape == 1) {
    // Dashed ring (plan ghosts): p0 dash count, p1 spin, p2 fill.
    float t = fract((ang + uTime * p1) / FH_TAU * p0);
    float dash = smoothstep(0.0, 0.06, t) * smoothstep(0.6, 0.52, t);
    a = stroke(abs(r - 0.8), 0.07) * dash + smoothstep(0.82, 0.0, r) * p2 * 0.3;
  } else if (shape == 2) {
    // Crystal focus: the pentacle star pointing at the five neighbours (local +x = first);
    // each point lights in the colour of the faction holding that neighbour.
    int holders = fhId(p1);
    float d = 1e3;
    float dots = 0.0;
    vec3 dotCol = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float ai = float(i) * FH_TAU / 5.0;
      float bi = float(i + 2) * FH_TAU / 5.0;
      vec2 A = 0.8 * vec2(cos(ai), sin(ai));
      vec2 B = 0.8 * vec2(cos(bi), sin(bi));
      d = min(d, sdSeg(q, A, B));
      int h = ((holders >> (3 * i)) & 7) - 1;
      float pd = smoothstep(0.13, 0.08, length(q - A));
      dots += pd;
      dotCol += pd * (h >= 0 ? fhFaction(h) * 1.6 : vec3(1.0, 0.95, 0.75));
    }
    float breathe = 0.75 + 0.25 * sin(uTime * 1.7 + p2);
    float lines = stroke(d, 0.1) * breathe;
    float circle = stroke(abs(r - 0.93), 0.07);
    float tick = smoothstep(0.86, 1.0, fract((ang + uTime * 0.35) / FH_TAU * 30.0)) * stroke(abs(r - 0.985), 0.06);
    float glow = exp(-r * r * 3.0) * 0.18;
    a = max(max(lines, circle * 0.8), max(tick * 0.7, dots)) + glow;
    col = mix(col, dotCol / max(dots, 1e-3), clamp(dots, 0.0, 1.0));
  } else if (shape == 3) {
    // Glassy ripple with chromatic fringe (phason flips): p0 progress.
    float w = 0.05 + 0.06 * p0;
    float rr = band(r, p0, w);
    float rg = band(r, p0 * 0.96, w);
    float rb = band(r, p0 * 0.92, w);
    col = vec3(rr, rg, rb) * col * 1.8;
    a = max(rr, max(rg, rb)) * (1.0 - p0);
    a += smoothstep(p0, 0.0, r) * 0.1 * (1.0 - p0) * fhNoise(vWorld * 2.5 + uTime * 2.0);
  } else if (shape == 4) {
    // Hearth stage ring + arc meter: p0 stage (0 safe .. 4 overwritten), p1 pressure 0..1.
    float stage = p0;
    float spin = uTime * (stage < 0.5 ? 0.12 : (stage < 1.5 ? 0.35 : 0.9));
    float ang01 = fract(0.25 - ang / FH_TAU);
    float ring = stroke(abs(r - 0.86), 0.12);
    float outer = stroke(abs(r - 0.975), 0.06) * 0.5;
    float tk = fract((ang + spin) / FH_TAU * 5.0);
    float ticks = step(0.74, r) * step(r, 0.83) * smoothstep(0.07, 0.02, abs(tk - 0.5));
    float arcBand = step(0.895, r) * step(r, 0.95);
    float arc = arcBand * (step(ang01, p1) * (0.9 + 0.1 * sin(uTime * 9.0)) + 0.12);
    float pulse = 1.0;
    float inner = 0.0;
    if (stage < 0.5) {
      pulse = 0.75 + 0.25 * sin(uTime * 1.4);
      arc *= step(0.001, p1);
    } else if (stage < 1.5) {
      pulse = 0.5 + 0.5 * sin(uTime * 5.0);
      arc *= step(0.001, p1);
    } else if (stage < 2.5) {
      pulse = 0.75 + 0.25 * sin(uTime * 8.0);
      inner = band(fract(r * 4.0 + uTime * 0.9), 0.5, 0.09) * smoothstep(0.84, 0.25, r) * 0.45;
    } else if (stage < 3.5) {
      float sector = floor(ang01 * 10.0);
      float m = step(0.5, fract(uTime * 2.2 + sector * 0.5));
      col = mix(vColor.rgb, vColor2.rgb, m);
      pulse = 0.7 + 0.3 * step(0.3, fhHash(vec2(floor(uTime * 12.0), sector)));
      inner = band(fract(r * 4.0 + uTime * 0.5), 0.5, 0.09) * smoothstep(0.84, 0.25, r) * 0.3;
    } else {
      pulse = 0.85 + 0.15 * sin(uTime * 14.0);
      inner = smoothstep(0.86, 0.0, r) * 0.55 + band(fract(r * 3.0 - uTime * 1.5), 0.5, 0.1) * 0.4;
      arc = arcBand;
    }
    a = (ring + ticks * 0.8 + outer + inner) * pulse + arc;
    col *= 1.0 + arc * 0.6;
  } else if (shape == 5) {
    // Landing reticle: p0 = 1 when the throw will plant.
    float ring = stroke(abs(r - 0.9), 0.07);
    float qa = mod(ang + uTime * 0.6, FH_TAU / 4.0) - FH_TAU / 8.0;
    float notch = step(0.55, r) * step(r, 0.8) * smoothstep(0.08, 0.03, abs(qa));
    float dot_ = smoothstep(0.12, 0.06, r);
    a = (ring + notch + dot_) * mix(0.55, 1.0, p0);
  } else if (shape == 6) {
    // Node highlight: fixed ring + expanding pulse.
    float ex = 0.5 + fract(uTime * 1.3) * 0.5;
    a = stroke(abs(r - 0.5), 0.07) + band(r, ex, 0.04) * (1.0 - fract(uTime * 1.3));
  } else if (shape == 7) {
    // Order marker: shrinking ring + three inward chevrons, fading with age p0.
    float rr = 0.95 - p0 * 0.35;
    float ring = stroke(abs(r - rr), 0.09);
    float d = 1e3;
    for (int i = 0; i < 3; i++) {
      float ai = float(i) * FH_TAU / 3.0 + FH_PI * 0.5;
      vec2 dir = vec2(cos(ai), sin(ai));
      vec2 perp = vec2(-dir.y, dir.x);
      vec2 tip = dir * (0.35 + 0.25 * (1.0 - p0));
      d = min(d, sdSeg(q, tip, tip + dir * 0.22 + perp * 0.16));
      d = min(d, sdSeg(q, tip, tip + dir * 0.22 - perp * 0.16));
    }
    a = (ring + stroke(d, 0.12)) * (1.0 - p0);
  } else if (shape == 8) {
    // Critical Flag ground ring: pulsing red with rotating brackets.
    float pulse = 0.6 + 0.4 * sin(uTime * 7.0);
    float ring = stroke(abs(r - 0.8), 0.09);
    float qa = mod(ang - uTime * 1.2, FH_TAU / 4.0) - FH_TAU / 8.0;
    float br = step(0.88, r) * step(r, 0.98) * smoothstep(0.32, 0.26, abs(qa));
    a = (ring + br) * pulse + exp(-r * r * 4.0) * 0.25 * pulse;
  } else if (shape == 9) {
    // Tide wave front: a straight band at local x = p0 (fraction of the radius; the decal is
    // rotated so local +x runs along the sweep) with a violet fringe and a faint wake behind
    // it, clipped to the map square.
    float w = 0.012;
    float x = q.x;
    float rr = band(x, p0, w);
    float rb = band(x, p0 - w, w);
    col = mix(col, vec3(0.75, 0.55, 1.0), rb / max(rr + rb, 1e-3)) * 1.6;
    a = max(rr, rb) + smoothstep(p0 - 0.15, p0, x) * step(x, p0) * 0.07;
    a *= 1.0 - smoothstep(${(MAP_HALF - 2).toFixed(1)}, ${(MAP_HALF + 2).toFixed(1)}, max(abs(vWorld.x), abs(vWorld.y)));
  } else if (shape == 10) {
    // Pull target: a rival (or orphaned) real Flag sitting on a planned node. Dashes spin
    // against the plan rings (p0 count, p1 spin) and an X pulses over the Flag's foot. Drawn
    // mostly opaque over a dark keyline so it reads on any faction's Survey glass.
    float t = fract((ang - uTime * p1) / FH_TAU * p0);
    float dash = smoothstep(0.0, 0.05, t) * smoothstep(0.55, 0.48, t);
    float dR = abs(r - 0.8);
    float dX = min(sdSeg(q, vec2(-0.36, -0.36), vec2(0.36, 0.36)), sdSeg(q, vec2(-0.36, 0.36), vec2(0.36, -0.36)));
    float pulse = 0.75 + 0.25 * sin(uTime * 5.0 + p2 * FH_TAU);
    float core = max(stroke(dR, 0.13) * dash, stroke(dX, 0.13) * pulse);
    float keyline = max(stroke(dR, 0.26) * dash, stroke(dX, 0.26));
    col = mix(vec3(0.05, 0.01, 0.0), col * 1.4, core);
    a = max(core, keyline * 0.75);
    add = 0.15;
  }
  a *= vColor.a * fhFogKeep() * uGlow.w;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * a, a * (1.0 - add));
  ${GLSL_OUTPUT}
}
`;

const STRIDE = 4;

export class DecalLayer {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh;
  private readonly set: InstanceSet;
  private readonly arrA: Float32Array;
  private readonly arrColor: Float32Array;
  private readonly arrColor2: Float32Array;
  private readonly arrParam: Float32Array;
  private readonly arrAnchor: Float32Array;
  count = 0;

  constructor(scene: THREE.Scene, material: THREE.ShaderMaterial, capacity: number, renderOrder: number) {
    this.scene = scene;
    // Corners wound counter-clockwise seen from above (+y), so the front face points up and
    // FrontSide culling keeps the decals (the shader reads aCorner, not the order).
    this.set = new InstanceSet(cornerQuad([-1, -1, -1, 1, 1, 1, 1, -1]), capacity);
    this.arrA = this.set.add('iA', 4);
    this.arrColor = this.set.add('iColor', 4);
    this.arrColor2 = this.set.add('iColor2', 4);
    this.arrParam = this.set.add('iParam', 4);
    this.arrAnchor = this.set.add('iAnchor', 1, -1);
    this.mesh = new THREE.Mesh(this.set.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  reset(): void {
    this.count = 0;
  }

  /**
   * Append a decal; returns its index (or -1 when full). (x, z) is an offset from the anchor
   * node's display position when `anchor` ≥ 0. Colour 2 defaults to the additive mix only.
   */
  push(
    shape: DecalShape,
    x: number,
    z: number,
    radius: number,
    rot: number,
    color: THREE.Color,
    alpha: number,
    additive: number,
    p0 = 0,
    p1 = 0,
    p2 = 0,
    anchor = -1,
  ): number {
    if (this.count >= this.set.capacity) return -1;
    const i = this.count++;
    const o = i * STRIDE;
    this.arrA[o] = x;
    this.arrA[o + 1] = z;
    this.arrA[o + 2] = radius;
    this.arrA[o + 3] = rot;
    this.arrColor[o] = color.r;
    this.arrColor[o + 1] = color.g;
    this.arrColor[o + 2] = color.b;
    this.arrColor[o + 3] = alpha;
    this.arrColor2[o] = 0;
    this.arrColor2[o + 1] = 0;
    this.arrColor2[o + 2] = 0;
    this.arrColor2[o + 3] = additive;
    this.arrParam[o] = shape;
    this.arrParam[o + 1] = p0;
    this.arrParam[o + 2] = p1;
    this.arrParam[o + 3] = p2;
    this.arrAnchor[i] = anchor;
    return i;
  }

  /** Secondary colour (Hearth contested flicker). */
  setColor2(i: number, color: THREE.Color): void {
    if (i < 0) return;
    const o = i * STRIDE;
    this.arrColor2[o] = color.r;
    this.arrColor2[o + 1] = color.g;
    this.arrColor2[o + 2] = color.b;
  }

  commit(): void {
    this.set.commit(this.count);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.set.geo.dispose();
  }
}

export function createDecalMaterial(shared: SurveyUniforms): THREE.ShaderMaterial {
  return surveyMaterial(shared, { vertexShader: VERT, fragmentShader: FRAG });
}
