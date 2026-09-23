# POC_Kaykit — Session Handoff
> Generated: 2026-09-23 | Branch: `feature/milestone5-rivers-and-larger-maps`

This document gives the next agent full context to continue immediately without re-reading history.

---

## Quick Start

```bash
cd /Users/mac/Development/Projects/POC_Kaykit
node server.js          # Dev server at http://localhost:8080/
node test_batching_qa.js && node test_world_qa.js && node test_living_world_qa.js && node test_village_qa.js && node test_terrain_elevation_qa.js && node test_day_night_qa.js && node test_subhex_factions_qa.js
```

All 7 test suites currently pass at 100% (0 defects).

---

## What Was Built This Session (Milestone 5 & Optimization)

### ✅ Completed & Verified

| Feature | Files Changed | Status |
|---|---|---|
| Static Geometry Batching (~94% draw call reduction) | `worldGenerator.js`, `main.js`, `test_batching_qa.js` | ✅ Done |
| Camera Frustum Culling Verification | `capture_qa_screenshot.js`, `worldGenerator.js` | ✅ Done |
| Larger villages/towns on maps >500 hexes | `worldGenerator.js` | ✅ Done |
| Remove "Living World Active" label + green dot | `index.html`, `styles.css` | ✅ Done |
| Performance: shadows off on large maps, ring buffers, frame throttling | `main.js`, `perfLogger.js`, `dayNightCycle.js`, `livingUnitRenderer.js`, `livingUnitManager.js` | ✅ Done |
| FPS counter was reading 6× too low (dt*6 bug) | `main.js` | ✅ Fixed |
| Water lilies & water plants scattered in lakes (1–3 per tile, sub-hex offsets) | `worldGenerator.js` | ✅ Done |
| Small props (rock_single, tree_single) scattered within hex at radius 0.35 vs dead center | `worldGenerator.js` | ✅ Done |
| Unit activity/visual disconnect — stale tool cleared on path fail and stroll fallback | `livingUnitManager.js` | ✅ Done |
| Activity text now driven by `nextStateOnArrival` when WALKING — shows where going | `livingUnitManager.js` | ✅ Done |
| Activity card updates every frame (was throttled 30 frames — ~1s stale lag) | `main.js` | ✅ Done |
| Sentry clustering fixed — id-seeded patrol direction + 1–2 hop walks | `livingUnitManager.js` | ✅ Done |
| Daytime home-rest despawn (25% chance on stroll → walks home → `isResting=true` for 8–15s) | `livingUnitManager.js` | ✅ Done |
| Resting wakeup pass in `update()` (checks `restingUntil` timer every 4th frame) | `livingUnitManager.js` | ✅ Done |
| Village tiles that were sloped now flatten to `hex_grass.fbx` — buildings/units placed correctly | `worldGenerator.js` | ✅ Done |

---

## Architecture — Key Files

```
POC_Kaykit/
├── main.js                    # Three.js setup, animation loop, camera, UI wiring
├── worldGenerator.js          # WFC coast, rivers, villages, decorations, 3D scene assembly
├── hexMath.js                 # Hex coordinate math, getHexQuadrantLocal, getHexSubAreaWorld
├── assetManifest.js           # 404 FBX paths + texture atlases
├── dayNightCycle.js           # 14-keyframe celestial spline, updateLighting (every 3rd frame), updateUI (every 10th)
├── livingUnitManager.js       # Unit state machine, task scheduling, pathing, day/night roles
├── livingUnitRenderer.js      # InstancedMesh renderer (body/head/tool/animal), 4 draw calls
├── livingWorldNavMesh.js      # A* pathfinding, terrain height sampling, POI registry
├── perfLogger.js              # Float64Array ring buffer FPS/sim telemetry
├── tileRegistry.js            # Interactive tile edge aligner
├── roadAutotile.js            # Road autotiling resolution
├── test_batching_qa.js        # 24 geometry batching & spatial chunking tests
├── test_world_qa.js           # 100-seed WFC/coast/river invariant tests
├── test_living_world_qa.js    # 14 living world simulation tests
├── test_village_qa.js         # Village cluster sizing + wall solver
├── test_terrain_elevation_qa.js # Hill/mountain/forest terrain tests
├── test_day_night_qa.js       # 31 day/night + roles + perf logger tests
└── test_subhex_factions_qa.js # Sub-hex math + faction color cohesion
```

