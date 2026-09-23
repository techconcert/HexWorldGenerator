# Project Rules: KayKit Hex World Generator & Dynamic Autotiler

## MANDATORY INVARIANT: NEVER RESET OR REVERT SAVED TILE TAGGING

### 1. Context & Rationale
The Tile & Edge Aligner allows the user to inspect, configure, and align 6-bit edge connectors (`road`, `water`, `sand`, `none`) for every 3D model in the asset pack.
The user's custom tags represent ground truth that must NEVER be overwritten, reset to defaults, or lost across sessions, git commits, code updates, or browser reloads.

### 2. Strict Rules & Constraints
1. **Never Revert User Tags**:
   - User tags in `tile_registry_config.json` and `localStorage` are **authoritative** over any hardcoded defaults.
   - Merging logic must treat saved tags as authoritative for all 6 edges (`0..5`).
   - Never perform partial object spreads like `{ ...defaults[tileKey].edges, ...savedEdges }` where removed edges can reappear from defaults.
2. **Dual-Layer Persistence**:
   - **Layer 1 (Disk)**: All tag modifications must be persisted to `/Users/mac/antigravity/POC_Kaykit/tile_registry_config.json` via HTTP `POST /api/save_tags` on every save.
   - **Layer 2 (Browser)**: Tag modifications are simultaneously cached to `localStorage` under `kaykit_tile_edge_registry_user_tags`.
   - On startup, the application loads `tile_registry_config.json` directly from the server, guaranteeing that tags persist across different browsers, incognito mode, port changes, and machine reboots.
3. **Never Hardcode Conflicting Defaults**:
   - Hardcoded defaults in `DEFAULT_ROAD_TILES` and `ASSET_MANIFEST` must match the actual physical 3D mesh geometry ground truth:
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
4. **Automated QA Regression Gate**:
   - Every build and commit must be validated against all 5 automated QA suites:
     - `test_world_qa.js`: 100/100 seeds with 0 defects across coast WFC, river confluences, road networks, and bridge synthesis.
     - `test_living_world_qa.js`: 250 active unit cap, 0 units entering water, child growth, crop cultivation, horse quadrants.
     - `test_subhex_factions_qa.js`: Sub-hex 6-sector math, 100% cohesive faction colors per village, 80+ fantasy city names.
     - `test_terrain_elevation_qa.js`: Hill dome crest elevation (+0.48), mountain peak obstacle avoidance, 100% forest permeability.
     - `test_day_night_qa.js`: 4 celestial phases, evening tavern routines, night cottage sleep, sentry torches, 7 roles.

