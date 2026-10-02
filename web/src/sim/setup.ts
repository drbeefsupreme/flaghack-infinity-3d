/**
 * Match setup: map, lattice, physics, nav, factions, four corner camps (Hearth + GCC +
 * avatar + hippies + stock + home ring), lumber piles, neutral hippies.
 * Owner: SurveyRules agent (initial version by the orchestrator).
 */
import {
  CAMP_CENTERS,
  NEUTRAL_HIPPIES,
  PILE_MAX,
  PILE_MIN,
  START_CARRIED_FLAGS,
  START_HIPPIES,
  START_HOME_RING_RADIUS,
  START_LUMBER,
  START_STOCK_FLAGS,
  TIDE_INTERVAL,
} from './constants';
import { createFaction, spawnAvatar, spawnBuilding, spawnFlag, spawnHippie, spawnPile } from './factory';
import { Lattice } from './lattice/lattice';
import { planRing } from './lattice/planner';
import { generateMap } from './map/mapgen';
import { NavGrid } from './nav/navgrid';
import { CollisionWorld } from './physics/collision';
import { registerBuildingShape } from './systems/buildings';
import { plantFlag } from './systems/flags';
import { updateSurvey } from './systems/survey';
import { FACTION_IDS } from './types';
import type { FactionId, MatchOptions } from './types';
import { createSurveyState, World } from './world';

export function createMatch(options: MatchOptions): World {
  const world = new World(options);
  const map = generateMap(options.seed);
  world.map = map;
  world.lattice = Lattice.generate(options.seed, { isBlockedAt: map.isBlockedAt });
  world.collision = CollisionWorld.fromMap(map);
  world.nav = NavGrid.fromMap(map);
  world.survey = createSurveyState(world.lattice);
  world.tide.nextAt = TIDE_INTERVAL;

  for (const f of FACTION_IDS) {
    world.factions.push(createFaction(f, f === 0 && !options.allAi, options.difficulty));
  }
  for (const f of FACTION_IDS) setupCamp(world, f);

  for (const spot of map.pileSpots) {
    spawnPile(world, world.rng.chance(0.55) ? 'pallets' : 'moop', spot, world.rng.int(PILE_MIN, PILE_MAX));
  }
  for (let i = 0; i < NEUTRAL_HIPPIES && map.neutralSpawns.length > 0; i++) {
    const at = map.neutralSpawns[i % map.neutralSpawns.length];
    spawnHippie(world, -1, { x: at.x + world.rng.range(-3, 3), z: at.z + world.rng.range(-3, 3) });
  }
  updateSurvey(world, 0);
  return world;
}

/** Thick facet nearest to a point whose corner nodes are all unblocked. */
export function nearestBuildableFacet(world: World, x: number, z: number, exclude: Set<number> = new Set()): number {
  const lat = world.lattice;
  let best = -1;
  let bestD = Infinity;
  for (const f of lat.facets) {
    if (!f.thick || f.boundary || exclude.has(f.id)) continue;
    if (f.nodes.some((n) => lat.nodes[n].blocked)) continue;
    const d = (f.cx - x) ** 2 + (f.cz - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f.id;
    }
  }
  return best;
}

function setupCamp(world: World, f: FactionId): void {
  const fac = world.factions[f];
  const c = CAMP_CENTERS[f];
  fac.lumber = START_LUMBER;

  const hearthFacet = nearestBuildableFacet(world, c.x, c.z);
  const hearth = spawnBuilding(world, 'hearth', f, hearthFacet, 1);
  registerBuildingShape(world, hearth);

  // GCC parks between the Hearth and the map centre, one facet-ring out.
  const toCentre = Math.hypot(c.x, c.z);
  const gx = hearth.pos.x - (c.x / toCentre) * 9;
  const gz = hearth.pos.z - (c.z / toCentre) * 9;
  const gccFacet = nearestBuildableFacet(world, gx, gz, new Set([hearthFacet]));
  const gcc = spawnBuilding(world, 'gcc', f, gccFacet, 1);
  registerBuildingShape(world, gcc);

  const av = spawnAvatar(world, f, { x: hearth.pos.x - (c.x / toCentre) * 5, z: hearth.pos.z - (c.z / toCentre) * 5 });
  av.yaw = Math.atan2(-c.x, -c.z);
  av.input.yaw = av.yaw;

  for (let i = 0; i < START_STOCK_FLAGS; i++) {
    spawnFlag(world, { state: 'stock', owner: f, holder: hearth.id, pos: { x: hearth.pos.x, y: 0, z: hearth.pos.z } });
  }
  for (let i = 0; i < START_CARRIED_FLAGS; i++) {
    const fl = spawnFlag(world, { state: 'carried', owner: f, holder: av.id, pos: { ...av.pos } });
    av.carried.push(fl.id);
  }
  for (let i = 0; i < START_HIPPIES; i++) {
    const a = (i / START_HIPPIES) * Math.PI * 2;
    spawnHippie(world, f, { x: hearth.pos.x + Math.cos(a) * 6, z: hearth.pos.z + Math.sin(a) * 6 });
  }

  // Home ring: a closed starting Survey around the Hearth, planted with fresh Flags.
  const lat = world.lattice;
  const ring = planRing(lat, hearth.pos.x, hearth.pos.z, START_HOME_RING_RADIUS, (n) =>
    lat.nodes[n].blocked ? Infinity : 1,
  );
  if (ring) {
    for (const node of ring) {
      const n = lat.nodes[node];
      const fl = spawnFlag(world, { state: 'carried', owner: f, holder: av.id, pos: { x: n.x, y: 0, z: n.z } });
      if (!plantFlag(world, fl.id, node, f, -1)) {
        // Fall back to stock if planting is not possible (keeps Flag conservation).
        fl.state = 'stock';
        fl.holder = hearth.id;
      }
    }
  }
}
