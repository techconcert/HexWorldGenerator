# Project Rules & Invariants: KayKit Hex World Generator & Living Medieval Simulation

This document defines the non-negotiable engineering rules, system invariants, and architectural guardrails for `POC_Kaykit`.

---

## 1. MANDATORY INVARIANT: NEVER RESET OR REVERT SAVED TILE TAGGING

### Context & Rationale
The Tile & Edge Aligner allows the user to inspect, configure, and align 6-bit edge connectors (`road`, `water`, `sand`, `none`) for every 3D model in the asset pack.
The user's custom tags represent ground truth that must NEVER be overwritten, reset to defaults, or lost across sessions, git commits, code updates, or browser reloads.

### Strict Constraints
1. **User Tags are Authoritative**:
   - Tags in `tile_registry_config.json` and `localStorage` take precedence over hardcoded defaults.
   - Merging logic must treat saved tags as authoritative for all 6 edges (`0..5`).
   - Never perform partial spreads like `{ ...defaults[tileKey].edges, ...savedEdges }` where removed edges can reappear.
2. **Dual-Layer Persistence**:
   - **Layer 1 (Disk)**: All modifications persist to `tile_registry_config.json` via HTTP `POST /api/save_tags`.
   - **Layer 2 (Browser)**: Cached to `localStorage` under `kaykit_tile_edge_registry_user_tags`.
   - On startup, the application loads `tile_registry_config.json` directly from the server.
3. **Never Hardcode Conflicting Defaults**:
   - Defaults in `DEFAULT_ROAD_TILES` and `ASSET_MANIFEST` must match the physical 3D mesh geometry ground truth:
     - `road_A`: [1, 4]
     - `road_B`: [0, 4]
     - `road_C`: [4, 5]
     - `road_D`: [0, 2, 4]
     - `road_E`: [0, 1, 4]
     - `road_F`: [1, 2, 4]
     - `road_G`: [3, 4, 5]
     - `road_H`: [1, 3, 4, 5]
     - `road_I`: [0, 2, 3, 5]
     - `road_J`: [1, 2, 3, 4]
     - `road_K`: [0, 2, 3, 4, 5]
     - `road_L`: [0, 1, 2, 3, 4, 5]
     - `road_M`: [4]
     - `river_crossing_A`: water=[1, 4], road=[2, 5]
     - `river_crossing_B`: water=[1, 4], road=[0, 3]

---

## 2. MANDATORY INVARIANT: 60 FPS & < 5.0ms SIMULATION TICK BUDGET

1. **Data-Oriented Technology Stack (DOTS)**:
   - High-frequency simulation state (position, heading, speed, scale, state flags) must be synchronized via contiguous `Float32Array` columnar buffers in `LivingUnitManager.dots`.
2. **GPU Instanced Rendering**:
   - All active units (up to 250 on-screen), carried tools, and animals must be rendered via `THREE.InstancedMesh` in `LivingUnitRenderer.js` to bound draw calls to $\le 4$ per frame.
3. **Simulation Latency Guard**:
   - `LivingUnitManager.update(dt)` must complete in $< 5.0$ms per tick on 50×50 maps with 250 units (current benchmark: $0.9$–$1.7$ms).
   - Obstacle spatial hashing limits neighbor hex duplication strictly to perimeter obstacles (`distFromCenter > 0.58`).
4. **Performance Telemetry**:
   - Monitored continuously by `PerformanceLogger` (`perfLogger.js`) with rolling average FPS, minimum FPS, and simulation tick latency.

---

## 3. MANDATORY INVARIANT: 100% PASS RATE ACROSS ALL AUTOMATED QA SUITES

Every pull request and major milestone must pass all 5 test suites with 0 defects:
1. `node test_world_qa.js`: 100/100 seeds passing coast WFC, river confluences, road networks, and bridge synthesis.
2. `node test_living_world_qa.js`: 250 active unit cap, 0 units entering water, child growth, crop cultivation, horse quadrants.
3. `node test_subhex_factions_qa.js`: Sub-hex 6-sector math, 100% cohesive faction colors per village, 80+ fantasy city names.
4. `node test_terrain_elevation_qa.js`: Hill dome crest elevation (+0.48), mountain peak obstacle avoidance, 100% forest permeability.
5. `node test_day_night_qa.js`: 4 celestial phases, evening tavern routines, night cottage sleep, sentry torches, 7 roles.

---

## 4. MANDATORY INVARIANT: TERRAIN CONFORMANCE & ANTI-CLIPPING

1. **Tree Placement**:
   - Trees are strictly prohibited on sloped hexes (`tile.slope`) and hill mounds (`hills_A`). Trees are placed exclusively on flat plains (`tile.biome === 'plains' && !tile.slope`).
2. **Hill Mound Climbing**:
   - Hill mounds compute surface elevation dynamically with radial dome height interpolation: $y_{\text{surface}} = \text{tile.worldY} + 0.48 \cdot \max(0, 1.0 - (r/R)^2)$. Units must walk over the crest of hills rather than passing underneath.
3. **Mountain Peak Avoidance**:
   - Wild mountain peaks register central collision obstacles ($r = 0.38$), forcing units to path around steep peaks via outer sectors. Mountain tiles with paved roads keep the central corridor clear.

---

## 5. MANDATORY INVARIANT: FACTION COLOR & NAMING INTEGRITY

1. **Faction Visual Cohesion**:
   - Every multi-hex village belongs to a single faction (`blue`, `red`, `green`, `yellow`).
   - All cottages, civic buildings (taverns, churches, archery ranges, blacksmiths, markets), sub-buildings, and citizen tunics must strictly share that village's cohesive faction color.
2. **City Naming**:
   - Village names are selected from the 80+ fantasy settlement name library in `worldGenerator.js`.
