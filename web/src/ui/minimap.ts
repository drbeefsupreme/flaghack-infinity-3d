/**
 * D.E.G.E.N. minimap (top-right): the whole burn inside a pentagonal brass frame. Three
 * canvas layers: a base (ground, roads, water, obstacles, Ley Lattice; redrawn when the
 * Crystal turns), a Survey layer (faction facets, Ley Lines, Flags, implied Flags; redrawn when
 * survey.version changes) and a live layer drawn at <= 15 Hz (instability, plans, Crystals,
 * Hearths with stage rings, buildings, own Signifiers coloured by status, rivals only while
 * their mesh is tapped or Acid Cop Vision runs, pings, feed flashes, player arrow and view
 * cone, Command View camera box, drug side effects). Screen up is world -z.
 */
import { MAP_HALF } from '../sim/constants';
import type { GameEvent } from '../sim/events';
import type { V2 } from '../sim/math';
import type { CaptureStage, FactionState, PingKind } from '../sim/types';
import type { World } from '../sim/world';
import { STATUS_INFO, TONE_COLOR } from './catalog';
import type { UiHost, UiPart } from './core';
import { button, el, fmtCountdown, setClass, setText, show } from './dom';

/** Canvas CSS size; the frame SVG adds a margin for the brass rim and vertex pennants. */
const MAP_PX = 248;
/** Room for the brass rim and the vertex pennants (they reach ~20 px past the rim). */
const MARGIN = 22;
const FRAME_W = MAP_PX + MARGIN * 2;
/** Vertex-up regular pentagon fitted to the canvas width. */
const PENT_R = MAP_PX / (2 * Math.sin((72 * Math.PI) / 180));
const PENT_TOP = (MAP_PX - PENT_R * (1 + Math.cos(Math.PI / 5))) / 2;
const PENT_CX = MAP_PX / 2;
const PENT_CY = PENT_TOP + PENT_R;
/** World half-extent maps to this fraction of the circumradius: the four camps sit inside the rim. */
const MAP_SCALE = 0.8;
const FRAME_H = Math.ceil(PENT_CY + PENT_R * Math.cos(Math.PI / 5)) + MARGIN * 2 + 6;

const STAGE_COLOR: Record<CaptureStage, string> = {
  safe: '#5fe3a1',
  threatened: '#ffc94a',
  contested: '#ff5fd2',
  contained: '#ff7a3d',
  overwritten: '#ff2b2b',
  captured: '#8a8580',
};

const PING_COLOR: Record<PingKind, string> = {
  rally: '#e9fbff',
  attack: '#ff4058',
  flag: '#ffd400',
  sos: '#ff2b2b',
  shot: '#ff7ad9',
};

interface Flash {
  x: number;
  z: number;
  color: string;
  at: number;
}

function pentagonPoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function frameSvg(): string {
  const cx = PENT_CX + MARGIN;
  const cy = PENT_CY + MARGIN;
  const outer = pentagonPoints(cx, cy, PENT_R + 3)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const inner = pentagonPoints(cx, cy, PENT_R - 3)
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  let pennants = '';
  pentagonPoints(cx, cy, PENT_R + 3).forEach(([x, y], i) => {
    const deg = -90 + i * 72 + 90;
    pennants +=
      `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg})">` +
      `<path d="M0 -2 V-17" stroke="#3a250b" stroke-width="3.2" stroke-linecap="round"/>` +
      `<path d="M0 -2 V-17" stroke="#d9a94e" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M0.6 -17 L11 -14 L0.6 -10.6 Z" fill="#ffd400" stroke="#6b4a10" stroke-width=".8" stroke-linejoin="round"/>` +
      `<circle r="4.2" fill="url(#mmBrass)" stroke="#2a1906" stroke-width="1"/><circle r="1.6" fill="#ffe680"/></g>`;
  });
  return (
    `<svg class="mm-frame" viewBox="0 0 ${FRAME_W} ${FRAME_H}" aria-hidden="true">` +
    `<defs><linearGradient id="mmBrass" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#f6dc95"/><stop offset=".45" stop-color="#c08f3a"/><stop offset="1" stop-color="#5e3d12"/></linearGradient></defs>` +
    `<polygon points="${outer}" fill="none" stroke="#1a0f05" stroke-width="10" stroke-linejoin="round"/>` +
    `<polygon points="${outer}" fill="none" stroke="url(#mmBrass)" stroke-width="6" stroke-linejoin="round"/>` +
    `<polygon points="${inner}" fill="none" stroke="#f3d27a" stroke-opacity=".45" stroke-width="1"/>` +
    pennants +
    `</svg>`
  );
}

