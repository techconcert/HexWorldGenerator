/**
 * tileRegistry.js
 * Central Registry of Tile Edge Connectors.
 * Allows the user to inspect, toggle, and save connector types for every edge (0..5)
 * of any tile in the pack (Roads, Rivers, Coasts).
 */

import { ASSET_MANIFEST } from './assetManifest.js';

export const CONNECTOR_TYPES = {
  NONE: 'none',
  ROAD: 'road',
  WATER: 'water',
  SAND: 'sand'
};

export const CONNECTOR_COLORS = {
  none: 0x64748b,    // muted slate
  road: 0xf59e0b,    // warm amber/orange
  water: 0x0ea5e9,   // bright blue
  sand: 0xfacc15     // sandy gold
};

// Initial default edge definitions for all road tiles based on model geometry
// Initial default edge definitions for all road tiles based on verified 3D model geometry
// Edges: 0: NE (300°), 1: E (0°), 2: SE (60°), 3: SW (120°), 4: W (180°), 5: NW (240°)
export const DEFAULT_ROAD_TILES = {
  road_A: { name: "Road A (Straight)", edges: [1, 4], desc: "East to West straight" },
  road_B: { name: "Road B (120° Bend)", edges: [0, 4], desc: "NE to West curve" },
  road_C: { name: "Road C (Sharp 60° Bend)", edges: [4, 5], desc: "West to NW sharp bend" },
  road_D: { name: "Road D (Y-Junction)", edges: [0, 2, 4], desc: "3-way 120° symmetric" },
  road_E: { name: "Road E (T-Junction)", edges: [0, 1, 4], desc: "Straight + NE branch" },
  road_F: { name: "Road F (3-Way Branch)", edges: [1, 2, 4], desc: "Straight + SE branch" },
  road_G: { name: "Road G (3-Way Branch Alt)", edges: [3, 4, 5], desc: "3-way branch (SW, W, NW)" },
  road_H: { name: "Road H (4-Way Asym)", edges: [1, 3, 4, 5], desc: "4-way asymmetric" },
  road_I: { name: "Road I (4-Way X-Cross)", edges: [0, 2, 3, 5], desc: "4-way cross" },
  road_J: { name: "Road J (4-Way Hub)", edges: [1, 2, 3, 4], desc: "4 exits (E, SE, SW, W)" },
  road_K: { name: "Road K (5-Way Hub)", edges: [0, 2, 3, 4, 5], desc: "5-way hub (missing E)" },
  road_L: { name: "Road L (6-Way Roundabout)", edges: [0, 1, 2, 3, 4, 5], desc: "All 6 edges" },
  road_M: { name: "Road M (Road Stub)", edges: [4], desc: "Terminal West" },
  river_crossing_A: { name: "River Crossing Bridge A", edges: [2, 5], desc: "SE-NW Road Crossing" },
  river_crossing_B: { name: "River Crossing Bridge B", edges: [0, 3], desc: "NE-SW Road Crossing" }
};

export const PERMANENT_STORAGE_KEY = "kaykit_tile_edge_registry_user_tags";
const LEGACY_STORAGE_KEYS = [
  "kaykit_tile_edge_registry_user_tags",
  "kaykit_tile_edge_registry_v3",
  "kaykit_tile_edge_registry_v2",
  "kaykit_tile_edge_registry_v1",
  "kaykit_tile_edge_registry"
];

