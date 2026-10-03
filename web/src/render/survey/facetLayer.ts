/**
 * Survey facets as crystal glass: one instance per lattice facet (gl_InstanceID = facet id)
 * that reads its survey mask / crystal owner / instability / animation start from the facet
 * texture; empty facets cull in the vertex shader. Enclosed facets are translucent faction
 * glass with glowing rhombus edges, a brighter rim on the territory boundary, a fresnel sheen
 * and a slow caustic shimmer; crystallized facets get an inner bevel and glints. Overlap
 * facets interfere: two faction gratings beat into a moiré whose strength follows
 * instability, crackling near discharge. Gains fill radially with a hot front (sweep order
 * comes from the per-facet start time); losses dissolve through noise with ember edges.
 */
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_FRAG, GLSL_VERT, GLSL_OUTPUT, LIFT, cornerQuad, surveyMaterial } from './glsl';
import type { SurveyUniforms } from './glsl';
import type { SurveyData } from './surveyData';

const FILL = 0.65;
const DISSOLVE = 0.8;

const VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
attribute vec2 aCorner;
attribute vec4 iNodes;
varying vec2 vUv;
varying vec3 vWorld;
flat varying vec4 vState;
flat varying vec3 vGeom;
flat varying vec2 vCentroid;
flat varying float vCamOver;

void main() {
  int f = gl_InstanceID;
  vec4 st = fhFacet(f);
  int packed = fhId(st.x);
  int cur = packed & 15;
  int prev = (packed >> 4) & 15;
  float k = uTime - st.w;
  bool hov = f == fhId(uHover.z) && uHover.w > 0.001;
  if (cur == 0 && !(prev != 0 && k < ${DISSOLVE.toFixed(2)}) && !hov) FH_CULL
  vec2 c0 = fhNode(fhId(iNodes.x)).xy;
  vec2 c1 = fhNode(fhId(iNodes.y)).xy;
  vec2 c2 = fhNode(fhId(iNodes.z)).xy;
  vec2 c3 = fhNode(fhId(iNodes.w)).xy;
  vec2 P = aCorner.y < 0.5 ? (aCorner.x < 0.5 ? c0 : c1) : (aCorner.x > 0.5 ? c2 : c3);
  vec2 e1 = c1 - c0;
  vec2 e3 = c3 - c0;
  float L = length(e1);
  float sinA = abs(e1.x * e3.y - e1.y * e3.x) / max(1e-4, L * length(e3));
  vec4 mv = viewMatrix * vec4(P.x, ${LIFT.facet}, P.y, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
  vUv = aCorner;
  vWorld = vec3(P.x, ${LIFT.facet}, P.y);
  vState = st;
  vGeom = vec3(L, sinA, float(f));
  vCentroid = (c0 + c1 + c2 + c3) * 0.25;
  // 1 while the camera is over this facet (inside its bounding circle, at avatar heights):
  // the whole facet then fades instead of reading as a slab under the camera.
  float over = length(cameraPosition.xz - vCentroid) - 0.95 * L;
  vCamOver = (1.0 - smoothstep(0.0, 6.0, over)) * (1.0 - smoothstep(12.0, 30.0, cameraPosition.y));
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_FRAG}
varying vec2 vUv;
varying vec3 vWorld;
flat varying vec4 vState;
flat varying vec3 vGeom;
flat varying vec2 vCentroid;
flat varying float vCamOver;

/** Thin bright filaments where warped sine gratings cross zero: a cheap caustic network. */
float fhCaustic(vec2 p, float t) {
  vec2 q = p;
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += 0.6 * vec2(sin(q.y * 1.7 + t * 0.8 + fi), sin(q.x * 1.5 - t * 0.6 + fi * 2.1));
    acc += 1.0 - abs(sin(q.x * 1.2 + q.y * 0.8));
  }
  return pow(acc / 3.0, 7.0);
}

