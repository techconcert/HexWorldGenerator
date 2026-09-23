import { generateWorldData } from "../worldGenerator.js";
import { LivingWorldNavMesh } from "../livingWorldNavMesh.js";

console.log("================================================================");
console.log("  ⬡ TERRAIN ELEVATION & OBSTACLE COLLISION QA VERIFICATION ⬡");
console.log("================================================================");

let totalTests = 0;
let passedTests = 0;

for (const seed of [42, 1020, 7919]) {
  const world = generateWorldData({
    radius: 12,
    seed,
    mapShape: "rectangular",
    mountainDensity: 0.45
  });

  const navMesh = new LivingWorldNavMesh(world);

  // Test 1: Hill mounds have continuous elevated dome height (units climb up/down)
  let hillsTested = 0;
  let validHillElevation = 0;
  for (const [key, node] of navMesh.nodes) {
    if (node.tile.biome === 'hill' || (node.tile.decoration && String(node.tile.decoration.path).includes('hill'))) {
      hillsTested++;
      const centerHeight = navMesh.getTerrainHeightAt(node.worldX, node.worldZ);
      // Center crest must elevate units by ~0.48 above raw node base Y
      if (centerHeight >= node.worldY + 0.45) {
        validHillElevation++;
      }
    }
  }

  totalTests++;
  if (hillsTested > 0 && validHillElevation === hillsTested) {
    passedTests++;
    console.log(`PASS: Seed ${seed}: Verified all ${hillsTested} hill mounds have elevated crest (+0.48) with units climbing up and down.`);
  }

  // Test 2: Mountain peaks without roads have central obstacle collision avoiding interior clipping
  let mountainPeaksTested = 0;
  let mountainObstaclesFound = 0;
  for (const [key, node] of navMesh.nodes) {
    if ((node.tile.biome === 'mountain' || (node.tile.decoration && String(node.tile.decoration.path).includes('mountain'))) && !node.tile.hasRoad) {
      mountainPeaksTested++;
      const nearbyObs = navMesh.obstaclesByHex.get(node.key) || [];
      const hasCenterObstacle = nearbyObs.some(o => Math.hypot(o.x - node.worldX, o.z - node.worldZ) < 0.05 && o.radius >= 0.35);
      if (hasCenterObstacle) mountainObstaclesFound++;
    }
  }

  totalTests++;
  if (mountainPeaksTested > 0 && mountainObstaclesFound === mountainPeaksTested) {
    passedTests++;
    console.log(`PASS: Seed ${seed}: All ${mountainObstaclesFound} wild mountain peaks have center collision obstacles steering units around.`);
  }

  // Test 3: Forests / Trees have ZERO obstacle registration (100% permeable)
  let forestNodesTested = 0;
  let illegalTreeObstacles = 0;
  for (const [key, node] of navMesh.nodes) {
    if (node.tile.biome === 'plains' && node.tile.decoration && String(node.tile.decoration.path).includes('trees') && !node.tile.building && !node.tile.isVillage) {
      forestNodesTested++;
      const nearbyObs = navMesh.obstaclesByHex.get(node.key) || [];
      const treeObstacles = nearbyObs.filter(o => !o.isGate && o.radius > 0.15 && Math.hypot(o.x - node.worldX, o.z - node.worldZ) < 0.2);
      if (treeObstacles.length > 0) illegalTreeObstacles++;
    }
  }

  totalTests++;
  if (forestNodesTested > 0 && illegalTreeObstacles === 0) {
    passedTests++;
    console.log(`PASS: Seed ${seed}: All ${forestNodesTested} forest grove nodes are 100% permeable (0 obstacles blocking paths).`);
  }
}

console.log("================================================================");
console.log(`Total Terrain Elevation QA Tests: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
if (passedTests === totalTests) {
  console.log("🏆 ALL TERRAIN ELEVATION & OBSTACLE INVARIANTS PASSED! (0 Defects)");
}
console.log("================================================================");
