/**
 * Render eval: the browser half of the perf harness (pair with sim-eval.ts).
 *
 * Usage from the omp JS eval kernel, with the Vite dev server on :5173:
 *
 *   const { runRenderEval } = await import('/home/drbeefsupreme/git/flaghack-infinity/web/bench/render-eval.js');
 *   const r = await runRenderEval(browser, { seconds: 15, seed: 'bench-1' });
 *   display(r); // r.score = p95 frame ms (lower is better)
 *
 * Options (all optional): seconds (15) measured wall time; seed ('bench-1'); url; warmup (120)
 * game seconds fast-forwarded with the AIs before measuring; hippies (150) and flags (600)
 * minimum Signifiers / planted Flags after staging; pose ('command' | 'action'); camera
 * ({ cmdX: 0, cmdZ: 0, cmdHeight: 120 }, Command View target and zoom); settle (2) seconds
 * between staging and measuring (lets the camera blend finish); transitionFrames (90).
 *
 * Before staging, `transition` records the title → match switch: startMatch's own ms and the
 * rAF intervals of the next transitionFrames frames (first frame, max, count over 50 ms), where
 * the new scene's shader compiles show up.
 *
 * Staging is deterministic per seed: flaghack.startMatch({ seed }), then `warmup` game seconds
 * of exactly what the app loop runs per tick (ai.update + sim.step), with events drained and
 * dropped so presentation is not flooded with a burst; then a seeded top-up of hippies near
 * the camps and planted Flags on free nodes (owned by the nearest camp), then a fixed camera.
 *
 * Then, measured per frame by wrapping the app's frame callback (no app changes needed):
 *   - frame time from requestAnimationFrame timestamps (mean / p50 / p95 / max) → score = p95;
 *   - JS ms inside the frame callback, split into sim (Simulation.step), render
 *     (GameRenderer.render, includes three.js submission), ui (GameUI.update) and other;
 *   - renderer.info draw calls and triangles summed over every render pass of the frame;
 *   - JS heap (Chrome performance.memory), GPU string, entity counts;
 *   - sceneTop: main-pass primitives per nearest named scene ancestor (who owns the triangles);
 *   - variantSwitchesPerFrame / variantSwitchTop: draws whose material got a different program
 *     than its previous draw (one material shared by instanced and plain meshes, say), each a
 *     getParameters pass in three; counted on renderBufferDirect (adds ~0.1 µs per draw).
 * The eval tab refuses WebSockets so Vite HMR cannot reload it mid-run; it is closed when
 * done, also on failure.
 */

const TAB = 'render-eval';

/**
 * Init script for the eval tab: refuse WebSockets so Vite's HMR client never connects.
 * Other agents edit sources all the time and every edit would reload the page mid-run.
 */
const NO_HMR = `(() => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      if (String(url).startsWith('ws')) throw new Error('render-eval: HMR disabled');
      super(url, protocols);
    }
  };
})();`;

function sleep(ms) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
}

async function waitFor(tab, expression, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await tab.evaluate(expression)) return;
    await sleep(250);
  }
  throw new Error(`render-eval: timed out waiting for ${expression}`);
}

