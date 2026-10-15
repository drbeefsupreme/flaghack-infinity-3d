/** CPU-only prop rendering regression check; no browser, WebGL, GPU timings or FPS.
 * Run from web: node bench/prop-removal-eval.mjs [--baseline /path/to/old/web]
 * Optional: --runs 3 --output /path/to/report.json
 * Uses the real generated map/builders, with Canvas2D label painting stubbed as in tests.
 * An optional baseline must have src/ and node_modules/ (a symlink is fine).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { createServer } from 'vite';
import * as THREE from 'three';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = option('--baseline', null), runs = Number(option('--runs', '3'));
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
const canvas = new Proxy({ measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (target, key) => key in target ? target[key] : () => {} });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => canvas }) };
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const oldServer = baseline ? await createServer({ root: path.resolve(baseline), logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' }) : null;
try {
  const { PropField } = await server.ssrLoadModule('/src/render/env/props/propField.ts');
  const Old = oldServer ? (await oldServer.ssrLoadModule('/src/render/env/props/propField.ts')).PropField : null;
  const { createMatch } = await server.ssrLoadModule('/src/sim/setup.ts');
  const { normalizeMatch } = await server.ssrLoadModule('/src/sim/matchSettings.ts');
  const { createDayState } = await server.ssrLoadModule('/src/render/env/timeOfDay.ts');
  const hash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
  const summary = values => {
    const sorted = values.toSorted((a, b) => a - b);
    return { n: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
      p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) };
  };
  function env(quality) {
    const world = createMatch({ seed: 'scenery-render', difficulty: 'normal', humans: [0], mode: 'standard', match: normalizeMatch({ maxSignifiers: 0 }) });
    return { ctx: { world, quality, beat: 0, time: 0 }, root: new THREE.Group(), day: { ...createDayState(), night: 1 },
      uniforms: { uTime: { value: 0 }, uNight: { value: 1 }, uBeat: { value: 0 }, uWind: { value: new THREE.Vector2() },
        uBurn: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() } } };
  }
  function signature(environment) {
    const meshes = [];
    environment.root.traverse(o => {
      if (!o.isMesh) return;
      meshes.push({ name: o.name, batched: !!o.isBatchedMesh, instanced: !!o.isInstancedMesh,
        attributes: Object.fromEntries(Object.entries(o.geometry.attributes).map(([name, a]) => [name, [a.count, a.itemSize, hash(a.array)]])),
        index: o.geometry.index ? hash(o.geometry.index.array) : null,
        instance: o.instanceMatrix ? hash(o.instanceMatrix.array) : null, color: o.instanceColor ? hash(o.instanceColor.array) : null,
        material: [o.material.type, o.material.color?.getHex(), o.material.roughness, o.material.metalness,
          o.material.transparent, o.material.side, o.material.customProgramCacheKey()] });
    });
    return meshes;
  }
  function bufferFootprint(environment) {
    const arrays = new Set();
    environment.root.traverse(o => {
      if (!o.isMesh) return;
      for (const a of Object.values(o.geometry.attributes)) arrays.add(a.array);
      if (o.geometry.index) arrays.add(o.geometry.index.array);
      if (o.instanceMatrix) arrays.add(o.instanceMatrix.array);
      if (o.instanceColor) arrays.add(o.instanceColor.array);
    });
    return { arrays: arrays.size, bytes: [...arrays].reduce((n, a) => n + a.byteLength, 0),
      note: 'Unique geometry/index/instance attribute backing-store bytes; intended GPU buffer payload, not measured GPU allocation. Excludes textures and renderer/driver overhead.' };
  }
  function metadata(field) {
    const ranges = new Map(), geometries = new Map();
    const owners = [...field.sceneryRanges].map(([owner, entries]) => [owner, entries.map(r => {
      if (!geometries.has(r.geometry)) geometries.set(r.geometry, geometries.size);
      if (!ranges.has(r)) ranges.set(r, ranges.size);
      return ranges.get(r);
    })]);
    const payload = { owners, ranges: [...ranges.keys()].map(r => [geometries.get(r.geometry), r.start, r.count]),
      instances: [...field.sceneryInstances].map(([owner, entries]) => [owner, entries.map(it => it.id)]),
      rotorOwners: field.spinners.flatMap(s => s.rotors.map(r => r.obstacleId)) };
    return { ownerCount: owners.length, uniqueRanges: ranges.size, sharedRangeReferences: owners.reduce((n, [, ids]) => n + ids.length, 0),
      serializedOwnershipBytes: serialize(payload).byteLength,
      note: 'Exact V8 serialized CPU metadata representation size; not a resident heap measurement. GPU vertex attributes/shaders unchanged.' };
  }
  function clearUploadRanges(environment) {
    environment.root.traverse(o => { if (o.isMesh) for (const a of Object.values(o.geometry.attributes)) a.clearUpdateRanges(); });
  }
  const report = { node: process.version, cpu: os.cpus()[0].model, seed: 'scenery-render', runs,
    scope: 'Node render-update CPU. No simulation rebuild, browser, GPU submission/upload, shader compile, raster, audio, or FPS included.', results: [] };
  for (const quality of ['low', 'high']) {
    const currentEnv = env(quality), current = new PropField(currentEnv); current.update(0);
    const initial = signature(currentEnv);
    const result = { quality, obstacles: currentEnv.ctx.world.map.obstacles.length, meshes: initial.length, initialBufferFootprint: bufferFootprint(currentEnv), metadata: metadata(current) };
    if (Old) {
      const beforeEnv = env(quality), old = new Old(beforeEnv); old.update(0);
      result.initialGeometryIdentical = JSON.stringify(signature(beforeEnv)) === JSON.stringify(initial);
      old.dispose();
    }
    current.dispose();
    for (const [name, C] of [['before', Old], ['after', PropField]]) {
      if (!C) continue;
      const construction = [], firstSix = [], all = [], ordinary = [], finalBuffers = [], remainingStaticTriangles = [];
      for (let run = 0; run < runs; run++) {
        const e = env(quality), start = performance.now();
        const field = new C(e); construction.push(performance.now() - start);
        for (let frame = 0; frame < 1000; frame++) field.update(1 / 60);
        for (let frame = 0; frame < 6000; frame++) { const t = performance.now(); field.update(1 / 60); ordinary.push(performance.now() - t); }
        const targets = e.ctx.world.map.obstacles.filter(o => o.kind !== 'effigy');
        for (const [i, o] of targets.slice(0, name === 'before' ? 6 : targets.length).entries()) {
          clearUploadRanges(e);
          e.ctx.world.destroyedScenery.add(o.id);
          const t = performance.now(); field.update(1 / 60); const ms = performance.now() - t;
          if (i < 6) firstSix.push(ms);
          all.push(ms);
        }
        if (name === 'after') {
          let remaining = 0;
          e.root.traverse(o => {
            if (!o.isMesh || !o.name.startsWith('props-')) return;
            const p = o.geometry.getAttribute('position');
            for (let v = 0; v < p.count; v += 3) {
              const same = k => p.getX(v) === p.getX(v + k) && p.getY(v) === p.getY(v + k) && p.getZ(v) === p.getZ(v + k);
              if (!same(1) || !same(2)) remaining++;
            }
          });
          remainingStaticTriangles.push(remaining);
          if (remaining !== 0) throw new Error(`Incomplete owner coverage: ${remaining} triangles remain after removing every prop`);
        }
        finalBuffers.push(bufferFootprint(e));
        field.dispose();
      }
      result[name] = { construction: summary(construction), firstSix: summary(firstSix), allRemoval: summary(all), ordinary: summary(ordinary), finalBufferFootprints: finalBuffers, remainingStaticTriangles };
    }
    report.results.push(result);
  }
  const output = JSON.stringify(report, null, 2);
  if (option('--output', null)) fs.writeFileSync(option('--output'), output + '\n');
  console.log(output);
} finally {
  await server.close(); await oldServer?.close();
}
