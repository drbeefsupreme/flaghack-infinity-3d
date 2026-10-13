import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../game/session';
import { normalizeMatch } from '../../sim/matchSettings';
import { createMatch } from '../../sim/setup';
import { spawnBoss } from '../../sim/systems/boss';
import { BossVisionFeature } from './bossVision';
import { createSurveyUniforms } from './glsl';
import { LabelAtlas } from './labels';

function setup() {
  const canvas = { width: 0, height: 0, getContext: () => ({
    clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillText() {}, measureText: (text: string) => ({ width: text.length * 18 }),
  }) };
  vi.stubGlobal('document', { createElement: () => canvas });
  const world = createMatch({ seed: 'acid-render', mode: 'standard', difficulty: 'normal', humans: [0, 1], match: normalizeMatch({ maxSignifiers: 0 }) });
  world.time = 1000; world.effigyRevealedAt = 990; world.factions[0].drugActive.acidcop = 1030;
  const boss = spawnBoss(world)!; boss.action = 'idle'; boss.objectiveAltarId = world.hearthOf(3)!.id;
  boss.target = { kind: 'avatar', id: world.avatarOf(1).id };
  world.hearthOf(3)!.pos = { x: -10, z: 0 }; world.avatarOf(1).pos = { x: 10, y: 0, z: 0 };
  const scene = new THREE.Scene(), session = new Session(); session.screen = 'playing';
  const texture = new THREE.DataTexture(), uniforms = createSurveyUniforms({ node: texture, aux: texture, edge: texture, facet: texture });
  const feature = new BossVisionFeature(scene, world, session, uniforms);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, .1, 500); camera.position.set(0, 20, 70); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const update = () => feature.update(camera, new THREE.Vector2(1280, 720), 1);
  const [front, behind, labels, hiddenLabels] = scene.children as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>[];
  const cleanup = () => { feature.dispose(); texture.dispose(); };
  return { world, boss, scene, session, feature, front, behind, labels, hiddenLabels, update, cleanup };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Acid world markers', () => {
  it('uses through-wall paired layers and labels distinct objective and tactical targets', () => {
    const e = setup(), acquire = vi.spyOn(LabelAtlas.prototype, 'acquire'); e.update();
    expect(e.front.geometry.instanceCount).toBe(50); expect(e.front.visible).toBe(true); expect(e.behind.visible).toBe(true);
    expect(e.behind.material.depthFunc).toBe(THREE.GreaterDepth); expect(e.front.material.depthWrite).toBe(false);
    expect(e.front.material.forceSinglePass).toBe(true); expect(e.front.frustumCulled).toBe(false);
    expect(acquire.mock.calls.map(c => c[0])).toEqual(['CHOSEN ALTAR', 'TACTICAL · VEXILLOMANCER']);
    expect(e.labels.geometry.instanceCount).toBe(2); expect(e.hiddenLabels.visible).toBe(true);
    expect(e.front.material.fragmentShader).toContain('FH_OCCLUDED');
    e.cleanup();
  });

  it('draws actual committed route separately from the intercepted ray and stacks collocated labels', () => {
    const e = setup(), acquire = vi.spyOn(LabelAtlas.prototype, 'acquire');
    Object.assign(e.boss.eye, { chargeAt: 1000, firedAt: 1003, route: [{ x: 0, y: 0, z: 10 }, { x: 15, y: 0, z: -20 }],
      origin: { x: 0, y: 20, z: 0 }, direction: { x: 0, y: -1, z: 1 }, impact: { x: 0, y: 0, z: 10 } });
    e.world.time = 1004; e.update();
    const a = e.front.geometry.getAttribute('iA'), b = e.front.geometry.getAttribute('iB');
    const dashed: number[] = [], actual: number[] = [];
    for (let i = 0; i < e.front.geometry.instanceCount; i++) {
      if (b.getW(i)) dashed.push(i);
      if (a.getX(i) === 0 && a.getY(i) === 20 && a.getZ(i) === 0) actual.push(i);
    }
    expect(dashed).toHaveLength(1); expect(actual).toHaveLength(1);
    expect([b.getX(dashed[0]), b.getY(dashed[0]), b.getZ(dashed[0])]).toEqual([15, 0, -20]);
    expect([b.getX(actual[0]), b.getY(actual[0]), b.getZ(actual[0])]).toEqual([0, 0, 10]);
    expect(acquire.mock.calls.map(c => c[0])).toContain('ACTUAL IMPACT');
    expect(acquire.mock.calls.map(c => c[0])).toContain('AIM PLAN 2');
    const size = e.labels.geometry.getAttribute('iSize');
    expect(size.getZ(e.labels.geometry.instanceCount - 1)).toBeGreaterThan(0);
    e.cleanup();
  });

  it('removes aim/impact immediately on cancellation, without easing out stale committed routes', () => {
    const e = setup();
    Object.assign(e.boss.eye, { chargeAt: 1000, route: [{ x: 0, y: 0, z: 10 }, { x: 15, y: 0, z: -20 }] });
    e.update(); expect(e.front.geometry.instanceCount).toBeGreaterThan(50);
    e.boss.eye.chargeAt = null; e.update(); expect(e.front.geometry.instanceCount).toBe(50); expect(e.labels.geometry.instanceCount).toBe(2);
    e.cleanup();
  });

  it('combines coincident strategic/tactical altar labels and never leaks prior markers on lifecycle changes', () => {
    const e = setup(), acquire = vi.spyOn(LabelAtlas.prototype, 'acquire');
    e.boss.target = { kind: 'building', id: e.boss.objectiveAltarId! }; e.update();
    expect(e.front.geometry.instanceCount).toBe(25); expect(e.labels.geometry.instanceCount).toBe(1);
    expect(acquire).toHaveBeenCalledWith('CHOSEN ALTAR + TACTICAL TARGET', expect.any(Number));
    const hidden = () => {
      e.update();
      for (const mesh of [e.front, e.behind, e.labels, e.hiddenLabels]) {
        expect(mesh.visible).toBe(false); expect(mesh.geometry.instanceCount).toBe(0);
      }
    };
    e.world.time = 1030; hidden(); e.world.time = 1000; e.update(); expect(e.front.visible).toBe(true);
    e.session.spectator = true; hidden(); e.session.spectator = false;
    e.session.playerFaction = 1; hidden(); e.session.playerFaction = 0;
    e.session.screen = 'title'; hidden(); e.session.screen = 'playing';
    e.boss.hp = 0; hidden(); e.boss.hp = 50000;
    e.world.effigyRevealedAt = null; hidden(); e.world.effigyRevealedAt = 990;
    e.world.boss = null; hidden(); e.world.boss = e.boss; e.update(); expect(e.front.visible).toBe(true);
    const materials = [e.front, e.behind, e.labels, e.hiddenLabels].map(mesh => vi.spyOn(mesh.material, 'dispose'));
    const geometry = vi.spyOn(e.front.geometry, 'dispose'), atlas = vi.spyOn(LabelAtlas.prototype, 'dispose');
    e.cleanup(); expect(e.scene.children).toEqual([]); expect(geometry).toHaveBeenCalledTimes(1); expect(atlas).toHaveBeenCalledTimes(1);
    for (const dispose of materials) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