/** Runs in the page (stringified): installs window.__flaghackBench. */
function installBench(cfg) {
  const app = window.flaghack;
  const fh = window.fh;
  if (!app || !fh) return false;
  // The title → match transition: startMatch's own cost, then every rAF interval of the next
  // cfg.transitionFrames frames (shader compiles of the new scene show up as one long frame).
  const transition = { startMatchMs: 0, firstFrameMs: 0, frames: [] };
  const t0 = performance.now();
  app.startMatch({ seed: cfg.seed });
  const t1 = performance.now();
  transition.startMatchMs = t1 - t0;
  let last = -1;
  const tick = (now) => {
    // The first callback's own timestamp can predate startMatch's end; time it on the clock.
    if (last < 0) transition.firstFrameMs = performance.now() - t1;
    else transition.frames.push(now - last);
    last = now;
    if (transition.frames.length < cfg.transitionFrames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // mulberry32 seeded from the bench seed: same top-up every run.
  let state = 0x9e3779b9;
  for (let i = 0; i < cfg.seed.length; i++) state = Math.imul(state ^ cfg.seed.charCodeAt(i), 0x85ebca6b);
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const summary = (values) => {
    const n = values.length;
    if (n === 0) return { mean: 0, p50: 0, p95: 0, max: 0 };
    const sorted = Float64Array.from(values).sort();
    let sum = 0;
    for (const v of values) sum += v;
    return { mean: sum / n, p50: sorted[Math.floor(0.5 * n)], p95: sorted[Math.min(n - 1, Math.floor(0.95 * n))], max: sorted[n - 1] };
  };
  const counts = () => {
    const w = app.world;
    const flags = { stock: 0, carried: 0, planted: 0, loose: 0, flying: 0 };
    for (const f of w.flags.values()) flags[f.state]++;
    return {
      time: w.time,
      hippies: w.hippies.size,
      flags,
      pieces: w.pieces.size,
      buildings: w.buildings.size,
      crystals: w.crystals.size,
      obstacles: w.map.obstacles.length,
    };
  };

  const bench = {
    rec: null,
    restore: null,
    /** startMatch cost, the wait for the next frame, then the frame intervals after it. */
    transition() {
      const frames = transition.frames;
      return {
        startMatchMs: transition.startMatchMs,
        frames: frames.length,
        firstFrameMs: transition.firstFrameMs,
        maxFrameMs: frames.length > 0 ? Math.max(...frames) : null,
        over50ms: frames.filter((f) => f > 50).length,
      };
    },
    /** Fast-forward like the app loop; returns game time. */
    advance(steps) {
      const w = app.world;
      for (let i = 0; i < steps && w.phase === 'playing'; i++) {
        app.ai?.update();
        app.sim.step();
        w.drainEvents();
      }
      return w.time;
    },
    /** Seeded top-up to the configured hippie / planted Flag minimums, then the fixed camera. */
    topUp() {
      const w = app.world;
      const camps = w.map.camps;
      for (let n = w.hippies.size; n < cfg.hippies; n++) {
        const c = camps[n % camps.length];
        const at = w.nav.nearestWalkable(c.x + (rand() - 0.5) * 50, c.z + (rand() - 0.5) * 50);
        fh.factory.spawnHippie(w, c.faction, at);
      }
      let planted = 0;
      for (const f of w.flags.values()) if (f.state === 'planted') planted++;
      const order = w.lattice.nodes.map((n) => n.id);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
      for (const id of order) {
        if (planted >= cfg.flags) break;
        const node = w.lattice.nodes[id];
        let owner = camps[0];
        for (const c of camps) {
          if ((c.x - node.x) ** 2 + (c.z - node.z) ** 2 < (owner.x - node.x) ** 2 + (owner.z - node.z) ** 2) owner = c;
        }
        if (!fh.flags.canPlantAt(w, id, owner.faction)) continue;
        const fl = fh.factory.spawnFlag(w, { state: 'loose', owner: owner.faction, holder: -1, pos: { x: node.x, y: 0, z: node.z } });
        if (fh.flags.plantFlag(w, fl.id, id, owner.faction, -1)) planted++;
      }
      // One step so the Survey/implied Flags settle before measuring; drop the burst of events.
      app.sim.step();
      w.drainEvents();
      const s = app.session;
      s.view = cfg.pose === 'command' ? 'command' : 'action';
      if (cfg.pose === 'command') Object.assign(s.camera, cfg.camera);
      return counts();
    },
    start() {
      const gl = app.renderer.renderer;
      const info = gl.info;
      const autoReset = info.autoReset;
      info.autoReset = false;
      const rec = { frame: [], js: [], sim: [], render: [], ui: [], calls: [], tris: [], heap0: performance.memory?.usedJSHeapSize ?? null };
      let simMs = 0;
      let renderMs = 0;
      let uiMs = 0;
      let last = -1;
      let live = true;
      const sim = app.sim;
      const stepFn = sim.step;
      sim.step = function () {
        const t = performance.now();
        stepFn.call(sim);
        simMs += performance.now() - t;
      };
      const renderer = app.renderer;
      const renderFn = renderer.render;
      renderer.render = function (dt) {
        const t = performance.now();
        renderFn.call(renderer, dt);
        renderMs += performance.now() - t;
      };
      const ui = app.ui;
      const uiFn = ui.update;
      ui.update = function (dt) {
        const t = performance.now();
        uiFn.call(ui, dt);
        uiMs += performance.now() - t;
      };
      // Program-variant switches: a material drawn with a different program than its previous
      // draw (e.g. shared by instanced and plain meshes) costs three a getParameters pass.
      const gl3 = app.renderer.renderer;
      const bufferFn = gl3.renderBufferDirect;
      const lastProgram = new WeakMap();
      const switches = new Map();
      gl3.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
        bufferFn.call(gl3, camera, scene, geometry, material, object, group);
        const program = gl3.properties.get(material).currentProgram;
        const prev = lastProgram.get(material);
        if (prev !== undefined && prev !== program) {
          let name = '';
          for (let p = object; p && !name; p = p.parent) name = p.name;
          const key = `${camera.isOrthographicCamera ? 'shadow' : 'main'} ${material.type} ${material.uuid.slice(0, 8)} @ ${name || object.type}${object.isInstancedMesh ? ' (instanced)' : ''}`;
          switches.set(key, (switches.get(key) ?? 0) + 1);
        }
        lastProgram.set(material, program);
      };
      rec.switches = switches;
      // The app re-requests `this.frame` every frame, so swapping the property wraps the loop.
      const frameFn = app.frame;
      app.frame = (now) => {
        if (!live) {
          frameFn(now);
          return;
        }
        info.reset();
        simMs = 0;
        renderMs = 0;
        uiMs = 0;
        const t = performance.now();
        frameFn(now);
        rec.js.push(performance.now() - t);
        rec.sim.push(simMs);
        rec.render.push(renderMs);
        rec.ui.push(uiMs);
        rec.calls.push(info.render.calls);
        rec.tris.push(info.render.triangles);
        if (last >= 0) rec.frame.push(now - last);
        last = now;
      };
      this.rec = rec;
      this.restore = () => {
        live = false;
        app.frame = frameFn;
        delete sim.step;
        delete renderer.render;
        delete ui.update;
        // An own property of the renderer (set in its constructor): put the original back.
        gl3.renderBufferDirect = bufferFn;
        info.autoReset = autoReset;
      };
      return true;
    },
    stop() {
      this.restore?.();
      const rec = this.rec;
      const frame = summary(rec.frame);
      const js = summary(rec.js);
      const other = rec.js.map((v, i) => v - rec.sim[i] - rec.render[i] - rec.ui[i]);
      const gl = app.renderer.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      // Who owns the geometry: one main-pass primitive count per nearest named ancestor
      // (renderer.info above also counts shadow and post passes).
      const owners = new Map();
      app.renderer.ctx?.scene.traverseVisible((o) => {
        const g = o.geometry;
        if (!g || !(o.isMesh || o.isLine || o.isPoints)) return;
        const verts = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
        const instances = o.isInstancedMesh ? o.count : 1;
        let name = '';
        for (let p = o; p && !name; p = p.parent) name = p.name;
        const key = name || `${o.type}/${g.type}`;
        const e = owners.get(key) ?? { objects: 0, primitives: 0, shadowCasters: 0 };
        e.objects++;
        e.primitives += (o.isMesh ? verts / 3 : verts) * instances;
        if (o.castShadow) e.shadowCasters++;
        owners.set(key, e);
      });
      const sceneTop = [...owners.entries()]
        .sort((a, b) => b[1].primitives - a[1].primitives)
        .slice(0, 15)
        .map(([owner, e]) => ({ owner, ...e }));
      return {
        frames: rec.frame.length,
        p95FrameMs: frame.p95,
        meanFrameMs: frame.mean,
        p50FrameMs: frame.p50,
        maxFrameMs: frame.max,
        fps: frame.mean > 0 ? 1000 / frame.mean : 0,
        jsMs: { mean: js.mean, p95: js.p95, max: js.max },
        breakdownMeanMs: {
          sim: summary(rec.sim).mean,
          render: summary(rec.render).mean,
          ui: summary(rec.ui).mean,
          other: summary(other).mean,
        },
        drawCalls: summary(rec.calls),
        triangles: summary(rec.tris),
        heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null,
        heapGrowthMB: performance.memory && rec.heap0 !== null ? (performance.memory.usedJSHeapSize - rec.heap0) / 1e6 : null,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        entities: counts(),
        sceneTop,
        variantSwitchesPerFrame: [...rec.switches.values()].reduce((a, b) => a + b, 0) / Math.max(1, rec.js.length),
        variantSwitchTop: [...rec.switches.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([what, n]) => ({ what, perFrame: n / Math.max(1, rec.js.length) })),
      };
    },
  };
  window.__flaghackBench = bench;
  return true;
}

export async function runRenderEval(browser, opts = {}) {
  const cfg = {
    seconds: opts.seconds ?? 15,
    seed: opts.seed ?? 'bench-1',
    url: opts.url ?? 'http://127.0.0.1:5173/',
    warmup: opts.warmup ?? 120,
    hippies: opts.hippies ?? 150,
    flags: opts.flags ?? 600,
    pose: opts.pose ?? 'command',
    camera: opts.camera ?? { cmdX: 0, cmdZ: 0, cmdHeight: 120 },
    settle: opts.settle ?? 2,
    transitionFrames: opts.transitionFrames ?? 90,
  };
  const tab = await browser.open({
    name: TAB,
    url: cfg.url,
    viewport: { width: 1280, height: 720 },
    wait_until: 'load',
    timeout: 120000,
    init_scripts: [NO_HMR],
  });
  // Every call after installation goes through the bench object; if it vanished the page
  // reloaded under us and the numbers would mix two matches.
  const call = async (expr) => {
    const out = await tab.evaluate(`window.__flaghackBench ? JSON.stringify(window.__flaghackBench.${expr}) : null`);
    if (out === null) throw new Error(`render-eval: the page reloaded during the run (at ${expr})`);
    return JSON.parse(out);
  };
  try {
    await waitFor(tab, '!!(window.flaghack && window.fh && window.flaghack.world)', 60000);
    if (!(await tab.evaluate(`(${installBench.toString()})(${JSON.stringify(cfg)})`))) {
      throw new Error('render-eval: window.flaghack / window.fh missing');
    }
    // Let the transition frames play out in real time before the warm-up blocks the page.
    const until = Date.now() + 60000;
    while ((await call('transition()')).frames < cfg.transitionFrames && Date.now() < until) await sleep(250);
    const transition = await call('transition()');
    // Fast-forward in chunks so no single evaluate call runs long.
    const steps = Math.round(cfg.warmup * 60);
    for (let done = 0; done < steps; done += 600) await call(`advance(${Math.min(600, steps - done)})`);
    const staged = await call('topUp()');
    await sleep(cfg.settle * 1000);
    await call('start()');
    await sleep(cfg.seconds * 1000);
    const result = await call('stop()');
    return { score: result.p95FrameMs, ...result, transition, staged, config: cfg };
  } finally {
    await browser.close({ name: TAB });
  }
}
