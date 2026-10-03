/**
 * Shared GLSL snippets and the material factory used by every VFX layer.
 *
 * Every layer renders with premultiplied-alpha blending (ONE, ONE_MINUS_SRC_ALPHA): a
 * fragment that writes alpha 0 is pure additive light, alpha > 0 occludes what is behind it
 * (smoke, scorch, confetti). One blend state therefore serves glow and grime alike, and the
 * layers stay order-independent where it matters (light).
 */
import * as THREE from 'three';

/** Uniform objects shared by reference across all VFX materials (one write updates all). */
export interface SharedUniforms {
  /** Presentation clock (s), = ctx.time. */
  uTime: THREE.IUniform<number>;
  /** Drawing-buffer height in pixels (minimum on-screen size of particles/markers). */
  uViewportH: THREE.IUniform<number>;
  /** Ambient light on unlit grime (smoke, dust, chips): 1 by day, dim at night. */
  uLight: THREE.IUniform<number>;
}

export const NOISE_GLSL = /* glsl */ `
float fxHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x),
    mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
`;

/** Degenerate, clipped vertex: dead/unspawned instances cost no fragments. */
export const COLLAPSE_GLSL = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;';

/**
 * Fog for premultiplied output. The occluding part (alpha) is pulled toward the fog colour;
 * emitted light only fades partially, since glows punch through haze in practice.
 */
export const FOG_FRAG_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fxFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fxFog = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fxFog * 0.85);
#endif
`;

/**
 * Clamp, then tone map + output colour space (the latter two are no-ops when rendering into
 * post-processing targets). The clamp keeps stacked additive light from flooding the
 * HalfFloat bloom chain: no fragment adds more than 6 linear units.
 */
export const OUTPUT_GLSL = /* glsl */ `
gl_FragColor = vec4(clamp(gl_FragColor.rgb, 0.0, 6.0), clamp(gl_FragColor.a, 0.0, 1.0));
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

export interface FxMaterialParams {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
  defines?: Record<string, string>;
  side?: THREE.Side;
  depthTest?: boolean;
  fog?: boolean;
}

/** Premultiplied-alpha, depth-tested, non-depth-writing ShaderMaterial with fog uniforms. */
export function fxMaterial(p: FxMaterialParams): THREE.ShaderMaterial {
  const fog = p.fog ?? true;
  // Clone only the fog block; caller uniforms are kept by reference so shared clocks and
  // textures are not duplicated.
  const uniforms: Record<string, THREE.IUniform> = fog ? THREE.UniformsUtils.clone(THREE.UniformsLib.fog) : {};
  Object.assign(uniforms, p.uniforms);
  return new THREE.ShaderMaterial({
    vertexShader: p.vertexShader,
    fragmentShader: p.fragmentShader,
    uniforms,
    defines: p.defines ?? {},
    fog,
    transparent: true,
    depthWrite: false,
    depthTest: p.depthTest ?? true,
    side: p.side ?? THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

/** Unit quad in the XY plane ([-1, 1]²), indexed: the billboard base for instanced layers. */
export function quadXY(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Unit quad lying on the ground plane (XZ, [-1, 1]²). */
export function quadXZ(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/** Copy a non-instanced geometry's index/position/normal/uv into an instanced geometry. */
export function toInstanced(src: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const index = src.getIndex();
  if (index) g.setIndex(index);
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (a) g.setAttribute(name, a);
  }
  src.dispose();
  return g;
}
