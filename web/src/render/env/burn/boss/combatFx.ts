/** Read-only encounter feedback. Every effect can be reconstructed on a late join. */
import * as THREE from 'three';
import type { BossState } from '../../../../sim/boss';
import type { EnvContext } from '../../envTypes';
import { Rng } from '../../../../sim/rng';
import { smooth } from './revealTimeline';
import { createCrater } from './revealFx';

const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const PLANE_VERTEX = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

/** Original material values stay untouched; only the dying encounter receives char/erosion. */
export function applyBossDeathMaterial(material: THREE.Material, age: { value: number }): void {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer); shader.uniforms.uBossDeathAge = age;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBossBurn;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvBossBurn = transformed;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vBossBurn; uniform float uBossDeathAge;
      float bossAsh(vec3 p){return fract(sin(dot(floor(p*18.0),vec3(12.9898,78.233,37.719)))*43758.5453);}`)
      .replace('void main() {', `void main() {
        float bossBurnAway=smoothstep(6.0,12.0,uBossDeathAge);
        float bossBurnNoise=bossAsh(vBossBurn);
        if(uBossDeathAge>=0.0 && bossBurnNoise<bossBurnAway) discard;`);
    if (material instanceof THREE.MeshStandardMaterial) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float bossChar=smoothstep(0.4,5.0,uBossDeathAge);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.022,0.015,0.011),bossChar*0.96);
      float emberEdge=(1.0-smoothstep(0.025,0.12,bossBurnNoise-bossBurnAway))*step(6.0,uBossDeathAge);
      totalEmissiveRadiance+=vec3(1.0,0.13,0.012)*(emberEdge*2.0+bossChar*0.15)*(1.0-smoothstep(10.5,12.0,uBossDeathAge));`);
  };
  material.customProgramCacheKey = () => key + '-boss-death-v1';
}

