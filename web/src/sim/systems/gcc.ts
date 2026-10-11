/**
 * Geomantic Command Center: passives (automatic recruitment, Geomantic Advice reveal/observe radius, Flag Repair),
 * being pushed, destruction and
 * rebuild at the Hearth.
 * Owner: Economy agent.
 *
 * Geomantic Advice (reveal + Zeno observation within GCC.adviceRadius) is read from the GCC's
 * position by the survey/render systems; pushing is the avatar/hippie systems' job via
 * buildings.moveBuilding; collapse is buildings.collapseGcc.
 */
import type { CommandOf } from '../commands';
import { BUILDING_HEIGHT, BUILDINGS, GCC, GCC_REPAIR_SNAP } from '../constants';
import { facetYaw } from '../factory';
import { FACTION_IDS } from '../types';
import type { Building, FactionId } from '../types';
import type { World } from '../world';
import { isCollapsed, moveBuilding, repairBuilding } from './buildings';
import { econ } from './econ/state';
import { nearestPlantableNode, plantFlag } from './flags';
import { pieceAt, piecePosition, repairPiece } from './pieces';

/** A rebuilt cart parks this far from its Hearth, toward the centre of the burn (as at the start). */
const PARK_DISTANCE = 9;
/** Facets considered for parking, around the preferred spot. */
const PARK_SEARCH = 24;
/** With nothing to repair, Flag Repair looks for loose Flags again after this long. */
const REPAIR_IDLE_RESCAN = 0.5;

/** Is the faction's GCC currently standing (not collapsed)? */
export function gccActive(world: World, f: FactionId): boolean {
  const g = world.gccOf(f);
  return !!g && g.gcc !== null && !isCollapsed(g);
}

/** Retired command tombstone: legacy/replayed clients cannot execute removed GCC powers. */
export function cmdGcc(world: World, c: CommandOf<'gcc'>): void {
  world.emit({ t: 'rejected', faction: c.faction, reason: 'The Command Center no longer has active abilities.' });
}

/** Flag Repair: re-plant the nearest own loose Flag in range that has a free node close by. */
function replantOne(world: World, f: FactionId, g: Building): boolean {
  const ids = econ(world).idBuf;
  ids.length = 0;
  const r2 = GCC.repairRadius * GCC.repairRadius;
  for (const fl of world.flags.values()) {
    if (fl.state !== 'loose' || fl.owner !== f) continue;
    if ((fl.pos.x - g.pos.x) ** 2 + (fl.pos.z - g.pos.z) ** 2 <= r2) ids.push(fl.id);
  }
  if (ids.length === 0) return false;
  const d2 = (id: number): number => {
    const fl = world.flags.get(id);
    return fl ? (fl.pos.x - g.pos.x) ** 2 + (fl.pos.z - g.pos.z) ** 2 : Infinity;
  };
  ids.sort((a, b) => d2(a) - d2(b) || a - b);
  let planted = false;
  for (const id of ids) {
    const fl = world.flags.get(id);
    if (!fl) continue;
    const node = nearestPlantableNode(world, fl.pos, GCC_REPAIR_SNAP, f);
    if (node >= 0 && plantFlag(world, id, node, f, g.id)) {
      planted = true;
      break;
    }
  }
  ids.length = 0;
  return planted;
}

/** Flag Repair passives: a Flag re-planted every GCC.repairInterval, +GCC.repairHps to own pieces/buildings in range. */
function flagRepair(world: World, f: FactionId, g: Building, dt: number): void {
  const st = econ(world);
  // A charged repair fires as soon as a loose Flag turns up (rescanning twice a second), then waits the interval.
  const timer = Math.min(GCC.repairInterval, st.gccRepairTimer[f] + dt);
  st.gccRepairTimer[f] = timer;
  if (timer >= GCC.repairInterval) st.gccRepairTimer[f] = replantOne(world, f, g) ? 0 : GCC.repairInterval - REPAIR_IDLE_RESCAN;
  const heal = GCC.repairHps * dt;
  const r2 = GCC.repairRadius * GCC.repairRadius;
  for (const p of world.pieces.values()) {
    if (p.faction !== f || p.hp >= p.maxHp) continue;
    const pos = piecePosition(world, p);
    if (pos && (pos.x - g.pos.x) ** 2 + (pos.z - g.pos.z) ** 2 <= r2) repairPiece(p, heal);
  }
  for (const b of world.buildings.values()) {
    if (b === g || b.faction !== f || (!b.disabled && b.hp >= b.maxHp)) continue;
    const reach = GCC.repairRadius + BUILDINGS[b.kind].radius;
    if ((b.pos.x - g.pos.x) ** 2 + (b.pos.z - g.pos.z) ** 2 <= reach * reach) repairBuilding(world, b, heal);
  }
}

