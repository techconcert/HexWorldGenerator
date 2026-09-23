#!/usr/bin/env node
/**
 * test_large_world_qa.js
 * Comprehensive QA Test Suite for Large Worlds (> 500 hexes).
 * Verifies:
 * 1. Extended Biomes (> 4 biomes up to 8 biomes) on worlds > 500 hexes for both rectangular and hex shapes.
 * 2. Multi-lake basins on large rectangular worlds.
 * 3. Scaled rivers (multiple independent river systems) on large rectangular worlds.
 * 4. Zero WFC defects, zero river dangling dead ends, zero transition edge mismatches.
 */

import { generateWorldData, getTileEdgeMaterial } from './worldGenerator.js';
import { HEX_DIRECTIONS, getOppositeEdge } from './hexMath.js';

const getKey = (q, r) => `${q},${r}`;

function testLargeWorld(options) {
  const { hexList, grid } = generateWorldData(options);
  const totalHexes = hexList.length;

  // 1. Count distinct biomes present (strictly 4 original materials)
  const biomeSet = new Set();
  const biomeCounts = {};
  for (const t of hexList) {
    if (t.biomeTheme) {
      biomeSet.add(t.biomeTheme);
      biomeCounts[t.biomeTheme] = (biomeCounts[t.biomeTheme] || 0) + 1;
    }
  }

  // 1b. Count distinct connected sections for each of the 4 original biomes
  const visitedBiome = new Set();
  const biomeSections = { spring: 0, summer: 0, fall: 0, winter: 0 };
  for (const t of hexList) {
    if (t.biome === 'water') continue;
    const k = getKey(t.q, t.r);
    if (visitedBiome.has(k)) continue;
    if (biomeSections[t.biomeTheme] !== undefined) {
      biomeSections[t.biomeTheme]++;
    }
    visitedBiome.add(k);
    const queue = [t];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nKey = getKey(cur.q + dir.q, cur.r + dir.r);
        const n = grid.get(nKey);
        if (n && n.biome !== 'water' && n.biomeTheme === t.biomeTheme && !visitedBiome.has(nKey)) {
          visitedBiome.add(nKey);
          queue.push(n);
        }
      }
    }
  }
  const totalSections = Object.values(biomeSections).reduce((a, b) => a + b, 0);

  // 2. Count distinct water bodies (connected components of water tiles)
  const waterTiles = hexList.filter(t => t.biome === 'water');
  const visitedWater = new Set();
  let waterBodiesCount = 0;
  for (const wt of waterTiles) {
    const key = getKey(wt.q, wt.r);
    if (visitedWater.has(key)) continue;
    waterBodiesCount++;
    const queue = [wt];
    visitedWater.add(key);
    while (queue.length > 0) {
      const cur = queue.shift();
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nKey = getKey(cur.q + dir.q, cur.r + dir.r);
        const n = grid.get(nKey);
        if (n && n.biome === 'water' && !visitedWater.has(nKey)) {
          visitedWater.add(nKey);
          queue.push(n);
        }
      }
    }
  }

  // 3. Count independent river networks (connected components of river tiles)
  const riverTiles = hexList.filter(t => t.hasRiver);
  const visitedRivers = new Set();
  let riverNetworksCount = 0;
  for (const rt of riverTiles) {
    const key = getKey(rt.q, rt.r);
    if (visitedRivers.has(key)) continue;
    riverNetworksCount++;
    const queue = [rt];
    visitedRivers.add(key);
    while (queue.length > 0) {
      const cur = queue.shift();
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nKey = getKey(cur.q + dir.q, cur.r + dir.r);
        const n = grid.get(nKey);
        if (n && n.hasRiver && !visitedRivers.has(nKey)) {
          visitedRivers.add(nKey);
          queue.push(n);
        }
      }
    }
  }

  // 4. Verify river continuity (zero dangling dead ends)
  let danglingRiverEnds = 0;
  for (const t of riverTiles) {
    if (t.riverEdges.length < 2) {
      danglingRiverEnds++;
    }
  }

  // 5. Verify Coastline WFC (zero sand-water or sand-void mismatches)
  let coastDefects = 0;
  for (const t of hexList) {
    if (t.isCoast && t.coastInfo && Array.isArray(t.coastInfo.edges)) {
      for (let i = 0; i < 6; i++) {
        const edgeType = t.coastInfo.edges[i];
        const dir = HEX_DIRECTIONS[i];
        const n = grid.get(getKey(t.q + dir.q, t.r + dir.r));
        if (edgeType === 'sand') {
          if (!n || n.biome === 'water') coastDefects++;
        }
      }
    }
  }

  // 6. Verify Transition Tiles reciprocity (material n1 <> n1, n2 <> n2)
  let transitionMismatches = 0;
  let transitionCount = 0;
  for (const t of hexList) {
    if (t.isTransition) {
      transitionCount++;
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const n = grid.get(getKey(t.q + dir.q, t.r + dir.r));
        if (!n || n.biome === 'water') continue;
        const myMat = getTileEdgeMaterial(t, i);
        const opp = getOppositeEdge(i);
        const nMat = getTileEdgeMaterial(n, opp);
        if (myMat !== nMat) {
          transitionMismatches++;
        }
      }
    }
  }

  // 7. Verify NO trees on sloped tiles, hill mounds, or mountains (Zero Clipping Trees)
  let treesOnSlopesOrHills = 0;
  for (const t of hexList) {
    if (t.decoration && t.decoration.path && (t.decoration.path.includes('trees') || t.decoration.path.includes('tree_single'))) {
      if (t.slope || t.biome === 'hill' || t.biome === 'mountain') {
        treesOnSlopesOrHills++;
      }
    }
    if (t.subBuildings && t.subBuildings.length > 0) {
      for (const sb of t.subBuildings) {
        if (sb.type === 'tree' && t.slope) {
          treesOnSlopesOrHills++;
        }
      }
    }
  }

  return {
    totalHexes,
    distinctBiomes: biomeSet.size,
    biomes: [...biomeSet],
    biomeCounts,
    biomeSections,
    totalSections,
    waterTiles: waterTiles.length,
    waterBodiesCount,
    riverTiles: riverTiles.length,
    riverNetworksCount,
    danglingRiverEnds,
    coastDefects,
    transitionCount,
    transitionMismatches,
    treesOnSlopesOrHills
  };
}

