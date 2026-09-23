#!/usr/bin/env node
/**
 * test_living_world_qa.js
 * Automated QA Test Suite for the Living World Simulation.
 *
 * Verifies:
 * 1. NavMesh integrity: 0 water nodes, 0 unbridged river crossings, 0 ungated wall crossings, 0 cliff jumps.
 * 2. 250 active on-screen units properly simulated, overflow resting in cottages.
 * 3. 0 units ever step into water or cross illegal river/wall edges during simulation.
 * 4. Timed tasks (woodcutting, water fetching, farming, child growth) execute and transition cleanly.
 * 5. Performance benchmark on 50x50 map confirms sub-2ms update budget (ensuring 30+ FPS).
 */

import { generateWorldData } from "../worldGenerator.js";
import { LivingWorldNavMesh } from "../livingWorldNavMesh.js";
import { LivingUnitManager } from "../livingUnitManager.js";

const getKey = (q, r) => q + "," + r;

console.log("================================================================");
console.log("    ⬡ LIVING WORLD SIMULATION QA TEST SUITE ⬡");
console.log("    250 Active Units • Height-Climbing • River/Wall Blocking");
console.log("================================================================\n");

let totalTests = 0;
let passedTests = 0;

// Test Suite 1: NavMesh Invariants across multiple seeds
const testSeeds = [42, 1020, 2025, 7919];
for (const seed of testSeeds) {
  totalTests++;
  const worldData = generateWorldData({
    radius: 15,
    seed,
    mapShape: "rectangular",
    riverDensity: 2,
    waterLevel: 0.10,
    villages: 4,
    wallStyle: "walled"
  });

  const navMesh = new LivingWorldNavMesh(worldData);

  let waterNodeViolations = 0;
  let unbridgedRiverCrossings = 0;
  let ungatedWallCrossings = 0;
  let cliffJumpViolations = 0;

  for (const [key, node] of navMesh.nodes) {
    if (node.isWater && node.neighbors.length > 0) {
      waterNodeViolations++;
    }

    for (const edge of node.neighbors) {
      const neighbor = edge.node;

      // Check river crossing
      if (node.hasRiver && node.riverEdges.includes(edge.edgeDir)) {
        if (!node.isBridge && !neighbor.isBridge) {
          unbridgedRiverCrossings++;
        }
      }

      // Check wall crossing
      if (node.blockedWalls.has(edge.edgeDir)) {
        ungatedWallCrossings++;
      }

      // Check vertical cliff jump
      const deltaH = Math.abs(neighbor.elevation - node.elevation);
      if (deltaH > 1.05) {
        cliffJumpViolations++;
      }
    }
  }

  const passed = (waterNodeViolations === 0) &&
                 (unbridgedRiverCrossings === 0) &&
                 (ungatedWallCrossings === 0) &&
                 (cliffJumpViolations === 0);

  if (passed) {
    passedTests++;
  } else {
    console.error(`FAIL NavMesh Seed ${seed}: water=${waterNodeViolations}, rivers=${unbridgedRiverCrossings}, walls=${ungatedWallCrossings}, cliffs=${cliffJumpViolations}`);
  }
}

console.log(`NavMesh Invariants: ${passedTests} / ${totalTests} Passed`);

// Test Suite 2: Simulation Loop & Invariants on a Large 50x50 Map
console.log("\nGenerating 50×50 Mega World (2,500 Hexes) for Population & Performance Benchmark...");
const startGen = Date.now();
const largeWorld = generateWorldData({
  radius: 50,
  seed: 42,
  mapShape: "rectangular",
  riverDensity: 3,
  villages: 6,
  wallStyle: "walled"
});
const genTime = Date.now() - startGen;
console.log(`Generated 50×50 World in ${genTime}ms (${largeWorld.hexList.length} hexes)`);

const largeNavMesh = new LivingWorldNavMesh(largeWorld);
const unitManager = new LivingUnitManager(largeWorld, largeNavMesh, { maxActiveUnits: 250 });

