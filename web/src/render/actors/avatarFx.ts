/**
 * Vexillomancer effects tied to the rig: channel auras (a rising column of faction light while
 * aligning a chakra, holding the Hearth or arguing Flagellian Dialectics) as one instanced
 * draw, and staff swing trails (a fading ribbon between hand and finial, sampled each frame)
 * for all avatars in one dynamic strip. Both additive, no shadows.
 */
import * as THREE from 'three';
import { markInstancesDirty } from './util';

const MAX_AURAS = 8;
const TRAIL_SAMPLES = 18;
const TRAIL_LIFE = 0.2;

const AURA_VERTEX = /* glsl */ `
attribute vec4 aAuraA; // base xyz, intensity
attribute vec4 aAuraB; // colour rgb, radius
varying vec2 vUv;
varying vec4 vA;
varying vec3 vCol;
void main() {
  vUv = uv;
  vA = aAuraA;
  vCol = aAuraB.rgb;
  vec3 p = position * vec3(aAuraB.w, 2.9, aAuraB.w) + aAuraA.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const AURA_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vA;
varying vec3 vCol;
void main() {
  float h = vUv.y;
  float fadeH = pow(max(1.0 - h, 0.0), 1.6) * smoothstep(0.0, 0.06, h);
  float streak = 0.55 + 0.45 * sin(vUv.x * 6.2832 * 7.0 + h * 9.0 - uTime * 5.0);
  float rise = smoothstep(0.75, 1.0, fract(h * 2.5 - uTime * 0.9 + sin(vUv.x * 31.4) * 0.15));
  float a = vA.w * fadeH * (0.35 * streak + 0.9 * rise);
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const TRAIL_VERTEX = /* glsl */ `
attribute vec4 aTrail; // colour rgb, alpha
attribute float aSide; // 0 at the hand, 1 at the finial
varying vec4 vT;
varying float vSide;
void main() {
  vT = aTrail;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAGMENT = /* glsl */ `
varying vec4 vT;
varying float vSide;
void main() {
  float a = vT.a * smoothstep(0.15, 1.0, vSide);
  gl_FragColor = vec4(vT.rgb * a * 1.8, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Per-avatar ring buffer of swing samples (hand + finial positions, intensity, time). */
class TrailBuffer {
  readonly data = new Float32Array(TRAIL_SAMPLES * 8);
  head = 0;

  push(hand: THREE.Vector3, tip: THREE.Vector3, intensity: number, time: number): void {
    this.head = (this.head + 1) % TRAIL_SAMPLES;
    const o = this.head * 8;
    const d = this.data;
    d[o] = hand.x;
    d[o + 1] = hand.y;
    d[o + 2] = hand.z;
    d[o + 3] = tip.x;
    d[o + 4] = tip.y;
    d[o + 5] = tip.z;
    d[o + 6] = intensity;
    d[o + 7] = time;
  }
}

export class AvatarFx {
  private readonly scene: THREE.Scene;
  private readonly auraGeo: THREE.InstancedBufferGeometry;
  private readonly auraA: THREE.InstancedBufferAttribute;
  private readonly auraB: THREE.InstancedBufferAttribute;
  private readonly auraMat: THREE.ShaderMaterial;
  private readonly auraMesh: THREE.Mesh;
  private auraCount = 0;
  private readonly trailGeo: THREE.BufferGeometry;
  private readonly trailPos: THREE.BufferAttribute;
  private readonly trailCol: THREE.BufferAttribute;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly trailMesh: THREE.Mesh;
  private readonly trails: TrailBuffer[] = [];
  private readonly time = { value: 0 };

  constructor(scene: THREE.Scene, avatarSlots: number) {
    this.scene = scene;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0);
    this.auraGeo = new THREE.InstancedBufferGeometry();
    this.auraGeo.index = cyl.index;
    this.auraGeo.setAttribute('position', cyl.getAttribute('position'));
    this.auraGeo.setAttribute('uv', cyl.getAttribute('uv'));
    this.auraA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_AURAS * 4), 4);
    this.auraB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_AURAS * 4), 4);
    this.auraA.setUsage(THREE.DynamicDrawUsage);
    this.auraB.setUsage(THREE.DynamicDrawUsage);
    this.auraGeo.setAttribute('aAuraA', this.auraA);
    this.auraGeo.setAttribute('aAuraB', this.auraB);
    this.auraGeo.instanceCount = 0;
    this.auraMat = new THREE.ShaderMaterial({
      vertexShader: AURA_VERTEX,
      fragmentShader: AURA_FRAGMENT,
      uniforms: { uTime: this.time },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.auraMesh = new THREE.Mesh(this.auraGeo, this.auraMat);
    this.auraMesh.frustumCulled = false;
    this.auraMesh.renderOrder = 3;
    this.auraMesh.name = 'actors-auras';

    for (let i = 0; i < avatarSlots; i++) this.trails.push(new TrailBuffer());
    const verts = avatarSlots * TRAIL_SAMPLES * 2;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.trailCol = new THREE.BufferAttribute(new Float32Array(verts * 4), 4);
    this.trailPos.setUsage(THREE.DynamicDrawUsage);
    this.trailCol.setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(verts);
    for (let i = 0; i < verts; i++) side[i] = i % 2;
    const index: number[] = [];
    for (let a = 0; a < avatarSlots; a++) {
      for (let s = 0; s < TRAIL_SAMPLES - 1; s++) {
        const v = (a * TRAIL_SAMPLES + s) * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    this.trailGeo.setAttribute('position', this.trailPos);
    this.trailGeo.setAttribute('aTrail', this.trailCol);
    this.trailGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.trailGeo.setIndex(index);
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.trailMesh = new THREE.Mesh(this.trailGeo, this.trailMat);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 3;
    this.trailMesh.name = 'actors-swing-trails';
    scene.add(this.auraMesh, this.trailMesh);
  }

  begin(): void {
    this.auraCount = 0;
  }

  aura(x: number, y: number, z: number, intensity: number, color: THREE.Color, radius: number): void {
    if (this.auraCount >= MAX_AURAS || intensity <= 0.01) return;
    const i = this.auraCount++;
    const a = this.auraA.array;
    const b = this.auraB.array;
    a[i * 4] = x;
    a[i * 4 + 1] = y;
    a[i * 4 + 2] = z;
    a[i * 4 + 3] = intensity;
    b[i * 4] = color.r;
    b[i * 4 + 1] = color.g;
    b[i * 4 + 2] = color.b;
    b[i * 4 + 3] = radius;
  }

  /** Record this frame's hand/finial sample for avatar slot `slot` (intensity 0 = not swinging). */
  trailSample(slot: number, hand: THREE.Vector3, tip: THREE.Vector3, intensity: number, time: number): void {
    this.trails[slot]?.push(hand, tip, intensity, time);
  }

  end(time: number, colors: readonly THREE.Color[]): void {
    this.time.value = time;
    this.auraGeo.instanceCount = this.auraCount;
    markInstancesDirty(this.auraA, this.auraCount);
    markInstancesDirty(this.auraB, this.auraCount);

    const pos = this.trailPos.array;
    const col = this.trailCol.array;
    for (let a = 0; a < this.trails.length; a++) {
      const tr = this.trails[a];
      const c = colors[a] ?? colors[0];
      for (let s = 0; s < TRAIL_SAMPLES; s++) {
        // s = 0 is the newest sample; walk backwards through the ring buffer.
        const o = ((tr.head - s + TRAIL_SAMPLES) % TRAIL_SAMPLES) * 8;
        const d = tr.data;
        const age = time - d[o + 7];
        const alpha = d[o + 6] * Math.max(0, 1 - age / TRAIL_LIFE) * (1 - s / TRAIL_SAMPLES);
        const v = (a * TRAIL_SAMPLES + s) * 2;
        pos[v * 3] = d[o];
        pos[v * 3 + 1] = d[o + 1];
        pos[v * 3 + 2] = d[o + 2];
        pos[v * 3 + 3] = d[o + 3];
        pos[v * 3 + 4] = d[o + 4];
        pos[v * 3 + 5] = d[o + 5];
        for (let k = 0; k < 2; k++) {
          col[(v + k) * 4] = c.r;
          col[(v + k) * 4 + 1] = c.g;
          col[(v + k) * 4 + 2] = c.b;
          col[(v + k) * 4 + 3] = alpha;
        }
      }
    }
    this.trailPos.needsUpdate = true;
    this.trailCol.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.auraMesh, this.trailMesh);
    this.auraGeo.dispose();
    this.auraMat.dispose();
    this.trailGeo.dispose();
    this.trailMat.dispose();
  }
}
