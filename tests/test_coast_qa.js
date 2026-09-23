#!/usr/bin/env node
/**
 * test_coast_qa.js
 * Automated Headless QA Test Suite for KayKit Hex World Generator.
 *
 * Evaluates world generator outputs across random seeds without a browser.
 * Verifies tile socket compatibility and coastline transitions:
 * 1. Sand Edge touching Water Neighbor (CRITICAL FAILURE)
 * 2. Land Tile touching Water without Coast Tile (Bare grass cliff into ocean)
 * 3. Adjacent Neighbor Edge Mismatches (e.g. sand meeting grass)
 */

import { generateWorldData } from '../worldGenerator.js';
import { HEX_DIRECTIONS, getOppositeEdge } from '../hexMath.js';

const getKey = (q, r) => `${q},${r}`;

/**
 * Evaluates a generated world for coast and edge defects.
 * @param {Object} worldData - Output from generateWorldData ({ hexList, grid })
 * @param {number} seed - World seed
 * @returns {Object} QA report for this seed
 */
export function evaluateWorld(worldData, seed) {
  const { hexList, grid } = worldData;

  const criticalSandTouchingWater = [];
  const criticalRoadsOnCoast = [];
  const missingCoastPlains = [];
  const missingCoastElevated = [];
  const coastCoastEdgeMismatches = [];
  const coastLandSandBleeds = [];
  const coastWaterGrassCliffs = [];

  for (const tile of hexList) {
    const isLand = tile.biome !== 'water';

    // -------------------------------------------------------------
    // Check 0: Roads strictly forbidden on coast tiles
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
    // Check 1 & 3: Placed Coast Tiles
    // -------------------------------------------------------------
    if (tile.isCoast && tile.coastInfo && Array.isArray(tile.coastInfo.edges)) {
      const edges = tile.coastInfo.edges;

      for (let i = 0; i < 6; i++) {
        const edgeType = edges[i];
        const dir = HEX_DIRECTIONS[i];
        const nq = tile.q + dir.q;
        const nr = tile.r + dir.r;
        const nKey = getKey(nq, nr);
        const neighbor = grid.get(nKey);
        const neighborIsWater = neighbor && neighbor.biome === 'water';
        const neighborIsVoid = !neighbor;

        // Check 1: CRITICAL - Sand edge touching water neighbor or void
        if (edgeType === 'sand' && (neighborIsWater || neighborIsVoid)) {
          criticalSandTouchingWater.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: i,
            direction: dir.name,
            pieceId: tile.coastInfo.pieceId,
            rotationStep: tile.coastInfo.rotationStep,
            neighborCoord: { q: nq, r: nr },
            neighborType: neighbor ? neighbor.biome : 'void_off_map',
            message: `Tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [sand] touches ${neighbor ? 'water' : 'void'} neighbor (${nq},${nr})`
          });
        }

        // Check 3b: Grass cliff facing ocean (coast tile edge is 'none', but neighbor is water)
        if (edgeType === 'none' && neighborIsWater) {
          coastWaterGrassCliffs.push({
            tileCoord: { q: tile.q, r: tile.r },
            edgeIndex: i,
            direction: dir.name,
            pieceId: tile.coastInfo.pieceId,
            neighborCoord: { q: nq, r: nr },
            message: `Coast tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [none/grass] touches water neighbor (${nq},${nr}) without beach/cliff transition`
          });
        }

        // Check 3c: Sand edge bleeding into flat inland plains
        if (edgeType === 'sand' && neighbor && neighbor.biome !== 'water' && !neighbor.isCoast && !neighbor.hasRiver && !neighbor.isRiver && !neighbor.isRiverMouth) {
          // Hills/elevated terrain bordering coast are acceptable per user invariant
          if (neighbor.elevationLevel === 0 && neighbor.biome === 'plains') {
            coastLandSandBleeds.push({
              tileCoord: { q: tile.q, r: tile.r },
              edgeIndex: i,
              direction: dir.name,
              pieceId: tile.coastInfo.pieceId,
              neighborCoord: { q: nq, r: nr },
              neighborBiome: neighbor.biome,
              message: `Coast tile (${tile.q},${tile.r}) edge ${i} (${dir.name}) [sand] bleeds into inland flat plains (${nq},${nr})`
            });
          }
        }

        // Check 3a: Adjacent Coast-Coast edge socket compatibility
        if (neighbor && neighbor.isCoast && neighbor.coastInfo && Array.isArray(neighbor.coastInfo.edges)) {
          // Check each undirected edge pair once (tile.q < nq or tiebreaker)
          if (tile.q < nq || (tile.q === nq && tile.r < nr)) {
            const oppEdge = getOppositeEdge(i);
            const neighborEdgeType = neighbor.coastInfo.edges[oppEdge];
            if (edgeType !== neighborEdgeType) {
              coastCoastEdgeMismatches.push({
                tileA: { q: tile.q, r: tile.r, edge: i, dir: dir.name, type: edgeType, pieceId: tile.coastInfo.pieceId },
                tileB: { q: nq, r: nr, edge: oppEdge, dir: HEX_DIRECTIONS[oppEdge].name, type: neighborEdgeType, pieceId: neighbor.coastInfo.pieceId },
                message: `Edge mismatch between Coast (${tile.q},${tile.r}) edge ${i} (${dir.name}) [${edgeType}] and Coast (${nq},${nr}) edge ${oppEdge} (${HEX_DIRECTIONS[oppEdge].name}) [${neighborEdgeType}]`
              });
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // Check 2: Land tile touching water that does not have coast tile
    // -------------------------------------------------------------
    if (isLand) {
      let touchesWater = false;
      const waterNeighbors = [];

      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nKey = getKey(tile.q + dir.q, tile.r + dir.r);
        const neighbor = grid.get(nKey);
        if (neighbor && neighbor.biome === 'water') {
          touchesWater = true;
          waterNeighbors.push({ edge: i, dir: dir.name, q: tile.q + dir.q, r: tile.r + dir.r });
        }
      }

      if (touchesWater && (!tile.isCoast || !tile.coastInfo) && !tile.hasRiver && !tile.isRiver && !tile.isRiverMouth) {
        if (tile.elevationLevel === 0 && tile.biome === 'plains') {
          missingCoastPlains.push({
            tileCoord: { q: tile.q, r: tile.r },
            biome: tile.biome,
            elevationLevel: tile.elevationLevel,
            waterNeighbors,
            message: `Plains tile (${tile.q},${tile.r}) touches water but has no coast tile assigned (rendered as bare grass cliff)`
          });
        } else {
          missingCoastElevated.push({
            tileCoord: { q: tile.q, r: tile.r },
            biome: tile.biome,
            elevationLevel: tile.elevationLevel,
            waterNeighbors,
            message: `Elevated land (${tile.biome}) tile (${tile.q},${tile.r}) at elevation ${tile.elevationLevel} borders ocean`
          });
        }
      }
    }
  }

  const hasCriticalSand = criticalSandTouchingWater.length > 0;
  const hasCriticalRoad = criticalRoadsOnCoast.length > 0;
  const hasCritical = hasCriticalSand || hasCriticalRoad;
  const hasMissingCoast = missingCoastPlains.length > 0;
  const hasMismatches = coastCoastEdgeMismatches.length > 0 || coastLandSandBleeds.length > 0 || coastWaterGrassCliffs.length > 0;
  const hasFailure = hasCritical || hasMissingCoast || hasMismatches;

  return {
    seed,
    hasFailure,
    hasCritical,
    hasCriticalSand,
    hasCriticalRoad,
    hasMissingCoast,
    hasMismatches,
    criticalSandTouchingWater,
    criticalRoadsOnCoast,
    missingCoastPlains,
    missingCoastElevated,
    coastCoastEdgeMismatches,
    coastLandSandBleeds,
    coastWaterGrassCliffs,
    counts: {
      criticalSandTouchingWater: criticalSandTouchingWater.length,
      criticalRoadsOnCoast: criticalRoadsOnCoast.length,
      missingCoastPlains: missingCoastPlains.length,
      missingCoastElevated: missingCoastElevated.length,
      coastCoastEdgeMismatches: coastCoastEdgeMismatches.length,
      coastLandSandBleeds: coastLandSandBleeds.length,
      coastWaterGrassCliffs: coastWaterGrassCliffs.length
    }
  };
}

/**
 * Runs the test suite across multiple seeds.
 * @param {Object} options
 */
export function runTestSuite({
  seedCount = 50,
  seeds = null,
  radius = 6,
  waterLevel = 0.08,
  treeDensity = 0.4,
  verbose = false,
  jsonOutput = false
} = {}) {
  const targetSeeds = seeds || Array.from({ length: seedCount }, (_, i) => (i + 1) * 7919);

  const results = [];
  let seedsWithCritical = 0;
  let seedsWithCriticalSand = 0;
  let seedsWithCriticalRoad = 0;
  let seedsWithMissingCoast = 0;
  let seedsWithCoastMismatch = 0;
  let seedsWithAnyFailure = 0;

  let totalCriticalSand = 0;
  let totalCriticalRoads = 0;
  let totalMissingCoastPlains = 0;
  let totalMissingCoastElevated = 0;
  let totalCoastCoastMismatches = 0;
  let totalCoastLandBleeds = 0;
  let totalCoastWaterGrassCliffs = 0;

  let totalHexes = 0;
  let totalWaterTiles = 0;

  const startTime = Date.now();

  for (const seed of targetSeeds) {
    const worldData = generateWorldData({ seed, radius, waterLevel, treeDensity });
    const report = evaluateWorld(worldData, seed);
    results.push(report);

    totalHexes += worldData.hexList.length;
    totalWaterTiles += worldData.hexList.filter(t => t.biome === 'water').length;

    if (report.hasCritical) seedsWithCritical++;
    if (report.hasCriticalSand) seedsWithCriticalSand++;
    if (report.hasCriticalRoad) seedsWithCriticalRoad++;
    if (report.hasMissingCoast) seedsWithMissingCoast++;
    if (report.hasMismatches) seedsWithCoastMismatch++;
    if (report.hasFailure) seedsWithAnyFailure++;

    totalCriticalSand += report.counts.criticalSandTouchingWater;
    totalCriticalRoads += report.counts.criticalRoadsOnCoast;
    totalMissingCoastPlains += report.counts.missingCoastPlains;
    totalMissingCoastElevated += report.counts.missingCoastElevated;
    totalCoastCoastMismatches += report.counts.coastCoastEdgeMismatches;
    totalCoastLandBleeds += report.counts.coastLandSandBleeds;
    totalCoastWaterGrassCliffs += report.counts.coastWaterGrassCliffs;
  }

  const elapsedMs = Date.now() - startTime;
  const totalSeeds = targetSeeds.length;
  const avgOceanPct = ((totalWaterTiles / totalHexes) * 100).toFixed(1);
  const avgLandPct = (((totalHexes - totalWaterTiles) / totalHexes) * 100).toFixed(1);

  const benchmarkSummary = {
    totalSeeds,
    elapsedMs,
    coverage: {
      averageOceanPct: avgOceanPct,
      averageLandPct: avgLandPct
    },
    seedsWithAnyFailure,
    failureRateSeedsPct: ((seedsWithAnyFailure / totalSeeds) * 100).toFixed(1),
    criticalFailures: {
      sandTouchingWater: {
        seedsAffected: seedsWithCriticalSand,
        seedRatePct: ((seedsWithCriticalSand / totalSeeds) * 100).toFixed(1),
        totalInstances: totalCriticalSand
      },
      roadsOnCoast: {
        seedsAffected: seedsWithCriticalRoad,
        seedRatePct: ((seedsWithCriticalRoad / totalSeeds) * 100).toFixed(1),
        totalInstances: totalCriticalRoads
      }
    },
    missingCoastPlains: {
      seedsAffected: seedsWithMissingCoast,
      seedRatePct: ((seedsWithMissingCoast / totalSeeds) * 100).toFixed(1),
      totalInstances: totalMissingCoastPlains
    },
    missingCoastElevatedLand: {
      totalInstances: totalMissingCoastElevated
    },
    neighborEdgeMismatches: {
      seedsAffected: seedsWithCoastMismatch,
      seedRatePct: ((seedsWithCoastMismatch / totalSeeds) * 100).toFixed(1),
      coastCoastMismatches: totalCoastCoastMismatches,
      coastLandSandBleeds: totalCoastLandBleeds,
      coastWaterGrassCliffs: totalCoastWaterGrassCliffs
    }
  };

  if (jsonOutput) {
    console.log(JSON.stringify({ summary: benchmarkSummary, results }, null, 2));
    return { summary: benchmarkSummary, results };
  }

  console.log('================================================================');
  console.log('       ⬡ KAYKIT WORLD GENERATOR - COASTLINE QA TEST SUITE ⬡       ');
  console.log('================================================================');
  console.log(`Evaluated: ${totalSeeds} seeds (Map Radius: ${radius}) in ${elapsedMs}ms`);
  console.log(`Ocean Coverage: ${avgOceanPct}% (Target: 5% - 10%) | Land Coverage: ${avgLandPct}% (Target: 90% - 95%)\n`);

  console.log('--- DEFECT BENCHMARK SUMMARY ---');
  console.log(`1a. Sand Edge Touching Water (CRITICAL FAILURE):`);
  console.log(`    - Affected Seeds : ${seedsWithCriticalSand} / ${totalSeeds} (${benchmarkSummary.criticalFailures.sandTouchingWater.seedRatePct}%)`);
  console.log(`    - Total Instances: ${totalCriticalSand}`);

  console.log(`1b. Illegal Road on Coast Tile (CRITICAL FAILURE):`);
  console.log(`    - Affected Seeds : ${seedsWithCriticalRoad} / ${totalSeeds} (${benchmarkSummary.criticalFailures.roadsOnCoast.seedRatePct}%)`);
  console.log(`    - Total Instances: ${totalCriticalRoads}`);

  console.log(`2. Land Touching Water Missing Coast Tile (Grass Cliff):`);
  console.log(`   - Plains at elevation 0: ${seedsWithMissingCoast} / ${totalSeeds} (${benchmarkSummary.missingCoastPlains.seedRatePct}%) [${totalMissingCoastPlains} instances]`);
  console.log(`   - Elevated Land (Hills): ${totalMissingCoastElevated} instances (Permitted sea cliff islands)`);

  console.log(`3. Neighbor Edge Socket Mismatches:`);
  console.log(`   - Affected Seeds : ${seedsWithCoastMismatch} / ${totalSeeds} (${benchmarkSummary.neighborEdgeMismatches.seedRatePct}%)`);
  console.log(`   - Coast-to-Coast Socket Mismatches: ${totalCoastCoastMismatches} instances`);
  console.log(`   - Coast Sand Bleeding into Plains: ${totalCoastLandBleeds} instances`);
  console.log(`   - Coast Flat Grass Cliffs into Ocean: ${totalCoastWaterGrassCliffs} instances`);

  console.log('----------------------------------------------------------------');
  console.log(`OVERALL DEFECT SEED RATE: ${seedsWithAnyFailure} / ${totalSeeds} (${benchmarkSummary.failureRateSeedsPct}%)\n`);

  // Detailed breakdown of failing seeds
  const failingSeeds = results.filter(r => r.hasFailure);
  if (failingSeeds.length > 0) {
    console.log('--- REPRODUCTION SEEDS & FAILURE COORDINATES ---');
    for (const report of failingSeeds.slice(0, verbose ? failingSeeds.length : 10)) {
      console.log(`\n▶ Seed ${report.seed}:`);
      if (report.counts.criticalSandTouchingWater > 0) {
        console.log(`  [CRITICAL] Sand Touching Water (${report.counts.criticalSandTouchingWater}):`);
        report.criticalSandTouchingWater.forEach(f => {
          console.log(`    - at (${f.tileCoord.q},${f.tileCoord.r}) edge ${f.edgeIndex} (${f.direction}) piece=${f.pieceId} rot=${f.rotationStep} -> neighbor (${f.neighborCoord.q},${f.neighborCoord.r}) [${f.neighborType}]`);
        });
      }
      if (report.counts.missingCoastPlains > 0) {
        console.log(`  [DEFECT] Missing Coast Tile (${report.counts.missingCoastPlains}):`);
        report.missingCoastPlains.forEach(f => {
          console.log(`    - at (${f.tileCoord.q},${f.tileCoord.r})`);
        });
      }
      if (report.counts.coastCoastEdgeMismatches > 0) {
        console.log(`  [MISMATCH] Coast-Coast Sockets (${report.counts.coastCoastEdgeMismatches}):`);
        report.coastCoastEdgeMismatches.slice(0, 5).forEach(f => {
          console.log(`    - (${f.tileA.q},${f.tileA.r})[${f.tileA.type}] vs (${f.tileB.q},${f.tileB.r})[${f.tileB.type}] on edge ${f.tileA.edge} (${f.tileA.dir})`);
        });
        if (report.counts.coastCoastEdgeMismatches > 5) {
          console.log(`    ... and ${report.counts.coastCoastEdgeMismatches - 5} more`);
        }
      }
    }
    if (!verbose && failingSeeds.length > 10) {
      console.log(`\n... and ${failingSeeds.length - 10} more failing seeds. Use --verbose to see all.`);
    }
  }

  console.log('\n================================================================');
  return { summary: benchmarkSummary, results };
}

// CLI argument parsing
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let seedCount = 50;
  let specificSeed = null;
  let verbose = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seeds' && args[i + 1]) {
      seedCount = parseInt(args[++i], 10);
    } else if (args[i] === '--seed' && args[i + 1]) {
      specificSeed = parseInt(args[++i], 10);
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  const runOpts = {
    seedCount,
    seeds: specificSeed !== null ? [specificSeed] : null,
    verbose,
    jsonOutput
  };

  const { summary } = runTestSuite(runOpts);
  if (summary.seedsWithAnyFailure > 0 && process.env.STRICT_EXIT === '1') {
    process.exit(1);
  }
}
