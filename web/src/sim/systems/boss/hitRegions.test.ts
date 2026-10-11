import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../../tests/bossFixture';
import { BOSS_EYE_REAR_DRAPE_DATA, BOSS_HIT_POSE_DATA, BOSS_HIT_REGION_NAMES, BOSS_HIT_REGION_STRIDE } from '../../bossHitPoseData';
import { BOSS_TIMING } from '../../boss';
import { BOSS_WALK_STRIDE } from '../../../render/env/burn/boss/combatPose';
import { sampleBossHitRegions } from './hitRegions';

describe('baked boss pose collision contract', () => {
  it('records the current model and animation source hashes', () => {
    const data = readFileSync(new URL('../../bossHitPoseData.ts', import.meta.url), 'utf8');
    const hashes = [...data.matchAll(/ \* (\S+) sha256 ([a-f0-9]{64})/g)];
    expect(hashes).toHaveLength(6);
    expect(hashes.map(([, source]) => source)).toContain('src/render/env/burn/boss/rearFlapPose.ts');
    expect(hashes.map(([, source]) => source)).toContain('src/render/env/burn/boss/bossModel.ts');
    for (const [, source, expected] of hashes) {
      const bytes = readFileSync(new URL(`../../../../${source}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex'), source).toBe(expected);
    }
  });

  it('uses the longer standing stride while preserving native crouch-walk distance', () => {
    expect(BOSS_HIT_POSE_DATA['walk:false'].phaseDistance).toBe(BOSS_WALK_STRIDE);
    expect(BOSS_WALK_STRIDE).toBe(4.875);
    expect(BOSS_HIT_POSE_DATA['crouchWalk:true'].phaseDistance).toBe(3.75);
    const boss = bossFixture(); boss.action = 'walk'; boss.crouched = false;
    for (const phase of [0, .17, .43, .8]) {
      boss.stride = phase * BOSS_WALK_STRIDE;
      const first = sampleBossHitRegions(boss, boss.actionAt);
      boss.stride += BOSS_WALK_STRIDE;
      const repeated = sampleBossHitRegions(boss, boss.actionAt + 30);
      repeated.forEach((value, i) => expect(value).toBeCloseTo(first[i], 10));
    }
  });

  it('exports finite head-bone positions and normalized rotations for numeric-only gaze sampling', () => {
    for (const clip of Object.values(BOSS_HIT_POSE_DATA)) for (const frame of clip.samples) {
      expect(frame.head).toHaveLength(7);
      expect(frame.head.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...frame.head.slice(3))).toBeCloseTo(1, 5);
    }
  });

  it('samples planted-foot transition IK densely around the straight-leg endpoints', () => {
    for (const key of ['crouch:false', 'rise:true']) {
      const { samples, duration } = BOSS_HIT_POSE_DATA[key];
      expect(samples[0].at).toBe(0); expect(samples.at(-1)!.at).toBe(duration);
      for (let i = 1; i < samples.length; i++) expect(samples[i].at - samples[i - 1].at).toBeLessThanOrEqual(.005 + 1e-9);
    }
  });

  it('keeps exact source skin weights for the head-fastened and coat-following drape', () => {
    for (const rig of Object.values(BOSS_EYE_REAR_DRAPE_DATA)) {
      expect(rig.rootOffset).toHaveLength(3); expect(rig.rootBowAxis).toHaveLength(3); expect(rig.rootPitchAxis).toHaveLength(3); expect(rig.target).toHaveLength(3); expect(rig.backAxis).toHaveLength(3);
      expect(rig.restQuaternion).toHaveLength(4); expect(rig.restHeadQuaternion).toHaveLength(4);
      expect(rig.tailLength).toBeCloseTo(2.24, 5);
      expect(rig.points.length % 8).toBe(0); expect(rig.points.length).toBeGreaterThan(800);
      expect(rig.points.every(Number.isFinite)).toBe(true);
      for (let i = 0; i < rig.points.length; i += 8) {
        expect(rig.points[i] + rig.points[i + 4]).toBeCloseTo(1, 5);
        expect(rig.points[i]).toBeGreaterThanOrEqual(0); expect(rig.points[i + 4]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('starts aimed drape collision continuously, then tracks head tilt without changing body volumes', () => {
    for (const crouched of [false, true]) {
      const boss = bossFixture(); boss.action = 'idle'; boss.crouched = crouched; boss.yaw = .9;
      const at = boss.spawnedAt, base = sampleBossHitRegions(boss, at);
      boss.eye.chargeAt = at; boss.eye.target = { x: boss.pos.x - 15, y: 2, z: boss.pos.z - 10 };
      const zero = sampleBossHitRegions(boss, at);
      for (let i = 40; i < 50; i++) expect(zero[i]).toBeCloseTo(base[i], 3);
      const aimed = sampleBossHitRegions(boss, at + 3);
      expect(aimed).toHaveLength(base.length); expect([...aimed].every(Number.isFinite)).toBe(true);
      expect(aimed.slice(70)).toEqual(base.slice(70));
      expect(Math.hypot(aimed[40] - base[40], aimed[41] - base[41], aimed[42] - base[42])).toBeGreaterThan(.1);
      expect(sampleBossHitRegions(boss, at + 3)).toEqual(aimed);
      boss.eye.target = { x: boss.pos.x + 25, y: 0, z: boss.pos.z };
      const side = sampleBossHitRegions(boss, at + 3);
      expect(side.slice(40, 50)).not.toEqual(aimed.slice(40, 50));
      expect(side.slice(70)).toEqual(base.slice(70));
    }
  });

  it('samples the initial death clutch densely enough to preserve hand and head bounds', () => {
    for (const crouched of [false, true]) {
      const samples = BOSS_HIT_POSE_DATA[`death:${crouched}`].samples;
      for (let i = 1; samples[i].at <= .7; i++) expect(samples[i].at - samples[i - 1].at).toBeLessThanOrEqual(.02 + 1e-9);
      if (!crouched) for (const at of [.85, .9, .95, 2.05, 2.1, 2.15]) expect(samples.some(s => s.at === at)).toBe(true);
    }
  });

  for (const attack of ['swipe', 'grab'] as const) {
    it(`${attack} has the same crouched collision pose even with a stale standing bit`, () => {
      const low = BOSS_HIT_POSE_DATA[`${attack}:true`];
      expect(low.duration).toBe(BOSS_TIMING[attack]);
      if (attack === 'grab') for (const at of [3.54, 3.56, 3.58, 3.62, 3.64, 3.66]) expect(low.samples.some(s => s.at === at)).toBe(true);
      expect(BOSS_HIT_POSE_DATA[`${attack}:false`]).toEqual(low);
      const boss = bossFixture(); boss.action = attack;
      for (const age of [0, .01, BOSS_TIMING[attack] / 2, BOSS_TIMING[attack] - .01, BOSS_TIMING[attack]]) {
        boss.crouched = false;
        const standingBit = sampleBossHitRegions(boss, boss.actionAt + age);
        boss.crouched = true;
        expect(sampleBossHitRegions(boss, boss.actionAt + age)).toEqual(standingBit);
      }
    });

    it(`${attack} begins and recovers to the settled crouched pelvis and legs`, () => {
      const samples = BOSS_HIT_POSE_DATA[`${attack}:true`].samples;
      const crouch = BOSS_HIT_POSE_DATA['crouch:false'].samples.at(-1)!.regions;
      for (const name of ['pelvis', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const) {
        const start = BOSS_HIT_REGION_NAMES.indexOf(name) * BOSS_HIT_REGION_STRIDE;
        for (const frame of [samples[0], samples.at(-1)!]) {
          expect(frame.regions.slice(start, start + BOSS_HIT_REGION_STRIDE), name)
            .toEqual(crouch.slice(start, start + BOSS_HIT_REGION_STRIDE));
        }
      }
    });
  }
});
