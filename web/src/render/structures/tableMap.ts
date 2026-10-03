/**
 * The Geomantic Command Center's tabletop: a live miniature map of the burn, redrawn about
 * four times a second from World state in an aged-parchment cartographic style: faint
 * lattice in sepia, faction-tinted Survey washes, tiny yellow Flag pins, RED ley lines
 * (every faction inks in red like the 2017 model, its own colour as a thin under-stroke),
 * Hearth sigils, GCC marks, Crystals, walls, and The Flag at the centre.
 *
 * One canvas serves every GCC table and is published as ctx.shared.gccTableTexture.
 * Frame (shared with the Command View dive in game/controls): the map square is
 * GCC_TABLE_MAP_SIZE metres wide, centred on the cart, lying GCC_TABLE_Y above the ground,
 * compass-true (north = world -z at the canvas top, east = +x), covering x/z in
 * [-MAP_HALF, MAP_HALF] edge to edge. It does not rotate with the cart.
 */
import * as THREE from 'three';
import { MAP_HALF } from '../../sim/constants';
import type { World } from '../../sim/world';
import { makeCanvas } from './canvasArt';
import type { Quality } from './kit';
import { seededRandom } from './util';

/** Height of the tabletop map surface above the GCC's ground position (m). */
export const GCC_TABLE_Y = 1.02;
/** Side of the (world-aligned) map square on the tabletop (m). */
export const GCC_TABLE_MAP_SIZE = 1.3;
/** The map is compass-true; it never turns with the cart. */
export const GCC_TABLE_MAP_YAW = 0;

const REDRAW_INTERVAL = 0.25;
const TAU = Math.PI * 2;
const INK = '#3b2410';
const RED_INK = '#b3121b';

export class TableMap {
  readonly texture: THREE.CanvasTexture;
  private readonly size: number;
  /** Pixels per metre. */
  private readonly k: number;
  private readonly g: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private readonly lattice: HTMLCanvasElement;
  private readonly latticeG: CanvasRenderingContext2D;
  private latticeVersion = -1;
  private acc = REDRAW_INTERVAL;
  /** Line-width unit (1 px at 1024). */
  private readonly lw: number;
  private readonly factionPaths: Path2D[] = [];

  constructor(world: World, quality: Quality, anisotropy: number) {
    this.size = quality === 'high' ? 1024 : quality === 'medium' ? 768 : 512;
    this.k = this.size / (MAP_HALF * 2);
    this.lw = this.size / 1024;
    const [canvas, g] = makeCanvas(this.size, this.size);
    this.g = g;
    [this.lattice, this.latticeG] = makeCanvas(this.size, this.size);
    this.bg = this.paintBackground(world);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    this.redraw(world, 0);
  }

  /** Redraw at ~4 Hz (and whenever the lattice turns). */
  update(dt: number, world: World, t: number): void {
    this.acc += dt;
    if (this.acc < REDRAW_INTERVAL && world.lattice.version === this.latticeVersion) return;
    this.acc = 0;
    this.redraw(world, t);
  }

  private px(x: number): number {
    return (x + MAP_HALF) * this.k;
  }

