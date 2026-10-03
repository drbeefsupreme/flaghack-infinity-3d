/**
 * Final grade: the one full-screen pass from linear HDR (scene + bloom) to the canvas.
 * Order of operations:
 *   1. UV effects: instability wobble, Acid breathing warp and chromatic split, Dust edge
 *      kaleidoscope.
 *   2. Linear HDR light: time-of-day grade (golden warmth and contrast by day, teal shadows
 *      and warm highlights by night), The Burn, Saffron / crash, Dust glitter and prism,
 *      Acid hue swing, flagplaid and neon outlines, instability moire, sun flare.
 *   3. Tone mapping and output encoding from three's own chunks, so renderer.toneMapping,
 *      renderer.toneMappingExposure and renderer.outputColorSpace stay authoritative.
 *   4. Display space (sRGB-encoded): Command View parchment and ink, damage vignette,
 *      vignette, flash, and a triangular dither with a whisper of grain against banding.
 * Every optional effect sits behind a branch on its uniform, so idle effects cost a
 * uniform compare.
 */
import * as THREE from 'three';

export type GradeUniforms = {
  /** Scene colour (linear HDR); ShaderPass assigns the composer's read buffer each frame. */
  tDiffuse: { value: THREE.Texture | null };
  /** Bloom composite (linear HDR, reduced resolution). */
  tBloom: { value: THREE.Texture | null };
  /** Coarsest bloom mip: the frame's above-threshold light blurred flat (flood guard). */
  tBloomLow: { value: THREE.Texture | null };
  /** 1 / drawing-buffer size. */
  uTexel: { value: THREE.Vector2 };
  uAspect: { value: number };
  /** Presentation clock (s). */
  uTime: { value: number };
  /** renderer.toneMappingExposure: keeps added light and edge detection exposure-neutral. */
  uExposure: { value: number };
  /** x golden-hour warmth, y night, z Burn, w Burn flicker. */
  uGrade: { value: THREE.Vector4 };
  /** x Luminous Dust, y Acid Cop Vision, z Saffron, w Saffron crash. */
  uFxA: { value: THREE.Vector4 };
  /** x damage, y Command View, z instability, w flash. */
  uFxB: { value: THREE.Vector4 };
  /** xy sun disc in uv, z flare gate (0 = none), w disc radius in screen heights. */
  uSun: { value: THREE.Vector4 };
};

const VERT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloomLow;
uniform vec4 uSun;
uniform float uAspect;
uniform float uExposure;
varying vec2 vUv;
varying float vSunVis;
varying float vBloomGain;

// Mean exposed above-threshold light the bloom may spread over the frame before it is
// scaled back, and how far back it may go.
const float FLOOD_BUDGET = 0.03;
const float FLOOD_FLOOR = 0.3;

