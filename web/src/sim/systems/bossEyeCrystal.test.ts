import { describe, expect, it } from 'vitest';
import { spawnCrystal, spawnFlag } from '../factory';
import { CollisionWorld } from '../physics/collision';
import { createMatch } from '../setup';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { spawnBoss } from './boss';
import { bossEyeRay, updateBossEye } from './boss/eye';
import { chooseBossEyeTarget, planBossEyeSweep } from './boss/eyeTargeting';
import { crystalFlagTargets } from './boss/crystalTargets';
import { activeBossCrystals, syncBossLightning, updateBossLightning } from './boss/lightning';
import { updateCrystals } from './crystals';
import { freeFocus, newMatch, plantFresh, runRules } from './rules/testWorld';
import { latticeTopology } from '../lattice/topology';
import { nodeSupportingFlags } from './boss/barriers';

function fixture() {
  const world = createMatch({ seed: 'beam-crystal', mode: 'standard', difficulty: 'normal', humans: [0] });
  const rainbow = world.map.obstacles.find(o => o.kind === 'art')!;
  world.time = 100; world.effigyRevealedAt = 100; world.map.obstacles = []; world.collision = new CollisionWorld();
  world.buildings.clear(); world.pieces.clear(); world.hippies.clear(); world.flags.clear(); world.crystals.clear();
  for (const a of world.avatars.values()) a.pos = { x: 140, y: 0, z: 80 + a.faction * 20 };
  world.survey.nodeFlag.fill(-1); world.survey.nodeFlagOwner.fill(-1); world.survey.holder.fill(-1); world.survey.impliedOwner.fill(-1);
  const boss = spawnBoss(world)!; boss.action = 'idle'; boss.pos = { x: 0, z: 0 }; boss.yaw = 0;
  let node = 0;
  const crystal = (x: number, z: number, scale = 1, offsets = [[0, 0]]) => {
    const c = spawnCrystal(world, node++, 0, []); Object.assign(c, { pos: { x, z }, scale, growth: 1 });
    const flags = offsets.map(([dx, dz]) => {
      const fl = spawnFlag(world, { state: 'planted', owner: 0, node: node++, pos: { x: x + dx, y: 0, z: z + dz } });
      world.survey.nodeFlag[fl.node] = fl.id; world.survey.nodeFlagOwner[fl.node] = 0; world.survey.holder[fl.node] = 0;
      c.pentacle.push(fl.node); return fl;
    });
    return { c, flags };
  };
  const fire = () => { world.time = 127; updateBossEye(world, boss, 1 / 60); world.time = 130; updateBossEye(world, boss, 3); };
  world.drainEvents(); return { world, boss, crystal, fire, rainbow };
}
function realPentacle(scale: number) {
  const world = newMatch('beam-crystal-pattern'); world.tide.nextAt = Infinity; runRules(world, 1 / 30);
  const node = freeFocus(world, 0), ids = plantFresh(world, 0, world.lattice.neighbors(node)); runRules(world, 1 / 30);
  const c = [...world.crystals.values()].find(c => c.node === node)!; c.scale = scale; c.growth = 1;
  world.time = 100; world.effigyRevealedAt = 100; const boss = spawnBoss(world)!; boss.action = 'idle';
  boss.pos = { x: c.pos.x, z: c.pos.z - 40 }; boss.yaw = 0; world.collision = new CollisionWorld(); world.map.obstacles = [];
  world.buildings.clear(); world.pieces.clear(); world.hippies.clear();
  for (const a of world.avatars.values()) a.pos = { x: 140, y: 0, z: 80 + a.faction * 20 };
  return { world, boss, c, ids };
}

