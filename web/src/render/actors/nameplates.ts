/**
 * Online nameplates: the handle of every human vexillomancer (session.playerNames, empty
 * offline) floats above their avatar on a dark pill with a faction-colour rim, a pentagram
 * sigil and a tail pointing down at the wearer.
 *
 * Plates are screen-space billboards: a constant size in CSS pixels, so a handle stays
 * readable at any range. They fade out beyond ~60 m in action view and always show in Command
 * View. They draw over the scene, so your own avatar never hides the plate of a rival ahead
 * of you; the avatar renderer hides plates whose wearer is out of sight instead. The text
 * comes from a canvas atlas with one row per seat, redrawn only when that seat's handle
 * changes. One instanced draw, and none at all while no seat has a handle.
 */
import * as THREE from 'three';
import type { Screen, Session } from '../../game/session';
import { FACTION_IDS } from '../../sim/types';
import type { FactionId, FactionState } from '../../sim/types';
import { InstanceBatch } from './overlays';

const ATLAS_W = 1024;
const ROW_H = 128;
/** One atlas row per seat (FactionId 0..3). */
const ROWS = 4;
/** Transparent border so texture filtering and the rim glow are never clipped. */
const MARGIN = 14;
const PILL_TOP = 12;
const PILL_H = 82;
const TAIL_H = 18;
/** Pill interior: left padding, sigil column, right padding (atlas px). */
const PAD_LEFT = 26;
const SIGIL_W = 50;
const PAD_RIGHT = 30;
const FONT_MAX = 54;
const FONT_MIN = 30;
const MAX_TEXT_W = ATLAS_W - 2 * MARGIN - PAD_LEFT - SIGIL_W - PAD_RIGHT;

/** Whole-row height on screen (CSS px): a little larger up close. */
const PLATE_PX_NEAR = 46;
const PLATE_PX_FAR = 36;
/** Action view: plates fade out between these distances from the eye (m). */
const FADE_NEAR = 52;
const FADE_FAR = 64;

/** Plates belong to the match being played, not the attract burn behind the title or lobby. */
const SHOW_ON: Record<Screen, boolean> = { title: false, lobby: false, playing: true, paused: true, ended: true };

const PLATE_VERTEX = /* glsl */ `
attribute vec4 aPlateA; // anchor xyz (where the tail points), alpha
attribute vec2 aPlateB; // atlas row, plate width as a fraction of the atlas width
uniform vec2 uViewport;
uniform float uCommand;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 mv = viewMatrix * vec4(aPlateA.xyz, 1.0);
  float dist = -mv.z;
  vec4 clip = projectionMatrix * mv;
  float heightPx = mix(${PLATE_PX_NEAR.toFixed(1)}, ${PLATE_PX_FAR.toFixed(1)}, mix(smoothstep(5.0, 45.0, dist), 1.0, uCommand));
  float widthPx = heightPx * aPlateB.y * ${(ATLAS_W / ROW_H).toFixed(1)};
  // Constant pixel size: offset in clip space, the row's bottom edge just above the anchor.
  vec2 offsetPx = vec2(position.x * widthPx, (position.y + 0.5) * heightPx + 1.0);
  clip.xy += offsetPx * 2.0 / uViewport * clip.w;
  // Behind the eye: collapse outside the clip volume.
  gl_Position = mv.z > -0.1 ? vec4(0.0, 0.0, 2.0, 1.0) : clip;
  vUv = vec2((position.x + 0.5) * aPlateB.y, 1.0 - (aPlateB.x + 0.5 - position.y) / ${ROWS.toFixed(1)});
  float fade = 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, dist);
  vAlpha = aPlateA.w * mix(fade, 1.0, uCommand);
}
`;

