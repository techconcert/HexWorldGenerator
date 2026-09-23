# POC_Kaykit — Master Agent Knowledge Base & Reference Guide

Welcome to the **KayKit Hexagonal World Generator & Living Medieval Simulation** master knowledge base. This document provides autonomous AI agents with the foundational context, architectural invariants, system specifications, and testing protocols required to maintain, inspect, and expand this codebase.

> **Current milestone**: Milestone 5 — Rivers & Larger Maps  
> **Branch**: `feature/milestone5-rivers-and-larger-maps`  
> **All 6 QA suites**: ✅ 100% pass (0 defects)

---

## 1. System Overview

`POC_Kaykit` is a browser-based, high-performance 3D procedural world generator, living medieval life simulation, and interactive tile aligner built with **Three.js** and **KayKit Medieval Hexagon** assets.

### Core Capabilities

- **Procedural Diorama World Builder (`worldGenerator.js`)**: Generates stylised hexagonal and rectangular medieval dioramas complete with elevation noise, coastlines (via Wave Function Collapse), multi-river networks (up to 8 rivers) with confluences and waterfalls, bridges, road networks, cohesive coloured faction villages with civic centres, mountain castles, water flora, and scattered small props.
- **Living World Simulation Engine (`livingUnitManager.js`, `livingWorldNavMesh.js`, `livingUnitRenderer.js`)**: Coordinates up to 250 active on-screen units and 500+ total population with overflow citizens resting in cottages. Uses Data-Oriented Technology Stack (DOTS) `Float32Array` columnar buffers and GPU `THREE.InstancedMesh` rendering in ≤ 4 draw calls.
- **24-Hour Day/Night Celestial Cycle (`dayNightCycle.js`)**: Continuous orbital lighting across Dawn, Day, Dusk, and Night with smooth colour/intensity lerping. Includes an interactive top-right circular dial widget showing sun ☀️ and moon 🌙 positions and live time.
- **Evening Life & The 7 Dynamic Roles**: Citizens transition routines based on celestial phase:
  - **Dusk**: Workers stow tools and gather at the **tavern** (drinking ale), attend **church** (prayers/hymns), or socialise at the **village well**.
  - **Night**: Citizens return to cottages to sleep, while **sentries** patrol perimeter walls and gates with burning torches.
  - **Day**: Citizens execute specialised professions: `merchant`, `sentry`, `miner`, `archer`, `fisherman`, `courier`, `socializer`, `lumberjack`, `water_carrier`, `farmer` (with 3-stage crop farming).
- **3D Surface Elevation & Obstacle Collision Avoidance**: Units climb smoothly over the crest of grassy hill mounds ($+0.48$ dome curve), route around steep mountain peaks via outer hex sectors, and traverse forests with 100% permeability.
- **Sub-Hex 6-Sector Roaming & Horse Quadrants**: Units and wildlife roam across the 6 radial sectors and centre within hexes. Horses specifically roam across the 6 outer quadrants (0..5, distance > 0.25).
- **Performance & NFR Telemetry Logger (`perfLogger.js`)**: Rolling 120-frame Float64Array ring-buffer telemetry monitoring real-time FPS (avg, min, 1% low), simulation tick latency (< 5.0 ms budget; currently 0.19–0.36 ms), active unit count, and map scale.
- **Kingdom Population Roster & Camera Tracking**: Interactive modal with live demographics, search, role filter chips, and smooth isometric camera tracking with an animated 3D ground selection ring.
- **Interactive 3D Tile & Edge Aligner (`tileCatalog.js`, `tileRegistry.js`)**: Visualises 3D connector sockets on hexagonal tiles in real time, allowing developers to align, rotate, tag, and export tile edge definitions.

---

## 2. Non-Negotiable Invariants

All agents operating on this codebase must strictly observe these rules:

### 1. NEVER Reset User Tagging
- `tile_registry_config.json` stores user-validated socket tags.
- User tags in `tile_registry_config.json` and `localStorage` are **authoritative** over any hardcoded defaults.
- Refer to `RULES_TILE_TAGGING.md` for the full persistence contract.

### 2. Maintain 100% Pass Rate Across All 7 Automated QA Suites
Any logic or generator change must be verified against all suites before committing:

