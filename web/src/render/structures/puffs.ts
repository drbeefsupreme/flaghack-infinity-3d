/**
 * PuffField: a fixed-capacity, GPU-instanced billboard particle pool owned by the
 * structures layer (smoke from disabled buildings and wrecks, construction dust, Hearth
 * embers, Drug Lab vapour, completion sparkles). Struct-of-arrays CPU state, compacted into
 * instanced attributes each frame; no per-frame allocation. Event-driven combat VFX live in
 * render/vfx; these are the emitters that belong to the buildings themselves.
 */
import * as THREE from 'three';

const PUFF_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, rotation, twinkle phase
attribute vec3 iColor;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.z);
  float s = sin(iData.z);
  vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
  mvPosition.xy += corner;
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = iData.y;
  #ifdef PUFF_ADDITIVE
  vAlpha *= 0.65 + 0.35 * sin(uTime * 23.0 + iData.w);
  #endif
  vColor = iColor;
  #include <fog_vertex>
}
`;

const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  #ifdef PUFF_ADDITIVE
  float a = smoothstep(0.5, 0.0, length(vUv - 0.5)) * vAlpha;
  vec3 col = vColor * a * 1.6;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - fogFactor;
  #endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #else
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  #endif
}
`;

export class PuffField {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private next = 0;
  private readonly uniforms: { uMap: THREE.IUniform<THREE.Texture>; uLight: THREE.IUniform<number>; uTime: THREE.IUniform<number> };
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  // CPU state.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  /** age, life, size0, size1, alpha0, rot, rotVel, buoyancy */
  private readonly st: Float32Array;
  // GPU attributes.
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aData: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;

  constructor(capacity: number, additive: boolean, map: THREE.Texture) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.st = new Float32Array(capacity * 8);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geom = new THREE.InstancedBufferGeometry();
    this.geom.index = quad.index;
    this.geom.setAttribute('position', quad.getAttribute('position'));
    this.geom.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('iPos', this.aPos);
    this.geom.setAttribute('iData', this.aData);
    this.geom.setAttribute('iColor', this.aColor);
    this.geom.instanceCount = 0;
    const fog = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    this.uniforms = { uMap: { value: map }, uLight: { value: 1 }, uTime: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fog, ...this.uniforms },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { PUFF_ADDITIVE: '' } : {},
    });
    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  /**
   * Spawn one puff. Colour is linear RGB. `grow` is the size at end of life; `buoyancy`
   * accelerates upward (smoke) and drag slows horizontal drift.
   */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    grow: number,
    life: number,
    color: THREE.Color,
    alpha: number,
    buoyancy = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const p = i * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.vel[p] = vx;
    this.vel[p + 1] = vy;
    this.vel[p + 2] = vz;
    this.col[p] = color.r;
    this.col[p + 1] = color.g;
    this.col[p + 2] = color.b;
    const s = i * 8;
    this.st[s] = 0;
    this.st[s + 1] = life;
    this.st[s + 2] = size;
    this.st[s + 3] = grow;
    this.st[s + 4] = alpha;
    this.st[s + 5] = (x * 12.9898 + z * 78.233) % 6.283;
    this.st[s + 6] = (((x + y) * 43.7) % 1) - 0.5;
    this.st[s + 7] = buoyancy;
  }

  /** Integrate and upload. `light` scales smoke albedo (dimmer at night). */
  update(dt: number, time: number, light: number): void {
    this.uniforms.uLight.value = light;
    this.uniforms.uTime.value = time;
    const ap = this.aPos.array;
    const ad = this.aData.array;
    const ac = this.aColor.array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      const s = i * 8;
      const life = this.st[s + 1];
      if (life <= 0) continue;
      const age = this.st[s] + dt;
      if (age >= life) {
        this.st[s + 1] = 0;
        continue;
      }
      this.st[s] = age;
      const p = i * 3;
      const drag = Math.exp(-0.8 * dt);
      this.vel[p] *= drag;
      this.vel[p + 2] *= drag;
      this.vel[p + 1] += this.st[s + 7] * dt;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      this.st[s + 5] += this.st[s + 6] * dt;
      const t = age / life;
      const fadeIn = t < 0.12 ? t / 0.12 : 1;
      const fadeOut = (1 - t) * (1 - t);
      const o3 = n * 3;
      const o4 = n * 4;
      ap[o3] = this.pos[p];
      ap[o3 + 1] = this.pos[p + 1];
      ap[o3 + 2] = this.pos[p + 2];
      ad[o4] = this.st[s + 2] + (this.st[s + 3] - this.st[s + 2]) * t;
      ad[o4 + 1] = this.st[s + 4] * fadeIn * fadeOut;
      ad[o4 + 2] = this.st[s + 5];
      ad[o4 + 3] = i * 1.37;
      ac[o3] = this.col[p];
      ac[o3 + 1] = this.col[p + 1];
      ac[o3 + 2] = this.col[p + 2];
      n++;
    }
    this.geom.instanceCount = n;
    if (n > 0) {
      this.aPos.clearUpdateRanges();
      this.aPos.addUpdateRange(0, n * 3);
      this.aPos.needsUpdate = true;
      this.aData.clearUpdateRanges();
      this.aData.addUpdateRange(0, n * 4);
      this.aData.needsUpdate = true;
      this.aColor.clearUpdateRanges();
      this.aColor.addUpdateRange(0, n * 3);
      this.aColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geom.dispose();
    this.material.dispose();
  }
}
