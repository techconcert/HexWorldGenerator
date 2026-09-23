/**
 * roadAutotile.js
 * 6-Bit Hex Bitmasking and Autotiler for KayKit Medieval Hexagons.
 * Reads configured connector edges directly from tileRegistry and creates
 * a 64-state lookup table.
 */

import { tileRegistry } from './tileRegistry.js';
import { ASSET_MANIFEST } from './assetManifest.js';

export function edgesToBitmask(edges) {
  let mask = 0;
  for (const e of edges) {
    mask |= (1 << e);
  }
  return mask;
}

export function rotateBitmask(mask, steps) {
  steps = ((steps % 6) + 6) % 6;
  let res = 0;
  for (let i = 0; i < 6; i++) {
    if (mask & (1 << i)) {
      const newEdge = (i + steps) % 6;
      res |= (1 << newEdge);
    }
  }
  return res;
}

export const BITMASK_LOOKUP_TABLE = new Array(64);
export const COAST_LOOKUP_TABLE = new Array(64);
export const COAST_FULL_LOOKUP = [];

export const COAST_PHYSICAL_SPECS = {
  coast_A: ['none', 'sand_GW', 'water', 'sand_WG', 'none', 'none'],
  coast_B: ['none', 'sand_GW', 'water', 'water', 'sand_WG', 'none'],
  coast_C: ['sand_GW', 'water', 'water', 'water', 'sand_WG', 'none'],
  coast_D: ['water', 'water', 'water', 'water', 'sand_WG', 'sand_GW'],
  coast_E: ['none', 'none', 'sand_GW', 'sand_WG', 'none', 'none']
};

export function socketsCompatible(s1, s2) {
  if (s1 === 'none' && s2 === 'none') return true;
  if (s1 === 'water' && s2 === 'water') return true;
  if (s1 === 'sand_GW' && s2 === 'sand_WG') return true;
  if (s1 === 'sand_WG' && s2 === 'sand_GW') return true;
  if ((s1 === 'sand' && (s2 === 'sand' || s2 === 'sand_GW' || s2 === 'sand_WG')) ||
      (s2 === 'sand' && (s1 === 'sand' || s1 === 'sand_GW' || s1 === 'sand_WG'))) {
    return true;
  }
  return false;
}

export function isContiguousEdges(edges) {
  if (!edges || edges.length <= 1 || edges.length === 6) return true;
  const n = edges.length;
  const edgeSet = new Set(edges);
  for (const start of edges) {
    let count = 0;
    for (let k = 0; k < n; k++) {
      if (edgeSet.has((start + k) % 6)) count++;
      else break;
    }
    if (count === n) return true;
  }
  return false;
}

export function rebuildCoastFullLookup() {
  COAST_FULL_LOOKUP.length = 0;
  const coastKeys = Object.keys(ASSET_MANIFEST.tiles.coast);
  for (const key of coastKeys) {
    const tileDef = tileRegistry.getTile(key);
    if (!tileDef || !tileDef.edges) continue;

    // Get the base edges array [E0, E1, E2, E3, E4, E5]
    const baseEdges = [];
    for (let i = 0; i < 6; i++) {
      baseEdges.push(tileDef.edges[i] || 'none');
    }

    const physicalBase = COAST_PHYSICAL_SPECS[key] || baseEdges;

    for (let rot = 0; rot < 6; rot++) {
      // Rotate the edges array by 'rot' steps clockwise
      const rotatedEdges = new Array(6);
      const rotatedPhysical = new Array(6);
      for (let i = 0; i < 6; i++) {
        rotatedEdges[(i + rot) % 6] = baseEdges[i];
        rotatedPhysical[(i + rot) % 6] = physicalBase[i];
      }
      
      COAST_FULL_LOOKUP.push({
        pieceId: key,
        name: tileDef.name || key,
        path: tileDef.path || ASSET_MANIFEST.tiles.coast[key],
        rotationStep: rot,
        edges: rotatedEdges,
        physicalEdges: rotatedPhysical
      });
    }
  }
}

