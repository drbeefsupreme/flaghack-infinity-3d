import { describe, expect, it, vi } from 'vitest';
import { SnapshotEncoder } from '../net/codec';
import { NetMirror } from '../net/mirror';
import { BOSS_EYE_TIMING } from '../sim/boss';
import { DRUG, SIM_DT } from '../sim/constants';
import { spawnFlag, spawnHippie, spawnPiece } from '../sim/factory';
import { normalizeMatch } from '../sim/matchSettings';
import { createMatch } from '../sim/setup';
import { consumeBuilding, spawnBoss, updateBoss } from '../sim/systems/boss';
import { damageEntity } from '../sim/systems/combat';
import { cmdDrug } from '../sim/systems/drugs';
import { attachPiece } from '../sim/systems/pieces';
import { bossVision } from './bossVision';
import { Session } from './session';

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture() {
  const world = createMatch({ seed: 'acid-boss-intel', mode: 'standard', difficulty: 'normal', humans: [0, 1], match: normalizeMatch({ maxSignifiers: 0 }) });
  world.time = 1000; world.effigyRevealedAt = 990;
  const boss = spawnBoss(world)!;
  Object.assign(boss, { action: 'idle', actionAt: world.time, nextAttackAt: 0, objectiveAltarId: world.hearthOf(3)!.id });
  boss.eye.nextFireAt = 9999;
  for (const a of world.avatars.values()) a.pos = { x: 0, y: 0, z: -105 };
  const session = new Session(); session.screen = 'playing';
  world.factions[0].drugs.acidcop = 1; cmdDrug(world, { t: 'drug', faction: 0, drug: 'acidcop' });
  world.drainEvents();
  const read = () => bossVision(world, session);
  return { world, boss, session, read };
}

