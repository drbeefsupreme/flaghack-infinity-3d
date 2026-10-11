/** A clock-sampled reveal gesture on the approved boss's existing deformation rig. */
import * as THREE from 'three';
import { EFFIGY_BOSS_REVEAL_AT } from '../../../../sim/effigyBurn';
import { smooth } from './revealTimeline';
import { BossRearFlapPose } from './rearFlapPose';

export const BOSS_OPEN_ARMS_AT = EFFIGY_BOSS_REVEAL_AT - .55;

type JointPose = { bone: THREE.Bone; rest: THREE.Quaternion; crossed: THREE.Quaternion; spread: THREE.Quaternion };
type Arm = { clavicle: THREE.Bone; upper: THREE.Bone; lower: THREE.Bone; hand: THREE.Bone; restHandWorld: THREE.Quaternion };
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Construct once, after prepareBossModel(), before another animation changes the rig.
 * Endpoints are solved once with two-bone IK; rendering only slerps local quaternions.
 * All authored coordinates are in the original 32 m, Y-up, +Z-forward model frame.
 * Root placement, facing and the approved uniform 20/32 scale are left untouched.
 */
export class BossRevealPose {
  private readonly joints: JointPose[];
  private readonly rearFlap: BossRearFlapPose;
  private readonly modelWorldRotation: THREE.Quaternion;
  private readonly neck: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly arms: [Arm, Arm];

  constructor(private readonly model: THREE.Group) {
    model.updateWorldMatrix(true, true);
    const bone = (name: string): THREE.Bone => {
      const found = model.getObjectByName(name);
      if (!(found instanceof THREE.Bone)) throw new Error(`Boss reveal rig is missing bone ${name}`);
      return found;
    };
    this.rearFlap = new BossRearFlapPose(model);
    this.modelWorldRotation = model.getWorldQuaternion(new THREE.Quaternion());
    this.neck = bone('neck');
    this.head = bone('head');
    const arm = (side: string): Arm => {
      const hand = bone(`hand${side}`);
      return { clavicle: bone(`clavicle${side}`), upper: bone(`upperarm${side}`), lower: bone(`forearm${side}`), hand,
        restHandWorld: hand.getWorldQuaternion(new THREE.Quaternion()) };
    };
    this.arms = [arm('L'), arm('R')];
    this.joints = [...this.arms.flatMap((a) => [a.clavicle, a.upper, a.lower, a.hand]), this.neck, this.head]
      .map((b) => ({ bone: b, rest: b.quaternion.clone(), crossed: new THREE.Quaternion(), spread: new THREE.Quaternion() }));

    this.makeEndpoint(false);
    for (const j of this.joints) j.crossed.copy(j.bone.quaternion);
    this.restoreRest();
    this.makeEndpoint(true);
    for (const j of this.joints) j.spread.copy(j.bone.quaternion);
    this.setOpen(0);
  }

  /** Crossed through 89.45 s; the full spread and head-back land exactly on 90 s. */
  sample(burnElapsed: number): void {
    this.setOpen(smooth(BOSS_OPEN_ARMS_AT, EFFIGY_BOSS_REVEAL_AT, burnElapsed));
  }

  /** Direct, reversible sampling for scene reconstruction and rig-only verification. */
  setOpen(open: number): void {
    const t = Number.isFinite(open) ? THREE.MathUtils.clamp(open, 0, 1) : 0;
    for (const j of this.joints) j.bone.quaternion.slerpQuaternions(j.crossed, j.spread, t);
    // Rear drape follows the upper back while the approved head-back gesture remains intact.
    this.rearFlap.apply();
    // Bone matrices are current even for direct seeks before the renderer runs.
    this.model.updateWorldMatrix(true, true);
  }

  private restoreRest(): void {
    for (const j of this.joints) j.bone.quaternion.copy(j.rest);
    this.model.updateWorldMatrix(true, true);
  }

