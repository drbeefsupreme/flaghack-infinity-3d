import * as fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { bossFixture } from '../../../../../tests/bossFixture';
import { createMatch } from '../../../../sim/setup';
import { groundHeight } from '../../../../sim/terrain';
import { normalizeMatch } from '../../../../sim/matchSettings';
import { bossEyeRay } from '../../../../sim/systems/boss/eye';
import { bossPlayerHull } from '../../../../sim/systems/boss/playerCollision';
import { intersectBossRegions, sampleBossHitRegions } from '../../../../sim/systems/boss/hitRegions';
import { BOSS_HIT_REGION_STRIDE } from '../../../../sim/bossHitPoseData';
import { SnapshotEncoder } from '../../../../net/codec';
import { NetMirror } from '../../../../net/mirror';
import { createDayState } from '../../timeOfDay';
import type { EnvContext } from '../../envTypes';
import { BossReveal } from './bossReveal';
import { readBossEyeGaze } from './eyeBeamFx';
import { prepareBossModel } from './bossModel';
import { groundBossGeometry } from './groundGeometry';

const vec = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x,p.y,p.z);
const locations = [{x:0,z:0},{x:75,z:40},{x:-105,z:70},{x:149,z:149}];
const wire = <T>(a:T):T => JSON.parse(JSON.stringify(a));
describe('boss on the shared gameplay dome', () => {
  it('matches the real pupil, host ray, translated projectile shapes and late-joined hull at summit, slope and edges', async () => {
    const world = createMatch({seed:'boss-dome-source',mode:'standard',difficulty:'normal',humans:[0],match:normalizeMatch({maxSignifiers:0})});
    world.time=130; world.effigyRevealedAt=100; world.boss=bossFixture();
    const b=world.boss; b.spawnedAt=100; b.action='idle'; b.actionAt=127; b.eye.chargeAt=127; b.eye.firedAt=130;
    const e = {ctx:{world,quality:'low',time:130,session:{viewBlend:0},camera:new THREE.PerspectiveCamera(60),renderer:{getDrawingBufferSize:(p:THREE.Vector2)=>p.set(640,480)}},
      root:new THREE.Group(),day:createDayState(),burn:{active:true,startedAt:10,elapsed:120,progress:1},
      uniforms:{uTime:{value:130},uFogColor:{value:new THREE.Color()}},noise:new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1),fireLight:new THREE.PointLight()} as unknown as EnvContext;
    const bytes=fs.readFileSync(new URL('../../../../../public/models/boss/skeletal-boss.glb',import.meta.url));
    const effect=new BossReveal(e,async()=>prepareBossModel((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene));
    await effect.ready; expect(effect.loadError).toBeNull();
    try {
      const body=e.root.getObjectByName('boss-model-32m')!,head=body.getObjectByName('head') as THREE.Bone;
      for(const at of locations) for(const crouched of [false,true]) {
        b.pos={...at}; b.crouched=crouched; b.yaw=.7;
        const ground=groundHeight(at.x,at.z,world.map.half);
        b.eye.target={x:at.x-12,y:groundHeight(at.x-12,at.z-20,world.map.half),z:at.z-20};
        Object.assign(b.eye,bossEyeRay(world,b),{impact:{...b.eye.target}});
        effect.update(120); e.root.updateMatrixWorld(true);
        expect(body.position.y).toBe(ground); expect(body.scale.toArray()).toEqual([1,1,1]);
        const gaze=readBossEyeGaze(head);
        expect(gaze.origin.distanceTo(vec(b.eye.origin!))).toBeLessThan(.00002);
        expect(gaze.direction.distanceTo(vec(b.eye.direction!))).toBeLessThan(.000002);
        const beam=e.root.getObjectByName('boss-eye-beam')!;
        expect(beam.localToWorld(new THREE.Vector3()).distanceTo(gaze.origin)).toBeLessThan(1e-8);
        expect(beam.localToWorld(new THREE.Vector3(0,0,1)).distanceTo(vec(b.eye.impact!))).toBeLessThan(1e-8);
        const shape=sampleBossHitRegions(b,world.time), i=7*BOSS_HIT_REGION_STRIDE, c=Math.cos(b.yaw),s=Math.sin(b.yaw);
        const target={x:at.x+c*shape[i]+s*shape[i+2],y:ground+shape[i+1],z:at.z-s*shape[i]+c*shape[i+2]};
        expect(intersectBossRegions(b,world.time,{...target,x:target.x-30},{...target,x:target.x+30})).not.toBeNull();
        const hull=bossPlayerHull(b,world.time)!; expect(hull.bottom).toBe(ground); expect(hull.top-ground).toBeCloseTo(crouched?19.2:32);
        const late=NetMirror.create(world.options,wire(new SnapshotEncoder(world).full()));
        expect(bossPlayerHull(late.world.boss,late.world.time)).toEqual(hull);
        const lateRay=bossEyeRay(late.world,late.world.boss!);
        expect(vec(lateRay.origin).distanceTo(vec(b.eye.origin!))).toBeLessThan(.01);
      }
    } finally { effect.dispose(); e.noise.dispose(); }
  });
  it('conforms crater and stomp meshes without accumulating offsets when the boss moves', () => {
    const geometry=new THREE.RingGeometry(0,8,32,8).rotateX(-Math.PI/2), positions=geometry.getAttribute('position');
    const rest=Array.from({length:positions.count},(_,i)=>positions.getY(i));
    for(const at of [...locations,locations[0]]) {
      groundBossGeometry(geometry,at,1.6,150);
      for(let i=0;i<positions.count;i++) expect(positions.getY(i)*1.6).toBeCloseTo(rest[i]*1.6+groundHeight(at.x+positions.getX(i)*1.6,at.z+positions.getZ(i)*1.6,150),5);
    }
    geometry.dispose();
  });
});
