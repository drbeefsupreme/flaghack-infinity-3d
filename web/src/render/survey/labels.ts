/**
 * Objective labels: small dark plaques with a coloured rim and parchment lettering (Cinzel),
 * billboarded at a near-constant on-screen size. Label strings are painted once into slots of
 * a shared canvas atlas (least recently used slot is repainted when a new string appears), so
 * a label costs nothing per frame. The atlas stores masks, not colours: red = lettering,
 * green = rim and corner diamonds, alpha = plaque coverage; the shader tints the rim with the
 * marker colour, so one painted string serves every colour.
 */
import * as THREE from 'three';
import { GLSL_COMMON, GLSL_FRAG, GLSL_OUTPUT, GLSL_VERT, cornerQuad, surveyMaterial } from './glsl';
import type { SurveyUniforms } from './glsl';
import { InstanceSet, XrayMeshes } from './instances';

const ATLAS_W = 1024;
const SLOT_H = 64;
const SLOTS = 16;
const ATLAS_H = SLOT_H * SLOTS;
/** Transparent rows above and below each plaque keep mip levels from bleeding across slots. */
const INSET = 7;
const PAD_X = 26;
const FONT_PX = 32;
const MIN_FONT_PX = 22;
/** Gap between a plaque's bottom edge and its anchor (css px). */
export const LABEL_LIFT_PX = 5;

/**
 * On-screen plaque height (css px) at view depth `depth` (m): ~26 px up close easing to
 * ~17 px far away, and at least 24 px on the Command View table. Mirrors labelHeightPx().
 */
const HEIGHT_GLSL = /* glsl */ `
float labelHeightPx(float depth) {
  return max(mix(26.0, 17.0, smoothstep(12.0, 140.0, depth)), 24.0 * uViewBlend);
}
`;

const VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_VERT}
${HEIGHT_GLSL}
attribute vec2 aCorner;
attribute vec4 iPos;
attribute vec4 iColor;
attribute vec3 iSize;
varying vec2 vUV;
flat varying vec4 vColor;

void main() {
  vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
  vec4 c = projectionMatrix * mv;
  float hpx = labelHeightPx(-mv.z) * uPx;
  // iSize.z: extra lift (device px) that keeps this plaque clear of nearer ones.
  vec2 off = vec2(aCorner.x * iSize.x * hpx, aCorner.y * hpx + ${LABEL_LIFT_PX.toFixed(1)} * uPx + iSize.z);
  c.xy += off * 2.0 / uResolution * c.w;
  gl_Position = c;
  vFogDepth = -mv.z;
  vUV = vec2((aCorner.x + 0.5) * iSize.y, 1.0 - (iPos.w + 1.0 - aCorner.y) * ${(SLOT_H / ATLAS_H).toFixed(6)});
  vColor = iColor;
}
`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_FRAG}
uniform sampler2D uLabels;
varying vec2 vUV;
flat varying vec4 vColor;

void main() {
  vec4 t = texture2D(uLabels, vUV);
  float a = t.a * mix(0.82, 1.0, max(t.r, t.g)) * vColor.a;
#ifdef FH_OCCLUDED
  a *= 0.5;
#endif
  if (a < 0.004) discard;
  // In the field: parchment lettering on a dark plaque. On the Command View table the letters
  // turn to gilt in the marker's hue at full chroma: the map grade passes saturated bright
  // marks untouched ("gilding"), so they stay crisp instead of being inked into the paper.
  float peak = max(max(vColor.r, vColor.g), max(vColor.b, 1e-3));
  vec3 hue = vColor.rgb / peak;
  float lo = min(min(hue.r, hue.g), hue.b);
  vec3 gilt = (1.0 - lo > 0.05 ? (hue - lo) / (1.0 - lo) : vec3(1.0)) * 1.3;
  vec3 ink = mix(vec3(1.0, 0.93, 0.78) * 0.82, gilt, uViewBlend);
  vec3 plaque = vec3(0.022, 0.016, 0.01);
  // Lettering is information, not light: it never brightens with the night exposure lift.
  vec3 col = mix(mix(plaque, vColor.rgb * 0.85, t.g), ink, t.r) * uGlow.x;
  gl_FragColor = vec4(col * a, a);
  ${GLSL_OUTPUT}
}
`;

/** CPU twin of the shader's labelHeightPx (css px), for laying plaques out on screen. */
export function labelHeightPx(depth: number, viewBlend: number): number {
  const k = THREE.MathUtils.smoothstep(depth, 12, 140);
  return Math.max(26 + (17 - 26) * k, 24 * viewBlend);
}

function fontOf(px: number): string {
  return `700 ${px}px "Cinzel", "Cinzel Decorative", serif`;
}

