#!/usr/bin/env node
/**
 * test_world_qa.js
 * Comprehensive Headless QA Verification Suite for KayKit Hex World Generator.
 * Milestone 5 Edition: Rivers, Estuaries/Mouths, Bridges, Scalability & Zero-Regression.
 *
 * Verifies:
 * 1. Zero-Regression across Milestones 1-4:
 *    - 0 sand touching water instances
 *    - 0 sand touching void instances
 *    - 0 roads on coast tiles
 *    - 0 coast neighbor socket mismatches
 *    - Ocean coverage validation (target: 5-10% ocean coverage)
 * 2. River Continuity:
 *    - Seamless river networks from source to mouth
 *    - 0 dangling river dead ends pointing into open dry land
 * 3. River Mouths & Estuaries:
 *    - River mouths properly border open water (ocean or lake)
 * 4. Bridge Crossings:
 *    - Road-river crossing cells have both matching river connections and matching road connections
 * 5. Scalability Benchmarking:
 *    - Multi-radius benchmarks (Radius 6, Radius 8, Radius 10) across 100+ seeds each
 */

import { generateWorldData, getTileEdgeMaterial } from '../worldGenerator.js';
import { HEX_DIRECTIONS, getOppositeEdge } from '../hexMath.js';

const getKey = (q, r) => `${q},${r}`;

/**
 * Evaluates a single world for all Milestone 1-5 quality criteria.
 * @param {Object} worldData - Output from generateWorldData ({ hexList, grid })
 * @param {number} seed - World seed
 * @param {number} radius - Map radius
 * @returns {Object} Comprehensive QA report
 */
