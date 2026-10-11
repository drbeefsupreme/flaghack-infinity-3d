/** In-place, reversible combat posing on the approved 109-bone deformation rig. */
import * as THREE from 'three';
import type { BossState } from '../../../../sim/boss';
import { BOSS_SCALE } from './bossModel';
import { CROUCH_WALK_DATA } from './crouchWalkData';
import { smooth } from './revealTimeline';
import { BossRearFlapPose } from './rearFlapPose';

/** World travel per standing gait cycle; cadence derives from distance, not time. */
export const BOSS_WALK_STRIDE = 7.8 * BOSS_SCALE;
const WALK_STRIDE_SOURCE = BOSS_WALK_STRIDE / BOSS_SCALE;
export const BOSS_COMBAT_TIMING = Object.freeze({ emerge: 1.1, transition: .65, swipe: 1.2, swipeHit: .55, stomp: 2.2, stompHit: 1, grab: 3.8, attach: 1.35, consume: 2.8, death: 12 });
type Pose = { positions: Float32Array; quaternions: Float32Array };
type Joint = { bone: THREE.Bone; restPosition: THREE.Vector3; restScale: THREE.Vector3; restQuaternion: THREE.Quaternion; restWorld: THREE.Quaternion };
type Key = { at: number; pose: Pose };
type StanceContact = { foot: THREE.Vector3; knee: THREE.Vector3; rotation: THREE.Quaternion; thigh: THREE.Quaternion; front: THREE.Quaternion[] };
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;

export class BossCombatPose {
  private readonly joints: Joint[] = [];
  private readonly names = new Map<string, Joint>();
  private readonly rest: Pose;
  private readonly rearFlap: BossRearFlapPose;
  private readonly crouch: Pose;
  private readonly walks: Pose[] = [];
  private readonly nativeWalk: Pose[] = [];
  private readonly transitionContacts: StanceContact[][] = [];
  private readonly clips = new Map<string, Key[]>();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly modelRotation = new THREE.Quaternion();

  constructor(private readonly model: THREE.Group) {
    model.updateWorldMatrix(true, true);
    model.getWorldQuaternion(this.modelRotation);
    model.traverse((object) => {
      if (!(object instanceof THREE.Bone)) return;
      const j = { bone: object, restPosition: object.position.clone(), restScale: object.scale.clone(), restQuaternion: object.quaternion.clone(), restWorld: object.getWorldQuaternion(new THREE.Quaternion()) };
      this.joints.push(j); this.names.set(object.name, j);
    });
    if (this.joints.length !== 109) throw new Error('Combat rig must retain the approved 109 bones');
    // A slight opening belongs to the resting pose; attack jaw curves add to it.
    this.turn('jaw', X, 5);
    const jaw = this.joint('jaw');
    jaw.restQuaternion.copy(jaw.bone.quaternion);
    jaw.restWorld.copy(jaw.bone.getWorldQuaternion(new THREE.Quaternion()));
    this.rest = this.capture();
    this.rearFlap = new BossRearFlapPose(model);
    for (const frame of CROUCH_WALK_DATA.frames) {
      this.restoreRest();
      CROUCH_WALK_DATA.bones.forEach((name, i) => {
        const bone = this.joint(name).bone;
        bone.position.fromArray(frame.positions, i * 3);
        bone.quaternion.fromArray(frame.quaternions, i * 4).normalize();
      });
      this.joint('jaw').bone.quaternion.copy(this.joint('jaw').restQuaternion);
      this.rearFlap.apply();
      this.nativeWalk.push(this.capture());
    }
    this.crouch = this.nativeWalk[0];
    this.transitionContacts.push(this.stanceContacts(this.rest), this.stanceContacts(this.crouch));
    for (let i = 0; i <= 40; i++) {
      this.makeWalk(i / 40); this.walks.push(this.capture());
    }
    this.makeCrouchedAttacks();
    for (const low of [false, true]) this.makeStomp(low);
    this.makeDeath();
    this.restoreRest();
  }

