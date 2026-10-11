/**
 * THE FLAG: the 26 m timber effigy on the Omega Node (world.map.effigy) with its giant waving
 * Flag, gold on one face and saffron on the other, and The Burn once world.suddenDeath is set:
 * flames race up the lattice, the timber chars and burns away, smoke and embers pour off
 * downwind and the fire light floods the plaza. Guy lines burn away at 20–30 seconds;
 * from 90 seconds the Flag cools through white, yellow, red and black while shrinking above
 * the scaffold. Its mast and finial share the same heat and shrink; the plinth remains.
 *
 * Draw calls: lattice, solid timber, offerings, guy lines, Flag (+ shadow passes), uplight shafts at
 * night; the fire adds bed, smoke, flames and embers only during The Burn.
 */
import * as THREE from 'three';
import { Rng } from '../../../sim/rng';
import type { GameEvent } from '../../../sim/events';
import { bossRevealEnabled } from '../../../sim/effigyBurn';
import { BossReveal } from './boss/bossReveal';
import type { BossModelLoader } from './boss/bossModel';
import { applyBossChargeMaterial, bossCharge } from './boss/revealTimeline';
import { createEnvMaterial, disposeEnvMaterial, swayDepthOf } from '../envMaterial';
import type { EnvContext, EnvPart } from '../envTypes';
import { terrainHeight } from '../terrain';
import { BurnFx } from './burnFx';
import type { BurnFxDrive } from './burnFx';
import { FLAG_BOTTOM, PLINTH_HEIGHT, GUY_BURN_END, emberBed, emberRate, fireCeiling, fireFront, fireIntensity, flagBurnScale, flagIncandescence, guyLineBurn, guyLineFall, ignitionFlare, sampleFlagHeat, smokeAmount } from './burnTimeline';
import { createCharDepthMaterial, createCharMaterial } from './charMaterial';
import type { BurnUniforms } from './charMaterial';
import { buildEffigyGeometry } from './effigyModel';
import { FlagCloth } from './flagCloth';
import type { FlagDrive } from './flagCloth';
import { createGuyLineMaterial } from './guyLineMaterial';
import { applyFlagHeatMaterial } from './flagHeatMaterial';

/** Seconds for the festival uplights to give way to the fire. */
const UPLIGHT_FADE = 6;
/** Uplight shaft brightness at full night. */
const SHAFT_GAIN = 0.1;

const SHAFT_VERT = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
varying float vAlong;
varying float vFacing;
varying float vFade;

