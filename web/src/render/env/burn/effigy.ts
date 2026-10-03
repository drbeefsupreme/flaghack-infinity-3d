/**
 * THE FLAG: the 26 m timber effigy on the Omega Node (world.map.effigy) with its giant waving
 * Flag, gold on one face and saffron on the other, and The Burn once world.suddenDeath is set:
 * flames race up the lattice, the timber chars and burns away, smoke and embers pour off
 * downwind and the fire light floods the plaza. The man burns away but the Flag remains:
 * the mast stands charred and the Flag glows incandescent gold above the embers.
 *
 * Draw calls: lattice, solid timber, offerings, Flag (+ shadow passes), uplight shafts at
 * night; the fire adds bed, smoke, flames and embers only during The Burn.
 */
import * as THREE from 'three';
import { Rng } from '../../../sim/rng';
import { createEnvMaterial, disposeEnvMaterial, swayDepthOf } from '../envMaterial';
import type { EnvContext, EnvPart } from '../envTypes';
import { BurnFx } from './burnFx';
import type { BurnFxDrive } from './burnFx';
import { emberBed, emberRate, fireCeiling, fireFront, fireIntensity, flagIncandescence, ignitionFlare, smokeAmount } from './burnTimeline';
import { createCharDepthMaterial, createCharMaterial } from './charMaterial';
import type { BurnUniforms } from './charMaterial';
import { buildEffigyGeometry } from './effigyModel';
import { FlagCloth } from './flagCloth';
import type { FlagDrive } from './flagCloth';

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
  private fx: BurnFx;
  // Per-frame drive values, reused.
  private flagDrive: FlagDrive = { updraft: 0, incandescence: 0, uplight: 1 };
  private fxDrive: BurnFxDrive = { flare: 0, smoke: 0, emberRate: 0, emberBed: 0 };

  constructor(env: EnvContext) {
    this.env = env;
    const map = env.ctx.world.map;
    this.group.name = 'effigy';
    this.group.position.set(map.effigy.x, 0, map.effigy.z);
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
    this.geos = [geo.lattice, geo.solid, geo.offerings, geo.shafts];

    const latticeMat = createCharMaterial(env.uniforms, this.burnU, true);
    const solidMat = createCharMaterial(env.uniforms, this.burnU, false);
    const offeringsMat = createEnvMaterial(env.uniforms, { roughness: 0.7, sway: 0.08 });
    this.envMats = [latticeMat, solidMat, offeringsMat];
    this.latticeDepth = createCharDepthMaterial(this.burnU);

    const lattice = new THREE.Mesh(geo.lattice, latticeMat);
    lattice.customDepthMaterial = this.latticeDepth;
    const solid = new THREE.Mesh(geo.solid, solidMat);
    solid.customDepthMaterial = this.solidDepth;
    const offerings = new THREE.Mesh(geo.offerings, offeringsMat);
    offerings.customDepthMaterial = swayDepthOf(offeringsMat);
    for (const m of [lattice, solid, offerings]) {
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

    this.flag = new FlagCloth(env);
    this.group.add(this.flag.mesh);

    this.fx = new BurnFx(env, this.burnU);
    this.group.add(this.fx.group);
    // Everything here stands still except the Flag, which turns downwind every frame: skip
    // the per-frame matrix recompose for the rest.
    this.group.traverse((o) => {
      if (o === this.flag.mesh) return;
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
  }

  update(dt: number): void {
    const { burn, day } = this.env;
    const t = burn.active ? burn.elapsed : 0;
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
    this.flag.update(dt, fd);

    const xd = this.fxDrive;
    xd.flare = burn.active ? ignitionFlare(t) : 0;
    xd.smoke = burn.active ? smokeAmount(t) : 0;
    xd.emberRate = burn.active ? emberRate(t) : 0;
    xd.emberBed = burn.active ? emberBed(t) : 0;
    this.fx.update(burn.active, xd);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.envMats) disposeEnvMaterial(m);
    this.latticeDepth.dispose();
    this.solidDepth.dispose();
    this.shaftMat.dispose();
    this.flag.dispose();
    this.fx.dispose();
    this.env.root.remove(this.group);
  }
}
