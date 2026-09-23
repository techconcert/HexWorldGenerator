# Development & QA Standards

This document establishes the testing protocols, zero-regression invariants, automated test suites, and development workflows for `POC_Kaykit`.

---

## 1. Non-Negotiable Invariants

1. **User Tile Tagging Preservation**:
   - `tile_registry_config.json` contains user-verified edge socket alignments.
   - Scripts and autotilers MUST NEVER overwrite, reset, or discard custom tagging.
   - Any modifications to tile tagging must append or update explicitly without blowing away existing tags.
   - Refer to `RULES_TILE_TAGGING.md`.

2. **0.0% Defect Invariant Across All QA Suites**:
   - All automated test suites must achieve **100% pass rate with 0 defects**.
   - Strict failure criteria:
     - ❌ `sand` edge touching `water` neighbour (coastline WFC violation).
     - ❌ `sand` edge touching `void` (outer diorama perimeter).
     - ❌ Unconnected road dead-ends or road edges facing open grass/water.
     - ❌ River edge terminating into grass (confluences must be river-to-river).
     - ❌ Misaligned bridges or bridges placed over dry land.
     - ❌ Units pathing into water or through mountain peaks.
     - ❌ Citizens walking beneath hill mounds instead of climbing the crest.
     - ❌ Mixed faction colours in a single village.
     - ❌ Simulation tick latency exceeding 5.0 ms.
     - ❌ Trees placed on sloped or hill-mound hexes.
     - ❌ Buildings or units clipping through sloped village tiles.

3. **Zero-Dependency Core Runtime**:
   - The runtime relies on native Three.js ES modules, standard browser APIs, and native Node.js v24+.
   - No bundling step (Webpack/Vite) required; modules load directly in the browser.

---

## 2. The 7 Automated QA Test Suites

All suites run headlessly in Node.js without a browser window or display server.

```bash
# Run all 7 suites via npm:
npm run test:all

# Or run sequentially with node:
node tests/test_batching_qa.js && \
node tests/test_world_qa.js && \
node tests/test_living_world_qa.js && \
node tests/test_village_qa.js && \
node tests/test_terrain_elevation_qa.js && \
node tests/test_day_night_qa.js && \
node tests/test_subhex_factions_qa.js
```

---

### Suite 1 — Procedural World Generation (`test_world_qa.js`)

Tests 100 randomly seeded rectangular and hexagonal dioramas for topographical, coastline, river, and road network invariants.

```bash
node tests/test_world_qa.js
```

**Coverage**:
- Wave Function Collapse coastline tile selection (`hex_coast_A`..`E`).
- River trajectories, confluences (`hex_river_D`, `hex_river_I`), and estuary placement (`hex_river_J`).
- Road connectivity graph, bridge alignment, and dead-end elimination.

**Pass threshold**: 100/100 seeds with 0 defects (0.0% defect rate).

---

### Suite 2 — Living World Simulation (`test_living_world_qa.js`)

Validates citizen lifecycle, pool limits, and behavioural logic.

```bash
node tests/test_living_world_qa.js
```

**Coverage**:
- 250 active on-screen unit cap with cottage resting pool overflow.
- Zero units entering water hexes under any state.
- 3-stage crop cultivation (sowing, watering, harvesting) and granary delivery.
- Child ageing and growth transitions.
- Horse quadrant boundary enforcement (quadrants 0..5, $r > 0.25$).

**Pass threshold**: 14/14 tests passing.

---

### Suite 3 — Village Cluster QA (`test_village_qa.js`)

Validates village cluster sizing rules and perimeter wall solver correctness.

```bash
node tests/test_village_qa.js
```

**Coverage**:
- Capital / secondary town / hamlet sizing on large maps (>500 hexes) and standard maps (≤500 hexes).
- Wall and gate placement around village perimeters.
- Village tiles being flattened (no `slope` on village hexes).

**Pass threshold**: All tests passing.

---

### Suite 4 — Terrain Surface Elevation & Obstacle Collision (`test_terrain_elevation_qa.js`)

Validates 3D heightfield traversal and obstacle bounding cylinders.

```bash
node tests/test_terrain_elevation_qa.js
```

**Coverage**:
- Parabolic dome crest elevation on hill mounds ($y_{\text{surface}} = \text{tile.worldY} + 0.48$).
- Mountain peak central obstacle avoidance ($r = 0.38$).
- Mountain road corridor preservation (clear central transit).
- 100% forest grove permeability (zero tree collision blocking).

