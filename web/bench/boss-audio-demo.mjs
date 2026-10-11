/** Render the real WebAudio recipes to a WAV in headless Chromium (no audio device needed).
 * Usage: node bench/boss-audio-demo.mjs /absolute/output.wav
 */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';
const output = resolve(process.argv[2] || '/tmp/boss-sound-demo.wav');
const profile = await mkdtemp(tmpdir() + '/boss-audio-chrome-');
const server = await createServer({ root: resolve(import.meta.dirname, '..'), server: { port: 5198, strictPort: true } });
await server.listen();
const browser = spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=9498', '--user-data-dir=' + profile, 'http://localhost:5198/'], { stdio: 'ignore' });
let socket;
try {
  let pages;
  for (let i = 0; i < 100; i++) { try { pages = await (await fetch('http://localhost:9498/json')).json(); if (pages.length) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  if (!pages?.length) throw Error('Chromium did not open its local debugging socket');
  socket = new WebSocket(pages[0].webSocketDebuggerUrl); await new Promise(r => socket.once('open', r));
  let id = 0; const requests = new Map();
  socket.on('message', data => { const message = JSON.parse(data); if (requests.has(message.id)) { requests.get(message.id)(message); requests.delete(message.id); } });
  const call = (method, params) => new Promise(resolve => { const request = ++id; requests.set(request, resolve); socket.send(JSON.stringify({ id: request, method, params })); });
  await call('Page.navigate', { url: 'http://localhost:5198/' });
  await new Promise(r => setTimeout(r, 1000));
  const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const { synthBoss } = await import('/src/audio/bossSynth.ts');
    const rate=44100, duration=22, ctx=new OfflineAudioContext(1,rate*duration,rate);
    const noise=(pink)=>{const b=ctx.createBuffer(1,rate*4,rate),d=b.getChannelData(0);let seed=7711,last=0;for(let i=0;i<d.length;i++){seed=(seed*1664525+1013904223)>>>0;const n=seed/2147483648-1;last=.96*last+.04*n;d[i]=pink?last*4:n;}return b;};
    const pink=noise(true),white=noise(false),gain=ctx.createGain();gain.gain.value=.72;gain.connect(ctx.destination);
    const cues=[['emerge',.3],['step',5],['step',6.1],['stomp',7.3],['charge',10],['beam',13],['death',15]];
    for(const [cue,t] of cues)synthBoss(ctx,gain,pink,white,cue,t);
    const rendered=await ctx.startRendering(),data=rendered.getChannelData(0);
    let peak=0,sum=0,finite=true;for(const x of data){peak=Math.max(peak,Math.abs(x));sum+=x*x;if(!Number.isFinite(x))finite=false;}
    const bytes=new Uint8Array(44+data.length*2),v=new DataView(bytes.buffer);
    const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,data.length*2,true);
    for(let i=0;i<data.length;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,data[i]))*32767,true);
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {wav:btoa(binary),peak,rms:Math.sqrt(sum/data.length),finite,duration,cues};
  })()` });
  if (result.result?.exceptionDetails) throw Error(JSON.stringify(result.result.exceptionDetails));
  const rendered = result.result?.result?.value; if (!rendered?.wav) throw Error(JSON.stringify(result));
  if (!rendered.finite || rendered.peak >= .98 || rendered.rms < .005) throw Error('Audio render failed level/finite checks: ' + JSON.stringify({ ...rendered, wav: undefined }));
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, Buffer.from(rendered.wav, 'base64'));
  delete rendered.wav; await writeFile(output + '.json', JSON.stringify(rendered, null, 2)); console.log(JSON.stringify({ output, ...rendered }));
} finally { socket?.close(); browser.kill('SIGTERM'); await server.close(); await new Promise(r => setTimeout(r, 500)); await rm(profile, { recursive: true, force: true }); }
