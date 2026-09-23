/**
 * assetManifest.js
 * Comprehensive manifest of all KayKit Medieval Hexagon FBX assets & texture atlases in the project.
 */

const BASE_PATH = './kaykit_full/Models';

export const TEXTURE_ATLASES = {
  spring: './kaykit_full/Textures/hexagons_medieval.png',
  summer: './kaykit_full/Textures/hexagons_medieval_Summer.png',
  fall: './kaykit_full/Textures/hexagons_medieval_Fall.png',       // Fall / Desert / Arid Savanna
  winter: './kaykit_full/Textures/hexagons_medieval_Winter.png'   // Winter / Snow / Alpine Peaks
};

export const BIOME_CONFIGS = {
  spring: { name: 'Spring Meadows', baseTexture: 'spring', tint: 0xffffff, description: 'Lush green meadow & river valley' },
  summer: { name: 'Summer Forest', baseTexture: 'summer', tint: 0xffffff, description: 'Dense emerald forest & grasslands' },
  fall: { name: 'Autumn Savanna', baseTexture: 'fall', tint: 0xffffff, description: 'Golden autumn woods & arid plateau' },
  winter: { name: 'Winter Peaks', baseTexture: 'winter', tint: 0xffffff, description: 'Snow-capped alpine mountains & ice' }
};

const makeFactionBuildings = (color) => ({
  castle: `${BASE_PATH}/buildings/${color}/building_castle_${color}.fbx`,
  church: `${BASE_PATH}/buildings/${color}/building_church_${color}.fbx`,
  market: `${BASE_PATH}/buildings/${color}/building_market_${color}.fbx`,
  tavern: `${BASE_PATH}/buildings/${color}/building_tavern_${color}.fbx`,
  blacksmith: `${BASE_PATH}/buildings/${color}/building_blacksmith_${color}.fbx`,
  barracks: `${BASE_PATH}/buildings/${color}/building_barracks_${color}.fbx`,
  tower_A: `${BASE_PATH}/buildings/${color}/building_tower_A_${color}.fbx`,
  tower_B: `${BASE_PATH}/buildings/${color}/building_tower_B_${color}.fbx`,
  home_A: `${BASE_PATH}/buildings/${color}/building_home_A_${color}.fbx`,
  home_B: `${BASE_PATH}/buildings/${color}/building_home_B_${color}.fbx`,
  windmill: `${BASE_PATH}/buildings/${color}/building_windmill_${color}.fbx`,
  watermill: `${BASE_PATH}/buildings/${color}/building_watermill_${color}.fbx`,
  lumbermill: `${BASE_PATH}/buildings/${color}/building_lumbermill_${color}.fbx`,
  mine: `${BASE_PATH}/buildings/${color}/building_mine_${color}.fbx`,
  well: `${BASE_PATH}/buildings/${color}/building_well_${color}.fbx`,
  docks: `${BASE_PATH}/buildings/${color}/building_docks_${color}.fbx`,
  shipyard: `${BASE_PATH}/buildings/${color}/building_shipyard_${color}.fbx`,
  watchtower: `${BASE_PATH}/buildings/${color}/building_watchtower_${color}.fbx`,
  stables: `${BASE_PATH}/buildings/${color}/building_stables_${color}.fbx`,
  townhall: `${BASE_PATH}/buildings/${color}/building_townhall_${color}.fbx`,
  workshop: `${BASE_PATH}/buildings/${color}/building_workshop_${color}.fbx`
});

