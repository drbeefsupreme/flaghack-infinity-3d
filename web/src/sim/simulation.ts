/**
 * Fixed-step simulation orchestrator. One call to step() = one SIM_DT tick.
 * System order matters: commands → actors → economy → geometry → consequences.
 */
import { SIM_DT } from './constants';
import { updateAbilities } from './systems/abilities';
import { updateAvatars } from './systems/avatars';
import { updateBuildings } from './systems/buildings';
import { applyCommands } from './systems/commands';
import { updateCapture } from './systems/capture';
import { updateCrystals } from './systems/crystals';
import { updateDrugs } from './systems/drugs';
import { updateEconomy } from './systems/economy';
import { updateGcc } from './systems/gcc';
import { updateHippies } from './systems/hippies';
import { updateInstability } from './systems/instability';
import { updatePieces } from './systems/pieces';
import { updatePings } from './systems/pings';
import { updateProjectiles } from './systems/projectiles';
import { updateSurvey } from './systems/survey';
import { updateTides } from './systems/tides';
import { updateVictory } from './systems/victory';
import type { World } from './world';

export class Simulation {
  readonly world: World;
  /** Per-system wall-clock cost of the last step (ms), for the perf overlay/eval. */
  readonly timings: Record<string, number> = {};

  constructor(world: World) {
    this.world = world;
  }

  step(): void {
    const w = this.world;
    const dt = SIM_DT;
    w.tick++;
    w.time += dt;
    this.run('commands', () => applyCommands(w));
    if (w.phase !== 'playing') return;
    this.run('avatars', () => updateAvatars(w, dt));
    this.run('hippies', () => updateHippies(w, dt));
    this.run('projectiles', () => updateProjectiles(w, dt));
    this.run('pings', () => updatePings(w, dt));
    this.run('economy', () => updateEconomy(w, dt));
    this.run('buildings', () => updateBuildings(w, dt));
    this.run('pieces', () => updatePieces(w, dt));
    this.run('gcc', () => updateGcc(w, dt));
    this.run('abilities', () => updateAbilities(w, dt));
    this.run('drugs', () => updateDrugs(w, dt));
    this.run('survey', () => updateSurvey(w, dt));
    this.run('crystals', () => updateCrystals(w, dt));
    this.run('instability', () => updateInstability(w, dt));
    this.run('tides', () => updateTides(w, dt));
    this.run('capture', () => updateCapture(w, dt));
    this.run('victory', () => updateVictory(w, dt));
  }

  private run(name: string, fn: () => void): void {
    const t0 = performance.now();
    fn();
    this.timings[name] = performance.now() - t0;
  }
}