void main() {
  int packed = fhId(vState.x);
  int cur = packed & 15;
  int prev = (packed >> 4) & 15;
  int boundary = (packed >> 8) & 15;
  int cp = fhId(vState.y);
  int crystalCur = (cp & 7) - 1;
  int crystalPrev = (cp >> 3) - 1;
  float inst = vState.z;
  float k = uTime - vState.w;
  float L = vGeom.x;
  float sinA = vGeom.y;
  int fid = fhId(vGeom.z);
  vec2 wp = vWorld.xz;

  // Interference gratings (used by overlap facets): one fine grating per faction, a few
  // degrees apart. Their beat (the difference wave) is evaluated analytically so the large
  // fringes never alias, and the fine lines fade out once they fall below a pixel.
  // Instability swings the gratings apart: fringes tighten as the overlap destabilizes.
  // Derivatives are taken first, before any discard or per-fragment branch.
  float ang = 0.35 + float(cur | prev) * 0.45;
  float dAng = 0.14 + inst * 0.16;
  float pA = dot(wp, vec2(cos(ang), sin(ang))) * 17.0 + uTime * 0.9;
  float pB = dot(wp, vec2(cos(ang + dAng), sin(ang + dAng))) * 17.7 - uTime * 0.7;
  float resolved = clamp(1.6 - max(fwidth(pA), fwidth(pB)) * 0.6, 0.0, 1.0);

  float d0 = vUv.y * L * sinA;
  float d1 = (1.0 - vUv.x) * L * sinA;
  float d2 = (1.0 - vUv.y) * L * sinA;
  float d3 = vUv.x * L * sinA;
  float dE = min(min(d0, d1), min(d2, d3));
  // Pixel footprint of the metric edge distance, taken before any discard or branch.
  float dEpx = max(fwidth(dE), 1e-4);
  float dB = 1e3;
  if ((boundary & 1) != 0) dB = min(dB, d0);
  if ((boundary & 2) != 0) dB = min(dB, d1);
  if ((boundary & 4) != 0) dB = min(dB, d2);
  if ((boundary & 8) != 0) dB = min(dB, d3);

  float rC = length(wp - vCentroid) / max(1.0, L * 0.72);
  float pg = clamp(k / ${FILL.toFixed(2)}, 0.0, 1.0);
  float pl = clamp(k / ${DISSOLVE.toFixed(2)}, 0.0, 1.0);
  float front = pg * 1.35;
  float filled = 1.0 - smoothstep(front - 0.14, front, rC);
  float fillFront = fhGauss((rC - front) / 0.07) * (1.0 - pg);
  float dn = fhNoise(wp * 1.6 + float(fid) * 3.1);
  float kept = smoothstep(pl - 0.06, pl, dn);
  float ember = pl > 0.0 && pl < 1.0 ? fhGauss((dn - pl) / 0.035) * (1.0 - pl) : 0.0;

  vec3 col = vec3(0.0);
  float wsum = 0.0;
  int nFac = 0;
  int fa = -1;
  int fb = -1;
  float wa = 0.0;
  float wb = 0.0;
  float flash = 0.0;
  vec3 flashCol = vec3(0.0);
  for (int f = 0; f < 4; f++) {
    bool now = ((cur >> f) & 1) == 1;
    bool was = ((prev >> f) & 1) == 1;
    float w = 0.0;
    if (now && was) {
      w = 1.0;
    } else if (now) {
      if (k >= 0.0) {
        w = filled;
        float fl = fillFront * 1.6 + filled * (1.0 - pg) * (1.0 - pg) * 0.6;
        flash += fl;
        flashCol += fhFaction(f) * fl;
      }
    } else if (was) {
      w = k < 0.0 ? 1.0 : kept * (1.0 - pl * 0.4);
      float fl = ember * 1.4;
      flash += fl;
      flashCol += fhFaction(f) * fl;
    }
    if (w > 0.001) {
      col += fhFaction(f) * w;
      wsum += w;
      nFac++;
      if (w > wa) {
        fb = fa;
        wb = wa;
        fa = f;
        wa = w;
      } else if (w > wb) {
        fb = f;
        wb = w;
      }
    }
  }
  bool hov = fid == fhId(uHover.z);
  if (wsum < 0.001 && flash < 0.001 && !hov) discard;
  vec3 base = wsum > 0.0 ? col / wsum : flashCol / max(flash, 1e-3);
  float cover = min(1.0, wsum);
  bool crystal = crystalCur >= 0;
  if (crystal && crystalPrev != crystalCur && k >= 0.0) {
    float fl = (1.0 - pg) * 1.4;
    flash += fl;
    flashCol += fhFaction(crystalCur) * fl;
  }

  // Sun (thick) facets run warm, Moon (thin) facets cool.
  base *= mix(vec3(0.9, 0.97, 1.1), vec3(1.07, 1.0, 0.93), step(0.8, sinA));

  // Energy budget. The glass body is a TINT: it is alpha-blended over the ground in a colour
  // matched to the scene's own radiance (dark at night), so the body never adds light.
  // Seams, sheen and caustics are explicit emission that fades at night, under the night
  // exposure lift, near the camera and while the camera's view lies inside a Survey (where
  // the glass would cover the whole screen). The territory rim stays the readable line.
  float day = fhDay();
  float viewDist = length(cameraPosition - vWorld);
  // Glass close to the camera covers a lot of screen: body and seams fade with distance and
  // when the camera is over the facet; the territory rim fades less (it is the line).
  float near = smoothstep(3.0, 30.0, viewDist);
  float nearFade = mix(0.2, 1.0, near) * (1.0 - 0.75 * vCamOver);
  float glass = mix(0.35, 1.0, day) * uGlow.x * (1.0 - 0.55 * uGlow.y * mix(1.0, 0.4, day)) * nearFade * cover;
  float rimK = mix(0.6, 1.0, day) * uGlow.x * mix(0.5, 1.0, near) * cover;
  vec3 V = (cameraPosition - vWorld) / max(viewDist, 1e-4);
  float fres = pow(1.0 - abs(V.y), 3.0) * day;
  // Interior rhombus seams stay faint (two facets share each); the territory rim is the line.
  float edge = exp(-dE / 0.09) * 0.32 + exp(-dE / 0.7) * 0.05;
  float rim = exp(-dB / 0.16) * 1.1 + exp(-dB / 1.3) * 0.22;
  float bevel = crystal ? fhGauss((dE - 0.55) / 0.05) * 0.7 : 0.0;
#ifdef FH_LOW
  float caus = 0.0;
  float glint = 0.0;
#else
  float caus = fhCaustic(wp * 0.45, uTime) * (crystal ? 0.45 : 0.2) * mix(0.3, 1.0, day);
  vec2 gc = wp * 1.1;
  float gh = fhHash(floor(gc) + float(fid));
  vec2 gf = fract(gc) - 0.5;
  float glint = crystal ? step(0.8, gh) * pow(max(0.0, sin(uTime * (1.5 + gh * 3.0) + gh * 40.0)), 24.0) * exp(-dot(gf, gf) * 90.0) * 3.0 : 0.0;
#endif
  float tA = cover * ((crystal ? 0.2 : 0.13) * mix(1.0, 1.4, uViewBlend) * nearFade + rim * 0.15 + edge * 0.1);
  vec3 body = base * mix(0.14, 0.9, max(day, 0.5 * uViewBlend));
  vec3 emit = base * ((edge * 0.45 + bevel * 0.4 + caus * 0.2) * glass + rim * 1.1 * rimK)
    + (vec3(0.8, 0.9, 1.0) * 0.025 + base * 0.04) * fres * glass
    + vec3(1.0) * glint * glass;
  float dim = mix(0.6, 1.0, day);

  if (nFac >= 2) {
    vec3 ca = fhFaction(fa);
    vec3 cb = fhFaction(fb);
    float g1 = mix(0.2, smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(pA)), resolved);
    float g2 = mix(0.2, smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(pB)), resolved);
    float fringe = smoothstep(0.5, 1.0, 0.5 + 0.5 * cos(pA - pB));
    float amp = 0.2 + inst * 0.8;
    vec3 mc = ca * g1 * 1.3 + cb * g2 * 1.3 + mix(ca, cb, 0.5) * fringe * 1.2;
    // Interference is a warning: it keeps more of its light at night than the plain glass.
    emit += mc * (0.06 + 0.2 * amp) * mix(0.5, 1.0, day) * uGlow.x * cover;
    tA = max(tA, cover * (0.1 + (g1 + g2) * 0.08 * amp + fringe * 0.15 * amp));
    if (inst > 0.6) {
      float v = 1.0 - abs(fhFbm(wp * 0.8 + vec2(uTime * 0.9, -uTime * 0.7)) * 2.0 - 1.0);
      float crack = pow(v, 18.0) * (inst - 0.55) * 3.0;
      emit += vec3(0.9, 0.95, 1.0) * crack * dim;
      tA += crack * 0.2;
    }
    if (inst > 0.88) {
      float fl = step(0.45, fhHash(vec2(floor(uTime * 16.0), float(fid))));
      emit *= 0.6 + 0.8 * fl;
    }
  }

  float pulse = fhCrystalPulse(wp);
  emit += vec3(0.6, 0.9, 1.0) * pulse * cover * 0.25 * dim;
  emit *= 1.0 + uTide.x * 0.35 * sin(uTime * 11.0 + dn * 12.0);
  emit += (flashCol * 0.45 + vec3(flash * 0.03)) * dim;
  tA += min(flash, 1.0) * 0.3;
  if (hov) {
    // A crisp outline about two pixels wide with no glow tail: up close a soft band would fill
    // the facet. Only shown while facets are what the player is pointing at (uHover.w).
    float line = 1.0 - smoothstep(1.2 * dEpx, 2.6 * dEpx, dE);
    float h = line * (0.75 + 0.25 * sin(uTime * 6.0)) * uHover.w;
    emit += vec3(1.0, 0.95, 0.8) * h * 0.8;
    tA += h * 0.3;
  }
  float keep = fhFogKeep();
  tA = clamp(tA, 0.0, 0.92) * keep;
  gl_FragColor = vec4(body * tA + emit * keep, tA);
  ${GLSL_OUTPUT}
}
`;

export class FacetLayer {
  private readonly scene: THREE.Scene;
  private readonly data: SurveyData;
  private readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly nodes: THREE.InstancedBufferAttribute;
  private builtTopology = -1;

  constructor(scene: THREE.Scene, data: SurveyData, shared: SurveyUniforms, low: boolean) {
    this.scene = scene;
    this.data = data;
    this.geo = cornerQuad([0, 0, 1, 0, 1, 1, 0, 1]);
    this.nodes = new THREE.InstancedBufferAttribute(new Float32Array(data.facetCount * 4), 4);
    this.nodes.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iNodes', this.nodes);
    this.geo.instanceCount = data.facetCount;
    this.mat = surveyMaterial(shared, {
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      defines: low ? { FH_LOW: 1 } : {},
      // Glass is a tint, not a light: even its rim stays far below the bloom threshold.
      hdrCap: 1.2,
    });
    this.mat.forceSinglePass = true;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update(): void {
    if (this.builtTopology === this.data.topology) return;
    this.builtTopology = this.data.topology;
    const facets = this.data.lat.facets;
    const arr = this.nodes.array;
    for (let f = 0; f < facets.length; f++) {
      const ns = facets[f].nodes;
      arr[f * 4] = ns[0];
      arr[f * 4 + 1] = ns[1];
      arr[f * 4 + 2] = ns[2];
      arr[f * 4 + 3] = ns[3];
    }
    this.nodes.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
