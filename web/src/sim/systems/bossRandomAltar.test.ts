import { expect, it, vi } from 'vitest';
import { spawnBuilding } from '../factory';
import { normalizeMatch } from '../matchSettings';
import { SIM_DT } from '../constants';
import { createMatch } from '../setup';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { bossFocusAltar, consumeBuilding, spawnBoss, updateBoss } from './boss';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function encounter() {
  const w = createMatch({ seed: 'random-altar', difficulty: 'normal', humans: [0, 1], mode: 'standard', match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 1000; w.effigyRevealedAt = 990;
  const b = spawnBoss(w)!; Object.assign(b, { action: 'idle', actionAt: w.time, nextAttackAt: 0 }); b.eye.nextFireAt = Infinity;
  for (const a of w.avatars.values()) a.pos = { x: 0, y: 0, z: -105 };
  w.drainEvents();
  return { w, b };
}

it.each([0, .1999, .2, .3999, .4, .5999, .6, .7999, .8, .9999])('uniformly selects from individual altars in stable ID order at draw%s', draw => {
  const { w, b } = encounter();
  const extra = spawnBuilding(w, 'hearth', 0, w.hearthOf(0)!.facet, 1);
  w.factions[0].stats.cmi = 999999; w.factions[0].hearthIds.push(extra.id); // duplicate membership must not increase its weight
  const expected = [...w.buildings.values()].filter(s => s.kind === 'hearth').sort((a, c) => a.id - c.id);
  expect(expected).toHaveLength(5);
  const rng = vi.spyOn(w.rng, 'next').mockReturnValue(draw);
  updateBoss(w, SIM_DT);
  expect(b.objectiveAltarId).toBe(expected[Math.floor(draw * 5)].id); expect(rng).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) { w.time += SIM_DT; updateBoss(w, SIM_DT); bossFocusAltar(w); }
  expect(b.objectiveAltarId).toBe(expected[Math.floor(draw * 5)].id); expect(rng).toHaveBeenCalledTimes(1);
});

it('draws again only when the altar is consumed or invalid and excludes neutral, dead and missing altars', () => {
  const { w, b } = encounter();
  const rng = vi.spyOn(w.rng, 'next').mockReturnValue(0);
  updateBoss(w, SIM_DT); expect(b.objectiveAltarId).toBe(w.hearthOf(0)!.id);
  consumeBuilding(w, bossFocusAltar(w)!); b.action = 'idle'; b.nextAttackAt = 0;
  updateBoss(w, SIM_DT); expect(b.objectiveAltarId).toBe(w.hearthOf(1)!.id); expect(rng).toHaveBeenCalledTimes(2);
  w.factions[1].alive = false;
  spawnBuilding(w, 'hearth', -1, w.hearthOf(2)!.facet, 1);
  w.factions[2].hearthIds.push(999999);
  b.action = 'idle'; b.nextAttackAt = 0; updateBoss(w, SIM_DT);
  expect(b.objectiveAltarId).toBe(w.hearthOf(2)!.id); expect(rng).toHaveBeenCalledTimes(3);
  w.factions[2].alive = false; w.factions[3].alive = false;
  b.action = 'idle'; b.nextAttackAt = 0; updateBoss(w, SIM_DT);
  expect(b.objectiveAltarId).toBeNull(); expect(rng).toHaveBeenCalledTimes(3);
});

it('is seeded and replicates its locked choice without any mirror or late-join random draws', () => {
  const a = encounter(), twin = encounter(); updateBoss(a.w, SIM_DT); updateBoss(twin.w, SIM_DT);
  expect(a.b.objectiveAltarId).toBe(twin.b.objectiveAltarId);
  const enc = new SnapshotEncoder(a.w), peers = [0, 1].map(() => NetMirror.create(a.w.options, wire(enc.full())));
  for (const peer of peers) {
    const rng = vi.spyOn(peer.world.rng, 'next');
    for (let i = 0; i < 30; i++) expect(bossFocusAltar(peer.world)?.id).toBe(a.b.objectiveAltarId);
    expect(rng).not.toHaveBeenCalled();
  }
  consumeBuilding(a.w, bossFocusAltar(a.w)!); a.b.action = 'idle'; a.b.nextAttackAt = 0;
  a.w.time += SIM_DT; a.w.tick++; updateBoss(a.w, SIM_DT);
  const frame = wire({ tick: a.w.tick, time: a.w.time, acks: {}, delta: enc.delta([]), events: [] });
  for (const peer of peers) { peer.push(frame); peer.catchUp(); expect(bossFocusAltar(peer.world)?.id).toBe(a.b.objectiveAltarId); expect(peer.world.rng.next).not.toHaveBeenCalled(); }
  const late = NetMirror.create(a.w.options, wire(enc.full()));
  expect(bossFocusAltar(late.world)?.id).toBe(a.b.objectiveAltarId);
});
