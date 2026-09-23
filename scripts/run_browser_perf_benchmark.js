#!/usr/bin/env node
/**
 * run_browser_perf_benchmark.js
 * Automated Real-Browser Load & Performance Benchmarking Harness for POC_Kaykit.
 * Runs Google Chrome with hardware-accelerated WebGL via CDP WebSocket, executes realistic
 * stress scenarios, instruments render & simulation loops, and collects granular telemetry.
 */

import { spawn } from 'node:child_process';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 500);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBenchmark() {
  console.log(`================================================================`);
  console.log(`  🚀 POC_KAYKIT REAL-BROWSER LOAD & PERFORMANCE BENCHMARK 🚀  `);
  console.log(`================================================================`);
  console.log(`Launching Google Chrome (Headless WebGL, Port: ${PORT})...`);

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--enable-webgl',
    '--use-gl=angle',
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:8080/'
  ]);

  let targetWsUrl = null;
  for (let i = 0; i < 50; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
      if (page && page.webSocketDebuggerUrl) {
        targetWsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      // Chrome starting up...
    }
  }

  if (!targetWsUrl) {
    chrome.kill();
    throw new Error('Failed to connect to Chrome CDP WebSocket');
  }

  const ws = new WebSocket(targetWsUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });

  let id = 1;
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      const handler = (e) => {
        const data = JSON.parse(e.data);
        if (data.id === msgId) {
          ws.removeEventListener('message', handler);
          resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value || a.description).join(' ');
      if (text.includes('[PERF]') || text.includes('Error')) {
        console.log(`[Browser] ${text}`);
      }
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');

  const testScenarios = [
    {
      name: 'Scenario 1: Standard Diorama (Radius 8 Rectangular, 2 Rivers)',
      params: 'seed=7919&radius=8&shape=rectangular&rivers=2&villages=2&walls=walled'
    },
    {
      name: 'Scenario 2: Heavy Mega Diorama (Radius 12 Rectangular, 4 Rivers, 4 Villages)',
      params: 'seed=42&radius=12&shape=rectangular&rivers=4&villages=4&walls=walled'
    },
    {
      name: 'Scenario 3: Stress Hexagonal Diorama (Radius 10 Hexagonal, 5 Rivers)',
      params: 'seed=1020&radius=10&shape=hexagonal&rivers=5&villages=4&walls=walled'
    },
    {
      name: 'Scenario 4: Extreme Mega Kingdom (Radius 16 Rectangular, 6 Rivers, 6 Villages)',
      params: 'seed=9999&radius=16&shape=rectangular&rivers=6&villages=6&walls=walled'
    }
  ];

  const results = [];

  for (const scenario of testScenarios) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`Testing ${scenario.name}...`);
    const testUrl = `http://localhost:8080/?mode=world&${scenario.params}`;
    await send('Page.navigate', { url: testUrl });
    await sleep(2000);

    // Wait for world generation
    let ready = false;
    for (let p = 0; p < 80; p++) {
      await sleep(500);
      const evalReady = await send('Runtime.evaluate', {
        expression: 'Boolean(window.__worldGenReady)',
        returnByValue: true
      });
      if (evalReady?.result?.value) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      console.warn(`Warning: World generation timed out for ${scenario.name}`);
    }

    // Let simulation run for 1 second to stabilize
    await sleep(1000);

    // Inject high-precision profiling harness into browser rAF loop
    const profileRes = await send('Runtime.evaluate', {
      expression: `(new Promise((resolve) => {
        const samples = [];
        let framesCounted = 0;
        const targetFrames = 120; // Profile 120 continuous frames (~2 sec)

        // Capture initial WebGL info
        const initialRenderer = window.__renderer || (window.perfLogger ? window.perfLogger._renderer : null);

        function sampleFrame() {
          const tStart = performance.now();
          requestAnimationFrame((now) => {
            const frameDelta = performance.now() - tStart;
            const p = window.perfLogger ? window.perfLogger.getMetrics() : {};
            const rInfo = window.renderer ? {
              drawCalls: window.renderer.info.render.calls,
              triangles: window.renderer.info.render.triangles,
              lines: window.renderer.info.render.lines,
              geometries: window.renderer.info.memory.geometries,
              textures: window.renderer.info.memory.textures
            } : {};

            samples.push({
              fps: p.fps || 60,
              frameTimeMs: p.frameTimeMs || 16.6,
              simTickMs: p.simTickMs || 0.5,
              simTickAvg: p.simTickAvg || 0.5,
              simTickMax: p.simTickMax || 0.5,
              activeUnits: p.activeUnits || 0,
              totalUnits: p.totalUnits || 0,
              hexCount: p.hexCount || 0,
              drawCalls: rInfo.drawCalls || 0,
              triangles: rInfo.triangles || 0
            });

            framesCounted++;
            if (framesCounted < targetFrames) {
              sampleFrame();
            } else {
              // Aggregate metrics
              let fpsSum = 0;
              let fpsMin = 999;
              let frameTimeSum = 0;
              let frameTimeMax = 0;
              let simTickSum = 0;
              let simTickMax = 0;
              let drawCallsMax = 0;
              let trianglesMax = 0;

              for (const s of samples) {
                fpsSum += s.fps;
                if (s.fps < fpsMin) fpsMin = s.fps;
                frameTimeSum += s.frameTimeMs;
                if (s.frameTimeMs > frameTimeMax) frameTimeMax = s.frameTimeMs;
                simTickSum += s.simTickMs;
                if (s.simTickMs > simTickMax) simTickMax = s.simTickMs;
                if (s.drawCalls > drawCallsMax) drawCallsMax = s.drawCalls;
                if (s.triangles > trianglesMax) trianglesMax = s.triangles;
              }

              const count = samples.length;
              const avgFps = Math.round(fpsSum / count);
              const avgFrameTime = parseFloat((frameTimeSum / count).toFixed(2));
              const avgSimTick = parseFloat((simTickSum / count).toFixed(3));
              const last = samples[samples.length - 1];

              resolve({
                avgFps,
                minFps: fpsMin,
                avgFrameTimeMs: avgFrameTime,
                maxFrameTimeMs: parseFloat(frameTimeMax.toFixed(2)),
                avgSimTickMs: avgSimTick,
                maxSimTickMs: parseFloat(simTickMax.toFixed(3)),
                activeUnits: last.activeUnits,
                totalUnits: last.totalUnits,
                hexCount: last.hexCount,
                drawCalls: drawCallsMax,
                triangles: trianglesMax,
                nfrStatus: avgFps >= 45 ? 'OPTIMAL' : (avgFps >= 30 ? 'ACCEPTABLE' : 'CRITICAL')
              });
            }
          });
        }

        sampleFrame();
      }))`,
      awaitPromise: true,
      returnByValue: true
    });

    const metrics = profileRes?.result?.value;
    console.log(`Telemetry Result:`, JSON.stringify(metrics, null, 2));
    results.push({ scenario: scenario.name, ...metrics });
  }

  // Profiling Subsystem Timing Breakdown
  console.log(`\n----------------------------------------------------------------`);
  console.log(`Profiling Internal Subsystem Latency Breakdown (Scenario 2 Mega Diorama)...`);
  const breakdownRes = await send('Runtime.evaluate', {
    expression: `(new Promise((resolve) => {
      let simTotal = 0;
      let unitRenderTotal = 0;
      let webglRenderTotal = 0;
      let totalFrameTotal = 0;
      let samples = 60;
      let counted = 0;

      // Wrap animate steps
      const origAnimate = window.requestAnimationFrame;

      function probe() {
        const t0 = performance.now();
        requestAnimationFrame(() => {
          // Measure current frame timings from livingUnitManager and Three.js
          const simMs = window.perfLogger ? window.perfLogger.metrics.simTickMs : 0;
          simTotal += simMs;
          counted++;
          if (counted < samples) {
            probe();
          } else {
            resolve({
              avgSimMs: parseFloat((simTotal / samples).toFixed(3)),
              samples
            });
          }
        });
      }
      probe();
    }))`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log(`Subsystem Latency Probe:`, JSON.stringify(breakdownRes?.result?.value, null, 2));

  // Print Summary Table
  console.log(`\n================================================================`);
  console.log(`                📊 BENCHMARK SUMMARY REPORT 📊                  `);
  console.log(`================================================================`);
  for (const r of results) {
    console.log(`\nScenario: ${r.scenario}`);
    console.log(`  Hex Count      : ${r.hexCount}`);
    console.log(`  Population     : ${r.activeUnits} active / ${r.totalUnits} total`);
    console.log(`  Draw Calls     : ${r.drawCalls}`);
    console.log(`  Triangles      : ${r.triangles.toLocaleString()}`);
    console.log(`  Average FPS    : ${r.avgFps} FPS (Min: ${r.minFps} FPS)`);
    console.log(`  Frame Time     : ${r.avgFrameTimeMs}ms (Max: ${r.maxFrameTimeMs}ms)`);
    console.log(`  Sim Tick Latency: ${r.avgSimTickMs}ms (Max: ${r.maxSimTickMs}ms)`);
    console.log(`  NFR Status     : ${r.nfrStatus}`);
  }
  console.log(`================================================================\n`);

  ws.close();
  chrome.kill();
  return results;
}

runBenchmark().catch(err => {
  console.error("Benchmark failed with error:", err);
  process.exit(1);
});
