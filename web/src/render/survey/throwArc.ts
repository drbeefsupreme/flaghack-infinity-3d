/**
 * Throw aim: a dotted glowing arc flowing along session.aim.arc toward the landing point, a
 * landing reticle the size of the auto-plant snap radius, and when the throw will plant: the
 * target node ring, a ghost Flag on it and dashed previews of the Ley Lines it would light
 * to neighbours the player already holds. Also the brief Command View order acknowledgement
 * (session.orderMarker).
 */
import * as THREE from 'three';
import type { OrderMarker, Session } from '../../game/session';
import { AVATAR, FLAG_YELLOW } from '../../sim/constants';
import type { World } from '../../sim/world';
import { BEAM } from './beams';
import type { BeamLayer } from './beams';
import { DECAL } from './decals';
import type { DecalLayer } from './decals';
import { GHOST } from './ghostFlags';
import type { GhostFlagLayer } from './ghostFlags';
import { BEAM_Y } from './glsl';
import { SPRITE } from './sprites';
import type { SpriteLayer } from './sprites';

const DOT_SPACING = 0.6;
const MAX_DOTS = 96;
const ORDER_MARKER_MS = 800;
/** Order kinds tinted by intent (attack red, pull/plan gold, others the player colour). */
const ORDER_TINT: Partial<Record<OrderMarker['kind'], number>> = {
  attack: 0xff4a3a,
  pull: 0xffd400,
  plant: 0xffd400,
  plan: 0xffe27a,
};

export class AimFeature {
  private readonly world: World;
  private readonly session: Session;
  private readonly yellow = new THREE.Color(FLAG_YELLOW);
  private readonly dotColor = new THREE.Color();
  private readonly player = new THREE.Color();
  private readonly hot = new THREE.Color(1.0, 0.97, 0.85);

  constructor(world: World, session: Session) {
    this.world = world;
    this.session = session;
  }

  update(now: number, sprites: SpriteLayer, decals: DecalLayer, beams: BeamLayer, ghosts: GhostFlagLayer): void {
    const w = this.world;
    const s = this.session;
    this.player.setHex(w.factions[s.playerFaction].color);
    this.drawOrderMarker(decals);

    const aim = s.aim;
    if (!aim.active || aim.arc.length < 2) return;
    const arc = aim.arc;
    let total = 0;
    for (let i = 1; i < arc.length; i++) {
      total += Math.hypot(arc[i].x - arc[i - 1].x, arc[i].y - arc[i - 1].y, arc[i].z - arc[i - 1].z);
    }
    // Dots march toward the landing point.
    let next = (now * 1.6) % DOT_SPACING;
    let walked = 0;
    let dots = 0;
    for (let i = 1; i < arc.length && dots < MAX_DOTS; i++) {
      const a = arc[i - 1];
      const b = arc[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      while (next <= walked + len && dots < MAX_DOTS) {
        const t = len > 0 ? (next - walked) / len : 0;
        const u = total > 0 ? next / total : 0;
        this.dotColor.copy(this.yellow).lerp(this.hot, u * 0.6);
        sprites.push(
          SPRITE.dot,
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          a.z + (b.z - a.z) * t,
          0.06 + u * 0.05,
          this.dotColor,
          0.55 + u * 0.45,
          0,
          0,
          2.5,
        );
        dots++;
        next += DOT_SPACING;
      }
      walked += len;
    }

    const land = aim.landing;
    const node = aim.node;
    if (land) decals.push(DECAL.target, land.x, land.z, AVATAR.throwSnapRadius, now * 0.4, node >= 0 ? this.yellow : this.hot, 0.9, 0.7, node >= 0 ? 1 : 0);
    if (node < 0 || node >= w.lattice.nodes.length) return;
    decals.push(DECAL.node, 0, 0, 1.6, 0, this.player, 1, 0.7, 0, 0, 0, node);
    ghosts.push(GHOST.aim, node, 0, 0, 0.6, this.yellow, 0.75, 0.3);
    const lat = w.lattice;
    const holder = w.survey.holder;
    const edges = lat.nodes[node].edges;
    for (let i = 0; i < edges.length; i++) {
      const m = lat.other(edges[i], node);
      if (holder[m] !== s.playerFaction) continue;
      beams.push(BEAM.dash, 0, BEAM_Y, 0, 0, BEAM_Y, 0, 0.2, this.player, 0.95, 1.8, 0, node, m);
    }
  }

  private drawOrderMarker(decals: DecalLayer): void {
    const m = this.session.orderMarker;
    if (!m) return;
    const age = (performance.now() - m.at) / ORDER_MARKER_MS;
    if (age < 0 || age >= 1) return;
    const tint = ORDER_TINT[m.kind];
    const c = tint === undefined ? this.player : this.dotColor.setHex(tint);
    decals.push(DECAL.chevron, m.x, m.z, 2.4, 0, c, 1, 0.65, age);
  }
}
