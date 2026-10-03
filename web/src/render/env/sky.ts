/**
 * Sky dome: horizon→zenith gradient, sun disc with halo and dusk afterglow band, drifting
 * procedural clouds lit by the sun (pink/amber undersides at sunset, moonlit at night),
 * twinkling stars with a faint Milky Way, and a gibbous moon. Drawn last among opaques with
 * depth test so only uncovered pixels pay for it.
 */
import * as THREE from 'three';
import type { EnvContext, EnvPart } from './envTypes';

const RADIUS = 950;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Pin just inside the far plane so the dome only fills pixels nothing else covered.
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunGlow;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uStars;
uniform float uDusk;
uniform float uNight;
uniform float uDaylight;
uniform float uCloudCover;
uniform sampler2D uNoise;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 starField(vec3 d) {
  // ~0.4° cells: a star covers one to two pixels at gameplay FOVs.
  vec3 p = d * 150.0;
  vec3 ip = floor(p);
  float h = hash13(ip);
  if (h < 0.955) return vec3(0.0);
  vec3 jitter = vec3(hash13(ip + 7.1), hash13(ip + 3.7), hash13(ip + 1.3)) * 0.6 + 0.2;
  float dist = length(fract(p) - jitter);
  float size = 0.1 + 0.12 * hash13(ip + 9.2);
  float core = 1.0 - smoothstep(0.0, size, dist);
  float tw = 0.7 + 0.3 * sin(uTime * (1.5 + h * 6.0) + h * 80.0);
  float bright = pow((h - 0.955) / 0.045, 3.0) * 4.0 + 0.5;
  vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.75), hash13(ip + 4.4));
  return tint * core * core * tw * bright;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  // Three-stop gradient: blue and orange mixed directly turn mauve, real skies pass through
  // a pale cyan band between the zenith and the warm horizon.
  float hp = clamp(h, 0.0, 1.0);
  vec3 mid = uZenith * 1.3 + vec3(0.035, 0.065, 0.085) * uDaylight;
  vec3 col = mix(uHorizon, mid, smoothstep(0.0, 0.28, hp));
  col = mix(col, uZenith, smoothstep(0.18, 0.9, hp));

  float cosS = dot(d, uSunDir);
  float sunUp = smoothstep(-0.12, 0.02, uSunDir.y);
  // Mie-like halo around the sun plus a warm band along the horizon on the sun's side.
  float halo = pow(max(cosS, 0.0), 10.0) * 0.18 + pow(max(cosS, 0.0), 90.0) * 0.6 + pow(max(cosS, 0.0), 700.0) * 3.0;
  vec2 hd = normalize(d.xz + 1e-5);
  vec2 sd = normalize(uSunDir.xz + 1e-5);
  float sideSun = dot(hd, sd) * 0.5 + 0.5;
  float band = exp(-max(h, 0.0) * 9.0) * pow(sideSun, 4.0);
  col += uSunGlow * (halo * sunUp + band * (0.2 + uDusk * 0.9));

  // Sun disc (HDR: blooms).
  float disc = smoothstep(0.99955, 0.99975, cosS) * smoothstep(-0.02, 0.01, h);
  col += mix(vec3(1.0, 0.75, 0.45), vec3(1.0, 0.95, 0.85), uDaylight) * disc * 38.0 * sunUp;

  // Night: stars + Milky Way, faded near the horizon haze.
  if (uStars > 0.001 && h > -0.02) {
    float horizonFade = smoothstep(0.0, 0.25, h);
    vec3 mwN = normalize(vec3(0.42, 0.35, 0.84));
    float mwBand = exp(-pow(dot(d, mwN), 2.0) * 22.0);
    vec2 mwUv = vec2(atan(d.z, d.x) * 0.6, d.y * 1.4);
    float mwDust = texture2D(uNoise, mwUv * 0.9).r * texture2D(uNoise, mwUv * 2.7 + 0.3).g;
    col += vec3(0.32, 0.36, 0.55) * mwBand * mwDust * 0.32 * uStars * horizonFade;
    col += starField(d) * uStars * horizonFade * (1.0 + mwBand * 1.5);
  }

  // Moon: gibbous disc with a soft glow.
  float cosM = dot(d, uMoonDir);
  float moonGlow = pow(max(cosM, 0.0), 180.0) * 0.35 + pow(max(cosM, 0.0), 12.0) * 0.06;
  float moonDisc = smoothstep(0.99962, 0.99972, cosM);
  vec3 toMoon = d - uMoonDir * cosM;
  vec3 lightSide = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.0001, 0.0));
  float phase = smoothstep(-0.006, 0.012, dot(toMoon, lightSide) + 0.008);
  float craters = 0.82 + 0.18 * texture2D(uNoise, toMoon.xy * 30.0).b;
  col += vec3(0.75, 0.82, 1.0) * moonGlow * uNight;
  col = mix(col, vec3(2.6, 2.6, 2.4) * craters * (0.12 + 0.88 * phase), moonDisc * uNight);

  // Clouds on a virtual layer 420 m up, drifting with the wind.
  if (h > 0.0 && uCloudCover > 0.0) {
    vec2 p = uCamPos.xz + d.xz * (420.0 - uCamPos.y) / max(h, 0.035);
    vec2 uv = p / 2600.0 + vec2(uTime * 0.0016, uTime * 0.0007);
    // Rotated octaves hide the value-noise lattice; the finest one adds wispy edges.
    const mat2 CR = mat2(0.8, 0.6, -0.6, 0.8);
    float base = texture2D(uNoise, uv).r * 0.62 + texture2D(uNoise, CR * uv * 2.7 + 0.17).g * 0.38;
    float n = base * 0.88 + texture2D(uNoise, CR * CR * uv * 7.3 + 0.41).g * 0.12;
    // Night thins the cover so the stars and the moon get the sky.
    float cover = uCloudCover * (1.0 - 0.6 * uNight);
    float dens = smoothstep(1.0 - cover, 1.0 - cover + mix(0.32, 0.6, uNight), n);
    dens *= smoothstep(0.035, 0.22, h);
    // Light through the cloud: brighter on the sun side, glowing rims at dusk.
    vec2 toward = normalize(uSunDir.xz + 1e-5) * 0.012;
    vec2 uvS = uv + toward;
    float shadowN = texture2D(uNoise, uvS).r * 0.62 + texture2D(uNoise, CR * uvS * 2.7 + 0.17).g * 0.38;
    float selfShade = clamp((base - shadowN) * 5.0 + 0.55, 0.0, 1.0);
    vec3 lit = mix(vec3(1.0, 0.98, 0.95), uSunGlow * 1.6 + vec3(0.25, 0.18, 0.2), clamp(uDusk * 1.1, 0.0, 1.0));
    vec3 shade = mix(uZenith * 0.9 + uHorizon * 0.35, uHorizon * 0.6, 0.5);
    vec3 cloud = mix(shade, lit, selfShade) * (0.5 + 0.5 * uDaylight + uDusk * 0.3);
    cloud += uSunGlow * pow(max(cosS, 0.0), 10.0) * 1.2 * sunUp;
    // Night clouds: plain dark silhouettes against the stars, silver-edged near the moon.
    vec3 nightCloud = vec3(0.01, 0.012, 0.022) + vec3(0.22, 0.24, 0.32) * moonGlow * 4.0;
    cloud = mix(cloud, nightCloud, uNight);
    col = mix(col, cloud, dens * mix(0.92, 0.75, uNight));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class SkyDome implements EnvPart {
  private env: EnvContext;
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private uniforms: {
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uSunGlow: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uMoonDir: { value: THREE.Vector3 };
    uCamPos: { value: THREE.Vector3 };
    uTime: { value: number };
    uStars: { value: number };
    uDusk: { value: number };
    uNight: { value: number };
    uDaylight: { value: number };
    uCloudCover: { value: number };
    uNoise: { value: THREE.Texture };
  };

  constructor(env: EnvContext) {
    this.env = env;
    const day = env.day;
    this.uniforms = {
      uZenith: { value: day.zenith },
      uHorizon: { value: day.horizon },
      uSunGlow: { value: day.sunGlow },
      uSunDir: { value: day.sunDir },
      uMoonDir: { value: day.moonDir },
      uCamPos: { value: new THREE.Vector3() },
      uTime: env.uniforms.uTime,
      uStars: { value: 0 },
      uDusk: { value: 0 },
      uNight: env.uniforms.uNight,
      uDaylight: { value: 1 },
      uCloudCover: { value: env.ctx.quality === 'low' ? 0.38 : 0.42 },
      uNoise: { value: env.noise },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), this.mat);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    // Last among opaques: the depth test leaves only uncovered pixels to shade.
    this.mesh.renderOrder = 1000;
    // Recomposed only when it follows the camera in update().
    this.mesh.matrixAutoUpdate = false;
    env.root.add(this.mesh);
  }

  update(_dt: number): void {
    const cam = this.env.ctx.camera;
    const day = this.env.day;
    this.mesh.position.copy(cam.position);
    this.mesh.updateMatrix();
    this.uniforms.uCamPos.value.copy(cam.position);
    this.uniforms.uStars.value = day.stars;
    this.uniforms.uDusk.value = day.dusk;
    this.uniforms.uDaylight.value = day.daylight;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