export function rebuildAutotileLookup() {
  // Clear table
  for (let i = 0; i < 64; i++) {
    BITMASK_LOOKUP_TABLE[i] = null;
  }

  // Iterate over all road tiles in the registry
  const roadKeys = Object.keys(ASSET_MANIFEST.tiles.roads);
  for (const key of roadKeys) {
    const tileDef = tileRegistry.getTile(key);
    if (!tileDef || !tileDef.edges) continue;

    const activeEdges = [];
    for (let e = 0; e < 6; e++) {
      if (tileDef.edges[e] === 'road') {
        activeEdges.push(e);
      }
    }

    const baseMask = edgesToBitmask(activeEdges);

    // Apply 6 rotation variations (steps 0..5)
    for (let rot = 0; rot < 6; rot++) {
      const rotatedMask = rotateBitmask(baseMask, rot);
      if (!BITMASK_LOOKUP_TABLE[rotatedMask]) {
        BITMASK_LOOKUP_TABLE[rotatedMask] = {
          pieceId: key,
          name: tileDef.name || key,
          path: tileDef.path || (ASSET_MANIFEST.tiles.roads[key] && ASSET_MANIFEST.tiles.roads[key].path),
          rotationStep: rot,
          rotationDeg: rot * 60,
          originalEdges: activeEdges,
          targetEdges: activeEdges.map(e => (e + rot) % 6)
        };
      }
    }
  }

  // Fallback for isolated single-tile road (mask 0)
  if (!BITMASK_LOOKUP_TABLE[0]) {
    BITMASK_LOOKUP_TABLE[0] = {
      pieceId: 'road_A',
      name: 'Single Tile Road (Straight A)',
      path: ASSET_MANIFEST.tiles.roads.road_A.path,
      rotationStep: 0,
      rotationDeg: 0,
      originalEdges: [1, 4],
      targetEdges: [1, 4]
    };
  }

  // Build COAST_LOOKUP_TABLE based on 'water' edges
  for (let i = 0; i < 64; i++) {
    COAST_LOOKUP_TABLE[i] = null;
  }

  const coastKeys = Object.keys(ASSET_MANIFEST.tiles.coast);
  for (const key of coastKeys) {
    const tileDef = tileRegistry.getTile(key);
    if (!tileDef || !tileDef.edges) continue;

    const waterEdges = [];
    for (let e = 0; e < 6; e++) {
      if (tileDef.edges[e] === 'water') {
        waterEdges.push(e);
      }
    }

    const baseEdges = [];
    for (let i = 0; i < 6; i++) {
      baseEdges.push(tileDef.edges[i] || 'none');
    }
    const physicalBase = COAST_PHYSICAL_SPECS[key] || baseEdges;
    const baseMask = edgesToBitmask(waterEdges);

    for (let rot = 0; rot < 6; rot++) {
      const rotatedMask = rotateBitmask(baseMask, rot);
      if (!COAST_LOOKUP_TABLE[rotatedMask]) {
        const rotatedEdges = new Array(6);
        const rotatedPhysical = new Array(6);
        for (let i = 0; i < 6; i++) {
          rotatedEdges[(i + rot) % 6] = baseEdges[i];
          rotatedPhysical[(i + rot) % 6] = physicalBase[i];
        }

        COAST_LOOKUP_TABLE[rotatedMask] = {
          pieceId: key,
          name: tileDef.name || key,
          path: tileDef.path || ASSET_MANIFEST.tiles.coast[key],
          rotationStep: rot,
          originalEdges: waterEdges,
          edges: rotatedEdges,
          physicalEdges: rotatedPhysical
        };
      }
    }
  }

  // Also sync full lookup table
  rebuildCoastFullLookup();
}

// Initial build on load
rebuildAutotileLookup();

export function resolveRoadTile(activeEdges) {
  const mask = edgesToBitmask(activeEdges);
  return BITMASK_LOOKUP_TABLE[mask] || BITMASK_LOOKUP_TABLE[0];
}

