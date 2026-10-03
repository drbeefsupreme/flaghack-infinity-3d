/**
 * Off-screen pointers for the Training Burn's objective markers (Session.markers). RenderSurvey
 * draws each marker in the world. When a marker's anchor leaves the view, an arrow at the edge
 * of the HUD's free area points at it, labelled with the marker's name and its distance from
 * the vexillomancer. This runs every frame without allocating: anchors are projected with the
 * camera matrices directly, and each pointer's DOM is written only when a rounded value changes.
 */
import type { AppApi } from '../../game/app';
import type { ObjectiveMarker } from '../../game/session';
import { FLAG_YELLOW, LEVEL_HEIGHT } from '../../sim/constants';
import type { V3 } from '../../sim/math';
import type { EntityId } from '../../sim/types';
import type { World } from '../../sim/world';
import { el, html, setClass, show } from '../dom';

/**
 * Free area for arrows, as HUD design px from each edge. It keeps clear of the Hearth rail
 * (left), the minimap and Command View panels (right), the clock (top) and the action bar (bottom).
 */
const INSET_L = 282;
const INSET_R = 316;
const INSET_T = 112;
const INSET_B = 146;
/** Arrows in the top band within this half-width of centre drop below the mentor panel. */
const PANEL_HALF_W = 300;
const PANEL_BOTTOM = 286;
/** NDC extent that counts as on screen. A marker barely inside the edge still gets an arrow. */
const ON_SCREEN = 0.96;
/** Aim this far above the anchor's base (m), at the marker's body rather than its foot. */
const AIM_LIFT = 1;
const DEFAULT_LABEL = 'Objective';

const CHEVRON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5 17.5 12 7 19.5 9.6 12z" fill="currentColor" stroke="#1b1206" stroke-width="1.2" stroke-linejoin="round"/></svg>';

interface Pointer {
  node: HTMLElement;
  arrow: HTMLElement;
  label: HTMLElement;
  dist: HTMLElement;
  /** Last written values (DOM writes only on change). */
  x: number;
  y: number;
  deg: number;
  meters: number;
  color: number;
  text: string;
  low: boolean;
  /** -1 on the left edge, 1 on the right edge, 0 top/bottom: labels grow inward from the sides. */
  side: number;
}

/** World position of an entity (base + AIM_LIFT) into `out`; carried and stocked Flags follow their holder. */
function entityAt(w: World, id: EntityId, out: V3, depth: number): boolean {
  const av = w.avatars.get(id);
  if (av) {
    out.x = av.pos.x;
    out.y = av.pos.y + AIM_LIFT;
    out.z = av.pos.z;
    return true;
  }
  const fl = w.flags.get(id);
  if (fl) {
    if ((fl.state === 'carried' || fl.state === 'stock') && fl.holder >= 0 && depth === 0) return entityAt(w, fl.holder, out, 1);
    out.x = fl.pos.x;
    out.y = Math.max(0, fl.pos.y) + AIM_LIFT;
    out.z = fl.pos.z;
    return true;
  }
  const projectile = w.projectiles.get(id);
  if (projectile) {
    out.x = projectile.pos.x;
    out.y = projectile.pos.y;
    out.z = projectile.pos.z;
    return true;
  }
  const piece = w.pieces.get(id);
  if (piece) {
    const lat = w.lattice;
    const edge = piece.edge >= 0 ? lat.edges[piece.edge] : undefined;
    const facet = piece.facet >= 0 ? lat.facets[piece.facet] : undefined;
    if (edge) {
      out.x = (lat.nodes[edge.a].x + lat.nodes[edge.b].x) * 0.5;
      out.z = (lat.nodes[edge.a].z + lat.nodes[edge.b].z) * 0.5;
    } else if (facet) {
      out.x = facet.cx;
      out.z = facet.cz;
    } else return false;
    out.y = piece.level * LEVEL_HEIGHT + AIM_LIFT;
    return true;
  }
  const ground =
    w.hippies.get(id) ??
    w.buildings.get(id) ??
    w.piles.get(id) ??
    w.crystals.get(id) ??
    w.zones.get(id) ??
    w.pings.get(id) ??
    w.beacons.get(id);
  if (!ground) return false;
  out.x = ground.pos.x;
  out.y = AIM_LIFT;
  out.z = ground.pos.z;
  return true;
}

/** World position a marker points at, into `out`; false when its anchor cannot be found. */
function anchorAt(w: World, m: ObjectiveMarker, out: V3): boolean {
  switch (m.kind) {
    case 'node': {
      const n = m.node === undefined ? undefined : w.lattice.nodes[m.node];
      if (!n) return false;
      out.x = n.x;
      out.y = AIM_LIFT;
      out.z = n.z;
      return true;
    }
    case 'point':
    case 'area':
      if (!m.at) return false;
      out.x = m.at.x;
      out.y = AIM_LIFT;
      out.z = m.at.z;
      return true;
    case 'entity':
      return m.entity !== undefined && entityAt(w, m.entity, out, 0);
  }
}

export class OffscreenPointers {
  private layer: HTMLElement;
  private pool: Pointer[] = [];
  private at: V3 = { x: 0, y: 0, z: 0 };
  /** Layer size in HUD design px (the HUD is zoomed to fit the window). */
  private w = 1422;
  private h = 800;

  constructor(parent: HTMLElement) {
    this.layer = el('div', 'tb-ptrs', parent);
  }