const PLATE_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uBrightness;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  float a = c.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c.rgb * uBrightness * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A five-pointed star (the faction sigil) centred on (x, y). */
function star(g: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

export class Nameplates {
  private readonly scene: THREE.Scene;
  private readonly batch: InstanceBatch;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly uniforms: {
    uViewport: THREE.IUniform<THREE.Vector2>;
    uCommand: THREE.IUniform<number>;
    uBrightness: THREE.IUniform<number>;
  };
  /** Faction rim/sigil colour (CSS) per seat. */
  private readonly css: string[];
  /** The handle each row was drawn from (the raw session value), per seat. */
  private readonly drawn: string[] = ['', '', '', ''];
  /** Plate width per row as a fraction of the atlas width; 0 = no handle. */
  private readonly widths = new Float32Array(ROWS);
  /** Redraw every row on the next frame (the plate font finished loading). */
  private stale = false;
  private enabled = false;
  private disposed = false;

  constructor(scene: THREE.Scene, factions: readonly FactionState[]) {
    this.scene = scene;
    this.css = factions.map((f) => f.css);
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ROW_H * ROWS;
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('Nameplates: 2D canvas unavailable');
    this.g = g;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.uniforms = { uViewport: { value: new THREE.Vector2(1280, 720) }, uCommand: { value: 0 }, uBrightness: { value: 1 } };
    const quad = new THREE.PlaneGeometry(1, 1);
    this.batch = new InstanceBatch(quad, ['aPlateA', 'aPlateB'], [4, 2], ROWS);
    quad.dispose();
    this.material = new THREE.ShaderMaterial({
      vertexShader: PLATE_VERTEX,
      fragmentShader: PLATE_FRAGMENT,
      uniforms: { uAtlas: { value: this.texture }, ...this.uniforms },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Premultiplied alpha.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.batch.geometry, this.material);
    this.mesh.name = 'actors-nameplates';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
    scene.add(this.mesh);
    // Rows drawn before the plate font arrives use a fallback face: redraw once it settles.
    const refresh = () => {
      if (!this.disposed) this.stale = true;
    };
    document.fonts.load(`700 ${FONT_MAX}px Rubik`).then(refresh, refresh);
  }

  /** Per frame, before avatars push: sync handles from the session and reset the batch. */
  begin(session: Session): void {
    this.batch.count = 0;
    this.enabled = SHOW_ON[session.screen];
    const names = session.playerNames;
    for (let i = 0; i < FACTION_IDS.length; i++) {
      const f = FACTION_IDS[i];
      const name = names[f] ?? '';
      if (name !== this.drawn[f] || this.stale) {
        this.drawn[f] = name;
        this.widths[f] = this.drawRow(f, name);
        this.texture.needsUpdate = true;
      }
    }
    this.stale = false;
  }

  /** True when `faction` has a handle to show this frame. */
  has(faction: FactionId): boolean {
    return this.enabled && this.widths[faction] > 0;
  }

  /**
   * Show `faction`'s plate with its tail at (x, y, z) (no-op without a handle or outside a
   * match). `alpha` fades it (line of sight, materializing after respawn).
   */
  push(faction: FactionId, x: number, y: number, z: number, alpha: number): void {
    if (!this.has(faction) || alpha <= 0.004) return;
    const width = this.widths[faction];
    const i = this.batch.next();
    const a = this.batch.attrs[0];
    const b = this.batch.attrs[1];
    a.array[i * 4] = x;
    a.array[i * 4 + 1] = y;
    a.array[i * 4 + 2] = z;
    a.array[i * 4 + 3] = alpha;
    b.array[i * 2] = faction;
    b.array[i * 2 + 1] = width;
  }

  /** Upload this frame's plates. `command` 1 in Command View (no distance fade). */
  end(renderer: THREE.WebGLRenderer, command: number, daylight: number): void {
    this.batch.flush();
    this.mesh.visible = this.batch.count > 0;
    renderer.getSize(this.uniforms.uViewport.value);
    this.uniforms.uCommand.value = command;
    // Night exposure is raised and bloom kicks in lower: dim so the text stays crisp.
    this.uniforms.uBrightness.value = 0.72 + 0.28 * daylight;
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.batch.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  /** Draw a seat's plate into its atlas row; returns its width as a fraction of the atlas (0: none). */
  private drawRow(f: FactionId, raw: string): number {
    const g = this.g;
    const y0 = f * ROW_H;
    g.clearRect(0, y0, ATLAS_W, ROW_H);
    const name = raw.trim();
    if (name === '') return 0;

    // Fit the handle: shrink the font, then ellipsize (by code point) as a last resort.
    let size = FONT_MAX;
    g.font = `700 ${size}px Rubik, sans-serif`;
    let text = name;
    let textW = g.measureText(text).width;
    if (textW > MAX_TEXT_W) {
      size = Math.max(FONT_MIN, Math.floor((size * MAX_TEXT_W) / textW));
      g.font = `700 ${size}px Rubik, sans-serif`;
      textW = g.measureText(text).width;
    }
    if (textW > MAX_TEXT_W) {
      const chars = Array.from(name);
      do {
        chars.pop();
        text = `${chars.join('')}…`;
        textW = g.measureText(text).width;
      } while (chars.length > 1 && textW > MAX_TEXT_W);
    }

    const css = this.css[f];
    const left = MARGIN;
    const right = Math.ceil(MARGIN + PAD_LEFT + SIGIL_W + textW + PAD_RIGHT);
    const midY = y0 + PILL_TOP + PILL_H / 2;
    g.save();
    g.beginPath();
    g.rect(0, y0, ATLAS_W, ROW_H);
    g.clip();
    // Pill with a faction-colour rim and a soft glow of the same colour.
    g.beginPath();
    g.roundRect(left, y0 + PILL_TOP, right - left, PILL_H, PILL_H / 2);
    g.fillStyle = 'rgba(12, 10, 20, 0.86)';
    g.shadowColor = css;
    g.shadowBlur = 10;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 5;
    g.strokeStyle = css;
    g.stroke();
    // Tail pointing down at the wearer.
    const cx = (left + right) / 2;
    const base = y0 + PILL_TOP + PILL_H - 2;
    g.beginPath();
    g.moveTo(cx - 15, base);
    g.lineTo(cx + 15, base);
    g.lineTo(cx, base + TAIL_H);
    g.closePath();
    g.fillStyle = css;
    g.fill();
    // Sigil and handle.
    star(g, left + PAD_LEFT + SIGIL_W / 2 - 6, midY, 17, 7);
    g.fill();
    g.font = `700 ${size}px Rubik, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0, 0, 0, 0.7)';
    g.shadowBlur = 6;
    g.fillStyle = '#fff7e0';
    g.fillText(text, left + PAD_LEFT + SIGIL_W, midY + 3);
    g.restore();
    return (right + MARGIN) / ATLAS_W;
  }
}
