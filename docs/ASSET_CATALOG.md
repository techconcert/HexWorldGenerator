# KayKit Medieval Hexagon Asset Catalog

Complete inventory and technical specifications for the **404 FBX 3D models** located in `kaykit_full/Models/`.

---

## 1. Technical Model Specifications
- **Format**: Autodesk FBX (ASCII / Binary FBX 2014/2016).
- **Coordinate System**: Y-Up, Right-Handed (native Three.js coordinates).
- **Scale**: 1 Unity Unit = 1.0 Three.js World Unit = 1.0 Meter.
- **Base Hexagon Footprint**:
  - Width (flat-to-flat): $\sqrt{3} \approx 1.732$
  - Point-to-point diameter: $2.0$
  - Base Height: $1.0$ (standard base elevation unit)
- **Shared UV Texture Atlas**: All 404 models map their vertex UVs to a single 1024x1024 texture atlas (`kaykit_full/Textures/hexagons_medieval.png`), allowing instant palette swapping between Spring, Summer, Fall/Desert, and Winter/Peaks.

---

## 2. Catalog Breakdown by Category

### A. Base Terrain Tiles (`Models/tiles/base/`)
Foundational hexagonal terrain slabs:
- `hex_grass.fbx`: Flat pristine grass hex slab.
- `hex_water.fbx`: Submerged open water hex slab.
- `hex_grass_bottom.fbx`: Underside bevel/cliff foundation.
- `hex_grass_sloped_high.fbx` / `hex_grass_sloped_low.fbx`: Sloped transition slabs.
- `hex_transition.fbx`: Specialized two-material transition tile splitting two bordering biomes.

### B. Road Network Tiles (`Models/tiles/roads/`)
Hexagons with embedded stone-paved medieval roads:
- `hex_road_A.fbx`: Straight road (opposite edges [1, 4]).
- `hex_road_B.fbx`: Gentle curve ($120^\circ$ bend [0, 4]).
- `hex_road_C.fbx`: Sharp curve ($60^\circ$ bend [4, 5]).
- `hex_road_D.fbx`: Symmetric Y-junction ([0, 2, 4]).
- `hex_road_E.fbx`: T-junction ([0, 1, 4]).
- `hex_road_F.fbx`: 3-way branch ([1, 2, 4]).
- `hex_road_G.fbx`: 3-way branch alt ([3, 4, 5]).
- `hex_road_H.fbx`: 4-way asymmetric crossing ([1, 3, 4, 5]).
- `hex_road_I.fbx`: 4-way X-crossing ([0, 2, 3, 5]).
- `hex_road_J.fbx`: 4-way hub ([1, 2, 3, 4]).
- `hex_road_K.fbx`: 5-way hub ([0, 2, 3, 4, 5]).
- `hex_road_L.fbx`: 6-way roundabout ([0, 1, 2, 3, 4, 5]).
- `hex_road_M.fbx`: Dead-end road terminal ([4]).

### C. River & Bridge Tiles (`Models/tiles/rivers/`)
Water channels carved into the hexagonal landmass:
- `hex_river_A.fbx`: Spring origin / single-edge river source.
- `hex_river_B.fbx`: Straight river across opposite edges.
- `hex_river_C.fbx`: Sharp $60^\circ$ river curve.
- `hex_river_D.fbx`: Wide $120^\circ$ river bend.
- `hex_river_E.fbx` / `hex_river_H.fbx` / `hex_river_I.fbx`: River confluences and tributary forks.
- `hex_river_J.fbx`: Estuary / river mouth entering open ocean.
- `hex_river_K.fbx` / `hex_river_L.fbx`: Multi-branch delta hubs.
- `hex_river_crossing_A.fbx` / `B.fbx`: Integrated stone & timber road bridges over rivers.

### D. Coast & Beach Tiles (`Models/tiles/coast/`)
Wave Function Collapse coastline transition tiles:
- `hex_coast_A.fbx`: 1-edge coast (5 grass edges, 1 shallow beach edge).
- `hex_coast_B.fbx`: 2-edge adjacent coast ($60^\circ$ bay/cove).
- `hex_coast_C.fbx`: 2-edge opposite coast (straight shoreline).
- `hex_coast_D.fbx`: 3-edge peninsula / cape.
- `hex_coast_E.fbx`: 4-edge narrow spit / islet.

### E. Medieval Architecture & Buildings (`Models/buildings/`)
Available across four unified faction colorways (**Blue**, **Red**, **Yellow**, **Green**):
- **Civic & Public Structures**:
  - `building_tavern_{color}.fbx`: Social gathering hub where workers drink ale at dusk.
  - `building_church_{color}.fbx`: Cathedral/chapel for evening prayers and hymns.
  - `building_market_{color}.fbx`: Village market stalls where merchants trade.
  - `building_blacksmith_{color}.fbx`: Smithy where miners and blacksmiths forge tools.
  - `building_stables_{color}.fbx`: Horse stables and paddocks.
  - `building_well_{color}.fbx`: Central village well where water carriers and socializers meet.
  - `building_townhall_{color}.fbx` / `building_workshop_{color}.fbx`: Administrative and craft halls.