console.log('================================================================');
console.log('    ⬡ LARGE WORLD QA SUITE (> 500 HEXES) ⬡');
console.log('    Verifying 4 Original Materials & Multi-Section Biome Regions');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

// Test Suite 1: Large Rectangular Worlds (r=20 ~567 hexes, r=25 ~806 hexes, r=38 ~1558 hexes, r=50 ~2500 hexes)
const rectRadii = [20, 25, 38, 50];
for (const rad of rectRadii) {
  for (let s = 1; s <= 5; s++) {
    totalTests++;
    const seed = 1000 * s + rad;
    const res = testLargeWorld({
      radius: rad,
      seed,
      mapShape: 'rectangular',
      riverDensity: 2,
      waterLevel: 0.10
    });

    const validBiomesOnly = res.biomes.every(b => ['spring', 'summer', 'fall', 'winter'].includes(b));
    const hasAll4Biomes = res.distinctBiomes === 4;
    const hasMultipleSections = res.totalSections >= 8;
    const hasMultiLakes = res.waterBodiesCount >= 2;
    const hasMultiRivers = res.riverNetworksCount >= 2;
    const zeroDefects = (res.danglingRiverEnds === 0) && (res.coastDefects === 0) && (res.transitionMismatches === 0) && (res.treesOnSlopesOrHills === 0);

    if (hasAll4Biomes && validBiomesOnly && hasMultipleSections && hasMultiLakes && hasMultiRivers && zeroDefects) {
      passedTests++;
    } else {
      console.error(`FAIL: Rectangular rad=${rad} seed=${seed}: hexes=${res.totalHexes}, biomes=${res.distinctBiomes} (${res.biomes.join(',')}), sections=${res.totalSections}, lakes=${res.waterBodiesCount}, rivers=${res.riverNetworksCount}, defects: dang=${res.danglingRiverEnds} coast=${res.coastDefects} trans=${res.transitionMismatches} treeClips=${res.treesOnSlopesOrHills}`);
    }
  }
}