  /** Refresh the layer size (10 Hz). `zoom` is the HUD's zoom factor. */
  measure(zoom: number): void {
    this.w = window.innerWidth / zoom;
    this.h = window.innerHeight / zoom;
  }

  /** Per frame. `active` false hides every pointer. */
  frame(app: AppApi, active: boolean): void {
    const world = app.world;
    let used = 0;
    if (active && world) {
      const cam = app.renderer.camera;
      const v = cam.matrixWorldInverse.elements;
      const pr = cam.projectionMatrix.elements;
      const fac = world.factions[app.session.playerFaction];
      const me = fac ? world.avatars.get(fac.avatarId) : undefined;
      const markers = app.session.markers;
      const p = this.at;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        if (!anchorAt(world, m, p)) continue;
        const vx = v[0] * p.x + v[4] * p.y + v[8] * p.z + v[12];
        const vy = v[1] * p.x + v[5] * p.y + v[9] * p.z + v[13];
        const vz = v[2] * p.x + v[6] * p.y + v[10] * p.z + v[14];
        const cx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12];
        const cy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13];
        const cw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
        if (cw > 0 && Math.abs(cx) <= cw * ON_SCREEN && Math.abs(cy) <= cw * ON_SCREEN) continue;
        // Undivided clip x/y point the right way both in front of and behind the camera (the
        // perspective divide by a negative w is what mirrors points behind it). Points behind
        // lean to the bottom edge: "turn around" reads better there than at a side.
        const dx = cx * this.w * 0.5;
        let dy = -cy * this.h * 0.5;
        if (cw <= 0) dy = Math.abs(dy) + this.h * 0.5;
        else if (Math.abs(dx) + Math.abs(dy) < 1e-6) dy = 1;
        const meters = me ? Math.round(Math.hypot(p.x - me.pos.x, p.z - me.pos.z)) : -1;
        const ptr = this.pool[used] ?? this.grow();
        used++;
        this.draw(ptr, m, dx, dy, meters);
      }
    }
    for (let i = used; i < this.pool.length; i++) show(this.pool[i].node, false);
  }

  private grow(): Pointer {
    const node = el('div', 'tb-ptr is-off', this.layer);
    const arrow = html('div', 'tb-ptr-arrow', CHEVRON, node);
    const tag = el('div', 'tb-ptr-tag', node);
    const label = el('span', 'tb-ptr-l', tag, DEFAULT_LABEL);
    const dist = el('span', 'tb-ptr-d num', tag, '');
    const ptr: Pointer = { node, arrow, label, dist, x: NaN, y: NaN, deg: NaN, meters: NaN, color: -1, text: DEFAULT_LABEL, low: false, side: 0 };
    this.pool.push(ptr);
    return ptr;
  }

  /** Put a pointer on the free-area rectangle along direction (dx, dy) from the screen centre. */
  private draw(ptr: Pointer, m: ObjectiveMarker, dx: number, dy: number, meters: number): void {
    const x0 = this.w * 0.5;
    const y0 = this.h * 0.5;
    const left = Math.min(x0 - 1, INSET_L);
    const right = Math.max(x0 + 1, this.w - INSET_R);
    const bottom = Math.max(y0 + 1, this.h - INSET_B);
    let tx = Infinity;
    if (dx > 0) tx = (right - x0) / dx;
    else if (dx < 0) tx = (left - x0) / dx;
    let t = tx;
    if (dy > 0) t = Math.min(tx, (bottom - y0) / dy);
    else if (dy < 0) {
      t = Math.min(tx, (Math.min(y0 - 1, INSET_T) - y0) / dy);
      // The mentor panel hangs under the clock: arrows that would land on it drop below it.
      if (y0 + dy * t < PANEL_BOTTOM && Math.abs(dx * t) < PANEL_HALF_W) t = Math.min(tx, (Math.min(y0 - 1, PANEL_BOTTOM) - y0) / dy);
    }
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    const deg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

    show(ptr.node, true);
    if (x !== ptr.x || y !== ptr.y) {
      ptr.x = x;
      ptr.y = y;
      ptr.node.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (deg !== ptr.deg) {
      ptr.deg = deg;
      ptr.arrow.style.transform = `rotate(${deg}deg)`;
    }
    // Labels sit under the arrow (above it near the bottom edge), growing inward from the sides.
    const low = y > y0 + (bottom - y0) * 0.5;
    if (low !== ptr.low) {
      ptr.low = low;
      setClass(ptr.node, 'low', low);
    }
    const side = x <= left + 1 ? -1 : x >= right - 1 ? 1 : 0;
    if (side !== ptr.side) {
      ptr.side = side;
      setClass(ptr.node, 'at-l', side < 0);
      setClass(ptr.node, 'at-r', side > 0);
    }
    const text = m.label ?? DEFAULT_LABEL;
    if (text !== ptr.text) {
      ptr.text = text;
      ptr.label.textContent = text;
    }
    if (meters !== ptr.meters) {
      ptr.meters = meters;
      ptr.dist.textContent = meters >= 0 ? `${meters} m` : '';
    }
    const color = m.color ?? FLAG_YELLOW;
    if (color !== ptr.color) {
      ptr.color = color;
      ptr.node.style.setProperty('--c', `#${color.toString(16).padStart(6, '0')}`);
    }
  }

  dispose(): void {
    this.layer.remove();
    this.pool.length = 0;
  }
}
