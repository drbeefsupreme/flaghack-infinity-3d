/**
 * Crystal manifestation at 5-fold focus nodes held as complete pentacles; growth, ritual
 * income, shattering when the pentacle breaks or the node flips, and C.M.I. accounting.
 * Owner: SurveyRules agent.
 */
import { CRYSTAL_GROW_TIME, CRYSTAL_RITUAL_PER_SEC } from '../constants';
import { spawnCrystal } from '../factory';
import { isStar } from '../lattice/geometry';
import type { Crystal, FactionId } from '../types';
import type { World } from '../world';
import { isFactionId } from './rules/factions';

/**
 * C.M.I. (Crystal Manifestation Index, design §3.3): each owned Crystal is worth 100 plus 10
 * for every full ten seconds it has stood; every Survey facet adds 1.
 */
const CMI_CRYSTAL_BASE = 100;
const CMI_STEP = 10;
const CMI_STEP_SECONDS = 10;

const cmiScratch = new Float64Array(4);

export function updateCrystals(world: World, dt: number): void {
  const lat = world.lattice;
  for (const c of world.crystals.values()) {
    if (!isStar(lat, c.node) || pentacleHolder(world, c.node) !== c.faction) {
      shatterCrystal(world, c);
      continue;
    }
    c.growth = Math.min(1, c.growth + dt / CRYSTAL_GROW_TIME);
    world.factions[c.faction].ritual += CRYSTAL_RITUAL_PER_SEC * c.growth * dt;
  }

  // survey.focusNodes is refreshed by the survey system earlier in the same tick.
  const focus = world.survey.focusNodes;
  for (let i = 0; i < focus.length; i++) {
    const node = focus[i];
    if (crystalOn(world, node)) continue;
    const f = pentacleHolder(world, node);
    if (f !== null) manifest(world, node, f);
  }

  cmiScratch.fill(0);
  for (const c of world.crystals.values()) {
    cmiScratch[c.faction] += CMI_CRYSTAL_BASE + CMI_STEP * Math.floor((world.time - c.bornAt) / CMI_STEP_SECONDS);
  }
  for (const fac of world.factions) {
    if (fac.alive) fac.stats.cmi = cmiScratch[fac.id] + world.survey.surveySize[fac.id];
  }
}

/** Remove a Crystal (pentacle broken, focus flipped away). Emits crystalShatter. */
export function shatterCrystal(world: World, c: Crystal): void {
  if (!world.crystals.delete(c.id)) return;
  world.emit({ t: 'crystalShatter', crystalId: c.id, node: c.node, faction: c.faction, pos: { ...c.pos } });
  if (c.growth >= 1 && world.factions[c.faction].alive) {
    world.emit({
      t: 'notify',
      faction: c.faction,
      text: 'Your Crystal shatters. The pentacle is broken.',
      severity: 'warn',
      pos: { ...c.pos },
    });
  }
}

/**
 * Faction sustaining a Crystal on the focus node: the living faction holding all five
 * pentacle nodes (real or implied Flags) while no rival real Flag stands on the focus itself.
 * Callers guarantee `focus` is a 5-fold star.
 */
function pentacleHolder(world: World, focus: number): FactionId | null {
  const lat = world.lattice;
  const s = world.survey;
  const edges = lat.nodes[focus].edges;
  const f = s.holder[lat.other(edges[0], focus)];
  if (!isFactionId(f) || !world.factions[f].alive) return null;
  for (let i = 1; i < edges.length; i++) if (s.holder[lat.other(edges[i], focus)] !== f) return null;
  if (s.nodeFlag[focus] >= 0 && s.nodeFlagOwner[focus] !== f) return null;
  return f;
}

function crystalOn(world: World, node: number): boolean {
  for (const c of world.crystals.values()) if (c.node === node) return true;
  return false;
}

function manifest(world: World, node: number, f: FactionId): void {
  const c = spawnCrystal(world, node, f, world.lattice.neighbors(node));
  world.factions[f].stats.crystalsManifested++;
  world.emit({ t: 'crystalManifest', crystalId: c.id, node, faction: f, pos: { ...c.pos } });
  world.emit({
    t: 'notify',
    faction: f,
    text: 'A Crystal manifests on your pentacle. Ritual flows; nearby nodes are observed.',
    severity: 'good',
    pos: { ...c.pos },
  });
}
