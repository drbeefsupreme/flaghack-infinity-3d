/** The approved original 32 m rig, including the hat, at its authored scale. */
import * as THREE from 'three';
import { prepareBossRearDrapeSeam } from './rearFlapPose';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { BOSS_HEIGHT, BOSS_SOURCE_HEIGHT, BOSS_MODEL_SCALE } from '../../../../sim/bossDimensions';
export { BOSS_HEIGHT, BOSS_SOURCE_HEIGHT } from '../../../../sim/bossDimensions';
export const BOSS_SCALE = BOSS_MODEL_SCALE;
export type BossModelLoader = () => Promise<THREE.Group>;

/** Merge only equal-material/equal-bind meshes. No decimation, recolouring or rig changes. */
export function prepareBossModel(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  prepareBossRearDrapeSeam(source);
  const meshes: THREE.SkinnedMesh[] = [];
  source.traverse((o) => { if (o instanceof THREE.SkinnedMesh) meshes.push(o); });
  if (!meshes.length) throw new Error('Boss asset has no skinned geometry');
  const skeleton = meshes[0].skeleton;
  const bind = meshes[0].bindMatrix;
  const identity = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (mesh.skeleton !== skeleton || !mesh.bindMatrix.equals(bind) || !mesh.matrixWorld.equals(identity) || Array.isArray(mesh.material))
      throw new Error('Boss source changed: revalidate bind transforms before consolidation');
  }
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const mesh of meshes) {
    const material = mesh.material as THREE.Material;
    const geometries = byMaterial.get(material) ?? [];
    geometries.push(mesh.geometry);
    byMaterial.set(material, geometries);
  }
  const originals = new Set(meshes.map((m) => m.geometry));
  for (const mesh of meshes) mesh.removeFromParent();
  let index = 0;
  for (const [material, geometries] of byMaterial) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error('Boss material group could not be consolidated');
    geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `boss-body-${index++}`;
    mesh.bind(skeleton, bind);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    source.add(mesh);
  }
  for (const geometry of originals) geometry.dispose();
  const root = new THREE.Group();
  root.name = `boss-model-${BOSS_HEIGHT}m`;
  root.scale.setScalar(BOSS_SCALE);
  root.add(source);
  root.userData.sourceHeight = BOSS_SOURCE_HEIGHT;
  root.userData.height = BOSS_HEIGHT;
  root.userData.originalDraws = meshes.length;
  root.userData.rearDrapeCorrection = source.userData.rearDrapeCorrection;
  root.userData.consolidatedDraws = byMaterial.size;
  root.updateMatrixWorld(true);
  return root;
}

export async function loadBossModel(): Promise<THREE.Group> {
  const base = import.meta.env.BASE_URL;
  const gltf = await new GLTFLoader().loadAsync(`${base}models/boss/skeletal-boss.glb`);
  // The included jaw/grab/flap clip is a validation clip, not the reveal animation.
  return prepareBossModel(gltf.scene);
}

export function disposeBossModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const s of skeletons) s.dispose();
}
