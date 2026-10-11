/**
 * Boss player-collision microbenchmark. Emits JSONL; no browser or network required.
 *
 * From web/ (uses the installed bundler, so Bun is not required):
 *   ./node_modules/.bin/rolldown bench/boss-collision-eval.ts --platform node --format esm --file /tmp/boss-collision-eval.mjs
 *   node /tmp/boss-collision-eval.mjs
 *   MODE=allocations node --expose-gc /tmp/boss-collision-eval.mjs
 *
 * MODE=all|motion|prediction|shove|allocations (default all); TRIALS=11; ITERATIONS=3000.
 * Reported times are microseconds per four-avatar movement frame, single-player
 * prediction reconcile, or boss shove into four avatars. Probes run separately
 * from timings. Allocation sampling includes subsequently collected objects and
 * adds substantial overhead; estimates are diagnostic, not timing/leak claims.
 *
 * These are Node/V8 CPU microbenchmarks, not browser/GPU frame-time measurements.
 * Starts reset each iteration so contact/far scenarios stay comparable. “high”
 * movement dt is .25 s; actual online prediction always uses the fixed SIM_DT.
 * The 20 m shove and 255-input replay are intentionally pathological probes.
 */
import { CollisionWorld } from '../src/sim/physics/collision';
import { AVATAR, SIM_DT } from '../src/sim/constants';
import { createMatch } from '../src/sim/setup';
import { normalizeMatch } from '../src/sim/matchSettings';
import { bossFixture } from '../tests/bossFixture';
import { bossPlayerHull, BOSS_PLAYER_RADIUS, moveBossWithPlayerCollision } from '../src/sim/systems/boss/playerCollision';
import { stepAvatarMotion } from '../src/sim/systems/avatars';
import { AvatarPredictor } from '../src/net/predict';
import { bossLoopEdges } from '../src/sim/systems/boss/barriers';

