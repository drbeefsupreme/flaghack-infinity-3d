/** Cosmetic, bounded fire attached to the original weighted cloth/skull vertices. */
import * as THREE from 'three';
import type { BossState } from '../../../../sim/boss';
import { BOSS_SCALE } from './bossModel';
import { smooth } from './revealTimeline';

const WOOL = new Set(['Coat | charcoal gray wool', 'Coat | seam cloth']);
const CAVITIES = new Set(['Skull • deep cavities', 'Skull | orbital recess bone']);

/** Rest-space shimmer sticks to the wool. No source colors, eye or hat are changed. */
export function applyBurningCoatMaterial(material: THREE.MeshStandardMaterial, level: THREE.IUniform<number>, time: THREE.IUniform<number>): boolean {
  const cavity = CAVITIES.has(material.name), coat = WOOL.has(material.name) || material.name === 'Coat | inside facing';
  if (!cavity && !coat) return false;
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uCoatFireLevel = level; shader.uniforms.uCoatFireTime = time;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoatFireRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoatFireRest=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoatFireRest;uniform float uCoatFireLevel;uniform float uCoatFireTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float coatWave=sin(vCoatFireRest.x*7.1+sin(vCoatFireRest.z*5.3)+uCoatFireTime*2.1)
          *sin(vCoatFireRest.y*1.8-uCoatFireTime*3.4+vCoatFireRest.z*4.0);
        float coatEmber=${cavity ? '(0.58+0.13*coatWave)' : material.name === 'Coat | inside facing' ? '(0.22+0.07*coatWave)' : 'smoothstep(0.63,0.94,coatWave)*0.38'};
        totalEmissiveRadiance+=vec3(1.0,0.12,0.006)*coatEmber*uCoatFireLevel;`);
  };
  material.customProgramCacheKey = () => key + '-burning-coat-v1';
  return true;
}

type Anchor = { mesh: THREE.SkinnedMesh; index: number; rest: THREE.Vector3 };
type Target = { material: string; point: THREE.Vector3; width: number; height: number };
function targets(): Target[] {
  const result: Target[] = [];
  const add = (material: string, x: number, y: number, z: number, width: number, height: number) => result.push({ material, point: new THREE.Vector3(x, y, z), width, height });
  // Hem fire emerges from the lining; short exterior tongues leave the gray silhouette readable.
  for (let i = 0; i < 18; i++) {
    const a = i * Math.PI * 2 / 18;
    add('Coat | inside facing', Math.cos(a) * 3.5, 6.35, Math.sin(a) * 1.5, .65, 2.1 + .45 * Math.sin(i * 2.4));
  }
  for (const y of [10, 14, 18, 21]) for (const side of [-1, 1]) for (const x of [-1.7, 1.7])
    add('Coat | charcoal gray wool', x, y, side * 1.6, .43, 1.05);
  for (const x of [-.66, .66]) add('Skull • deep cavities', x, 25.7, 1.12, .35, .62);
  add('Skull • deep cavities', 0, 24.5, 1.1, .45, .8);
  add('Coat | inside facing', 0, 22.1, .8, .55, 1.1);
  return result;
}

export class BurningCoatFx {
  readonly group = new THREE.Group();
  readonly level = { value: 0 };
  readonly time = { value: 0 };
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly anchors: Anchor[] = [];
  private readonly point = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private disposed = false;

  constructor(model: THREE.Group, noise: THREE.Texture) {
    this.group.name = 'boss-burning-coat'; this.group.visible = false;
    const meshes = new Map<string, THREE.SkinnedMesh>();
    model.traverse(o => {
      if (!(o instanceof THREE.SkinnedMesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      meshes.set(o.material.name, o); applyBurningCoatMaterial(o.material, this.level, this.time);
    });
    const specs = targets(), sizes: number[] = [];
    for (const [i, target] of specs.entries()) {
      const mesh = meshes.get(target.material);
      if (!mesh) continue; // A missing optional surface never prevents the real boss from loading.
      const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal');
      let nearest = 0, distance = Infinity;
      for (let j = 0; j < position.count; j++) {
        this.point.fromBufferAttribute(position, j);
        const d = this.point.distanceToSquared(target.point);
        if (d < distance) { distance = d; nearest = j; }
      }
      const rest = new THREE.Vector3().fromBufferAttribute(position, nearest);
      if (normal) rest.addScaledVector(this.point.fromBufferAttribute(normal, nearest), .045);
      this.anchors.push({ mesh, index: nearest, rest });
      sizes.push(target.width * BOSS_SCALE, target.height * BOSS_SCALE, (i * .6180339) % 1, i < 18 ? .9 : .6);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,.5,1,0,-.5,1,0], 3));
    geometry.setIndex([0,1,2,0,2,3]); geometry.instanceCount = this.anchors.length;
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(this.anchors.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 4));
    // Same noise-texture flame family as the existing death fire, in a single bounded draw.
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.time, uLevel: this.level, uNoise: { value: noise } },
      vertexShader: `attribute vec3 aCenter;attribute vec4 aStyle;uniform float uTime;varying vec2 vUv;varying vec2 vFlame;
        #include <fog_pars_vertex>
        void main(){vUv=vec2(position.x+.5,position.y);vFlame=aStyle.zw;
          vec4 center=modelMatrix*vec4(aCenter,1.0);
          vec3 right=normalize(vec3(viewMatrix[0][0],0.0,viewMatrix[2][0])+vec3(.0001,0.0,0.0));
          center.xyz+=right*(position.x*aStyle.x+sin(uTime*5.0+aStyle.z*20.0+position.y*4.0)*position.y*aStyle.x*.18);
          center.y+=position.y*aStyle.y*(.88+.12*sin(uTime*7.0+aStyle.z*31.0));
          vec4 mvPosition=viewMatrix*center;gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform sampler2D uNoise;uniform float uTime;uniform float uLevel;varying vec2 vUv;varying vec2 vFlame;
        #include <fog_pars_fragment>
        void main(){float n=texture2D(uNoise,vec2(vUv.x*1.5,vUv.y*.8-uTime*.6)+vFlame.x*5.0).r;
          float width=(1.0-vUv.y)*.46;float body=1.0-smoothstep(width*.3,width+.08,abs(vUv.x-.5)+(n-.5)*.19);
          float a=body*smoothstep(0.0,.09,vUv.y)*(1.0-smoothstep(.55,1.0,vUv.y))*uLevel*vFlame.y;
          if(a<.012)discard;vec3 color=mix(vec3(1.0,.055,.005),vec3(1.0,.68,.12),pow(1.0-vUv.y,2.0));
          gl_FragColor=vec4(color*1.35,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float coatFog=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
            #else
              float coatFog=smoothstep(fogNear,fogFar,vFogDepth);
            #endif
            gl_FragColor.a*=1.0-coatFog;
          #endif
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.name = 'boss-coat-fire-tongues';
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.group.add(this.mesh);
  }

  update(boss: BossState | null | undefined, now: number, revealAge: number, awakening: number, present: boolean): void {
    this.time.value = now;
    // Never contaminate protected white/silhouette emergence or overlap the death/crater effect.
    this.level.value = !this.disposed && present && boss && boss.deathAt == null && boss.hp > 0 && boss.action !== 'emerge' && awakening <= 0
      ? smooth(5, 6.2, revealAge) : 0;
    this.group.visible = this.level.value > 0 && this.anchors.length > 0;
    if (!this.group.visible) return;
    this.group.updateWorldMatrix(true, false); this.inverse.copy(this.group.matrixWorld).invert();
    const centers = this.mesh.geometry.getAttribute('aCenter') as THREE.InstancedBufferAttribute;
    this.anchors.forEach((anchor, i) => {
      this.point.copy(anchor.rest); anchor.mesh.applyBoneTransform(anchor.index, this.point);
      this.point.applyMatrix4(anchor.mesh.matrixWorld).applyMatrix4(this.inverse);
      centers.setXYZ(i, this.point.x, this.point.y, this.point.z);
    });
    centers.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.level.value = 0; this.group.visible = false;
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.group.removeFromParent();
  }
}