void main() {
  vUv = uv;
  // Visible fraction of the sun disc (not hidden by terrain, props or cloud), probed here
  // because the full-screen triangle has three vertices rather than a million pixels.
  float vis = 0.0;
  if (uSun.z > 0.0) {
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float a = fi * 2.39996323;
      vec2 o = vec2(cos(a), sin(a)) * (sqrt((fi + 0.5) / 16.0) * uSun.w);
      vec3 c = texture2D(tDiffuse, uSun.xy + o * vec2(1.0 / uAspect, 1.0)).rgb;
      vis += smoothstep(3.0, 14.0, dot(c, vec3(0.2126, 0.7152, 0.0722)));
    }
    vis *= uSun.z / 16.0;
  }
  vSunVis = vis;
  // Flood guard: the coarsest mip is the frame's glow blurred nearly flat, so a 5x5 grid of
  // it measures how much light the bloom is about to spread. Past the budget the whole bloom
  // scales back (to a floor), so a big bright surface near the camera can't veil the frame,
  // while a night of scattered lights keeps every halo.
  float flood = 0.0;
  for (int j = 0; j < 5; j++) {
    for (int i = 0; i < 5; i++) {
      vec3 c = texture2D(tBloomLow, (vec2(float(i), float(j)) + 0.5) / 5.0).rgb;
      flood += dot(c, vec3(0.2126, 0.7152, 0.0722));
    }
  }
  flood *= uExposure / 25.0;
  vBloomGain = clamp(FLOOD_BUDGET / max(flood, 1e-5), FLOOD_FLOOR, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uTime;
uniform float uExposure;
uniform vec4 uGrade;
uniform vec4 uFxA;
uniform vec4 uFxB;
uniform vec4 uSun;
varying vec2 vUv;
varying float vSunVis;
varying float vBloomGain;

const float TAU = 6.28318531;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 spectrum(float h) {
  return clamp(abs(fract(h + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

// Rotation about the grey axis (Rodrigues): hue turns, luminance and saturation stay put.
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec3 sceneAt(vec2 uv, float bloomGain) {
  return texture2D(tDiffuse, uv).rgb + texture2D(tBloom, uv).rgb * bloomGain;
}

// Exposure-neutral perceptual luminance, so ink lines read the same by day and by night.
float edgeLuma(vec2 uv) {
  float l = luminance(texture2D(tDiffuse, uv).rgb) * uExposure;
  return l / (l + 0.3);
}

// Sobel from four bilinear taps on the half-texel diagonals: each tap averages a 2x2 block,
// and their differences reproduce the 3x3 Sobel weights.
float sobel(vec2 uv, vec2 s) {
  float tl = edgeLuma(uv + vec2(-s.x, s.y));
  float tr = edgeLuma(uv + s);
  float bl = edgeLuma(uv - s);
  float br = edgeLuma(uv + vec2(s.x, -s.y));
  float gx = tr + br - tl - bl;
  float gy = tl + tr - bl - br;
  return sqrt(gx * gx + gy * gy);
}

// Mean edge luminance of the 4x4 block centred on texel corner c (px = one pixel): four
// bilinear taps, each on a texel corner and so the mean of a 2x2 square.
float blockLuma(vec2 c, vec2 px) {
  return 0.25 * (edgeLuma(c - px) + edgeLuma(c + px) + edgeLuma(c + vec2(px.x, -px.y)) + edgeLuma(c + vec2(-px.x, px.y)));
}

// Sobel over four 4x4 blocks 2.5 px off each diagonal (an 8x8 footprint). A step edge
// reads the same as with the fine kernel, a thin line about half as strong, and a feature
// under ~3 px (noise grain, specks, fireflies) a third or less.
float sobelCoarse(vec2 uv, vec2 px) {
  vec2 d = px * 2.5;
  float tl = blockLuma(uv + vec2(-d.x, d.y), px);
  float tr = blockLuma(uv + d, px);
  float bl = blockLuma(uv - d, px);
  float br = blockLuma(uv + vec2(d.x, -d.y), px);
  float gx = tr + br - tl - bl;
  float gy = tl + tr - bl - br;
  return sqrt(gx * gx + gy * gy);
}

// Five plane waves 72 degrees apart: the 5-fold quasicrystal behind the Ley Lattice.
float quasicrystal(vec2 q, float phase) {
  return (cos(q.x + phase)
    + cos(dot(q, vec2(0.30901699, 0.95105652)) + phase)
    + cos(dot(q, vec2(-0.80901699, 0.58778525)) + phase)
    + cos(dot(q, vec2(-0.80901699, -0.58778525)) + phase)
    + cos(dot(q, vec2(0.30901699, -0.95105652)) + phase)) * 0.2;
}

// One layer of glitter: sparse cells, each holding a jittered four-point glint that flares
// briefly at its own rate. px is in 720p-equivalent pixels.
float glitter(vec2 px, float cell, float t, float seed) {
  vec2 g = px / cell;
  vec2 id = floor(g);
  float h = hash12(id + seed);
  vec2 jitter = vec2(hash12(id + seed + 17.3), hash12(id + seed + 41.9)) - 0.5;
  vec2 d = (fract(g) - 0.5 - jitter * 0.6) * cell;
  float twinkle = pow(max(0.0, sin(t * (1.3 + 3.0 * h) + h * 61.0)), 28.0) * step(0.45, h);
  float core = exp(-dot(d, d) * 0.6);
  float rays = exp(-abs(d.x) * 0.45 - d.y * d.y * 2.0) + exp(-abs(d.y) * 0.45 - d.x * d.x * 2.0);
  return twinkle * (core + 0.4 * rays);
}

// Signed distance to a regular pentagon (aperture-shaped lens ghosts).
float pentagon(vec2 q, float rad) {
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  q.x = abs(q.x);
  q -= 2.0 * min(dot(vec2(-k.x, k.y), q), 0.0) * vec2(-k.x, k.y);
  q -= 2.0 * min(dot(vec2(k.x, k.y), q), 0.0) * vec2(k.x, k.y);
  q -= vec2(clamp(q.x, -rad * k.z, rad * k.z), rad);
  return length(q) * sign(q.y);
}

float ghost(vec2 p, vec2 at, float rad) {
  float d = pentagon(p - at, rad);
  return smoothstep(rad * 0.18, -rad * 0.1, d) * (0.55 + 0.45 * smoothstep(-rad * 0.5, 0.0, d));
}

// Flagplaid: Flags "are not actually yellow, they just polarize the light". Under Acid the
// polarization shows as a gold-and-saffron tartan whose bands cross at 45 degrees.
vec3 flagplaid(vec2 px) {
  vec2 w = fract(vec2(px.x + px.y, px.x - px.y) * 0.045);
  vec3 gold = vec3(1.0, 0.76, 0.08);
  vec3 saffron = vec3(0.95, 0.42, 0.04);
  vec3 warp = mix(gold, saffron, step(0.55, w.x)) * (1.0 - 0.75 * step(0.86, w.x) * step(w.x, 0.92));
  vec3 weft = mix(gold, saffron, step(0.55, w.y)) * (1.0 - 0.75 * step(0.86, w.y) * step(w.y, 0.92));
  return (warp + weft) * 0.5;
}

// Display-space Command View: the GCC tabletop map. Scene brightness becomes a sepia
// parchment ramp with paper texture, ink outlines and burnt edges, and the scene's own
// chroma is washed back over the paper (at least half strength, full for saturated pixels)
// so faction colours, Survey tints, ley lines and Flags keep saying who encloses what.
// The input carries no time-of-day grade, so the same paper shows at every hour.
vec3 parchment(vec3 s, vec2 uv, vec2 px, float ink) {
  float l = dot(s, vec3(0.299, 0.587, 0.114));
  float tone = clamp(l, 0.0, 1.0);
  vec3 col = mix(vec3(0.33, 0.23, 0.14), vec3(0.64, 0.51, 0.34), smoothstep(0.0, 0.42, tone));
  col = mix(col, vec3(0.93, 0.86, 0.71), smoothstep(0.36, 0.86, tone));
  float mx = max(s.r, max(s.g, s.b));
  float sat = (mx - min(s.r, min(s.g, s.b))) / max(mx, 1e-3);
  // Additive chroma keeps hues true on the yellowed paper (a multiply would turn cyan green).
  col += (s - l) * mix(0.55, 1.0, smoothstep(0.45, 0.85, sat));
  // Paper: horizontal fibres, fine tooth and broad stains, fixed to the sheet.
  float fibre = valueNoise(px * vec2(0.07, 0.8));
  float tooth = valueNoise(px * 0.6);
  float stain = valueNoise(px * 0.006) * 0.65 + valueNoise(px * 0.017) * 0.35;
  col *= 0.89 + 0.06 * fibre + 0.06 * tooth;
  col *= mix(vec3(1.0), vec3(0.87, 0.79, 0.66), smoothstep(0.52, 0.82, stain));
  col = mix(col, vec3(0.15, 0.09, 0.05), ink);
  // Glowing saturated marks (ley lines, Flags, beams) stay pure, like gilding on the map.
  col = mix(col, s, smoothstep(0.7, 0.95, sat) * smoothstep(0.5, 0.85, mx));
  // Burnt edges: a noisy distance to the frame, browned, then charred.
  vec2 e2 = min(uv, 1.0 - uv) * vec2(uAspect, 1.0);
  float edge = min(e2.x, e2.y) + (valueNoise(px * 0.02) - 0.5) * 0.05 + (valueNoise(px * 0.09) - 0.5) * 0.012;
  col *= mix(vec3(0.56, 0.38, 0.22), vec3(1.0), smoothstep(0.0, 0.1, edge));
  return mix(vec3(0.05, 0.03, 0.02), clamp(col, 0.0, 1.0), smoothstep(0.004, 0.02, edge));
}

void main() {
  float dust = uFxA.x;
  float acid = uFxA.y;
  float saffron = uFxA.z;
  float crash = uFxA.w;
  float damage = uFxB.x;
  float command = uFxB.y;
  float instability = uFxB.z;
  float flash = uFxB.w;
  // Command View is the GCC tabletop map: the mood grades (golden warmth, night, The Burn)
  // stay out of it and the glow is held back, so the map reads the same at every hour.
  float mood = 1.0 - command;
  float warm = uGrade.x * mood;
  float night = uGrade.y * mood;
  float burn = uGrade.z * mood;
  float bloomGain = (1.0 - 0.75 * command) * vBloomGain;
  float t = uTime;
  // Device pixels per 720p pixel: pixel-sized details keep their look at any resolution.
  float pxScale = 1.0 / (uTexel.y * 720.0);
  vec2 px = gl_FragCoord.xy / pxScale;
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);

  // ---- 1. UV effects
  float moire = 0.0;
  if (instability > 0.002) {
    // Two quasicrystals, 6% apart in scale and 3 degrees in angle: their product beats
    // into slow moire fringes over the rosettes.
    float a = quasicrystal(p * 170.0, t * 1.6);
    float b = quasicrystal(mat2(0.99863, 0.05234, -0.05234, 0.99863) * p * 180.0, -t * 1.1);
    moire = clamp(a * b * 4.0, -1.0, 1.0);
    uv += instability * 0.0025 * vec2(sin(p.y * 15.0 + t * 2.1), sin(p.x * 12.0 - t * 1.7));
  }
  if (acid > 0.002) {
    uv = 0.5 + (uv - 0.5) * (1.0 - 0.016 * acid * sin(t * 0.85));
    uv += acid * 0.004 * vec2(sin(uv.y * 11.0 + t * 1.3), sin(uv.x * 9.0 - t * 1.1));
  }

  vec3 col;
  if (acid > 0.002) {
    vec2 split = (uv - 0.5) * (0.011 * acid * (0.8 + 0.2 * sin(t * 2.3)));
    col = vec3(sceneAt(uv + split, bloomGain).r, sceneAt(uv, bloomGain).g, sceneAt(uv - split, bloomGain).b);
  } else {
    col = sceneAt(uv, bloomGain);
  }

  if (dust > 0.002) {
    // Pentagram kaleidoscope folded in from the frame; the centre stays clean for play.
    float k = smoothstep(0.42, 0.95, r) * dust * 0.45;
    if (k > 0.002) {
      const float SEG = TAU / 5.0;
      float a = mod(atan(p.y, p.x) + t * 0.06, SEG);
      a = abs(a - 0.5 * SEG);
      vec2 kuv = vec2(cos(a), sin(a)) * r / vec2(uAspect, 1.0) + 0.5;
      kuv = 1.0 - abs(1.0 - abs(kuv));
      col = mix(col, sceneAt(kuv, bloomGain), k);
    }
  }
  // Negative values from any scene shader would turn the pow() grades below into NaN.
  col = max(col, 0.0);
  // The GCC table is lamp-lit at every hour: the moonlit map gets the light it lost at dusk.
  col *= 1.0 + 0.25 * uGrade.y * command;

  vec2 pxStep = uTexel * max(1.0, pxScale);
  float edges = 0.0;
  if (acid > 0.002) edges = sobel(uv, pxStep * 0.5);
  float ink = 0.0;
  if (command > 0.002) {
    // Ink outlines and boundaries, never texture: a fine edge only inks where the coarse
    // kernel agrees it belongs to something larger than ~3 px (lines, rims, props), so grain,
    // twinkling specks and fireflies leave the paper clean.
    float fine = sobel(uv, pxStep * 0.5);
    float coarse = sobelCoarse(uv, pxStep);
    ink = smoothstep(0.1, 0.32, fine) * smoothstep(0.28, 0.5, coarse / max(fine, 1e-3)) * 0.85;
  }

  // ---- 2. Linear HDR grade and light
  float pivot = 0.18 / uExposure;
  col *= mix(vec3(1.0), vec3(1.07, 1.0, 0.87), warm);
  col = pivot * pow(col / pivot + 1e-6, vec3(1.0 + 0.1 * (1.0 - night)));

  float lum = luminance(col);
  if (night > 0.002) {
    float hi = smoothstep(0.03, 1.0, lum * uExposure);
    float mx = max(col.r, max(col.g, col.b));
    float sat = (mx - min(col.r, min(col.g, col.b))) / (mx + 1e-4);
    vec3 tint = mix(vec3(0.8, 0.96, 1.22), vec3(1.1, 1.0, 0.86), hi);
    // Saturated lights (ley lines, Flags, fairy lights) keep their own colour.
    tint = mix(tint, vec3(1.0), smoothstep(0.45, 0.85, sat) * hi);
    // The Burn's firelight overrides the moonlit cool.
    col = mix(col, col * tint, night * (1.0 - 0.7 * burn));
    // Scotopic falloff: dim areas lose colour at night, bright ones keep it.
    col = mix(col, vec3(lum), night * 0.28 * (1.0 - hi));
  }

  if (burn > 0.002) {
    float f = 1.0 + uGrade.w;
    col *= mix(vec3(1.0), vec3(1.32, 0.88, 0.6) * f, burn * 0.7);
    // Ember haze: smoke lit from below lifts the blacks toward deep red.
    col += vec3(0.04, 0.01, 0.002) * (burn * f / uExposure);
  }

  if (saffron > 0.002) {
    float l = luminance(col);
    col = max(mix(vec3(l), col, 1.0 + 0.45 * saffron), 0.0);
    float pulse = 0.85 + 0.15 * sin(t * 1.7);
    col *= mix(vec3(1.0), vec3(1.14, 1.03, 0.78), saffron);
    col += vec3(1.0, 0.68, 0.18) * ((0.02 / uExposure + 0.28 * l) * saffron * pulse);
  }

  if (crash > 0.002) {
    float l = luminance(col);
    col = mix(col, vec3(l) * vec3(0.96, 1.0, 1.02), 0.75 * crash);
    col = pivot * pow(col / pivot + 1e-6, vec3(1.0 - 0.3 * crash));
    col *= 1.0 - 0.3 * crash;
  }

  if (dust > 0.002) {
    vec3 prism = spectrum(atan(p.y, p.x) / TAU + r * 0.7 - t * 0.04);
    col *= 1.0 + dust * smoothstep(0.15, 0.9, r) * 0.4 * (prism - 0.45);
    float g = glitter(px - vec2(0.0, t * 9.0), 17.0, t, 0.0)
      + glitter(px - vec2(t * 3.0, t * 14.0), 29.0, t * 1.3, 7.0);
    vec3 glint = mix(vec3(1.0, 0.95, 0.8), spectrum(px.x * 0.004 + px.y * 0.003 + t * 0.1), 0.45);
    col += glint * (g * dust * (0.6 + 2.0 * lum) * 2.5 / uExposure);
  }

  if (acid > 0.002) {
    float mx = max(col.r, col.g);
    float yellow = smoothstep(0.45, 0.7, (min(col.r, col.g) - col.b) / max(mx, 1e-4));
    col = max(hueRotate(col, acid * 1.25 * sin(t * 0.22)), 0.0);
    // The Flags alone keep their gold through the hue swing, woven into flagplaid.
    col = mix(col, flagplaid(px) * (mx * 1.1), yellow * acid * 0.7);
    vec3 neon = spectrum(t * 0.17 + r * 1.4 + (p.x - p.y) * 0.35);
    col += neon * (smoothstep(0.2, 0.5, edges) * acid * 1.6 / uExposure);
  }

  if (instability > 0.002) {
    // Crystal pink and blue in the fringes, after the Pentacle Crystals.
    vec3 crystal = mix(vec3(1.0, 0.45, 0.85), vec3(0.4, 0.8, 1.0), 0.5 + 0.5 * moire);
    col *= 1.0 + instability * 0.15 * moire;
    col += crystal * (instability * 0.05 * abs(moire) / uExposure);
  }

  float sunVis = vSunVis * (1.0 - command);
  if (sunVis > 0.002) {
    vec2 s = (uSun.xy - 0.5) * vec2(uAspect, 1.0);
    vec2 d = p - s;
    float dist = length(d);
    float ang = atan(d.y, d.x);
    // Five-blade aperture: ten long spikes, finer diffraction streaks, a warm veil.
    float spikes = pow(abs(cos(ang * 5.0 + 0.3)), 36.0) * exp(-dist * 6.0) * 0.9
      + pow(abs(cos(ang * 13.0 + 1.1 + t * 0.02)), 90.0) * exp(-dist * 11.0) * 0.5;
    vec3 flare = vec3(1.0, 0.86, 0.62) * (spikes + 0.3 * exp(-dist * 8.0));
    // Rainbow ring around the sun.
    vec3 ringD = (vec3(dist) - vec3(0.3, 0.29, 0.28)) * 34.0;
    vec3 ring = exp(-ringD * ringD);
    flare += ring * 0.035;
    // Aperture ghosts on the line through the optical centre.
    flare += vec3(1.0, 0.55, 0.2) * ghost(p, s * -0.35, 0.05) * 0.07;
    flare += vec3(0.3, 0.75, 1.0) * ghost(p, s * -0.75, 0.12) * 0.035;
    flare += vec3(0.75, 0.45, 1.0) * ghost(p, s * -1.2, 0.075) * 0.05;
    flare += vec3(1.0, 0.85, 0.35) * ghost(p, s * 0.45, 0.03) * 0.08;
    col += flare * (sunVis / uExposure);
  }

  // ---- 3. Tone mapping and output encoding
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // ---- 4. Display space
  vec3 sc = clamp(gl_FragColor.rgb, 0.0, 1.0);
  if (command > 0.002) {
    sc = mix(sc, parchment(sc, vUv, px, ink), command);
  }
  if (damage > 0.002) {
    float pulse = 0.75 + 0.25 * sin(t * 9.0);
    float e = smoothstep(0.42, 1.05, length(p * vec2(0.82, 1.2)));
    sc = mix(sc, vec3(0.6, 0.02, 0.03), e * damage * pulse * 0.9);
  }
  vec2 q = vUv - 0.5;
  sc *= 1.0 - 0.3 * smoothstep(0.08, 0.5, dot(q, q));
  // Capture / Burn flash: a quick white-out, squared so it falls off fast.
  sc = mix(sc, vec3(1.0, 0.98, 0.93), flash * flash * 0.75);
  // Triangular dither (one 8-bit step) plus faint mid-tone grain, re-rolled every frame.
  vec2 seed = gl_FragCoord.xy + fract(t * 7.123) * vec2(113.7, 71.3);
  float n = hash12(seed) + hash12(seed + 37.21) - 1.0;
  float y = dot(sc, vec3(0.299, 0.587, 0.114));
  sc += n * ((0.6 + 4.0 * y * (1.0 - y)) / 255.0);
  gl_FragColor = vec4(sc, 1.0);
}
`;

/** The grade material and its typed uniforms (ShaderPass writes tDiffuse). */
export function createGradeMaterial(): { material: THREE.ShaderMaterial; uniforms: GradeUniforms } {
  const uniforms: GradeUniforms = {
    tDiffuse: { value: null },
    tBloom: { value: null },
    tBloomLow: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uAspect: { value: 16 / 9 },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uGrade: { value: new THREE.Vector4() },
    uFxA: { value: new THREE.Vector4() },
    uFxB: { value: new THREE.Vector4() },
    uSun: { value: new THREE.Vector4() },
  };
  const material = new THREE.ShaderMaterial({
    name: 'PostFx.grade',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  return { material, uniforms };
}
