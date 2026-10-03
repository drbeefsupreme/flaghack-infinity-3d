/**
 * The Flag atop the effigy: a 10 × 6.5 m cloth, gold on one face and saffron on the other,
 * flying downwind from the mast. Cloth motion is a vertex shader (travelling waves + noise
 * turbulence + fly-end flutter + droop in light wind) with analytic finite-difference
 * normals, mirrored in a depth material so its shadow waves too. Thin-cloth translucency
 * lights the shaded face when the sun is behind it; at night it holds a soft glow; in The
 * Burn it is not consumed but turns incandescent gold above the fire.
 */
import * as THREE from 'three';
import { FLAG_YELLOW } from '../../../sim/constants';
import type { RenderContext } from '../../context';
import type { EnvContext } from '../envTypes';
import { FLAG_BOTTOM, FLAG_HEIGHT, FLAG_WIDTH } from './burnTimeline';
import { mastRadius } from './effigyModel';

const SEGMENTS: Record<RenderContext['quality'], [number, number]> = {
  low: [20, 12],
  medium: [32, 20],
  high: [48, 30],
};

/** Saffron (Vexillicrocus) face: an amber yellow, still unmistakably a Flag. */
const SAFFRON = 0xffb21f;
/** Distance (m) from the mast axis to the hoist edge (the mast surface at the Flag). */
const HOIST = mastRadius(FLAG_BOTTOM + FLAG_HEIGHT / 2) + 0.03;
const CLOTH_GLSL = /* glsl */ `
uniform float uFlagWind;
uniform float uUpdraft;
uniform sampler2D uNoise;
varying vec2 vFlagUv;
// Rest position (m from the hoist, m above the bottom edge) to flag-local position.
vec3 flagCloth(vec2 st) {
  float s = st.x;
  float u = s / ${FLAG_WIDTH.toFixed(1)};
  float y = st.y;
  float w = clamp(uFlagWind + uUpdraft * 0.5, 0.0, 1.0);
  float t = uTime;
  float speed = mix(2.6, 6.0, w) + uUpdraft * 1.5;
  // Amplitude grows from the pinned hoist to the free fly end; three travelling folds.
  float amp = pow(u, 0.8) * mix(1.0, 0.72, w);
  float z = amp * 0.75 * sin(1.2 * s - t * speed * 0.6 + y * 0.15);
  z += amp * 0.34 * sin(2.3 * s - t * speed * 1.05 + y * 0.55 + 1.3);
  z += amp * 0.16 * sin(3.7 * s - t * speed * 1.6 - y * 0.8 + 0.4);
  vec2 nuv = vec2(s * 0.04 - t * 0.05 * speed, y * 0.05 + 0.37);
  z += (textureLod(uNoise, nuv, 0.0).r - 0.5) * amp * 1.3;
  z += 0.12 * smoothstep(0.6, 1.0, u) * sin(4.4 * s - t * speed * 2.2 + y * 1.9);
  // Folds take up length; light wind lets the fly droop, the fire's updraft lifts it.
  float x = s * (1.0 - 0.08 * amp);
  float droop = mix(0.42, 0.06, w) - 0.2 * uUpdraft;
  return vec3(${HOIST.toFixed(3)} + x * cos(droop), y - x * sin(droop), z);
}
`;

const VERT_PARS = /* glsl */ `
uniform float uTime;
${CLOTH_GLSL}
`;

const VERT_NORMAL = /* glsl */ `
vec3 flagP = flagCloth(position.xy);
vec3 flagDs = flagCloth(position.xy + vec2(0.06, 0.0)) - flagP;
vec3 flagDy = flagCloth(position.xy + vec2(0.0, 0.06)) - flagP;
vec3 objectNormal = normalize(cross(flagDs, flagDy));
vFlagUv = position.xy / vec2(${FLAG_WIDTH.toFixed(1)}, ${FLAG_HEIGHT.toFixed(1)});
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uUplight;
uniform float uIncandescence;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uGold;
uniform vec3 uSaffron;
uniform sampler2D uNoise;
varying vec2 vFlagUv;
`;

