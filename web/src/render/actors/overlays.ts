/**
 * Instanced overlay batches written by several actor renderers each frame:
 * - UnitRings: SDF rings on the ground (faction ring under hippies, rotating rune ring under
 *   vexillomancers, pulsing selection ring, expanding beacon pulse). One draw call.
 * - StatusIcons: camera-facing D.E.G.E.N. badges (dark disc, glyph from a canvas-drawn atlas,
 *   faction-coloured attention arc) plus additive glow sprites (beacon LEDs). One draw call.
 * Both use premultiplied/additive blending and include tone mapping + output colour space so
 * they match built-in materials whether rendered to screen or into the post chain.
 */
import * as THREE from 'three';
import type { HippieStatus } from '../../sim/types';
import { markInstancesDirty } from './util';

export const RING = { hippie: 0, avatar: 1, selected: 2, pulse: 3 } as const;

const RING_VERTEX = /* glsl */ `
attribute vec4 aRingA; // centre xyz, radius
attribute vec4 aRingB; // colour rgb, intensity
attribute vec4 aRingC; // style, phase
varying vec2 vP;
varying vec4 vCol;
varying vec2 vStyle;
void main() {
  vP = position.xy;
  vCol = aRingB;
  vStyle = aRingC.xy;
  vec3 wp = aRingA.xyz + vec3(position.x, 0.0, -position.y) * aRingA.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vP;
varying vec4 vCol;
varying vec2 vStyle;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float style = vStyle.x;
  float a;
  if (style < 0.5) {
    a = smoothstep(0.6, 0.76, r) * (1.0 - smoothstep(0.86, 1.0, r)) + 0.1 * (1.0 - smoothstep(0.0, 0.8, r));
  } else if (style < 1.5) {
    float ring = smoothstep(0.8, 0.86, r) * (1.0 - smoothstep(0.92, 1.0, r));
    float ang = atan(vP.y, vP.x + 1e-4) + uTime * 0.8 + vStyle.y * 6.2832;
    float dash = step(0.5, fract(ang / 6.2832 * 10.0)) * smoothstep(0.62, 0.66, r) * (1.0 - smoothstep(0.72, 0.76, r));
    float fill = 0.16 * (1.0 - smoothstep(0.2, 0.85, r));
    a = ring + dash * 0.7 + fill;
  } else if (style < 2.5) {
    float pulse = 0.75 + 0.25 * sin(uTime * 6.0 + vStyle.y * 6.2832);
    a = smoothstep(0.68, 0.8, r) * (1.0 - smoothstep(0.9, 1.0, r)) * pulse * 1.6;
  } else {
    float w = fract(uTime * 0.7 + vStyle.y);
    a = (1.0 - smoothstep(0.0, 0.08, abs(r - w))) * (1.0 - w) + 0.12 * (1.0 - smoothstep(0.0, 0.5, r));
  }
  gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Growable set of instanced attributes behind one InstancedBufferGeometry. */
export class InstanceBatch {
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly sizes: readonly number[];
  private readonly names: readonly string[];
  capacity: number;
  count = 0;

  constructor(base: THREE.BufferGeometry, names: readonly string[], sizes: readonly number[], capacity: number) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    this.names = names;
    this.sizes = sizes;
    this.capacity = capacity;
    this.attrs = names.map((n, i) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * sizes[i]), sizes[i]);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(n, a);
      return a;
    });
    this.geometry.instanceCount = 0;
  }

  /** Index of a fresh instance (grows ×2 when full; frees old GPU buffers first). */
  next(): number {
    if (this.count >= this.capacity) {
      this.capacity *= 2;
      this.geometry.dispose();
      for (let i = 0; i < this.attrs.length; i++) {
        const arr = new Float32Array(this.capacity * this.sizes[i]);
        arr.set(this.attrs[i].array);
        const a = new THREE.InstancedBufferAttribute(arr, this.sizes[i]);
        a.setUsage(THREE.DynamicDrawUsage);
        this.attrs[i] = a;
        this.geometry.setAttribute(this.names[i], a);
      }
    }
    return this.count++;
  }

  flush(): void {
    this.geometry.instanceCount = this.count;
    for (const a of this.attrs) markInstancesDirty(a, this.count);
  }
}

export class UnitRings {
  private readonly scene: THREE.Scene;
  private readonly batch: InstanceBatch;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly time = { value: 0 };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const quad = new THREE.PlaneGeometry(2, 2);
    this.batch = new InstanceBatch(quad, ['aRingA', 'aRingB', 'aRingC'], [4, 4, 4], 256);
    quad.dispose();
    this.material = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: { uTime: this.time },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.batch.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'actors-rings';
    scene.add(this.mesh);
  }

  begin(): void {
    this.batch.count = 0;
  }

  push(x: number, y: number, z: number, radius: number, color: THREE.Color, intensity: number, style: number, phase: number): void {
    const i = this.batch.next();
    const attrs = this.batch.attrs;
    const a = attrs[0];
    const b = attrs[1];
    const c = attrs[2];
    a.array[i * 4] = x;
    a.array[i * 4 + 1] = y;
    a.array[i * 4 + 2] = z;
    a.array[i * 4 + 3] = radius;
    b.array[i * 4] = color.r;
    b.array[i * 4 + 1] = color.g;
    b.array[i * 4 + 2] = color.b;
    b.array[i * 4 + 3] = intensity;
    c.array[i * 4] = style;
    c.array[i * 4 + 1] = phase;
  }

  end(time: number): void {
    this.time.value = time;
    this.batch.flush();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.batch.geometry.dispose();
    this.material.dispose();
  }
}

// ── D.E.G.E.N. status icons ─────────────────────────────────────────────────────────

const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;
const CELL = 64;

export const ICON_GLOW = 20;

/** Atlas cell per hippie status (what the D.E.G.E.N. mesh reports). */
export const STATUS_ICON: Record<HippieStatus, number> = {
  idle: 0,
  walking: 1,
  fetching: 2,
  carrying: 3,
  planting: 4,
  pulling: 5,
  stealing: 6,
  chopping: 7,
  hauling: 8,
  building: 9,
  repairing: 10,
  fighting: 11,
  tearing: 12,
  drumming: 13,
  defending: 14,
  following: 15,
  responding: 16,
  distracted: 17,
  fleeing: 18,
  ko: 19,
};

type Glyph = (g: CanvasRenderingContext2D) => void;

const YELLOW = '#ffd400';
const INK = '#f4f1e6';

function flagGlyph(g: CanvasRenderingContext2D, x: number, y: number, s: number, tilt = 0): void {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.strokeStyle = '#c9965a';
  g.lineWidth = 2.5 * s;
  g.beginPath();
  g.moveTo(0, 14 * s);
  g.lineTo(0, -14 * s);
  g.stroke();
  g.fillStyle = YELLOW;
  g.beginPath();
  g.moveTo(1, -14 * s);
  g.quadraticCurveTo(9 * s, -16 * s, 16 * s, -12 * s);
  g.lineTo(16 * s, -1 * s);
  g.quadraticCurveTo(9 * s, -5 * s, 1, -3 * s);
  g.closePath();
  g.fill();
  g.restore();
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, color: string): void {
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3.5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dx - ux * 5, y + dy - uy * 5);
  g.stroke();
  g.beginPath();
  g.moveTo(x + dx, y + dy);
  g.lineTo(x + dx - ux * 8 - uy * 6, y + dy - uy * 8 + ux * 6);
  g.lineTo(x + dx - ux * 8 + uy * 6, y + dy - uy * 8 - ux * 6);
  g.closePath();
  g.fill();
}

function text(g: CanvasRenderingContext2D, s: string, size: number, color: string, x = 32, y = 32): void {
  g.fillStyle = color;
  g.font = `700 ${size}px Rubik, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** Icon painters, drawn into a 64×64 cell centred at (32, 32). */
