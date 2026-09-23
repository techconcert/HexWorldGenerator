/**
 * test_village_qa.js
 * Comprehensive automated QA test suite for Multi-Hex Walled Villages,
 * Perimeter Wall Solving, and 1/4 Scale Sub-Tile Building Placement.
 */

import { generateWorldData } from '../worldGenerator.js';
import { HEX_DIRECTIONS } from '../hexMath.js';

function getKey(q, r) {
  return `${q},${r}`;
}

export function runVillageQATests(numSeeds = 100) {
  console.log('================================================================');
  console.log('    ⬡ VILLAGE & WALL SOLVER QA VERIFICATION ⬡');
  console.log(`    Testing across ${numSeeds} random seeds...`);
  console.log('================================================================\n');

  let totalVillages = 0;
  let singleHexVillages = 0;
  let totalWalls = 0;
  let totalGates = 0;
  let internalWallErrors = 0;
  let missingPerimeterWalls = 0;
  let gateRoadMismatches = 0;
  let oversizedBuildings = 0;
  let roadSubBuildingCollisions = 0;
  let totalSubBuildings = 0;

  const startTime = Date.now();

  for (let seed = 1; seed <= numSeeds; seed++) {
    const { hexList, grid } = generateWorldData({
      radius: 8,
      seed: seed * 7919,
      mapShape: 'rectangular',
      biomeMode: 'multi',
      waterLevel: 0.08,
      mountainDensity: 0.45,
      treeDensity: 0.4,
      villageCount: 3,
      wallFortification: 'walled'
    });

    // Group village tiles by villageId
    const villageMap = new Map();
    for (const tile of hexList) {
      if (tile.isVillage && tile.villageId) {
        if (!villageMap.has(tile.villageId)) villageMap.set(tile.villageId, []);
        villageMap.get(tile.villageId).push(tile);
      }
    }

    totalVillages += villageMap.size;

    for (const [vId, tiles] of villageMap.entries()) {
      // Invariant 1: Multi-hex (> 1 hex per village)
      if (tiles.length <= 1) {
        singleHexVillages++;
      }

      const clusterKeys = new Set(tiles.map(t => getKey(t.q, t.r)));

      for (const tile of tiles) {
        // Invariant 2: Perimeter wall solving
        if (tile.isWalled) {
          const wallByEdge = new Map();
          for (const w of tile.walls || []) {
            wallByEdge.set(w.edge, w);
            totalWalls++;
            if (w.isGate) totalGates++;
          }

          for (let e = 0; e < 6; e++) {
            const dir = HEX_DIRECTIONS[e];
            const nKey = getKey(tile.q + dir.q, tile.r + dir.r);
            const isInternal = clusterKeys.has(nKey);

            if (isInternal) {
              // Internal edge must NOT have a wall
              if (wallByEdge.has(e)) {
                internalWallErrors++;
              }
            } else {
              // External perimeter edge MUST have a wall
              if (!wallByEdge.has(e)) {
                missingPerimeterWalls++;
              } else {
                const w = wallByEdge.get(e);
                const hasRoad = tile.roadEdges && tile.roadEdges.includes(e);
                // If road enters through perimeter edge, it MUST be a gate
                if (hasRoad && !w.isGate) {
                  gateRoadMismatches++;
                }
              }
            }
          }
        }

        // Invariant 3: Sub-tile and outer building scale and placement
        if (tile.subBuildings) {
          for (const b of tile.subBuildings) {
            totalSubBuildings++;
            // Building scale must be <= 0.36 (approx 1/4 hex size)
            if (b.type !== 'fence' && b.scale > 0.36) {
              oversizedBuildings++;
            }
            // Sub-building must not collide with road corridors
            if (b.sector !== undefined && tile.roadEdges && tile.roadEdges.includes(b.sector)) {
              roadSubBuildingCollisions++;
            }
          }
        }

        if (tile.building) {
          totalSubBuildings++;
          const scale = tile.building.scale !== undefined ? tile.building.scale : 0.30;
          if (scale > 0.36) {
            oversizedBuildings++;
          }
        }
      }
    }
  }

  const duration = Date.now() - startTime;

  console.log(`Execution Time: ${duration}ms (${(duration / numSeeds).toFixed(2)}ms/seed)`);
  console.log(`Total Villages Verified: ${totalVillages} (avg ${(totalVillages / numSeeds).toFixed(1)}/seed)`);
  console.log(`Total Walls Solved     : ${totalWalls} (avg ${(totalWalls / numSeeds).toFixed(1)}/seed)`);
  console.log(`Total Gates Placed     : ${totalGates} (avg ${(totalGates / numSeeds).toFixed(1)}/seed)`);
  console.log(`Total Sub-Buildings    : ${totalSubBuildings} (avg ${(totalSubBuildings / numSeeds).toFixed(1)}/seed)\n`);

  console.log('1. Village Cluster Sizing:');
  console.log(`   - Single-Hex Villages (Violation): ${singleHexVillages}`);
  console.log('2. Perimeter Wall Solving:');
  console.log(`   - Internal Edge Walls (Forbidden): ${internalWallErrors}`);
  console.log(`   - Missing Perimeter Walls        : ${missingPerimeterWalls}`);
  console.log(`   - Road / Gate Mismatches         : ${gateRoadMismatches}`);
  console.log('3. Sub-Hex 1/4 Scale Buildings:');
  console.log(`   - Oversized Buildings (> 0.35)   : ${oversizedBuildings}`);
  console.log(`   - Road Corridor Collisions       : ${roadSubBuildingCollisions}\n`);

  const totalErrors = singleHexVillages + internalWallErrors + missingPerimeterWalls + gateRoadMismatches + oversizedBuildings + roadSubBuildingCollisions;
  if (totalErrors === 0) {
    console.log('🏆 ALL VILLAGE & WALL SOLVER INVARIANTS PASSED! (0 Defects)');
    return true;
  } else {
    console.error(`❌ QA FAILED: ${totalErrors} defect instances detected!`);
    return false;
  }
}

const pass = runVillageQATests(100);
process.exit(pass ? 0 : 1);
