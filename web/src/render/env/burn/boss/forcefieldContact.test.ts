import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bossFixture } from '../../../../../tests/bossFixture';
import { SnapshotEncoder } from '../../../../net/codec';
import { NetMirror } from '../../../../net/mirror';
import type { BossAction } from '../../../../sim/boss';
import { createMatch } from '../../../../sim/setup';
import { bossLoopEdges } from '../../../../sim/systems/boss/barriers';
import type { World } from '../../../../sim/world';
import type { EnvContext } from '../../envTypes';
import { BossCombatFx } from './combatFx';
import { bossForcefieldContacts, FORCEFIELD_ENTER_DISTANCE, FORCEFIELD_EXIT_DISTANCE } from './forcefieldContact';

function square() {
  const nodes = [{ x: -10, z: 0, edges: [0, 3] }, { x: 10, z: 0, edges: [0, 1] },
    { x: 10, z: 20, edges: [1, 2] }, { x: -10, z: 20, edges: [2, 3] }];
  const world = { lattice: { version: 1, nodes, edges: nodes.map((_, id) => ({ id, a: id, b: (id + 1) % 4 })) },
    survey: { version: 1, edgeLey: new Int8Array([1, 1, 1, 1]) },
    factions: [{ color: '#ee2233' }, { color: '#2299ee' }, { color: '#33dd66' }, { color: '#eeaa33' }],
    map: { effigy: { x: 4, z: -8 } } } as unknown as World;
  const boss = bossFixture(); boss.pos = { x: 0, z: -4 }; boss.barrier = null; boss.held = null;
  return { world, boss };
}
function effect(world: World) {
  const model = new THREE.Group();
  for (const name of ['pelvis', 'spine', 'chest', 'head', 'thighL', 'thighR', 'handR']) {
    const bone = new THREE.Bone(); bone.name = name; model.add(bone);
  }
  const env = { ctx: { world }, noise: new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1) } as unknown as EnvContext;
  const fx = new BossCombatFx(env, model);
  const shields = () => fx.group.children.filter(m => m.name === 'boss-faction-forcefield') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[];
  return { fx, shields };
}

// A second independent loop is allowed to be arbitrarily close, with its own owner.
function addLoop(world: World, x: number, z: number, size = 1, faction = 2): void {
  const lat = world.lattice, n = lat.nodes.length, e = lat.edges.length;
  const nodes = [{ x, z, edges: [e, e + 3] }, { x: x + size, z, edges: [e, e + 1] },
    { x: x + size, z: z + size, edges: [e + 1, e + 2] }, { x, z: z + size, edges: [e + 2, e + 3] }];
  lat.nodes.push(...nodes as unknown as typeof lat.nodes);
  lat.edges.push(...nodes.map((_, i) => ({ id: e + i, a: n + i, b: n + (i + 1) % 4 })) as typeof lat.edges);
  world.survey.edgeLey = Int8Array.from([...world.survey.edgeLey, faction, faction, faction, faction]);
  world.survey.version++; lat.version++;
}

