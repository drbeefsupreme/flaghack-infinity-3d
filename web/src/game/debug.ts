/**
 * Browser-console debug API (window.fh). Lets developers and automated smoke tests stage
 * scenarios: fast-forward the sim, grant resources, call sim systems directly.
 * Presentation/dev only; gameplay code never imports this module.
 */
import * as factory from '../sim/factory';
import * as geometry from '../sim/lattice/geometry';
import * as planner from '../sim/lattice/planner';
import * as abilities from '../sim/systems/abilities';
import * as buildings from '../sim/systems/buildings';
import * as capture from '../sim/systems/capture';
import * as flags from '../sim/systems/flags';
import * as pieces from '../sim/systems/pieces';
import * as survey from '../sim/systems/survey';
import * as tides from '../sim/systems/tides';
import type { FactionId } from '../sim/types';
import type { App } from './app';

export function installDebug(app: App): void {
  const fh = {
    app,
    get world() {
      return app.world;
    },
    get session() {
      return app.session;
    },
    factory,
    geometry,
    planner,
    flags,
    survey,
    tides,
    capture,
    abilities,
    buildings,
    pieces,
    /** Run the simulation synchronously for `seconds` of game time. */
    advance(seconds: number): void {
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps; i++) app.sim?.step();
    },
    /** Grant resources to a faction (default: player). */
    give(res: { lumber?: number; ritual?: number; flags?: number }, faction: FactionId = 0): void {
      const w = app.world;
      if (!w) return;
      const f = w.factions[faction];
      f.lumber += res.lumber ?? 0;
      f.ritual += res.ritual ?? 0;
      const av = w.avatarOf(faction);
      for (let i = 0; i < (res.flags ?? 0); i++) {
        const fl = factory.spawnFlag(w, { state: 'carried', owner: faction, holder: av.id, pos: { ...av.pos } });
        av.carried.push(fl.id);
      }
    },
    /**
     * Plant a loop of fresh Flags for `faction` enclosing (x, z) at ≥ radius, using the shared
     * planner. Returns the node ids planted.
     */
    encircle(faction: FactionId, x: number, z: number, radius: number): number[] {
      const w = app.world;
      if (!w) return [];
      const lat = w.lattice;
      const loop = planner.planEnclosure(lat, {
        x,
        z,
        minRadius: radius,
        cost: (n) => (lat.nodes[n].blocked || w.survey.nodeFlag[n] >= 0 ? Infinity : 1),
      });
      if (!loop) return [];
      for (const node of loop) {
        const n = lat.nodes[node];
        const fl = factory.spawnFlag(w, { state: 'carried', owner: faction, holder: -1, pos: { x: n.x, y: 0, z: n.z } });
        flags.plantFlag(w, fl.id, node, faction, -1);
      }
      return loop;
    },
  };
  window.fh = fh;
}

declare global {
  interface Window {
    /** Debug console API (see game/debug.ts). */
    fh?: unknown;
  }
}