export class BossCombatFx {
  readonly group = new THREE.Group();
  readonly deathAge = { value: -1 };
  private readonly geos = new Set<THREE.BufferGeometry>();
  private readonly mats = new Set<THREE.Material>();
  private readonly shield: THREE.Mesh;
  private readonly shieldColor = { value: new THREE.Color() };
  private readonly shieldAge = { value: 0 };
  private readonly stomp: THREE.Mesh;
  private readonly stompAge = { value: -1 };
  private readonly flames: { mesh: THREE.Mesh; bone: THREE.Bone }[] = [];
  private readonly fireUniforms: { uAge: { value: number }; uTime: { value: number }; uNoise: { value: THREE.Texture } };
  private readonly crater: THREE.Mesh;
  private readonly held = new THREE.Group();
  private readonly heldFlag = new THREE.Group();
  private readonly heldBuilding = new THREE.Group();
  private readonly heldPiece = new THREE.Group();
  private readonly heldColor = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .7 });
  private readonly point = new THREE.Vector3();

  constructor(private env: EnvContext, model: THREE.Group) {
    this.group.name = 'boss-combat-fx';
    this.fireUniforms = { uAge: this.deathAge, uTime: { value: 0 }, uNoise: { value: env.noise } };
    const add = <T extends THREE.Mesh>(mesh: T, name: string, parent: THREE.Object3D = this.group): T => {
      mesh.name = name; mesh.frustumCulled = false; parent.add(mesh); this.geos.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.mats.add(m);
      return mesh;
    };
    this.shield = add(new THREE.Mesh(new THREE.PlaneGeometry(10, 20, 1, 1), new THREE.ShaderMaterial({
      ...ADD, side: THREE.DoubleSide, uniforms: { uAge: this.shieldAge, uColor: this.shieldColor }, vertexShader: PLANE_VERTEX,
      fragmentShader: `uniform float uAge;uniform vec3 uColor;varying vec2 vUv;void main(){
        vec2 p=(vUv-.5)*vec2(1.0,1.65);float r=length(p);float rim=exp(-pow((r-.4)/.016,2.0));
        float wave=exp(-pow((r-uAge*.8)/.035,2.0));float grid=pow(max(0.0,cos(p.x*74.0)*cos(p.y*74.0)),12.0);
        float alpha=(rim*.65+wave*.9+grid*.16)*(1.0-smoothstep(.12,.95,uAge))*(1.0-smoothstep(.4,.61,r));
        gl_FragColor=vec4(uColor*alpha*2.3,alpha);#include <colorspace_fragment>}`.replace(';#include', ';\n#include'),
    })), 'boss-faction-forcefield');
    this.shield.renderOrder = 5;
    this.stomp = add(new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      ...ADD, side: THREE.DoubleSide, uniforms: { uAge: this.stompAge },
      vertexShader: `varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float uAge;varying vec3 vLocal;void main(){float r=length(vLocal.xz);float band=exp(-pow((r-(.5+uAge*7.0))/.16,2.0));float a=band*(1.0-smoothstep(.25,.8,uAge));gl_FragColor=vec4(vec3(.72,.48,.23)*a*1.7,a);\n#include <colorspace_fragment>}`,
    })), 'boss-stomp-impact');
    this.stomp.renderOrder = 3;
    const flameGeo = new THREE.InstancedBufferGeometry();
    flameGeo.setAttribute('position', new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,.5,1,0,-.5,1,0], 3));
    flameGeo.setIndex([0, 1, 2, 0, 2, 3]); flameGeo.instanceCount = 7;
    const rng = new Rng('boss-combat-flames');
    flameGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: 28 }, () => rng.next()), 4));
    const flameMat = new THREE.ShaderMaterial({ ...ADD, side: THREE.DoubleSide, uniforms: this.fireUniforms,
      vertexShader: `attribute vec4 aSeed;uniform float uAge;uniform float uTime;varying vec2 vUv;varying vec2 vSeed;
      void main(){float grow=smoothstep(0.0,1.8,uAge)*(1.0-smoothstep(9.0,12.0,uAge));
        vec3 center=vec3((aSeed.x-.5)*2.3,aSeed.y*1.2,(aSeed.z-.5)*2.3);vec4 p=modelViewMatrix*vec4(center,1.0);
        p.xy+=vec2(position.x*(1.0+aSeed.w),position.y*(2.0+aSeed.y*3.2))*grow;
        p.x+=sin(uTime*5.0+aSeed.z*20.0+position.y*4.0)*position.y*.24*grow;
        gl_Position=projectionMatrix*p;vUv=vec2(position.x+.5,position.y);vSeed=aSeed.xz;}`,
      fragmentShader: `uniform sampler2D uNoise;uniform float uTime;uniform float uAge;varying vec2 vUv;varying vec2 vSeed;
      void main(){float n=texture2D(uNoise,vec2(vUv.x*1.5,vUv.y*.8-uTime*.6)+vSeed*5.0).r;
        float width=(1.0-vUv.y)*.46;float body=1.0-smoothstep(width*.3,width+.08,abs(vUv.x-.5)+(n-.5)*.19);
        float a=body*(1.0-smoothstep(.55,1.0,vUv.y))*(1.0-smoothstep(9.5,12.0,uAge));if(a<.02)discard;
        vec3 color=mix(vec3(1.0,.055,.005),vec3(1.0,.68,.12),pow(1.0-vUv.y,2.0))*a*1.25;
        gl_FragColor=vec4(color,a);\n#include <colorspace_fragment>}`,
    });
    for (const name of ['pelvis', 'spine', 'chest', 'head', 'thighL', 'thighR']) {
      const bone = model.getObjectByName(name) as THREE.Bone;
      const mesh = add(new THREE.Mesh(flameGeo, flameMat), 'boss-death-fire-' + name); mesh.renderOrder = 7;
      this.flames.push({ mesh, bone });
    }
    this.crater = add(new THREE.Mesh(createCrater(new Rng('boss-death-crater')), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })), 'boss-death-crater');
    this.crater.scale.setScalar(.65); this.crater.receiveShadow = true;
    this.held.name = 'boss-held-target'; (model.getObjectByName('handR') as THREE.Bone).add(this.held);
    this.held.position.set(0, 1.7, 0); this.held.add(this.heldFlag, this.heldBuilding, this.heldPiece);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6d4530, roughness: .95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x241c18, roughness: .9 });
    add(new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, 3.6, 6), wood), 'boss-held-flag-pole', this.heldFlag);
    const cloth = add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, .9), this.heldColor), 'boss-held-flag-cloth', this.heldFlag); cloth.position.set(.7, .9, 0); this.heldColor.side = THREE.DoubleSide;
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 1.8), wood), 'boss-held-building-body', this.heldBuilding);
    const roof = add(new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.1, 4), this.heldColor), 'boss-held-building-roof', this.heldBuilding); roof.rotation.y = Math.PI / 4; roof.position.y = 1.3;
    const door = add(new THREE.Mesh(new THREE.BoxGeometry(.55, .9, .05), dark), 'boss-held-building-door', this.heldBuilding); door.position.set(0, -.3, .925);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.7, .3), wood), 'boss-held-wall-planks', this.heldPiece);
    const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(2.85, .25, .33), this.heldColor), 'boss-held-wall-stripe', this.heldPiece); stripe.position.y = .35;
    this.mats.add(this.heldColor);
    this.group.visible = false; this.held.visible = false;
  }

  update(boss: BossState | null | undefined, now: number): void {
    this.group.visible = !!boss; this.held.visible = !!boss?.held;
    this.deathAge.value = boss?.deathAt === null || boss?.deathAt === undefined ? -1 : Math.max(0, now - boss.deathAt);
    if (!boss) return;
    const origin = this.env.ctx.world.map.effigy;
    const x = boss.pos.x - origin.x, z = boss.pos.z - origin.z, death = this.deathAge.value;
    this.fireUniforms.uTime.value = now;
    for (const f of this.flames) {
      f.mesh.visible = death >= 0 && death < 12;
      if (f.mesh.visible) { f.bone.getWorldPosition(this.point); this.group.worldToLocal(this.point); f.mesh.position.copy(this.point); }
    }
    this.crater.visible = death >= 4;
    this.crater.position.set(x, .012, z);
    const barrier = boss.barrier;
    const age = barrier ? Math.max(0, now - barrier.at) : 2;
    this.shield.visible = !!barrier && age < .95 && death < 0;
    if (barrier && this.shield.visible) {
      this.shieldAge.value = age; this.shieldColor.value.set(this.env.ctx.world.factions[barrier.faction].color);
      this.shield.position.set(barrier.x - origin.x, 7.5, barrier.z - origin.z);
      this.shield.rotation.y = Math.atan2(boss.pos.x - barrier.x, boss.pos.z - barrier.z);
    }
    const actionAge = Math.max(0, now - boss.actionAt);
    this.stomp.visible = boss.action === 'stomp' && actionAge >= 1 && actionAge < 1.8;
    this.stompAge.value = actionAge - 1; this.stomp.position.set(x, .14, z);
    if (boss.held) {
      const owner = boss.held.faction; this.heldColor.color.set(owner === -1 ? 0xe4dfce : this.env.ctx.world.factions[owner].color);
      this.heldFlag.visible = boss.held.kind === 'flag'; this.heldPiece.visible = boss.held.kind === 'piece'; this.heldBuilding.visible = boss.held.kind === 'building';
      this.held.scale.setScalar(1 - smooth(2.55, 2.8, actionAge));
    }
  }
  dispose(): void {
    for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose();
    this.held.removeFromParent(); this.group.removeFromParent();
  }
}
