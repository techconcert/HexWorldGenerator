/**
 * test_day_night_qa.js
 * Comprehensive QA Test Suite for:
 * 1. Day/Night Celestial Engine & Phase Calculations
 * 2. Evening Tavern / Church / Well Routines
 * 3. Night Sentry Torch Patrols & Sleeping Transitions
 * 4. Performance & NFR Telemetry Logger
 * 5. The 7 Dynamic Living World Roles
 */

import { generateWorldData } from '../worldGenerator.js';
import { LivingWorldNavMesh } from '../livingWorldNavMesh.js';
import { LivingUnitManager } from '../livingUnitManager.js';
import { DayNightCycle } from '../dayNightCycle.js';
import { PerformanceLogger } from '../perfLogger.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`PASS: ${message}`);
  } else {
    console.error(`FAIL: ${message}`);
  }
}

console.log("================================================================");
console.log("  ⬡ DAY/NIGHT CYCLE, EVENING LIFE & 7 ROLES QA TEST SUITE ⬡");
console.log("================================================================\n");

// --- 1. DayNightCycle Phase Logic ---
console.log("Testing DayNightCycle Phase Logic...");
const dnc = new DayNightCycle({ isPaused: true });

assert(dnc.calculatePhase(6.0) === "DAWN", "Hour 06:00 is DAWN phase");
assert(dnc.calculatePhase(12.0) === "DAY", "Hour 12:00 is DAY phase");
assert(dnc.calculatePhase(19.0) === "DUSK", "Hour 19:00 is DUSK phase");
assert(dnc.calculatePhase(23.0) === "NIGHT", "Hour 23:00 is NIGHT phase");
assert(dnc.calculatePhase(2.0) === "NIGHT", "Hour 02:00 is NIGHT phase");

dnc.setTime(12.0);
assert(dnc.phase === "DAY", "setTime(12.0) sets phase to DAY");
dnc.cycleNextPhase();
assert(dnc.phase === "DUSK", "cycleNextPhase from DAY advances to DUSK");
dnc.cycleNextPhase();
assert(dnc.phase === "NIGHT", "cycleNextPhase from DUSK advances to NIGHT");
dnc.cycleNextPhase();
assert(dnc.phase === "DAWN", "cycleNextPhase from NIGHT advances to DAWN");

// --- 2. World Generation & Demographic Diversity ---
console.log("\nGenerating World for Demographics & Schedule QA...");
const worldData = generateWorldData({
  radius: 35,
  seed: 54321,
  mapShape: "rectangular",
  riverDensity: 2,
  villages: 5,
  wallStyle: "walled"
});

const navMesh = new LivingWorldNavMesh(worldData);
const unitManager = new LivingUnitManager(worldData, navMesh, { maxActiveUnits: 250 });

// Verify POI categorization
assert(navMesh.pois.taverns.length > 0, `Taverns categorized: ${navMesh.pois.taverns.length} taverns registered`);
assert(navMesh.pois.churches.length > 0, `Churches categorized: ${navMesh.pois.churches.length} churches registered`);
assert(navMesh.pois.markets.length > 0, `Markets categorized: ${navMesh.pois.markets.length} markets registered`);
assert(navMesh.pois.cottages.length > 0, `Cottages categorized: ${navMesh.pois.cottages.length} cottages registered`);

// Verify 7 Dynamic Roles exist in population
console.log("\nVerifying 7 Dynamic Roles in Population...");
const roles = ["lumberjack", "water_carrier", "farmer", "merchant", "sentry", "miner", "archer", "courier", "socializer"];
for (const r of roles) {
  const count = unitManager.allUnits.filter(u => u.role === r).length;
  assert(count > 0, `Role '${r}' represented in population (count: ${count})`);
}

// --- 3. Evening (DUSK) Transition Verification ---
console.log("\nTesting Evening (Dusk) Schedule Transition...");
unitManager.setTimePhase("DUSK", 18.5);

// Run 10 ticks to let units react to dusk
for (let t = 0; t < 10; t++) {
  unitManager.update(0.1);
}

