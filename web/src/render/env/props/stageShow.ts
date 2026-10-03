/**
 * Sound-camp light show, all fake (no THREE lights): every moving head on every stage throws
 * an additive cone of hazy light with a lens flare, and the dance floor in front of each
 * stage gets the matching light pools where those cones meet the ground, a colour wash and
 * strobe flashes. Beams are choreographed on the CPU each frame (a few dozen numbers, no
 * allocation) into uniform arrays that both shaders read, so the pools land exactly where
 * the cones hit. Everything runs on the festival beat (ctx.beat, locked to the music's kick):
 * patterns change every 32 beats and everything fades out by day.
 */
import * as THREE from 'three';
import { hash01 } from '../../../sim/rng';
import type { EnvContext } from '../envTypes';
import type { StageRig } from './stages';

const MAX_BEAMS = 32;
const MAX_STAGES = 8;
/** Upper bound of fixtures per stage (loop bound in the floor shader). */
const MAX_PER_STAGE = 8;
const MAX_LEN = 38;
const PHRASE = 32;
/**
 * Largest change of the festival beat clock between two frames (beats) still taken as the
 * music playing on: about five frames' worth even across a dropped frame. A larger step either
 * way is the clock re-locking to the music (audio starting or resuming) and is absorbed.
 */
const MAX_BEAT_STEP = 1;

const enum Pattern {
  Fan,
  Sweep,
  Cross,
  Circle,
  Drop,
}
const PATTERNS = 5;

const BEAM_VERT = /* glsl */ `
#define MAX_BEAMS ${MAX_BEAMS}
uniform vec4 uBeamPos[MAX_BEAMS];
uniform vec4 uBeamDir[MAX_BEAMS];
uniform vec4 uBeamCol[MAX_BEAMS];
attribute float aKind;
attribute float aIndex;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vRadial;
varying vec2 vQuad;
varying float vAlong;
varying float vKind;
varying float vLen;
#include <fog_pars_vertex>

void main() {
  int i = int(aIndex + 0.5);
  vec4 P = uBeamPos[i];
  vec4 D = uBeamDir[i];
  vec4 C = uBeamCol[i];
  vec3 dir = D.xyz;
  vec3 ref = abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(ref, dir));
  vec3 b = cross(dir, t);
  vec3 world;
  vQuad = position.xy;
  vKind = aKind;
  vLen = P.w;
  if (aKind < 0.5) {
    float along = position.y * P.w;
    vec3 radial = t * position.x + b * position.z;
    world = P.xyz + dir * along + radial * (0.09 + along * C.w);
    vRadial = radial;
    vAlong = position.y;
    vColor = C.rgb * D.w;
  } else {
    // Lens flare: camera-facing quad, much brighter when the beam points at the viewer.
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    world = P.xyz + (camRight * position.x + camUp * position.y) * 0.55;
    vec3 toCam = cameraPosition - P.xyz;
    float facing = max(dot(dir, toCam / max(length(toCam), 1e-3)), 0.0);
    vColor = C.rgb * D.w * (0.5 + 2.0 * facing * facing * facing * facing);
    vRadial = vec3(0.0);
    vAlong = 0.0;
  }
  vWorld = world;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uStrength;
uniform float uTime;
uniform sampler2D uNoise;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vRadial;
varying vec2 vQuad;
varying float vAlong;
varying float vKind;
varying float vLen;
#include <fog_pars_fragment>

void main() {
  vec3 col;
  if (vKind < 0.5) {
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 radial = vRadial / max(length(vRadial), 1e-4);
    // Bright through the core of the cone, soft at its silhouette.
    float facing = abs(dot(radial, view));
    float core = facing * facing;
    float along = clamp(vAlong, 0.0, 1.0);
    float fade = (1.0 - along) * (1.0 - along) * smoothstep(0.0, 0.03, along);
    // Drifting haze inside the beam.
    vec2 uv = vec2(along * vLen * 0.04 - uTime * 0.05, (vWorld.x + vWorld.z) * 0.05 + uTime * 0.012);
    float haze = texture2D(uNoise, uv).g;
    // Kept dim so overlapping beams stay saturated under bloom + ACES instead of washing white.
    col = vColor * core * fade * (0.35 + 1.1 * haze) * 0.32;
  } else {
    float r2 = dot(vQuad, vQuad);
    float glow = exp(-r2 * 6.0) + 0.3 * exp(-abs(vQuad.y) * 28.0) * exp(-abs(vQuad.x) * 2.2);
    col = vColor * glow * (1.0 - smoothstep(0.8, 1.0, r2));
  }
  col *= uStrength;
  #ifdef USE_FOG
    col *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const POOL_VERT = /* glsl */ `
