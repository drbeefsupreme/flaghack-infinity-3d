/** All presentation clocks are sampled from authoritative match time, never integrated. */
import { EFFIGY_BOSS_REVEAL_AT } from '../../../../sim/effigyBurn';
export const BOSS_CHARGE_START = EFFIGY_BOSS_REVEAL_AT - 5;
export const BOSS_EMERGED_AT = EFFIGY_BOSS_REVEAL_AT;
export function smooth(e0: number, e1: number, x: number): number {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
}
export const bossCharge = (burnElapsed: number) => smooth(BOSS_CHARGE_START, EFFIGY_BOSS_REVEAL_AT, burnElapsed);
export const bossEmergence = (burnElapsed: number) => smooth(BOSS_CHARGE_START, BOSS_EMERGED_AT, burnElapsed);
export const bossFlash = (age: number) => age < 0 ? 0 : Math.pow(1 - smooth(0, 0.28, age), 2);

export function applyBossChargeMaterial(mat: import('three').MeshStandardMaterial, charge: { value: number }): void {
  const before = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uBossCharge = charge;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBossCharge;')
      .replace('#include <lights_physical_fragment>', `
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uBossCharge);
        totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(18.0), pow(uBossCharge, 3.0));
        #include <lights_physical_fragment>`);
  };
  mat.customProgramCacheKey = () => key + '-boss-charge-v1';
}