  private redraw(world: World, t: number): void {
    const g = this.g;
    const lat = world.lattice;
    const sv = world.survey;
    const lw = this.lw;
    if (lat.version !== this.latticeVersion) this.paintLattice(world);
    g.drawImage(this.bg, 0, 0);
    g.drawImage(this.lattice, 0, 0);

    // Survey washes: one path per faction, filled once (watercolour layering).
    for (let f = 0; f < 4; f++) this.factionPaths[f] = new Path2D();
    const crystal = new Path2D();
    for (const fc of lat.facets) {
      const mask = sv.facetSurvey[fc.id];
      if (mask === 0) continue;
      for (let f = 0; f < 4; f++) {
        if ((mask & (1 << f)) === 0) continue;
        this.facetPath(world, this.factionPaths[f], fc.nodes);
      }
      if (sv.facetCrystal[fc.id] >= 0) this.facetPath(world, crystal, fc.nodes);
    }
    for (let f = 0; f < 4; f++) {
      g.fillStyle = world.factions[f].css;
      g.globalAlpha = 0.3;
      g.fill(this.factionPaths[f]);
    }
    g.globalAlpha = 0.16;
    g.fillStyle = '#fff6d8';
    g.fill(crystal);
    g.globalAlpha = 1;

    // Ley lines: faction under-stroke, then red ink.
    const red = new Path2D();
    for (let f = 0; f < 4; f++) {
      const p = new Path2D();
      let any = false;
      for (const e of lat.edges) {
        if (sv.edgeLey[e.id] !== f) continue;
        const a = lat.nodes[e.a];
        const b = lat.nodes[e.b];
        p.moveTo(this.px(a.x) + lw, this.px(a.z) + lw);
        p.lineTo(this.px(b.x) + lw, this.px(b.z) + lw);
        red.moveTo(this.px(a.x), this.px(a.z));
        red.lineTo(this.px(b.x), this.px(b.z));
        any = true;
      }
      if (!any) continue;
      g.strokeStyle = world.factions[f].css;
      g.lineWidth = 4 * lw;
      g.lineCap = 'round';
      g.stroke(p);
    }
    g.strokeStyle = RED_INK;
    g.lineWidth = 2.3 * lw;
    g.stroke(red);

    // Walls: short dark ticks along their edges.
    const walls = new Path2D();
    for (const pc of world.pieces.values()) {
      if (pc.kind !== 'wall' || pc.edge < 0) continue;
      const e = lat.edges[pc.edge];
      const a = lat.nodes[e.a];
      const b = lat.nodes[e.b];
      walls.moveTo(this.px(a.x * 0.85 + b.x * 0.15), this.px(a.z * 0.85 + b.z * 0.15));
      walls.lineTo(this.px(a.x * 0.15 + b.x * 0.85), this.px(a.z * 0.15 + b.z * 0.85));
    }
    g.strokeStyle = 'rgba(60, 36, 16, 0.85)';
    g.lineWidth = 2.2 * lw;
    g.stroke(walls);

    // Implied Flags: faint hollow rings.
    const implied = new Path2D();
    for (let n = 0; n < lat.nodes.length; n++) {
      if (sv.impliedOwner[n] < 0 || sv.nodeFlagOwner[n] >= 0) continue;
      const node = lat.nodes[n];
      implied.moveTo(this.px(node.x) + 2 * lw, this.px(node.z));
      implied.arc(this.px(node.x), this.px(node.z), 2 * lw, 0, TAU);
    }
    g.strokeStyle = 'rgba(200, 150, 0, 0.75)';
    g.lineWidth = 1 * lw;
    g.stroke(implied);

    // Planted Flags: yellow pins with an ink outline and a tiny shadow.
    const pins = new Path2D();
    const shadows = new Path2D();
    for (let n = 0; n < lat.nodes.length; n++) {
      if (sv.nodeFlagOwner[n] < 0) continue;
      const node = lat.nodes[n];
      const x = this.px(node.x);
      const y = this.px(node.z);
      shadows.moveTo(x, y);
      shadows.lineTo(x + 4 * lw, y + 3 * lw);
      pins.moveTo(x + 3.6 * lw, y);
      pins.arc(x, y, 3.6 * lw, 0, TAU);
    }
    g.strokeStyle = 'rgba(40, 24, 8, 0.35)';
    g.lineWidth = 1.4 * lw;
    g.stroke(shadows);
    g.fillStyle = '#ffd400';
    g.fill(pins);
    g.strokeStyle = INK;
    g.lineWidth = 1.1 * lw;
    g.stroke(pins);

    // Crystals: pink/blue prisms.
    for (const c of world.crystals.values()) {
      const x = this.px(c.pos.x);
      const y = this.px(c.pos.z);
      const s = (4 + 3 * c.growth) * lw;
      g.beginPath();
      g.moveTo(x, y - s * 1.6);
      g.lineTo(x + s * 0.7, y);
      g.lineTo(x, y + s * 0.6);
      g.lineTo(x - s * 0.7, y);
      g.closePath();
      g.fillStyle = c.faction % 2 === 0 ? '#f59bd8' : '#8fd2ff';
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 0.8 * lw;
      g.stroke();
    }

    // Hearths and GCCs.
    for (const b of world.buildings.values()) {
      const x = this.px(b.pos.x);
      const y = this.px(b.pos.z);
      if (b.kind === 'hearth' && b.hearth) {
        const col = b.faction >= 0 ? world.factions[b.faction].css : '#d8d2c0';
        const stage = b.hearth.stage;
        if (stage === 'contained' || stage === 'contested' || stage === 'overwritten') {
          g.strokeStyle = RED_INK;
          g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
          g.lineWidth = 2 * lw;
          g.beginPath();
          g.arc(x, y, 13 * lw, 0, TAU);
          g.stroke();
          g.globalAlpha = 1;
        }
        this.sigil(x, y, 8.5 * lw, col);
        if (b.faction >= 0) {
          g.font = `700 ${Math.round(10 * lw)}px "Cinzel"`;
          g.textAlign = 'center';
          g.textBaseline = 'top';
          g.fillStyle = INK;
          g.fillText(world.factions[b.faction].name, x, y + 11 * lw);
        }
      } else if (b.kind === 'gcc' && b.gcc && b.gcc.destroyedUntil === 0) {
        g.beginPath();
        for (let i = 0; i <= 5; i++) {
          const a = -Math.PI / 2 + i * (TAU / 5);
          const r = 4 * lw;
          if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.fillStyle = '#111';
        g.fill();
        g.fillStyle = '#ffd400';
        g.beginPath();
        g.arc(x, y, 1.4 * lw, 0, TAU);
        g.fill();
      } else if (b.kind !== 'gcc') {
        g.fillStyle = 'rgba(60, 36, 16, 0.75)';
        g.fillRect(x - 2.5 * lw, y - 2.5 * lw, 5 * lw, 5 * lw);
      }
    }
    this.texture.needsUpdate = true;
  }

  private facetPath(world: World, p: Path2D, nodes: readonly number[]): void {
    const lat = world.lattice;
    const n0 = lat.nodes[nodes[0]];
    p.moveTo(this.px(n0.x), this.px(n0.z));
    for (let i = 1; i < 4; i++) {
      const n = lat.nodes[nodes[i]];
      p.lineTo(this.px(n.x), this.px(n.z));
    }
    p.closePath();
  }

  /** Hearth sigil: faction disc, ink ring, pentagram. */
  private sigil(x: number, y: number, r: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.4 * this.lw;
    g.stroke();
    g.beginPath();
    for (let k = 0; k <= 5; k++) {
      const a = -Math.PI / 2 + ((k * 2) % 5) * (TAU / 5);
      const px = x + Math.cos(a) * r * 0.78;
      const py = y + Math.sin(a) * r * 0.78;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.lineWidth = 1.1 * this.lw;
    g.stroke();
  }

  private paintLattice(world: World): void {
    const g = this.latticeG;
    const lat = world.lattice;
    g.clearRect(0, 0, this.size, this.size);
    const p = new Path2D();
    for (const e of lat.edges) {
      const a = lat.nodes[e.a];
      const b = lat.nodes[e.b];
      p.moveTo(this.px(a.x), this.px(a.z));
      p.lineTo(this.px(b.x), this.px(b.z));
    }
    g.strokeStyle = 'rgba(92, 58, 24, 0.22)';
    g.lineWidth = 0.7 * this.lw;
    g.stroke(p);
    this.latticeVersion = lat.version;
  }

  /** Parchment, stains, burnt edge, and the static burn: roads, pond, camps' props, The Flag. */
  private paintBackground(world: World): HTMLCanvasElement {
    const S = this.size;
    const lw = this.lw;
    const [c, g] = makeCanvas(S, S);
    const rnd = seededRandom(1423);
    g.fillStyle = '#e8d3a2';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = (20 + rnd() * 90) * lw;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.6;
      gr.addColorStop(0, dark ? `rgba(150, 100, 40, ${rnd() * 0.09})` : `rgba(255, 248, 225, ${rnd() * 0.12})`);
      gr.addColorStop(1, 'rgba(150, 100, 40, 0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 900; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const a = rnd() * TAU;
      const l = (2 + rnd() * 8) * lw;
      g.strokeStyle = `rgba(90, 60, 20, ${0.03 + rnd() * 0.05})`;
      g.lineWidth = 0.6 * lw;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    // Coffee rings.
    for (let i = 0; i < 3; i++) {
      const x = S * (0.2 + rnd() * 0.6);
      const y = S * (0.2 + rnd() * 0.6);
      const r = (30 + rnd() * 40) * lw;
      g.strokeStyle = `rgba(120, 70, 20, ${0.08 + rnd() * 0.07})`;
      g.lineWidth = (2 + rnd() * 3) * lw;
      g.beginPath();
      g.arc(x, y, r, rnd() * TAU, rnd() * TAU + Math.PI * 1.5);
      g.stroke();
    }

    // Roads: dashed double lines.
    for (const road of world.map.roads) {
      if (road.points.length < 2) continue;
      g.strokeStyle = 'rgba(150, 110, 60, 0.35)';
      g.lineWidth = Math.max(2, road.width * this.k);
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(this.px(road.points[0].x), this.px(road.points[0].z));
      for (const pt of road.points) g.lineTo(this.px(pt.x), this.px(pt.z));
      g.stroke();
      g.strokeStyle = 'rgba(90, 58, 24, 0.5)';
      g.lineWidth = 0.8 * lw;
      g.setLineDash([6 * lw, 5 * lw]);
      g.stroke();
      g.setLineDash([]);
    }
    // Water: blue-grey wash with shore hatching.
    for (const wtr of world.map.water) {
      g.fillStyle = 'rgba(90, 130, 150, 0.35)';
      g.beginPath();
      g.ellipse(this.px(wtr.x), this.px(wtr.z), wtr.rx * this.k, wtr.rz * this.k, 0, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(40, 70, 90, 0.5)';
      g.lineWidth = 1 * lw;
      for (let i = 1; i <= 3; i++) {
        g.beginPath();
        g.ellipse(this.px(wtr.x), this.px(wtr.z), wtr.rx * this.k * (1 - i * 0.18), wtr.rz * this.k * (1 - i * 0.18), 0, 0, TAU);
        g.stroke();
      }
    }
    // Props: tents as tiny triangles, domes as hatched circles, trees as washes.
    for (const o of world.map.obstacles) {
      const x = this.px(o.x);
      const y = this.px(o.z);
      const r = Math.max(1.5 * lw, (o.shape === 'circle' ? o.radius : Math.max(o.hx, o.hz)) * this.k);
      g.lineWidth = 0.8 * lw;
      if (o.kind === 'tree') {
        g.fillStyle = 'rgba(80, 110, 50, 0.3)';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      } else if (o.kind === 'dome') {
        g.strokeStyle = 'rgba(70, 44, 20, 0.55)';
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.moveTo(x - r, y);
        g.lineTo(x + r, y);
        g.moveTo(x, y - r);
        g.lineTo(x, y + r);
        g.stroke();
      } else if (o.kind === 'tent') {
        g.fillStyle = 'rgba(110, 70, 30, 0.35)';
        g.beginPath();
        g.moveTo(x, y - r);
        g.lineTo(x + r, y + r * 0.7);
        g.lineTo(x - r, y + r * 0.7);
        g.closePath();
        g.fill();
      } else if (o.kind !== 'effigy') {
        g.strokeStyle = 'rgba(70, 44, 20, 0.45)';
        g.strokeRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
      }
    }
    // Sound camps: dotted circles with names.
    for (const sc of world.map.soundCamps) {
      g.strokeStyle = 'rgba(110, 50, 90, 0.45)';
      g.setLineDash([2 * lw, 3 * lw]);
      g.lineWidth = 1 * lw;
      g.beginPath();
      g.arc(this.px(sc.x), this.px(sc.z), sc.radius * this.k, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(80, 40, 60, 0.7)';
      g.font = `italic 400 ${Math.round(9 * lw)}px "Cinzel"`;
      g.textAlign = 'center';
      g.fillText(sc.name, this.px(sc.x), this.px(sc.z) - sc.radius * this.k - 4 * lw);
    }
    // The Flag: a radiant glyph at the centre.
    const ex = this.px(world.map.effigy.x);
    const ey = this.px(world.map.effigy.z);
    g.strokeStyle = 'rgba(160, 90, 10, 0.35)';
    g.lineWidth = 1 * lw;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      g.beginPath();
      g.moveTo(ex + Math.cos(a) * 9 * lw, ey + Math.sin(a) * 9 * lw);
      g.lineTo(ex + Math.cos(a) * (i % 2 === 0 ? 22 : 15) * lw, ey + Math.sin(a) * (i % 2 === 0 ? 22 : 15) * lw);
      g.stroke();
    }
    g.strokeStyle = INK;
    g.lineWidth = 1.6 * lw;
    g.beginPath();
    g.moveTo(ex, ey + 6 * lw);
    g.lineTo(ex, ey - 16 * lw);
    g.stroke();
    g.fillStyle = '#ffcc00';
    g.beginPath();
    g.moveTo(ex, ey - 16 * lw);
    g.lineTo(ex + 13 * lw, ey - 13 * lw);
    g.lineTo(ex, ey - 8 * lw);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.font = `700 ${Math.round(9 * lw)}px "Cinzel"`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText('THE FLAG', ex, ey + 9 * lw);

    // Title cartouche (north) and compass rose (south), inside the visible circle.
    g.font = `700 ${Math.round(18 * lw)}px "Cinzel"`;
    g.textBaseline = 'middle';
    g.fillStyle = INK;
    g.fillText('SURVEY OF THE BURN', S / 2, S * 0.09);
    g.font = `400 ${Math.round(10 * lw)}px "Cinzel"`;
    g.fillText('Geomantic Command Center \u00b7 Flag Simulacra & Ley', S / 2, S * 0.09 + 17 * lw);
    this.compass(g, S / 2, S * 0.9, 20 * lw);

    // Burnt, darkened rim.
    const vig = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.72);
    vig.addColorStop(0, 'rgba(90, 50, 10, 0)');
    vig.addColorStop(0.75, 'rgba(90, 50, 10, 0.18)');
    vig.addColorStop(1, 'rgba(50, 25, 5, 0.65)');
    g.fillStyle = vig;
    g.fillRect(0, 0, S, S);
    return c;
  }

  private compass(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    g.save();
    g.translate(x, y);
    g.strokeStyle = INK;
    g.lineWidth = 0.8 * this.lw;
    g.beginPath();
    g.arc(0, 0, r * 0.75, 0, TAU);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r * 0.18, 0);
      g.lineTo(0, r * 0.12);
      g.lineTo(-r * 0.18, 0);
      g.closePath();
      g.fillStyle = i === 3 ? RED_INK : INK;
      g.fill();
    }
    g.fillStyle = INK;
    g.font = `700 ${Math.round(r * 0.45)}px "Cinzel"`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText('N', 0, -r - 1);
    g.restore();
  }

  dispose(): void {
    this.texture.dispose();
  }
}
