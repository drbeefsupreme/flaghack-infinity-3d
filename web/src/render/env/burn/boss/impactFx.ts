/** Fireworks are emitted only by authoritative thrown-flag contact events. */
import * as THREE from 'three';
import type { GameEvent } from '../../../../sim/events';
import type { EnvContext } from '../../envTypes';
import { Rng } from '../../../../sim/rng';

type Impact = Extract<GameEvent, { t: 'bossImpact' }>;
type Burst = { points: THREE.Points; born: number; uAge: { value: number }; uColor: { value: THREE.Color }; uPower: { value: number } };
const VERTEX = `attribute vec3 aVelocity;attribute vec2 aSeed;uniform float uAge;uniform float uPower;uniform float uPointScale;
varying float vFade;varying float vHue;varying float vTrail;
void main(){float t=max(0.0,uAge-aSeed.y*.045);float life=.8+aSeed.x*.6;
  vec3 p=aVelocity*(1.0-exp(-t*1.7))/1.7*uPower;p.y-=2.7*t*t;
  vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;
  vFade=(1.0-smoothstep(life*.35,life,uAge))*step(aSeed.y*.045,uAge);vHue=aSeed.x;vTrail=aSeed.y;
  gl_PointSize=clamp((.1+.11*(1.0-aSeed.y))*uPower*uPointScale/max(-mv.z,.1),1.6,15.0);}`;
const FRAGMENT = `uniform vec3 uColor;varying float vFade;varying float vHue;varying float vTrail;
void main(){float r=length(gl_PointCoord-.5);float a=(1.0-smoothstep(.06,.5,r))*vFade*(1.0-vTrail*.6);if(a<.005)discard;
  vec3 rainbow=.5+.5*cos(6.2831853*(vHue+vec3(0.0,.33,.67)));
  vec3 color=mix(rainbow,uColor,.42);color=mix(color,vec3(1.0,.95,.74),pow(1.0-r*2.0,4.0)*.7);
  gl_FragColor=vec4(color*a*3.1,a);\n#include <colorspace_fragment>}`;

export class BossImpactFx {
  readonly group = new THREE.Group();
  private readonly pool: Burst[] = [];
  private readonly seen = new Set<number>();
  private cursor = 0;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly uPointScale = { value: 600 };
  private readonly size = new THREE.Vector2();

  constructor(private readonly env: EnvContext) {
    this.group.name = 'boss-flag-impact-fireworks';
    const rng = new Rng('boss-flag-impact-rays'), positions: number[] = [], velocity: number[] = [], seeds: number[] = [];
    for (let i = 0; i < 44; i++) {
      const y = rng.range(-.8, 1), a = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - y * y), speed = rng.range(2.8, 7), hue = rng.next();
      for (let trail = 0; trail < 4; trail++) { positions.push(0, 0, 0); velocity.push(Math.cos(a) * r * speed, y * speed, Math.sin(a) * r * speed); seeds.push(hue, trail / 3); }
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('aVelocity', new THREE.Float32BufferAttribute(velocity, 3));
    this.geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 2));
    for (let i = 0; i < 16; i++) {
      const uAge = { value: 2 }, uColor = { value: new THREE.Color() }, uPower = { value: 1 };
      const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uAge, uColor, uPower, uPointScale: this.uPointScale }, vertexShader: VERTEX, fragmentShader: FRAGMENT });
      const points = new THREE.Points(this.geometry, material); points.name = 'boss-impact-firework-' + i;
      points.frustumCulled = false; points.visible = false; points.renderOrder = 8; this.group.add(points);
      this.pool.push({ points, born: -Infinity, uAge, uColor, uPower });
    }
  }

  onEvent(event: GameEvent): void {
    if (event.t !== 'bossImpact') return;
    const e: Impact = event;
    if (this.seen.has(e.flagId) || this.env.ctx.world.boss?.id !== e.bossId) return;
    this.seen.add(e.flagId);
    if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value!);
    const b = this.pool[this.cursor++ % this.pool.length], origin = this.env.ctx.world.map.effigy;
    b.points.position.set(e.pos.x - origin.x, e.pos.y, e.pos.z - origin.z);
    b.born = this.env.ctx.world.time; b.uAge.value = 0; b.uPower.value = e.headshot ? 1.35 : 1;
    b.uColor.value.set(this.env.ctx.world.factions[e.faction].color); b.points.visible = true;
  }

  update(now: number): void {
    this.env.ctx.renderer.getDrawingBufferSize(this.size);
    this.uPointScale.value = this.size.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.env.ctx.camera.fov) / 2));
    for (const b of this.pool) { b.uAge.value = Math.max(0, now - b.born); b.points.visible = now >= b.born && now - b.born < 1.4; }
  }
  dispose(): void {
    this.geometry.dispose(); for (const b of this.pool) (b.points.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