export function resolveCoastTileAutotiled(waterEdges) {
  const mask = edgesToBitmask(waterEdges);
  return COAST_LOOKUP_TABLE[mask];
}

export function resolveCoastByExactEdges(reqEdges) {
  if (COAST_FULL_LOOKUP.length === 0) rebuildCoastFullLookup();
  
  let bestMatch = null;
  let bestScore = -Infinity;

  for (const candidate of COAST_FULL_LOOKUP) {
    let score = 0;
    let valid = true;

    for (let i = 0; i < 6; i++) {
      const req = reqEdges[i];
      if (!req) continue; // wildcard / unconstrained
      const cand = candidate.edges[i];

      if (cand === req) {
        if (req === 'water') score += 10;
        else if (req === 'sand') score += 8;
        else score += 2;
      } else {
        // Strict boundary constraints: water edges must strictly match water
        if (req === 'water' && cand !== 'water') { valid = false; break; }
        if (req !== 'water' && cand === 'water') { valid = false; break; }
        score -= 20;
      }
    }
    
    if (!valid) continue;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }
  
  return bestMatch ? { piece: bestMatch, score: bestScore } : { piece: COAST_FULL_LOOKUP[0] || null, score: -999 };
}

export const RIVER_LOOKUP_TABLE = {};

// Full topological specs for all river pieces in KayKit Medieval Hexagons:
export const RIVER_BASE_SPECS = {
  // 2-way: 15 combinations
  river_A: [1, 4], // straight (180°)
  river_B: [0, 4], // wide bend (120°)
  river_C: [4, 5], // sharp bend (60°)

  // 3-way: 20 combinations (100% of all 3-edge subsets covered)
  river_D: [0, 2, 4], // symmetric Y-fork (120°)
  river_E: [0, 1, 4], // 3-way branch (NE, E, W)
  river_F: [1, 2, 4], // 3-way branch alt (E, SE, W)
  river_G: [3, 4, 5], // sharp 3-way arrow (SW, W, NW)

  // 4-way: 15 combinations (100% of all 4-edge subsets covered)
  river_H: [1, 3, 4, 5], // 4-way cross
  river_I: [0, 2, 3, 5], // 4-way asymmetric
  river_J: [1, 2, 3, 4], // 4-way hub

  // 5-way: 6 combinations
  river_K: [0, 2, 3, 4, 5], // 5-way hub

  // 6-way: 1 combination
  river_L: [0, 1, 2, 3, 4, 5] // 6-way roundabout
};

export function rebuildRiverLookup() {
  for (const [pieceId, baseEdges] of Object.entries(RIVER_BASE_SPECS)) {
    const pieceDef = ASSET_MANIFEST.tiles.rivers[pieceId];
    for (let r = 0; r < 6; r++) {
      const rotEdges = baseEdges.map(e => (e + r) % 6).sort((a, b) => a - b);
      const key = rotEdges.join('_');
      if (!RIVER_LOOKUP_TABLE[key]) {
        const physicalEdges = new Array(6).fill('none');
        for (const e of rotEdges) {
          physicalEdges[e] = 'water';
        }
        RIVER_LOOKUP_TABLE[key] = {
          pieceId,
          name: pieceDef?.name || pieceId,
          path: pieceDef?.path || `./kaykit_full/Models/tiles/rivers/hex_${pieceId}.fbx`,
          rotationStep: r,
          edges: rotEdges,
          physicalEdges
        };
      }
    }
  }
}
rebuildRiverLookup();