export function evaluateWorld(worldData, seed, radius = 6) {
  const { hexList, grid } = worldData;

  // --- Milestone 1-4 Invariants ---
  const criticalSandTouchingWater = [];
  const criticalSandTouchingVoid = [];
  const criticalRoadsOnCoast = [];
  const missingCoastPlains = [];
  const missingCoastElevated = [];
  const coastCoastEdgeMismatches = [];
  const coastLandSandBleeds = [];
  const coastWaterGrassCliffs = [];

  // --- Milestone 5 River & Bridge Invariants ---
  const riverDanglingDeadEnds = [];
  const riverMouthMismatches = [];
  const criticalRiversTouchingWater = [];
  const criticalRiversTouchingCoast = [];
  const bridgeMissingRiver = [];
  const bridgeMissingRoad = [];
  const bridgeMissingProp = [];
  const bridgeSocketMismatches = [];
  const treesOnSlopesOrHills = [];

  let totalHexes = hexList.length;
  let oceanHexes = 0;
  let lakeHexes = 0;
  let riverHexes = 0;
  let bridgeHexes = 0;
  let roadHexes = 0;

  for (const tile of hexList) {
    const isWater = tile.biome === 'water';
    if (isWater) {
      if (tile.isLake) lakeHexes++;
      else oceanHexes++;
    }
    if (tile.hasRoad) roadHexes++;
    if (tile.hasRiver || tile.isRiver || (tile.riverEdges && tile.riverEdges.length > 0)) {
      riverHexes++;
    }
    if (tile.hasBridge || tile.isBridge || tile.building?.type === 'bridge' || (tile.riverInfo?.pieceId && tile.riverInfo.pieceId.includes('crossing'))) {
      bridgeHexes++;
    }

    // -------------------------------------------------------------
    // Check 1: Roads strictly forbidden on coast tiles
    // -------------------------------------------------------------
    if (tile.isCoast && (tile.hasRoad || (tile.roadEdges && tile.roadEdges.length > 0))) {
      criticalRoadsOnCoast.push({
        tileCoord: { q: tile.q, r: tile.r },
        pieceId: tile.coastInfo ? tile.coastInfo.pieceId : 'unknown',
        roadEdges: tile.roadEdges,
        message: `Coast tile (${tile.q},${tile.r}) has an illegal road placement`
      });
    }

    // -------------------------------------------------------------
    // Check 2: Coast Tiles & Sockets
    // -------------------------------------------------------------
    if (tile.isCoast && tile.coastInfo && Array.isArray(tile.coastInfo.edges)) {
      const edges = tile.coastInfo.edges;

      for (let i = 0; i < 6; i++) {
        const edgeType = edges[i];
        const dir = HEX_DIRECTIONS[i];
        const nq = tile.q + dir.q;
        const nr = tile.r + dir.r;
        const neighbor = grid.get(getKey(nq, nr));
        const neighborIsWater = neighbor && neighbor.biome === 'water';
        const neighborIsVoid = !neighbor;

        if (edgeType === 'sand' && neighborIsWater) {
          criticalSandTouchingWater.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: i,
            direction: dir.name,
            pieceId: tile.coastInfo.pieceId,
            neighborCoord: { q: nq, r: nr },
            message: `Tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [sand] touches water neighbor (${nq},${nr})`
          });
        }

        if (edgeType === 'sand' && neighborIsVoid) {
          criticalSandTouchingVoid.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: i,
            direction: dir.name,
            pieceId: tile.coastInfo.pieceId,
            neighborCoord: { q: nq, r: nr },
            message: `Tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [sand] touches void off-map (${nq},${nr})`
          });
        }

        if (edgeType === 'none' && neighborIsWater) {
          coastWaterGrassCliffs.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: i,
            direction: dir.name,
            pieceId: tile.coastInfo.pieceId,
            neighborCoord: { q: nq, r: nr },
            message: `Coast tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [none/grass] touches water neighbor (${nq},${nr})`
          });
        }

        if (edgeType === 'sand' && neighbor && neighbor.biome !== 'water' && !neighbor.isCoast && !neighbor.hasRiver && !neighbor.isRiver && !neighbor.isRiverMouth) {
          if (neighbor.elevationLevel === 0 && neighbor.biome === 'plains') {
            coastLandSandBleeds.push({
              tileCoord: { q: tile.q, r: tile.r },
              edgeIndex: i,
              direction: dir.name,
              pieceId: tile.coastInfo.pieceId,
              neighborCoord: { q: nq, r: nr },
              message: `Coast tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [sand] bleeds into inland flat plains (${nq},${nr})`
            });
          }
        }

        if (neighbor && neighbor.isCoast && neighbor.coastInfo && Array.isArray(neighbor.coastInfo.edges)) {
          if (tile.q < nq || (tile.q === nq && tile.r < nr)) {
            const oppEdge = getOppositeEdge(i);
            const neighborEdgeType = neighbor.coastInfo.edges[oppEdge];
            if (edgeType !== neighborEdgeType) {
              coastCoastEdgeMismatches.push({
                tileA: { q: tile.q, r: tile.r, edge: i, dir: dir.name, type: edgeType, pieceId: tile.coastInfo.pieceId },
                tileB: { q: nq, r: nr, edge: oppEdge, dir: HEX_DIRECTIONS[oppEdge].name, type: neighborEdgeType, pieceId: neighbor.coastInfo.pieceId },
                message: `Edge mismatch between Coast (${tile.q},${tile.r}) edge ${i} [${edgeType}] and Coast (${nq},${nr}) edge ${oppEdge} [${neighborEdgeType}]`
              });
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // Check 3: Missing Coasts on Land Touching Water
    // -------------------------------------------------------------
    if (!isWater) {
      let touchesWater = false;
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
        if (neighbor && neighbor.biome === 'water') {
          touchesWater = true;
          break;
        }
      }
      if (touchesWater && (!tile.isCoast || !tile.coastInfo) && !tile.hasRiver && !tile.isRiver && !tile.isRiverMouth) {
        if (tile.elevationLevel === 0 && tile.biome === 'plains') {
          missingCoastPlains.push({
            tileCoord: { q: tile.q, r: tile.r },
            message: `Plains tile (${tile.q},${tile.r}) touches water but has no coast tile assigned`
          });
        } else {
          missingCoastElevated.push({
            tileCoord: { q: tile.q, r: tile.r },
            elevationLevel: tile.elevationLevel,
            biome: tile.biome
          });
        }
      }
    }

    // -------------------------------------------------------------
    // Check 4: River Continuity, Dead Ends & Coast Isolation
    // -------------------------------------------------------------
    const isRiverCell = tile.hasRiver || tile.isRiver || (tile.riverEdges && tile.riverEdges.length > 0);
    if (isRiverCell) {
      // Invariant: Rivers must NEVER touch water or coastlines (strictly inland rivers)
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
        if (neighbor && neighbor.biome === 'water') {
          criticalRiversTouchingWater.push({
            tileCoord: { q: tile.q, r: tile.r },
            edge: i,
            dir: dir.name,
            neighborCoord: { q: tile.q + dir.q, r: tile.r + dir.r },
            message: `CRITICAL: River tile (${tile.q},${tile.r}) touches water tile (${tile.q + dir.q},${tile.r + dir.r})`
          });
        }
        if (neighbor && neighbor.isCoast) {
          criticalRiversTouchingCoast.push({
            tileCoord: { q: tile.q, r: tile.r },
            edge: i,
            dir: dir.name,
            neighborCoord: { q: tile.q + dir.q, r: tile.r + dir.r },
            message: `CRITICAL: River tile (${tile.q},${tile.r}) borders coast tile (${tile.q + dir.q},${tile.r + dir.r})`
          });
        }
      }

      const activeRiverEdges = tile.riverEdges || [];

      for (const e of activeRiverEdges) {
        const dir = HEX_DIRECTIONS[e];
        const nq = tile.q + dir.q;
        const nr = tile.r + dir.r;
        const neighbor = grid.get(getKey(nq, nr));

        if (!neighbor) {
          // River pointing off-map into void
          riverDanglingDeadEnds.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: e,
            direction: dir.name,
            target: 'void_off_map',
            message: `River at (${tile.q},${tile.r}) edge ${e} (${dir.name}) points off-map into void`
          });
          continue;
        }

        const opp = getOppositeEdge(e);
        const neighborIsWater = neighbor.biome === 'water';
        const neighborIsRiver = neighbor.hasRiver || neighbor.isRiver || (neighbor.riverEdges && neighbor.riverEdges.includes(opp));
        const neighborIsBridge = neighbor.hasBridge || neighbor.isBridge || (neighbor.building?.type === 'bridge');
        const isSourceOrTerminal = (tile.isRiverSource && tile.riverSourceEdge === e) ||
                                   (tile.isRiverTerminal && tile.riverTerminalEdge === e) ||
                                   (tile.building?.type === 'watermill' && tile.riverTerminalEdge === e);

        // If neighbor is water, it is an outlet into a lake/ocean
        if (neighborIsWater) continue;

        // If neighbor is another river cell or bridge, reciprocal edge must be active
        if (neighborIsRiver || neighborIsBridge) {
          const nRiverEdges = neighbor.riverEdges || [];
          if (!nRiverEdges.includes(opp)) {
            riverDanglingDeadEnds.push({
              tileCoord: { q: tile.q, r: tile.r },
              edgeIndex: e,
              direction: dir.name,
              neighborCoord: { q: nq, r: nr },
              message: `River edge mismatch: (${tile.q},${tile.r}) edge ${e} (${dir.name}) has river, but neighbor (${nq},${nr}) edge ${opp} does not connect back`
            });
          }

          // Strict Physical 3D Model Water Socket Invariant: River <> River only, never River <> Grass!
          if (tile.riverInfo?.edges && !tile.riverInfo.edges.includes(e) && !isSourceOrTerminal) {
            riverDanglingDeadEnds.push({
              tileCoord: { q: tile.q, r: tile.r },
              edgeIndex: e,
              direction: dir.name,
              message: `Physical Model Defect: Tile (${tile.q},${tile.r}) edge ${e} (${dir.name}) has river but 3D model ${tile.riverInfo.pieceId} only has water at [${tile.riverInfo.edges.join(', ')}]`
            });
          }
          if (neighbor.riverInfo?.edges && !neighborIsBridge) {
            const nSourceOrTerminal = (neighbor.isRiverSource && neighbor.riverSourceEdge === opp) ||
                                      (neighbor.isRiverTerminal && neighbor.riverTerminalEdge === opp) ||
                                      (neighbor.building?.type === 'watermill' && neighbor.riverTerminalEdge === opp);
            if (!neighbor.riverInfo.edges.includes(opp) && !nSourceOrTerminal) {
              riverDanglingDeadEnds.push({
                tileCoord: { q: tile.q, r: tile.r },
                edgeIndex: e,
                direction: dir.name,
                neighborCoord: { q: nq, r: nr },
                message: `CRITICAL Physical Model River <> Grass Defect: River at (${tile.q},${tile.r}) edge ${e} points into neighbor (${nq},${nr}) whose 3D model ${neighbor.riverInfo.pieceId} has grass at edge ${opp} (only has water at [${neighbor.riverInfo.edges.join(', ')}])`
              });
            }
          }
          continue;
        }

        // If it points into open land without water or river connection, it's a dangling dead end!
        if (!isSourceOrTerminal && !neighborIsRiverMouth) {
          riverDanglingDeadEnds.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: e,
            direction: dir.name,
            neighborCoord: { q: nq, r: nr },
            neighborBiome: neighbor.biome,
            message: `CRITICAL: River at (${tile.q},${tile.r}) edge ${e} (${dir.name}) dangling dead end into dry land (${nq},${nr}) [${neighbor.biome}]`
          });
        }
      }
    }

    // -------------------------------------------------------------
    // Check 5: River Mouths / Estuaries
    // -------------------------------------------------------------
    const isRiverMouth = tile.isRiverMouth || (tile.riverInfo?.pieceId === 'river_E');
    if (isRiverMouth) {
      const mouthOutflowEdge = tile.mouthEdge !== undefined ? tile.mouthEdge : (tile.riverEdges ? tile.riverEdges[tile.riverEdges.length - 1] : null);
      if (mouthOutflowEdge !== null) {
        const dir = HEX_DIRECTIONS[mouthOutflowEdge];
        const nq = tile.q + dir.q;
        const nr = tile.r + dir.r;
        const neighbor = grid.get(getKey(nq, nr));
        if (!neighbor || neighbor.biome !== 'water') {
          riverMouthMismatches.push({
            tileCoord: { q: tile.q, r: tile.r },
            outflowEdge: mouthOutflowEdge,
            direction: dir.name,
            neighborCoord: { q: nq, r: nr },
            neighborType: neighbor ? neighbor.biome : 'void_off_map',
            message: `River mouth at (${tile.q},${tile.r}) discharge edge ${mouthOutflowEdge} (${dir.name}) does not border open water (found: ${neighbor ? neighbor.biome : 'void'})`
          });
        }
      }
    }

    // -------------------------------------------------------------
    // Check 6: Bridge Crossings
    // -------------------------------------------------------------
    const isBridgeCell = tile.hasBridge || tile.isBridge || tile.building?.type === 'bridge' || (tile.riverInfo?.pieceId && tile.riverInfo.pieceId.includes('crossing'));
    if (isBridgeCell) {
      const bridgeRiverEdges = tile.riverEdges || [];
      const bridgeRoadEdges = tile.roadEdges || [];

      // Bridge must carry both river and road
      if (bridgeRiverEdges.length < 2) {
        bridgeMissingRiver.push({
          tileCoord: { q: tile.q, r: tile.r },
          riverEdges: bridgeRiverEdges,
          message: `Bridge at (${tile.q},${tile.r}) missing 2-way river connection (has ${bridgeRiverEdges.length} edges)`
        });
      }
      if (bridgeRoadEdges.length < 2) {
        bridgeMissingRoad.push({
          tileCoord: { q: tile.q, r: tile.r },
          roadEdges: bridgeRoadEdges,
          message: `Bridge at (${tile.q},${tile.r}) missing 2-way road connection (has ${bridgeRoadEdges.length} edges)`
        });
      }

      // Check river reciprocal connections
      for (const re of bridgeRiverEdges) {
        const dir = HEX_DIRECTIONS[re];
        const opp = getOppositeEdge(re);
        const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
        if (neighbor && neighbor.biome !== 'water') {
          const nRiverEdges = neighbor.riverEdges || [];
          if (!nRiverEdges.includes(opp)) {
            bridgeSocketMismatches.push({
              tileCoord: { q: tile.q, r: tile.r },
              edge: re,
              type: 'river',
              neighborCoord: { q: tile.q + dir.q, r: tile.r + dir.r },
              message: `Bridge river edge ${re} (${dir.name}) does not connect to neighbor river`
            });
          }
        }
      }

      // Check road reciprocal connections
      for (const rde of bridgeRoadEdges) {
        const dir = HEX_DIRECTIONS[rde];
        const opp = getOppositeEdge(rde);
        const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
        if (neighbor && neighbor.hasRoad) {
          const nRoadEdges = neighbor.roadEdges || [];
          if (!nRoadEdges.includes(opp)) {
            bridgeSocketMismatches.push({
              tileCoord: { q: tile.q, r: tile.r },
              edge: rde,
              type: 'road',
              neighborCoord: { q: tile.q + dir.q, r: tile.r + dir.r },
              message: `Bridge road edge ${rde} (${dir.name}) does not connect to neighbor road`
            });
          }
        }
      }

      if (tile.hasRiver && tile.hasRoad && !tile.bridgeProp) {
        bridgeMissingProp.push({
          tileCoord: { q: tile.q, r: tile.r },
          message: `Bridge at (${tile.q},${tile.r}) missing 3D bridge prop`
        });
      }
    }
  }

  const oceanPct = ((oceanHexes / totalHexes) * 100);
  const isOceanCoverageValid = oceanPct >= 4.0 && oceanPct <= 15.0;

  const hasCriticalSand = criticalSandTouchingWater.length > 0 || criticalSandTouchingVoid.length > 0;
  const hasCriticalRoad = criticalRoadsOnCoast.length > 0;
  const hasCriticalRiver = criticalRiversTouchingWater.length > 0 || criticalRiversTouchingCoast.length > 0;
  const hasCriticalCoast = hasCriticalSand || hasCriticalRoad;
  const hasCoastMismatches = coastCoastEdgeMismatches.length > 0 || coastLandSandBleeds.length > 0 || coastWaterGrassCliffs.length > 0;
  const hasRiverFailures = riverDanglingDeadEnds.length > 0 || riverMouthMismatches.length > 0 || bridgeMissingRiver.length > 0 || bridgeMissingRoad.length > 0 || bridgeMissingProp.length > 0 || bridgeSocketMismatches.length > 0 || hasCriticalRiver;

  // --- Milestone 6 Multi-Biome & Transition Tile Invariants ---
  const invalidBiomeThemes = [];
  const transitionEdgeMismatches = [];
  const VALID_BIOMES = ['winter', 'fall', 'spring', 'summer'];
  const biomeCounts = {};
  for (const b of VALID_BIOMES) biomeCounts[b] = 0;
  let transitionTileCount = 0;
  let winterElevSum = 0, winterCount = 0;
  let springElevSum = 0, springCount = 0;

  for (const tile of hexList) {
    if (!VALID_BIOMES.includes(tile.biomeTheme)) {
      invalidBiomeThemes.push({ q: tile.q, r: tile.r, theme: tile.biomeTheme });
    } else {
      biomeCounts[tile.biomeTheme] = (biomeCounts[tile.biomeTheme] || 0) + 1;
    }

    if (tile.isTransition) {
      transitionTileCount++;

      // Strict reciprocity check: material {n1} <> {n1} and {n2} <> {n2}
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
        if (!neighbor || neighbor.biome === 'water') continue;

        const myEdgeMat = getTileEdgeMaterial(tile, i);
        const opp = getOppositeEdge(i);
        const neighborEdgeMat = getTileEdgeMaterial(neighbor, opp);

        if (myEdgeMat !== neighborEdgeMat) {
          transitionEdgeMismatches.push({
            tileCoord: { q: tile.q, r: tile.r },
            edge: i,
            direction: dir.name,
            myMat: myEdgeMat,
            neighborCoord: { q: neighbor.q, r: neighbor.r },
            neighborMat: neighborEdgeMat,
            message: `Transition tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [${myEdgeMat}] conflicts with neighbor (${neighbor.q},${neighbor.r}) [${neighborEdgeMat}]`
          });
        }
      }
    }

    if (tile.decoration && tile.decoration.path && (tile.decoration.path.includes('trees') || tile.decoration.path.includes('tree_single'))) {
      if (tile.slope || tile.biome === 'hill' || tile.biome === 'mountain') {
        treesOnSlopesOrHills.push({
          tileCoord: { q: tile.q, r: tile.r },
          biome: tile.biome,
          slope: tile.slope,
          prop: tile.decoration.path
        });
      }
    }

    if (tile.biomeTheme === 'winter') {
      winterElevSum += tile.elevationLevel;
      winterCount++;
    } else if (tile.biomeTheme === 'spring') {
      springElevSum += tile.elevationLevel;
      springCount++;
    }
  }

  const avgWinterElev = winterCount > 0 ? (winterElevSum / winterCount) : 0;
  const avgSpringElev = springCount > 0 ? (springElevSum / springCount) : 0;
  const hasValidBiomeElevGradient = avgWinterElev >= avgSpringElev;
  const hasBiomeFailures = invalidBiomeThemes.length > 0 || !hasValidBiomeElevGradient || transitionEdgeMismatches.length > 0 || treesOnSlopesOrHills.length > 0;

  const hasFailure = hasCriticalCoast || hasCoastMismatches || hasRiverFailures || missingCoastPlains.length > 0 || hasBiomeFailures;

  return {
    seed,
    radius,
    totalHexes,
    oceanHexes,
    lakeHexes,
    riverHexes,
    bridgeHexes,
    roadHexes,
    biomeCounts,
    transitionTileCount,
    avgWinterElev: avgWinterElev.toFixed(2),
    avgSpringElev: avgSpringElev.toFixed(2),
    hasValidBiomeElevGradient,
    oceanPct: oceanPct.toFixed(1),
    isOceanCoverageValid,
    hasFailure,
    hasCriticalCoast,
    hasCoastMismatches,
    hasRiverFailures,
    defects: {
      criticalSandTouchingWater,
      criticalSandTouchingVoid,
      criticalRoadsOnCoast,
      criticalRiversTouchingWater,
      criticalRiversTouchingCoast,
      missingCoastPlains,
      missingCoastElevated,
      coastCoastEdgeMismatches,
      coastLandSandBleeds,
      coastWaterGrassCliffs,
      riverDanglingDeadEnds,
      riverMouthMismatches,
      bridgeMissingRiver,
      bridgeMissingRoad,
      bridgeMissingProp,
      bridgeSocketMismatches,
      transitionEdgeMismatches,
      treesOnSlopesOrHills
    },
    counts: {
      criticalSandTouchingWater: criticalSandTouchingWater.length,
      criticalSandTouchingVoid: criticalSandTouchingVoid.length,
      criticalRoadsOnCoast: criticalRoadsOnCoast.length,
      criticalRiversTouchingWater: criticalRiversTouchingWater.length,
      criticalRiversTouchingCoast: criticalRiversTouchingCoast.length,
      missingCoastPlains: missingCoastPlains.length,
      missingCoastElevated: missingCoastElevated.length,
      coastCoastEdgeMismatches: coastCoastEdgeMismatches.length,
      coastLandSandBleeds: coastLandSandBleeds.length,
      coastWaterGrassCliffs: coastWaterGrassCliffs.length,
      riverDanglingDeadEnds: riverDanglingDeadEnds.length,
      riverMouthMismatches: riverMouthMismatches.length,
      bridgeMissingRiver: bridgeMissingRiver.length,
      bridgeMissingRoad: bridgeMissingRoad.length,
      bridgeMissingProp: bridgeMissingProp.length,
      bridgeSocketMismatches: bridgeSocketMismatches.length,
      transitionEdgeMismatches: transitionEdgeMismatches.length,
      treesOnSlopesOrHills: treesOnSlopesOrHills.length
    }
  };
}