describe('persistent boss forcefields within five metres', () => {
  it.each<BossAction>(['idle', 'walk', 'crouch', 'crouchWalk', 'rise', 'grab', 'swipe', 'stomp'])(
    'stays visible beside a loop during %s without recent collision history', action => {
      const { world, boss } = square(), { fx, shields } = effect(world);
      boss.action = action; boss.actionAt = 100;
      if (action === 'grab') boss.held = { kind: 'flag', id: 12, faction: 1, x: 0, z: 0 };
      for (const now of [100, 101, 130, 600]) {
        fx.update(boss, now); expect(shields()).toHaveLength(1);
        expect(shields()[0].material.uniforms.uTime.value).toBe(now);
        expect(shields()[0].position.toArray()).toEqual([-4, 14, 8]);
      }
      expect(boss.barrier).toBeNull(); fx.dispose();
    });

  it('remains visible throughout eye charge after the old contact flash expired', () => {
    const { world, boss } = square(), { fx, shields } = effect(world);
    boss.action = 'idle'; boss.eye.chargeAt = 500;
    boss.barrier = { edge: 0, faction: 3, x: 90, z: 90, at: 100 };
    for (const now of [500, 501, 502.99, 503.1]) {
      fx.update(boss, now); expect(shields()).toHaveLength(1);
      expect(shields()[0].material.uniforms.uColor.value).toEqual(new THREE.Color(world.factions[1].color));
    }
    fx.dispose();
  });

  it('uses an inclusive 5m center distance, a 5.3m exit distance, and no footprint-radius addition', () => {
    const { world, boss } = square();
    expect(FORCEFIELD_ENTER_DISTANCE).toBe(5); expect(FORCEFIELD_EXIT_DISTANCE).toBe(5.3);
    boss.pos.z = -5; const first = bossForcefieldContacts(world, boss);
    expect(first).toHaveLength(1);
    boss.pos.z = -5.001; expect(bossForcefieldContacts(world, boss)).toHaveLength(0);
    boss.pos.z = -5.3; expect(bossForcefieldContacts(world, boss, first)).toHaveLength(1);
    boss.pos.z = -5.301; expect(bossForcefieldContacts(world, boss, first)).toHaveLength(0);
    boss.pos.z = -6; expect(bossForcefieldContacts(world, boss)).toHaveLength(0);
    boss.pos.z = -5.1; expect(bossForcefieldContacts(world, boss)).toHaveLength(0);
  });

  it('measures finite endpoints and shows distinct perpendicular corner planes simultaneously', () => {
    const { world, boss } = square(), { fx, shields } = effect(world);
    boss.pos = { x: -13, z: -4 }; // Exactly five metres from the shared endpoint.
    const contacts = bossForcefieldContacts(world, boss);
    expect(contacts.map(c => c.edge)).toEqual([0, 3]);
    for (const c of contacts) expect(c).toMatchObject({ x: -10, z: 0 });
    expect(Math.abs(Math.sin(contacts[0].yaw - contacts[1].yaw))).toBeCloseTo(1);
    fx.update(boss, 100); expect(shields()).toHaveLength(2);
    expect(shields().map(m => m.userData.edge)).toEqual([0, 3]);
    expect(new Set(shields().map(m => m.geometry)).size).toBe(1);
    boss.pos = { x: -13.01, z: -4 }; expect(bossForcefieldContacts(world, boss)).toHaveLength(0);
    fx.dispose();
  });

  it('renders all edges across multiple loops without a one-contact cap and with independent colors', () => {
    const { world, boss } = square(), { fx, shields } = effect(world);
    addLoop(world, -1, -3, 1, 2); addLoop(world, 2, -4, 1, 3);
    const contacts = bossForcefieldContacts(world, boss);
    expect(contacts.map(c => c.edge)).toEqual([0, 4, 5, 6, 7, 8, 9, 10, 11]);
    fx.update(boss, 100); expect(shields()).toHaveLength(9);
    const first = shields(); fx.update(boss, 130);
    expect(shields()).toEqual(first); // Stable edge IDs reuse meshes and materials.
    for (const mesh of shields()) {
      const owner = world.survey.edgeLey[mesh.userData.edge];
      expect(mesh.material.uniforms.uColor.value).toEqual(new THREE.Color(world.factions[owner].color));
    }
    expect(new Set(shields().map(m => m.material.uniforms.uColor)).size).toBe(9);
    expect(new Set(shields().map(m => m.material.uniforms.uTime)).size).toBe(1);
    fx.dispose();
  });

  it('reprojects, updates owners and clears only broken-loop fields while retaining intact ones', () => {
    const { world, boss } = square(), { fx, shields } = effect(world);
    addLoop(world, -1, -3);
    fx.update(boss, 100); expect(shields()).toHaveLength(5);
    boss.pos.x = 1; fx.update(boss, 101);
    expect(shields().find(m => m.userData.edge === 0)!.position.x).toBe(-3);
    world.survey.edgeLey.fill(3, 4); world.survey.version++; fx.update(boss, 102);
    for (const mesh of shields().filter(m => m.userData.edge >= 4))
      expect(mesh.material.uniforms.uColor.value).toEqual(new THREE.Color(world.factions[3].color));
    const removed = shields().filter(m => m.userData.edge >= 4), disposed = removed.map(m => vi.spyOn(m.material, 'dispose'));
    world.survey.edgeLey[6] = -1; world.survey.version++; fx.update(boss, 103);
    expect(shields().map(m => m.userData.edge)).toEqual([0]);
    for (const spy of disposed) expect(spy).toHaveBeenCalledOnce();
    for (const mesh of removed) expect(mesh.parent).toBeNull();
    world.survey.edgeLey[2] = -1; world.survey.version++; fx.update(boss, 104);
    expect(shields()).toHaveLength(0); fx.dispose();
  });

  it('rechecks changed geometry and resets retained ranges on death or missing/replaced boss', () => {
    const { world, boss } = square(), { fx, shields } = effect(world);
    fx.update(boss, 100); expect(shields()).toHaveLength(1);
    const first = bossForcefieldContacts(world, boss);
    boss.pos.z = -5.1;
    expect(bossForcefieldContacts(world, { ...boss, id: boss.id + 1 }, first)).toHaveLength(0);
    boss.deathAt = 100; fx.update(boss, 100); expect(shields()).toHaveLength(0);
    boss.deathAt = null; boss.hp = 0; expect(bossForcefieldContacts(world, boss)).toHaveLength(0);
    boss.hp = 100; boss.action = 'dead'; expect(bossForcefieldContacts(world, boss)).toHaveLength(0);
    boss.action = 'idle'; boss.pos.z = -4; fx.update(boss, 101); expect(shields()).toHaveLength(1);
    fx.update(null, 102); expect(shields()).toHaveLength(0); expect(fx.group.visible).toBe(false);
    boss.pos.z = -5.1; fx.update(boss, 103); expect(shields()).toHaveLength(0);
    boss.pos.z = -4; fx.update(boss, 104); expect(shields()).toHaveLength(1);
    for (const n of world.lattice.nodes) n.z += 30;
    world.lattice.version++; fx.update(boss, 105); expect(shields()).toHaveLength(0); fx.dispose();
  });

  it('preserves the approved ring shader, opacity and additive gains on every plane', () => {
    const { world, boss } = square(), { fx, shields } = effect(world);
    boss.pos = { x: -12, z: -2 }; fx.update(boss, 100); expect(shields()).toHaveLength(2);
    for (const { material } of shields()) {
      expect(material).toMatchObject({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 });
      expect(material.fragmentShader).toContain('mod(r-uTime*.08+.0475,.095)');
      expect(material.fragmentShader).toContain('rim*.65+wave*.9+grid*.16');
      expect(material.fragmentShader).toContain('uColor*alpha*2.3,alpha');
      expect(material.fragmentShader).not.toContain('uAge');
    }
    fx.dispose();
  });
});

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));
describe('multi-line forcefield reconstruction on peers and late joins', () => {
  it('reconstructs every corner edge, colors, departure, broken loops and death from replicated state', () => {
    const host = createMatch({ seed: 'boss-forcefield-net', difficulty: 'normal', mode: 'standard', humans: [0, 1] });
    const enc = new SnapshotEncoder(host);
    const peers = [NetMirror.create(host.options, wire(enc.full())), NetMirror.create(host.options, wire(enc.full()))];
    host.boss = bossFixture(); host.boss.barrier = null; host.boss.held = null; host.boss.action = 'idle';
    const edge = host.lattice.edges[bossLoopEdges(host)[0]], node = host.lattice.nodes[edge.a];
    host.boss.pos = { x: node.x, z: node.z };
    expect(bossForcefieldContacts(host, host.boss).length).toBeGreaterThanOrEqual(2);
    const flush = () => {
      host.tick++; host.time += 1;
      const frame = wire({ tick: host.tick, time: host.time, acks: {}, delta: enc.delta([]), events: [] });
      for (const peer of peers) { peer.push(frame); peer.catchUp(); }
      const late = NetMirror.create(host.options, wire(enc.full()));
      const expected = bossForcefieldContacts(host, host.boss);
      for (const peer of [...peers, late]) {
        const contacts = bossForcefieldContacts(peer.world, peer.world.boss);
        expect(contacts.map(c => [c.edge, c.faction])).toEqual(expected.map(c => [c.edge, c.faction]));
        contacts.forEach((contact, i) => {
          // Boss wire positions are quantized to centimetres.
          expect(Math.hypot(contact.x - expected[i].x, contact.z - expected[i].z)).toBeLessThan(.015);
        });
        expect(peer.world.boss!.barrier).toBeNull(); expect(peer.world.drainEvents()).toEqual([]);
      }
    };
    flush(); host.boss.eye.chargeAt = host.time; flush();
    host.boss.pos = { x: 500, z: 500 }; expect(bossForcefieldContacts(host, host.boss)).toHaveLength(0); flush();
    host.boss.pos = { x: node.x, z: node.z }; flush();
    host.boss.hp = 0; host.boss.deathAt = host.time; host.boss.action = 'death'; flush();
    host.boss.hp = 100; host.boss.deathAt = null; host.boss.action = 'idle'; flush();
    host.survey.edgeLey.fill(-1); host.survey.version++; expect(bossForcefieldContacts(host, host.boss)).toHaveLength(0); flush();
  });
});