attribute float aStage;
attribute vec2 aLocal;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vStage;
#include <fog_pars_vertex>

void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vLocal = aLocal;
  vStage = aStage;
  vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const POOL_FRAG = /* glsl */ `
#define MAX_BEAMS ${MAX_BEAMS}
#define MAX_STAGES ${MAX_STAGES}
#define MAX_PER_STAGE ${MAX_PER_STAGE}
uniform vec4 uBeamPos[MAX_BEAMS];
uniform vec4 uBeamDir[MAX_BEAMS];
uniform vec4 uBeamCol[MAX_BEAMS];
/** x first beam, y beam count, z strobe, w wash. */
uniform vec4 uStageInfo[MAX_STAGES];
uniform vec4 uStageCol[MAX_STAGES];
/** xyz deck front centre, w half width. */
uniform vec4 uStageFront[MAX_STAGES];
uniform vec4 uStageFwd[MAX_STAGES];
uniform float uStrength;
uniform sampler2D uNoise;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vStage;
#include <fog_pars_fragment>

void main() {
  int s = int(vStage + 0.5);
  vec4 info = uStageInfo[s];
  int start = int(info.x + 0.5);
  int count = int(info.y + 0.5);
  vec3 sum = vec3(0.0);
  for (int k = 0; k < MAX_PER_STAGE; k++) {
    if (k >= count) break;
    int i = start + k;
    vec3 rel = vWorld - uBeamPos[i].xyz;
    vec3 dir = uBeamDir[i].xyz;
    float a = dot(rel, dir);
    if (a <= 0.0 || a > uBeamPos[i].w + 1.0) continue;
    float d = length(rel - dir * a);
    float rad = 0.09 + a * uBeamCol[i].w;
    sum += uBeamCol[i].rgb * uBeamDir[i].w * exp(-(d * d) / (rad * rad) * 1.8) * 1.6;
  }
  // Colour wash and strobe spilling off the stage.
  vec3 fwd = uStageFwd[s].xyz;
  vec3 rel = vWorld - uStageFront[s].xyz;
  float along = dot(rel, fwd);
  float across = length(rel - fwd * along);
  float spill = exp(-max(along, 0.0) / 9.0) * exp(-max(across - uStageFront[s].w, 0.0) / 4.0) * smoothstep(0.0, 1.5, along);
  sum += uStageCol[s].rgb * info.w * spill * 0.4;
  sum += vec3(info.z * spill * 1.6);
  float dust = 0.7 + 0.6 * texture2D(uNoise, vWorld.xz * 0.06).r;
  float edge = smoothstep(0.0, 0.12, vLocal.x) * (1.0 - smoothstep(0.88, 1.0, vLocal.x)) * (1.0 - smoothstep(0.85, 1.0, vLocal.y));
  vec3 col = sum * dust * edge * uStrength * 0.5;
  #ifdef USE_FOG
    col *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function beamGeometry(count: number): THREE.InstancedBufferGeometry {
  const segs = 14;
  const pos: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a), ring, Math.sin(a));
      kind.push(0);
    }
  }
  for (let i = 0; i < segs; i++) index.push(i, segs + 1 + i, i + 1, i + 1, segs + 1 + i, segs + 2 + i);
  const base = pos.length / 3;
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    pos.push(x, y, 0);
    kind.push(1);
  }
  index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i++) ids[i] = i;
  g.setAttribute('aIndex', new THREE.InstancedBufferAttribute(ids, 1));
  g.instanceCount = count;
  // Vertices are placed in the shader; never cull.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

interface Rig {
  stage: StageRig;
  first: number;
  palette: THREE.Color[];
}

const WHITE = new THREE.Color(1, 1, 1);
const tmpDir = new THREE.Vector3();

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class StageShow {
  private env: EnvContext;
  private rigs: Rig[] = [];
  private beamCount: number;
  private beams: THREE.Mesh;
  private pools: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private poolMat: THREE.ShaderMaterial;
  private uStrength = { value: 0 };
  private pos = new Float32Array(MAX_BEAMS * 4);
  private dir = new Float32Array(MAX_BEAMS * 4);
  private col = new Float32Array(MAX_BEAMS * 4);
  private info = new Float32Array(MAX_STAGES * 4);
  private stageCol = new Float32Array(MAX_STAGES * 4);
  private stageFront = new Float32Array(MAX_STAGES * 4);
  private stageFwd = new Float32Array(MAX_STAGES * 4);
  // Per-beam aim scratch (yaw, pitch) for the two patterns being blended.
  private aimA = { yaw: 0, pitch: 0 };
  private aimB = { yaw: 0, pitch: 0 };
  /**
   * Whole beats added to the festival clock to get the show's clock. The phase stays the
   * music's own, so pulses and strobes land on the kick; when the festival clock jumps, the
   * offset changes by whole beats so the heads carry on from where they were (a skip of at
   * most half a beat) instead of leaping to another point in the set.
   */
  private beatOffset = 0;
  private lastBeat = Number.NaN;

  constructor(env: EnvContext, stages: StageRig[]) {
    this.env = env;
    let next = 0;
    for (const stage of stages.slice(0, MAX_STAGES)) {
      const n = Math.min(stage.fixtures.length, MAX_PER_STAGE, MAX_BEAMS - next);
      if (n <= 0) break;
      const base = stage.color.clone();
      // Saturated variations of the camp colour: pale tints wash out to white at distance.
      const palette = [base, base.clone().offsetHSL(0.08, 0, 0), base.clone().offsetHSL(-0.08, 0, 0)];
      this.rigs.push({ stage: { ...stage, fixtures: stage.fixtures.slice(0, n) }, first: next, palette });
      next += n;
    }
    this.beamCount = next;
    this.rigs.forEach((r, s) => {
      this.info[s * 4] = r.first;
      this.info[s * 4 + 1] = r.stage.fixtures.length;
      r.stage.color.toArray(this.stageCol, s * 4);
      r.stage.front.toArray(this.stageFront, s * 4);
      this.stageFront[s * 4 + 3] = r.stage.hx;
      r.stage.forward.toArray(this.stageFwd, s * 4);
    });

    const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    const shared = {
      uBeamPos: { value: this.pos },
      uBeamDir: { value: this.dir },
      uBeamCol: { value: this.col },
      uStrength: this.uStrength,
      uTime: env.uniforms.uTime,
      uNoise: { value: env.noise },
    };
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { ...fog, ...shared },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.beams = new THREE.Mesh(beamGeometry(this.beamCount), this.beamMat);
    this.beams.name = 'stage-beams';
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 10;

    this.poolMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...shared,
        uStageInfo: { value: this.info },
        uStageCol: { value: this.stageCol },
        uStageFront: { value: this.stageFront },
        uStageFwd: { value: this.stageFwd },
      },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true,
    });
    this.pools = new THREE.Mesh(this.poolGeometry(), this.poolMat);
    this.pools.name = 'stage-pools';
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 9;
    env.root.add(this.pools, this.beams);
  }

  /** One ground quad per stage covering its dance floor (local x across, z away from the deck). */
  private poolGeometry(): THREE.BufferGeometry {
    const pos: number[] = [];
    const stage: number[] = [];
    const local: number[] = [];
    const index: number[] = [];
    const p = new THREE.Vector3();
    this.rigs.forEach((r, s) => {
      const w = r.stage.hx + 16;
      const z0 = r.stage.hz + 0.15;
      const z1 = r.stage.hz + 27;
      const corners = [
        [-w, z0, 0, 0],
        [w, z0, 1, 0],
        [w, z1, 1, 1],
        [-w, z1, 0, 1],
      ];
      const base = s * 4;
      for (const [x, z, u, v] of corners) {
        p.set(x, 0.05, z).applyMatrix4(r.stage.frame);
        pos.push(p.x, p.y, p.z);
        stage.push(s);
        local.push(u, v);
      }
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aStage', new THREE.Float32BufferAttribute(stage, 1));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(local, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }

  update(): void {
    const night = this.env.day.night;
    const strength = smooth01((night - 0.15) / 0.6);
    const on = strength > 0.01 && this.beamCount > 0;
    this.beams.visible = on;
    this.pools.visible = on;
    // Tracked while dark too, so a re-lock at any hour is absorbed before the lights come on.
    const festival = this.env.ctx.beat;
    const step = festival - this.lastBeat;
    if (Math.abs(step) > MAX_BEAT_STEP) this.beatOffset -= Math.round(step);
    this.lastBeat = festival;
    if (!on) return;
    this.uStrength.value = strength;
    const beatNow = festival + this.beatOffset;
    for (let s = 0; s < this.rigs.length; s++) {
      const r = this.rigs[s];
      // Stages run their sets offset from each other.
      const beat = beatNow + s * 6;
      const phrase = Math.floor(beat / PHRASE);
      const pat = Math.floor(hash01(phrase * 7919 + s * 104729) * PATTERNS);
      const prev = Math.floor(hash01((phrase - 1) * 7919 + s * 104729) * PATTERNS);
      const blend = smooth01((beat - phrase * PHRASE) / 2);
      const bar = Math.floor(beat / 4);
      const phase = beat - Math.floor(beat);
      const pulse = 0.62 + 0.38 * Math.exp(-phase * 4);
      // Floor, not %: a re-lock can leave the show clock just below zero, where % goes negative.
      const strobe = pat === Pattern.Drop ? Math.exp(-(beat * 2 - Math.floor(beat * 2)) * 10) * blend : 0;
      const n = r.stage.fixtures.length;
      for (let k = 0; k < n; k++) {
        const u = n > 1 ? k / (n - 1) - 0.5 : 0;
        this.aim(prev, u, k, s, beat, this.aimA);
        this.aim(pat, u, k, s, beat, this.aimB);
        const yaw = this.aimA.yaw + (this.aimB.yaw - this.aimA.yaw) * blend;
        const pitch = this.aimA.pitch + (this.aimB.pitch - this.aimA.pitch) * blend;
        const cp = Math.cos(pitch);
        const st = r.stage;
        tmpDir
          .copy(st.right)
          .multiplyScalar(Math.sin(yaw) * cp)
          .addScaledVector(st.forward, Math.cos(yaw) * cp);
        tmpDir.y += Math.sin(pitch);
        tmpDir.normalize();
        const o = st.fixtures[k];
        const i = r.first + k;
        const len = tmpDir.y < -0.02 ? Math.min(MAX_LEN, (o.y - 0.05) / -tmpDir.y) : MAX_LEN;
        this.pos[i * 4] = o.x;
        this.pos[i * 4 + 1] = o.y;
        this.pos[i * 4 + 2] = o.z;
        this.pos[i * 4 + 3] = len;
        this.dir[i * 4] = tmpDir.x;
        this.dir[i * 4 + 1] = tmpDir.y;
        this.dir[i * 4 + 2] = tmpDir.z;
        this.dir[i * 4 + 3] = pat === Pattern.Drop ? 0.3 + 1.0 * strobe : pulse;
        const c = pat === Pattern.Drop && strobe > 0.5 ? WHITE : r.palette[(k + bar) % r.palette.length];
        this.col[i * 4] = c.r;
        this.col[i * 4 + 1] = c.g;
        this.col[i * 4 + 2] = c.b;
        this.col[i * 4 + 3] = pat === Pattern.Sweep ? 0.075 : 0.055;
      }
      this.info[s * 4 + 2] = strobe;
      this.info[s * 4 + 3] = 0.45 + 0.55 * Math.exp(-phase * 3);
    }
  }

  /** Pan (yaw, from the stage's forward) and tilt (pitch, up positive) of a fixture. */
  private aim(pattern: number, u: number, k: number, s: number, beat: number, out: { yaw: number; pitch: number }): void {
    const q = Math.PI / 4;
    switch (pattern) {
      case Pattern.Fan:
        out.yaw = u * 1.3 + 0.22 * Math.sin(beat * (q / 2));
        out.pitch = 0.95 + 0.18 * Math.sin(beat * q + u * 3);
        break;
      case Pattern.Sweep:
        out.yaw = 0.6 * Math.sin(beat * (q / 2) + u * 1.6);
        out.pitch = -0.36 + 0.1 * Math.sin(beat * 2 * q);
        break;
      case Pattern.Cross:
        out.yaw = (k % 2 === 0 ? 1 : -1) * (0.25 + 0.4 * Math.sin(beat * (q / 2))) + u * 0.4;
        out.pitch = 0.3 + 0.25 * Math.sin(beat * (q / 4) + k);
        break;
      case Pattern.Circle:
        out.yaw = u * 0.7 + 0.38 * Math.cos(beat * q + k * 0.9);
        out.pitch = 0.55 + 0.32 * Math.sin(beat * q + k * 0.9);
        break;
      default: {
        // Drop: heads snap to new random spots on every beat.
        const b = Math.floor(beat);
        out.yaw = (hash01(b * 31 + k * 7 + s * 1013) - 0.5) * 1.4;
        out.pitch = -0.3 + hash01(b * 17 + k * 13 + s * 499) * 1.1;
      }
    }
  }

  dispose(): void {
    this.env.root.remove(this.pools, this.beams);
    this.beams.geometry.dispose();
    this.pools.geometry.dispose();
    this.beamMat.dispose();
    this.poolMat.dispose();
  }
}