describe('local Acid encounter intelligence', () => {
  it('uses the original exact 30-second timer and preserves rival mesh taps', () => {
    const { world, read } = fixture();
    expect(DRUG.duration.acidcop).toBe(30); expect(read()?.seconds).toBe(30);
    expect(world.factions[0].drugs.acidcop).toBe(0);
    for (const f of [1, 2, 3] as const) expect(world.factions[0].meshTap[f]).toBe(1030);
    world.time = 1029.999; expect(read()?.seconds).toBeCloseTo(.001);
    world.time = 1030; expect(read()).toBeNull();
    world.time = 1031; expect(read()).toBeNull();
  });

  it.each(['title', 'lobby', 'paused', 'ended'] as const)('clears on %s without spoilers', screen => {
    const { read, session } = fixture(); expect(read()).not.toBeNull(); session.screen = screen; expect(read()).toBeNull();
  });
  it('requires a living, revealed standard encounter and living local seat', () => {
    const { world, session, boss, read } = fixture();
    session.spectator = true; expect(read()).toBeNull(); session.spectator = false;
    session.followFaction = 1; expect(read()).not.toBeNull(); // Following is not an effect source.
    world.factions[0].alive = false; expect(read()).toBeNull(); world.factions[0].alive = true;
    world.phase = 'ended'; expect(read()).toBeNull(); world.phase = 'playing';
    world.effigyRevealedAt = null; expect(read()).toBeNull(); world.effigyRevealedAt = 1001; expect(read()).toBeNull(); world.effigyRevealedAt = 990;
    boss.hp = 0; expect(read()).toBeNull(); boss.hp = boss.maxHp;
    boss.deathAt = 1000; expect(read()).toBeNull(); boss.deathAt = null;
    boss.action = 'death'; expect(read()).toBeNull(); boss.action = 'dead'; expect(read()).toBeNull(); boss.action = 'idle';
    world.boss = null; expect(read()).toBeNull(); world.boss = boss;
    world.options.mode = 'tutorial'; expect(read()).toBeNull(); world.options.mode = 'standard';
    world.options.humans = []; expect(read()).toBeNull();
    expect(bossVision(null, session)).toBeNull();
  });

  it('reads only the player faction, not another active faction or spectator follow target', () => {
    const { world, session, read } = fixture();
    session.playerFaction = 1; session.followFaction = 0; expect(read()).toBeNull();
    world.factions[1].drugActive.acidcop = 1020; expect(read()?.seconds).toBe(20);
    session.spectator = true; expect(read()).toBeNull();
    session.spectator = false; session.playerFaction = 0; expect(read()?.seconds).toBe(30);
    world.avatarOf(0).koUntil = 1005; expect(read()?.seconds).toBe(30); // Existing faction drug survives a temporary KO.
  });

  it('never predicts a random objective, and tracks actual host reselection', () => {
    const { world, boss, read } = fixture();
    const rng = vi.spyOn(world.rng, 'next').mockReturnValue(.8);
    boss.objectiveAltarId = null; expect(read()?.objective).toBeNull(); expect(rng).not.toHaveBeenCalled();
    updateBoss(world, SIM_DT); const chosen = world.buildings.get(boss.objectiveAltarId!)!;
    expect(read()?.objective?.id).toBe(chosen.id); expect(rng).toHaveBeenCalledTimes(1);
    consumeBuilding(world, chosen); expect(read()?.objective).toBeNull();
    boss.action = 'idle'; boss.nextAttackAt = 0; updateBoss(world, SIM_DT);
    expect(read()?.objective?.id).toBe(boss.objectiveAltarId); expect(boss.objectiveAltarId).not.toBe(chosen.id);
    const calls = rng.mock.calls.length, before = JSON.stringify(boss);
    for (let i = 0; i < 30; i++) read();
    expect(rng).toHaveBeenCalledTimes(calls); expect(JSON.stringify(boss)).toBe(before);
  });

  it('reveals actual retaliation separately from the chosen altar, then follows the host return', () => {
    const { world, boss, read } = fixture(), avatar = world.avatarOf(0);
    avatar.pos = { x: boss.pos.x + 25, y: 0, z: boss.pos.z };
    damageEntity(world, boss.id, 22, avatar.id); updateBoss(world, SIM_DT);
    expect(read()?.objective?.id).toBe(world.hearthOf(3)!.id);
    expect(read()?.tactical).toMatchObject({ kind: 'avatar', id: avatar.id, at: avatar.pos });
    avatar.pos.x += 3; expect(read()?.tactical?.at.x).toBe(avatar.pos.x);
    avatar.koUntil = world.time + 5; expect(read()?.tactical).toBeNull(); avatar.koUntil = 0;
    world.time = boss.retaliateUntil + 1; boss.action = 'idle'; updateBoss(world, SIM_DT);
    expect(read()?.tactical?.id).toBe(boss.objectiveAltarId);
  });

  it('drops missing or invalid live targets instead of retaining stale markers', () => {
    const { world, boss, read } = fixture();
    const h = spawnHippie(world, 1, { x: 8, z: 9 });
    boss.target = { kind: 'hippie', id: h.id }; expect(read()?.tactical?.id).toBe(h.id);
    h.status = 'ko'; expect(read()?.tactical).toBeNull(); world.hippies.delete(h.id); expect(read()?.tactical).toBeNull();
    const flag = spawnFlag(world, { state: 'loose', owner: 2, pos: { x: 8, y: 3, z: 9 } });
    boss.target = { kind: 'flag', id: flag.id }; expect(read()?.tactical).toMatchObject({ at: flag.pos, faction: 2 });
    flag.state = 'carried'; expect(read()?.tactical).toBeNull();
    const piece = spawnPiece(world, 'wall', 1, 0, -1, 2, 0);
    attachPiece(world, piece);
    boss.target = { kind: 'piece', id: piece.id }; expect(read()?.tactical).toMatchObject({ name: 'Wall', faction: 1 });
    world.pieces.delete(piece.id); expect(read()?.tactical).toBeNull();
    boss.target = { kind: 'building', id: boss.objectiveAltarId! }; expect(read()?.tactical?.id).toBe(boss.objectiveAltarId);
    world.buildings.delete(boss.objectiveAltarId!); expect(read()?.tactical).toBeNull(); expect(read()?.objective).toBeNull();
  });
});

