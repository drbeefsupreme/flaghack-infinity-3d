/** Deterministic hat attachment with a lower drape tracking the coat, without physics. */
import * as THREE from 'three';

/** Correct the authored rear seam where it sat inside the skull below the hat band.
 * A local cloth-only bulge tucks the existing vertices under the outer band; mesh
 * topology, original asset, skin weights and draw consolidation stay unchanged. */
export function prepareBossRearDrapeSeam(source: THREE.Group): void {
  const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  if (source.userData.rearDrapeCorrection) return;
  let vertices = 0, maxSourceDisplacement = 0;
  const affectedBounds = new THREE.Box3(), meshes: string[] = [];
  source.traverse(o => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    let isRear = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent)
      if (/rear[ _]+drape/i.test(p.name)) { isRear = true; break; }
    if (!isRear || o.geometry.userData.rearSeamCorrected) return;
    const position = o.geometry.getAttribute('position');
    let count = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i), x = Math.abs(position.getX(i));
      const up = smooth(25.5, 26.2, y) * (1 - .3 * smooth(26.48, 26.62, y));
      const center = 1 - smooth(.6, 1.8, x);
      const before = position.getZ(i);
      position.setZ(i, before - .18 * up * center);
      const displacement = Math.abs(position.getZ(i) - before);
      if (displacement > 0) { vertices++; count++; maxSourceDisplacement = Math.max(maxSourceDisplacement, displacement);
        affectedBounds.expandByPoint(new THREE.Vector3(position.getX(i), y, before)); }
    }
    if (count) meshes.push(o.name);
    position.needsUpdate = true; o.geometry.computeVertexNormals(); o.geometry.userData.rearSeamCorrected = true;
  });
  source.userData.rearDrapeCorrection = { vertices, meshes, maxSourceDisplacement, affectedBounds: [affectedBounds.min.toArray(), affectedBounds.max.toArray()] };
}

const Y = new THREE.Vector3(0, 1, 0);
const TAIL_LENGTH = 2.24;
export class BossRearFlapPose {
  private readonly chest: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly restHeadToChest: THREE.Quaternion;
  private readonly upper: THREE.Bone;
  private readonly lower: THREE.Bone;
  private readonly upperPosition: THREE.Vector3;
  private readonly upperRotation: THREE.Quaternion;
  private readonly lowerPosition: THREE.Vector3;
  private readonly lowerRotation: THREE.Quaternion;
  private readonly lowerScale: THREE.Vector3;
  private readonly tailAnchor: THREE.Vector3;
  constructor(private readonly model: THREE.Group) {
    model.updateWorldMatrix(true, true);
    const bone = (name: string) => {
      const found = model.getObjectByName(name);
      if (!(found instanceof THREE.Bone)) throw new Error(`Boss rear flap is missing ${name}`);
      return found;
    };
    this.chest = bone('chest'); this.head = bone('head');
    this.restHeadToChest = this.chest.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.head.getWorldQuaternion(new THREE.Quaternion()));
    this.upper = bone('rearflap_01'); this.lower = bone('rearflap_02');
    this.upperPosition = this.upper.position.clone(); this.upperRotation = this.upper.quaternion.clone();
    this.lowerPosition = this.lower.position.clone(); this.lowerRotation = this.lower.quaternion.clone(); this.lowerScale = this.lower.scale.clone();
    this.tailAnchor = this.chest.worldToLocal(this.lower.localToWorld(new THREE.Vector3(0, TAIL_LENGTH, 0)));
    this.tailAnchor.y -= 1.6;
    this.tailAnchor.z -= .15;
  }
  /** Root and skull-covering upper panel stay attached to the hat. Only the lower
   * panel bends/stretches to its upper-back anchor, forming a continuous bridge. */
  apply(): void {
    this.upper.position.copy(this.upperPosition); this.upper.quaternion.copy(this.upperRotation);
    this.lower.position.copy(this.lowerPosition); this.lower.quaternion.copy(this.lowerRotation); this.lower.scale.copy(this.lowerScale);
    this.model.updateWorldMatrix(true, true);
    const relativeHead = this.chest.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.head.getWorldQuaternion(new THREE.Quaternion()));
    const bend = relativeHead.angleTo(this.restHeadToChest);
    const wrap = THREE.MathUtils.clamp((bend - .9) / .25, 0, 1);
    // Bow the intermediate cloth section outside the skull at extreme head tilts.
    this.lower.position.z += wrap * wrap * (3 - 2 * wrap);
    const deltaHead = relativeHead.clone().multiply(this.restHeadToChest.clone().invert());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(deltaHead);
    const down = THREE.MathUtils.clamp((-Math.atan2(forward.y, forward.z) - .9) / .35, 0, 1);
    this.lower.position.y += 1.5 * down * down * (3 - 2 * down);
    this.lower.updateWorldMatrix(false, true);
    const root = this.lower.getWorldPosition(new THREE.Vector3());
    const t = THREE.MathUtils.clamp((bend - .6) / .25, 0, 1);
    const clearance = .45 * t * t * (3 - 2 * t);
    const target = this.chest.localToWorld(this.tailAnchor.clone().add(new THREE.Vector3(0, 0, -clearance)));
    const direction = target.sub(root), distance = direction.length();
    const world = this.lower.getWorldQuaternion(new THREE.Quaternion());
    const axis = Y.clone().applyQuaternion(world);
    const turn = new THREE.Quaternion().setFromUnitVectors(axis, direction.normalize());
    const desired = turn.multiply(world);
    this.lower.quaternion.copy(this.lower.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired)).normalize();
    const scale = this.lower.getWorldScale(new THREE.Vector3()).y;
    this.lower.scale.y *= distance / (TAIL_LENGTH * scale);
    // Relax the original skull-wrapping cross-section onto the broader, flatter coat back.
    this.lower.scale.z *= .45;
    this.lower.updateWorldMatrix(false, true);
  }
}