**Pass threshold**: 9/9 tests passing.

---

### Suite 5 — Day/Night Celestial & 7 Dynamic Roles (`test_day_night_qa.js`)

Validates the 24-hour astronomical cycle and diurnal citizen behaviours.

```bash
node tests/test_day_night_qa.js
```

**Coverage**:
- Continuous 24-hour time progression and phase transitions (Dawn, Day, Dusk, Night).
- Dusk routines: tool stowing, gathering at taverns (drinking ale), church prayers, well socialisation.
- Night routines: cottage sleeping, sentry gate patrols with burning torches.
- Execution of all 7 dynamic roles: `merchant`, `sentry`, `miner`, `archer`, `fisherman`, `courier`, `socializer`.
- PerformanceLogger telemetry tracking (120-frame rolling window, simulation latency < 5.0 ms).

**Pass threshold**: 31/31 tests passing.

---

### Suite 6 — Sub-Hex Roaming & Faction Cohesion (`test_subhex_factions_qa.js`)

Verifies sub-hex coordinate math and village faction consistency.

```bash
node tests/test_subhex_factions_qa.js
```

**Coverage**:
- Sub-hex 6-sector offset calculations and radial bounds.
- 100% faction colour consistency per village (`blue`, `red`, `green`, `yellow`) across all structures and villagers.
- 80+ fantasy settlement name generation diversity.

**Pass threshold**: 4/4 tests passing.

---

### Suite 7 — Geometry Batching & Frustum Culling (`test_batching_qa.js`)

Validates spatial chunked geometry merging, draw call reduction, and Three.js view frustum culling.

```bash
node tests/test_batching_qa.js
```

**Coverage**:
- Attribute sanitization (stripping non-standard attributes, keeping `position`, `normal`, `uv`).
- De-indexing of meshes so all batch inputs are non-indexed triangles.
- Spatial chunk partitioning by `(chunkX, chunkZ)` and bucketing by `(chunkKey, biomeTheme, isCastShadow)`.
- Bounding box and bounding sphere computation per merged geometry.
- Three.js camera view frustum culling: verifying distant chunks outside the camera frustum are culled.
- Pathfinding & terrain height invariance (`LivingWorldNavMesh`).
- Raycaster intersection against batched geometry triangles.
- Draw call reduction scaling from ~800–1200 down to ≤ 40 (>94% reduction).

**Pass threshold**: 24/24 tests passing.

---

## 3. Headless Chrome Visual Verification (`scripts/capture_qa_screenshot.js`)

High-resolution WebGL screenshots are captured headlessly using Google Chrome's DevTools Protocol (CDP) over native WebSockets in Node 24:

```bash
# Launch Chrome and capture daytime scene:
node scripts/capture_qa_screenshot.js --time=12:30 --output=world_day.png

# Capture dusk tavern scene:
node scripts/capture_qa_screenshot.js --time=19:00 --output=world_dusk.png

# Capture midnight sentry watch:
node scripts/capture_qa_screenshot.js --time=23:00 --output=world_night.png
```

### CDP Runner Architecture
- Spawns Google Chrome with `--headless=new`, `--enable-webgl`, and `--use-gl=angle`.
- Connects directly to the DevTools HTTP endpoint `/json/version` and opens a native WebSocket to `/devtools/page/{targetId}`.
- Navigates to `http://localhost:8080/`, sets viewport to $1600 \times 1000$, waits for assets and simulation warm-up, then captures a full PNG buffer via `Page.captureScreenshot`.

> **Note**: Headless Chrome caps at ~10 FPS due to software-rendered WebGL — this is expected and does **not** reflect real GPU performance. Use the in-app FPS counter for meaningful readings.

---

## 4. Local Development Server

```bash
node server.js
```

- Serves on `http://localhost:8080`.
- Sends `Cache-Control: no-cache, no-store, must-revalidate` headers to prevent stale 3D models or cached JS modules during development.

A Python fallback server also exists:
```bash
python3 server.py 8080
```

---

## 5. Git Workflow

**Current branch**: `feature/milestone5-rivers-and-larger-maps`

After verifying all 6 QA suites pass, commit with a descriptive message:

```bash
git add -A
git commit -m "feat: <summary of changes>"
```

Update `SESSION_HANDOFF.md` before ending each session so the next agent can orient immediately.
