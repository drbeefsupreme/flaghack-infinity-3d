/**
 * Bloom for the post chain: three's UnrealBloomPass pyramid (five Gaussian-blurred mips and
 * their weighted composite) with two changes.
 * - The bright pass is a 4-tap soft-knee prefilter that keeps only the light ABOVE the
 *   threshold. Lights glow in proportion to how bright they are, not to how much of the
 *   frame they cover: a large surface just over the threshold (Survey glass seen from
 *   inside, a sunlit tent) adds next to nothing, while Flags, ley lines, fire and festival
 *   lights keep their halos. Each output texel averages its whole footprint, so the pyramid
 *   can run below half resolution on lower qualities without small lights shimmering.
 * - The composite stays in the pass's own target (`texture`) and the grade pass adds it
 *   while it reads the scene. The stock pass blends it back into the scene buffer, which
 *   here is multisampled: a full-screen read-modify-write of every sample plus a second
 *   resolve per frame.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Half-width of the soft knee around the threshold, as a fraction of the threshold. */
const KNEE = 0.25;
/** Prefilter clamp: keeps a stray hot pixel from flooding the pyramid (the sun disc is ~38). */
const MAX_BRIGHT = 64;

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

const PREFILTER_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

void main() {
  // Bilinear taps a quarter output texel off centre cover the full footprint of this texel
  // for any reduction up to 4x (at 2x they land on the four source texel centres).
  vec2 o = uTexel * 0.25;
  vec3 c = texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb
    + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb
    + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb
    + texture2D(tDiffuse, vUv + vec2(o.x, o.y)).rgb;
  // One NaN or Inf from any scene shader would smear across the whole pyramid: drop it.
  if (any(equal(floatBitsToUint(c) & 0x7f800000u, uvec3(0x7f800000u)))) c = vec3(0.0);
  c = clamp(c * 0.25, 0.0, ${MAX_BRIGHT.toFixed(1)});
  // Keep only the energy above the threshold: quadratic through the knee, then linear.
  float br = luminance(c);
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  gl_FragColor = vec4(c * (max(soft, br - uThreshold) / max(br, 1e-5)), 1.0);
}
`;

type PrefilterUniforms = {
  tDiffuse: { value: THREE.Texture | null };
  uTexel: { value: THREE.Vector2 };
  uThreshold: { value: number };
  uKnee: { value: number };
};

export class BloomChain extends UnrealBloomPass {
  /** Fraction of the composer resolution the pyramid starts from (it halves that again). */
  private scale: number;
  private prefilter: THREE.ShaderMaterial;
  private prefilterUniforms: PrefilterUniforms;
  private quad: FullScreenQuad;

  constructor(scale: number, strength: number, radius: number, threshold: number) {
    super(new THREE.Vector2(256, 256), strength, radius, threshold);
    this.scale = scale;
    this.prefilterUniforms = {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 128, 1 / 128) },
      uThreshold: { value: threshold },
      uKnee: { value: threshold * KNEE },
    };
    this.prefilter = new THREE.ShaderMaterial({
      name: 'PostFx.bloomPrefilter',
      uniforms: this.prefilterUniforms,
      vertexShader: PREFILTER_VERT,
      fragmentShader: PREFILTER_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.prefilter);
  }

  /** Bloom composite (linear HDR, half the pyramid's input size), sampled by the grade pass. */
  get texture(): THREE.Texture {
    return this.renderTargetsHorizontal[0].texture;
  }

  /** Coarsest blurred mip: the frame's above-threshold light spread nearly flat. */
  get lowTexture(): THREE.Texture {
    return this.renderTargetsVertical[this.nMips - 1].texture;
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(4, Math.round(width * this.scale)), Math.max(4, Math.round(height * this.scale)));
    this.prefilterUniforms.uTexel.value.set(1 / this.renderTargetBright.width, 1 / this.renderTargetBright.height);
  }

  override render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    // Every draw below is an opaque full-screen quad, so no target needs clearing first.
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    const pre = this.prefilterUniforms;
    pre.tDiffuse.value = readBuffer.texture;
    pre.uThreshold.value = this.threshold;
    pre.uKnee.value = this.threshold * KNEE;
    this.quad.material = this.prefilter;
    renderer.setRenderTarget(this.renderTargetBright);
    this.quad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      const horizontal = this.renderTargetsHorizontal[i];
      const vertical = this.renderTargetsVertical[i];
      this.quad.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(horizontal);
      this.quad.render(renderer);
      blur.uniforms.colorTexture.value = horizontal.texture;
      blur.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(vertical);
      this.quad.render(renderer);
      input = vertical;
    }

    const composite = this.compositeMaterial;
    composite.uniforms.bloomStrength.value = this.strength;
    composite.uniforms.bloomRadius.value = this.radius;
    this.quad.material = composite;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    this.quad.render(renderer);

    renderer.autoClear = autoClear;
  }

  override dispose(): void {
    super.dispose();
    // The stock dispose() skips the bright-pass material (never compiled here: replaced by
    // the prefilter).
    this.materialHighPassFilter.dispose();
    this.prefilter.dispose();
    this.quad.dispose();
  }
}