describe('committed eye intelligence', () => {
  it('ignores stored route/aim/ray before charge, including future and obsolete clocks', () => {
    const { world, boss, read } = fixture();
    Object.assign(boss.eye, { route: [{ x: 90, y: 0, z: 40 }], target: { x: 90, y: 0, z: 40 }, origin: { x: 0, y: 20, z: 0 }, direction: { x: 0, y: 0, z: 1 } });
    expect(read()?.eye).toBeNull();
    boss.eye.chargeAt = world.time + 1; expect(read()?.eye).toBeNull();
    boss.eye.chargeAt = boss.spawnedAt - 1; expect(read()?.eye).toBeNull();
    boss.eye.chargeAt = world.time; expect(read()?.eye).toMatchObject({ phase: 'charging', route: boss.eye.route, ray: null });
    world.time += BOSS_EYE_TIMING.charge; expect(read()?.eye).toBeNull();
    boss.eye.firedAt = world.time + 1; expect(read()?.eye).toBeNull();
  });

  it('keeps intended route separate from the actual occluded impact and stops exactly at beam end', () => {
    const { world, boss, read } = fixture();
    const route = [{ x: -30, y: 0, z: 90 }, { x: 30, y: 0, z: 90 }], impact = { x: 0, y: 9, z: 10 };
    Object.assign(boss.eye, { chargeAt: 1000, firedAt: 1003, route, target: route[0], origin: { x: 0, y: 20, z: 0 }, direction: { x: 0, y: -1, z: 1 }, impact });
    world.time = 1003;
    expect(read()?.eye).toMatchObject({ phase: 'firing', route, ray: { from: boss.eye.origin, to: impact, impact } });
    expect(read()?.eye?.route).not.toContainEqual(impact);
    boss.eye.impact = null; expect(read()?.eye?.ray).toMatchObject({ to: { x: 0, y: -220, z: 240 }, impact: null });
    world.time = 1007.999; expect(read()?.eye).not.toBeNull();
    world.time = 1008; expect(read()?.eye).toBeNull();
    boss.eye.firedAt = null; boss.eye.chargeAt = null; expect(boss.eye.route).toHaveLength(2); expect(read()?.eye).toBeNull();
  });

  it('derives identical live and late-join intel without local events, selection, or random draws', () => {
    const { world, boss, session, read } = fixture();
    // Snapshot positions use centimetre quantization; use exact wire-grid coordinates.
    for (const b of world.buildings.values()) { b.pos.x = Math.round(b.pos.x); b.pos.z = Math.round(b.pos.z); }
    boss.target = { kind: 'building', id: boss.objectiveAltarId! };
    Object.assign(boss.eye, { chargeAt: 1000, firedAt: null, route: [{ x: -30, y: 0, z: 90 }, { x: 30, y: 0, z: 90 }] });
    const encoder = new SnapshotEncoder(world), peer = NetMirror.create(world.options, wire(encoder.full()));
    expect(bossVision(peer.world, session)).toEqual(read());
    world.time = 1004; world.tick++;
    Object.assign(boss.eye, { firedAt: 1003, origin: { x: 0, y: 20, z: 0 }, direction: { x: 0, y: -.1, z: 1 }, impact: { x: 0, y: 9, z: 10 } });
    const frame = wire({ tick: world.tick, time: world.time, acks: {}, delta: encoder.delta([]), events: [] });
    peer.push(frame); peer.catchUp(); peer.push(frame); peer.catchUp();
    const late = NetMirror.create(world.options, wire(encoder.full()));
    for (const mirror of [peer, late]) {
      const rng = vi.spyOn(mirror.world.rng, 'next');
      expect(bossVision(mirror.world, session)).toEqual(read()); expect(rng).not.toHaveBeenCalled();
      expect(mirror.world.drainEvents()).toEqual([]);
      session.playerFaction = 1; expect(bossVision(mirror.world, session)).toBeNull(); session.playerFaction = 0;
      mirror.world.time = 1030; expect(bossVision(mirror.world, session)).toBeNull();
    }
  });
});