const CONTACT = BOSS_PLAYER_RADIUS + AVATAR.radius;
const trials = Number(process.env.TRIALS || 11), iterations = Number(process.env.ITERATIONS || 3000);
function setup() {
  const w = createMatch({ seed: 'boss-collision-profile', difficulty: 'normal', humans: [0,1,2,3], mode: 'standard', match: normalizeMatch({ maxSignifiers: 0 }) });
  w.time = 100; w.boss = bossFixture(); Object.assign(w.boss, { pos: {x: 0, z: 0}, action: 'idle', crouched: false, actionAt: 95 });
  return w;
}
function bench(name: string, fn:()=>void, n=iterations) {
  for(let i=0;i<Math.max(1000,n);i++) fn();
  const values: number[] = [];
  for(let t=0;t<trials;t++) { const start = performance.now(); for(let i=0;i<n;i++) fn(); values.push((performance.now()-start)/n); }
  values.sort((a,b)=>a-b);
  console.log(JSON.stringify({name, iterations:n, trials, medianUs:values[Math.floor(values.length/2)]*1000, minUs:values[0]*1000, p90BatchUs:values[Math.floor(values.length*.9)]*1000}));
}
function probe(col:any) {
  const counts:Record<string,number> = {}; const restores:(()=>void)[]=[];
  for(const method of ['addCylinder','remove','alloc','insert','gather','bodyDepth','supportAmong','ceilingAbove','moveCharacter','blockedCircle']) {
    const orig=col[method];
    col[method] = function(...args:any[]) {
      counts[method]=(counts[method]||0)+1;
      if(method==='alloc') { const n=this.shapes.length; const ret=orig.apply(this,args); counts.newShape=(counts.newShape||0)+(this.shapes.length-n); return ret; }
      if(method==='insert'||method==='remove') { const s=this.shapes[args[0]]; counts[method+'CellVisits']=(counts[method+'CellVisits']||0)+(this.cellCoord(s.maxX)-this.cellCoord(s.minX)+1)*(this.cellCoord(s.maxZ)-this.cellCoord(s.minZ)+1); }
      const ret=orig.apply(this,args);
      if(method==='gather') counts.candidates=(counts.candidates||0)+ret;
      return ret;
    };
    restores.push(()=>{col[method]=orig;});
  }
  return {counts,stop:()=>restores.forEach(f=>f())};
}
const mode=process.env.MODE||'all';
if(mode==='all'||mode==='motion') {
  const w=setup(); const boss=w.boss!; const avatars=[...w.avatars.values()];
  for(const map of [false,true]) for(const dt of [SIM_DT,.25]) for(const situation of ['far','contact','overlap'] as const) for(const kind of ['off','on']) {
    w.collision = map ? CollisionWorld.fromMap(w.map) : new CollisionWorld();
    w.boss=kind==='on'?boss:null;
    const dist=situation==='far'?60:situation==='contact'?CONTACT+.05:.1;
    const inputs=avatars.map((av,i)=>({moveX:-Math.sin(i*Math.PI/2),moveZ:-Math.cos(i*Math.PI/2),yaw:0,pitch:0,sprint:true,jump:false}));
    const starts=avatars.map((av,i)=>({x:Math.sin(i*Math.PI/2)*dist,y:0,z:Math.cos(i*Math.PI/2)*dist}));
    const run=()=>{ for(let i=0;i<avatars.length;i++) { const av=avatars[i]; Object.assign(av.pos,starts[i]); Object.assign(av.vel,{x:inputs[i].moveX*11.5,y:0,z:inputs[i].moveZ*11.5}); av.onGround=true; stepAvatarMotion(w,av,inputs[i],dt); } };
    bench(`motion/4/${map?'map':'empty'}/${dt===SIM_DT?'normal':'high'}/${situation}/${kind}`,run);
    const p=probe(w.collision); run(); p.stop(); console.log(JSON.stringify({probe:`motion/4/${map?'map':'empty'}/${dt===SIM_DT?'normal':'high'}/${situation}/${kind}`, ...p.counts}));
  }
}
if(mode==='all'||mode==='prediction') {
  const w=setup(); const boss=w.boss!; const av=w.avatarOf(0); const input={moveX:1,moveZ:0,yaw:0,pitch:0,sprint:true,jump:false};
  for(const situation of ['far','contact'] as const) for(const kind of ['off','on']) for(const replay of [0,12,60,255]) {
    w.collision=new CollisionWorld(); w.boss=kind==='on'?boss:null;
    const pos={x:situation==='far'?-60:-CONTACT-.05,y:0,z:0};
    Object.assign(av.pos,pos); Object.assign(av.vel,{x:11.5,y:0,z:0}); av.onGround=true;
    const latest={...av,pos:{...pos},vel:{...av.vel}};
    let tick=0;
    const source={latestAvatar:()=>latest, latestBoss:()=>w.boss,latestAck:()=>0,latestTime:()=>100,latestTick:()=>++tick};
    const predictor=new AvatarPredictor(w,av.id,'player'); predictor.frame(source,0,1);
    for(let i=1;i<=replay;i++) predictor.tick(i,input);
    const run=()=>predictor.frame(source,SIM_DT,1);
    bench(`prediction/${situation}/${kind}/replay-${replay}`,run,replay>=60?1000:iterations);
    const p=probe(w.collision); run(); p.stop(); console.log(JSON.stringify({probe:`prediction/${situation}/${kind}/replay-${replay}`,...p.counts}));
  }
}
if(mode==='all'||mode==='shove') {
  const w=setup(),boss=w.boss!,avatars=[...w.avatars.values()]; w.collision=new CollisionWorld();
  for(const loops of [false,true]) {
    const original=w.survey.edgeLey.slice(); if(!loops){w.survey.edgeLey.fill(-1);w.survey.version++;}
    const edgeCount=bossLoopEdges(w).length;
    for(const distance of [.07,1,20]) for(const situation of ['far','contact','overlap'] as const) {
      const from={x:0,z:0},to={x:0,z:distance};
      const starts=avatars.map((av,i)=>({x:situation==='contact'?(i-1.5)*.1:0,y:0,z:situation==='far'?60:situation==='contact'?Math.sqrt(CONTACT**2-((i-1.5)*.1)**2):.1}));
      const run=()=>{for(let i=0;i<avatars.length;i++){Object.assign(avatars[i].pos,starts[i]);Object.assign(avatars[i].vel,{x:0,y:0,z:0});}moveBossWithPlayerCollision(w,boss,from,to);};
      bench(`shove/4/${loops?'loops':'no-loops'}/${edgeCount}/${distance}/${situation}`,run,distance>=20?500:iterations);
      const p=probe(w.collision);run();p.stop();console.log(JSON.stringify({probe:`shove/4/${loops?'loops':'no-loops'}/${edgeCount}/${distance}/${situation}`,...p.counts}));
    }
    w.survey.edgeLey.set(original);w.survey.version++;
  }
}
if(mode==='allocations') {
  const {Session}=await import('node:inspector');
  const session=new Session();session.connect();
  const post=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>session.post(method,params,(err,result)=>err?reject(err):resolve(result)));
  const w=setup(),boss=w.boss!,avatars=[...w.avatars.values()];w.collision=new CollisionWorld();
  const inputs=avatars.map((_,i)=>({moveX:-Math.sin(i*Math.PI/2),moveZ:-Math.cos(i*Math.PI/2),yaw:0,pitch:0,sprint:true,jump:false}));
  const N=100000;
  for(const situation of ['far','contact'])for(const kind of ['off','on']) {
    const distance=situation==='far'?60:CONTACT+.05;w.boss=kind==='on'?boss:null;
    const run=()=>{for(let i=0;i<4;i++){const av=avatars[i],input=inputs[i];av.pos.x=-input.moveX*distance;av.pos.y=0;av.pos.z=-input.moveZ*distance;av.vel.x=input.moveX*11.5;av.vel.y=0;av.vel.z=input.moveZ*11.5;av.onGround=true;stepAvatarMotion(w,av,input,SIM_DT);}};
    for(let i=0;i<20000;i++)run();
    (globalThis as any).gc?.();
    await post('HeapProfiler.startSampling',{samplingInterval:1024,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
    for(let i=0;i<N;i++)run();
    const {profile}=await post('HeapProfiler.stopSampling');
    const rows:any[]=[];let total=0;
    const walk=(node:any)=>{total+=node.selfSize;if(node.selfSize)rows.push({name:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber,bytes:node.selfSize});for(const ch of node.children)walk(ch);};walk(profile.head);rows.sort((a,b)=>b.bytes-a.bytes);
    console.log(JSON.stringify({allocation:`motion/4/${situation}/${kind}`,frames:N,estimatedBytes:total,bytesPerFrame:total/N,top:rows.slice(0,12)}));
  }
  w.boss=boss;w.survey.edgeLey.fill(-1);w.survey.version++;bossLoopEdges(w);
  for(const situation of ['far','contact'])for(const distance of [.07,1]) {
    const from={x:0,z:0},to={x:0,z:distance};
    const run=()=>{for(let i=0;i<4;i++){const av=avatars[i];av.pos.x=0;av.pos.y=0;av.pos.z=situation==='far'?60:CONTACT;av.vel.x=0;av.vel.y=0;av.vel.z=0;}moveBossWithPlayerCollision(w,boss,from,to);};
    for(let i=0;i<20000;i++)run();
    (globalThis as any).gc?.();
    await post('HeapProfiler.startSampling',{samplingInterval:1024,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
    for(let i=0;i<N;i++)run();
    const {profile}=await post('HeapProfiler.stopSampling');
    const rows:any[]=[];let total=0;const walk=(node:any)=>{total+=node.selfSize;if(node.selfSize)rows.push({name:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber,bytes:node.selfSize});for(const ch of node.children)walk(ch);};walk(profile.head);rows.sort((a,b)=>b.bytes-a.bytes);
    console.log(JSON.stringify({allocation:`shove/4/${situation}/${distance}`,frames:N,estimatedBytes:total,bytesPerFrame:total/N,top:rows.slice(0,12)}));
  }
  session.disconnect();
}
