import { BOSS_RECOIL_DURATION } from './boss';

/** Reuse only the existing crouched death clip's initial flinch, then recover.
 * Both renderer and numeric hit regions sample this identical approved pose clock.
 * The kneeling/death motion begins later and is never entered by a recoil.
 */
export function bossRecoilPoseTime(age: number): number {
  const t = Math.max(0, Math.min(1, age / BOSS_RECOIL_DURATION));
  return .7 * (t <= .25 ? t / .25 : (1 - t) / .75);
}
