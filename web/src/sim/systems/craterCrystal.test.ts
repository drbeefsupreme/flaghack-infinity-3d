import { describe, expect, it } from 'vitest';
import { BOSS_GAMEPLAY_SCALE } from '../bossDimensions';
import { CRYSTAL_GROW_TIME, CRYSTAL_HEIGHT, CRYSTAL_RITUAL_PER_SEC, SIM_DT } from '../constants';
import { CRATER_OUTER_RADIUS, craterRimVariation, insideEffigyCrater } from '../effigyCrater';
import { spawnCrystal } from '../factory';
import { isStar } from '../lattice/geometry';
import { normalizeMatch } from '../matchSettings';
import { Rng } from '../rng';
import { createMatch } from '../setup';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { createCrater } from '../../render/env/burn/boss/revealFx';
import { updateCrystals } from './crystals';
import { defendedPullRate } from './flags';

function scenario(bossMode = true) {
  const w = createMatch({ seed: 'crater-crystal', difficulty: 'normal', humans: [0], mode: 'standard', match: normalizeMatch({ bossMode }) });
  const focus = w.lattice.nodes.find(n => isStar(w.lattice, n.id))!;
  w.map.effigy.x = focus.x; w.map.effigy.z = focus.z;
  w.survey.focusNodes = [focus.id];
  for (const n of w.lattice.neighbors(focus.id)) w.survey.holder[n] = 0;
  w.survey.nodeFlag[focus.id] = -1;
  w.effigyRevealedAt = 10; w.time = 10;
  return { w, focus };
}

describe('Effigy crater crystal', () => {
  it('matches the actual rendered irregular rim, including the boundary, on every segment', () => {
    const { w } = scenario();
    const variation = craterRimVariation(new Rng(`boss-reveal:${w.map.seed}`));
    const geometry = createCrater(new Rng(`boss-reveal:${w.map.seed}`));
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < variation.length; i++) {
      const a = i / variation.length * Math.PI * 2;
      const r = variation[i] * CRATER_OUTER_RADIUS;
      expect(vertices.getX(6 * 81 + i)).toBeCloseTo(Math.cos(a) * r, 5);
      expect(vertices.getZ(6 * 81 + i)).toBeCloseTo(Math.sin(a) * r, 5);
      const point = (offset: number) => ({ x: w.map.effigy.x + Math.cos(a) * (r + offset) * BOSS_GAMEPLAY_SCALE,
        z: w.map.effigy.z + Math.sin(a) * (r + offset) * BOSS_GAMEPLAY_SCALE });
      expect(insideEffigyCrater(w, point(-0.001))).toBe(true);
      expect(insideEffigyCrater(w, point(0))).toBe(true);
      expect(insideEffigyCrater(w, point(0.001))).toBe(false);
    }
    geometry.dispose();
  });

  it('manifests at 10× once and preserves growth, income and repeated updates', () => {
    const { w } = scenario();
    updateCrystals(w, 0);
    const c = [...w.crystals.values()][0];
    expect(c.scale).toBe(10); expect(c.growth).toBe(0);
    const ritual = w.factions[0].ritual;
    updateCrystals(w, CRYSTAL_GROW_TIME);
    expect(c.growth).toBe(1); expect(c.scale).toBe(10);
    expect(w.factions[0].ritual - ritual).toBeCloseTo(CRYSTAL_RITUAL_PER_SEC * CRYSTAL_GROW_TIME);
    updateCrystals(w, SIM_DT); updateCrystals(w, SIM_DT);
    expect(c.scale).toBe(10); expect(w.crystals.size).toBe(1);
    expect(w.factions[0].stats.crystalsManifested).toBe(1);
  });

  it('checks at manifestation: an old focus qualifies, an old crystal does not resize, remanifesting does', () => {
    const { w, focus } = scenario();
    w.effigyRevealedAt = null;
    updateCrystals(w, 0);
    const original = [...w.crystals.values()][0];
    expect(original.scale).toBe(1);
    w.effigyRevealedAt = w.time;
    updateCrystals(w, 0); expect(original.scale).toBe(1);
    const neighbor = w.lattice.neighbors(focus.id)[0];
    w.survey.holder[neighbor] = -1;
    updateCrystals(w, 0); expect(w.crystals.size).toBe(0);
    w.survey.holder[neighbor] = 0;
    updateCrystals(w, 0);
    expect([...w.crystals.values()][0]).toMatchObject({ scale: 10, growth: 0 });
    expect([...w.crystals.values()][0].id).not.toBe(original.id);
  });

  it('does not trigger outside, before reveal, with no crater, or in non-boss mode', () => {
    for (const mode of ['outside', 'before', 'absent', 'nonboss'] as const) {
      const { w, focus } = scenario(mode !== 'nonboss');
      if (mode === 'outside') w.map.effigy.x += 100;
      if (mode === 'before') w.time = 9.99;
      if (mode === 'absent') w.effigyRevealedAt = null;
      expect(spawnCrystal(w, focus.id, 0, []).scale).toBe(1);
    }
  });

  it('keeps the original crater after the boss is gone and does not carry it into a fresh match', () => {
    const { w, focus } = scenario();
    w.boss = null; w.time += 2000;
    expect(spawnCrystal(w, focus.id, 0, []).scale).toBe(10);
    const fresh = createMatch(w.options);
    expect(fresh.crystals.size).toBe(0); expect(fresh.effigyRevealedAt).toBeNull();
    expect(spawnCrystal(fresh, focus.id, 0, []).scale).toBe(1);
  });

  it('replicates scales through deltas, event-free late joins, and repeated frames', () => {
    const { w, focus } = scenario();
    const encoder = new SnapshotEncoder(w);
    const mirror = NetMirror.create(w.options, JSON.parse(JSON.stringify(encoder.full())));
    const c = spawnCrystal(w, focus.id, 0, []);
    const outside = w.lattice.nodes.find(n => !insideEffigyCrater(w, n))!;
    const ordinary = spawnCrystal(w, outside.id, 0, []);
    w.tick++; w.time += SIM_DT;
    const frame = JSON.parse(JSON.stringify({ tick: w.tick, time: w.time, acks: {}, delta: encoder.delta([]), events: [] }));
    mirror.push(frame); mirror.catchUp(); mirror.push(frame); mirror.catchUp();
    const late = NetMirror.create(w.options, JSON.parse(JSON.stringify(encoder.full())));
    for (const peer of [mirror, late]) {
      expect(peer.world.crystals.get(c.id)?.scale).toBe(10);
      expect(peer.world.crystals.get(ordinary.id)?.scale).toBe(1);
      expect(peer.world.drainEvents()).toEqual([]);
    }
  });

  it('fires defensive lightning from the scaled tip without changing defense strength', () => {
    const { w, focus } = scenario();
    const flag = [...w.flags.values()].find(f => f.owner === 1 && f.state === 'planted')!;
    const c = spawnCrystal(w, focus.id, 1, [flag.node]); c.growth = 1;
    const rate = defendedPullRate(w, flag, 0, true);
    expect(w.drainEvents().find(e => e.t === 'crystalLightning')).toMatchObject({ from: { y: CRYSTAL_HEIGHT * 10 } });
    c.scale = 1;
    expect(defendedPullRate(w, flag, 0, true)).toBe(rate);
  });
});