### Animation Loop (hot path — `main.js:116–202`)
```
requestAnimationFrame
  → dayNightCycle.update(dt)         [updateLighting every 3rd frame, updateUI every 10th]
  → perfLogger.recordFrame(dt)       [every frame, O(1) ring buffer]
  → livingUnitManager.setTimePhase() [only on phase change]
  → livingUnitManager.update(dt)     [all activeUnits + resting wakeup pass]
  → livingUnitRenderer.renderUnits() [InstancedMesh matrix upload]
  → controls.update()
  → renderer.render()
```

---

## Unit State Machine

### States
`IDLE` → `WALKING` → `[CHOPPING_WOOD | FETCHING_WATER | HARVESTING_CROP | PLANTING_CROP | CULTIVATING_CROP | MINING | FISHING | TRADING | PATROLLING | PATROLLING_NIGHT | TAVERN | PRAYING | GATHERING_WELL | ARCHERY_PRACTICE | SLEEPING | DELIVERING_* | GRAZING]`

### Key Invariants
- `u.isResting = true` → unit filtered from `activeUnits` → invisible, sim-frozen until `restingUntil` expires
- `u.restingUntil` (simTimeSec) → wakeup pass in `update()` revives unit, resets to IDLE
- `getUnitActivityText()` — when `state === 'WALKING'`, reads `u.nextStateOnArrival` for accurate "heading to X" text
- `strollAroundVillage()` — clears `u.tool` + all work flags before routing; 25% chance to home-rest
- `routeUnitTo()` path failure — clears tool + all flags, sets IDLE (prevents stale "heading to forest" on standing unit)
- `patrolSentry()` — uses `(u.id + hop*3 + floor(simTime*0.1)) % neighbors.length` for spread; 1–2 hops per call

---

## World Generation — Key Data Points

### Village Cluster Sizing
- **Large maps (>500 hexes)**: capital 5–7 hexes, secondary town 4–6, hamlets 3–4
- **Standard maps (≤500 hexes)**: 2–4 hexes
- Village tiles always have `slope = null` (flattened to `hex_grass.fbx`)

### Water Flora (lakes)
- `tile.waterLilies[]` array — 1–3 items per qualifying water tile
- Shoreline-adjacent: 55% density; open-water interior: 22%
- Each item placed at random sub-hex sector, radius 0.18–0.40

### Small Prop Scatter
- `SMALL_PROP_BASENAMES`: `tree_single_A/B`, `rock_single_A–E`, `barrel`, `crate_A_big`, `crate_open`, `tent`, `wheelbarrow`
- Scatter radius: 0.28–0.35 (random sector 0–5 via `getHexQuadrantLocal`)
- Large props (mountains, hills, grove clusters) remain centered

### Shadow Scaling
- Maps >500 hexes: shadows **disabled** (`renderer.shadowMap.enabled = false`)
- Maps 250–500 hexes: shadow map 512×512
- Maps <250 hexes: shadow map 1024×1024

---

## Performance State

| Metric | Current |
|---|---|
| Sim tick latency | 0.19–0.36ms (budget: <5ms) |
| Target FPS | 30 FPS (large maps), 60 FPS (small) |
| Active units | ≤250 (200–244 typical with home-rest despawn) |
| Shadow pass | Disabled on >500 hex maps |
| Day/night lighting | Every 3rd frame |
| Day/night UI | Every 10th frame |
| PerfLogger | O(1) Float64Array ring buffers |

### Known Limitation
The `run_browser_perf_benchmark.js` tool uses headless Chrome which caps at ~10 FPS due to software-rendered WebGL. This is **not** a reflection of real GPU performance — the readings are meaningless for FPS measurement. Use the in-app FPS counter instead.

---

## Open Issues / Backlog

None currently. Geometry batching and frustum culling verification are fully implemented and verified across all QA suites. Potential future explorations:

1. **LOD (Level of Detail)**: Secondary decimation for distant background tiles on extreme map sizes (>2,500 hexes).
2. **Audio system**: Positional medieval atmospheric audio (river flowing, bird chirping, tavern chatter, blacksmith hammering).
3. **Advanced unit tasks**: Bridge repair / construction jobs, seasonal harvest festivals.

---

## Git State

```
Branch: feature/milestone5-rivers-and-larger-maps
All 7 test suites passing at 100% (0 defects).
Docs updated: README.md, AGENT_KNOWLEDGE_BASE.md, SESSION_HANDOFF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_AND_QA.md, docs/BIOMES_AND_TEXTURES.md
```

---

## How to Continue

Open the **POC_Kaykit** project in Antigravity (click it in the sidebar), then paste this prompt to orient the new session:

> "Read SESSION_HANDOFF.md in the project root, then read AGENT_KNOWLEDGE_BASE.md. All 7 QA test suites pass at 100%. Continue from where the previous session left off."