| Suite | Command | Tests |
|---|---|---|
| Geometry batching & frustum culling | `node test_batching_qa.js` | 24/24 |
| World generation & WFC | `node test_world_qa.js` | 100/100 seeds |
| Living world simulation | `node test_living_world_qa.js` | 14/14 |
| Village clustering & walls | `node test_village_qa.js` | all |
| Terrain elevation & obstacles | `node test_terrain_elevation_qa.js` | 9/9 |
| Day/night & 7 roles | `node test_day_night_qa.js` | 31/31 |
| Sub-hex & faction cohesion | `node test_subhex_factions_qa.js` | 4/4 |

### 3. Performance Budget Guardrails (< 5.0 ms Sim Tick)
- All unit transforms must sync through flat DOTS columnar buffers (`dots.posX`, `dots.posY`, `dots.posZ`, `dots.yaw`, `dots.scale`).
- Units and carried tools must use GPU `THREE.InstancedMesh` (≤ 4 draw calls for all on-screen entities).
- Collision checks use spatial hashing with neighbour duplication limited to perimeter obstacles (`dist > 0.58`).
- Simulation tick latency must remain **< 5.0 ms** per frame at all times.

### 4. Tree Anti-Clipping Invariant
- Diagonal slopes (`tile.slope`) and hill mounds (`hills_A`) are strictly prohibited from placing vertical tree models.
- Trees are placed exclusively on flat plains (`tile.biome === 'plains' && !tile.slope`).

### 5. Village Faction Colour & Naming Cohesion
- Each village cluster generates with a single faction identity (`blue`, `red`, `green`, `yellow`).
- All buildings, sub-buildings, civic structures (taverns, churches, archery ranges), and citizen tunics must strictly share that village's cohesive faction colour.
- Village names are drawn from the 80+ fantasy name library in `worldGenerator.js`.

### 6. Village Slope Flattening
- Village tiles are always set `slope = null` and use `hex_grass.fbx` as their base mesh.
- This prevents buildings and units from clipping through or floating above sloped terrain.

### 7. Always Set FBXLoader Resource Path
When instantiating `FBXLoader`, always configure:
```javascript
loader.setResourcePath('./kaykit_full/Textures/');
```

---

## 3. Architecture Quick Reference

### Animation Loop (hot path)
```
requestAnimationFrame
  → dayNightCycle.update(dt)          [lighting every 3rd frame, UI every 10th]
  → perfLogger.recordFrame(dt)        [O(1) Float64Array ring buffer, every frame]
  → livingUnitManager.setTimePhase()  [only on phase change]
  → livingUnitManager.update(dt)      [all activeUnits + resting wakeup pass]
  → livingUnitRenderer.renderUnits()  [InstancedMesh matrix upload, ≤4 draw calls]
  → controls.update()
  → renderer.render()
```

### Unit State Machine
```
IDLE → WALKING → [
  CHOPPING_WOOD | FETCHING_WATER | HARVESTING_CROP | PLANTING_CROP |
  CULTIVATING_CROP | MINING | FISHING | TRADING | PATROLLING |
  PATROLLING_NIGHT | TAVERN | PRAYING | GATHERING_WELL |
  ARCHERY_PRACTICE | SLEEPING | DELIVERING_* | GRAZING
]
```

### Key Behavioural Invariants
- `u.isResting = true` → filtered from `activeUnits` → invisible, sim-frozen until `restingUntil` expires.
- `routeUnitTo()` path failure → clears `u.tool` + all flags → IDLE (prevents stale activity text).
- `strollAroundVillage()` — 25% chance home-rest (daytime despawn).
- `getUnitActivityText()` — reads `u.nextStateOnArrival` when `state === 'WALKING'`.
- `patrolSentry()` — id-seeded spread: `(u.id + hop*3 + floor(simTime*0.1)) % neighbors.length`.

### Shadow Scaling Policy
| Map size | Shadow map |
|---|---|
| < 250 hexes | 1024×1024 |
| 250–500 hexes | 512×512 |
| > 500 hexes | **Disabled** |

### Village Cluster Sizing
| Map | Capital | Secondary | Hamlet |
|---|---|---|---|
| > 500 hexes | 5–7 tiles | 4–6 tiles | 3–4 tiles |
| ≤ 500 hexes | 2–4 tiles | 2–4 tiles | 2–4 tiles |

### Water Flora Density
- Shoreline-adjacent: 55%; open-water interior: 22%.
- 1–3 items per qualifying tile; placed at random sub-hex sector, radius 0.18–0.40.