const GLYPHS: Glyph[] = [
  // idle: peace sign
  (g) => {
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(32, 32, 15, 0, Math.PI * 2);
    g.moveTo(32, 17);
    g.lineTo(32, 47);
    g.moveTo(32, 32);
    g.lineTo(21.5, 42.5);
    g.moveTo(32, 32);
    g.lineTo(42.5, 42.5);
    g.stroke();
  },
  // walking: footprints
  (g) => {
    g.fillStyle = INK;
    for (const [x, y, r] of [
      [25, 38, -0.2],
      [39, 24, 0.2],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(r);
      g.beginPath();
      g.ellipse(0, 0, 5, 8.5, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(0, -12, 3.5, 3, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  },
  // fetching: Flag + arrow toward it
  (g) => {
    flagGlyph(g, 38, 34, 1);
    arrow(g, 12, 42, 16, -10, INK);
  },
  // carrying: Flag over the shoulder
  (g) => flagGlyph(g, 30, 34, 1.15, 0.5),
  // planting: Flag + down arrow
  (g) => {
    flagGlyph(g, 26, 30, 0.95);
    arrow(g, 46, 18, 0, 26, INK);
  },
  // pulling: Flag + up arrow
  (g) => {
    flagGlyph(g, 26, 34, 0.95);
    arrow(g, 46, 46, 0, -26, INK);
  },
  // stealing: Flag + red exclamation
  (g) => {
    flagGlyph(g, 20, 33, 0.95);
    text(g, '!', 30, '#ff4058', 46, 33);
  },
  // chopping: axe
  (g) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.6);
    g.fillStyle = '#b07a45';
    g.fillRect(-2.5, -16, 5, 34);
    g.fillStyle = '#d8dde4';
    g.beginPath();
    g.moveTo(2, -16);
    g.quadraticCurveTo(16, -14, 15, -2);
    g.lineTo(2, -6);
    g.closePath();
    g.fill();
    g.restore();
  },
  // hauling: logs
  (g) => {
    g.fillStyle = '#b07a45';
    g.strokeStyle = '#6b4424';
    g.lineWidth = 2;
    for (const [x, y] of [
      [22, 40],
      [42, 40],
      [32, 24],
    ] as const) {
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.stroke();
    }
  },
  // building: hammer
  (g) => {
    g.save();
    g.translate(32, 32);
    g.rotate(0.6);
    g.fillStyle = '#b07a45';
    g.fillRect(-2.5, -8, 5, 26);
    g.fillStyle = '#d8dde4';
    g.fillRect(-11, -16, 22, 9);
    g.restore();
  },
  // repairing: wrench
  (g) => {
    g.save();
    g.translate(32, 32);
    g.rotate(-0.75);
    g.fillStyle = '#d8dde4';
    g.fillRect(-3.5, -6, 7, 24);
    g.beginPath();
    g.arc(0, -10, 9, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(-3.5, -22, 7, 11);
    g.restore();
  },
  // fighting: fist
  (g) => {
    g.fillStyle = '#f2c79a';
    g.strokeStyle = '#8a5a3a';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(17, 20, 30, 24, 7);
    g.fill();
    g.stroke();
    g.beginPath();
    for (const x of [24.5, 32, 39.5]) {
      g.moveTo(x, 21);
      g.lineTo(x, 30);
    }
    g.moveTo(17, 34);
    g.lineTo(30, 34);
    g.stroke();
  },
  // tearing: cracked wall
  (g) => {
    g.fillStyle = '#c96a4a';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        // Running bond: odd courses shift half a brick.
        const off = r % 2 === 0 ? 0 : -6;
        g.fillRect(14 + c * 13 + off, 18 + r * 10, 11, 8);
      }
    }
    g.strokeStyle = '#141018';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(34, 14);
    g.lineTo(28, 26);
    g.lineTo(36, 32);
    g.lineTo(29, 48);
    g.stroke();
  },
  // drumming: bongo
  (g) => {
    g.fillStyle = '#b07a45';
    g.beginPath();
    g.moveTo(18, 26);
    g.lineTo(46, 26);
    g.lineTo(42, 48);
    g.lineTo(22, 48);
    g.closePath();
    g.fill();
    g.fillStyle = '#efe0bf';
    g.beginPath();
    g.ellipse(32, 26, 14, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(14, 12);
    g.lineTo(24, 22);
    g.moveTo(50, 12);
    g.lineTo(40, 22);
    g.stroke();
  },
  // defending: shield
  (g) => {
    g.fillStyle = '#7fb4ff';
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(32, 14);
    g.lineTo(47, 20);
    g.quadraticCurveTo(46, 40, 32, 50);
    g.quadraticCurveTo(18, 40, 17, 20);
    g.closePath();
    g.fill();
    g.stroke();
  },
  // following: chevrons
  (g) => {
    g.strokeStyle = INK;
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(18, 20);
    g.lineTo(30, 32);
    g.lineTo(18, 44);
    g.moveTo(32, 20);
    g.lineTo(44, 32);
    g.lineTo(32, 44);
    g.stroke();
  },
  // responding: SOS
  (g) => text(g, 'SOS', 20, '#ff5a4a'),
  // distracted: music notes
  (g) => {
    g.fillStyle = '#ff9be8';
    g.strokeStyle = '#ff9be8';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(22, 42, 6, 4.5, -0.3, 0, Math.PI * 2);
    g.ellipse(41, 38, 6, 4.5, -0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(27, 41);
    g.lineTo(27, 17);
    g.lineTo(46, 13);
    g.lineTo(46, 37);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(27, 19);
    g.lineTo(46, 15);
    g.stroke();
  },
  // fleeing: double exclamation
  (g) => text(g, '!!', 30, '#ffb000'),
  // ko: zzz
  (g) => {
    text(g, 'z', 13, INK, 22, 22);
    text(g, 'z', 18, INK, 32, 31);
    text(g, 'z', 24, INK, 42, 42);
  },
  // glow sprite (beacon LEDs)
  (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  },
];

function buildAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Status icons: 2D canvas unavailable');
  GLYPHS.forEach((draw, i) => {
    g.save();
    g.translate((i % ATLAS_COLS) * CELL, Math.floor(i / ATLAS_COLS) * CELL);
    g.beginPath();
    g.rect(0, 0, CELL, CELL);
    g.clip();
    draw(g);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const ICON_VERTEX = /* glsl */ `
attribute vec4 aIconA; // centre xyz, world size
attribute vec4 aIconB; // cell, alpha, ring fraction, mode (0 badge, 1 glow)
attribute vec3 aIconC; // tint
uniform float uCommand;
varying vec2 vUv;
varying vec4 vB;
varying vec3 vTint;
void main() {
  vec4 mv = viewMatrix * vec4(aIconA.xyz, 1.0);
  float dist = -mv.z;
  // Command View keeps badges legible: never smaller than ~2.4% of view distance.
  float size = mix(aIconA.w, max(aIconA.w, dist * 0.024), uCommand);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 0.5 + 0.5;
  float fade = mix(1.0 - smoothstep(32.0, 40.0, dist), 1.0, uCommand);
  vB = vec4(aIconB.x, aIconB.y * fade, aIconB.z, aIconB.w);
  vTint = aIconC;
}
`;

const ICON_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
varying vec2 vUv;
varying vec4 vB;
varying vec3 vTint;
vec4 atlasCell(float cell, vec2 uv) {
  float cx = mod(cell, ${ATLAS_COLS}.0);
  float cy = floor(cell / ${ATLAS_COLS}.0);
  vec2 st = (vec2(cx, ${ATLAS_ROWS - 1}.0 - cy) + clamp(uv, 0.0, 1.0)) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
  return texture2D(uAtlas, st);
}
void main() {
  if (vB.y <= 0.004) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (vB.w > 0.5) {
    vec4 glow = atlasCell(${ICON_GLOW}.0, vUv);
    gl_FragColor = vec4(vTint * glow.a * vB.y * 1.6, 0.0);
  } else {
    float aa = fwidth(r) * 1.2;
    float disc = 1.0 - smoothstep(0.8 - aa, 0.8, r);
    float rim = smoothstep(0.82 - aa, 0.82, r) * (1.0 - smoothstep(0.98 - aa, 0.98, r));
    float ang = fract(atan(p.x + 1e-4, p.y) / 6.2832 + 1.0);
    float arcOn = step(ang, vB.z);
    float low = step(vB.z, 0.25) * (0.5 + 0.5 * sin(uTime * 9.0));
    vec3 rimCol = mix(vec3(0.16), vTint * (1.0 + low), arcOn);
    vec4 glyph = atlasCell(vB.x, (vUv - 0.5) * 1.3 + 0.5);
    vec3 col = vec3(0.03, 0.03, 0.05);
    col = mix(col, glyph.rgb, glyph.a * disc);
    col = mix(col, rimCol, rim);
    float a = max(disc * 0.86, rim);
    a *= vB.y;
    gl_FragColor = vec4(col * a, a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class StatusIcons {
  private readonly scene: THREE.Scene;
  private readonly batch: InstanceBatch;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly atlas: THREE.CanvasTexture;
  private readonly uniforms: { uTime: THREE.IUniform<number>; uCommand: THREE.IUniform<number> };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.scale(2, 2, 1);
    this.batch = new InstanceBatch(quad, ['aIconA', 'aIconB', 'aIconC'], [4, 4, 3], 256);
    quad.dispose();
    this.atlas = buildAtlas();
    this.uniforms = { uTime: { value: 0 }, uCommand: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: ICON_VERTEX,
      fragmentShader: ICON_FRAGMENT,
      uniforms: { uAtlas: { value: this.atlas }, ...this.uniforms },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // Premultiplied alpha: badges blend normally, glows (alpha 0) add.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.batch.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'actors-status-icons';
    scene.add(this.mesh);
  }

  begin(): void {
    this.batch.count = 0;
  }

  /** A status badge (`mode` 0) or additive glow sprite (`mode` 1). */
  push(x: number, y: number, z: number, size: number, cell: number, alpha: number, ring: number, tint: THREE.Color, mode: number): void {
    const i = this.batch.next();
    const attrs = this.batch.attrs;
    const a = attrs[0];
    const b = attrs[1];
    const c = attrs[2];
    a.array[i * 4] = x;
    a.array[i * 4 + 1] = y;
    a.array[i * 4 + 2] = z;
    a.array[i * 4 + 3] = size;
    b.array[i * 4] = cell;
    b.array[i * 4 + 1] = alpha;
    b.array[i * 4 + 2] = ring;
    b.array[i * 4 + 3] = mode;
    c.array[i * 3] = tint.r;
    c.array[i * 3 + 1] = tint.g;
    c.array[i * 3 + 2] = tint.b;
  }

  end(time: number, command: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCommand.value = command;
    this.batch.flush();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.batch.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }
}
