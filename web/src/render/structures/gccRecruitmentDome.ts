/** The GCC's recruitment footprint: an exact 15 m-radius upper hemisphere. */
import * as THREE from 'three';
import { RECRUIT_RADIUS } from '../../sim/constants';
import { isRecruiter } from '../../sim/systems/recruitment';
import type { Building } from '../../sim/types';
import type { World } from '../../sim/world';

export class GccRecruitmentDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.SphereGeometry(RECRUIT_RADIUS, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vHeight;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = -view.xyz;
          vHeight = position.y;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vHeight;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
          float groundRim = 1.0 - smoothstep(0.0, 0.18, vHeight);
          gl_FragColor = vec4(uColor, 0.018 + rim * 0.10 + groundRim * 0.055);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // A single transparent pass, including from inside the range.
      forceSinglePass: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'gcc-recruitment-dome';
    this.mesh.visible = false;
    // Directly under the ground-placed root, never the cart's bob/tilt/pop transform.
    parent.add(this.mesh);
  }

  update(b: Building, world: World): void {
    this.mesh.visible = b.kind === 'gcc' && isRecruiter(world, b);
    if (this.mesh.visible && b.faction !== -1) {
      this.mesh.material.uniforms.uColor.value.setHex(world.factions[b.faction].color);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