/** Where a rebuilt cart parks: a free Sun facet near the spot beside the Hearth, or -1 if the camp is packed. */
function parkingFacet(world: World, hearth: Building, g: Building): number {
  const lat = world.lattice;
  const toCentre = Math.hypot(hearth.pos.x, hearth.pos.z) || 1;
  const px = hearth.pos.x - (hearth.pos.x / toCentre) * PARK_DISTANCE;
  const pz = hearth.pos.z - (hearth.pos.z / toCentre) * PARK_DISTANCE;
  const r = BUILDINGS.gcc.radius;
  let best = -1;
  let bestD = Infinity;
  for (const id of lat.facetsInRadius(px, pz, PARK_SEARCH)) {
    const fc = lat.facets[id];
    if (!fc.thick || fc.boundary) continue;
    const d = (fc.cx - px) ** 2 + (fc.cz - pz) ** 2;
    if (d >= bestD) continue;
    if (fc.nodes.some((n) => lat.nodes[n].blocked) || pieceAt(world, 'floor', -1, id, 0)) continue;
    let clear = true;
    for (const b of world.buildings.values()) {
      if (b === g || isCollapsed(b)) continue;
      const min = r + BUILDINGS[b.kind].radius + 0.5;
      if ((b.pos.x - fc.cx) ** 2 + (b.pos.z - fc.cz) ** 2 < min * min) {
        clear = false;
        break;
      }
    }
    if (!clear || world.collision.blockedCircle(fc.cx, fc.cz, r, world.collision.groundHeight(fc.cx, fc.cz) + 0.2, world.collision.groundHeight(fc.cx, fc.cz) + BUILDING_HEIGHT.gcc)) continue;
    best = id;
    bestD = d;
  }
  return best;
}

/** The cart is rebuilt beside the Hearth once its rebuild time (finite) has passed. */
function rebuild(world: World, f: FactionId, g: Building): void {
  const gc = g.gcc;
  if (!gc || gc.destroyedUntil === 0 || gc.destroyedUntil > world.time) return;
  const hearth = world.hearthOf(f);
  if (!hearth) return;
  const facet = parkingFacet(world, hearth, g);
  if (facet < 0) return;
  gc.destroyedUntil = 0;
  gc.channelUntil = 0;
  gc.pushedBy = -1;
  g.hp = g.maxHp;
  g.disabled = false;
  g.built = 1;
  g.yaw = facetYaw(world, facet);
  const fc = world.lattice.facets[facet];
  moveBuilding(world, g, fc.cx, fc.cz);
  world.emit({ t: 'gccRebuilt', faction: f, gccId: g.id, pos: { x: g.pos.x, z: g.pos.z } });
}

export function updateGcc(world: World, dt: number): void {
  for (const f of FACTION_IDS) {
    // Old snapshots can carry an in-flight retired channel. Cancel it without a conversion.
    const av = world.avatarOf(f);
    if (av?.action.kind === 'channel' && av.action.what === 'dialectics') av.action = { kind: 'idle' };
    const legacyCart = world.gccOf(f);
    if (legacyCart?.gcc) legacyCart.gcc.channelUntil = 0;
    if (!world.factions[f].alive) continue;
    const g = world.gccOf(f);
    if (!g || !g.gcc) continue;
    if (isCollapsed(g)) rebuild(world, f, g);
    if (!isCollapsed(g)) flagRepair(world, f, g, dt);
  }
}