export class Minimap implements UiPart {
  private host: UiHost;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private base = document.createElement('canvas');
  private survey = document.createElement('canvas');
  private px = 0;
  private needsResize = true;
  private baseDirty = true;
  private surveyVersion = -1;
  private flashes: Flash[] = [];
  private mesh: HTMLElement;
  private taps: HTMLElement;
  private tapText = '';
  private dragging = false;
  private onResize = (): void => {
    this.needsResize = true;
  };

  constructor(host: UiHost, parent: HTMLElement) {
    this.host = host;
    this.root = el('div', 'mm', parent);
    const frame = el('div', 'mm-box', this.root);
    frame.style.width = `${FRAME_W}px`;
    frame.style.height = `${FRAME_H}px`;
    this.canvas = el('canvas', 'mm-canvas', frame);
    this.canvas.style.left = `${MARGIN}px`;
    this.canvas.style.top = `${MARGIN}px`;
    this.canvas.style.width = `${MAP_PX}px`;
    this.canvas.style.height = `${MAP_PX}px`;
    frame.insertAdjacentHTML('beforeend', frameSvg());
    this.ctx = this.canvas.getContext('2d');

    const plaque = el('div', 'mm-plaque', this.root);
    el('span', 'mm-title', plaque, 'D.E.G.E.N.');
    this.mesh = el('span', 'mm-mesh num', plaque, '');
    button('mm-roster btn btn-tiny', plaque, 'Roster', () => {
      const s = this.host.app.session;
      s.panels.degen = !s.panels.degen;
    });
    this.taps = el('div', 'mm-taps is-off', this.root);

    this.canvas.addEventListener('pointerdown', (ev) => {
      if (this.host.app.session.view !== 'command') return;
      this.dragging = true;
      this.canvas.setPointerCapture(ev.pointerId);
      this.recentre(ev);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (this.dragging) this.recentre(ev);
    });
    this.canvas.addEventListener('pointerup', (ev) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(ev.pointerId);
    });
    window.addEventListener('resize', this.onResize);
  }

  /** Point the Command View camera at the clicked spot (Command View only). */
  private recentre(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const u = ((ev.clientX - rect.left) / rect.width) * MAP_PX;
    const v = ((ev.clientY - rect.top) / rect.height) * MAP_PX;
    const k = (PENT_R * MAP_SCALE) / MAP_HALF;
    const cam = this.host.app.session.camera;
    cam.cmdX = Math.max(-MAP_HALF, Math.min(MAP_HALF, (u - PENT_CX) / k));
    cam.cmdZ = Math.max(-MAP_HALF, Math.min(MAP_HALF, (v - PENT_CY) / k));
  }

  flash(pos: V2, color: string): void {
    if (this.flashes.length >= 10) this.flashes.shift();
    this.flashes.push({ x: pos.x, z: pos.z, color, at: performance.now() });
  }

  reset(_world: World): void {
    this.baseDirty = true;
    this.surveyVersion = -1;
    this.flashes.length = 0;
  }

  onEvent(e: GameEvent): void {
    // The lattice moved: the base layer's Ley lines are stale.
    if (e.t === 'phasonFlip' || e.t === 'tide') this.baseDirty = true;
  }

  /** 10 Hz: visibility, interactivity and the mesh plaque text. */
  update(world: World | null, _now: number): void {
    const s = this.host.app.session;
    const visible = s.screen !== 'title' && world !== null;
    show(this.root, visible);
    if (!visible || !world) return;
    setClass(this.root, 'ix', s.view === 'command' || !s.pointerLocked);
    setClass(this.root, 'cmd', s.view === 'command');
    const P = s.playerFaction;
    let beacons = 0;
    for (const h of world.hippies.values()) if (h.faction === P && h.beacon) beacons++;
    setText(this.mesh, `${beacons} beacons`);
    const fac = world.factions[P];
    let taps = '';
    if (fac) {
      const acid = fac.drugActive.acidcop > world.time;
      for (const r of world.factions) {
        if (r.id === P) continue;
        const until = fac.meshTap[r.id] ?? 0;
        if (until > world.time) taps += `${taps ? ' · ' : ''}${r.name.split(' ').pop() ?? r.name} ${fmtCountdown(until - world.time)}`;
      }
      if (acid) taps = `Acid Cop Vision ${fmtCountdown(fac.drugActive.acidcop - world.time)}${taps ? ' · ' + taps : ''}`;
    }
    if (taps !== this.tapText) {
      this.tapText = taps;
      setText(this.taps, taps ? `Mesh tap: ${taps}` : '');
    }
    show(this.taps, taps !== '');
  }

  /** <= 15 Hz canvas redraw (called by the orchestrator on its own clock). */
  draw(world: World | null, now: number): void {
    const ctx = this.ctx;
    const s = this.host.app.session;
    if (!ctx || !world || s.screen === 'title') return;
    if (this.needsResize) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0) return;
      const px = Math.max(64, Math.round(rect.width * (window.devicePixelRatio || 1)));
      this.needsResize = false;
      if (px !== this.px) {
        this.px = px;
        for (const c of [this.canvas, this.base, this.survey]) {
          c.width = px;
          c.height = px;
        }
        this.baseDirty = true;
        this.surveyVersion = -1;
      }
    }
    if (this.px === 0) return;
    if (this.baseDirty) {
      this.drawBase(world);
      this.baseDirty = false;
    }
    if (world.survey.version !== this.surveyVersion) {
      this.drawSurvey(world);
      this.surveyVersion = world.survey.version;
    }
    this.drawLive(ctx, world, now);
  }

  // ── Layers ────────────────────────────────────────────────────────────────

  private get unit(): number {
    return this.px / MAP_PX;
  }

  private sx(x: number): number {
    return (PENT_CX + (x / MAP_HALF) * PENT_R * MAP_SCALE) * this.unit;
  }

  private sy(z: number): number {
    return (PENT_CY + (z / MAP_HALF) * PENT_R * MAP_SCALE) * this.unit;
  }

  private clipPentagon(ctx: CanvasRenderingContext2D): void {
    const u = this.unit;
    ctx.beginPath();
    pentagonPoints(PENT_CX * u, PENT_CY * u, PENT_R * u).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.clip();
  }

  private drawBase(world: World): void {
    const ctx = this.base.getContext('2d');
    if (!ctx) return;
    const u = this.unit;
    const px = this.px;
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    this.clipPentagon(ctx);
    const g = ctx.createRadialGradient(PENT_CX * u, PENT_CY * u, 0, PENT_CX * u, PENT_CY * u, PENT_R * u);
    g.addColorStop(0, '#2c3d27');
    g.addColorStop(1, '#111b10');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, px, px);

    const map = world.map;
    const k = (PENT_R * MAP_SCALE * u) / MAP_HALF;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(176, 148, 98, 0.35)';
    for (const road of map.roads) {
      if (road.points.length < 2) continue;
      ctx.lineWidth = Math.max(1, road.width * k);
      ctx.beginPath();
      road.points.forEach((p, i) => (i === 0 ? ctx.moveTo(this.sx(p.x), this.sy(p.z)) : ctx.lineTo(this.sx(p.x), this.sy(p.z))));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(44, 112, 158, 0.75)';
    for (const w of map.water) {
      ctx.beginPath();
      ctx.ellipse(this.sx(w.x), this.sy(w.z), w.rx * k, w.rz * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(8, 10, 8, 0.55)';
    for (const o of map.obstacles) {
      if (o.kind === 'effigy') continue;
      const r = Math.max(0.6 * u, (o.shape === 'circle' ? o.radius : Math.max(o.hx, o.hz)) * k);
      ctx.beginPath();
      ctx.arc(this.sx(o.x), this.sy(o.z), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 122, 217, 0.35)';
    ctx.lineWidth = 1 * u;
    for (const sc of map.soundCamps) {
      ctx.beginPath();
      ctx.arc(this.sx(sc.x), this.sy(sc.z), sc.radius * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The Ley Lattice: faint, so Surveys read on top of it.
    const lat = world.lattice;
    ctx.strokeStyle = 'rgba(214, 236, 255, 0.11)';
    ctx.lineWidth = 0.6 * u;
    ctx.beginPath();
    for (const e of lat.edges) {
      const a = lat.nodes[e.a];
      const b = lat.nodes[e.b];
      ctx.moveTo(this.sx(a.x), this.sy(a.z));
      ctx.lineTo(this.sx(b.x), this.sy(b.z));
    }
    ctx.stroke();

    // The Flag effigy on the Omega Node.
    const ex = this.sx(map.effigy.x);
    const ey = this.sy(map.effigy.z);
    ctx.strokeStyle = '#d9b26a';
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(ex, ey + 4 * u);
    ctx.lineTo(ex, ey - 6 * u);
    ctx.stroke();
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.moveTo(ex, ey - 6 * u);
    ctx.lineTo(ex + 6 * u, ey - 4 * u);
    ctx.lineTo(ex, ey - 1.5 * u);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawSurvey(world: World): void {
    const ctx = this.survey.getContext('2d');
    if (!ctx) return;
    const u = this.unit;
    ctx.clearRect(0, 0, this.px, this.px);
    const lat = world.lattice;
    const sv = world.survey;
    ctx.lineJoin = 'round';
    for (const f of world.factions) {
      const bit = 1 << f.id;
      ctx.beginPath();
      let any = false;
      for (const fc of lat.facets) {
        if ((sv.facetSurvey[fc.id] & bit) === 0) continue;
        any = true;
        const n = fc.nodes;
        ctx.moveTo(this.sx(lat.nodes[n[0]].x), this.sy(lat.nodes[n[0]].z));
        ctx.lineTo(this.sx(lat.nodes[n[1]].x), this.sy(lat.nodes[n[1]].z));
        ctx.lineTo(this.sx(lat.nodes[n[2]].x), this.sy(lat.nodes[n[2]].z));
        ctx.lineTo(this.sx(lat.nodes[n[3]].x), this.sy(lat.nodes[n[3]].z));
        ctx.closePath();
      }
      if (!any) continue;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = f.css;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5 * u;
    for (const f of world.factions) {
      ctx.beginPath();
      let any = false;
      for (const e of lat.edges) {
        if (sv.edgeLey[e.id] !== f.id) continue;
        any = true;
        const a = lat.nodes[e.a];
        const b = lat.nodes[e.b];
        ctx.moveTo(this.sx(a.x), this.sy(a.z));
        ctx.lineTo(this.sx(b.x), this.sy(b.z));
      }
      if (!any) continue;
      ctx.strokeStyle = f.css;
      ctx.stroke();
    }
    // Implied Flags: hollow yellow rings. Real Flags: yellow pins with a faction ribbon ring.
    ctx.lineWidth = 0.9 * u;
    ctx.strokeStyle = 'rgba(255, 212, 0, 0.7)';
    ctx.beginPath();
    for (const n of lat.nodes) {
      if (sv.impliedOwner[n.id] < 0 || sv.nodeFlag[n.id] >= 0) continue;
      const x = this.sx(n.x);
      const y = this.sy(n.z);
      ctx.moveTo(x + 1.6 * u, y);
      ctx.arc(x, y, 1.6 * u, 0, Math.PI * 2);
    }
    ctx.stroke();
    for (const f of world.factions) {
      ctx.beginPath();
      let any = false;
      for (const n of lat.nodes) {
        if (sv.nodeFlagOwner[n.id] !== f.id) continue;
        any = true;
        const x = this.sx(n.x);
        const y = this.sy(n.z);
        ctx.moveTo(x + 2.4 * u, y);
        ctx.arc(x, y, 2.4 * u, 0, Math.PI * 2);
      }
      if (!any) continue;
      ctx.fillStyle = f.css;
      ctx.fill();
    }
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    for (const n of lat.nodes) {
      if (sv.nodeFlag[n.id] < 0) continue;
      const x = this.sx(n.x);
      const y = this.sy(n.z);
      ctx.moveTo(x + 1.5 * u, y);
      ctx.arc(x, y, 1.5 * u, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  private drawLive(ctx: CanvasRenderingContext2D, world: World, now: number): void {
    const s = this.host.app.session;
    const P = s.playerFaction;
    const fac = world.factions[P];
    const u = this.unit;
    const t = world.time;
    const px = this.px;
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    this.clipPentagon(ctx);
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.survey, 0, 0);

    // Interference shimmer on overlapped facets.
    const lat = world.lattice;
    const sv = world.survey;
    const shimmer = 0.5 + 0.5 * Math.sin(now / 160);
    for (const fc of lat.facets) {
      const inst = sv.facetInstability[fc.id];
      if (inst < 0.35) continue;
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.12 + 0.35 * inst * shimmer).toFixed(3)})`;
      ctx.beginPath();
      const n = fc.nodes;
      ctx.moveTo(this.sx(lat.nodes[n[0]].x), this.sy(lat.nodes[n[0]].z));
      for (let i = 1; i < 4; i++) ctx.lineTo(this.sx(lat.nodes[n[i]].x), this.sy(lat.nodes[n[i]].z));
      ctx.closePath();
      ctx.fill();
    }

    const acid = !!fac && fac.drugActive.acidcop > t;
    const sees = (r: FactionState): boolean => r.id === P || acid || (fac?.meshTap[r.id] ?? 0) > t;

    // Survey plans: own always, rivals' while their mesh is visible.
    ctx.setLineDash([2 * u, 2 * u]);
    ctx.lineWidth = 1 * u;
    for (const f of world.factions) {
      if (f.plan.size === 0 || !sees(f)) continue;
      ctx.strokeStyle = f.id === P ? 'rgba(255, 230, 120, 0.9)' : f.css;
      ctx.beginPath();
      for (const node of f.plan) {
        const n = lat.nodes[node];
        if (!n || sv.nodeFlagOwner[node] === f.id) continue;
        const x = this.sx(n.x);
        const y = this.sy(n.z);
        ctx.moveTo(x + 2.4 * u, y);
        ctx.arc(x, y, 2.4 * u, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Crystals: pink/blue prisms (2017 homage).
    for (const c of world.crystals.values()) {
      const x = this.sx(c.pos.x);
      const y = this.sy(c.pos.z);
      const r = (3 + 2.5 * c.growth) * u;
      ctx.fillStyle = 'rgba(255, 140, 230, 0.35)';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.faction === P ? '#9ff3ff' : '#ff9be6';
      ctx.strokeStyle = world.factions[c.faction]?.css ?? '#fff';
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.6, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.6, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Buildings (physical, visible to everyone); Hearths get a stage ring.
    const pulse = 0.5 + 0.5 * Math.sin(now / 140);
    for (const b of world.buildings.values()) {
      const x = this.sx(b.pos.x);
      const y = this.sy(b.pos.z);
      const color = b.faction === -1 ? '#cfc8b6' : (world.factions[b.faction]?.css ?? '#cfc8b6');
      if (b.kind === 'hearth' && b.hearth) {
        const stage = b.hearth.stage;
        const hot = stage === 'contained' || stage === 'overwritten' || stage === 'contested';
        ctx.lineWidth = (hot ? 2.2 + 1.6 * pulse : 2) * u;
        ctx.strokeStyle = STAGE_COLOR[stage];
        ctx.beginPath();
        ctx.arc(x, y, (hot ? 7.5 + 2 * pulse : 7) * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeStyle = '#120b04';
        ctx.lineWidth = 1.2 * u;
        ctx.beginPath();
        ctx.arc(x, y, 4.4 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffd400';
        ctx.beginPath();
        ctx.arc(x, y, 1.6 * u, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === 'gcc') {
        if (b.gcc && b.gcc.destroyedUntil > t) continue;
        ctx.fillStyle = '#111';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3 * u;
        ctx.beginPath();
        pentagonPoints(x, y, 3.6 * u).forEach(([px2, py2], i) => (i === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const r = 2.6 * u;
        ctx.globalAlpha = b.disabled || b.built < 1 ? 0.5 : 1;
        ctx.fillStyle = color;
        ctx.strokeStyle = '#120b04';
        ctx.lineWidth = 1 * u;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
      }
    }

    // Signifiers: own by status (the D.E.G.E.N. mesh), rivals only when tapped / Acid Cop Vision.
    for (const h of world.hippies.values()) {
      if (h.faction === -1) continue;
      const own = h.faction === P;
      const owner = world.factions[h.faction];
      if (!owner || (!own && !sees(owner))) continue;
      if (own && !h.beacon) continue;
      const x = this.sx(h.pos.x);
      const y = this.sy(h.pos.z);
      ctx.fillStyle = own ? TONE_COLOR[STATUS_INFO[h.status].tone] : owner.css;
      ctx.strokeStyle = own ? '#06121a' : '#000';
      ctx.lineWidth = 0.9 * u;
      ctx.beginPath();
      ctx.arc(x, y, (own ? 2.1 : 1.8) * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Rival vexillomancers through walls (Acid Cop Vision only).
    if (acid) {
      for (const f of world.factions) {
        if (f.id === P || !f.alive) continue;
        const av = world.avatars.get(f.avatarId);
        if (av) this.drawArrow(ctx, av.pos.x, av.pos.z, av.yaw, f.css, 4.2);
      }
      this.drawPhantoms(ctx, world, now);
    }

    // Pings (own faction).
    for (const p of world.pings.values()) {
      if (p.faction !== P || p.until <= t) continue;
      const age = (t - p.bornAt) % 1.4;
      const x = this.sx(p.pos.x);
      const y = this.sy(p.pos.z);
      ctx.strokeStyle = PING_COLOR[p.kind];
      ctx.lineWidth = 1.6 * u;
      ctx.globalAlpha = 1 - age / 1.4;
      ctx.beginPath();
      ctx.arc(x, y, (3 + age * 9) * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = PING_COLOR[p.kind];
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    // Feed flashes.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const age = (now - f.at) / 2500;
      if (age >= 1) {
        this.flashes.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - age;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(this.sx(f.x), this.sy(f.z), (4 + age * 16) * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Command View camera footprint.
    if (s.view === 'command') {
      const cam = s.camera;
      const halfZ = cam.cmdHeight * 0.55;
      const halfX = halfZ * 1.7;
      const x0 = this.sx(cam.cmdX - halfX);
      const x1 = this.sx(cam.cmdX + halfX);
      const y0 = this.sy(cam.cmdZ - halfZ);
      const y1 = this.sy(cam.cmdZ + halfZ);
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.85)';
      ctx.lineWidth = 1.2 * u;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }

    // The player's vexillomancer: arrow + view cone.
    if (fac) {
      const av = world.avatars.get(fac.avatarId);
      if (av && av.koUntil <= t) {
        const x = this.sx(av.pos.x);
        const y = this.sy(av.pos.z);
        const dx = Math.sin(av.yaw);
        const dy = Math.cos(av.yaw);
        const cone = ctx.createRadialGradient(x, y, 0, x, y, 30 * u);
        cone.addColorStop(0, 'rgba(255, 244, 200, 0.35)');
        cone.addColorStop(1, 'rgba(255, 244, 200, 0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const half = 0.55;
        const a = Math.atan2(dy, dx);
        ctx.arc(x, y, 30 * u, a - half, a + half);
        ctx.closePath();
        ctx.fill();
        this.drawArrow(ctx, av.pos.x, av.pos.z, av.yaw, '#ffffff', 6.5);
      }
    }

    // Luminous Dust side effect: static on the mesh.
    if (fac && fac.drugActive.dust > t) this.drawNoise(ctx, now);
    ctx.restore();
  }

  private drawArrow(ctx: CanvasRenderingContext2D, wx: number, wz: number, yaw: number, color: string, size: number): void {
    const u = this.unit;
    const x = this.sx(wx);
    const y = this.sy(wz);
    const dx = Math.sin(yaw);
    const dy = Math.cos(yaw);
    const r = size * u;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0b0703';
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(x + dx * r, y + dy * r);
    ctx.lineTo(x - dx * r * 0.7 - dy * r * 0.65, y - dy * r * 0.7 + dx * r * 0.65);
    ctx.lineTo(x - dx * r * 0.35, y - dy * r * 0.35);
    ctx.lineTo(x - dx * r * 0.7 + dy * r * 0.65, y - dy * r * 0.7 - dx * r * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** Acid Cop paranoia: pursuers that are not there, circling closer to you. */
  private drawPhantoms(ctx: CanvasRenderingContext2D, world: World, now: number): void {
    const fac = world.factions[this.host.app.session.playerFaction];
    const av = fac ? world.avatars.get(fac.avatarId) : undefined;
    if (!av) return;
    const u = this.unit;
    const tt = now / 1000;
    for (let i = 0; i < 3; i++) {
      const a = tt * (0.35 + i * 0.11) + i * 2.1;
      const d = 18 + 9 * Math.sin(tt * 0.7 + i * 1.7);
      const x = this.sx(av.pos.x + Math.cos(a) * d);
      const y = this.sy(av.pos.z + Math.sin(a) * d);
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(tt * 3 + i);
      ctx.fillStyle = '#ff2b4f';
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawNoise(ctx: CanvasRenderingContext2D, now: number): void {
    const px = this.px;
    let seed = Math.floor(now / 66) * 2654435761;
    ctx.fillStyle = 'rgba(255, 245, 190, 0.5)';
    for (let i = 0; i < 140; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const x = (seed % 10007) / 10007;
      seed = (seed * 1103515245 + 12345) >>> 0;
      const y = (seed % 10009) / 10009;
      ctx.fillRect(x * px, y * px, 1.5 * this.unit, 1.5 * this.unit);
    }
    seed = (seed * 1103515245 + 12345) >>> 0;
    ctx.fillStyle = `rgba(${120 + (seed % 120)}, 255, 230, 0.06)`;
    ctx.fillRect(0, ((seed >>> 8) % px) | 0, px, 3 * this.unit);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