// Check that no adult units are actively chopping, dipping, or farming
const laboringUnits = unitManager.activeUnits.filter(u => !u.isAnimal && (u.isChopping || u.isDipping || u.isFarming || u.isHarvesting));
assert(laboringUnits.length === 0, `Zero units engaged in hard labor at dusk (dropped tools: ${laboringUnits.length} laboring)`);

// Check that citizens initiate evening activities (tavern, praying, well gathering, or social visit)
const eveningCitizens = unitManager.allUnits.filter(u => {
  return u.state === "TAVERN" || u.state === "PRAYING" || u.state === "GATHERING_WELL" || u.tool === "ale" || u.state === "VISITING";
});
assert(eveningCitizens.length > 0, `Villagers engaged in evening life at dusk (count: ${eveningCitizens.length} at taverns/chapels/wells)`);

// --- 4. Night Schedule Transition Verification ---
console.log("\nTesting Night Schedule Transition (Sleep & Sentry Watch)...");
unitManager.setTimePhase("NIGHT", 23.0);

// Run 15 ticks for units to route to cottages or start night patrol
for (let t = 0; t < 15; t++) {
  unitManager.update(0.1);
}

const sentries = unitManager.allUnits.filter(u => u.role === "sentry");
const activeSentries = sentries.filter(u => u.tool === "torch" || u.state === "PATROLLING_NIGHT" || u.state === "PATROLLING");
assert(activeSentries.length > 0, `Sentries guarding perimeter with torches at night (count: ${activeSentries.length})`);

const humanCount = unitManager.allUnits.filter(u => !u.isAnimal && u.role !== "sentry").length;
const sleepingOrHeadingHome = unitManager.allUnits.filter(u => !u.isAnimal && u.role !== "sentry" && (u.isResting || u.state === "SLEEPING" || u.nextStateOnArrival === "SLEEPING"));
assert(sleepingOrHeadingHome.length >= (humanCount * 0.8), `Majority of human citizens resting/sleeping at night (${sleepingOrHeadingHome.length} / ${humanCount})`);

// --- 5. Dawn / Day Schedule Transition ---
console.log("\nTesting Dawn & Day Wake Up...");
unitManager.setTimePhase("DAY", 10.0);
for (let t = 0; t < 15; t++) {
  unitManager.update(0.1);
}
const wakingActive = unitManager.activeUnits.filter(u => !u.isAnimal && !u.isResting);
assert(wakingActive.length > 0, `Citizens awake and active in daylight (active on-screen: ${wakingActive.length})`);

// --- 6. PerformanceLogger Telemetry Test ---
console.log("\nTesting PerformanceLogger Telemetry...");
const logger = new PerformanceLogger({ rollingWindowSize: 30 });
for (let i = 0; i < 30; i++) {
  logger.recordFrame(0.016); // ~60 FPS
  logger.recordSimTick(0.85); // 0.85ms tick
}
logger.setContext({
  activeUnits: unitManager.activeUnits.length,
  totalUnits: unitManager.allUnits.length,
  hexCount: worldData.hexList.length,
  mapSizeText: "35x35"
});

const metrics = logger.getMetrics();
assert(metrics.fpsAvg >= 55, `PerformanceLogger records ~60 FPS (measured: ${metrics.fpsAvg})`);
assert(metrics.simTickAvg < 2.0, `Simulation tick budget optimal (< 2.0ms, measured: ${metrics.simTickAvg}ms)`);
assert(metrics.nfrStatus === "OPTIMAL", `NFR status is OPTIMAL (status: ${metrics.nfrStatus})`);
assert(typeof logger.getSummaryString() === "string" && logger.getSummaryString().includes("FPS:"), "getSummaryString() outputs valid format");

console.log("\n================================================================");
console.log(`Total Day/Night & Roles QA Tests: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
if (passedTests === totalTests) {
  console.log("🏆 ALL DAY/NIGHT & 7 ROLES INVARIANTS PASSED! (0 Defects)");
}
console.log("================================================================\n");