export const DEFAULT_RIVER_TILES = {
  river_A: { name: 'River A (Straight)', edges: { 1: 'water', 4: 'water' } },
  river_A_curvy: { name: 'River A Curvy', edges: { 1: 'water', 4: 'water' } },
  river_B: { name: 'River B (Wide 120° Bend)', edges: { 0: 'water', 4: 'water' } },
  river_C: { name: 'River C (Sharp 60° Bend)', edges: { 4: 'water', 5: 'water' } },
  river_D: { name: 'River D (3-Way Y-Junction)', edges: { 0: 'water', 2: 'water', 4: 'water' } },
  river_E: { name: 'River E (3-Way Branch)', edges: { 0: 'water', 1: 'water', 4: 'water' } },
  river_F: { name: 'River F (3-Way Branch Alt)', edges: { 1: 'water', 2: 'water', 4: 'water' } },
  river_G: { name: 'River G (3-Way Arrow)', edges: { 3: 'water', 4: 'water', 5: 'water' } },
  river_H: { name: 'River H (4-Way X-Cross)', edges: { 1: 'water', 3: 'water', 4: 'water', 5: 'water' } },
  river_I: { name: 'River I (4-Way Asymmetric)', edges: { 0: 'water', 2: 'water', 3: 'water', 5: 'water' } },
  river_J: { name: 'River J (4-Way Hub)', edges: { 1: 'water', 2: 'water', 3: 'water', 4: 'water' } },
  river_K: { name: 'River K (5-Way Hub)', edges: { 0: 'water', 2: 'water', 3: 'water', 4: 'water', 5: 'water' } },
  river_L: { name: 'River L (6-Way Roundabout)', edges: { 0: 'water', 1: 'water', 2: 'water', 3: 'water', 4: 'water', 5: 'water' } },
  river_crossing_A: { name: 'River Crossing Bridge A', edges: { 1: 'water', 4: 'water', 2: 'road', 5: 'road' } },
  river_crossing_B: { name: 'River Crossing Bridge B', edges: { 1: 'water', 4: 'water', 0: 'road', 3: 'road' } }
};