describe('crystal retaliation targets sustaining Flags', () => {
  it('prioritizes actual support Flags above rainbows and skips unready/out-of-range normal crystals', () => {
    const e = fixture(); e.world.map.obstacles = [{ ...e.rainbow, kind: 'art', variant: 1, x: 0, z: 40, height: 10 }];
    const normal = e.crystal(25, 20), far = e.crystal(0, 60), growing = e.crystal(0, 10); growing.c.growth = .99;
    expect(chooseBossEyeTarget(e.world, e.boss)).toEqual({ ...normal.flags[0].pos });
    e.world.crystals.delete(normal.c.id); expect(chooseBossEyeTarget(e.world, e.boss)).toEqual({ x: 0, y: 5, z: 40 });
    expect(activeBossCrystals(e.world, e.boss)).not.toContain(far.c);
  });
  it.each([1, 10])('knocks down a scale-%s crystal’s real pentacle and ends its lightning via normal rules', scale => {
    const { world, boss, c, ids } = realPentacle(scale); syncBossLightning(world, boss);
    expect(boss.lightning.some(l => l.id === c.id)).toBe(true);
    world.time = 127; updateBossEye(world, boss, 3);
    expect(boss.eye.target!.y).toBe(0); expect(boss.eye.route.every(p => p.y === 0)).toBe(true);
    const target = { ...boss.eye.target! }; world.time = 130; updateBossEye(world, boss, 3);
    expect(boss.eye.impactTag).toBe(0); expect(boss.eye.impact!.x).toBeCloseTo(target.x, 7); expect(boss.eye.impact!.z).toBeCloseTo(target.z, 7);
    expect(ids.some(id => world.flags.get(id)?.state === 'loose')).toBe(true);
    expect(world.crystals.has(c.id)).toBe(true); // Beam does not pop the image itself.
    updateCrystals(world, 0); syncBossLightning(world, boss);
    expect(world.crystals.has(c.id)).toBe(false); expect(boss.lightning.some(l => l.id === c.id)).toBe(false);
    for (const id of ids) expect(world.flags.has(id)).toBe(true);
    const hp = boss.hp; world.time += .1; updateBossLightning(world, boss, .1); expect(boss.hp).toBe(hp);
  });
  it('maximizes the first five-meter support blast and routes toward uncovered support groups', () => {
    const e = fixture(), a = e.crystal(0, 35, 1, [[-4, 0], [4, 0], [0, 4]]), b = e.crystal(25, 35);
    const targets = crystalFlagTargets(e.world, e.boss), first = chooseBossEyeTarget(e.world, e.boss)!;
    const selected = targets.find(t => t.at.x === first.x && t.at.z === first.z)!;
    expect(selected.supports.sort()).toEqual(a.flags.map(f => f.id).sort());
    const route = planBossEyeSweep(e.world, e.boss, first); expect(route).toHaveLength(2);
    expect(route[1]).toEqual(b.flags[0].pos);
  });
  it('follows implied-node real parents, deduplicates simulacra, and ignores removed or loose support Flags', () => {
    const e = fixture(), topo = latticeTopology(e.world.lattice);
    let mid = 0; while (topo.midStart[mid] === topo.midStart[mid + 1]) mid++;
    const i = topo.midStart[mid], a = topo.midA[i], b = topo.midB[i];
    const fa = spawnFlag(e.world, { state: 'planted', owner: 0, node: a, pos: { ...e.world.lattice.nodes[a], y: 0 } }), fb = spawnFlag(e.world, { state: 'planted', owner: 0, node: b, pos: { ...e.world.lattice.nodes[b], y: 0 } });
    for (const f of [fa, fb]) { e.world.survey.nodeFlag[f.node] = f.id; e.world.survey.holder[f.node] = 0; e.world.survey.impliedOrder[f.node] = 0; }
    e.world.survey.impliedOwner[mid] = 0; e.world.survey.impliedOrder[mid] = 1;
    expect(nodeSupportingFlags(e.world, [mid, mid, a], 0).map(f => f.id)).toEqual([fa.id, fb.id]);
    fb.state = 'loose'; expect(nodeSupportingFlags(e.world, [mid], 0).map(f => f.id)).toEqual([fa.id]);
    fa.altNode = b; e.world.survey.nodeFlag[b] = fa.id;
    expect(nodeSupportingFlags(e.world, [mid, a, b], 0).map(f => f.id)).toEqual([fa.id]);
  });
  it('retaliates at giant ground supports across the arena and defers those beyond the finite ray reach', () => {
    const e = fixture(), near = e.crystal(0, 200, 10);
    expect(chooseBossEyeTarget(e.world, e.boss)).toEqual(near.flags[0].pos);
    e.fire(); expect(near.flags[0].state).toBe('loose'); expect(e.boss.eye.impact!.y).toBe(0);
    e.world.crystals.delete(near.c.id); const far = e.crystal(1000, 1000, 10); e.world.time = 160;
    expect(activeBossCrystals(e.world, e.boss)).toContain(far.c); expect(chooseBossEyeTarget(e.world, e.boss)).toBeNull();
  });
  it('keeps real foreground occlusion and never pops a protected crystal image', () => {
    const { world, boss, c, ids } = realPentacle(10); world.time = 127; updateBossEye(world, boss, 3);
    const ray = bossEyeRay(world, boss), d = 12;
    world.collision.addBox(ray.origin.x + ray.direction.x * d, ray.origin.z + ray.direction.z * d, 4, 4, 0, 0, 40, 9999);
    world.time = 130; updateBossEye(world, boss, 3); expect(boss.eye.impactTag).toBe(9999);
    updateCrystals(world, 0); expect(world.crystals.has(c.id)).toBe(true);
    expect(ids.every(id => world.flags.get(id)?.state === 'planted')).toBe(true);
  });
  it('does not pop a giant prism when a skyward beam crosses its image with the pattern untouched', () => {
    const { world, boss, c, ids } = realPentacle(10), target = { ...c.pos, y: 45 };
    Object.assign(boss.eye, { chargeAt: 97, firedAt: 100, nextFireAt: 130, target, route: [target], sample: -1 });
    updateBossEye(world, boss, 1 / 30); expect(boss.eye.impact).toBeNull(); updateCrystals(world, 0);
    expect(world.crystals.has(c.id)).toBe(true); expect(ids.every(id => world.flags.get(id)?.state === 'planted')).toBe(true);
  });
  it('replicates the ground route and recoverable Flag knockdown to live and late peers', () => {
    const { world, boss, c, ids } = realPentacle(10); world.time = 127; updateBossEye(world, boss, 3);
    const encoder = new SnapshotEncoder(world), wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
    const peer = NetMirror.create(world.options, wire(encoder.full()));
    expect(peer.world.boss!.eye.route.every(p => p.y === 0)).toBe(true);
    world.time = 130; world.tick++; updateBossEye(world, boss, 3); updateCrystals(world, 0); syncBossLightning(world, boss);
    const events = world.drainEvents(), frame = wire({ tick: world.tick, time: world.time, acks: {}, delta: encoder.delta(events), events });
    peer.push(frame); peer.catchUp(); const late = NetMirror.create(world.options, wire(encoder.full()));
    for (const p of [peer, late]) {
      expect(p.world.crystals.has(c.id)).toBe(false); expect(p.world.boss!.lightning.some(l => l.id === c.id)).toBe(false);
      expect(ids.some(id => p.world.flags.get(id)?.state === 'loose')).toBe(true);
      expect(p.world.boss!.eye.route.every(at => at.y === 0)).toBe(true);
    }
  });
});