export const ASSET_MANIFEST = {
  tiles: {
    base: {
      grass: `${BASE_PATH}/tiles/base/hex_grass.fbx`,
      water: `${BASE_PATH}/tiles/base/hex_water.fbx`,
      grass_bottom: `${BASE_PATH}/tiles/base/hex_grass_bottom.fbx`,
      grass_sloped_high: `${BASE_PATH}/tiles/base/hex_grass_sloped_high.fbx`,
      grass_sloped_low: `${BASE_PATH}/tiles/base/hex_grass_sloped_low.fbx`,
      transition: `${BASE_PATH}/tiles/base/hex_transition.fbx`
    },
    roads: {
      road_A: { path: `${BASE_PATH}/tiles/roads/hex_road_A.fbx`, name: 'Road A (Straight)', defaultEdges: [1, 4] },
      road_B: { path: `${BASE_PATH}/tiles/roads/hex_road_B.fbx`, name: 'Road B (120° Bend)', defaultEdges: [0, 4] },
      road_C: { path: `${BASE_PATH}/tiles/roads/hex_road_C.fbx`, name: 'Road C (Sharp 60° Bend)', defaultEdges: [4, 5] },
      road_D: { path: `${BASE_PATH}/tiles/roads/hex_road_D.fbx`, name: 'Road D (Symmetric Y-Junction)', defaultEdges: [0, 2, 4] },
      road_E: { path: `${BASE_PATH}/tiles/roads/hex_road_E.fbx`, name: 'Road E (T-Junction)', defaultEdges: [0, 1, 4] },
      road_F: { path: `${BASE_PATH}/tiles/roads/hex_road_F.fbx`, name: 'Road F (3-Way Branch)', defaultEdges: [1, 2, 4] },
      road_G: { path: `${BASE_PATH}/tiles/roads/hex_road_G.fbx`, name: 'Road G (3-Way Branch Alt)', defaultEdges: [3, 4, 5] },
      road_H: { path: `${BASE_PATH}/tiles/roads/hex_road_H.fbx`, name: 'Road H (4-Way Asymmetric)', defaultEdges: [1, 3, 4, 5] },
      road_I: { path: `${BASE_PATH}/tiles/roads/hex_road_I.fbx`, name: 'Road I (4-Way X-Cross)', defaultEdges: [0, 2, 3, 5] },
      road_J: { path: `${BASE_PATH}/tiles/roads/hex_road_J.fbx`, name: 'Road J (4-Way Hub)', defaultEdges: [1, 2, 3, 4] },
      road_K: { path: `${BASE_PATH}/tiles/roads/hex_road_K.fbx`, name: 'Road K (5-Way Hub)', defaultEdges: [0, 2, 3, 4, 5] },
      road_L: { path: `${BASE_PATH}/tiles/roads/hex_road_L.fbx`, name: 'Road L (6-Way Roundabout)', defaultEdges: [0, 1, 2, 3, 4, 5] },
      road_M: { path: `${BASE_PATH}/tiles/roads/hex_road_M.fbx`, name: 'Road M (Road Terminal)', defaultEdges: [4] },
      river_crossing_A: { path: `${BASE_PATH}/tiles/rivers/hex_river_crossing_A.fbx`, name: 'River Crossing Bridge A', defaultEdges: [2, 5] },
      river_crossing_B: { path: `${BASE_PATH}/tiles/rivers/hex_river_crossing_B.fbx`, name: 'River Crossing Bridge B', defaultEdges: [0, 3] }
    },
    rivers: {
      river_A: { path: `${BASE_PATH}/tiles/rivers/hex_river_A.fbx`, name: 'River A (Single Edge / Spring)' },
      river_B: { path: `${BASE_PATH}/tiles/rivers/hex_river_B.fbx`, name: 'River B (Straight Across)' },
      river_C: { path: `${BASE_PATH}/tiles/rivers/hex_river_C.fbx`, name: 'River C (Sharp 60° Curve)' },
      river_D: { path: `${BASE_PATH}/tiles/rivers/hex_river_D.fbx`, name: 'River D (Wide 120° Turn)' },
      river_E: { path: `${BASE_PATH}/tiles/rivers/hex_river_E.fbx`, name: 'River E (3-Way Fork Hub)' },
      river_F: { path: `${BASE_PATH}/tiles/rivers/hex_river_F.fbx`, name: 'River F (Straight + 1 Edge)' },
      river_G: { path: `${BASE_PATH}/tiles/rivers/hex_river_G.fbx`, name: 'River G (Curved + 1 Edge)' },
      river_H: { path: `${BASE_PATH}/tiles/rivers/hex_river_H.fbx`, name: 'River H (4-Way Hub)' },
      river_I: { path: `${BASE_PATH}/tiles/rivers/hex_river_I.fbx`, name: 'River I (4-Way Hub)' },
      river_J: { path: `${BASE_PATH}/tiles/rivers/hex_river_J.fbx`, name: 'River J (4-Way Hub)' },
      river_K: { path: `${BASE_PATH}/tiles/rivers/hex_river_K.fbx`, name: 'River K (5-Way Hub)' },
      river_L: { path: `${BASE_PATH}/tiles/rivers/hex_river_L.fbx`, name: 'River L (6-Way Roundabout)' },
      river_crossing_A: { path: `${BASE_PATH}/tiles/rivers/hex_river_crossing_A.fbx`, name: 'River Crossing Bridge A' },
      river_crossing_B: { path: `${BASE_PATH}/tiles/rivers/hex_river_crossing_B.fbx`, name: 'River Crossing Bridge B' }
    },
    coast: {
      coast_A: `${BASE_PATH}/tiles/coast/hex_coast_A.fbx`,
      coast_B: `${BASE_PATH}/tiles/coast/hex_coast_B.fbx`,
      coast_C: `${BASE_PATH}/tiles/coast/hex_coast_C.fbx`,
      coast_D: `${BASE_PATH}/tiles/coast/hex_coast_D.fbx`,
      coast_E: `${BASE_PATH}/tiles/coast/hex_coast_E.fbx`
    }
  },
  buildings: {
    blue: makeFactionBuildings('blue'),
    green: makeFactionBuildings('green'),
    red: makeFactionBuildings('red'),
    yellow: makeFactionBuildings('yellow'),
    neutral: {
      bridge_A: `${BASE_PATH}/buildings/neutral/building_bridge_A.fbx`,
      bridge_B: `${BASE_PATH}/buildings/neutral/building_bridge_B.fbx`,
      fence_stone_straight: `${BASE_PATH}/buildings/neutral/fence_stone_straight.fbx`,
      fence_stone_straight_gate: `${BASE_PATH}/buildings/neutral/fence_stone_straight_gate.fbx`,
      fence_wood_straight: `${BASE_PATH}/buildings/neutral/fence_wood_straight.fbx`,
      fence_wood_straight_gate: `${BASE_PATH}/buildings/neutral/fence_wood_straight_gate.fbx`,
      wall_straight: `${BASE_PATH}/buildings/neutral/wall_straight.fbx`,
      wall_straight_gate: `${BASE_PATH}/buildings/neutral/wall_straight_gate.fbx`,
      wall_corner_A_outside: `${BASE_PATH}/buildings/neutral/wall_corner_A_outside.fbx`,
      wall_corner_A_inside: `${BASE_PATH}/buildings/neutral/wall_corner_A_inside.fbx`,
      wall_corner_A_gate: `${BASE_PATH}/buildings/neutral/wall_corner_A_gate.fbx`,
      wall_corner_B_outside: `${BASE_PATH}/buildings/neutral/wall_corner_B_outside.fbx`,
      wall_corner_B_inside: `${BASE_PATH}/buildings/neutral/wall_corner_B_inside.fbx`,
      destroyed: `${BASE_PATH}/buildings/neutral/building_destroyed.fbx`,
      building_grain: `${BASE_PATH}/buildings/neutral/building_grain.fbx`,
      building_dirt: `${BASE_PATH}/buildings/neutral/building_dirt.fbx`
    }
  },
  decoration: {
    nature: {
      mountain_A: `${BASE_PATH}/decoration/nature/mountain_A.fbx`,
      mountain_A_grass: `${BASE_PATH}/decoration/nature/mountain_A_grass.fbx`,
      mountain_B: `${BASE_PATH}/decoration/nature/mountain_B.fbx`,
      mountain_B_grass: `${BASE_PATH}/decoration/nature/mountain_B_grass.fbx`,
      mountain_C: `${BASE_PATH}/decoration/nature/mountain_C.fbx`,
      mountain_C_grass: `${BASE_PATH}/decoration/nature/mountain_C_grass.fbx`,
      mountain_C_grass_trees: `${BASE_PATH}/decoration/nature/mountain_C_grass_trees.fbx`,

      hills_A: `${BASE_PATH}/decoration/nature/hills_A.fbx`,
      hills_B: `${BASE_PATH}/decoration/nature/hills_B.fbx`,
      hills_C: `${BASE_PATH}/decoration/nature/hills_C.fbx`,
      hill_single_A: `${BASE_PATH}/decoration/nature/hill_single_A.fbx`,
      hill_single_B: `${BASE_PATH}/decoration/nature/hill_single_B.fbx`,
      hill_single_C: `${BASE_PATH}/decoration/nature/hill_single_C.fbx`,
      hills_B_trees: `${BASE_PATH}/decoration/nature/hills_B_trees.fbx`,

      trees_A_large: `${BASE_PATH}/decoration/nature/trees_A_large.fbx`,
      trees_A_medium: `${BASE_PATH}/decoration/nature/trees_A_medium.fbx`,
      trees_A_small: `${BASE_PATH}/decoration/nature/trees_A_small.fbx`,
      trees_B_large: `${BASE_PATH}/decoration/nature/trees_B_large.fbx`,
      trees_B_medium: `${BASE_PATH}/decoration/nature/trees_B_medium.fbx`,
      trees_B_small: `${BASE_PATH}/decoration/nature/trees_B_small.fbx`,
      tree_single_A: `${BASE_PATH}/decoration/nature/tree_single_A.fbx`,
      tree_single_B: `${BASE_PATH}/decoration/nature/tree_single_B.fbx`,

      rock_single_A: `${BASE_PATH}/decoration/nature/rock_single_A.fbx`,
      rock_single_B: `${BASE_PATH}/decoration/nature/rock_single_B.fbx`,
      rock_single_C: `${BASE_PATH}/decoration/nature/rock_single_C.fbx`,
      rock_single_D: `${BASE_PATH}/decoration/nature/rock_single_D.fbx`,
      rock_single_E: `${BASE_PATH}/decoration/nature/rock_single_E.fbx`,

      waterlily_A: `${BASE_PATH}/decoration/nature/waterlily_A.fbx`,
      waterlily_B: `${BASE_PATH}/decoration/nature/waterlily_B.fbx`,
      waterplant_A: `${BASE_PATH}/decoration/nature/waterplant_A.fbx`,
      waterplant_B: `${BASE_PATH}/decoration/nature/waterplant_B.fbx`,
      waterplant_C: `${BASE_PATH}/decoration/nature/waterplant_C.fbx`,
      cloud_big: `${BASE_PATH}/decoration/nature/cloud_big.fbx`,
      cloud_small: `${BASE_PATH}/decoration/nature/cloud_small.fbx`
    },
    props: {
      barrel: `${BASE_PATH}/decoration/props/barrel.fbx`,
      crate_A_big: `${BASE_PATH}/decoration/props/crate_A_big.fbx`,
      crate_open: `${BASE_PATH}/decoration/props/crate_open.fbx`,
      cart: `${BASE_PATH}/units/neutral/cart.fbx`,
      tent: `${BASE_PATH}/decoration/props/tent.fbx`,
      wheelbarrow: `${BASE_PATH}/decoration/props/wheelbarrow.fbx`,
      boat: `${BASE_PATH}/decoration/props/boat.fbx`
    }
  },
  units: {
    horse: `${BASE_PATH}/units/neutral/horse_A.fbx`,
    horse_A: `${BASE_PATH}/units/neutral/horse_A.fbx`,
    horse_B: `${BASE_PATH}/units/neutral/horse_B.fbx`,
    horse_C: `${BASE_PATH}/units/neutral/horse_C.fbx`,
    horse_D: `${BASE_PATH}/units/neutral/horse_D.fbx`,
    horse_E: `${BASE_PATH}/units/neutral/horse_E.fbx`,
    horse_F: `${BASE_PATH}/units/neutral/horse_F.fbx`,
    horse_G: `${BASE_PATH}/units/neutral/horse_G.fbx`,
    horse_saddle: `${BASE_PATH}/units/neutral/horse_saddle.fbx`
  }
};