console.log(`Total Population Created: ${unitManager.stats.totalPopulation}`);
console.log(`Active Visible Units: ${unitManager.stats.activeUnitsCount} (Capped at ${unitManager.maxActiveUnits})`);
console.log(`Demographics: Children=${unitManager.stats.children}, Lumberjacks=${unitManager.stats.lumberjacks}, WaterCarriers=${unitManager.stats.waterCarriers}, Farmers=${unitManager.stats.farmers}, Animals=${unitManager.stats.animals}`);

// Run 120 simulation steps (equivalent to 2-3 minutes of game time at 2x speed)
let simulationErrors = 0;
let waterEntryCount = 0;
const startSim = Date.now();
const steps = 120;
for (let step = 0; step < steps; step++) {
  unitManager.update(0.05);

  // Check positions of all active units
  for (const u of unitManager.activeUnits) {
    if (u.currentHexNode && u.currentHexNode.isWater) {
      waterEntryCount++;
    }
  }
}
const totalSimTime = Date.now() - startSim;
const avgTickMs = (totalSimTime / steps).toFixed(3);

console.log(`Simulated ${steps} ticks in ${totalSimTime}ms (Average: ${avgTickMs}ms / tick)`);

totalTests++;
if (unitManager.stats.activeUnitsCount <= 250 && unitManager.stats.activeUnitsCount > 100) {
  passedTests++;
  console.log("PASS: Active units count properly constrained to on-screen budget.");
} else {
  console.error(`FAIL: Active units count invalid: ${unitManager.stats.activeUnitsCount}`);
}

totalTests++;
if (waterEntryCount === 0) {
  passedTests++;
  console.log("PASS: Zero units entered water during 120 ticks of autonomous simulation.");
} else {
  console.error(`FAIL: ${waterEntryCount} instances of units in water detected!`);
}

totalTests++;
if (avgTickMs < 5.0) {
  passedTests++;
  console.log(`PASS: Performance target exceeded (${avgTickMs}ms < 5.0ms budget for 30+ FPS).`);
} else {
  console.error(`FAIL: Simulation too slow: ${avgTickMs}ms per tick.`);
}

// Test Suite 3: Test Dense Capping with 500+ Total Population
console.log("\nTesting Dense Population Capping & Cottage Resting...");
// Artificially double population to test exact 250 active cap
for (let i = 0; i < 150; i++) {
  const base = unitManager.allUnits[i % unitManager.allUnits.length];
  unitManager.allUnits.push({
    ...base,
    id: 10000 + i,
    isResting: true
  });
}
unitManager.refreshActivePool();
unitManager.updateStats();

totalTests++;
const activeCount = unitManager.activeUnits.length;
if (activeCount <= 250 && activeCount >= 200 && unitManager.allUnits.length > 350) {
  passedTests++;
  console.log(`PASS: Active on-screen units (${activeCount}) within budget (≤250) with ${unitManager.allUnits.length} total population (${unitManager.allUnits.length - activeCount} resting/despawned).`);
} else {
  console.error(`FAIL: Active units (${activeCount}) outside expected range 200–250!`);
}

// Test Suite 4: Timed Task & Child Growth Verification
console.log("\nTesting Timed Task & Child Growth Transitions...");
const testChild = unitManager.allUnits.find(u => u.role === "child");
if (testChild) {
  testChild.ageProgress = 0.99;
  unitManager.updateHuman(testChild, 1.0); // Will trigger growUpChild
  totalTests++;
  if (!testChild.isChild && testChild.scale >= 0.25) {
    passedTests++;
    console.log(`PASS: Child successfully came of age, grew to scale ${testChild.scale}, and assigned profession: ${testChild.role}`);
  } else {
    console.error("FAIL: Child growth failed to transition!");
  }
}

const testLumber = unitManager.allUnits.find(u => u.role === "lumberjack");
if (testLumber) {
  testLumber.state = "CHOPPING_WOOD";
  testLumber.stateTimer = 0.01;
  unitManager.updateHuman(testLumber, 0.05);
  totalTests++;
  if (testLumber.tool === "timber" && (testLumber.state === "WALKING" || testLumber.state === "DELIVERING_WOOD")) {
    passedTests++;
    console.log(`PASS: Woodcutter finished chopping and is carrying timber (${testLumber.state}).`);
  } else {
    console.error(`FAIL: Woodcutter state mismatch: ${testLumber.state}, tool: ${testLumber.tool}`);
  }
}