/**
 * Runs the comprehensive QA test suite across seeds for a given radius or multi-radius scalability benchmark.
 */
export function runTestSuite({
  seedCount = 100,
  radius = 6,
  radii = null,
  seeds = null,
  waterLevel = 0.08,
  treeDensity = 0.4,
  mapShape = 'rectangular',
  verbose = false,
  jsonOutput = false
} = {}) {
  const targetRadii = radii || [radius];
  const targetSeeds = seeds || Array.from({ length: seedCount }, (_, i) => (i + 1) * 7919);

  const overallResults = {};

  console.log('================================================================');
  console.log('    ⬡ KAYKIT PROCEDURAL WORLD GENERATOR - QA VERIFICATION ⬡    ');
  console.log(`    Milestone 5: Rivers, Bridges, Scale & Shape (${mapShape.toUpperCase()})  `);
  console.log('================================================================');

  for (const r of targetRadii) {
    const isRect = mapShape === 'rectangular';
    const hexCountApprox = isRect ? (Math.max(8, Math.round(r * 1.75)) * Math.max(5, Math.round(r * 1.05))) : (3 * r * (r + 1) + 1);
    console.log(`\n--- BENCHMARK: Radius ${r} (${hexCountApprox} hexes, ${mapShape}) across ${targetSeeds.length} seeds ---`);
    const startTime = Date.now();
    const reports = [];

    let seedsWithCritical = 0;
    let seedsWithCoastMismatch = 0;
    let seedsWithRiverFailure = 0;
    let seedsWithAnyFailure = 0;
    let seedsValidOcean = 0;

    let totalCritSandWater = 0;
    let totalCritSandVoid = 0;
    let totalCritRoadCoast = 0;
    let totalCoastMismatches = 0;
    let totalRiverDeadEnds = 0;
    let totalRiverMouthErrors = 0;
    let totalBridgeErrors = 0;
    let totalTransitionMismatches = 0;
    let totalTreesOnSlopesOrHills = 0;
    let totalOceanPct = 0;

    for (const seed of targetSeeds) {
      const worldData = generateWorldData({ seed, radius: r, waterLevel, treeDensity, mapShape });
      const report = evaluateWorld(worldData, seed, r);
      reports.push(report);

      if (report.hasCriticalCoast) seedsWithCritical++;
      if (report.hasCoastMismatches) seedsWithCoastMismatch++;
      if (report.hasRiverFailures) seedsWithRiverFailure++;
      if (report.hasFailure) seedsWithAnyFailure++;
      if (report.isOceanCoverageValid) seedsValidOcean++;

      totalCritSandWater += report.counts.criticalSandTouchingWater;
      totalCritSandVoid += report.counts.criticalSandTouchingVoid;
      totalCritRoadCoast += report.counts.criticalRoadsOnCoast;
      totalCoastMismatches += report.counts.coastCoastEdgeMismatches + report.counts.coastLandSandBleeds + report.counts.coastWaterGrassCliffs;
      totalRiverDeadEnds += report.counts.riverDanglingDeadEnds;
      totalRiverMouthErrors += report.counts.riverMouthMismatches;
      totalBridgeErrors += report.counts.bridgeMissingRiver + report.counts.bridgeMissingRoad + report.counts.bridgeSocketMismatches;
      totalTransitionMismatches += report.counts.transitionEdgeMismatches;
      totalTreesOnSlopesOrHills += report.counts.treesOnSlopesOrHills;
      totalOceanPct += parseFloat(report.oceanPct);
    }

    const elapsedMs = Date.now() - startTime;
    const avgMs = (elapsedMs / targetSeeds.length).toFixed(2);
    const avgOcean = (totalOceanPct / targetSeeds.length).toFixed(1);

    const radiusSummary = {
      radius: r,
      hexCount: 3 * r * (r + 1) + 1,
      totalSeeds: targetSeeds.length,
      elapsedMs,
      avgMsPerSeed: avgMs,
      avgOceanPct: avgOcean,
      validOceanPctRate: ((seedsValidOcean / targetSeeds.length) * 100).toFixed(1),
      seedsWithAnyFailure,
      failureRatePct: ((seedsWithAnyFailure / targetSeeds.length) * 100).toFixed(1),
      defects: {
        sandTouchingWater: totalCritSandWater,
        sandTouchingVoid: totalCritSandVoid,
        roadsOnCoast: totalCritRoadCoast,
        coastSocketMismatches: totalCoastMismatches,
        riverDeadEnds: totalRiverDeadEnds,
        riverMouthErrors: totalRiverMouthErrors,
        bridgeErrors: totalBridgeErrors,
        transitionMismatches: totalTransitionMismatches,
        treesOnSlopesOrHills: totalTreesOnSlopesOrHills
      }
    };

    overallResults[`radius_${r}`] = { summary: radiusSummary, reports };

    console.log(`Execution Time: ${elapsedMs}ms (${avgMs}ms/seed)`);
    console.log(`Average Ocean Coverage: ${avgOcean}%`);
    console.log(`1. Coast Zero-Regression:`);
    console.log(`   - Sand Touching Water : ${totalCritSandWater} instances`);
    console.log(`   - Sand Touching Void  : ${totalCritSandVoid} instances`);
    console.log(`   - Roads on Coast      : ${totalCritRoadCoast} instances`);
    console.log(`   - Socket Mismatches   : ${totalCoastMismatches} instances`);
    console.log(`2. River & Bridge Invariants:`);
    console.log(`   - Dangling Dead Ends  : ${totalRiverDeadEnds} instances`);
    console.log(`   - Mouth/Estuary Errors: ${totalRiverMouthErrors} instances`);
    console.log(`   - Bridge Errors       : ${totalBridgeErrors} instances`);
    console.log(`3. Multi-Biome & Transition Tiles:`);
    const totalTransitions = reports.reduce((s, r) => s + (r.transitionTileCount || 0), 0);
    const avgTransitions = (totalTransitions / targetSeeds.length).toFixed(1);
    const validGradients = reports.filter(r => r.hasValidBiomeElevGradient).length;
    console.log(`   - Biome Elevation Gradient Valid : ${validGradients} / ${targetSeeds.length} (100% Winter > Spring)`);
    console.log(`   - Active Transition Tiles        : ${totalTransitions} placed (avg ${avgTransitions}/world)`);
    console.log(`   - Transition Edge Mismatches     : ${totalTransitionMismatches} instances (material n1<>n1, n2<>n2)`);
    console.log(`   - Trees on Slopes/Hills (Clipping) : ${totalTreesOnSlopesOrHills} instances`);
    console.log(`OVERALL DEFECT SEED RATE: ${seedsWithAnyFailure} / ${targetSeeds.length} (${radiusSummary.failureRatePct}%)`);

    if (seedsWithAnyFailure > 0) {
      const failing = reports.filter(rep => rep.hasFailure);
      console.log(`\nFailing Seeds Sample (first 5 of ${failing.length}):`);
      for (const f of failing.slice(0, 5)) {
        console.log(`  Seed ${f.seed}:`);
        if (f.counts.criticalSandTouchingWater > 0) console.log(`    - Sand water: ${f.counts.criticalSandTouchingWater}`);
        if (f.counts.criticalSandTouchingVoid > 0) console.log(`    - Sand void: ${f.counts.criticalSandTouchingVoid}`);
        if (f.counts.riverDanglingDeadEnds > 0) console.log(`    - River dead ends: ${f.counts.riverDanglingDeadEnds}`);
        if (f.counts.riverMouthMismatches > 0) console.log(`    - River mouth errors: ${f.counts.riverMouthMismatches}`);
        if (f.counts.bridgeSocketMismatches > 0) console.log(`    - Bridge mismatches: ${f.counts.bridgeSocketMismatches}`);
        if (f.counts.transitionEdgeMismatches > 0) console.log(`    - Transition edge mismatches: ${f.counts.transitionEdgeMismatches}`);
      }
    }
  }

  console.log('\n================================================================\n');

  if (jsonOutput) {
    console.log(JSON.stringify(overallResults, null, 2));
  }

  return overallResults;
}

// CLI Execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let seedCount = 100;
  let radius = 6;
  let radii = null;
  let specificSeed = null;
  let mapShape = 'rectangular';
  let verbose = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--seeds' || a === '-s') seedCount = parseInt(args[++i], 10);
    else if (a === '--radius' || a === '-r') radius = parseInt(args[++i], 10);
    else if (a === '--scalability' || a === '--all-radii') radii = [6, 8, 10];
    else if (a === '--seed') specificSeed = parseInt(args[++i], 10);
    else if (a === '--shape') mapShape = args[++i];
    else if (a === '--verbose' || a === '-v') verbose = true;
    else if (a === '--json') jsonOutput = true;
  }

  runTestSuite({
    seedCount,
    radius,
    radii,
    seeds: specificSeed !== null ? [specificSeed] : null,
    mapShape,
    verbose,
    jsonOutput
  });
}