  private makeEndpoint(spread: boolean): void {
    for (let i = 0; i < this.arms.length; i++) {
      const a = this.arms[i];
      const sign = i === 0 ? 1 : -1;
      // Small shoulder rotations preserve the coat's shared chest/shoulder weights.
      this.turnInModelFrame(a.clavicle, spread ? Z : Y, THREE.MathUtils.degToRad(spread ? sign * 5 : -sign * 6));
      const wrist = spread
        ? new THREE.Vector3(sign * 9.6, 23, .6)
        : new THREE.Vector3(-sign * 1.3, i === 0 ? 20.2 : 19.8, i === 0 ? 3.5 : 2.2);
      const elbowPole = spread
        ? new THREE.Vector3(sign * 6, 20, 1.3)
        : new THREE.Vector3(sign * 4.8, i === 0 ? 18.1 : 17.7, i === 0 ? 3 : 2);
      this.solveArm(a, wrist, elbowPole);
      // The enormous bony fingers lie over the opposite upper arm, ahead of the
      // coat, instead of pointing into the ribs. Staggered wrists keep sleeves apart.
      const handDirection = spread
        ? new THREE.Vector3(sign, .24, .12)
        : new THREE.Vector3(-sign, i === 0 ? .45 : .3, i === 0 ? -.15 : .22);
      handDirection.normalize().applyQuaternion(this.modelWorldRotation);
      const originalDirection = Y.clone().applyQuaternion(a.restHandWorld);
      const worldRotation = new THREE.Quaternion().setFromUnitVectors(originalDirection, handDirection).multiply(a.restHandWorld);
      this.setWorldRotation(a.hand, worldRotation);
    }
    if (spread) {
      // Split the thirty-degree backward tilt between neck and head to avoid a
      // single sharp hinge and carry the original hat and its secondary bones.
      this.turnInModelFrame(this.neck, X, THREE.MathUtils.degToRad(-8));
      this.turnInModelFrame(this.head, X, THREE.MathUtils.degToRad(-22));
    }
  }

  private solveArm(a: Arm, wristInModel: THREE.Vector3, poleInModel: THREE.Vector3): void {
    const shoulder = a.upper.getWorldPosition(new THREE.Vector3());
    const elbow = a.lower.getWorldPosition(new THREE.Vector3());
    const wrist = a.hand.getWorldPosition(new THREE.Vector3());
    const upperLength = shoulder.distanceTo(elbow);
    const lowerLength = elbow.distanceTo(wrist);
    const target = this.model.localToWorld(wristInModel.clone());
    const axis = target.clone().sub(shoulder);
    const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(upperLength - lowerLength) + 1e-5, upperLength + lowerLength - 1e-5);
    axis.normalize();
    const pole = this.model.localToWorld(poleInModel.clone()).sub(shoulder);
    pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    const desiredElbow = shoulder.clone().addScaledVector(axis, along).addScaledVector(pole, height);
    // Setting parent before child makes each world-space target independent of
    // the imported bone rolls and of transforms outside the prepared model.
    this.pointAt(a.upper, a.lower, desiredElbow);
    this.pointAt(a.lower, a.hand, target);
  }

  private pointAt(bone: THREE.Bone, child: THREE.Bone, target: THREE.Vector3): void {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const to = target.clone().sub(origin).normalize();
    const worldRotation = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    this.setWorldRotation(bone, worldRotation);
  }

  private turnInModelFrame(bone: THREE.Bone, modelAxis: THREE.Vector3, radians: number): void {
    const worldAxis = modelAxis.clone().applyQuaternion(this.modelWorldRotation);
    const worldRotation = new THREE.Quaternion().setFromAxisAngle(worldAxis, radians).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    this.setWorldRotation(bone, worldRotation);
  }

  private setWorldRotation(bone: THREE.Bone, rotation: THREE.Quaternion): void {
    const parentRotation = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentRotation.invert().multiply(rotation)).normalize();
    bone.updateWorldMatrix(false, true);
  }
}