### Small Prop Scatter
- Props: `tree_single_A/B`, `rock_single_A–E`, `barrel`, `crate_A_big`, `crate_open`, `tent`, `wheelbarrow`.
- Scatter radius 0.28–0.35 (random sector 0–5 via `getHexQuadrantLocal`).

### Performance Benchmarks
| Metric | Target | Current |
|---|---|---|
| Sim tick latency | < 5.0 ms | 0.19–0.36 ms |
| Active units | ≤ 250 | 200–244 (with home-rest) |
| Draw calls | ≤ 4 | 4 |

---

## 4. Documentation Index

| Document | Purpose & Key Topics |
| :--- | :--- |
| **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** | Subsystem architecture, Three.js pipeline, animation loop, Day/Night engine, Living Unit Manager, DOTS buffers, shadow scaling, NavMesh spatial indexing. |
| **[`docs/AUTOTILING_SPEC.md`](docs/AUTOTILING_SPEC.md)** | Pointy-topped hex math, axial $(q, r)$ coordinates, 6-edge indexing (0 to 5), neighbour reciprocity `(i + 3) % 6`, WFC rules, river confluences, bridge placement. |
| **[`docs/BIOMES_AND_TEXTURES.md`](docs/BIOMES_AND_TEXTURES.md)** | Texture atlas architecture, UV palette sharing, dual seasonal/environmental biomes (Spring, Summer, Fall=Desert, Winter=Peaks), multi-biome diorama implementation, faction colour palettes. |
| **[`docs/ASSET_CATALOG.md`](docs/ASSET_CATALOG.md)** | Complete inventory of all 404 FBX models in `kaykit_full/Models/` (base, roads, rivers, coast, 4 factions of buildings, civic structures, props, units, carried tools). |
| **[`docs/DEVELOPMENT_AND_QA.md`](docs/DEVELOPMENT_AND_QA.md)** | All 6 QA test suites, automated test execution commands, headless Chrome CDP visual screenshot runner (`capture_qa_screenshot.js`), local development server, git workflow. |

---

## 5. Key Files Map

```
POC_Kaykit/
├── AGENT_KNOWLEDGE_BASE.md      # ← This file: master reference index
├── SESSION_HANDOFF.md           # Session-to-session handoff context
├── RULES_TILE_TAGGING.md        # Tagging persistence rules
├── GEMINI.md                    # Core project guidelines & mandatory invariants
├── index.html                   # Application HTML UI (sidebar, HUD, dial, roster modal)
├── styles.css                   # Glassmorphic UI stylesheet & animations
├── main.js                      # Central application entry point & render loop
├── worldGenerator.js            # Procedural world generator & diorama builder (87 KB)
├── livingWorldNavMesh.js        # NavMesh graph, hill dome elevation, collision solver & POIs
├── livingUnitManager.js         # Life simulation, day/night schedules, 7 roles & DOTS engine
├── livingUnitRenderer.js        # Instanced character & animal GPU renderer
├── dayNightCycle.js             # 24-hour celestial illumination & time-of-day engine
├── perfLogger.js                # Performance, rolling FPS & NFR simulation latency telemetry
├── hexMath.js                   # Hexagonal axial math, sub-hex sector & geometric helpers
├── roadAutotile.js              # Autotiling & WFC candidate solver
├── tileRegistry.js              # Tile connector definitions & persistence
├── tileCatalog.js               # Interactive 3D Tile Aligner UI
├── assetManifest.js             # 404-model asset manifest & texture paths
├── server.js                    # Anti-cache Node.js development server (primary)
├── server.py                    # Anti-cache Python development server (fallback)
├── tile_registry_config.json    # Authoritative edge connector tagging configuration
├── capture_qa_screenshot.js     # Native Node 24 WebSocket + Chrome CDP screenshot utility
├── test_world_qa.js             # 100-seed world generation QA (coast, river, bridge, road)
├── test_living_world_qa.js      # 250-unit simulation QA (water exclusion, crop, horse)
├── test_village_qa.js           # Village cluster sizing & wall solver QA
├── test_subhex_factions_qa.js   # Sub-hex roaming, faction colours & city names QA
├── test_terrain_elevation_qa.js # Hill dome elevation & obstacle avoidance QA
├── test_day_night_qa.js         # Day/night cycle, evening routines & 7 roles QA
├── docs/                        # Detailed architectural specifications
└── kaykit_full/                 # Complete 404 FBX models + 4 texture atlases
```