void main() {
  vAlong = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), -mv.xyz / max(length(mv.xyz), 1e-3)));
  // Fogged far away; faded when the camera is right in the beam.
  vFade = (1.0 - 0.8 * smoothstep(uFogNear, uFogFar, -mv.z)) * smoothstep(1.0, 6.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const SHAFT_FRAG = /* glsl */ `
uniform float uIntensity;
uniform vec3 uColor;
varying float vAlong;
varying float vFacing;
varying float vFade;

void main() {
  float along = smoothstep(0.0, 0.04, vAlong) * pow(max(1.0 - vAlong, 0.0), 1.6);
  gl_FragColor = vec4(uColor * along * pow(vFacing, 2.2) * uIntensity * vFade, 1.0);
  #include <colorspace_fragment>
}
`;

export class Effigy implements EnvPart {
  /** Resolves once the actual rig is loaded and its shader programs are warmed. */
  readonly ready: Promise<void>;
  private boss: BossReveal | null = null;
  private uBossCharge = { value: 0 };
  private env: EnvContext;
  private group = new THREE.Group();
  private burnU: BurnUniforms;
  private geos: THREE.BufferGeometry[];
  private envMats: THREE.Material[];
  private latticeDepth: THREE.MeshDepthMaterial;
  /** Own depth material: three's shared default would switch variants across draw paths. */
  private solidDepth = new THREE.MeshDepthMaterial();
  private shaftMat: THREE.ShaderMaterial;
  private shafts: THREE.Mesh;
  private uShaft = { value: 0 };
  private flag: FlagCloth;
  private flagAssembly = new THREE.Group();
  private scaffoldCrown: number;
  private fx: BurnFx;
  private guyLines: THREE.Mesh;
  private uGuyBurn = { value: 0 };
  private uGuyFall = { value: 0 };
  // Per-frame drive values, reused.
  private flagDrive: FlagDrive = { updraft: 0, incandescence: 0, uplight: 1, heat: sampleFlagHeat(0) };
  private fxDrive: BurnFxDrive = { flare: 0, smoke: 0, emberRate: 0, emberBed: 0 };

  constructor(env: EnvContext, bossLoader?: BossModelLoader) {
    this.env = env;
    const map = env.ctx.world.map;
    this.group.name = 'effigy';
    this.group.position.set(map.effigy.x, terrainHeight(map.effigy.x, map.effigy.z, map.half), map.effigy.z);
    env.root.add(this.group);

    this.burnU = {
      uBurnTime: { value: 0 },
      uFire: { value: 0 },
      uFireFront: { value: 0 },
      uFireCeil: { value: fireCeiling(0) },
      uUplight: { value: 1 },
      uNoise: { value: env.noise },
      uFogNear: { value: env.day.fogNear },
      uFogFar: { value: env.day.fogFar },
    };

    const geo = buildEffigyGeometry(new Rng(`effigy:${map.seed}`));
    this.geos = [geo.lattice, geo.solid, geo.mast, geo.finial, geo.offerings, geo.guyLines, geo.shafts];
    geo.lattice.computeBoundingBox();
    this.scaffoldCrown = geo.lattice.boundingBox!.max.y;
    this.flag = new FlagCloth(env);

    const latticeMat = createCharMaterial(env.uniforms, this.burnU, true);
    const solidMat = createCharMaterial(env.uniforms, this.burnU, false);
    const mastMat = createCharMaterial(env.uniforms, this.burnU, false);
    const finialMat = createEnvMaterial(env.uniforms, { roughness: 0.7, sway: 0.08 });
    applyFlagHeatMaterial(mastMat, this.flag.heatUniforms);
    applyFlagHeatMaterial(finialMat, this.flag.heatUniforms);
    const offeringsMat = createEnvMaterial(env.uniforms, { roughness: 0.7, sway: 0.08 });
    const guyLineMat = createGuyLineMaterial(env.uniforms, this.uGuyBurn, this.uGuyFall);
    this.envMats = [latticeMat, solidMat, mastMat, finialMat, offeringsMat, guyLineMat];
    const bossEnabled = bossRevealEnabled(env.ctx.world.options);
    if (bossEnabled) {
      for (const material of [latticeMat, solidMat, mastMat, finialMat, offeringsMat, this.flag.mesh.material])
        applyBossChargeMaterial(material as THREE.MeshStandardMaterial, this.uBossCharge);
    }
    this.latticeDepth = createCharDepthMaterial(this.burnU);

    const lattice = new THREE.Mesh(geo.lattice, latticeMat);
    lattice.name = 'effigy-lattice';
    lattice.customDepthMaterial = this.latticeDepth;
    const solid = new THREE.Mesh(geo.solid, solidMat);
    solid.name = 'effigy-solid';
    solid.customDepthMaterial = this.solidDepth;
    const offerings = new THREE.Mesh(geo.offerings, offeringsMat);
    offerings.name = 'effigy-offerings';
    offerings.customDepthMaterial = swayDepthOf(offeringsMat);
    this.guyLines = new THREE.Mesh(geo.guyLines, guyLineMat);
    this.guyLines.name = 'effigy-guylines';
    this.guyLines.customDepthMaterial = swayDepthOf(guyLineMat);
    for (const m of [lattice, solid, offerings, this.guyLines]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    this.shaftMat = new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: {
        uIntensity: this.uShaft,
        uColor: { value: new THREE.Color(1.0, 0.78, 0.5) },
        uFogNear: this.burnU.uFogNear,
        uFogFar: this.burnU.uFogFar,
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.shafts = new THREE.Mesh(geo.shafts, this.shaftMat);
    this.shafts.renderOrder = 1;
    this.group.add(this.shafts);

    // One pivot keeps the cloth hoist, mast and finial physically attached at every scale.
    this.flagAssembly.name = 'effigy-flag-assembly';
    this.flagAssembly.position.y = PLINTH_HEIGHT;
    const mast = new THREE.Mesh(geo.mast, mastMat);
    mast.name = 'effigy-mast';
    mast.customDepthMaterial = this.solidDepth;
    const finial = new THREE.Mesh(geo.finial, finialMat);
    finial.name = 'effigy-finial';
    finial.customDepthMaterial = swayDepthOf(finialMat);
    for (const m of [mast, finial]) {
      m.position.y = -PLINTH_HEIGHT;
      m.castShadow = m.receiveShadow = true;
      this.flagAssembly.add(m);
    }
    this.flag.mesh.position.y = FLAG_BOTTOM - PLINTH_HEIGHT;
    this.flagAssembly.add(this.flag.mesh);
    this.group.add(this.flagAssembly);

    this.fx = new BurnFx(env, this.burnU);
    this.group.add(this.fx.group);
    // Only the shared assembly scale and the downwind cloth yaw change: skip
    // the per-frame matrix recompose for the rest.
    this.group.traverse((o) => {
      if (o === this.flag.mesh || o === this.flagAssembly) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    // A sibling keeps the explosion, crater and rig outside the frozen pre-reveal effigy.
    this.boss = bossEnabled ? new BossReveal(env, bossLoader) : null;
    this.ready = this.boss?.ready ?? Promise.resolve();
  }

  update(dt: number): void {
    const { burn, day } = this.env;
    const t = burn.active ? burn.elapsed : 0;
    const revealed = this.boss !== null && this.env.ctx.world.effigyRevealedAt != null;
    this.group.visible = !revealed;
    this.uBossCharge.value = this.boss && burn.active ? bossCharge(t) : 0;
    if (revealed) {
      this.fx.update(false, this.fxDrive);
      this.boss!.update(t);
      return;
    }
    const fire = burn.active ? fireIntensity(t) : 0;
    const uplight = burn.active ? Math.max(0, 1 - t / UPLIGHT_FADE) : 1;
    const u = this.burnU;
    u.uBurnTime.value = t;
    u.uFire.value = fire;
    u.uFireFront.value = burn.active ? fireFront(t) : 0;
    u.uFireCeil.value = fireCeiling(t);
    u.uUplight.value = uplight;
    u.uFogNear.value = day.fogNear;
    u.uFogFar.value = day.fogFar;

    this.uShaft.value = day.night * uplight * SHAFT_GAIN;
    this.shafts.visible = this.uShaft.value > 0.002;

    const fd = this.flagDrive;
    fd.updraft = fire;
    fd.incandescence = burn.active ? flagIncandescence(t) : 0;
    fd.uplight = uplight;
    const flagTime = this.env.ctx.world.options?.mode === 'tutorial' ? 0 : t;
    sampleFlagHeat(flagTime, fd.heat);
    this.flag.update(dt, fd);
    const scale = flagBurnScale(flagTime, this.scaffoldCrown);
    this.flagAssembly.scale.setScalar(scale);
    this.flagAssembly.visible = scale > 0;
    this.uGuyBurn.value = guyLineBurn(t);
    this.uGuyFall.value = guyLineFall(t);
    this.guyLines.visible = t < GUY_BURN_END;

    const xd = this.fxDrive;
    xd.flare = burn.active ? ignitionFlare(t) : 0;
    xd.smoke = burn.active ? smokeAmount(t) : 0;
    xd.emberRate = burn.active ? emberRate(t) : 0;
    xd.emberBed = burn.active ? emberBed(t) : 0;
    this.fx.update(burn.active, xd);
    this.boss?.update(t);
  }

  onEvent(event: GameEvent): void { this.boss?.onEvent(event); }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.envMats) disposeEnvMaterial(m);
    this.latticeDepth.dispose();
    this.solidDepth.dispose();
    this.shaftMat.dispose();
    this.flag.dispose();
    this.fx.dispose();
    this.boss?.dispose();
    this.env.root.remove(this.group);
  }
}
