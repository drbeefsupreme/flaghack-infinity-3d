/** Read-only eye charge, aimed original pupil, instantaneous beam and 5 m impact flash. */
import * as THREE from 'three';
import type { BossState } from '../../../../sim/boss';
import { BOSS_EYE_TIMING, BOSS_EYE_BLAST_RADIUS, BOSS_EYE_MAX_RANGE } from '../../../../sim/boss';
import { BOSS_EYE_HEAD_LOCAL_ORIGIN, BOSS_EYE_HEAD_LOCAL_FORWARD, solveBossEyeAim } from '../../../../sim/bossEyeRig';
import { smooth } from './revealTimeline';

const EYE_MATERIALS = new Set([
  'HAT | Vermilion iris ring', 'HAT | Saffron iris ring', 'HAT | Turquoise iris ring',
  'HAT | Deep teal iris', 'HAT | Obsidian pupil', 'HAT | Warm porcelain sclera', 'HAT | Eye enamel highlight',
]);
const Z = new THREE.Vector3(0, 0, 1);

/** Preserve every source color/material value; add emission only to the original eye surfaces. */
export function applyBossEyeGlow(material: THREE.MeshStandardMaterial, power: { value: number }): boolean {
  if (!EYE_MATERIALS.has(material.name)) return false;
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uBossEyePower = power;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBossEyePower;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * (0.28 + uBossEyePower * 2.5)
          + vec3(1.0) * pow(uBossEyePower, 2.0) * 5.0;`);
  };
  material.customProgramCacheKey = () => key + '-boss-eye-glow-v1';
  return true;
}

/** Sample the actual head matrix, including the original bone roll and approved 20/32 scale. */
export function readBossEyeGaze(head: THREE.Bone, origin = new THREE.Vector3(), direction = new THREE.Vector3()): { origin: THREE.Vector3; direction: THREE.Vector3 } {
  head.updateWorldMatrix(true, false);
  origin.set(BOSS_EYE_HEAD_LOCAL_ORIGIN.x, BOSS_EYE_HEAD_LOCAL_ORIGIN.y, BOSS_EYE_HEAD_LOCAL_ORIGIN.z).applyMatrix4(head.matrixWorld);
  direction.set(BOSS_EYE_HEAD_LOCAL_FORWARD.x, BOSS_EYE_HEAD_LOCAL_FORWARD.y, BOSS_EYE_HEAD_LOCAL_FORWARD.z).transformDirection(head.matrixWorld);
  return { origin, direction };
}

export class BossEyeBeamFx {
  readonly group = new THREE.Group();
  readonly power = { value: 0 };
  private readonly head: THREE.Bone;
  private readonly beam = new THREE.Group();
  private readonly impact: THREE.Mesh;
  private readonly impactRays: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly geos = new Set<THREE.BufferGeometry>();
  private readonly mats = new Set<THREE.Material>();
  private readonly headPosition = new THREE.Vector3();
  private readonly headRotation = new THREE.Quaternion();
  private readonly parentRotation = new THREE.Quaternion();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly shotAge = { value: 0 };

  constructor(private readonly model: THREE.Group, private readonly stabilizeRearFlap: () => void = () => {}) {
    const head = model.getObjectByName('head');
    if (!(head instanceof THREE.Bone)) throw new Error('Boss eye is missing the original head bone');
    this.head = head;
    this.group.name = 'boss-eye-fx'; this.beam.name = 'boss-eye-beam'; this.group.add(this.beam);
    const materials = new Set<THREE.MeshStandardMaterial>();
    model.traverse(o => { if (o instanceof THREE.Mesh) for (const material of Array.isArray(o.material) ? o.material : [o.material])
      if (material instanceof THREE.MeshStandardMaterial) materials.add(material); });
    for (const material of materials) applyBossEyeGlow(material, this.power);
    const add = (mesh: THREE.Mesh, name: string, parent: THREE.Object3D = this.group): THREE.Mesh => {
      mesh.name = name; mesh.frustumCulled = false; parent.add(mesh); this.geos.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.mats.add(material);
      return mesh;
    };
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false).rotateX(Math.PI / 2).translate(0, 0, .5);
    const white = (alpha: number) => new THREE.ShaderMaterial({ transparent: alpha < 1, depthWrite: false,
      blending: alpha < 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uAlpha: { value: alpha } },
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform float uAlpha;void main(){gl_FragColor=vec4(vec3(1.0),uAlpha);\n#include <colorspace_fragment>}',
    });
    const core = add(new THREE.Mesh(cylinder, white(1)), 'boss-eye-white-core', this.beam); core.scale.set(.075, .075, 1); core.renderOrder = 8;
    const beamGlow = add(new THREE.Mesh(cylinder, white(.18)), 'boss-eye-white-halo', this.beam); beamGlow.scale.set(.24, .24, 1); beamGlow.renderOrder = 9;
    this.halo = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPower: this.power },
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;vec4 center=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);
        center.xy+=position.xy*(0.7+uPower*1.6);gl_Position=projectionMatrix*center;}`.replace('varying vec2', 'uniform float uPower;varying vec2'),
      fragmentShader: `uniform float uPower;varying vec2 vUv;void main(){float r=length((vUv-.5)*2.0);
        float a=exp(-r*r*8.0)*(0.045+uPower*.65)*(1.0-smoothstep(.65,1.0,r));
        gl_FragColor=vec4(vec3(1.0),a);\n#include <colorspace_fragment>}`,
    })), 'boss-eye-charge-halo'); this.halo.renderOrder = 7;
    this.impact = add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uShotAge: this.shotAge },
      vertexShader: `varying vec3 vNormal;varying vec3 vView;varying float vWorldY;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
        vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);vWorldY=(modelMatrix*vec4(position,1.0)).y;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform float uShotAge;varying vec3 vNormal;varying vec3 vView;varying float vWorldY;void main(){
        if(vWorldY<.025)discard;float edge=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),3.0);
        float fade=1.0-clamp(uShotAge/${BOSS_EYE_TIMING.beam.toFixed(1)},0.0,1.0);
        float a=(.04+edge*.6)*fade*fade;gl_FragColor=vec4(vec3(1.0),a);\n#include <colorspace_fragment>}`,
    })), 'boss-eye-impact-explosion'); this.impact.scale.setScalar(BOSS_EYE_BLAST_RADIUS); this.impact.renderOrder = 10;
    // Crossed tapered rays turn the spherical edge into an explosive impact,
    // while their exact outer bound stays inside the authoritative 5 m radius.
    const rays: number[] = [];
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963229728653, height = .03 + (i % 8) / 8 * .94;
      const axis = new THREE.Vector3(Math.cos(angle) * Math.sqrt(1 - height * height), height, Math.sin(angle) * Math.sqrt(1 - height * height));
      const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      const length = .62 + ((i * 7) % 11) / 11 * .36;
      for (const across of [side, new THREE.Vector3().crossVectors(axis, side).normalize()]) {
        const a = axis.clone().multiplyScalar(.08).addScaledVector(across, -.035);
        const b = axis.clone().multiplyScalar(.08).addScaledVector(across, .035);
        const tip = axis.clone().multiplyScalar(length);
        rays.push(...a.toArray(), ...b.toArray(), ...tip.toArray());
      }
    }
    const rayGeo = new THREE.BufferGeometry(); rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(rays, 3));
    this.impactRays = add(new THREE.Mesh(rayGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uShotAge: this.shotAge },
      vertexShader: `uniform float uShotAge;varying float vRadius;void main(){vRadius=length(position);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float uShotAge;varying float vRadius;void main(){float fade=1.0-clamp(uShotAge/${BOSS_EYE_TIMING.beam.toFixed(1)},0.0,1.0);
        float a=(1.0-vRadius*.5)*fade*fade;gl_FragColor=vec4(vec3(1.0),a);\n#include <colorspace_fragment>}`,
    })), 'boss-eye-impact-rays'); this.impactRays.scale.setScalar(BOSS_EYE_BLAST_RADIUS); this.impactRays.renderOrder = 11;
    this.group.visible = false; this.beam.visible = false; this.impact.visible = false; this.impactRays.visible = false;
  }

  /** Called after the ordinary combat pose and model world placement, before any eye FX. */
  aim(boss: BossState | null | undefined, now: number): void {
    const eye = boss?.eye;
    if (!boss || boss.hp <= 0 || boss.deathAt !== null || !eye || eye.chargeAt === null || !eye.target) return;
    this.head.getWorldPosition(this.headPosition); this.head.getWorldQuaternion(this.headRotation);
    const fired = eye.firedAt !== null && now >= eye.firedAt && now < eye.firedAt + BOSS_EYE_TIMING.beam;
    const blend = fired ? 1 : smooth(0, BOSS_EYE_TIMING.charge, now - eye.chargeAt);
    const pose = solveBossEyeAim(this.headPosition, this.headRotation.toArray(), eye.target, blend);
    this.headRotation.fromArray(pose.headQuaternion);
    this.head.parent!.getWorldQuaternion(this.parentRotation).invert();
    this.head.quaternion.copy(this.parentRotation.multiply(this.headRotation)).normalize();
    this.head.updateWorldMatrix(false, true);
    // Aimed head descendants must not pull the independently chest-locked drape.
    this.stabilizeRearFlap();
  }

  update(boss: BossState | null | undefined, now: number): void {
    const alive = !!boss && boss.hp > 0 && boss.deathAt === null;
    const eye = boss?.eye;
    const age = eye?.firedAt === null || eye?.firedAt === undefined ? -1 : now - eye.firedAt;
    const fired = alive && age >= 0 && age < BOSS_EYE_TIMING.beam && !!eye?.origin && !!eye?.direction;
    this.power.value = fired ? 1 : alive && eye?.chargeAt !== null && eye?.chargeAt !== undefined
      ? smooth(0, BOSS_EYE_TIMING.charge, now - eye.chargeAt) : 0;
    this.group.visible = alive && this.model.visible;
    this.beam.visible = fired; this.impact.visible = fired && !!eye?.impact; this.impactRays.visible = this.impact.visible;
    readBossEyeGaze(this.head, this.origin, this.direction);
    this.halo.position.copy(this.group.worldToLocal(this.origin));
    if (!fired || !eye?.origin || !eye.direction) return;
    // Host samples one ray at firing. The complete segment appears on its first frame;
    // it is neither a moving projectile nor a growing/retracting beam.
    this.origin.set(eye.origin.x, eye.origin.y, eye.origin.z); this.group.worldToLocal(this.origin);
    if (eye.impact) this.end.set(eye.impact.x, eye.impact.y, eye.impact.z);
    else this.end.set(eye.origin.x + eye.direction.x * BOSS_EYE_MAX_RANGE, eye.origin.y + eye.direction.y * BOSS_EYE_MAX_RANGE, eye.origin.z + eye.direction.z * BOSS_EYE_MAX_RANGE);
    this.group.worldToLocal(this.end);
    this.direction.copy(this.end).sub(this.origin);
    const length = this.direction.length();
    this.beam.position.copy(this.origin); this.beam.quaternion.setFromUnitVectors(Z, this.direction.normalize());
    this.beam.scale.set(1, 1, length);
    this.impact.position.copy(this.end); this.impactRays.position.copy(this.end); this.shotAge.value = age;
  }

  dispose(): void { for (const geo of this.geos) geo.dispose(); for (const material of this.mats) material.dispose(); this.group.removeFromParent(); }
}
