/**
 * main.js
 * Entry point for the KayKit Hexagonal World Generator & Tile/Edge Aligner.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

import { ASSET_MANIFEST, TEXTURE_ATLASES } from './assetManifest.js';
import { HEX_DIRECTIONS } from './hexMath.js';
import { tileRegistry, CONNECTOR_TYPES } from './tileRegistry.js';
import { TileCatalogInspector } from './tileCatalog.js';
import { WorldGenerator } from './worldGenerator.js';
import { rebuildAutotileLookup } from './roadAutotile.js';
import { LivingWorldNavMesh } from './livingWorldNavMesh.js';
import { LivingUnitRenderer } from './livingUnitRenderer.js';
import { LivingUnitManager } from './livingUnitManager.js';
import { DayNightCycle } from './dayNightCycle.js';
import { PerformanceLogger } from './perfLogger.js';

// --- Scene, Camera, Lighting & Renderer Setup ---
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.FogExp2(0x0f172a, 0.015);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 2;
controls.maxDistance = 300;
controls.target.set(0, 0, 0);
window.camera = camera;
window.controls = controls;
window.renderer = renderer;
window.scene = scene;

// Safe event listener helper
const on = (el, evt, fn) => { if (el) el.addEventListener(evt, fn); };

// Living World Simulation References
const simClock = new THREE.Clock();
let livingNavMesh = null;
let livingUnitRenderer = null;
let livingUnitManager = null;
let followSelectedUnit = false;
let cropMeshesGroup = null;
let grainTemplate = null;

async function initCropMeshes() {
  if (cropMeshesGroup) {
    scene.remove(cropMeshesGroup);
    cropMeshesGroup = null;
  }
  cropMeshesGroup = new THREE.Group();
  cropMeshesGroup.name = "LivingWorldCrops";
  scene.add(cropMeshesGroup);

  if (!livingNavMesh || !livingNavMesh.pois || !livingNavMesh.pois.farms) return;
  const farms = livingNavMesh.pois.farms;
  if (farms.length === 0) return;

  try {
    if (!grainTemplate) {
      grainTemplate = await fbxLoader.loadAsync('./kaykit_full/Models/buildings/neutral/building_grain.fbx');
      grainTemplate.traverse(node => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
    }

    for (const farm of farms) {
      const mesh = grainTemplate.clone();
      mesh.position.set(farm.worldX, farm.worldY, farm.worldZ);
      mesh.rotation.y = (farm.id * 1.05) % (Math.PI * 2);
      mesh.scale.setScalar(0.001);
      mesh.visible = false;
      if (worldGen && farm.tile) {
        worldGen.applyBiomeToMesh(mesh, farm.tile.biomeTheme || 'spring');
      }
      cropMeshesGroup.add(mesh);
      farm.mesh = mesh;
    }
  } catch (err) {
    console.warn("Failed to initialize 3D grain crop meshes:", err);
  }
}

// Real-Time FPS Tracker & Subsystems
let fpsFrameCount = 0;
let fpsLastTime = performance.now();
const fpsCounterEl = document.getElementById('fps-counter');
let dayNightCycle = null;
let perfLogger = null;
let _animFrameNum = 0;
const _followTargetVec = new THREE.Vector3();
const _followPrevTarget = new THREE.Vector3();
const _followDelta = new THREE.Vector3();

// Animation Loop (starts immediately so WebGL canvas is never frozen)
function animate() {
  requestAnimationFrame(animate);
  const dt = simClock.getDelta();
  _animFrameNum++;

  // Update Day/Night celestial lighting cycle
  if (dayNightCycle) {
    dayNightCycle.update(dt);
  }

  // Update FPS telemetry (O(1) ring buffer — safe to record every frame)
  if (perfLogger) {
    perfLogger.recordFrame(dt);
  }

  // Update FPS counter in top-right ("FPS: {nn}")
  fpsFrameCount++;
  const fpsNow = performance.now();
  if (fpsNow - fpsLastTime >= 500) {
    const fps = perfLogger ? perfLogger.metrics.fpsAvg : Math.round((fpsFrameCount * 1000) / (fpsNow - fpsLastTime));
    if (fpsCounterEl) {
      fpsCounterEl.textContent = `FPS: ${fps}`;
    }
    fpsFrameCount = 0;
    fpsLastTime = fpsNow;
  }

  if (livingUnitManager && livingUnitRenderer && window.__worldGenReady) {
    if (dayNightCycle) {
      livingUnitManager.setTimePhase(dayNightCycle.phase, dayNightCycle.timeOfDay);
    }

    const simStart = performance.now();
    livingUnitManager.update(dt);
    const simTickMs = performance.now() - simStart;

    // PerfLogger context: throttled to every 30th frame
    if (perfLogger) {
      perfLogger.recordSimTick(simTickMs);
      if (_animFrameNum % 30 === 0) {
        window.__renderMetrics = {
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          batchedMeshes: worldGen?.worldGroup?.children?.length || 0,
          fps: perfLogger ? perfLogger.metrics.fpsAvg : 60
        };
        perfLogger.setContext({
          activeUnits: livingUnitManager.activeUnits.length,
          totalUnits: livingUnitManager.stats.totalPopulation,
          hexCount: worldGen && worldGen.hexList ? worldGen.hexList.length : 0,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles
        });
      }
    }

    livingUnitRenderer.renderUnits(livingUnitManager.activeUnits, livingUnitManager.simTimeSec, livingUnitManager.selectedUnit);

    // Live update dynamic crop meshes on farm plots (throttled to every 15th frame)
    if ((_animFrameNum % 15 === 0) && livingNavMesh && livingNavMesh.pois && livingNavMesh.pois.farms) {
      for (const farm of livingNavMesh.pois.farms) {
        if (farm.mesh) {
          if (farm.hasCrop && farm.cropGrowth > 0.05) {
            farm.mesh.visible = true;
            const currentScale = 0.12 + Math.min(0.36, farm.cropGrowth * 0.36);
            farm.mesh.scale.setScalar(currentScale);
          } else {
            farm.mesh.visible = false;
          }
        }
      }
    }

    // Follow camera if enabled (zero-allocation path)
    if (followSelectedUnit && livingUnitManager.selectedUnit) {
      const su = livingUnitManager.selectedUnit;
      _followTargetVec.set(su.x, su.y + 0.35, su.z);

      _followPrevTarget.copy(controls.target);
      controls.target.lerp(_followTargetVec, 0.12);

      // Translate camera position along with target so camera glides with the unit
      _followDelta.subVectors(controls.target, _followPrevTarget);
      camera.position.add(_followDelta);

      // Live update activity in inspector card if open (every frame — single string lookup, cheap)
      if (unitInspectorCard && unitInspectorCard.style.display !== 'none' && unitCardActivity) {
        unitCardActivity.textContent = livingUnitManager.getUnitActivityText(su);
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// Browser diagnostics & protocol warning
if (window.location.protocol === 'file:') {
  const fileWarn = document.getElementById('file-protocol-warning');
  if (fileWarn) fileWarn.style.display = 'block';
}

window.addEventListener('error', (event) => {
  console.error('[App Runtime Error]', event.error || event.message);
  const toast = document.getElementById('error-toast');
  const toastMsg = document.getElementById('error-toast-msg');
  if (toast && toastMsg) {
    toastMsg.textContent = `${event.message || 'An error occurred'} (${event.filename ? event.filename.split('/').pop() : ''}:${event.lineno || ''})`;
    toast.style.display = 'block';
  }
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[App Unhandled Rejection]', event.reason);
  const toast = document.getElementById('error-toast');
  const toastMsg = document.getElementById('error-toast-msg');
  if (toast && toastMsg) {
    toastMsg.textContent = `Async error: ${event.reason?.message || event.reason || 'Promise rejected'}`;
    toast.style.display = 'block';
  }
});

const btnToastDismiss = document.getElementById('btn-toast-dismiss');
on(btnToastDismiss, 'click', () => {
  const toast = document.getElementById('error-toast');
  if (toast) toast.style.display = 'none';
});

// --- Vibrant Medieval Lighting ---
const ambientLight = new THREE.AmbientLight(0xfffaed, 1.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffedd5, 2.6);
sunLight.position.set(25, 35, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 100;
sunLight.shadow.camera.left = -30;
sunLight.shadow.camera.right = 30;
sunLight.shadow.camera.top = 30;
sunLight.shadow.camera.bottom = -30;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x334155, 0.85);
scene.add(hemiLight);

// --- Performance & NFR Telemetry Logger ---
perfLogger = new PerformanceLogger({ rollingWindowSize: 120 });
window.perfLogger = perfLogger;
window.getPerfMetrics = () => perfLogger.getMetrics();
window.logPerfReport = () => console.log(perfLogger.getSummaryString());

// --- Continuous 24-Hour Day / Night Celestial Lighting Cycle ---
dayNightCycle = new DayNightCycle({
  scene,
  sunLight,
  ambientLight,
  hemiLight,
  renderer,
  initialTime: 10.0, // Start at 10:00 morning
  speedMultiplier: 0.20 // 5 real seconds = 1 game hour (~120s full day)
});
window.dayNightCycle = dayNightCycle;

const dayNightWidget = document.getElementById('daynight-widget');
if (dayNightWidget) {
  on(dayNightWidget, 'click', () => {
    dayNightCycle.cycleNextPhase();
  });
}

// --- Subsystems ---
const fbxLoader = new FBXLoader();
fbxLoader.setResourcePath('./kaykit_full/Textures/');
const inspector = new TileCatalogInspector(scene, fbxLoader);
const worldGen = new WorldGenerator(scene, fbxLoader);

worldGen.setVisible(false);
inspector.setVisible(true);

window.__inspector = inspector;
window.__worldGen = worldGen;
window.__tileRegistry = tileRegistry;

// --- UI Elements ---
const tabInspector = document.getElementById('tab-inspector');
const tabWorld = document.getElementById('tab-world');
const panelInspector = document.getElementById('panel-inspector');
const panelWorld = document.getElementById('panel-world');
const btnTopRandomSeed = document.getElementById('btn-top-random-seed');

const selectCategory = document.getElementById('select-category');
const selectTile = document.getElementById('select-tile');
const btnTilePrev = document.getElementById('btn-tile-prev');
const btnTileNext = document.getElementById('btn-tile-next');

const btnRotPrev = document.getElementById('btn-rot-prev');
const btnRotReset = document.getElementById('btn-rot-reset');
const btnRotNext = document.getElementById('btn-rot-next');
const rotLabel = document.getElementById('rot-label');

const edgeRowsContainer = document.getElementById('edge-rows-container');
const btnSaveEdges = document.getElementById('btn-save-edges');
const btnExportJson = document.getElementById('btn-export-json');
const btnResetDefaults = document.getElementById('btn-reset-defaults');

// Modal
const modalJson = document.getElementById('modal-json');
const textareaJson = document.getElementById('textarea-json');
const btnCopyJson = document.getElementById('btn-copy-json');
const btnImportJson = document.getElementById('btn-import-json');
const btnCloseModal = document.getElementById('btn-close-modal');

// World Controls
const inputSeed = document.getElementById('input-seed');
const btnRandomSeed = document.getElementById('btn-random-seed');
const selectMapShape = document.getElementById('select-map-shape');
const selectBiomeMode = document.getElementById('select-biome-mode');
const selectWfcSafety = document.getElementById('select-wfc-safety');
const sliderRadius = document.getElementById('slider-radius');
const labelRadius = document.getElementById('label-radius');
const badgeMapHexes = document.getElementById('badge-map-hexes');
const presetChips = document.querySelectorAll('.preset-chip');
const sliderRivers = document.getElementById('slider-rivers');
const labelRivers = document.getElementById('label-rivers');
const badgeRiversCap = document.getElementById('badge-rivers-cap');
const sliderWater = document.getElementById('slider-water');
const labelWater = document.getElementById('label-water');
const sliderTrees = document.getElementById('slider-trees');
const labelTrees = document.getElementById('label-trees');
const sliderMountains = document.getElementById('slider-mountains');
const labelMountains = document.getElementById('label-mountains');
const selectWallStyle = document.getElementById('select-wall-style');
const sliderVillages = document.getElementById('slider-villages');
const labelVillages = document.getElementById('label-villages');
const btnRegenerate = document.getElementById('btn-regenerate');
const btnNewSeed = document.getElementById('btn-new-seed');

const progressContainer = document.getElementById('gen-progress-container');
const progressBar = document.getElementById('gen-progress-bar');
const progressLabel = document.getElementById('gen-progress-label');
const progressPct = document.getElementById('gen-progress-pct');

const floatingGenProgress = document.getElementById('floating-gen-progress');
const floatingProgressBar = document.getElementById('floating-progress-bar');
const floatingProgressStatus = document.getElementById('floating-progress-status');
const floatingProgressPct = document.getElementById('floating-progress-pct');

let currentCategory = 'roads';
let currentTileKey = 'road_A';
let currentTilePath = '';

function adjustCameraForRadius(r, shape = null) {
  const curShape = shape || (selectMapShape ? selectMapShape.value : 'rectangular');
  const isRect = curShape === 'rectangular';
  // Scale target distance smoothly from r=5 up to r=50 (50x50 map)
  const targetDist = isRect ? (r * 2.8 + 8.0) : (r * 3.3 + 6.0);
  camera.position.set(0, targetDist * 0.85, targetDist * 1.05);
  controls.target.set(0, 0, isRect ? 0.8 : 0);
  controls.maxDistance = Math.max(300, targetDist * 3.5);
  controls.update();

  if (scene.fog) {
    scene.fog.density = 0.08 / Math.max(6, r);
  }

  // Adaptive shadow quality based on map size
  // Large maps: disable shadows entirely (saves a full GPU render pass for thousands of meshes)
  // Medium maps: reduce shadow map resolution
  if (sunLight && sunLight.shadow) {
    const hexEstimate = isRect ? (r * 2) * (Math.round(r * 1.6)) : (3 * r * r + 3 * r + 1);
    if (hexEstimate > 500) {
      // Large map: disable shadows for major FPS recovery
      sunLight.castShadow = false;
      renderer.shadowMap.enabled = false;
    } else {
      sunLight.castShadow = true;
      renderer.shadowMap.enabled = true;
      const shadowSpan = Math.max(30, r * 1.65);
      sunLight.shadow.camera.left = -shadowSpan;
      sunLight.shadow.camera.right = shadowSpan;
      sunLight.shadow.camera.top = shadowSpan;
      sunLight.shadow.camera.bottom = -shadowSpan;
      sunLight.shadow.camera.far = Math.max(120, targetDist * 2.5);
      sunLight.position.set(shadowSpan * 0.8, shadowSpan * 1.1, shadowSpan * 0.6);
      if (hexEstimate > 250) {
        // Medium map: lower shadow resolution
        sunLight.shadow.mapSize.width = 512;
        sunLight.shadow.mapSize.height = 512;
      } else {
        sunLight.shadow.mapSize.width = 1024;
        sunLight.shadow.mapSize.height = 1024;
      }
      sunLight.shadow.camera.updateProjectionMatrix();
    }
  }
}

function updateRiverCapacity(totalHexEstimate) {
  if (!sliderRivers) return;
  let maxRivers = 2;
  let capBadgeText = 'Max 2 (Small)';
  let capTitle = 'Small map (≤ 150 hexes): up to 2 river systems';

  if (totalHexEstimate > 1400) {
    maxRivers = 8;
    capBadgeText = 'Max 8 (Mega)';
    capTitle = 'Mega map (> 1,400 hexes): up to 8 independent river systems';
  } else if (totalHexEstimate > 600) {
    maxRivers = 6;
    capBadgeText = 'Max 6 (Large)';
    capTitle = 'Large map (> 600 hexes): up to 6 independent river systems';
  } else if (totalHexEstimate > 150) {
    maxRivers = 4;
    capBadgeText = 'Max 4 (Medium)';
    capTitle = 'Medium map (> 150 hexes): up to 4 independent river systems';
  }

  sliderRivers.max = String(maxRivers);
  if (parseInt(sliderRivers.value, 10) > maxRivers) {
    sliderRivers.value = String(maxRivers);
  }
  const v = parseInt(sliderRivers.value, 10);
  if (labelRivers) {
    labelRivers.textContent = v === 0 ? 'None' : (v === 1 ? '1 River' : `${v} Rivers`);
  }
  if (badgeRiversCap) {
    badgeRiversCap.textContent = capBadgeText;
    badgeRiversCap.title = capTitle;
  }
}

function getAutoVillagesCount(hexEstimate) {
  if (hexEstimate < 150) return 2;
  if (hexEstimate < 600) return 3;
  if (hexEstimate < 1500) return 4;
  return 6;
}

let currentHexEstimate = 66;

function updateVillagesLabel() {
  if (!sliderVillages || !labelVillages) return;
  const v = parseInt(sliderVillages.value, 10);
  if (v === 0) {
    const autoCount = getAutoVillagesCount(currentHexEstimate);
    labelVillages.textContent = `Auto (${autoCount})`;
  } else if (v === 1) {
    labelVillages.textContent = '1 Village';
  } else {
    labelVillages.textContent = `${v} Villages`;
  }
}

function updateMapSizeLabel() {
  const r = parseInt(sliderRadius?.value, 10) || 6;
  const isRect = (selectMapShape ? selectMapShape.value : 'rectangular') === 'rectangular';
  let desc = '';

  let totalHexEstimate = 0;
  if (isRect) {
    let cols, rows;
    if (r <= 12) {
      cols = Math.max(8, Math.round(r * 1.75));
      rows = Math.max(5, Math.round(r * 1.05));
    } else {
      const t = Math.min(1.0, (r - 12) / (50 - 12));
      cols = Math.min(50, Math.round(21 + t * (50 - 21)));
      rows = Math.min(50, Math.round(13 + t * (50 - 13)));
    }
    totalHexEstimate = cols * rows;
    desc = `${cols}×${rows} (${totalHexEstimate.toLocaleString()} hexes)`;
  } else {
    const effR = Math.min(28, r);
    totalHexEstimate = 3 * effR * (effR + 1) + 1;
    desc = `Radius ${effR} (${totalHexEstimate.toLocaleString()} hexes)`;
  }

  currentHexEstimate = totalHexEstimate;

  if (labelRadius) labelRadius.textContent = desc;
  if (badgeMapHexes) {
    badgeMapHexes.textContent = '';
    badgeMapHexes.style.display = 'none';
  }

  updateRiverCapacity(totalHexEstimate);
  updateVillagesLabel();

  if (presetChips) {
    presetChips.forEach(chip => {
      const chipR = parseInt(chip.getAttribute('data-radius'), 10);
      chip.classList.toggle('active', chipR === r);
    });
  }
}

// Staged Progress Tracking with Smooth Guessing Interpolator
let currentProgress = 0;
let targetProgress = 0;
let progressStatusText = '';
let progressAnimId = null;

function startProgressTracking() {
  currentProgress = 0.05;
  targetProgress = 0.12;
  progressStatusText = 'Synthesizing heightmap & hex topology...';

  if (progressContainer) progressContainer.style.display = 'block';
  if (floatingGenProgress) {
    floatingGenProgress.style.display = 'block';
    floatingGenProgress.style.animation = 'fadeInSlide 0.25s ease-out';
  }

  renderProgressUI();

  function progressTick() {
    if (!worldGen.isGenerating) return;

    // Smoothly creep forward towards targetProgress, or slightly forward if target hasn't moved
    if (currentProgress < targetProgress) {
      currentProgress += (targetProgress - currentProgress) * 0.12;
    } else if (currentProgress < 0.96) {
      // Gentle creep ("guessing progress") while heavier step runs
      currentProgress += 0.0015;
    }

    renderProgressUI();
    progressAnimId = requestAnimationFrame(progressTick);
  }

  if (progressAnimId) cancelAnimationFrame(progressAnimId);
  progressAnimId = requestAnimationFrame(progressTick);
}

function updateProgressStage(pct, statusText) {
  targetProgress = Math.max(targetProgress, pct);
  if (statusText) progressStatusText = statusText;
}

function renderProgressUI() {
  const pctInt = Math.min(100, Math.round(currentProgress * 100));
  const pctStr = `${pctInt}%`;

  if (progressBar) progressBar.style.width = pctStr;
  if (progressLabel) progressLabel.textContent = progressStatusText;
  if (progressPct) progressPct.textContent = pctStr;

  if (floatingProgressBar) floatingProgressBar.style.width = pctStr;
  if (floatingProgressStatus) floatingProgressStatus.textContent = progressStatusText;
  if (floatingProgressPct) floatingProgressPct.textContent = pctStr;

  if (btnTopRandomSeed && btnTopRandomSeed.disabled) {
    btnTopRandomSeed.innerHTML = `<span>⏳</span><span>${pctStr}</span>`;
  }
}

function finishProgressTracking() {
  currentProgress = 1.0;
  targetProgress = 1.0;
  progressStatusText = 'Generation complete!';
  renderProgressUI();

  if (progressAnimId) {
    cancelAnimationFrame(progressAnimId);
    progressAnimId = null;
  }

  setTimeout(() => {
    if (progressContainer) progressContainer.style.display = 'none';
    if (floatingGenProgress) {
      floatingGenProgress.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => {
        floatingGenProgress.style.display = 'none';
        floatingGenProgress.style.animation = '';
      }, 250);
    }
  }, 1200);
}

// Expand / Collapse Settings Panel
const panelWrapper = document.getElementById('panel-wrapper');
const btnTogglePanel = document.getElementById('btn-toggle-panel');
const togglePanelIcon = document.getElementById('toggle-panel-icon');
const togglePanelText = document.getElementById('toggle-panel-text');

function updateTopSeedButtonVisibility() {
  const isWorld = tabWorld?.classList.contains('active');
  const isCollapsed = panelWrapper?.classList.contains('collapsed');
  if (btnTopRandomSeed) {
    btnTopRandomSeed.style.display = (isWorld && isCollapsed) ? 'inline-flex' : 'none';
  }
}

window.setPanelCollapsed = function(collapsed) {
  const wrapper = document.getElementById('panel-wrapper');
  if (!wrapper) return;
  const icon = document.getElementById('toggle-panel-icon');
  const txt = document.getElementById('toggle-panel-text');
  const toggleBtn = document.getElementById('btn-toggle-panel');
  const isWorldTab = document.getElementById('tab-world')?.classList.contains('active');

  if (collapsed) {
    wrapper.classList.add('collapsed');
    if (icon) icon.textContent = '▶';
    if (txt) txt.textContent = isWorldTab ? 'World Settings' : 'Aligner Menu';
    if (toggleBtn) {
      toggleBtn.title = 'Expand Settings Panel (Press H or click)';
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  } else {
    wrapper.classList.remove('collapsed');
    if (icon) icon.textContent = '◀';
    if (txt) txt.textContent = '';
    if (toggleBtn) {
      toggleBtn.title = 'Collapse Settings Panel (Press H or click)';
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
  }
  updateTopSeedButtonVisibility();
};

window.togglePanel = function(e) {
  if (e) {
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }
  const wrapper = document.getElementById('panel-wrapper');
  if (!wrapper) return;
  const isCollapsed = wrapper.classList.contains('collapsed');
  window.setPanelCollapsed(!isCollapsed);
};

// 1. Floating side tab: toggles panel
if (btnTogglePanel) {
  btnTogglePanel.addEventListener('click', (e) => {
    e.stopPropagation();
    window.togglePanel();
  });
}

// 2. Minimize buttons: ALWAYS collapse (idempotent)
['btn-world-minimize', 'btn-inspector-minimize'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      window.setPanelCollapsed(true);
    });
  }
});

// 3. Header rows: collapse when clicked (idempotent)
['header-world', 'header-inspector'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.btn-panel-minimize')) return;
      e.stopPropagation();
      window.setPanelCollapsed(true);
    });
  }
});

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'h' || e.key === 'H') {
    window.togglePanel();
  }
  if (e.key === 'r' || e.key === 'R') {
    const isWorldTab = document.getElementById('tab-world')?.classList.contains('active');
    if (isWorldTab && !worldGen.isGenerating) {
      if (inputSeed) inputSeed.value = Math.floor(Math.random() * 100000);
      triggerWorldGen();
    }
  }
});

// Tab switching
on(tabInspector, 'click', () => {
  tabInspector?.classList.add('active');
  tabWorld?.classList.remove('active');
  panelInspector?.classList.add('active');
  panelWorld?.classList.remove('active');

  const wrapper = document.getElementById('panel-wrapper');
  if (wrapper?.classList.contains('collapsed')) {
    const txt = document.getElementById('toggle-panel-text');
    if (txt) txt.textContent = 'Tile Aligner';
  }

  updateTopSeedButtonVisibility();
  worldGen.setVisible(false);
  inspector.setVisible(true);
  controls.target.set(0, 0, 0);
  camera.position.set(0, 4, 5.5);
  controls.update();
  if (scene.fog) scene.fog.density = 0.015;
});

on(tabWorld, 'click', () => {
  tabWorld?.classList.add('active');
  tabInspector?.classList.remove('active');
  panelWorld?.classList.add('active');
  panelInspector?.classList.remove('active');

  const wrapper = document.getElementById('panel-wrapper');
  if (wrapper?.classList.contains('collapsed')) {
    const txt = document.getElementById('toggle-panel-text');
    if (txt) txt.textContent = 'World Settings';
  }

  updateTopSeedButtonVisibility();
  inspector.setVisible(false);
  worldGen.setVisible(true);
  const curRad = parseInt(sliderRadius?.value, 10) || 6;
  adjustCameraForRadius(curRad);

  if (worldGen.worldGroup.children.length === 0) {
    triggerWorldGen();
  }
});

// Category & Tile Population
function populateCategoryTiles() {
  if (!selectTile) return;
  selectTile.innerHTML = '';
  let items = {};

  if (currentCategory === 'roads') {
    items = ASSET_MANIFEST.tiles.roads;
  } else if (currentCategory === 'rivers') {
    items = ASSET_MANIFEST.tiles.rivers;
  } else if (currentCategory === 'coast') {
    items = ASSET_MANIFEST.tiles.coast;
  } else if (currentCategory === 'base') {
    items = ASSET_MANIFEST.tiles.base;
  } else if (currentCategory === 'buildings') {
    items = ASSET_MANIFEST.buildings.blue;
  } else if (currentCategory === 'nature') {
    items = ASSET_MANIFEST.decoration.nature;
  }

  for (const [key, val] of Object.entries(items)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.dataset.path = typeof val === 'string' ? val : val.path;
    opt.textContent = (typeof val === 'object' && val.name) ? val.name : key;
    selectTile.appendChild(opt);
  }

  if (selectTile.options.length > 0) {
    selectActiveTile(selectTile.options[0].value);
  }
}

function selectActiveTile(key) {
  if (!selectTile) return;
  currentTileKey = key;
  selectTile.value = key;
  const opt = selectTile.querySelector(`option[value="${key}"]`);
  currentTilePath = opt ? opt.dataset.path : '';

  inspector.loadTile(currentTileKey, currentTilePath);
  renderEdgeRows();
  updateRotation(0);
}

on(selectCategory, 'change', (e) => {
  currentCategory = e.target.value;
  populateCategoryTiles();
});

on(selectTile, 'change', (e) => {
  selectActiveTile(e.target.value);
});

// Prev / Next tile buttons
on(btnTilePrev, 'click', () => {
  if (!selectTile) return;
  const idx = selectTile.selectedIndex;
  if (idx > 0) {
    selectTile.selectedIndex = idx - 1;
    selectActiveTile(selectTile.value);
  }
});

on(btnTileNext, 'click', () => {
  if (!selectTile) return;
  const idx = selectTile.selectedIndex;
  if (idx < selectTile.options.length - 1) {
    selectTile.selectedIndex = idx + 1;
    selectActiveTile(selectTile.value);
  }
});

// Rotation controls
let currentStep = 0;
function updateRotation(newStep) {
  currentStep = inspector.setRotationStep(newStep);
  if (rotLabel) rotLabel.textContent = `Step ${currentStep} (${currentStep * 60}°)`;
}

on(btnRotPrev, 'click', () => updateRotation(currentStep - 1));
on(btnRotReset, 'click', () => updateRotation(0));
on(btnRotNext, 'click', () => updateRotation(currentStep + 1));

// Edge Rows Configurator UI
function renderEdgeRows() {
  edgeRowsContainer.innerHTML = '';
  const tileDef = tileRegistry.getTile(currentTileKey);
  const edges = tileDef ? tileDef.edges : { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' };

  for (let i = 0; i < 6; i++) {
    const dir = HEX_DIRECTIONS[i];
    const currentVal = edges[i] || 'none';

    const row = document.createElement('div');
    row.className = 'edge-row';

    const label = document.createElement('div');
    label.className = 'edge-row-label';
    label.textContent = `E${i} (${dir.name} ${dir.angleDeg}°):`;

    const select = document.createElement('select');
    select.className = 'edge-type-select';
    select.dataset.edge = i;
    select.dataset.val = currentVal;

    const options = [
      { val: 'none', label: '🌿 Land / Grass' },
      { val: 'water', label: '🌊 Water / Lake / Ocean' },
      { val: 'sand', label: '🏖️ Sand / Beach' },
      { val: 'road', label: '🟧 Road Exit' }
    ];

    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.val;
      o.textContent = opt.label;
      if (opt.val === currentVal) o.selected = true;
      select.appendChild(o);
    }

    select.addEventListener('change', (e) => {
      const val = e.target.value;
      select.dataset.val = val;
      tileRegistry.setEdgeConnector(currentTileKey, i, val);
      inspector.refreshEdgeVisuals();
    });

    row.appendChild(label);
    row.appendChild(select);
    edgeRowsContainer.appendChild(row);
  }
}

// 3D Direct Click on Edge Sockets in Viewport
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

container.addEventListener('click', (e) => {
  if (!inspector.edgeMarkersGroup.visible) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(inspector.interactiveEdgeMeshes);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    const edgeIndex = hit.userData.edgeIndex;
    if (edgeIndex !== undefined) {
      // Cycle connector type: none -> road -> river -> coast -> none
      const order = ['none', 'road', 'water', 'sand'];
      const tileDef = tileRegistry.getTile(currentTileKey);
      const cur = (tileDef && tileDef.edges[edgeIndex]) || 'none';
      const nextIdx = (order.indexOf(cur) + 1) % order.length;
      const nextType = order[nextIdx];

      tileRegistry.setEdgeConnector(currentTileKey, edgeIndex, nextType);
      inspector.refreshEdgeVisuals();
      renderEdgeRows();
    }
  }
});

// Save & Apply
on(btnSaveEdges, 'click', () => {
  tileRegistry.save();
  rebuildAutotileLookup();
  if (btnSaveEdges) {
    btnSaveEdges.textContent = '✅ Saved & Applied!';
    setTimeout(() => { if (btnSaveEdges) btnSaveEdges.textContent = '💾 Save & Apply to World'; }, 1800);
  }
});

// Export / Import JSON Modal
on(btnExportJson, 'click', () => {
  if (textareaJson && modalJson) {
    textareaJson.value = tileRegistry.exportJSON();
    modalJson.style.display = 'flex';
  }
});

on(btnCopyJson, 'click', () => {
  if (textareaJson) {
    navigator.clipboard.writeText(textareaJson.value);
    if (btnCopyJson) {
      btnCopyJson.textContent = 'Copied!';
      setTimeout(() => { if (btnCopyJson) btnCopyJson.textContent = 'Copy to Clipboard'; }, 1500);
    }
  }
});

on(btnImportJson, 'click', () => {
  if (!textareaJson) return;
  if (tileRegistry.importJSON(textareaJson.value)) {
    rebuildAutotileLookup();
    inspector.refreshEdgeVisuals();
    renderEdgeRows();
    alert('Configuration imported successfully!');
    if (modalJson) modalJson.style.display = 'none';
  } else {
    alert('Failed to parse JSON. Please check syntax.');
  }
});

on(btnCloseModal, 'click', () => {
  if (modalJson) modalJson.style.display = 'none';
});

on(btnResetDefaults, 'click', () => {
  if (confirm('Reset all tile edge connections to defaults?')) {
    tileRegistry.resetToDefaults();
    rebuildAutotileLookup();
    inspector.refreshEdgeVisuals();
    renderEdgeRows();
  }
});

// World Generation Controls
on(sliderRadius, 'input', () => {
  updateMapSizeLabel();
  adjustCameraForRadius(parseInt(sliderRadius?.value, 10) || 6);
});
on(sliderRadius, 'change', () => {
  triggerWorldGen();
});

if (presetChips) {
  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const r = parseInt(chip.getAttribute('data-radius'), 10);
      if (sliderRadius) {
        sliderRadius.value = r;
        updateMapSizeLabel();
        triggerWorldGen();
      }
    });
  });
}

on(sliderRivers, 'input', () => {
  if (!sliderRivers || !labelRivers) return;
  const v = parseInt(sliderRivers.value, 10);
  labelRivers.textContent = v === 0 ? 'None' : (v === 1 ? '1 River' : `${v} Rivers`);
});
on(sliderRivers, 'change', () => {
  triggerWorldGen();
});
on(sliderWater, 'input', () => {
  if (labelWater && sliderWater) labelWater.textContent = `${Math.round(sliderWater.value * 100)}%`;
});
on(sliderTrees, 'input', () => {
  if (labelTrees && sliderTrees) labelTrees.textContent = sliderTrees.value;
});
on(sliderMountains, 'input', () => {
  if (labelMountains && sliderMountains) labelMountains.textContent = `${Math.round(sliderMountains.value * 100)}%`;
});

on(sliderVillages, 'input', () => {
  updateVillagesLabel();
});
on(sliderVillages, 'change', () => {
  triggerWorldGen();
});

on(selectWallStyle, 'change', () => {
  triggerWorldGen();
});

on(btnRandomSeed, 'click', () => {
  if (inputSeed) inputSeed.value = Math.floor(Math.random() * 100000);
});

window.__worldGen = worldGen;
window.__worldGenReady = false;
window.__triggerWorldGen = triggerWorldGen;

on(selectMapShape, 'change', () => {
  updateMapSizeLabel();
  triggerWorldGen();
});

on(selectBiomeMode, 'change', () => {
  triggerWorldGen();
});

on(selectWfcSafety, 'change', () => {
  triggerWorldGen();
});

async function triggerWorldGen() {
  if (worldGen.isGenerating) return;
  window.__worldGenReady = false;

  if (btnRegenerate) {
    btnRegenerate.disabled = true;
    btnRegenerate.textContent = 'Generating...';
  }
  if (btnNewSeed) btnNewSeed.disabled = true;
  if (btnTopRandomSeed) {
    btnTopRandomSeed.disabled = true;
    btnTopRandomSeed.innerHTML = '<span>⏳</span><span>0%</span>';
  }

  startProgressTracking();

  const rad = parseInt(sliderRadius?.value, 10) || 6;
  const shape = selectMapShape ? selectMapShape.value : 'rectangular';
  const biome = selectBiomeMode ? selectBiomeMode.value : 'multi';
  const wfcSafety = selectWfcSafety ? selectWfcSafety.value : 'safe';
  const villageCount = sliderVillages ? parseInt(sliderVillages.value, 10) : 0;
  const wallFortification = selectWallStyle ? selectWallStyle.value : 'walled';
  adjustCameraForRadius(rad, shape);

  try {
    await worldGen.generate({
      radius: rad,
      seed: parseInt(inputSeed?.value || '42', 10),
      waterLevel: parseFloat(sliderWater?.value || '0.08'),
      mountainDensity: parseFloat(sliderMountains?.value || '0.45'),
      treeDensity: parseFloat(sliderTrees?.value || '0.4'),
      riverDensity: parseInt(sliderRivers?.value || '1', 10),
      mapShape: shape,
      biomeMode: biome,
      wfcSafety: wfcSafety,
      villageCount: villageCount > 0 ? villageCount : undefined,
      wallFortification: wallFortification,
      onProgress: (pct, msg) => {
        updateProgressStage(pct, msg);
      }
    });
    window.__worldGenReady = true;

    // Initialize or Refresh Living World Simulation
    try {
      if (cropMeshesGroup) {
        scene.remove(cropMeshesGroup);
        cropMeshesGroup = null;
      }
      if (livingUnitRenderer) {
        livingUnitRenderer.dispose();
        livingUnitRenderer = null;
      }

      livingNavMesh = new LivingWorldNavMesh({ grid: worldGen.grid, hexList: worldGen.hexList });
      livingUnitRenderer = new LivingUnitRenderer(scene, 300);
      livingUnitRenderer.initHorseModel(fbxLoader, worldGen.primaryBiome);
      livingUnitManager = new LivingUnitManager(
        { grid: worldGen.grid, hexList: worldGen.hexList },
        livingNavMesh,
        { maxActiveUnits: 250 }
      );

      initCropMeshes();

      window.__livingNavMesh = livingNavMesh;
      window.__livingUnitRenderer = livingUnitRenderer;
      window.__livingUnitManager = livingUnitManager;

      if (simHud) simHud.style.display = 'flex';
      updateSimulationHUD();
    } catch (simErr) {
      console.error('Living world simulation init error:', simErr);
    }
  } catch (err) {
    console.error('World generation error:', err);
  } finally {
    finishProgressTracking();
    if (btnRegenerate) {
      btnRegenerate.disabled = false;
      btnRegenerate.textContent = '🔄 Regenerate (Same Seed)';
    }
    if (btnNewSeed) btnNewSeed.disabled = false;
    if (btnTopRandomSeed) {
      btnTopRandomSeed.disabled = false;
      btnTopRandomSeed.innerHTML = '<span class="seed-icon">🎲</span><span>New Seed</span>';
    }
  }
}

// --- Living World Simulation UI Controls & Inspector ---
const simHud = document.getElementById('simulation-hud');
const simStatusLabel = document.getElementById('sim-status-label');
const simPopSummary = document.getElementById('sim-pop-summary');
const btnOpenRoster = document.getElementById('btn-open-roster');
const btnSimPlayPause = document.getElementById('btn-sim-play-pause');
const simSpeedBtns = document.querySelectorAll('.sim-speed-btn');

const unitInspectorCard = document.getElementById('unit-inspector-card');
const unitAvatar = document.getElementById('unit-avatar');
const unitCardName = document.getElementById('unit-card-name');
const unitCardRole = document.getElementById('unit-card-role');
const unitCardActivity = document.getElementById('unit-card-activity');
const unitCardHome = document.getElementById('unit-card-home');
const unitCardAge = document.getElementById('unit-card-age');
const btnCloseUnitCard = document.getElementById('btn-close-unit-card');
const btnFollowUnit = document.getElementById('btn-follow-unit');
const btnCardOpenRoster = document.getElementById('btn-card-open-roster');

// Population Roster Modal Elements
const populationRosterModal = document.getElementById('population-roster-modal');
const btnCloseRoster = document.getElementById('btn-close-roster');
const rosterStatsSummary = document.getElementById('roster-stats-summary');
const rosterFilterChips = document.querySelectorAll('.roster-chip');
const inputRosterSearch = document.getElementById('input-roster-search');
const rosterCardsContainer = document.getElementById('roster-cards-container');

function updateSimulationHUD() {
  if (!livingUnitManager) return;
  if (simPopSummary) {
    simPopSummary.textContent = `🏃 ${livingUnitManager.stats.activeUnitsCount} Active / ${livingUnitManager.stats.totalPopulation} Pop`;
  }
  if (simStatusLabel) {
    simStatusLabel.textContent = livingUnitManager.isPaused ? 'Simulation Paused' : 'Living World Active';
  }
  if (btnSimPlayPause) {
    btnSimPlayPause.textContent = livingUnitManager.isPaused ? '▶️ Resume' : '⏸️ Pause';
  }
}

if (btnSimPlayPause) {
  on(btnSimPlayPause, 'click', () => {
    if (!livingUnitManager) return;
    livingUnitManager.isPaused = !livingUnitManager.isPaused;
    updateSimulationHUD();
  });
}

if (simSpeedBtns) {
  simSpeedBtns.forEach(btn => {
    on(btn, 'click', () => {
      if (!livingUnitManager) return;
      const speed = parseFloat(btn.getAttribute('data-speed')) || 1.0;
      livingUnitManager.simSpeed = speed;
      simSpeedBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

function startFollowingUnit(unit) {
  if (!unit || !livingUnitManager) return;

  // If resting inside a cottage, wake them up immediately so they are active outside
  if (unit.isResting) {
    livingUnitManager.wakeUnit(unit);
  }

  livingUnitManager.selectedUnit = unit;
  followSelectedUnit = true;

  // Show unit inspector card
  showUnitInspector(unit);
  if (btnFollowUnit) {
    btnFollowUnit.textContent = '⏹️ Stop Following';
    btnFollowUnit.style.background = '#dc2626';
    btnFollowUnit.style.borderColor = '#f87171';
  }

  // Smoothly position camera at a comfortable isometric follow distance (~7 units away)
  const targetVec = new THREE.Vector3(unit.x, unit.y + 0.35, unit.z);
  controls.target.copy(targetVec);

  const currentCamOffset = camera.position.clone().sub(targetVec);
  if (currentCamOffset.length() > 18 || currentCamOffset.length() < 3) {
    camera.position.set(unit.x + 4.5, unit.y + 5.5, unit.z + 5.0);
  }
  controls.update();

  // Close roster modal so user has full view of the world
  closePopulationRoster();
}

function stopFollowingUnit() {
  followSelectedUnit = false;
  if (btnFollowUnit) {
    btnFollowUnit.textContent = '🎥 Follow with Camera';
    btnFollowUnit.style.background = '';
    btnFollowUnit.style.borderColor = '';
  }
}

if (btnCloseUnitCard) {
  on(btnCloseUnitCard, 'click', () => {
    if (unitInspectorCard) unitInspectorCard.style.display = 'none';
    stopFollowingUnit();
  });
}

if (btnFollowUnit) {
  on(btnFollowUnit, 'click', () => {
    if (followSelectedUnit) {
      stopFollowingUnit();
    } else if (livingUnitManager?.selectedUnit) {
      startFollowingUnit(livingUnitManager.selectedUnit);
    }
  });
}

if (btnCardOpenRoster) {
  on(btnCardOpenRoster, 'click', () => {
    openPopulationRoster();
  });
}

function getUnitVillageDisplay(unit) {
  if (!unit || !unit.homeCottage) return 'Wilderness Meadows';
  const tile = unit.homeCottage.node?.tile;
  if (!tile) return 'Oakvale Hamlet';
  const name = tile.villageName || 'Oakvale';
  const role = tile.villageRole ? ` (${tile.villageRole === 'center' ? 'Center' : 'District'})` : '';
  return `${name}${role}`;
}

function showUnitInspector(unit) {
  if (!unit || !unitInspectorCard) return;
  if (livingUnitManager) livingUnitManager.selectedUnit = unit;

  if (unitAvatar) {
    if (unit.isAnimal) {
      unitAvatar.textContent = unit.type === 'horse' ? '🐴' : (unit.type === 'sheep' ? '🐑' : '🐇');
    } else {
      unitAvatar.textContent = unit.isChild ? '🧒' : '🧑';
    }
  }

  if (unitCardName) unitCardName.textContent = unit.name;
  if (unitCardRole) {
    if (unit.isAnimal) {
      unitCardRole.textContent = `Wild ${unit.type.charAt(0).toUpperCase() + unit.type.slice(1)}`;
    } else {
      const roleMap = {
        child: '🧒 Child (Playing)',
        lumberjack: '🪓 Woodcutter',
        water_carrier: '💧 Water Carrier',
        farmer: '🌾 Farmer',
        merchant: '📦 Merchant',
        sentry: '🛡️ Sentry',
        miner: '⛏️ Miner',
        archer: '🏹 Archer',
        fisherman: '🎣 Fisherman',
        courier: '🏇 Courier',
        socializer: '🏡 Villager'
      };
      unitCardRole.textContent = roleMap[unit.role] || unit.role;
    }
  }

  if (unitCardActivity) {
    unitCardActivity.textContent = livingUnitManager ? livingUnitManager.getUnitActivityText(unit) : 'Active in kingdom';
  }

  if (unitCardHome) {
    unitCardHome.textContent = getUnitVillageDisplay(unit);
  }

  if (unitCardAge) {
    unitCardAge.textContent = unit.isChild ? `Child (${Math.round(unit.ageProgress * 100)}% to Adulthood)` : (unit.isAnimal ? 'Fauna' : 'Adult Citizen');
  }

  if (btnFollowUnit) {
    const isFollowingThis = followSelectedUnit && livingUnitManager.selectedUnit === unit;
    btnFollowUnit.textContent = isFollowingThis ? '⏹️ Stop Following' : '🎥 Follow with Camera';
    btnFollowUnit.style.background = isFollowingThis ? '#dc2626' : '';
    btnFollowUnit.style.borderColor = isFollowingThis ? '#f87171' : '';
  }

  unitInspectorCard.style.display = 'block';
}
window.__showUnitInspector = showUnitInspector;
window.__startFollowingUnit = startFollowingUnit;
window.__stopFollowingUnit = stopFollowingUnit;
window.__openPopulationRoster = openPopulationRoster;
window.__closePopulationRoster = closePopulationRoster;

// --- Population Roster & Filter System ---
let currentRosterFilter = 'all';
let currentRosterSearch = '';

function openPopulationRoster() {
  if (!populationRosterModal || !livingUnitManager) return;
  populationRosterModal.style.display = 'flex';
  updateRosterUI();
}

function closePopulationRoster() {
  if (!populationRosterModal) return;
  populationRosterModal.style.display = 'none';
}

if (btnOpenRoster) {
  on(btnOpenRoster, 'click', (e) => {
    e.stopPropagation();
    openPopulationRoster();
  });
}

if (btnCloseRoster) {
  on(btnCloseRoster, 'click', () => {
    closePopulationRoster();
  });
}

if (populationRosterModal) {
  populationRosterModal.addEventListener('click', (e) => {
    if (e.target === populationRosterModal) {
      closePopulationRoster();
    }
  });
}

if (rosterFilterChips) {
  rosterFilterChips.forEach(chip => {
    on(chip, 'click', () => {
      rosterFilterChips.forEach(c => c.classList.toggle('active', c === chip));
      currentRosterFilter = chip.getAttribute('data-filter') || 'all';
      renderRosterCards();
    });
  });
}

if (inputRosterSearch) {
  on(inputRosterSearch, 'input', () => {
    currentRosterSearch = inputRosterSearch.value.trim().toLowerCase();
    renderRosterCards();
  });
}

function updateRosterUI() {
  if (!livingUnitManager) return;
  const allUnits = livingUnitManager.allUnits || [];

  if (rosterStatsSummary) {
    const totalPop = allUnits.length;
    const activeCount = allUnits.filter(u => !u.isResting).length;
    const restingCount = allUnits.filter(u => u.isResting).length;
    rosterStatsSummary.innerHTML = `
      <div class="roster-stat-badge">👥 Total: <strong>${totalPop}</strong></div>
      <div class="roster-stat-badge">🟢 Active On-Screen: <strong>${activeCount}</strong></div>
      <div class="roster-stat-badge">💤 Resting in Cottages: <strong>${restingCount}</strong></div>
    `;
  }

  const counts = {
    all: allUnits.length,
    farmer: 0,
    lumberjack: 0,
    water_carrier: 0,
    child: 0,
    socializer: 0,
    animal: 0
  };
  for (const u of allUnits) {
    if (u.isAnimal) counts.animal++;
    else if (u.isChild) counts.child++;
    else if (counts[u.role] !== undefined) counts[u.role]++;
  }

  for (const [k, v] of Object.entries(counts)) {
    const el = document.getElementById(`count-chip-${k}`);
    if (el) el.textContent = v;
  }

  renderRosterCards();
}

function renderRosterCards() {
  if (!rosterCardsContainer || !livingUnitManager) return;
  const allUnits = livingUnitManager.allUnits || [];

  const filtered = allUnits.filter(u => {
    if (currentRosterFilter !== 'all') {
      if (currentRosterFilter === 'animal' && !u.isAnimal) return false;
      if (currentRosterFilter === 'child' && (!u.isChild || u.isAnimal)) return false;
      if (currentRosterFilter === 'farmer' && u.role !== 'farmer') return false;
      if (currentRosterFilter === 'lumberjack' && u.role !== 'lumberjack') return false;
      if (currentRosterFilter === 'water_carrier' && u.role !== 'water_carrier') return false;
      if (currentRosterFilter === 'socializer' && (u.role !== 'socializer' || u.isChild)) return false;
    }

    if (currentRosterSearch) {
      const name = (u.name || '').toLowerCase();
      const village = getUnitVillageDisplay(u).toLowerCase();
      const task = (livingUnitManager.getUnitActivityText(u) || '').toLowerCase();
      const role = (u.role || '').toLowerCase();
      const match = name.includes(currentRosterSearch) || village.includes(currentRosterSearch) || task.includes(currentRosterSearch) || role.includes(currentRosterSearch);
      if (!match) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    rosterCardsContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: #64748b; font-size: 0.85rem;">
        No citizens found matching "<strong>${currentRosterSearch}</strong>" in this category.
      </div>
    `;
    return;
  }

  const roleColors = {
    farmer: { bg: 'rgba(101, 163, 13, 0.25)', border: '#65a30d', label: '🌾 Farmer' },
    lumberjack: { bg: 'rgba(180, 83, 9, 0.25)', border: '#b45309', label: '🪓 Woodcutter' },
    water_carrier: { bg: 'rgba(2, 132, 199, 0.25)', border: '#0284c7', label: '💧 Water Carrier' },
    merchant: { bg: 'rgba(217, 119, 6, 0.25)', border: '#d97706', label: '📦 Merchant' },
    sentry: { bg: 'rgba(239, 68, 68, 0.25)', border: '#ef4444', label: '🛡️ Sentry' },
    miner: { bg: 'rgba(100, 116, 139, 0.25)', border: '#64748b', label: '⛏️ Miner' },
    archer: { bg: 'rgba(16, 185, 129, 0.25)', border: '#10b981', label: '🏹 Archer' },
    fisherman: { bg: 'rgba(6, 182, 212, 0.25)', border: '#06b6d4', label: '🎣 Fisherman' },
    courier: { bg: 'rgba(234, 179, 8, 0.25)', border: '#eab308', label: '📜 Courier' },
    child: { bg: 'rgba(249, 115, 22, 0.25)', border: '#f97316', label: '🧒 Child' },
    socializer: { bg: 'rgba(139, 92, 246, 0.25)', border: '#8b5cf6', label: '🏡 Villager' },
    animal: { bg: 'rgba(148, 163, 184, 0.25)', border: '#94a3b8', label: '🐾 Wildlife' }
  };

  const isFollowingThisUnit = (u) => followSelectedUnit && livingUnitManager.selectedUnit === u;

  rosterCardsContainer.innerHTML = filtered.map(u => {
    const following = isFollowingThisUnit(u);
    let avatar = '🧑';
    let roleMeta = roleColors[u.role] || roleColors.socializer;

    if (u.isAnimal) {
      avatar = u.type === 'horse' ? '🐴' : (u.type === 'sheep' ? '🐑' : '🐇');
      roleMeta = { bg: 'rgba(148, 163, 184, 0.25)', border: '#94a3b8', label: `Wild ${u.type.charAt(0).toUpperCase() + u.type.slice(1)}` };
    } else if (u.isChild) {
      avatar = '🧒';
      roleMeta = roleColors.child;
    } else if (u.role === 'sentry') {
      avatar = '🛡️';
    } else if (u.role === 'merchant') {
      avatar = '📦';
    } else if (u.role === 'miner') {
      avatar = '⛏️';
    } else if (u.role === 'archer') {
      avatar = '🏹';
    } else if (u.role === 'fisherman') {
      avatar = '🎣';
    } else if (u.role === 'courier') {
      avatar = '🏇';
    } else if (u.role === 'farmer') {
      avatar = '🌾';
    } else if (u.role === 'lumberjack') {
      avatar = '🪓';
    } else if (u.role === 'water_carrier') {
      avatar = '💧';
    }

    const activity = livingUnitManager.getUnitActivityText(u);
    const village = getUnitVillageDisplay(u);

    return `
      <div class="roster-unit-card ${following ? 'is-following' : ''}" data-unit-id="${u.id}">
        <div class="roster-card-header">
          <div class="roster-card-avatar-wrap">
            <div class="roster-card-avatar">${avatar}</div>
            <div style="min-width: 0;">
              <div class="roster-card-name">${u.name}</div>
              <span class="roster-role-pill" style="background: ${roleMeta.bg}; border: 1px solid ${roleMeta.border}; color: #f8fafc;">
                ${roleMeta.label}
              </span>
            </div>
          </div>
          <button type="button" class="btn-roster-follow ${following ? 'following' : ''}" data-follow-id="${u.id}">
            ${following ? '⏹️ Following' : '🎥 Follow'}
          </button>
        </div>
        <div class="roster-card-body">
          <div class="roster-activity-line">
            <span>⚡</span> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${activity}</span>
          </div>
          <div style="color: #64748b; font-size: 0.70rem;">
            📍 ${village}
          </div>
        </div>
        <div class="roster-card-footer">
          <span class="roster-status-pill ${u.isResting ? 'resting' : 'active'}">
            ${u.isResting ? '💤 Resting in Cottage' : '🟢 Active in World'}
          </span>
          <span style="font-size: 0.70rem; color: #64748b;">
            ${u.isChild ? `${Math.round(u.ageProgress * 100)}% to Adult` : (u.isAnimal ? 'Wildlife' : 'Citizen')}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Attach button and card click handlers
  rosterCardsContainer.querySelectorAll('.btn-roster-follow').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = parseInt(btn.getAttribute('data-follow-id'), 10);
      const targetUnit = allUnits.find(x => x.id === uid);
      if (targetUnit) {
        if (isFollowingThisUnit(targetUnit)) {
          stopFollowingUnit();
          renderRosterCards();
        } else {
          startFollowingUnit(targetUnit);
        }
      }
    });
  });

  rosterCardsContainer.querySelectorAll('.roster-unit-card').forEach(card => {
    card.addEventListener('click', () => {
      const uid = parseInt(card.getAttribute('data-unit-id'), 10);
      const targetUnit = allUnits.find(x => x.id === uid);
      if (targetUnit) {
        startFollowingUnit(targetUnit);
      }
    });
  });
}
window.__openPopulationRoster = openPopulationRoster;
window.__closePopulationRoster = closePopulationRoster;
window.__showUnitInspector = showUnitInspector;

// Raycasting to select units on click
container.addEventListener('click', (e) => {
  if (!worldGen.worldGroup.visible || !livingUnitManager) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera({ x: mouseX, y: mouseY }, camera);
  const intersects = raycaster.intersectObjects(worldGen.worldGroup.children, true);

  if (intersects.length > 0) {
    const pt = intersects[0].point;
    let closest = null;
    let minDist = 0.75;
    for (const u of livingUnitManager.activeUnits) {
      const d = Math.hypot(u.x - pt.x, u.z - pt.z);
      if (d < minDist) {
        minDist = d;
        closest = u;
      }
    }
    if (closest) {
      showUnitInspector(closest);
    }
  }
});

on(btnRegenerate, 'click', () => triggerWorldGen());

on(btnNewSeed, 'click', () => {
  if (inputSeed) inputSeed.value = Math.floor(Math.random() * 100000);
  triggerWorldGen();
});

on(btnTopRandomSeed, 'click', () => {
  if (worldGen.isGenerating) return;
  if (inputSeed) inputSeed.value = Math.floor(Math.random() * 100000);
  triggerWorldGen();
});

// Initial populate
populateCategoryTiles();
updateTopSeedButtonVisibility();
updateMapSizeLabel();

// Check URL params for automated visual QA and direct world viewing
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('tab') === 'world' || urlParams.get('mode') === 'world') {
  if (urlParams.get('seed') && inputSeed) {
    inputSeed.value = urlParams.get('seed');
  }
  if (urlParams.get('radius') && sliderRadius) {
    sliderRadius.value = urlParams.get('radius');
    updateMapSizeLabel();
  }
  if (urlParams.get('shape') && selectMapShape) {
    selectMapShape.value = urlParams.get('shape');
    updateMapSizeLabel();
  }
  if (urlParams.get('biome') && selectBiomeMode) {
    selectBiomeMode.value = urlParams.get('biome');
  }
  if (urlParams.get('rivers') && sliderRivers) {
    const reqRivers = parseInt(urlParams.get('rivers'), 10);
    if (reqRivers > parseInt(sliderRivers.max, 10)) {
      sliderRivers.max = String(reqRivers);
    }
    sliderRivers.value = String(reqRivers);
    const v = parseInt(sliderRivers.value, 10);
    if (labelRivers) labelRivers.textContent = v === 0 ? 'None' : (v === 1 ? '1 River' : `${v} Rivers`);
  }
  if (urlParams.get('villages') && sliderVillages) {
    sliderVillages.value = urlParams.get('villages');
    updateVillagesLabel();
  }
  if (urlParams.get('walls') && selectWallStyle) {
    selectWallStyle.value = urlParams.get('walls');
  }
  if (tabWorld) tabWorld.click();
  if (urlParams.get('collapsed') === 'true') {
    window.setPanelCollapsed(true);
  }
}

// Resize handling
window.addEventListener('resize', () => {
  if (camera && renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
});