// Test Suite 2: Large Hexagonal Worlds (r=14 ~631 hexes, r=18 ~1027 hexes, r=22 ~1519 hexes, r=28 ~2437 hexes)
const hexRadii = [14, 18, 22, 28];
for (const rad of hexRadii) {
  for (let s = 1; s <= 5; s++) {
    totalTests++;
    const seed = 2000 * s + rad;
    const res = testLargeWorld({
      radius: rad,
      seed,
      mapShape: 'hexagonal',
      riverDensity: 2,
      waterLevel: 0.08
    });

    const validBiomesOnly = res.biomes.every(b => ['spring', 'summer', 'fall', 'winter'].includes(b));
    const hasAll4Biomes = res.distinctBiomes === 4;
    const hasMultipleSections = res.totalSections >= 8;
    const zeroDefects = (res.danglingRiverEnds === 0) && (res.coastDefects === 0) && (res.transitionMismatches === 0) && (res.treesOnSlopesOrHills === 0);

    if (hasAll4Biomes && validBiomesOnly && hasMultipleSections && zeroDefects) {
      passedTests++;
    } else {
      console.error(`FAIL: Hexagonal rad=${rad} seed=${seed}: hexes=${res.totalHexes}, biomes=${res.distinctBiomes} (${res.biomes.join(',')}), sections=${res.totalSections}, defects: dang=${res.danglingRiverEnds} coast=${res.coastDefects} trans=${res.transitionMismatches} treeClips=${res.treesOnSlopesOrHills}`);
    }
  }
}

// Test Suite 3: Scaled Multi-River Systems on Large Worlds (riverDensity: 4 and 6)
const multiRiverConfigs = [
  { shape: 'rectangular', radius: 38, riverDensity: 4, minRivers: 3 },
  { shape: 'rectangular', radius: 38, riverDensity: 6, minRivers: 4 },
  { shape: 'hexagonal', radius: 22, riverDensity: 4, minRivers: 3 },
  { shape: 'hexagonal', radius: 28, riverDensity: 6, minRivers: 4 }
];

for (const cfg of multiRiverConfigs) {
  for (let s = 1; s <= 3; s++) {
    totalTests++;
    const seed = 5000 * s + cfg.radius;
    const res = testLargeWorld({
      radius: cfg.radius,
      seed,
      mapShape: cfg.shape,
      riverDensity: cfg.riverDensity,
      waterLevel: 0.08
    });

    const hasExpectedRivers = res.riverNetworksCount >= cfg.minRivers;
    const zeroDefects = (res.danglingRiverEnds === 0) && (res.coastDefects === 0) && (res.transitionMismatches === 0) && (res.treesOnSlopesOrHills === 0);

    if (hasExpectedRivers && zeroDefects) {
      passedTests++;
    } else {
      console.error(`FAIL Multi-River: ${cfg.shape} rad=${cfg.radius} dens=${cfg.riverDensity} seed=${seed}: rivers=${res.riverNetworksCount} (expected >= ${cfg.minRivers}), dang=${res.danglingRiverEnds}, coast=${res.coastDefects}, trans=${res.transitionMismatches} treeClips=${res.treesOnSlopesOrHills}`);
    }
  }
}

console.log(`Results: ${passedTests} / ${totalTests} Large World Tests Passed (${Math.round(passedTests/totalTests*100)}%)`);

// Single detailed benchmark printout for a 1,216 hex rectangular world
const sample = testLargeWorld({ radius: 38, seed: 42, mapShape: 'rectangular', riverDensity: 2 });
console.log('\n--- DETAILED BENCHMARK (Rectangular 38×32, 1,216 Hexes, Seed 42) ---');
console.log(`Total Hexes: ${sample.totalHexes}`);
console.log(`Distinct Biomes: ${sample.distinctBiomes} (${sample.biomes.join(', ')})`);
console.log(`Biome Distribution:`, sample.biomeCounts);
console.log(`Biome Sections:`, sample.biomeSections, `(Total: ${sample.totalSections} sections across world)`);
console.log(`Water Bodies (Lakes & Bays): ${sample.waterBodiesCount}`);
console.log(`River Networks: ${sample.riverNetworksCount} (${sample.riverTiles} river hexes)`);
console.log(`Dangling River Ends: ${sample.danglingRiverEnds}`);
console.log(`Coastline WFC Defects: ${sample.coastDefects}`);
console.log(`Transition Tiles Placed: ${sample.transitionCount} (Mismatches: ${sample.transitionMismatches})`);
console.log(`Trees on Sloped Hills / Mountains (Clipping Defects): ${sample.treesOnSlopesOrHills}`);

if (passedTests === totalTests) {
  console.log('\n🏆 ALL LARGE WORLD INVARIANTS PASSED! (0 Defects)');
  process.exit(0);
} else {
  process.exit(1);
}