export class LabelAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly text: string[] = [];
  /** Painted plaque width per slot (px). */
  private readonly width = new Float32Array(SLOTS);
  /** Stamp of the frame that last used each slot (-1 never). */
  private readonly usedAt = new Float64Array(SLOTS).fill(-1);
  private readonly slotOf = new Map<string, number>();

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    this.g = canvas.getContext('2d');
    for (let i = 0; i < SLOTS; i++) this.text.push('');
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
  }

  /**
   * Slot holding `text`, painting it into the least recently used slot when it is new.
   * Returns -1 when every slot is already in use this frame.
   */
  acquire(text: string, stamp: number): number {
    const known = this.slotOf.get(text);
    if (known !== undefined) {
      this.usedAt[known] = stamp;
      return known;
    }
    let slot = -1;
    let oldest = Infinity;
    for (let i = 0; i < SLOTS; i++) {
      if (this.usedAt[i] < oldest && this.usedAt[i] !== stamp) {
        oldest = this.usedAt[i];
        slot = i;
      }
    }
    if (slot < 0) return -1;
    const previous = this.text[slot];
    if (previous !== '' && this.slotOf.get(previous) === slot) this.slotOf.delete(previous);
    this.paint(slot, text);
    this.text[slot] = text;
    this.slotOf.set(text, slot);
    this.usedAt[slot] = stamp;
    return slot;
  }

  /** Plaque width over its height (quad aspect). */
  aspect(slot: number): number {
    return this.width[slot] / SLOT_H;
  }

  /** Plaque width as a fraction of the atlas width. */
  widthFraction(slot: number): number {
    return this.width[slot] / ATLAS_W;
  }

  private paint(slot: number, text: string): void {
    const g = this.g;
    if (!g) return;
    const y0 = slot * SLOT_H;
    g.clearRect(0, y0, ATLAS_W, SLOT_H);
    const maxText = ATLAS_W - 2 * PAD_X - 4;
    let size = FONT_PX;
    let shown = text;
    g.font = fontOf(size);
    let tw = g.measureText(shown).width;
    while (tw > maxText && size > MIN_FONT_PX) {
      size -= 2;
      g.font = fontOf(size);
      tw = g.measureText(shown).width;
    }
    while (tw > maxText && shown.length > 2) {
      shown = `${shown.slice(0, -2)}…`;
      tw = g.measureText(shown).width;
    }
    const w = Math.min(ATLAS_W - 2, Math.ceil(tw + 2 * PAD_X));
    const mid = y0 + SLOT_H / 2;
    // Plaque (alpha), rim and diamonds (green), lettering (red): see the module comment.
    g.beginPath();
    g.roundRect(1.5, y0 + INSET, w - 3, SLOT_H - 2 * INSET, 9);
    g.fillStyle = '#000000';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#00ff00';
    g.stroke();
    g.fillStyle = '#00ff00';
    for (const cx of [PAD_X * 0.5, w - PAD_X * 0.5]) {
      g.beginPath();
      g.moveTo(cx, mid - 5);
      g.lineTo(cx + 4, mid);
      g.lineTo(cx, mid + 5);
      g.lineTo(cx - 4, mid);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#ff0000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(shown, w / 2, mid + 1);
    this.width[slot] = w;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export class LabelLayer {
  private readonly set: InstanceSet;
  private readonly meshes: XrayMeshes;
  private readonly arrPos: Float32Array;
  private readonly arrColor: Float32Array;
  private readonly arrSize: Float32Array;
  readonly atlas = new LabelAtlas();
  count = 0;

  constructor(scene: THREE.Scene, shared: SurveyUniforms, capacity: number, renderOrder: number) {
    this.set = new InstanceSet(cornerQuad([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1]), capacity);
    this.arrPos = this.set.add('iPos', 4);
    this.arrColor = this.set.add('iColor', 4);
    this.arrSize = this.set.add('iSize', 3);
    const make = (occluded: boolean): THREE.ShaderMaterial => {
      const m = surveyMaterial(shared, {
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uLabels: { value: this.atlas.texture } },
        side: THREE.DoubleSide,
        defines: occluded ? { FH_OCCLUDED: 1 } : {},
        hdrCap: 1.4,
      });
      m.forceSinglePass = true;
      return m;
    };
    this.meshes = new XrayMeshes(scene, this.set.geo, make(false), make(true), renderOrder);
  }

  reset(): void {
    this.count = 0;
  }

  /**
   * Append the plaque for atlas `slot`, its bottom edge just above (x, y, z), raised a further
   * `liftPx` device pixels to clear nearer plaques.
   */
  push(x: number, y: number, z: number, slot: number, color: THREE.Color, alpha: number, liftPx: number): void {
    if (slot < 0 || this.count >= this.set.capacity) return;
    const i = this.count++;
    const o = i * 4;
    this.arrPos[o] = x;
    this.arrPos[o + 1] = y;
    this.arrPos[o + 2] = z;
    this.arrPos[o + 3] = slot;
    this.arrColor[o] = color.r;
    this.arrColor[o + 1] = color.g;
    this.arrColor[o + 2] = color.b;
    this.arrColor[o + 3] = alpha;
    this.arrSize[i * 3] = this.atlas.aspect(slot);
    this.arrSize[i * 3 + 1] = this.atlas.widthFraction(slot);
    this.arrSize[i * 3 + 2] = liftPx;
  }

  commit(): void {
    this.set.commit(this.count);
    this.meshes.visible = this.count > 0;
  }

  dispose(): void {
    this.meshes.dispose();
    this.set.geo.dispose();
    this.atlas.dispose();
  }
}
