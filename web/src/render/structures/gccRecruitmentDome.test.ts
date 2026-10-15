import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { RECRUIT_RADIUS } from '../../sim/constants';
import type { Building } from '../../sim/types';
import type { World } from '../../sim/world';
import type { FrameInfo } from './buildingView';
import { GccRecruitmentDome } from './gccRecruitmentDome';
import { GccView } from './gccView';
import { StructureKit } from './kit';

function fixture() {
  const b = { id: 7, kind: 'gcc', faction: 0, pos: { x: 23, z: -31 }, yaw: 0,
    hp: 600, maxHp: 600, built: 1, disabled: false,
    gcc: { destroyedUntil: 0, pushedBy: -1, channelUntil: 0 } } as Building;
  const world = { time: 100, factions: [{ alive: true, color: 0xff8844 }, { alive: true, color: 0x44aaff }],
    hearthOf: () => undefined } as unknown as World;
  return { b, world };
}

describe('GCC recruitment dome', () => {
  it('uses the exact recruitment radius as a hemisphere, with one faint, depth-tested pass', () => {
    const parent = new THREE.Group(), dome = new GccRecruitmentDome(parent);
    const mesh = dome.mesh;
    mesh.geometry.computeBoundingBox();
    expect(RECRUIT_RADIUS).toBe(15);
    expect(mesh.geometry.boundingBox!.min.toArray()).toEqual([-15, expect.closeTo(0), -15]);
    expect(mesh.geometry.boundingBox!.max.toArray()).toEqual([15, 15, 15]);
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i), p.getY(i), p.getZ(i))).toBeCloseTo(15, 5);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.depthTest).toBe(true);
    expect(mesh.material.forceSinglePass).toBe(true);
    expect(mesh.material.side).toBe(THREE.DoubleSide);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.visible).toBe(false);
    dome.dispose();
  });

  it('tracks actual recruitment availability, including delayed rebuild and eliminated faction', () => {
    const { b, world } = fixture(), dome = new GccRecruitmentDome(new THREE.Group());
    const check = (visible: boolean) => { dome.update(b, world); expect(dome.mesh.visible).toBe(visible); };
    check(true);
    b.disabled = true; check(false); b.disabled = false;
    b.built = 0.8; check(false); b.built = 1;
    b.gcc!.destroyedUntil = 90; check(false); // Even after the deadline, waiting for a free rebuild spot.
    b.gcc!.destroyedUntil = 0; check(true);
    world.factions[0].alive = false; check(false); world.factions[0].alive = true;
    b.faction = -1; check(false);
    b.faction = 1; check(true);
    expect(dome.mesh.material.uniforms.uColor.value.getHex()).toBe(0x44aaff);
    const geometry = dome.mesh.geometry, material = dome.mesh.material;
    for (let i = 0; i < 100; i++) dome.update(b, world);
    expect(dome.mesh.geometry).toBe(geometry); expect(dome.mesh.material).toBe(material);
    dome.dispose();
  });

  it('follows the real cart at terrain height, independent of bob, tilt and rebuild pop; disposes on removal', () => {
    const { b, world } = fixture();
    const kit = new StructureKit({ capabilities: { getMaxAnisotropy: () => 1 } } as unknown as THREE.WebGLRenderer, 'low');
    vi.spyOn(kit, 'texture').mockReturnValue(new THREE.CanvasTexture({ width: 1, height: 1 } as HTMLCanvasElement));
    const view = new GccView(kit, b), scene = new THREE.Scene(); scene.add(view.root);
    const frame = { ctx: { shared: { groundOffset: (x: number, z: number) => x * .01 + z * .02 } }, world,
      dt: .1, t: 100, night: 0, windYaw: 0, wind: .6, smoke: { emit: () => {} }, sparks: { emit: () => {} } } as unknown as FrameInfo;
    const dome = view.root.getObjectByName('gcc-recruitment-dome') as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
    const check = () => {
      view.update(b, frame); view.root.updateMatrixWorld(true);
      expect(dome.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([b.pos.x, b.pos.x * .01 + b.pos.z * .02, b.pos.z]);
      expect(dome.getWorldScale(new THREE.Vector3()).toArray()).toEqual([1, 1, 1]);
      expect(dome.parent).toBe(view.root);
    };
    check(); b.pos.x += 1; b.pos.z += 1; b.gcc!.pushedBy = 2; check();
    b.gcc!.destroyedUntil = 110; check(); expect(dome.visible).toBe(false);
    b.pos.x += 30; b.gcc!.destroyedUntil = 0; check(); expect(dome.visible).toBe(true);
    const disposeGeometry = vi.spyOn(dome.geometry, 'dispose'), disposeMaterial = vi.spyOn(dome.material, 'dispose');
    view.dispose();
    expect(scene.children).not.toContain(view.root);
    expect(dome.parent).toBe(null);
    expect(disposeGeometry).toHaveBeenCalledOnce(); expect(disposeMaterial).toHaveBeenCalledOnce();
    kit.dispose();
  });
});
