import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundHeight, TERRAIN_GLSL } from '../../sim/terrain';
import { createMatch } from '../../sim/setup';
import { LEVEL_HEIGHT } from '../../sim/constants';
import { pieceSlotMatrix } from '../structures/pieces';
import { cornerGrid, createSurveyUniforms, GLSL_COMMON, LIFT } from './glsl';
import { GroundLayer } from './groundLayer';
import { DECAL, DecalLayer, createDecalMaterial } from './decals';

describe('shared dome survey and structure grounding', () => {
  it('shares the authoritative profile and actual map size with every overlay shader', () => {
    const t = new THREE.DataTexture(), u = createSurveyUniforms({ node: t, aux: t, edge: t, facet: t }, 220);
    expect(u.uMapHalf.value).toBe(220); expect(GLSL_COMMON).toContain(TERRAIN_GLSL);
    const scene = new THREE.Scene(), ground = new GroundLayer(scene, u, 220);
    const mesh = scene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    expect(mesh.geometry.getAttribute('position').count).toBe(129 * 129);
    expect(mesh.material.vertexShader).toContain('wp.y += fhGround(wp.xz)');
    for (const blend of [0, .5, 1]) { u.uViewBlend.value = blend; ground.update(); expect(mesh.visible).toBe(blend > 0); }
    ground.dispose(); t.dispose();
  });
  it('tessellates broad rotated wave decals above the dome without inverted triangles or clipping', () => {
    const geo = cornerGrid(24), uv = geo.getAttribute('aCorner'), index = geo.index!;
    const half = 150, radius = half * Math.SQRT2 + 4;
    for (const angle of [0, .3, .8, 1.4]) {
      const point = (id: number) => { const x = uv.getX(id) * radius, z = uv.getY(id) * radius; return new THREE.Vector3(x * Math.cos(angle) - z * Math.sin(angle), 0, x * Math.sin(angle) + z * Math.cos(angle)); };
      for (let i = 0; i < index.count; i += 3) {
        const [a,b,c] = [0,1,2].map(j => point(index.getX(i+j)));
        for (const p of [a,b,c]) p.y = groundHeight(p.x,p.z,half) + LIFT.decal;
        expect(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).y).toBeGreaterThan(0);
        const center = a.clone().add(b).add(c).divideScalar(3);
        expect(center.y).toBeGreaterThan(groundHeight(center.x,center.z,half));
      }
    }
    geo.dispose();
  });
  it('keeps dense terrain tessellation limited to broad halos rather than thousands of node glyphs', () => {
    const t = new THREE.DataTexture(), u = createSurveyUniforms({ node: t, aux: t, edge: t, facet: t });
    const scene = new THREE.Scene(), material = createDecalMaterial(u), layer = new DecalLayer(scene,material,2048,5);
    const color = new THREE.Color(0xffcc00);
    for (let i=0;i<1000;i++) layer.push(DECAL.node,0,0,1.5,0,color,1,1);
    const wide = layer.push(DECAL.wave,0,0,215,0,color,1,1); layer.setColor2(wide,color); layer.commit();
    const meshes = scene.children as THREE.Mesh<THREE.InstancedBufferGeometry>[];
    expect(meshes[0].geometry.getAttribute('position').count).toBe(9);
    expect(meshes[0].geometry.instanceCount).toBe(1000);
    expect(meshes[1].geometry.getAttribute('position').count).toBe(625);
    expect(meshes[1].geometry.instanceCount).toBe(1);
    layer.reset();layer.commit();expect(meshes.every(m => m.geometry.instanceCount === 0)).toBe(true);
    layer.dispose();material.dispose();t.dispose();expect(scene.children).toHaveLength(0);
  });
  it('grounds wall/deck/ramp rigid transforms at exactly the collision anchor without tilting normals', () => {
    const w = createMatch({ seed: 'piece-grounding', mode: 'standard', difficulty: 'normal', humans: [0] });
    const lat = w.lattice, m = new THREE.Matrix4(), normal = new THREE.Vector3(0,1,0);
    for (const id of [0, Math.floor(lat.facets.length / 2), lat.facets.length - 1]) for (const kind of ['wall','floor','ramp'] as const) {
      const edge = lat.facets[id].edges[0], e = lat.edges[edge];
      const x = kind === 'wall' ? (lat.nodes[e.a].x + lat.nodes[e.b].x)/2 : lat.facets[id].cx;
      const z = kind === 'wall' ? (lat.nodes[e.a].z + lat.nodes[e.b].z)/2 : lat.facets[id].cz;
      pieceSlotMatrix(lat,kind,edge,id,1,0,1,m,w.map.half);
      expect(m.elements[13]).toBeCloseTo(groundHeight(x,z,w.map.half) + (kind === 'floor' ? 2 : 1)*LEVEL_HEIGHT);
      expect(normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(m)).toArray()).toEqual([0,1,0]);
    }
  });
});