const FRAG_COLOR = /* glsl */ `
diffuseColor.rgb = gl_FrontFacing ? uGold : uSaffron;
diffuseColor.rgb *= 0.93 + 0.07 * texture2D(uNoise, vFlagUv * vec2(14.0, 9.1)).g;
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 albedo = diffuseColor.rgb;
  // Thin cloth: light from behind shines through to the face we see.
  vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  totalEmissiveRadiance += albedo * uSunColor * max(0.0, -dot(normal, L)) * 0.24;
  // Night: a glow of its own (it must read as the yellowest thing against the dark sky),
  // brighter on the lower cloth where the uplights reach.
  totalEmissiveRadiance += albedo * uNight * (0.42 + 0.3 * uUplight * (1.0 - vFlagUv.y) * (1.0 - 0.5 * vFlagUv.x));
  // The Burn: incandescent gold, heat flowing up through the weave.
  if (uIncandescence > 0.0) {
    float flow = texture2D(uNoise, vFlagUv * vec2(2.4, 1.6) + vec2(0.0, -uTime * 0.07)).g;
    float flow2 = texture2D(uNoise, vFlagUv * vec2(5.2, 3.3) + vec2(uTime * 0.04, -uTime * 0.19)).r;
    vec3 hot = mix(vec3(1.0, 0.55, 0.1), vec3(1.0, 0.82, 0.42), flow * flow2 + 0.25 * (1.0 - vFlagUv.y));
    totalEmissiveRadiance += hot * uIncandescence * (0.75 + 1.0 * flow * flow2 + 0.45 * (1.0 - vFlagUv.y));
  }
}
`;

export interface FlagDrive {
  /** 0..1 fire updraft under the Flag. */
  updraft: number;
  /** 0..1 incandescent glow. */
  incandescence: number;
  /** 0..1 uplight wash. */
  uplight: number;
}

export class FlagCloth {
  readonly mesh: THREE.Mesh;
  private env: EnvContext;
  private geo: THREE.PlaneGeometry;
  private mat: THREE.MeshStandardMaterial;
  private depth: THREE.MeshDepthMaterial;
  private uFlagWind = { value: 0.5 };
  private uUpdraft = { value: 0 };
  private uIncandescence = { value: 0 };
  private uUplight = { value: 1 };
  private yaw: number | null = null;

  constructor(env: EnvContext) {
    this.env = env;
    const [sx, sy] = SEGMENTS[env.ctx.quality];
    this.geo = new THREE.PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT, sx, sy);
    this.geo.translate(FLAG_WIDTH / 2, FLAG_HEIGHT / 2, 0);
    // The vertex shader displaces up to ~1.5 m off the plane and the yaw spins it: bound generously.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(FLAG_WIDTH / 2, FLAG_HEIGHT / 2, 0), FLAG_WIDTH * 0.75);

    const u = env.uniforms;
    const shared = {
      uTime: u.uTime,
      uNoise: { value: env.noise },
      uFlagWind: this.uFlagWind,
      uUpdraft: this.uUpdraft,
    };
    const faces = { uGold: { value: new THREE.Color(FLAG_YELLOW) }, uSaffron: { value: new THREE.Color(SAFFRON) } };
    this.mat = new THREE.MeshStandardMaterial({ color: FLAG_YELLOW, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    this.mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, faces, {
        uNight: u.uNight,
        uSunDir: u.uSunDir,
        uSunColor: u.uSunColor,
        uIncandescence: this.uIncandescence,
        uUplight: this.uUplight,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', 'vec3 transformed = flagP;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
        .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
    };
    this.mat.customProgramCacheKey = () => 'effigy-flag-v1';

    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = flagCloth(position.xy);');
    };
    this.depth.customProgramCacheKey = () => 'effigy-flag-depth-v1';

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'the-flag';
    this.mesh.position.y = FLAG_BOTTOM;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = this.depth;
  }

  update(dt: number, drive: FlagDrive): void {
    const wind = this.env.uniforms.uWind.value;
    // Fly downwind: local +x (the fly) turns to the wind direction, easing through gusts.
    const target = Math.atan2(-wind.y, wind.x);
    if (this.yaw === null) this.yaw = target;
    let diff = target - this.yaw;
    diff -= Math.round(diff / (Math.PI * 2)) * Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 0.9);
    this.mesh.rotation.y = this.yaw;
    // Wind aloft is stronger than at the ground.
    const strength = Math.min(1, 0.25 + 0.85 * wind.length());
    this.uFlagWind.value += (strength - this.uFlagWind.value) * Math.min(1, dt * 1.2);
    this.uUpdraft.value = drive.updraft;
    this.uIncandescence.value = drive.incandescence;
    this.uUplight.value = drive.uplight;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.depth.dispose();
  }
}
