import { describe, expect, it } from 'vitest';
import { BOSS_INTERRUPT_IMMUNITY, BOSS_OMEGA_DAMAGE, BOSS_RECOIL_DURATION, BOSS_TIMING, type BossAction } from '../boss';
import { ABILITY, SIM_DT } from '../constants';
import { spawnFlag, spawnHippie } from '../factory';
import { normalizeMatch } from '../matchSettings';
import { createMatch } from '../setup';
import { Simulation } from '../simulation';
import { FACTION_IDS, type FactionId } from '../types';
import type { World } from '../world';
import { SnapshotEncoder } from '../../net/codec';
import { NetMirror } from '../../net/mirror';
import { abilityBlocker, cmdAbility } from './abilities';
import { interruptBossGrab, spawnBoss, updateBoss } from './boss';

function encounter() {
  const w = createMatch({ seed: 'boss-omega', difficulty: 'normal', humans: [0, 1, 2, 3], mode: 'standard',
    match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 1000; w.effigyRevealedAt = 990; w.suddenDeath = true;
  const b = spawnBoss(w)!;
  Object.assign(b, { pos: { x: 0, z: 0 }, action: 'idle', actionAt: w.time, nextAttackAt: 0 });
  b.eye.nextFireAt = 100000;
  w.survey.edgeLey.fill(-1); w.survey.version++;
  for (const f of FACTION_IDS) {
    w.factions[f].chakras.finial = 1;
    w.avatarOf(f).pos = { x: 4 + f, y: 0, z: 0 };
  }
  for (const h of w.hippies.values()) h.pos = { x: 90, z: 90 };
  return { w, b };
}
function pulse(w: World, faction: FactionId = 0): void {
  cmdAbility(w, { t: 'ability', faction, ability: 'omega', at: { x: 0, z: 0 }, node: -1 });
}
function meal(w: World, kind: 'altar' | 'flag', age: number) {
  const b = w.boss!;
  const target = kind === 'altar' ? w.hearthOf(1)! : spawnFlag(w, { owner: 1, state: 'loose', pos: { x: 0, y: 0, z: 6 } });
  target.pos.x = 0; target.pos.z = 6;
  b.action = 'grab'; b.actionAt = w.time - age; b.actionSeq++; b.hitSeq = b.actionSeq - 1;
  b.crouched = true; b.held = null;
  b.target = { kind: kind === 'altar' ? 'building' : 'flag', id: target.id };
  b.nextAttackAt = 0;
  if (kind === 'altar') b.objectiveAltarId = target.id;
  return target;
}
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('Omega boss damage and bounded meal interrupt', () => {
  it.each([1, 2, 3])('deals exactly 500 at the unchanged level %s radius, with the original 75s cooldown', level => {
    const { w, b } = encounter(), av = w.avatarOf(0), hp = b.hp;
    w.factions[0].chakras.finial = level;
    av.pos = { x: ABILITY.omega.radius[level - 1], y: 0, z: 0 };
    expect(ABILITY.omega.radius).toEqual([12, 16, 20]); expect(ABILITY.omega.cooldown).toBe(75);
    pulse(w); expect(b.hp).toBe(hp - 500); expect(BOSS_OMEGA_DAMAGE).toBe(500);
    expect(w.factions[0].cooldowns.omega).toBe(w.time + 75);
    pulse(w); expect(b.hp).toBe(hp - 500); expect(abilityBlocker(w, 0, 'omega')).toMatch(/recharging/);
    w.time += 75; expect(abilityBlocker(w, 0, 'omega')).toBe('');
    av.pos.x += .001; pulse(w); expect(b.hp).toBe(hp - 500);
  });

  it('retains 40 damage and knockback against an ordinary enemy hippie before the reveal', () => {
    const { w } = encounter(); w.boss = null; w.effigyRevealedAt = null;
    const h = spawnHippie(w, 1, { x: 6, z: 0 }), hp = h.hp;
    pulse(w); expect(h.hp).toBe(hp - 40); expect(ABILITY.omega.damage).toBe(40);
    expect(h.vel).toEqual({ x: ABILITY.omega.knockback, z: 0 });
  });

  for (const kind of ['altar', 'flag'] as const) for (const age of [.5, 2, BOSS_TIMING.consume]) {
    it(`releases an unconsumed ${kind} at meal age ${age} and recoils for 1s`, () => {
      const { w, b } = encounter(), target = meal(w, kind, age), at = w.time;
      if (age < BOSS_TIMING.consume) updateBoss(w, SIM_DT);
      if (age >= BOSS_TIMING.grasp && age < BOSS_TIMING.consume) expect(b.held?.id).toBe(target.id);
      const seq = b.actionSeq, hp = b.hp;
      pulse(w);
      expect(b.hp).toBe(hp - 500); expect(b.action).toBe('recoil'); expect(b.held).toBeNull();
      expect(b.actionAt).toBe(at); expect(b.actionSeq).toBe(seq + 1); expect(b.crouched).toBe(true);
      expect(b.interruptImmuneUntil).toBe(at + 20);
      const pos = { ...b.pos }, yaw = b.yaw;
      w.time = at + BOSS_RECOIL_DURATION - .001; updateBoss(w, SIM_DT);
      expect(b.action).toBe('recoil'); expect(b.pos).toEqual(pos); expect(b.yaw).toBe(yaw);
      expect(kind === 'altar' ? w.buildings.has(target.id) : w.flags.has(target.id)).toBe(true);
      expect(w.factions[1].alive).toBe(true);
      w.time = at + BOSS_RECOIL_DURATION; updateBoss(w, SIM_DT);
      expect(b.action).not.toBe('recoil');
    });
  }

  it.each(['altar', 'flag'] as const)('never restores an already consumed %s or cancels its remaining recovery', kind => {
    const { w, b } = encounter(), target = meal(w, kind, BOSS_TIMING.consume);
    updateBoss(w, SIM_DT);
    expect(b.hitSeq).toBe(b.actionSeq);
    expect(kind === 'altar' ? w.buildings.has(target.id) : w.flags.has(target.id)).toBe(false);
    const seq = b.actionSeq, at = b.actionAt, hp = b.hp;
    pulse(w);
    expect(b.hp).toBe(hp - 500); expect(b.action).toBe('grab'); expect(b.actionSeq).toBe(seq); expect(b.actionAt).toBe(at);
    expect(b.interruptImmuneUntil).toBe(0);
    expect(kind === 'altar' ? w.buildings.has(target.id) : w.flags.has(target.id)).toBe(false);
    if (kind === 'altar') expect(w.factions[1].alive).toBe(false);
  });

  it('four same-tick players cause 2000 damage but only one shared recoil and no extension', () => {
    const { w, b } = encounter(); meal(w, 'altar', 2);
    const hp = b.hp, seq = b.actionSeq;
    for (const faction of FACTION_IDS) w.submit({ t: 'ability', faction, ability: 'omega', at: { x: 0, z: 0 }, node: -1 });
    new Simulation(w).step();
    expect(b.hp).toBe(hp - 2000); expect(b.action).toBe('recoil'); expect(b.actionSeq).toBe(seq + 1);
    expect(b.interruptImmuneUntil).toBe(w.time + BOSS_INTERRUPT_IMMUNITY);
    for (const faction of FACTION_IDS) expect(w.factions[faction].cooldowns.omega).toBe(w.time + 75);
  });

  it('does not restart recoil or extend immunity when another player pulses during recovery', () => {
    const { w, b } = encounter(); meal(w, 'altar', 2); pulse(w, 0);
    const hp = b.hp, at = b.actionAt, immuneUntil = b.interruptImmuneUntil, seq = b.actionSeq;
    w.time += .5; pulse(w, 1);
    expect(b.hp).toBe(hp - 500); expect(b.actionAt).toBe(at); expect(b.actionSeq).toBe(seq);
    expect(b.interruptImmuneUntil).toBe(immuneUntil);
    w.time = at + 1; updateBoss(w, SIM_DT); expect(b.action).not.toBe('recoil');
  });

  it('finishes recoil before an imminent eye charge and retains the full charge duration', () => {
    const { w, b } = encounter(); meal(w, 'altar', 2);
    b.eye.nextFireAt = w.time + 3.25;
    pulse(w);
    const at = b.actionAt, scheduled = b.eye.nextFireAt;
    w.time = at + .5; updateBoss(w, SIM_DT);
    expect(b.action).toBe('recoil'); expect(b.eye.chargeAt).toBeNull(); expect(b.eye.nextFireAt).toBe(scheduled);
    w.time = at + 1; updateBoss(w, SIM_DT);
    expect(b.action).toBe('idle'); expect(b.eye.chargeAt).toBe(w.time); expect(b.eye.nextFireAt).toBe(w.time + 3);
  });

  it('blocks further meal interrupts until the exact shared 20s boundary while every pulse still damages', () => {
    const { w, b } = encounter(); meal(w, 'altar', 2); pulse(w, 0);
    const immuneUntil = b.interruptImmuneUntil;
    w.time = immuneUntil - .001; meal(w, 'altar', 2);
    const hp = b.hp, seq = b.actionSeq, at = b.actionAt;
    pulse(w, 1);
    expect(b.hp).toBe(hp - 500); expect(b.action).toBe('grab'); expect(b.actionSeq).toBe(seq); expect(b.actionAt).toBe(at);
    expect(b.interruptImmuneUntil).toBe(immuneUntil);
    w.time = immuneUntil; pulse(w, 2);
    expect(b.hp).toBe(hp - 1000); expect(b.action).toBe('recoil'); expect(b.interruptImmuneUntil).toBe(immuneUntil + 20);
  });

  it.each(['emerge', 'idle', 'walk', 'crouch', 'crouchWalk', 'rise', 'swipe', 'stomp'] as BossAction[])(
    'damages during %s without interrupting or starting immunity', action => {
      const { w, b } = encounter(); b.action = action;
      const hp = b.hp, seq = b.actionSeq, at = b.actionAt;
      pulse(w);
      expect(b.hp).toBe(hp - 500); expect(b.action).toBe(action); expect(b.actionSeq).toBe(seq); expect(b.actionAt).toBe(at);
      expect(b.interruptImmuneUntil).toBe(0);
    });

  it.each([false, true])('never cancels or retimes active eye state (fired=%s), even with a stale grab action', fired => {
    const { w, b } = encounter(); meal(w, 'altar', 2);
    Object.assign(b.eye, { chargeAt: w.time - 2, firedAt: fired ? w.time - .5 : null, nextFireAt: w.time + 1,
      target: { x: 0, y: 0, z: 20 }, route: [{ x: 0, y: 0, z: 20 }], sample: fired ? 30 : -1, damaged: [123], knockedFlags: [456] });
    const eye = structuredClone(b.eye), hp = b.hp, seq = b.actionSeq;
    pulse(w);
    expect(b.hp).toBe(hp - 500); expect(b.eye).toEqual(eye); expect(b.action).toBe('grab'); expect(b.actionSeq).toBe(seq);
    expect(b.interruptImmuneUntil).toBe(0);
  });

  it('keeps reveal, lethal damage and death authoritative, without replacing them with recoil', () => {
    const { w, b } = encounter(); meal(w, 'altar', 2);
    w.effigyRevealedAt = null; expect(interruptBossGrab(w)).toBe(false);
    w.effigyRevealedAt = 990; b.hp = 500;
    b.eye.chargeAt = w.time - 1; b.eye.target = { x: 0, y: 0, z: 20 };
    pulse(w);
    expect(b.hp).toBe(0); expect(b.action).toBe('death'); expect(b.deathAt).toBe(w.time);
    expect(b.held).toBeNull(); expect(b.eye.chargeAt).toBeNull(); expect(b.interruptImmuneUntil).toBe(0);
    const seq = b.actionSeq; pulse(w, 1);
    expect(b.action).toBe('death'); expect(b.actionSeq).toBe(seq);
  });

  it('replicates recoil and shared immunity through deltas, late joins and recovery without replay or reset leakage', () => {
    const { w, b } = encounter(); meal(w, 'altar', 2); updateBoss(w, SIM_DT);
    const enc = new SnapshotEncoder(w), mirror = NetMirror.create(w.options, wire(enc.full()));
    pulse(w); w.tick++;
    const frame = wire({ tick: w.tick, time: w.time, acks: {}, delta: enc.delta([]), events: [] });
    mirror.push(frame); mirror.catchUp();
    const late = NetMirror.create(w.options, wire(enc.full()));
    for (const peer of [mirror, late]) {
      expect(peer.world.boss?.action).toBe('recoil'); expect(peer.world.boss?.held).toBeNull();
      expect(peer.world.boss?.interruptImmuneUntil).toBe(b.interruptImmuneUntil); expect(peer.world.drainEvents()).toEqual([]);
      expect(peer.world.buildings.has(b.target!.id)).toBe(true);
    }
    w.time += 1; w.tick++; updateBoss(w, SIM_DT);
    const delta = wire(enc.delta([]));
    mirror.push({ tick: w.tick, time: w.time, acks: {}, delta, events: [] }); mirror.catchUp();
    expect(mirror.world.boss?.action).toBe(b.action); expect(mirror.world.boss?.interruptImmuneUntil).toBe(b.interruptImmuneUntil);
    expect(encounter().b.interruptImmuneUntil).toBe(0);
    expect(createMatch(w.options).boss).toBeNull();
  });
});
