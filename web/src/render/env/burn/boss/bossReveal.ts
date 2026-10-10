/** Presentation only: the simulation owns the reveal timestamp and the cleared obstacle. */
import * as THREE from 'three';
import type { EnvContext } from '../../envTypes';
import { BOSS_HEIGHT, disposeBossModel, loadBossModel } from './bossModel';
import type { BossModelLoader } from './bossModel';
import { RevealFx } from './revealFx';
import { BossRevealPose } from './revealPose';
import { BossCombatPose, BOSS_COMBAT_TIMING } from './combatPose';
import { BossCombatFx, applyBossDeathMaterial } from './combatFx';
import { BossImpactFx } from './impactFx';
import type { GameEvent } from '../../../../sim/events';
import { EFFIGY_BOSS_REVEAL_AT } from '../../../../sim/effigyBurn';
import { applyBossChargeMaterial, bossCharge, bossEmergence, bossFlash, smooth } from './revealTimeline';

function clipAtGround(material: THREE.Material): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vBossWorldY;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvBossWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBossWorldY;')
      .replace('void main() {', 'void main() {\nif (vBossWorldY < 0.028) discard;');
  };
  material.customProgramCacheKey = () => key + '-boss-ground-clip-v1';
}

export class BossReveal {
  readonly ready: Promise<void>;
  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private gesture: BossRevealPose | null = null;
  private combat: BossCombatPose | null = null;
  private combatFx: BossCombatFx | null = null;
  private fx: RevealFx;
  private impacts: BossImpactFx;
  private depth = new THREE.MeshDepthMaterial();
  private disposed = false;
  private age = -1;
  private burnElapsed = 0;
  private uWhite = { value: 0 };
  /** Available for diagnostics; an unavailable asset never substitutes a fake boss. */
  loadError: unknown = null;

  constructor(private env: EnvContext, loader: BossModelLoader = loadBossModel) {
    const at = env.ctx.world.map.effigy;
    this.root.name = 'boss-reveal';
    this.root.position.set(at.x, 0, at.z);
    env.root.add(this.root);
    this.fx = new RevealFx(env);
    this.root.add(this.fx.group);
    this.impacts = new BossImpactFx(env); this.root.add(this.impacts.group);
    clipAtGround(this.depth);
    this.ready = loader().then(async (model) => {
      if (this.disposed) { disposeBossModel(model); return; }
      this.model = model;
      // Capture the real bind/rest pose before the reveal constructor changes the arms.
      this.combat = new BossCombatPose(model);
      const combatFx = this.combatFx = new BossCombatFx(env, model);
      const materials = new Set<THREE.Material>();
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
        o.customDepthMaterial = this.depth;
      });
      for (const material of materials) {
        clipAtGround(material);
        applyBossDeathMaterial(material, combatFx.deathAge);
        // Shader override only: the original material parameters are never mutated.
        if (material instanceof THREE.MeshStandardMaterial) applyBossChargeMaterial(material, this.uWhite);
      }
      applyBossDeathMaterial(this.depth, combatFx.deathAge);
      this.root.add(model);
      this.root.add(combatFx.group);
      this.gesture = new BossRevealPose(model);
      this.pose();
      // The model is loaded at match start, long before ignition. Warm its real skinning shaders.
      if (typeof env.ctx.renderer.compileAsync === 'function' && env.ctx.scene) {
        const visible = model.visible;
        model.visible = true;
        await env.ctx.renderer.compileAsync(model, env.ctx.camera, env.ctx.scene);
        model.visible = visible;
      }
    }).catch((error: unknown) => {
      this.loadError = error;
      console.error('The skeletal boss model could not be loaded', error);
    });
  }

  private pose(): void {
    const emerged = this.age >= 0 ? 1 : bossEmergence(this.burnElapsed);
    // While waiting for authoritative state, remain white even if a client clock runs ahead.
    // The first authoritative reveal frame restores the source materials with no fade.
    this.uWhite.value = this.age < 0 && emerged > 0 ? 1 : 0;
    if (!this.model) return;
    const world = this.env.ctx.world, boss = world.boss;
    if (boss && this.age >= 0 && this.age >= BOSS_COMBAT_TIMING.emerge && boss.action !== 'emerge') {
      this.combat?.sample(boss, world.time);
    } else {
      this.combat?.restoreRest();
      this.gesture?.sample(this.age >= 0 ? EFFIGY_BOSS_REVEAL_AT + this.age : this.burnElapsed);
      if (boss && this.age >= 0) this.combat?.settleReveal(smooth(.35, BOSS_COMBAT_TIMING.emerge, this.age));
    }
    this.model.visible = emerged > 0 || this.age >= 0;
    if (boss?.deathAt !== null && boss?.deathAt !== undefined && world.time - boss.deathAt >= BOSS_COMBAT_TIMING.death) this.model.visible = false;
    this.model.position.x = boss && this.age >= 0 ? boss.pos.x - world.map.effigy.x : 0;
    this.model.position.z = boss && this.age >= 0 ? boss.pos.z - world.map.effigy.z : 0;
    this.model.rotation.y = boss && this.age >= 0 ? boss.yaw : 0;
    this.model.position.y = BOSS_HEIGHT * (emerged - 1);
    this.model.updateMatrixWorld(true);
    this.combatFx?.update(this.age >= 0 ? boss : null, world.time);
  }

  update(burnElapsed: number): void {
    this.burnElapsed = burnElapsed;
    const world = this.env.ctx.world;
    const revealed = world.effigyRevealedAt;
    this.age = revealed === null || revealed === undefined ? -1 : Math.max(0, world.time - revealed);
    this.pose();
    this.fx.update(this.age);
    this.impacts.update(world.time);
    const light = this.env.fireLight;
    if (this.age < 0) {
      const charge = bossCharge(burnElapsed);
      if (charge > 0) {
        light.color.lerp(new THREE.Color(1, 1, 1), charge);
        light.intensity += 180 * charge * charge;
        light.position.y = 12;
      }
      return;
    }
    const flash = bossFlash(this.age);
    light.position.set(world.map.effigy.x, 9, world.map.effigy.z);
    // The burst surrounds the boss, rather than re-whitening its just-restored materials.
    light.color.setRGB(1, 0.34, 0.08);
    light.intensity = flash * 45 + 24 * Math.exp(-this.age * 0.9);
    const death = this.combatFx?.deathAge.value ?? -1;
    if (death >= 0 && death < 12 && world.boss) {
      light.position.set(world.boss.pos.x, 5, world.boss.pos.z);
      light.intensity = 65 * smooth(0, 1.5, death) * (1 - smooth(8, 12, death));
    }
  }

  onEvent(event: GameEvent): void { this.impacts.onEvent(event); }

  dispose(): void {
    this.disposed = true;
    this.combatFx?.dispose();
    if (this.model) disposeBossModel(this.model);
    this.depth.dispose();
    this.fx.dispose();
    this.impacts.dispose();
    this.root.removeFromParent();
  }
}