export function resolveRiverTile(riverEdges, useCurvy = false) {
  if (!riverEdges || riverEdges.length === 0) {
    return {
      pieceId: 'river_A',
      name: 'River A (Straight)',
      path: ASSET_MANIFEST.tiles.rivers.river_A.path,
      rotationStep: 0,
      edges: [1, 4]
    };
  }

  // Deduplicate and sort active edges
  const sorted = Array.from(new Set(riverEdges)).sort((a, b) => a - b);

  // Single-edge (source / terminal spring): use straight piece aligned with that edge
  if (sorted.length === 1) {
    const e = sorted[0];
    const opp = (e + 3) % 6;
    const pairKey = [Math.min(e, opp), Math.max(e, opp)].join('_');
    const match = RIVER_LOOKUP_TABLE[pairKey];
    return match ? {
      ...match,
      edges: [e, opp]
    } : {
      pieceId: 'river_A',
      name: 'River A (Straight)',
      path: ASSET_MANIFEST.tiles.rivers.river_A.path,
      rotationStep: (e + 2) % 6,
      edges: [e, opp]
    };
  }

  // Exact match for 2-way, 3-way, 4-way, 5-way, 6-way
  const key = sorted.join('_');
  const match = RIVER_LOOKUP_TABLE[key];
  if (match) {
    let pid = match.pieceId;
    if (pid === 'river_A' && useCurvy) {
      pid = 'river_A_curvy';
    }
    return {
      pieceId: pid,
      name: ASSET_MANIFEST.tiles.rivers[pid]?.name || pid,
      path: ASSET_MANIFEST.tiles.rivers[pid]?.path || match.path,
      rotationStep: match.rotationStep,
      edges: match.edges,
      physicalEdges: match.physicalEdges
    };
  }

  // Fallback for partial matches (if any): find best candidate maximizing edge overlap
  let bestCandidate = null;
  let bestScore = -Infinity;
  for (const cand of Object.values(RIVER_LOOKUP_TABLE)) {
    let overlap = 0;
    for (const e of sorted) {
      if (cand.edges.includes(e)) overlap++;
    }
    const penalty = cand.edges.length - overlap;
    const score = overlap * 10 - penalty * 5;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  if (bestCandidate) {
    return {
      pieceId: bestCandidate.pieceId,
      name: ASSET_MANIFEST.tiles.rivers[bestCandidate.pieceId]?.name || bestCandidate.pieceId,
      path: ASSET_MANIFEST.tiles.rivers[bestCandidate.pieceId]?.path,
      rotationStep: bestCandidate.rotationStep,
      edges: bestCandidate.edges,
      physicalEdges: bestCandidate.physicalEdges
    };
  }

  return {
    pieceId: 'river_A',
    name: 'River A',
    path: ASSET_MANIFEST.tiles.rivers.river_A.path,
    rotationStep: 0,
    edges: [1, 4]
  };
}

export function resolveRiverMouthTile(upstreamEdge, oceanEdge) {
  // river_E has base river entry at Edge 4, opening towards Edge 0 & 1
  const rot = ((upstreamEdge - 4) % 6 + 6) % 6;
  return {
    pieceId: 'river_E',
    name: 'River E (River Mouth)',
    path: ASSET_MANIFEST.tiles.rivers.river_E.path,
    rotationStep: rot
  };
}

export function resolveBridgeTile(riverEdges, roadEdges) {
  if (!riverEdges || !roadEdges || riverEdges.length < 2 || roadEdges.length < 2) return null;

  const rSorted = [...riverEdges].sort((a, b) => a - b);
  const dSorted = [...roadEdges].sort((a, b) => a - b);

  // Check crossing_A (base river [1, 4], road [2, 5])
  for (let rot = 0; rot < 6; rot++) {
    const candR = [(1 + rot) % 6, (4 + rot) % 6].sort((a, b) => a - b);
    const candD = [(2 + rot) % 6, (5 + rot) % 6].sort((a, b) => a - b);
    if (candR[0] === rSorted[0] && candR[1] === rSorted[1] &&
        candD[0] === dSorted[0] && candD[1] === dSorted[1]) {
      return {
        pieceId: 'river_crossing_A',
        name: 'River Crossing Bridge A',
        path: ASSET_MANIFEST.tiles.rivers.river_crossing_A.path,
        rotationStep: rot
      };
    }
  }

  // Check crossing_B (base river [1, 4], road [0, 3])
  for (let rot = 0; rot < 6; rot++) {
    const candR = [(1 + rot) % 6, (4 + rot) % 6].sort((a, b) => a - b);
    const candD = [(0 + rot) % 6, (3 + rot) % 6].sort((a, b) => a - b);
    if (candR[0] === rSorted[0] && candR[1] === rSorted[1] &&
        candD[0] === dSorted[0] && candD[1] === dSorted[1]) {
      return {
        pieceId: 'river_crossing_B',
        name: 'River Crossing Bridge B',
        path: ASSET_MANIFEST.tiles.rivers.river_crossing_B.path,
        rotationStep: rot
      };
    }
  }

  // NEVER return misaligned painted road fallback!
  return null;
}

export function resolveBridgeProp(riverEdges, roadEdges) {
  const rSorted = (riverEdges && riverEdges.length >= 2) ? [...riverEdges].sort((a, b) => a - b) : [1, 4];
  const dSorted = (roadEdges && roadEdges.length >= 2) ? [...roadEdges].sort((a, b) => a - b) : [0, 3];

  const candidates = [];
  for (let rot = 0; rot < 6; rot++) {
    // bridge_A: deck [(2+rot)%6, (5+rot)%6], arch [(1+rot)%6, (4+rot)%6]
    const deckA = [(2 + rot) % 6, (5 + rot) % 6].sort((a, b) => a - b);
    const archA = [(1 + rot) % 6, (4 + rot) % 6].sort((a, b) => a - b);
    const roadMatchA = (deckA[0] === dSorted[0] && deckA[1] === dSorted[1]);
    const riverMatchA = (archA[0] === rSorted[0] && archA[1] === rSorted[1]);
    if (roadMatchA) {
      candidates.push({ pieceId: 'bridge_A', path: ASSET_MANIFEST.buildings.neutral.bridge_A, rotationStep: rot, riverMatch: riverMatchA });
    }

    // bridge_B: deck [(0+rot)%6, (3+rot)%6], arch [(1+rot)%6, (4+rot)%6]
    const deckB = [(0 + rot) % 6, (3 + rot) % 6].sort((a, b) => a - b);
    const archB = [(1 + rot) % 6, (4 + rot) % 6].sort((a, b) => a - b);
    const roadMatchB = (deckB[0] === dSorted[0] && deckB[1] === dSorted[1]);
    const riverMatchB = (archB[0] === rSorted[0] && archB[1] === rSorted[1]);
    if (roadMatchB) {
      candidates.push({ pieceId: 'bridge_B', path: ASSET_MANIFEST.buildings.neutral.bridge_B, rotationStep: rot, riverMatch: riverMatchB });
    }
  }

  // If exact road match found, pick candidate with best river arch match
  if (candidates.length > 0) {
    candidates.sort((a, b) => (b.riverMatch ? 1 : 0) - (a.riverMatch ? 1 : 0));
    return candidates[0];
  }

  // Fallback if road has non-opposite edges: align deck with the primary road entry edge
  const primaryRoad = dSorted[0];
  const oppositeRoad = (primaryRoad + 3) % 6;
  const targetAxis = [Math.min(primaryRoad, oppositeRoad), Math.max(primaryRoad, oppositeRoad)];

  for (let rot = 0; rot < 6; rot++) {
    const deckA = [(2 + rot) % 6, (5 + rot) % 6].sort((a, b) => a - b);
    if (deckA[0] === targetAxis[0] && deckA[1] === targetAxis[1]) {
      return { pieceId: 'bridge_A', path: ASSET_MANIFEST.buildings.neutral.bridge_A, rotationStep: rot };
    }
    const deckB = [(0 + rot) % 6, (3 + rot) % 6].sort((a, b) => a - b);
    if (deckB[0] === targetAxis[0] && deckB[1] === targetAxis[1]) {
      return { pieceId: 'bridge_B', path: ASSET_MANIFEST.buildings.neutral.bridge_B, rotationStep: rot };
    }
  }

  return {
    pieceId: 'bridge_A',
    path: ASSET_MANIFEST.buildings.neutral.bridge_A,
    rotationStep: 0
  };
}