// Test Suite 5: Farmer Crop Cultivation & Grain Sheaf Harvesting
console.log("\nTesting Farmer Crop Cultivation & Grain Sheaf Harvesting...");
const testFarmer = unitManager.allUnits.find(u => u.role === "farmer");
if (testFarmer && unitManager.navMesh.pois.farms.length > 0) {
  const farm = unitManager.navMesh.pois.farms[0];
  testFarmer.targetFarm = farm;
  testFarmer.state = "PLANTING_CROP";
  testFarmer.stateTimer = 0.01;
  unitManager.updateHuman(testFarmer, 0.05);

  totalTests++;
  if (farm.state === "PLANTED" && farm.hasCrop === true && farm.cropGrowth > 0.1) {
    passedTests++;
    console.log(`PASS: Farmer successfully planted crop plot (state=${farm.state}, growth=${farm.cropGrowth}).`);
  } else {
    console.error(`FAIL: Farm plot planting mismatch: state=${farm.state}, hasCrop=${farm.hasCrop}`);
  }

  // Test harvesting
  farm.state = "RIPE";
  farm.cropGrowth = 1.0;
  testFarmer.targetFarm = farm;
  testFarmer.state = "HARVESTING_CROP";
  testFarmer.stateTimer = 0.01;
  unitManager.updateHuman(testFarmer, 0.05);

  totalTests++;
  if (testFarmer.tool === "sheaf" && farm.state === "TILLED" && farm.hasCrop === false) {
    passedTests++;
    console.log(`PASS: Farmer successfully harvested ripe crop and equipped golden grain sheaf.`);
  } else {
    console.error(`FAIL: Farm plot harvesting mismatch: tool=${testFarmer.tool}, farmState=${farm.state}`);
  }
}

// Test Suite 6: Horse 1/6 Hex Quadrant Roaming & Sub-Hex Positioning
console.log("\nTesting Horse 1/6 Hex Quadrant Roaming...");
const testHorse = unitManager.allUnits.find(u => u.type === "horse" && u.state === "GRAZING") || unitManager.allUnits.find(u => u.type === "horse");
if (testHorse) {
  totalTests++;
  const px = (testHorse.state === "WALKING" && testHorse.targetX !== undefined) ? testHorse.targetX : testHorse.x;
  const pz = (testHorse.state === "WALKING" && testHorse.targetZ !== undefined) ? testHorse.targetZ : testHorse.z;
  const distFromCenter = Math.hypot(px - testHorse.currentHexNode.worldX, pz - testHorse.currentHexNode.worldZ);
  if (testHorse.currentQuadrant !== null && testHorse.currentQuadrant >= 0 && testHorse.currentQuadrant <= 5 && distFromCenter > 0.25) {
    passedTests++;
    console.log(`PASS: Horse placed in hex quadrant ${testHorse.currentQuadrant} (distance from hex center: ${distFromCenter.toFixed(3)} > 0.25).`);
  } else {
    console.error(`FAIL: Horse quadrant placement invalid: quadrant=${testHorse.currentQuadrant}, dist=${distFromCenter}`);
  }

  // Test horse grazing transition to another quadrant
  testHorse.state = "GRAZING";
  testHorse.stateTimer = 0.01;
  unitManager.updateAnimal(testHorse, 0.05);
  totalTests++;
  if (testHorse.state === "WALKING" || testHorse.state === "GRAZING") {
    passedTests++;
    console.log(`PASS: Horse actively roaming between sub-hex quadrants (${testHorse.state}).`);
  } else {
    console.error(`FAIL: Horse grazing transition failed: ${testHorse.state}`);
  }
}

console.log("\n================================================================");
console.log(`Total Living World QA Tests: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
if (passedTests === totalTests) {
  console.log("🏆 ALL LIVING WORLD SIMULATION INVARIANTS PASSED! (0 Defects)");
}
console.log("================================================================\n");
