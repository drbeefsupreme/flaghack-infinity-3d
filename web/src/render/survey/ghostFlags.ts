/**
 * Holographic ghost Flags (instanced pole + waving cloth): implied Flags (translucent
 * yellow), plan ghosts (faint faction colour) and the throw-preview Flag on the target node.
 * Real Flags belong to the actors module; these are what the Survey implies or intends.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_COMMON, GLSL_FRAG, GLSL_VERT, GLSL_OUTPUT, surveyMaterial } from './glsl';
import type { SurveyUniforms } from './glsl';
import { InstanceSet } from './instances';

export const GHOST = { implied: 0, plan: 1, aim: 2 } as const;
export type GhostKind = (typeof GHOST)[keyof typeof GHOST];

const POLE_H = 2.6;
const CLOTH_W = 0.95;
const CLOTH_H = 0.6;

const VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
attribute float aPart;
attribute vec4 iPos;
attribute vec4 iColor;
attribute vec4 iParam;
attribute float iAnchor;
varying vec2 vUv;
varying float vPart;
varying vec3 vWorld;
flat varying vec4 vColor;
flat varying vec4 vParam;

void main() {
  vec3 base = iPos.xyz;
  int an = fhId(iAnchor);
  if (an >= 0) {
    vec4 n = fhNode(an);
    base.x += n.x;
    base.z += n.y;
  }
  vec3 p = position;
  float seed = iParam.y;
  if (aPart > 0.5) {
    float u = uv.x;
    p.z += (sin(u * 4.5 - uTime * 5.5 + seed * 6.28) * 0.11 + sin(u * 9.0 - uTime * 8.0 + seed * 3.0) * 0.03) * u;
    p.y += sin(u * 3.0 - uTime * 4.0 + seed) * 0.03 * u;
  }
  float cs = cos(iPos.w);
  float sn = sin(iPos.w);
  p = vec3(p.x * cs + p.z * sn, p.y, -p.x * sn + p.z * cs);
  vec3 wp = base + p;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
  vUv = uv;
  vPart = aPart;
  vWorld = wp;
  vColor = iColor;
  vParam = iParam;
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_FRAG}
varying vec2 vUv;
varying float vPart;
varying vec3 vWorld;
flat varying vec4 vColor;
flat varying vec4 vParam;

void main() {
  float kind = vParam.x;
  float scan = 0.65 + 0.35 * sin(vWorld.y * 38.0 - uTime * 7.0);
  float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vParam.y * 50.0);
  float energy = uGlow.w;
  vec3 col;
  float a;
  if (vPart > 0.5) {
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float rim = exp(-e * 14.0);
    a = (0.2 + rim * 0.55) * scan * flick;
    col = vColor.rgb * (1.1 + rim * 0.9);
  } else {
    a = 0.42 * scan;
    col = vColor.rgb * 0.9;
  }
  if (kind > 1.5) a *= 0.75 + 0.25 * sin(uTime * 8.0);
  a *= vColor.a * fhFogKeep();
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * energy * a, a * 0.35);
  ${GLSL_OUTPUT}
}
`;

function flagGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.035, 0.04, POLE_H, 6, 1, true);
  pole.translate(0, POLE_H / 2, 0);
  const cloth = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 8, 3);
  cloth.translate(CLOTH_W / 2 + 0.03, POLE_H - CLOTH_H / 2 - 0.08, 0);
  const knob = new THREE.OctahedronGeometry(0.075, 0);
  knob.translate(0, POLE_H + 0.06, 0);
  const tag = (g: THREE.BufferGeometry, part: number): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [tag(pole, 0), tag(cloth, 1), tag(knob, 0)];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  pole.dispose();
  cloth.dispose();
  knob.dispose();
  if (!merged) throw new Error('ghost Flag geometry merge failed');
  return merged;
}

export class GhostFlagLayer {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh;
  private readonly set: InstanceSet;
  private readonly mat: THREE.ShaderMaterial;
  private readonly arrPos: Float32Array;
  private readonly arrColor: Float32Array;
  private readonly arrParam: Float32Array;
  private readonly arrAnchor: Float32Array;
  count = 0;

  constructor(scene: THREE.Scene, shared: SurveyUniforms, capacity: number) {
    this.scene = scene;
    const base = flagGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
    this.set = new InstanceSet(g, capacity);
    this.arrPos = this.set.add('iPos', 4);
    this.arrColor = this.set.add('iColor', 4);
    this.arrParam = this.set.add('iParam', 4);
    this.arrAnchor = this.set.add('iAnchor', 1, -1);
    this.mat = surveyMaterial(shared, { vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, hdrCap: 1.5 });
    this.mat.forceSinglePass = true;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }

  reset(): void {
    this.count = 0;
  }

  /** Append a ghost Flag at a node (or an explicit spot when anchor < 0), cloth facing `yaw`. */
  push(kind: GhostKind, anchor: number, x: number, z: number, yaw: number, color: THREE.Color, alpha: number, seed: number): void {
    if (this.count >= this.set.capacity) return;
    const i = this.count++;
    const o = i * 4;
    this.arrPos[o] = x;
    this.arrPos[o + 1] = 0;
    this.arrPos[o + 2] = z;
    this.arrPos[o + 3] = yaw;
    this.arrColor[o] = color.r;
    this.arrColor[o + 1] = color.g;
    this.arrColor[o + 2] = color.b;
    this.arrColor[o + 3] = alpha;
    this.arrParam[o] = kind;
    this.arrParam[o + 1] = seed;
    this.arrAnchor[i] = anchor;
  }

  commit(): void {
    this.set.commit(this.count);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.set.geo.dispose();
    this.mat.dispose();
  }
}