  /** Neither renderer cadence nor previous action changes a sampled pose. */
  sample(boss: BossState, now: number): void {
    const t = Math.max(0, now - boss.actionAt);
    const base = boss.crouched ? this.crouch : this.rest;
    switch (boss.action) {
      case 'walk': this.cycle(this.walks, boss.stride / BOSS_WALK_STRIDE); break;
      case 'crouchWalk': this.cycle(this.nativeWalk, boss.stride / (CROUCH_WALK_DATA.stride * BOSS_SCALE)); break;
      case 'crouch': this.stance(smooth(0, BOSS_COMBAT_TIMING.transition, t)); break;
      case 'rise': this.stance(1 - smooth(0, BOSS_COMBAT_TIMING.transition, t)); break;
      // Ground-level attacks retain the native mobile crouch for their whole clip.
      // Do not resurrect a standing attack when an older snapshot has a stale flag.
      case 'swipe': case 'grab': this.clip(boss.action, t); break;
      case 'stomp': this.clip(`stomp:${boss.crouched}`, t); break;
      case 'death': case 'dead': this.clip('death:' + boss.crouched, boss.deathAt === null ? t : Math.max(0, now - boss.deathAt)); break;
      default:
        this.apply(base);
        this.joint('chest').bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, Math.sin((now - boss.spawnedAt) * 1.7) * .008));
        break;
    }
    // A small deterministic follow-through keeps the original hat controls alive.
    if (boss.action === 'idle' || boss.action === 'walk' || boss.action === 'swipe' || boss.action === 'stomp' || boss.action === 'grab') {
      const phase = boss.action === 'walk' ? boss.stride / BOSS_WALK_STRIDE * TAU : (now - boss.spawnedAt) * .7;
      for (const side of ['L', 'R']) for (const [name, amount, lag] of [['earflap_01', .022, .1], ['earflap_02', .035, .4], ['cord_01', .045, .8], ['cord_02', .052, 1.1]] as const)
        this.joint(name + side).bone.quaternion.multiply(this.qa.setFromAxisAngle(X, Math.sin(phase - lag) * amount));
    }
    this.rearFlap.apply();
    this.model.updateWorldMatrix(true, true);
  }

  /** Reapply after a gaze/aim layer changes the head. */
  stabilizeRearFlap(): void { this.rearFlap.apply(); }

  /** Blend the existing approved reveal pose down into a standing idle. */
  settleReveal(amount: number): void {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const j of this.joints) { j.bone.position.lerp(j.restPosition, t); j.bone.quaternion.slerp(j.restQuaternion, t); }
    this.rearFlap.apply();
    this.model.updateWorldMatrix(true, true);
  }

  restoreRest(): void {
    for (const j of this.joints) { j.bone.position.copy(j.restPosition); j.bone.quaternion.copy(j.restQuaternion); j.bone.scale.copy(j.restScale); }
    this.model.updateWorldMatrix(true, true);
  }

  private joint(name: string): Joint {
    const found = this.names.get(name);
    if (!found) throw new Error(`Boss combat is missing bone ${name}`);
    return found;
  }
  private capture(): Pose {
    const positions = new Float32Array(this.joints.length * 3), quaternions = new Float32Array(this.joints.length * 4);
    this.joints.forEach((j, i) => { j.bone.position.toArray(positions, i * 3); j.bone.quaternion.toArray(quaternions, i * 4); });
    return { positions, quaternions };
  }
  private apply(p: Pose): void {
    this.joints.forEach((j, i) => { j.bone.position.fromArray(p.positions, i * 3); j.bone.quaternion.fromArray(p.quaternions, i * 4); });
  }
  private mix(a: Pose, b: Pose, t: number): void {
    this.joints.forEach((j, i) => {
      const p = i * 3, q = i * 4;
      j.bone.position.set(THREE.MathUtils.lerp(a.positions[p], b.positions[p], t), THREE.MathUtils.lerp(a.positions[p + 1], b.positions[p + 1], t), THREE.MathUtils.lerp(a.positions[p + 2], b.positions[p + 2], t));
      j.bone.quaternion.slerpQuaternions(this.qa.fromArray(a.quaternions, q), this.qb.fromArray(b.quaternions, q), t);
    });
  }
  private cycle(frames: Pose[], phase: number): void {
    const k = ((phase % 1) + 1) % 1 * (frames.length - 1), i = Math.floor(k);
    this.mix(frames[i], frames[i + 1], k - i);
  }
  /** Lower the hips while keeping the soles planted, then reverse to rise. */
  private stance(amount: number): void {
    this.mix(this.rest, this.crouch, amount);
    if (amount <= 0 || amount >= 1) return;
    this.model.updateWorldMatrix(true, true);
    const [from, to] = this.transitionContacts;
    for (const [j, side] of ['L', 'R'].entries()) {
      this.solve('thigh' + side, 'shin' + side, 'foot' + side,
        from[j].foot.clone().lerp(to[j].foot, amount), from[j].knee.clone().lerp(to[j].knee, amount));
      const facing = this.model.getWorldQuaternion(new THREE.Quaternion()).multiply(this.modelRotation.clone().invert());
      this.worldRotation(this.joint('foot' + side).bone, facing.multiply(from[j].rotation.clone().slerp(to[j].rotation, amount)));
      // Follow the corrected knee immediately, then unfold into the authored
      // native crouch cloth pose. Plain pose interpolation lets the femur push
      // through the front panel early in the lowering motion.
      const delta = this.joint('thigh' + side).bone.getWorldQuaternion(new THREE.Quaternion()).multiply(from[j].thigh.clone().invert());
      const lowDelta = to[j].thigh.clone().multiply(from[j].thigh.clone().invert());
      for (const [k, segment] of ['01', '02'].entries()) {
        const correction = lowDelta.clone().multiply(from[j].front[k]).invert().multiply(to[j].front[k]);
        const rotation = delta.clone().multiply(from[j].front[k]).multiply(new THREE.Quaternion().slerp(correction, amount));
        // Open the fronts around the outside of the knees before trailing back;
        // a straight rotation blend takes their hem through the bent femurs.
        const outward = (side === 'L' ? 1 : -1) * THREE.MathUtils.degToRad(28) * Math.sin(Math.PI * amount);
        const facing = this.model.getWorldQuaternion(new THREE.Quaternion());
        const flare = new THREE.Quaternion().setFromAxisAngle(Z.clone().applyQuaternion(facing), outward);
        const lift = new THREE.Quaternion().setFromAxisAngle(X.clone().applyQuaternion(facing), -THREE.MathUtils.degToRad(24) * Math.sin(Math.PI * amount) * (1 - smooth(.35, .55, amount)));
        this.worldRotation(this.joint('skirt_' + segment + 'front' + side).bone, lift.multiply(flare).multiply(rotation));
      }
      // Give the unfolding coat room under the hanging hands during lowering.
      const arm = this.joint('upperarm' + side).bone;
      const armAxis = Z.clone().applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()));
      const spread = (side === 'L' ? 1 : -1) * THREE.MathUtils.degToRad(16) * Math.sin(Math.PI * amount);
      this.worldRotation(arm, new THREE.Quaternion().setFromAxisAngle(armAxis, spread).multiply(arm.getWorldQuaternion(new THREE.Quaternion())));
    }
  }
  private stanceContacts(pose: Pose): StanceContact[] {
    this.apply(pose); this.model.updateWorldMatrix(true, true);
    return ['L', 'R'].map(side => ({
      foot: this.model.worldToLocal(this.joint('foot' + side).bone.getWorldPosition(new THREE.Vector3())),
      knee: this.model.worldToLocal(this.joint('shin' + side).bone.getWorldPosition(new THREE.Vector3())),
      rotation: this.joint('foot' + side).bone.getWorldQuaternion(new THREE.Quaternion()),
      thigh: this.joint('thigh' + side).bone.getWorldQuaternion(new THREE.Quaternion()),
      front: ['01', '02'].map(segment => this.joint('skirt_' + segment + 'front' + side).bone.getWorldQuaternion(new THREE.Quaternion())),
    }));
  }
  private clip(name: string, t: number): void {
    const frames = this.clips.get(name)!;
    const next = frames.findIndex((k) => k.at > t);
    if (next < 0) { this.apply(frames[frames.length - 1].pose); return; }
    if (next === 0) { this.apply(frames[0].pose); return; }
    this.mix(frames[next - 1].pose, frames[next].pose, smooth(frames[next - 1].at, frames[next].at, t));
  }
  private turn(name: string, axis: THREE.Vector3, angle: number): void {
    const b = this.joint(name).bone;
    const world = new THREE.Quaternion().setFromAxisAngle(axis.clone().applyQuaternion(this.modelRotation), THREE.MathUtils.degToRad(angle)).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    this.worldRotation(b, world);
  }
  private worldRotation(b: THREE.Bone, q: THREE.Quaternion): void {
    b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)).normalize();
    b.updateWorldMatrix(false, true);
  }
  private point(name: string, child: string, target: THREE.Vector3): void {
    const b = this.joint(name).bone, c = this.joint(child).bone;
    const p = b.getWorldPosition(new THREE.Vector3()), from = c.getWorldPosition(new THREE.Vector3()).sub(p).normalize(), to = target.clone().sub(p).normalize();
    this.worldRotation(b, new THREE.Quaternion().setFromUnitVectors(from, to).multiply(b.getWorldQuaternion(new THREE.Quaternion())));
  }
  private solve(first: string, second: string, end: string, target: THREE.Vector3, pole: THREE.Vector3): void {
    this.model.updateWorldMatrix(true, true);
    const a = this.joint(first).bone.getWorldPosition(new THREE.Vector3()), b = this.joint(second).bone.getWorldPosition(new THREE.Vector3()), c = this.joint(end).bone.getWorldPosition(new THREE.Vector3());
    const ab = a.distanceTo(b), bc = b.distanceTo(c), dst = this.model.localToWorld(target.clone()), axis = dst.clone().sub(a);
    const d = THREE.MathUtils.clamp(axis.length(), Math.abs(ab - bc) + .0001, ab + bc - .0001); axis.normalize();
    const bend = this.model.localToWorld(pole.clone()).sub(a); bend.addScaledVector(axis, -bend.dot(axis)).normalize();
    const along = (ab * ab - bc * bc + d * d) / (2 * d), height = Math.sqrt(Math.max(0, ab * ab - along * along));
    this.point(first, second, a.clone().addScaledVector(axis, along).addScaledVector(bend, height));
    this.point(second, end, dst);
  }
  private arm(side: string, target: number[], direction = new THREE.Vector3(0, -1, .1)): void {
    const sign = side === 'L' ? 1 : -1;
    this.solve('upperarm' + side, 'forearm' + side, 'hand' + side, new THREE.Vector3(...target as [number, number, number]), new THREE.Vector3(sign * 7, target[1] + 2.8, target[2] - 1));
    const j = this.joint('hand' + side), orig = Y.clone().applyQuaternion(j.restWorld), to = direction.clone().normalize().applyQuaternion(this.modelRotation);
    this.worldRotation(j.bone, new THREE.Quaternion().setFromUnitVectors(orig, to).multiply(j.restWorld));
  }
  private plantFoot(side: string, target?: THREE.Vector3): void {
    const rest = this.joint('foot' + side);
    const p = target ?? new THREE.Vector3((side === 'L' ? 1 : -1) * 1.41222, 1.17286, -.10087);
    this.solve('thigh' + side, 'shin' + side, 'foot' + side, p, new THREE.Vector3(p.x * 1.25, 6, p.z + 5));
    this.worldRotation(rest.bone, rest.restWorld.clone());
  }
  /** Place knee pads above the ground, then fold each shin backward with its sole planted. */
  private kneelLegs(): void {
    this.model.updateWorldMatrix(true, true);
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      const hip = this.model.worldToLocal(this.joint('thigh' + side).bone.getWorldPosition(new THREE.Vector3()));
      const thigh = this.joint('shin' + side).restPosition.length(), shin = this.joint('foot' + side).restPosition.length();
      const kneeY = .95, ankleY = 1.17286, spread = .7;
      const knee = new THREE.Vector3(hip.x + sign * spread, kneeY, hip.z + Math.sqrt(Math.max(.01, thigh * thigh - (hip.y - kneeY) ** 2 - spread * spread)));
      const foot = new THREE.Vector3(knee.x, ankleY, knee.z - Math.sqrt(shin * shin - (ankleY - kneeY) ** 2));
      this.point('thigh' + side, 'shin' + side, this.model.localToWorld(knee));
      this.point('shin' + side, 'foot' + side, this.model.localToWorld(foot));
      this.worldRotation(this.joint('foot' + side).bone, this.joint('foot' + side).restWorld.clone());
    }
  }
  private groundCoat(): void {
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) for (const part of ['front', 'side', 'back']) {
      const first = 'skirt_01' + part + side, second = 'skirt_02' + part + side;
      const top = this.model.worldToLocal(this.joint(first).bone.getWorldPosition(new THREE.Vector3()));
      const trail = part === 'front' ? 1 : part === 'back' ? -1 : 0;
      this.point(first, second, this.model.localToWorld(new THREE.Vector3(top.x + sign * 3.5, Math.max(2, top.y - 1.7), top.z + trail * 3.3 - 1.3)));
      const b = this.joint(second).bone;
      const from = Y.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));
      const to = new THREE.Vector3(sign * .7, -.08, trail * .55 - .55).normalize().applyQuaternion(this.modelRotation);
      this.worldRotation(b, new THREE.Quaternion().setFromUnitVectors(from, to).multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    }
  }
  private curl(side: string, amount: number): void {
    for (const j of this.joints) {
      const m = /^(index|middle|ring|pinky|thumb)_(meta|0[123])([LR])$/.exec(j.bone.name);
      if (!m || m[3] !== side || m[2] === 'meta' && m[1] !== 'thumb') continue;
      const isThumb = m[1] === 'thumb', meta = m[2] === 'meta', sign = side === 'L' ? 1 : -1;
      const degrees = meta ? -sign * 55 : -(isThumb ? [30, 45] : [48, 65, 50])[Number(m[2]) - 1];
      const axis = (meta ? Z.clone().negate() : X.clone()).applyQuaternion(this.modelRotation).applyQuaternion(j.restWorld.clone().invert()).normalize();
      j.bone.quaternion.copy(j.restQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees) * amount));
    }
  }
  private makeWalk(phase: number): void {
    this.restoreRest(); const wave = Math.sin(phase * TAU);
    const root = this.joint('root').bone;
    root.position.x += .32 * wave; root.position.y -= .5 + .15 * Math.cos(phase * TAU * 2);
    this.model.updateWorldMatrix(true, true);
    this.turn('pelvis', Z, wave * -2.2); this.turn('spine', X, 8); this.turn('chest', Y, Math.cos(phase * TAU) * 2.5);
    for (const [side, sign, offset] of [['L', 1, 0], ['R', -1, .5]] as const) {
      const p = (phase + offset) % 1, duty = .62;
      const swing = p > duty ? (p - duty) / (1 - duty) : 0;
      const z = p <= duty ? WALK_STRIDE_SOURCE * (duty / 2 - p) : WALK_STRIDE_SOURCE * (-duty / 2 + duty * smooth(0, 1, swing));
      const lift = Math.pow(Math.sin(swing * Math.PI), 1.4) * 1.15;
      this.solve('thigh' + side, 'shin' + side, 'foot' + side, new THREE.Vector3(sign * 1.65, 1.173 + lift, z), new THREE.Vector3(sign * 2.3, 6, 5));
      const foot = this.joint('foot' + side); this.worldRotation(foot.bone, foot.restWorld.clone());
      this.turn('foot' + side, X, -Math.sin(swing * Math.PI) * 8);
      this.turn('upperarm' + side, X, -sign * Math.cos(phase * TAU) * 12);
      this.turn('forearm' + side, X, -3 - Math.max(0, sign * Math.cos(phase * TAU)) * 5);
      // The coat front rides over the femur instead of swinging independently
      // through it. Both skirt controls inherit the solved thigh's rest-relative
      // rotation; the hem adds only a small, delayed cloth response.
      const thigh = this.joint('thigh' + side);
      const follow = thigh.bone.getWorldQuaternion(new THREE.Quaternion()).multiply(thigh.restWorld.clone().invert());
      for (const segment of ['01', '02']) {
        const panel = this.joint('skirt_' + segment + 'front' + side);
        this.worldRotation(panel.bone, follow.clone().multiply(panel.restWorld));
      }
      this.turn('skirt_02front' + side, X, -1.5 - Math.sin((phase + offset) * TAU - .4) * 1.2);
      for (const part of ['back', 'side']) { this.turn('skirt_01' + part + side, X, -sign * Math.cos(phase * TAU - .3) * 3); this.turn('skirt_02' + part + side, X, -sign * Math.cos(phase * TAU - .6) * 5); }
    }
  }
  private makeCrouchedAttacks(): void {
    const base = this.crouch;
    const build = (fn: () => void): Pose => { this.apply(base); this.model.updateWorldMatrix(true, true); fn(); return this.capture(); };
    const y = 5.1;
    const wind = build(() => { this.turn('chest', Y, -19); this.arm('R', [-8.3, y + 1, .8], new THREE.Vector3(-1, -.3, .1)); this.curl('R', .22); });
    const hit = build(() => { this.turn('chest', Y, 12); this.arm('R', [1.3, y - .4, 10], new THREE.Vector3(1, -.2, .15)); this.curl('R', .15); });
    const through = build(() => { this.turn('chest', Y, 24); this.arm('R', [7.2, y, 5.8], new THREE.Vector3(1, -.2, -.2)); });
    // Keep the authored sweep geometry; normalized keys run the full clip twice as fast.
    const swipeDuration = BOSS_COMBAT_TIMING.swipe;
    this.clips.set('swipe', [{ at: 0, pose: base }, { at: (.64 / 2.4) * swipeDuration, pose: wind },
      { at: BOSS_COMBAT_TIMING.swipeHit, pose: hit }, { at: (1.36 / 2.4) * swipeDuration, pose: through }, { at: swipeDuration, pose: base }]);
    const reach = build(() => { this.turn('chest', X, 5); this.arm('R', [-2.4, 4.1, 9.1], new THREE.Vector3(0, -.7, .7)); this.curl('R', .02); });
    const grasp = build(() => { this.turn('chest', X, 5); this.arm('R', [-2.4, 4.1, 9.1], new THREE.Vector3(0, -.7, .7)); this.curl('R', .72); });
    const feed = (jawOpen: number, grip: number): Pose => build(() => {
      this.turn('neck', X, 10); this.turn('head', X, 8); this.turn('jaw', X, jawOpen);
      const head = this.joint('head'), jaw = this.joint('jaw').bone;
      // Centers of the original upper/lower front incisors (teeth 08/09), in
      // their skinning bones' local frames. The jaw pivot is above the mouth.
      const upper = head.bone.localToWorld(new THREE.Vector3(-.00122, .69105, 1.83214));
      const lower = jaw.localToWorld(new THREE.Vector3(.00102, 2.01919, -.26307));
      const mouth = this.model.worldToLocal(upper.add(lower).multiplyScalar(.5));
      const inward = Z.clone().applyQuaternion(head.restWorld.clone().invert())
        .applyQuaternion(head.bone.getWorldQuaternion(new THREE.Quaternion())).negate()
        .applyQuaternion(this.modelRotation.clone().invert()).normalize();
      // CombatFx carries the target at hand-local (0, 1.7, 0). Solve the wrist
      // behind that anchor, with the fingers pointing into the teeth opening.
      const wrist = mouth.clone().addScaledVector(inward, -1.7);
      this.arm('R', wrist.toArray(), inward); this.curl('R', grip);
    });
    const bite = feed(38, .7);
    const chew = feed(10, .45);
    this.clips.set('grab', [{ at: 0, pose: base }, { at: .85, pose: reach }, { at: 1.35, pose: grasp }, { at: 2.25, pose: bite }, { at: 2.7, pose: bite }, { at: 2.8, pose: chew }, { at: 3, pose: bite }, { at: 3.15, pose: chew }, { at: 3.8, pose: base }]);
  }
  private makeStomp(low: boolean): void {
    const base = low ? this.crouch : this.rest;
    const build = (fn: () => void): Pose => { this.apply(base); this.model.updateWorldMatrix(true, true); fn(); return this.capture(); };
    const support = new THREE.Vector3(-1.41222, 1.17286, -.10087);
    if (low) { this.apply(base); this.model.updateWorldMatrix(true, true); support.copy(this.model.worldToLocal(this.joint('footR').bone.getWorldPosition(new THREE.Vector3()))); }
    const raise = build(() => { if (!low) this.joint('root').bone.position.y -= .25; this.model.updateWorldMatrix(true, true); this.turn('pelvis', Z, -5); this.solve('thighL', 'shinL', 'footL', new THREE.Vector3(2.4, 5.3, 3.3), new THREE.Vector3(3.5, 9, 6)); this.worldRotation(this.joint('footL').bone, this.joint('footL').restWorld.clone()); this.plantFoot('R', support); this.turn('chest', X, -5); });
    const stamp = build(() => { this.joint('root').bone.position.y -= .35; this.model.updateWorldMatrix(true, true); this.plantFoot('L', new THREE.Vector3(2.4, 1.17286, 3.3)); this.plantFoot('R', support); this.turn('chest', X, 6); });
    this.clips.set('stomp:' + low, [{ at: 0, pose: base }, { at: .68, pose: raise }, { at: 1, pose: stamp }, { at: 1.32, pose: stamp }, { at: 2.2, pose: base }]);
  }
  private makeDeath(): void {
    this.apply(this.rest); this.model.updateWorldMatrix(true, true);
    this.turn('chest', X, -8); this.turn('head', X, -12); this.arm('L', [1.2, 20, 3]); this.arm('R', [-1.2, 18.5, 3.8]);
    const clutch = this.capture();
    this.apply(this.crouch); this.model.updateWorldMatrix(true, true);
    this.joint('root').bone.position.y -= 2.4; this.model.updateWorldMatrix(true, true);
    this.turn('pelvis', X, 12); this.turn('chest', X, 8);
    this.kneelLegs();
    this.arm('L', [4.5, 3.1, 5.5], new THREE.Vector3(.2, -.12, 1)); this.arm('R', [-4, 4, 6], new THREE.Vector3(-.2, -.12, 1));
    this.groundCoat();
    const kneel = this.capture();
    this.joint('root').bone.position.y -= 1.6; this.model.updateWorldMatrix(true, true);
    this.turn('pelvis', X, 12); this.turn('chest', X, 14); this.turn('head', X, -20);
    this.kneelLegs();
    this.arm('L', [4.2, 2.3, 7], new THREE.Vector3(.2, -.08, 1)); this.arm('R', [-4.1, 2.3, 6.2], new THREE.Vector3(-.2, -.08, 1));
    this.groundCoat();
    // The dangling hat cords settle sideways on the ground instead of tunnelling into it.
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) for (const name of ['earflap_02', 'cord_01', 'cord_02']) {
      const b = this.joint(name + side).bone;
      const from = Y.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));
      const to = new THREE.Vector3(sign * .55, .12, -1).normalize().applyQuaternion(this.modelRotation);
      this.worldRotation(b, new THREE.Quaternion().setFromUnitVectors(from, to).multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    }
    const crumple = this.capture();
    this.joint('root').bone.position.y -= 3.5;
    const ash = this.capture();
    const ending = [{ at: 2.3, pose: this.crouch }, { at: 4, pose: kneel }, { at: 5.8, pose: crumple }, { at: 8.5, pose: crumple }, { at: 12, pose: ash }];
    this.clips.set('death:false', [{ at: 0, pose: this.rest }, { at: .7, pose: clutch }, ...ending]);
    this.apply(this.crouch); this.model.updateWorldMatrix(true, true); this.turn('head', X, -9); this.curl('L', .35); this.curl('R', .35);
    this.clips.set('death:true', [{ at: 0, pose: this.crouch }, { at: .7, pose: this.capture() }, ...ending]);
  }
}