- **Fortifications & Military**:
  - `building_castle_{color}.fbx`: Multi-turreted royal fortress keep.
  - `building_barracks_{color}.fbx`: Military training grounds.
  - `building_tower_A_{color}.fbx` / `building_tower_B_{color}.fbx`: Watchtowers and archer towers.
  - `building_watchtower_{color}.fbx`: Elevated lookout outpost.
- **Residential & Production**:
  - `building_home_A_{color}.fbx` / `building_home_B_{color}.fbx`: Peaked timber cottages for resting and sleeping.
  - `building_windmill_{color}.fbx`: Rotating sail grain mill.
  - `building_watermill_{color}.fbx`: Water wheel mill positioned along rivers.
  - `building_lumbermill_{color}.fbx`: Timber processing saw mill.
  - `building_mine_{color}.fbx`: Mountain excavation mine entrance.
  - `building_docks_{color}.fbx` / `building_shipyard_{color}.fbx`: Coastal and river docks for fishermen.
- **Neutral Structures (`buildings/neutral/`)**:
  - `building_bridge_A.fbx` / `building_bridge_B.fbx`: Standalone timber/stone road bridges.
  - `wall_straight.fbx`, `wall_straight_gate.fbx`, `wall_corner_A/B`: Perimeter stone fortifications.
  - `fence_wood_straight.fbx`, `fence_wood_straight_gate.fbx`, `fence_stone_straight.fbx`: Pasture fences.
  - `building_grain.fbx` / `building_dirt.fbx`: Agricultural granary and cultivated farmland plots.
  - `building_destroyed.fbx`: Ruined stone foundations.

### F. Nature & Scatter Props (`Models/decoration/`)
- **Mountains & Hills**:
  - `mountain_A.fbx`, `mountain_B.fbx`, `mountain_C.fbx`: High craggy peaks with central obstacle avoidance ($r = 0.38$).
  - `mountain_A_grass.fbx`, `mountain_B_grass.fbx`, `mountain_C_grass_trees.fbx`: Highland grassy ridges.
  - `hills_A.fbx`, `hills_B.fbx`, `hills_C.fbx`: Grassy hill mounds with parabolic dome elevation (+0.48 crest).
  - `hill_single_A.fbx`, `hill_single_B.fbx`, `hill_single_C.fbx`: Isolated knolls.
- **Forests & Flora (100% Permeable)**:
  - `trees_A_large.fbx` / `medium.fbx` / `small.fbx`: Conifer forest groves.
  - `trees_B_large.fbx` / `medium.fbx` / `small.fbx`: Deciduous autumn groves.
  - `tree_single_A.fbx` / `tree_single_B.fbx`: Solitary oaks/pines.
  - `waterlily_A/B.fbx`, `waterplant_A..C.fbx`: River and wetland reeds.
  - `rock_single_A..E.fbx`: Scenery boulders and crags.
  - `cloud_big.fbx`, `cloud_small.fbx`: Atmospheric floating cloud meshes.
- **Village Dressing Props**:
  - `barrel.fbx`, `crate_A_big.fbx`, `crate_open.fbx`, `cart.fbx`, `wheelbarrow.fbx`, `tent.fbx`, `boat.fbx`.

### G. Citizens, Wildlife & Carried Tools
- **Wildlife & Mounts (`Models/units/neutral/`)**:
  - `horse_A.fbx` through `horse_G.fbx`: 3D domestic horses with color variations (chestnut, bay, dapple, palomino, black) and realistic quadrant roaming.
  - `horse_saddle.fbx`: Saddled mount variant.
- **Citizen Instanced Rigging**:
  - Rendered via GPU `THREE.InstancedMesh` with dynamic faction tunic colors (`blue`, `red`, `green`, `yellow`), procedural hop/tilt walking cycles, and scale differentiation (adults vs children).
- **Dynamic Carried Tools & Accessories**:
  - `pitchfork.fbx`: Carried by farmers during field sowing and harvesting.
  - `woodaxe.fbx`: Carried by lumberjacks felling timber.
  - `pickaxe.fbx`: Carried by miners excavating rocky outcrops.
  - `bow.fbx`: Carried by archers training and patrolling towers.
  - `fishing_rod.fbx`: Carried by fishermen along rivers and lakes.
  - `water_bucket.fbx`: Carried by water carriers fetching from wells.
  - `torch.fbx`: Carried by sentries with glowing fire illumination on night patrols.
  - `ale_flagon.fbx`: Carried by tavern patrons drinking ale during dusk.
  - `scroll.fbx`: Carried by couriers delivering cross-realm messages.