export function normalizeEdges(rawEdges) {
  const result = { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' };
  if (!rawEdges) return result;

  if (Array.isArray(rawEdges)) {
    if (rawEdges.length > 0 && typeof rawEdges[0] === 'number') {
      for (const e of rawEdges) {
        if (e >= 0 && e < 6) result[e] = 'road';
      }
    } else {
      for (let i = 0; i < 6; i++) {
        if (rawEdges[i] !== undefined) result[i] = String(rawEdges[i]);
      }
    }
  } else if (typeof rawEdges === 'object') {
    for (let i = 0; i < 6; i++) {
      if (rawEdges[i] !== undefined) {
        result[i] = String(rawEdges[i]);
      }
    }
  }
  return result;
}

class TileRegistry {
  constructor() {
    this.data = this.load();
  }

  load() {
    const defaults = this.getDefaults();
    try {
      if (typeof localStorage !== 'undefined') {
        // Collect user tags across all legacy and current keys without resetting
        let foundData = null;
        for (const key of LEGACY_STORAGE_KEYS) {
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                foundData = parsed;
                break;
              }
            }
          } catch (e) {
            // Ignore parse errors on individual keys
          }
        }

        if (foundData && typeof foundData === 'object') {
          // Saved user tags are 100% AUTHORITATIVE over defaults
          for (const [tileKey, savedTile] of Object.entries(foundData)) {
            if (!savedTile || typeof savedTile !== 'object') continue;
            const normalizedSavedEdges = savedTile.edges ? normalizeEdges(savedTile.edges) : null;
            if (defaults[tileKey]) {
              if (normalizedSavedEdges) {
                // Authoritative replacement: NEVER let old defaults bleed through
                defaults[tileKey].edges = normalizedSavedEdges;
              }
            } else {
              defaults[tileKey] = {
                ...savedTile,
                edges: normalizedSavedEdges || { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' }
              };
            }
          }

          // Ensure physical road sockets on crossing pieces are strictly preserved as road <> road
          if (defaults.river_crossing_A) {
            defaults.river_crossing_A.edges = normalizeEdges(defaults.river_crossing_A.edges);
            defaults.river_crossing_A.edges[1] = 'water';
            defaults.river_crossing_A.edges[4] = 'water';
            if (!defaults.river_crossing_A.edges[2] || defaults.river_crossing_A.edges[2] === 'none') defaults.river_crossing_A.edges[2] = 'road';
            if (!defaults.river_crossing_A.edges[5] || defaults.river_crossing_A.edges[5] === 'none') defaults.river_crossing_A.edges[5] = 'road';
          }
          if (defaults.river_crossing_B) {
            defaults.river_crossing_B.edges = normalizeEdges(defaults.river_crossing_B.edges);
            defaults.river_crossing_B.edges[1] = 'water';
            defaults.river_crossing_B.edges[4] = 'water';
            if (!defaults.river_crossing_B.edges[0] || defaults.river_crossing_B.edges[0] === 'none') defaults.river_crossing_B.edges[0] = 'road';
            if (!defaults.river_crossing_B.edges[3] || defaults.river_crossing_B.edges[3] === 'none') defaults.river_crossing_B.edges[3] = 'road';
          }

          // Persist the consolidated user tags to permanent key
          try {
            localStorage.setItem(PERMANENT_STORAGE_KEY, JSON.stringify(defaults));
          } catch (e) {}
          return defaults;
        }
      }
    } catch (e) {
      console.warn("Could not load from localStorage, using defaults", e);
    }
    return defaults;
  }

  getDefaults() {
    const registry = {};

    // Populate road defaults
    for (const [key, info] of Object.entries(DEFAULT_ROAD_TILES)) {
      const asset = ASSET_MANIFEST.tiles.roads[key];
      const edgeMap = { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' };
      for (const e of info.edges) {
        edgeMap[e] = 'road';
      }
      registry[key] = {
        name: info.name,
        category: 'roads',
        path: asset.path,
        edges: edgeMap
      };
    }

    // Populate rivers defaults with verified geometry
    for (const [key, asset] of Object.entries(ASSET_MANIFEST.tiles.rivers)) {
      const edgeMap = { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' };
      const def = DEFAULT_RIVER_TILES[key];
      if (def && def.edges) {
        Object.assign(edgeMap, def.edges);
      }
      registry[key] = {
        name: (def && def.name) || asset.name || key,
        category: 'rivers',
        path: asset.path,
        edges: edgeMap
      };
    }

    // Populate coast defaults with verified 3D geometry ground truth
    const coastDefaults = {
      coast_A: { 0: 'none', 1: 'sand', 2: 'water', 3: 'sand', 4: 'none', 5: 'none' },
      coast_B: { 0: 'none', 1: 'sand', 2: 'water', 3: 'water', 4: 'sand', 5: 'none' },
      coast_C: { 0: 'sand', 1: 'water', 2: 'water', 3: 'water', 4: 'sand', 5: 'none' },
      coast_D: { 0: 'water', 1: 'water', 2: 'water', 3: 'water', 4: 'sand', 5: 'sand' },
      coast_E: { 0: 'none', 1: 'none', 2: 'sand', 3: 'sand', 4: 'none', 5: 'none' }
    };
    for (const [key, path] of Object.entries(ASSET_MANIFEST.tiles.coast)) {
      registry[key] = {
        name: `Coast ${key.split('_')[1]}`,
        category: 'coast',
        path: path,
        edges: { ...(coastDefaults[key] || { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' }) }
      };
    }

    return registry;
  }

  save() {
    try {
      const payload = JSON.stringify(this.data, null, 2);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PERMANENT_STORAGE_KEY, payload);
        // Mirror to legacy keys so old scripts/tabs see the latest tags
        localStorage.setItem("kaykit_tile_edge_registry_v3", payload);
        localStorage.setItem("kaykit_tile_edge_registry", payload);
      }
      if (typeof fetch !== 'undefined') {
        fetch('/api/save_tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }).then(res => {
          if (res.ok) console.log('[TileRegistry] Successfully persisted tags to tile_registry_config.json on disk');
        }).catch(() => {});
      }
    } catch (e) {
      console.error("Failed to save to localStorage / disk:", e);
    }
  }

  resetToDefaults() {
    this.data = this.getDefaults();
    this.save();
  }

  getTile(key) {
    const tile = this.data[key];
    if (tile && (!tile.edges || typeof tile.edges !== 'object')) {
      tile.edges = normalizeEdges(tile.edges);
    }
    return tile || null;
  }

  setEdgeConnector(tileKey, edgeIndex, connectorType) {
    if (!this.data[tileKey]) {
      this.data[tileKey] = {
        category: 'custom',
        edges: { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' }
      };
    }
    this.data[tileKey].edges[edgeIndex] = connectorType;
    this.save();
  }

  getActiveEdgesOfType(tileKey, type) {
    const tile = this.getTile(tileKey);
    if (!tile) return [];
    const active = [];
    for (let i = 0; i < 6; i++) {
      if (tile.edges[i] === type) {
        active.push(i);
      }
    }
    return active;
  }

  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  }

  importJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      this.data = parsed;
      this.save();
      return true;
    } catch (e) {
      console.error("Invalid JSON:", e);
      return false;
    }
  }
}

export const tileRegistry = new TileRegistry();
