#!/usr/bin/env node
/**
 * capture_qa_screenshot.js
 * Zero-dependency headless visual screenshot capture for POC_Kaykit using native Node 24 WebSocket + Chrome CDP.
 * Supports flexible CLI flags: --seed, --radius, --out, --width, --height.
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// Argument parsing
const args = process.argv.slice(2);
let OUT_PATH = '/Users/mac/.gemini/antigravity/brain/cc0017b5-5400-4b69-b802-443a8360c23e/world_qa_render.png';
let SEED = '7919';
let RADIUS = '8';
let SHAPE = 'rectangular';
let RIVERS = '2';
let VILLAGES = '';
let WALLS = 'walled';
let BIOME = '';
let FOCUS_BIOME = '';
let COLLAPSED = 'false';
let FOCUS_VILLAGE = false;
let FOCUS_WATERMILL = false;
let FOCUS_CASTLE = false;
let FOCUS_UNITS = false;
let INSPECT_UNIT = false;
let OPEN_ROSTER = false;
let FOLLOW_UNIT = false;
let FRUSTUM_CHECK = false;
let PHASE = '';
let TIME = '';
let WIDTH = 1920;
let HEIGHT = 1080;

let positionalIdx = 0;
for (let i = 0; i < args.length; i++) {
  let arg = args[i];
  let val = null;
  if (arg.includes('=')) {
    const eqIdx = arg.indexOf('=');
    val = arg.slice(eqIdx + 1);
    arg = arg.slice(0, eqIdx);
  }

  const getNextVal = () => (val !== null ? val : args[++i]);

  if (arg === '--out' || arg === '-o') {
    OUT_PATH = getNextVal();
  } else if (arg === '--seed' || arg === '-s') {
    SEED = getNextVal();
  } else if (arg === '--radius' || arg === '-r') {
    RADIUS = getNextVal();
  } else if (arg === '--rivers') {
    RIVERS = getNextVal();
  } else if (arg === '--villages') {
    VILLAGES = getNextVal();
  } else if (arg === '--walls') {
    WALLS = getNextVal();
  } else if (arg === '--biome') {
    BIOME = getNextVal();
  } else if (arg === '--focusBiome') {
    FOCUS_BIOME = getNextVal();
  } else if (arg === '--collapsed') {
    COLLAPSED = val !== null ? val : 'true';
    if (val === null && (args[i + 1] === 'true' || args[i + 1] === 'false')) {
      COLLAPSED = args[++i];
    }
  } else if (arg === '--focusVillage') {
    FOCUS_VILLAGE = true;
  } else if (arg === '--focusWatermill') {
    FOCUS_WATERMILL = true;
  } else if (arg === '--focusCastle') {
    FOCUS_CASTLE = true;
  } else if (arg === '--focusUnits') {
    FOCUS_UNITS = true;
  } else if (arg === '--inspectUnit') {
    INSPECT_UNIT = true;
  } else if (arg === '--openRoster') {
    OPEN_ROSTER = true;
  } else if (arg === '--followUnit') {
    FOLLOW_UNIT = true;
  } else if (arg === '--frustumCheck') {
    FRUSTUM_CHECK = true;
  } else if (arg === '--phase') {
    PHASE = getNextVal();
  } else if (arg === '--time') {
    TIME = getNextVal();
  } else if (arg === '--shape') {
    SHAPE = getNextVal();
  } else if (arg === '--width') {
    WIDTH = parseInt(getNextVal(), 10);
  } else if (arg === '--height') {
    HEIGHT = parseInt(getNextVal(), 10);
  } else if (!arg.startsWith('-')) {
    if (positionalIdx === 0) OUT_PATH = arg;
    else if (positionalIdx === 1) SEED = arg;
    else if (positionalIdx === 2) RADIUS = arg;
    positionalIdx++;
  }
}

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9350 + Math.floor(Math.random() * 500);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture() {
  const targetUrl = `http://localhost:8080/?mode=world&seed=${SEED}&radius=${RADIUS}&shape=${SHAPE}&rivers=${RIVERS}&villages=${VILLAGES}&walls=${WALLS}&collapsed=${COLLAPSED}`;
  console.log(`Starting headless Chrome for visual QA assessment (Seed: ${SEED}, Radius: ${RADIUS}, ${WIDTH}x${HEIGHT}, Port: ${PORT})...`);
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/chrome_qa_test_${PORT}`,
    '--enable-webgl',
    '--use-gl=angle',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--no-first-run',
    '--no-default-browser-check',
    targetUrl
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
    throw new Error('Failed to connect to Chrome DevTools Protocol target page');
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
      console.log(`[Browser Console] ${text}`);
    } else if (data.method === 'Runtime.exceptionThrown') {
      console.error(`[Browser Error]`, data.params.exceptionDetails);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');

  console.log(`Navigating to ${targetUrl}...`);
  await send('Page.navigate', { url: targetUrl });
  await sleep(2000);

  // If page hasn't started generating yet, trigger it directly
  await send('Runtime.evaluate', {
    expression: 'if (!window.__worldGenReady && window.__triggerWorldGen) { window.__triggerWorldGen(); }'
  });

  console.log('Page loaded, waiting for procedural 3D world to generate and render...');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(600);
    const evalRes = await send('Runtime.evaluate', {
      expression: '({ ready: Boolean(window.__worldGenReady), meshes: window.__worldGen?.worldGroup?.children?.length, oceanPct: document.getElementById("label-water")?.textContent, radius: document.getElementById("label-radius")?.textContent })',
      returnByValue: true
    });
    if (i % 5 === 0) console.log(`Poll ${i}:`, JSON.stringify(evalRes?.result?.value));
    if (evalRes?.result?.value?.ready) {
      console.log('3D Procedural World ready:', JSON.stringify(evalRes.result.value));
      ready = true;
      break;
    }
  }

  if (!ready) {
    console.warn('Warning: __worldGenReady timed out, proceeding to capture anyway.');
  }

  if (FOCUS_BIOME) {
    console.log(`Focusing camera on ${FOCUS_BIOME} biome...`);
    const focusRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const grid = window.__worldGen?.grid;
        if (!grid) return { error: 'no grid' };
        const biomeTiles = Array.from(grid.values()).filter(t => t.biomeTheme === '${FOCUS_BIOME}' && t.worldPos);
        if (biomeTiles.length === 0) return { error: 'no tiles found for biome' };
        const avgX = biomeTiles.reduce((s, t) => s + t.worldPos.x, 0) / biomeTiles.length;
        const avgZ = biomeTiles.reduce((s, t) => s + t.worldPos.z, 0) / biomeTiles.length;
        const avgY = biomeTiles.reduce((s, t) => s + t.worldPos.y, 0) / biomeTiles.length;
        if (window.controls && window.camera) {
          window.controls.target.set(avgX, avgY + 0.5, avgZ);
          window.camera.position.set(avgX + 7.0, avgY + 6.5, avgZ + 8.0);
          window.controls.update();
          return { success: true, biome: '${FOCUS_BIOME}', count: biomeTiles.length, target: [avgX, avgY, avgZ] };
        }
        return { error: 'no controls or camera' };
      })()`,
      returnByValue: true
    });
    console.log('Focus result:', JSON.stringify(focusRes?.result?.value));
    await sleep(1500);
  } else if (FOCUS_VILLAGE) {
    console.log('Focusing camera on primary multi-hex village cluster...');
    const focusRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const grid = window.__worldGen?.grid;
        if (!grid) return { error: 'no grid' };
        const villageTiles = Array.from(grid.values()).filter(t => t.isVillage);
        if (villageTiles.length === 0) return { error: 'no village tiles' };
        const springVillage = villageTiles.find(t => t.biomeTheme === 'spring' || t.biome === 'plains');
        const vId = springVillage ? springVillage.villageId : villageTiles[0].villageId;
        const cluster = villageTiles.filter(t => t.villageId === vId);
        const valid = cluster.filter(t => t.worldPos);
        if (valid.length === 0) return { error: 'no worldPos' };
        const avgX = valid.reduce((s, t) => s + t.worldPos.x, 0) / valid.length;
        const avgZ = valid.reduce((s, t) => s + t.worldPos.z, 0) / valid.length;
        const avgY = valid.reduce((s, t) => s + t.worldPos.y, 0) / valid.length;
        if (window.controls && window.camera) {
          window.controls.target.set(avgX, avgY + 0.3, avgZ);
          window.camera.position.set(avgX + 3.2, avgY + 3.6, avgZ + 4.4);
          window.controls.update();
          return { success: true, vId, count: valid.length, target: [avgX, avgY, avgZ] };
        }
        return { error: 'no controls or camera' };
      })()`,
      returnByValue: true
    });
    console.log('Focus result:', JSON.stringify(focusRes?.result?.value));
    await sleep(3500);
  } else if (FOCUS_WATERMILL) {
    console.log('Focusing camera on watermill at river edge...');
    const wmRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const hexList = window.__worldGen?.hexList || [];
        const wmTile = hexList.find(t => t.building && t.building.type === 'watermill');
        if (!wmTile || !wmTile.worldPos) return { error: 'no watermill tile found' };
        const ox = wmTile.building.offset ? wmTile.building.offset.x : 0;
        const oz = wmTile.building.offset ? wmTile.building.offset.z : 0;
        const wx = wmTile.worldPos.x + ox;
        const wy = wmTile.worldPos.y;
        const wz = wmTile.worldPos.z + oz;
        if (window.controls && window.camera) {
          window.controls.target.set(wx, wy + 0.25, wz);
          window.camera.position.set(wx + 2.4, wy + 2.0, wz + 2.8);
          window.controls.update();
          return { success: true, tile: [wmTile.q, wmTile.r], pos: [wx, wy, wz], building: wmTile.building };
        }
        return { error: 'no controls or camera' };
      })()`,
      returnByValue: true
    });
    console.log('Watermill Focus result:', JSON.stringify(wmRes?.result?.value));
    await sleep(1500);
  } else if (FOCUS_CASTLE) {
    console.log('Focusing camera on castle peak...');
    const castleRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const hexList = window.__worldGen?.hexList || [];
        const castleTile = hexList.find(t => t.building && t.building.type === 'castle');
        if (!castleTile || !castleTile.worldPos) return { error: 'no castle tile found' };
        const wx = castleTile.worldPos.x;
        const wy = castleTile.worldPos.y;
        const wz = castleTile.worldPos.z;
        if (window.controls && window.camera) {
          window.controls.target.set(wx, wy + 0.3, wz);
          window.camera.position.set(wx + 3.0, wy + 2.5, wz + 3.2);
          window.controls.update();
          return { success: true, tile: [castleTile.q, castleTile.r], pos: [wx, wy, wz], building: castleTile.building };
        }
        return { error: 'no controls or camera' };
      })()`,
      returnByValue: true
    });
    console.log('Castle Focus result:', JSON.stringify(castleRes?.result?.value));
    await sleep(1500);
  } else if (FOCUS_UNITS) {
    console.log('Focusing camera on cluster of walking living units in village...');
    const unitsRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const mgr = window.__livingUnitManager;
        if (!mgr || !mgr.activeUnits || mgr.activeUnits.length === 0) return { error: 'no active units' };
        // Find moving humans or workers in a village
        const movingUnit = mgr.activeUnits.find(u => !u.isAnimal && u.isMoving && u.homeCottage) || mgr.activeUnits.find(u => !u.isAnimal && u.isMoving) || mgr.activeUnits[0];
        if (window.controls && window.camera) {
          window.controls.target.set(movingUnit.x, movingUnit.y + 0.2, movingUnit.z);
          window.camera.position.set(movingUnit.x + 4.2, movingUnit.y + 3.8, movingUnit.z + 5.2);
          window.controls.update();
          return { success: true, name: movingUnit.name, role: movingUnit.role, pos: [movingUnit.x, movingUnit.y, movingUnit.z] };
        }
        return { error: 'no controls or camera' };
      })()`,
      returnByValue: true
    });
    console.log('Focus Units result:', JSON.stringify(unitsRes?.result?.value));
    await sleep(2000);
  } else if (INSPECT_UNIT) {
    console.log('Selecting active citizen and opening Unit Inspector Card...');
    const inspectRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const mgr = window.__livingUnitManager;
        if (!mgr || !mgr.activeUnits || mgr.activeUnits.length === 0) return { error: 'no active units' };
        const worker = mgr.activeUnits.find(u => !u.isAnimal && (u.role === 'lumberjack' || u.role === 'water_carrier' || u.role === 'farmer')) || mgr.activeUnits.find(u => !u.isAnimal) || mgr.activeUnits[0];
        if (window.__showUnitInspector) {
          window.__showUnitInspector(worker);
          if (window.controls && window.camera) {
            window.controls.target.set(worker.x, worker.y + 0.25, worker.z);
            window.camera.position.set(worker.x + 3.6, worker.y + 3.0, worker.z + 4.2);
            window.controls.update();
          }
          return { success: true, name: worker.name, role: worker.role, isChild: worker.isChild };
        }
        return { error: 'no inspector' };
      })()`,
      returnByValue: true
    });
    console.log('Inspect result:', JSON.stringify(inspectRes?.result?.value));
  } else if (OPEN_ROSTER) {
    console.log('Opening Population Roster modal...');
    const rosterRes = await send('Runtime.evaluate', {
      expression: `(() => {
        if (window.__openPopulationRoster) {
          window.__openPopulationRoster();
          const modal = document.getElementById('population-roster-modal');
          const isVisible = modal && !modal.classList.contains('hidden');
          const cardsCount = document.querySelectorAll('.roster-unit-card').length;
          return { success: true, isVisible, cardsCount };
        }
        return { error: 'no openPopulationRoster function' };
      })()`,
      returnByValue: true
    });
    console.log('Roster result:', JSON.stringify(rosterRes?.result?.value));
    await sleep(2000);
  } else if (FOLLOW_UNIT) {
    console.log('Selecting active citizen to follow with camera tracking and animated selection ring...');
    const followRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const mgr = window.__livingUnitManager;
        if (!mgr || !mgr.activeUnits || mgr.activeUnits.length === 0) return { error: 'no active units' };
        const citizen = mgr.activeUnits.find(u => !u.isAnimal && u.isMoving) || mgr.activeUnits.find(u => !u.isAnimal) || mgr.activeUnits[0];
        if (window.__startFollowingUnit) {
          window.__startFollowingUnit(citizen);
          return { success: true, id: citizen.id, name: citizen.name, role: citizen.role, pos: [citizen.x, citizen.y, citizen.z] };
        }
        return { error: 'no startFollowingUnit function' };
      })()`,
      returnByValue: true
    });
    console.log('Follow result:', JSON.stringify(followRes?.result?.value));
    await sleep(2500);
  } else {
    // Allow Three.js animate() loop to render multiple frames cleanly
    await sleep(1200);
  }

  if (PHASE || TIME) {
    console.log(`Setting celestial day/night time: phase=${PHASE}, time=${TIME}...`);
    await send('Runtime.evaluate', {
      expression: `(() => {
        if (window.dayNightCycle) {
          if ('${TIME}') window.dayNightCycle.setTime(parseFloat('${TIME}'));
          else if ('${PHASE}' === 'DUSK') window.dayNightCycle.setTime(18.5);
          else if ('${PHASE}' === 'NIGHT') window.dayNightCycle.setTime(22.5);
          else if ('${PHASE}' === 'DAWN') window.dayNightCycle.setTime(6.5);
          else if ('${PHASE}' === 'DAY') window.dayNightCycle.setTime(12.0);
        }
      })()`,
      returnByValue: true
    });
    await sleep(2500);
  }

  if (FRUSTUM_CHECK) {
    console.log('\n--- Evaluating Three.js Frustum Culling & Draw Calls ---');
    const fullRes = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          drawCalls: window.renderer ? window.renderer.info.render.calls : 0,
          triangles: window.renderer ? window.renderer.info.render.triangles : 0,
          totalMeshes: window.__worldGen && window.__worldGen.worldGroup ? window.__worldGen.worldGroup.children.length : 0
        };
      })()`,
      returnByValue: true
    });
    console.log('Full View Metrics:', JSON.stringify(fullRes?.result?.value));

    // Zoom camera in tight to a single village
    await send('Runtime.evaluate', {
      expression: `(() => {
        const valid = window.__worldGen?.hexList?.filter(t => t.building && t.worldPos) || [];
        if (valid.length > 0 && window.controls && window.camera) {
          const avgX = valid.reduce((s, t) => s + t.worldPos.x, 0) / valid.length;
          const avgZ = valid.reduce((s, t) => s + t.worldPos.z, 0) / valid.length;
          const avgY = valid.reduce((s, t) => s + t.worldPos.y, 0) / valid.length;
          window.controls.target.set(avgX, avgY, avgZ);
          window.camera.position.set(avgX + 1.8, avgY + 1.5, avgZ + 2.0);
          window.controls.update();
        }
      })()`
    });
    await sleep(2000);

    const zoomRes = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          drawCalls: window.renderer ? window.renderer.info.render.calls : 0,
          triangles: window.renderer ? window.renderer.info.render.triangles : 0
        };
      })()`,
      returnByValue: true
    });
    console.log('Zoomed-In Metrics (Frustum Culled):', JSON.stringify(zoomRes?.result?.value));

    const fullCalls = fullRes?.result?.value?.drawCalls || 0;
    const zoomCalls = zoomRes?.result?.value?.drawCalls || 0;
    console.log(`[Frustum Culling Report] Full View: ${fullCalls} calls -> Zoomed In: ${zoomCalls} calls (Culled: ${fullCalls - zoomCalls} calls)`);
    console.log('--------------------------------------------------------\n');
  }

  console.log('Capturing high-resolution viewport screenshot...');
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });

  if (screenshotRes && screenshotRes.data) {
    const buffer = Buffer.from(screenshotRes.data, 'base64');
    await writeFile(OUT_PATH, buffer);
    console.log(`Visual screenshot successfully saved to: ${OUT_PATH} (${buffer.length} bytes)`);
  } else {
    console.error('Screenshot capture failed: no image data');
  }

  ws.close();
  chrome.kill();
}

capture().catch(err => {
  console.error('Visual capture error:', err);
  process.exit(1);
});
