/**
 * livingUnitManager.js
 * Comprehensive Life Simulation and Timed Behavior Engine.
 *
 * Coordinates:
 * - Up to 250 active on-screen units (villagers, workers, children, and animals)
 * - Rest of the population resting in cottages (swapping dynamically)
 * - Timed tasks: tree cutting, water fetching, crop farming, visiting neighbors
 * - Child growth & coming of age system
 * - Grazing animals (sheep, horses, rabbits)
 */

import { getHexQuadrantLocal, getHexSubAreaLocal, getHexSubAreaWorld } from "./hexMath.js";

const FACTION_COLORS = {
  blue: 0x3b82f6,
  red: 0xef4444,
  green: 0x22c55e,
  yellow: 0xeab308,
  neutral: 0x8b5cf6
};

const FACTION_CHILD_COLORS = {
  blue: 0x93c5fd,   // Light sky blue
  green: 0x86efac,  // Soft spring green
  red: 0xfca5a5,    // Soft rose red
  yellow: 0xfde047, // Soft sunny yellow
  neutral: 0xc4b5fd
};

const ANIMAL_COLORS = {
  sheep: 0xf8fafc,
  horse: 0x92400e,
  rabbit: 0xe2e8f0
};

const NAMES_ADULT = ["Aldous", "Bram", "Cedric", "Doran", "Elric", "Fenton", "Gareth", "Harlan", "Ivor", "Jareth", "Kaelen", "Leofric", "Merek", "Niles", "Osric", "Perrin", "Rowan", "Silas", "Theron", "Ulric", "Vance", "Walden", "Yorick", "Zarek", "Aveline", "Briony", "Cora", "Elora", "Gisela", "Isolde", "Linnea", "Maeve", "Nyssa", "Rosalind", "Sorcha", "Thalia", "Vespera", "Willa"];
const NAMES_CHILD = ["Pip", "Toby", "Milo", "Leo", "Finn", "Benny", "Ollie", "Sammy", "Daisy", "Lily", "Flora", "Nell", "Poppy", "Rosie", "Ruby", "Tess"];

let nextUnitId = 1;

export class LivingUnitManager {
  constructor(worldData, navMesh, options = {}) {
    this.worldData = worldData;
    this.navMesh = navMesh;
    this.maxActiveUnits = options.maxActiveUnits || 250;
    this.simSpeed = 1.0;
    this.isPaused = false;
    this.simTimeSec = 0;

    this.allUnits = [];
    this.activeUnits = [];
    this.selectedUnit = null;

    this.timePhase = "DAY"; // "DAWN" | "DAY" | "DUSK" | "NIGHT"
    this.timeHour = 10.0;

    this.stats = {
      totalPopulation: 0,
      activeUnitsCount: 0,
      children: 0,
      lumberjacks: 0,
      waterCarriers: 0,
      farmers: 0,
      merchants: 0,
      sentries: 0,
      miners: 0,
      archers: 0,
      fishermen: 0,
      couriers: 0,
      socializers: 0,
      animals: 0
    };

    // Flat Data-Oriented (DOTS) Columnar Buffers for high-speed simulation & instancing
    this.dots = {
      posX: new Float32Array(this.maxActiveUnits),
      posY: new Float32Array(this.maxActiveUnits),
      posZ: new Float32Array(this.maxActiveUnits),
      yaw: new Float32Array(this.maxActiveUnits),
      targetYaw: new Float32Array(this.maxActiveUnits),
      speed: new Float32Array(this.maxActiveUnits),
      scale: new Float32Array(this.maxActiveUnits),
      isMoving: new Uint8Array(this.maxActiveUnits),
      isAnimal: new Uint8Array(this.maxActiveUnits)
    };

    this.initPopulation();
  }

  /**
   * Spawns population based on cottages, landmarks, and wilderness hexes
   */
  initPopulation() {
    const cottages = this.navMesh.pois.cottages;
    const forests = this.navMesh.pois.forests;
    const waterbanks = this.navMesh.pois.waterbanks;
    const farms = this.navMesh.pois.farms;

    // 1. Spawn Cottage Residents
    for (let cIdx = 0; cIdx < cottages.length; cIdx++) {
      const cottage = cottages[cIdx];
      const factionKey = cottage.node.tile.villageTheme || "blue";
      const factionColor = FACTION_COLORS[factionKey] || 0x3b82f6;

      // Each cottage has 2 adults + 1 child
      const residentsCount = 3;
      for (let r = 0; r < residentsCount; r++) {
        const isChild = (r === 2);
        let role = "socializer";
        if (!isChild) {
          const roleSlot = (cIdx * 2 + r) % 10;
          if (roleSlot === 0 && forests.length > 0) role = "lumberjack";
          else if (roleSlot === 1 && waterbanks.length > 0) role = "water_carrier";
          else if (roleSlot === 2 && farms.length > 0) role = "farmer";
          else if (roleSlot === 3) role = "merchant";
          else if (roleSlot === 4) role = "sentry";
          else if (roleSlot === 5) role = "miner";
          else if (roleSlot === 6) role = "archer";
          else if (roleSlot === 7 && waterbanks.length > 0) role = "fisherman";
          else if (roleSlot === 8) role = "courier";
          else role = "socializer";
        } else {
          role = "child";
        }

        const nameList = isChild ? NAMES_CHILD : NAMES_ADULT;
        const vTitle = cottage.node.tile.villageName || (cottage.node.tile.villageRole ? "Oakvale" : "the Realm");
        const name = nameList[Math.floor(Math.random() * nameList.length)] + (isChild ? "" : " of " + vTitle);

        const unit = {
          id: nextUnitId++,
          name,
          role,
          isChild,
          isAnimal: false,
          isAlive: true,
          isResting: true, // Will be activated up to maxActiveUnits
          scale: isChild ? 0.15 : 0.26,
          ageProgress: isChild ? (0.2 + Math.random() * 0.5) : 1.0,
          seed: Math.random() * 100,

          // Position & Orientation
          x: cottage.worldX,
          y: cottage.worldY,
          z: cottage.worldZ,
          facingY: Math.random() * Math.PI * 2,
          currentHexNode: cottage.node,

          // Home base
          homeCottage: cottage,

          // Colors: Cohesive village faction tunic colors
          tunicColor: isChild ? (FACTION_CHILD_COLORS[factionKey] || 0x93c5fd) : factionColor,
          hairColor: Math.random() > 0.5 ? 0xfef08a : (Math.random() > 0.5 ? 0x92400e : 0x1c1917),
          toolColor: 0x78716c,

          // State Machine
          state: "IDLE",
          stateTimer: 1.0 + Math.random() * 3.0,
          isMoving: false,
          isChopping: false,
          isDipping: false,
          isFarming: false,
          tool: null, // "axe", "bucket", "water_bucket", "hoe", "timber"

          // Path & Steering
          path: [],
          pathIndex: 0,
          targetPOI: null,
          speed: isChild ? 1.2 : 0.95
        };

        cottage.residents.push(unit);
        this.allUnits.push(unit);
      }
    }

    // 2. Spawn Wilderness Animals (Sheep, Horses, Rabbits)
    const animalTypes = ["sheep", "sheep", "horse", "rabbit", "rabbit"];
    const eligibleWildNodes = Array.from(this.navMesh.nodes.values()).filter(n => {
      return !n.isWater && !n.isPeak && !n.tile.isVillage && n.elevation <= 1.0;
    });

    const animalCount = Math.min(60, Math.max(15, Math.floor(eligibleWildNodes.length * 0.08)));
    for (let i = 0; i < animalCount; i++) {
      const node = eligibleWildNodes[Math.floor(Math.random() * eligibleWildNodes.length)];
      const type = animalTypes[i % animalTypes.length];
      const isHorse = (type === "horse");

      // Horses spawn in any of the 6 radial quadrants (0 to 5)
      // Other animals spawn across sectors 0 to 6
      const subArea = isHorse
        ? getHexSubAreaLocal(Math.floor(Math.random() * 6), 0.40 + Math.random() * 0.16)
        : getHexSubAreaLocal('random', 0.40 + Math.random() * 0.16);
      const initX = node.worldX + subArea.x;
      const initZ = node.worldZ + subArea.z;
      const initFacing = (subArea.areaIndex < 6)
        ? subArea.angleRad + (Math.random() - 0.5) * 0.5
        : Math.random() * Math.PI * 2;
      const initSector = subArea.areaIndex;

      const animal = {
        id: nextUnitId++,
        name: type.charAt(0).toUpperCase() + type.slice(1),
        role: "animal",
        type,
        isAnimal: true,
        isAlive: true,
        isResting: false,
        scale: isHorse ? 0.35 : (type === "sheep" ? 0.24 : 0.14),
        seed: Math.random() * 100,

        x: initX,
        y: node.worldY,
        z: initZ,
        facingY: initFacing,
        currentHexNode: node,
        currentSector: initSector,
        currentQuadrant: initSector,

        colorHex: ANIMAL_COLORS[type] || 0xffffff,
        state: "GRAZING",
        stateTimer: 3.0 + Math.random() * 4.0,
        isMoving: false,
        isGrazing: true,

        path: [],
        pathIndex: 0,
        speed: isHorse ? 1.35 : (type === "rabbit" ? 1.6 : 0.7)
      };

      this.allUnits.push(animal);
    }

    // 3. Populate Active Pool (initial daytime pool)
    for (const u of this.allUnits) {
      if (!u.isAnimal) {
        u.isResting = false;
        u.state = "IDLE";
      }
    }
    this.refreshActivePool();
    this.updateStats();
  }

  refreshActivePool() {
    this.activeUnits = [];

    // All active animals
    for (const u of this.allUnits) {
      if (u.isAnimal && !u.isResting) {
        this.activeUnits.push(u);
      }
    }

    // Outdoor humans: only units that are NOT resting or sleeping inside cottages
    for (const u of this.allUnits) {
      if (!u.isAnimal && u.isAlive && !u.isResting && u.state !== 'SLEEPING') {
        if (this.activeUnits.length < this.maxActiveUnits) {
          this.activeUnits.push(u);
        } else {
          u.isResting = true;
        }
      }
    }

    // Synchronize DOTS contiguous columnar buffers
    const activeCount = this.activeUnits.length;
    for (let i = 0; i < activeCount; i++) {
      const u = this.activeUnits[i];
      u.dotsIndex = i;
      this.dots.posX[i] = u.x;
      this.dots.posY[i] = u.y;
      this.dots.posZ[i] = u.z;
      this.dots.yaw[i] = u.facingY;
      this.dots.targetYaw[i] = u.facingY;
      this.dots.speed[i] = u.speed;
      this.dots.scale[i] = u.scale;
      this.dots.isMoving[i] = u.isMoving ? 1 : 0;
      this.dots.isAnimal[i] = u.isAnimal ? 1 : 0;
    }
  }

  /**
   * Wakes a resting citizen immediately and adds them to the active on-screen pool
   */
  wakeUnit(unit) {
    if (!unit || !unit.isResting) return;
    if (this.activeUnits.length >= this.maxActiveUnits) {
      const candidateToRest = this.activeUnits.find(u => !u.isAnimal && u !== unit && u !== this.selectedUnit && u.state === "IDLE");
      if (candidateToRest) {
        candidateToRest.isResting = true;
      }
    }
    unit.isResting = false;
    this.refreshActivePool();
  }

  /**
   * Returns human-readable real-time activity status for a unit
   */
  getUnitActivityText(unit) {
    if (!unit) return '';
    if (unit.isResting || unit.state === 'SLEEPING') return 'Asleep inside village cottage';
    if (unit.isAnimal) {
      const sec = (unit.currentSector !== null && unit.currentSector !== undefined) ? unit.currentSector : unit.currentQuadrant;
      const secText = (sec !== null && sec !== undefined)
        ? (sec === 6 ? ' near hex center' : ` in sector ${sec + 1}`)
        : '';
      return unit.isGrazing ? `Grazing on wild meadow grass${secText}` : `Trotting across open terrain${secText}`;
    }

    // When actively walking to a destination, describe the purpose of the journey
    if (unit.state === 'WALKING') {
      const dest = unit.nextStateOnArrival;
      if (dest === 'CHOPPING_WOOD') return 'Walking to forest grove to chop timber';
      if (dest === 'FETCHING_WATER') return 'Walking to riverbank to fetch fresh water';
      if (dest === 'HARVESTING_CROP') return 'Walking to wheat field to harvest ripe grain';
      if (dest === 'PLANTING_CROP' || dest === 'PLANTING_FARM') return 'Walking to farm plot to plant seeds';
      if (dest === 'CULTIVATING_CROP') return 'Walking to field to tend growing crops';
      if (dest === 'DELIVERING_WOOD') return 'Carrying timber bundle back to village';
      if (dest === 'DELIVERING_WATER') return 'Carrying filled water bucket to village';
      if (dest === 'DELIVERING_GRAIN') return 'Carrying harvested grain to storage';
      if (dest === 'DELIVERING_FISH') return 'Carrying fresh fish catch to village';
      if (dest === 'DELIVERING_STONE') return 'Hauling quarried stone to workshop';
      if (dest === 'DELIVERING_DISPATCH') return 'Riding fast courier dispatch to destination';
      if (dest === 'MINING') return 'Heading to quarry with mining pickaxe';
      if (dest === 'FISHING') return 'Heading to river dock to cast fishing line';
      if (dest === 'TRADING') return 'Guiding trade wares to the market';
      if (dest === 'TAVERN') return 'Heading to the tavern for a drink';
      if (dest === 'PRAYING') return 'Walking to chapel for evening prayers';
      if (dest === 'GATHERING_WELL') return 'Heading to the well to meet neighbors';
      if (dest === 'ARCHERY_PRACTICE') return 'Heading to archery range for practice';
      if (dest === 'PATROLLING' || dest === 'PATROLLING_NIGHT') return 'Walking patrol route around perimeter';
      if (dest === 'SLEEPING') return 'Heading home to rest for the night';
      if (dest === 'GRAZING') return 'Trotting across open terrain';
      if (dest === 'IDLE' && unit.isHeadingHome) return 'Heading home for a short rest';
      if (dest === 'IDLE') return unit.isChild ? 'Skipping and exploring village paths' : 'Strolling around the village';
      return unit.isChild ? 'Skipping and exploring village paths' : 'Walking along road network';
    }

    // Evening & Spiritual activities
    if (unit.state === 'TAVERN') return 'Drinking ale and laughing with friends at the tavern';
    if (unit.state === 'PRAYING') return 'Attending evening prayer and hymns at the chapel';
    if (unit.state === 'GATHERING_WELL') return 'Sharing stories and gossip by the village well';
    if (unit.state === 'PATROLLING_NIGHT') return 'Guarding village perimeter with burning torch';

    // Profession tasks
    if (unit.state === 'PATROLLING') return 'Patrolling perimeter gates with spear and shield';
    if (unit.state === 'ARCHERY_PRACTICE') return 'Practicing marksmanship at the archery range';
    if (unit.state === 'MINING') return 'Quarrying stone and iron at the mountain foothills';
    if (unit.state === 'FISHING') return 'Casting fishing line at the water bank';
    if (unit.state === 'TRADING') return 'Guiding trade caravan between village markets';
    if (unit.state === 'DELIVERING_DISPATCH') return 'Riding fast courier dispatch along the highway';

    if (unit.isChopping) return 'Chopping timber in forest grove';
    if (unit.isDipping) return 'Fetching fresh water at riverbank';
    if (unit.isHarvesting) return 'Harvesting golden ripe wheat';
    if (unit.isFarming) {
      return (unit.state === 'CULTIVATING_CROP') ? 'Cultivating and tending growing wheat' : 'Hoeing soil and planting wheat seeds';
    }

    // Carried tools
    if (unit.tool === 'ale') return 'Drinking foaming ale at the tavern';
    if (unit.tool === 'torch') return 'Holding torch on night sentry watch';
    if (unit.tool === 'spear') return 'Standing guard with faction spear';
    if (unit.tool === 'pickaxe') return 'Heading to quarry with mining pick';
    if (unit.tool === 'stone') return 'Hauling quarried stone to workshop';
    if (unit.tool === 'bow') return 'Training with recurve bow';
    if (unit.tool === 'rod') return 'Heading to river dock to fish';
    if (unit.tool === 'fish') return 'Delivering fresh river catch to village';
    if (unit.tool === 'pack') return 'Transporting trade wares along the road';
    if (unit.tool === 'scroll') return 'Delivering sealed royal dispatch';
    if (unit.tool === 'timber') return unit.isMoving ? 'Carrying timber bundle back to cottage' : 'Delivering timber bundle to cottage';
    if (unit.tool === 'water_bucket') return unit.isMoving ? 'Carrying filled water bucket to village' : 'Delivering fresh water to village';
    if (unit.tool === 'sheaf') return unit.isMoving ? 'Carrying harvested golden grain to village' : 'Delivering golden grain to village';
    if (unit.tool === 'axe') return unit.isMoving ? 'Heading to forest grove to gather wood' : 'Resting in village';
    if (unit.tool === 'bucket') return unit.isMoving ? 'Heading to riverbank to fetch fresh water' : 'Resting in village';
    if (unit.tool === 'sickle') return unit.isMoving ? 'Approaching golden wheat field to harvest' : 'Resting in village';
    if (unit.tool === 'hoe') return unit.isMoving ? 'Heading to farm plot with hoe' : 'Resting in village';
    if (unit.isMoving) return unit.isChild ? 'Skipping and exploring paths' : 'Walking along road network';

    if (unit.isChild) {
      const secText = (unit.currentSector !== null && unit.currentSector !== undefined && unit.currentSector < 6)
        ? ` (sector ${unit.currentSector + 1})` : '';
      return `Playing and exploring village grounds${secText}`;
    }
    const secText = (unit.currentSector !== null && unit.currentSector !== undefined && unit.currentSector < 6)
      ? ` in sector ${unit.currentSector + 1}` : '';
    return `Resting and socializing in village${secText}`;
  }

  updateStats() {
    let ch = 0, lj = 0, wc = 0, fa = 0, me = 0, se = 0, mi = 0, ar = 0, fi = 0, co = 0, so = 0, an = 0;
    for (const u of this.allUnits) {
      if (u.isAnimal) an++;
      else if (u.role === "child") ch++;
      else if (u.role === "lumberjack") lj++;
      else if (u.role === "water_carrier") wc++;
      else if (u.role === "farmer") fa++;
      else if (u.role === "merchant") me++;
      else if (u.role === "sentry") se++;
      else if (u.role === "miner") mi++;
      else if (u.role === "archer") ar++;
      else if (u.role === "fisherman") fi++;
      else if (u.role === "courier") co++;
      else so++;
    }

    this.stats.totalPopulation = this.allUnits.length;
    this.stats.activeUnitsCount = this.activeUnits.length;
    this.stats.children = ch;
    this.stats.lumberjacks = lj;
    this.stats.waterCarriers = wc;
    this.stats.farmers = fa;
    this.stats.merchants = me;
    this.stats.sentries = se;
    this.stats.miners = mi;
    this.stats.archers = ar;
    this.stats.fishermen = fi;
    this.stats.couriers = co;
    this.stats.socializers = so;
    this.stats.animals = an;
  }

  /**
   * Main Simulation Step
   * @param {number} rawDeltaTimeSec - Real-world frame delta time in seconds
   */
  update(rawDeltaTimeSec) {
    if (this.isPaused) return;

    // Clamp delta time to avoid large jumps during tab defocus
    const dt = Math.min(0.08, rawDeltaTimeSec) * this.simSpeed;
    this.simTimeSec += dt;

    for (let i = 0; i < this.activeUnits.length; i++) {
      const u = this.activeUnits[i];
      if (!u.isAlive || u.isResting) continue;

      if (u.isAnimal) {
        this.updateAnimal(u, dt);
      } else {
        this.updateHuman(u, dt);
      }
    }

    // Wakeup pass: resting units with expired timers re-join the active pool.
    // Only runs every 4th frame to avoid iterating allUnits every tick.
    if (Math.floor(this.simTimeSec * 30) % 4 === 0) {
      let needsRefresh = false;
      for (const u of this.allUnits) {
        if (u.isResting && u.restingUntil !== undefined && this.simTimeSec >= u.restingUntil) {
          u.isResting = false;
          u.restingUntil = undefined;
          u.state = "IDLE";
          u.stateTimer = 0.5 + Math.random();
          needsRefresh = true;
        }
      }
      if (needsRefresh) this.refreshActivePool();
    }

    // Natural crop growth progression over time
    if (this.navMesh && this.navMesh.pois && this.navMesh.pois.farms) {
      for (const farm of this.navMesh.pois.farms) {
        if (farm.state === "PLANTED" || farm.state === "GROWING") {
          farm.cropGrowth = (farm.cropGrowth || 0.1) + dt * 0.035;
          if (farm.cropGrowth >= 1.0) {
            farm.cropGrowth = 1.0;
            farm.state = "RIPE";
          } else if (farm.cropGrowth > 0.4) {
            farm.state = "GROWING";
          }
        }
      }
    }
  }

  /**
   * Sets the current celestial time phase and synchronizes unit schedules
   * @param {string} phase - "DAWN" | "DAY" | "DUSK" | "NIGHT"
   * @param {number} hour - 0.0 to 24.0
   */
  setTimePhase(phase, hour) {
    const oldPhase = this.timePhase;
    this.timePhase = phase;
    this.timeHour = hour;

    if (oldPhase !== phase) {
      this.handlePhaseTransition(phase, oldPhase);
    }
  }

  handlePhaseTransition(newPhase, oldPhase) {
    for (let i = 0; i < this.allUnits.length; i++) {
      const u = this.allUnits[i];
      if (!u.isAlive || u.isAnimal) continue;

      if (newPhase === "DUSK") {
        // Evening bell: workers finish current labor and stow working tools
        u.isChopping = false;
        u.isDipping = false;
        u.isFarming = false;
        u.isHarvesting = false;
        if (u.targetFarm) {
          u.targetFarm.assignedFarmer = null;
          u.targetFarm = null;
        }

        if (u.role !== "sentry") {
          u.tool = null;
          if (u.state !== "WALKING") {
            u.state = "IDLE";
            u.stateTimer = 0.2 + Math.random() * 2.0;
          }
        }
      } else if (newPhase === "NIGHT") {
        // Bedtime: sentries, hunters, night workers, and late socializers stay active; majority go home to sleep
        if (u.role === "sentry") {
          u.isResting = false;
          u.state = "PATROLLING_NIGHT";
          u.tool = "torch";
          u.toolColor = 0xf59e0b;
        } else if (u.role === "archer") {
          // Hunters / archers keep night watch or practice archery
          u.isResting = false;
          u.tool = "bow";
          u.toolColor = 0x78350f;
          if (u.state !== "WALKING") {
            u.state = "ARCHERY_PRACTICE";
            u.stateTimer = 5.0 + Math.random() * 5.0;
          }
        } else if ((u.role === "miner" || u.role === "water_carrier") && (u.id % 6 === 0)) {
          // Dedicated night shift workers (quarry miner or water carrier)
          u.isResting = false;
          if (u.role === "miner") {
            u.tool = "pickaxe";
            u.toolColor = 0x64748b;
          } else {
            u.tool = "bucket";
            u.toolColor = 0xca8a04;
          }
        } else if (u.role === "socializer" && (u.id % 5 === 0)) {
          // Late night socializers hanging around taverns or church
          u.isResting = false;
          if (this.navMesh.pois.taverns && this.navMesh.pois.taverns.length > 0 && Math.random() < 0.6) {
            u.state = "TAVERN";
            u.tool = "ale";
            u.toolColor = 0xfbbf24;
          } else if (this.navMesh.pois.churches && this.navMesh.pois.churches.length > 0) {
            u.state = "PRAYING";
            u.tool = null;
          } else {
            u.state = "GATHERING_WELL";
            u.tool = null;
          }
          u.stateTimer = 6.0 + Math.random() * 6.0;
        } else {
          // 80%+ of citizens head to cottage to sleep inside
          u.tool = null;
          if (u.homeCottage) {
            this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "SLEEPING", 10.0, () => {
              u.isResting = true;
              u.isMoving = false;
              this.refreshActivePool();
            });
          } else {
            u.isResting = true;
            u.state = "SLEEPING";
          }
        }
      } else if (newPhase === "DAWN" || newPhase === "DAY") {
        // Morning wake up: resting citizens wake up and rejoin daily activities
        u.isResting = false;
        if (u.state === "SLEEPING" || u.state === "PATROLLING_NIGHT" || u.state === "TAVERN" || u.state === "PRAYING" || u.state === "GATHERING_WELL") {
          u.state = "IDLE";
          u.stateTimer = 0.5 + Math.random() * 2.0;
        }
        if (u.role === "sentry") {
          u.tool = "spear";
          u.toolColor = 0x94a3b8;
        }
      }
    }

    this.refreshActivePool();
  }

  /**
   * State Machine for Human Villagers & Children
   */
  updateHuman(u, dt) {
    // Child Growth / Aging
    if (u.role === "child") {
      u.ageProgress += (dt * 0.015); // Takes ~60-90s to grow up
      if (u.ageProgress >= 1.0) {
        this.growUpChild(u);
      }
    }

    if (u.state === "WALKING") {
      this.stepAlongPath(u, dt);
      return;
    }

    // State Timer Countdown
    u.stateTimer -= dt;
    if (u.stateTimer > 0) return;

    // --- State Transitions ---
    switch (u.state) {
      case "IDLE":
        this.decideNextHumanTask(u);
        break;

      case "CHOPPING_WOOD":
        // Finished chopping: gain wood bundle, return to home/village
        u.isChopping = false;
        u.tool = "timber";
        u.toolColor = 0x78350f;
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "DELIVERING_WOOD");
        break;

      case "DELIVERING_WOOD":
        // Dropped wood off at cottage
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "FETCHING_WATER":
        // Finished dipping: bucket is full, walk back to home well
        u.isDipping = false;
        u.tool = "water_bucket";
        u.toolColor = 0x38bdf8;
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "DELIVERING_WATER");
        break;

      case "DELIVERING_WATER":
        // Emptied water into home kitchen/well
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "PLANTING_CROP":
      case "PLANTING_FARM":
        // Finished hoeing/planting seeds
        u.isFarming = false;
        if (u.targetFarm) {
          u.targetFarm.state = "PLANTED";
          u.targetFarm.cropGrowth = 0.25;
          u.targetFarm.hasCrop = true;
          u.targetFarm.assignedFarmer = null;
        }
        u.tool = null;
        u.targetFarm = null;
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "IDLE", 2.0);
        break;

      case "CULTIVATING_CROP":
        // Finished tending/weeding
        u.isFarming = false;
        if (u.targetFarm) {
          u.targetFarm.cropGrowth = Math.min(1.0, (u.targetFarm.cropGrowth || 0.3) + 0.35);
          if (u.targetFarm.cropGrowth >= 1.0) {
            u.targetFarm.state = "RIPE";
          } else {
            u.targetFarm.state = "GROWING";
          }
          u.targetFarm.hasCrop = true;
          u.targetFarm.assignedFarmer = null;
        }
        u.tool = null;
        u.targetFarm = null;
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "IDLE", 2.0);
        break;

      case "HARVESTING_CROP":
        // Finished harvesting ripe golden grain
        u.isHarvesting = false;
        if (u.targetFarm) {
          u.targetFarm.state = "TILLED";
          u.targetFarm.cropGrowth = 0.0;
          u.targetFarm.hasCrop = false;
          u.targetFarm.assignedFarmer = null;
        }
        u.tool = "sheaf"; // Golden wheat sheaf!
        u.toolColor = 0xeab308;
        u.targetFarm = null;
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "DELIVERING_GRAIN", 2.0);
        break;

      case "DELIVERING_GRAIN":
        // Unloaded harvested wheat at cottage/village
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "VISITING":
        // Finished chat with neighbor, head back or stroll
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 3.0;
        break;

      case "TAVERN":
        // Finished drinking ale, relax in village
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "PRAYING":
        // Finished prayer at chapel
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "GATHERING_WELL":
        // Finished social chat at well
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "TRADING":
        // Finished trading at market
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.5 + Math.random() * 2.5;
        break;

      case "PATROLLING":
      case "PATROLLING_NIGHT":
        // Sentry patrol waypoint reached, pause on watch
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 3.0;
        break;

      case "MINING":
        // Finished mining rock: haul stone back to workshop or cottage
        u.tool = "stone";
        u.toolColor = 0x475569;
        const blacksmith = (this.navMesh.pois.blacksmiths && this.navMesh.pois.blacksmiths.length > 0) ? this.navMesh.pois.blacksmiths[0] : u.homeCottage;
        if (blacksmith) {
          this.routeUnitTo(u, blacksmith.worldX, blacksmith.worldZ, "DELIVERING_STONE");
        } else {
          u.state = "IDLE";
          u.stateTimer = 2.0;
        }
        break;

      case "DELIVERING_STONE":
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "ARCHERY_PRACTICE":
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "FISHING":
        u.tool = "fish";
        u.toolColor = 0x38bdf8;
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "DELIVERING_FISH");
        break;

      case "DELIVERING_FISH":
        u.tool = null;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "DELIVERING_DISPATCH":
        u.tool = null;
        u.speed = 0.95;
        u.state = "IDLE";
        u.stateTimer = 2.0 + Math.random() * 2.0;
        break;

      case "SLEEPING":
        u.tool = null;
        u.state = "SLEEPING";
        u.stateTimer = 6.0 + Math.random() * 4.0;
        break;

      default:
        u.state = "IDLE";
        u.stateTimer = 2.0;
        break;
    }
  }

  patrolSentry(u, isNight = false) {
    u.tool = isNight ? "torch" : "spear";
    u.toolColor = isNight ? 0xf59e0b : 0x94a3b8;
    const startNode = u.currentHexNode || (u.homeCottage ? u.homeCottage.node : null);
    if (!startNode || !startNode.neighbors || startNode.neighbors.length === 0) {
      u.state = isNight ? "PATROLLING_NIGHT" : "PATROLLING";
      u.stateTimer = 3.0;
      return;
    }

    // Spread sentries by combining their id with the simTime to pick different neighbors each call.
    // Do a 1–2 hop walk so sentries spread around the full perimeter, not just one adjacent tile.
    const hops = 1 + (u.id % 2); // alternates: even IDs 1 hop, odd IDs 2 hops
    let targetNode = startNode;
    for (let hop = 0; hop < hops; hop++) {
      if (!targetNode.neighbors || targetNode.neighbors.length === 0) break;
      // Use id-seeded offset into the neighbor list so different sentries pick different directions
      const offset = (u.id + hop * 3 + Math.floor(this.simTimeSec * 0.1)) % targetNode.neighbors.length;
      const candidateEdge = targetNode.neighbors[offset];
      const candidate = candidateEdge ? candidateEdge.node : null;
      if (candidate && !candidate.isWater && !candidate.isPeak) {
        targetNode = candidate;
      }
    }

    const sector = (u.id + Math.floor(this.simTimeSec)) % 6;
    const sub = getHexSubAreaWorld(targetNode, sector, 0.40);
    const nextState = isNight ? "PATROLLING_NIGHT" : "PATROLLING";
    this.routeUnitTo(u, sub.x, sub.z, nextState, 4.0 + Math.random() * 3.0, () => {
      u.currentSector = sub.areaIndex;
    });
  }

  /**
   * Selects the next daily task for a human based on their role
   */
  decideNextHumanTask(u) {
    // 1. Night Schedule: Sentries, hunters, night workers, and late socializers stay active; majority sleep in cottages
    if (this.timePhase === "NIGHT") {
      if (u.role === "sentry") {
        this.patrolSentry(u, true);
        return;
      }

      if (u.role === "archer") {
        const ranges = this.navMesh.pois.archeryRanges;
        if (ranges && ranges.length > 0 && Math.random() < 0.6) {
          const targetR = ranges[Math.floor(Math.random() * ranges.length)];
          u.tool = "bow";
          u.toolColor = 0x78350f;
          this.routeUnitTo(u, targetR.worldX, targetR.worldZ, "ARCHERY_PRACTICE", 5.0 + Math.random() * 3.0);
        } else {
          this.patrolSentry(u, true);
        }
        return;
      }

      if ((u.role === "miner" || u.role === "water_carrier") && (u.id % 6 === 0)) {
        if (u.role === "miner") {
          const quarries = this.navMesh.pois.quarries;
          const res = this.findReachablePOI(u, quarries, 2);
          if (res) {
            u.tool = "pickaxe";
            u.toolColor = 0x64748b;
            this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "MINING", 5.0, () => {
              u.tool = "stone";
              u.toolColor = 0x475569;
            }, res.path);
          } else {
            this.strollAroundVillage(u);
          }
        } else {
          const spots = (this.navMesh.pois.wells && this.navMesh.pois.wells.length > 0) ? this.navMesh.pois.wells : this.navMesh.pois.waterbanks;
          const res = this.findReachablePOI(u, spots, 2);
          if (res) {
            u.tool = "bucket";
            u.toolColor = 0xca8a04;
            this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "FETCHING_WATER", 3.5, () => {
              u.isDipping = true;
            }, res.path);
          } else {
            this.strollAroundVillage(u);
          }
        }
        return;
      }

      if (u.role === "socializer" && (u.id % 5 === 0)) {
        if (this.navMesh.pois.taverns && this.navMesh.pois.taverns.length > 0 && Math.random() < 0.6) {
          const tavern = this.findNearestPOI(u, this.navMesh.pois.taverns);
          if (tavern) {
            const ox = (Math.random() - 0.5) * 0.35;
            const oz = (Math.random() - 0.5) * 0.35;
            u.tool = "ale";
            u.toolColor = 0xfbbf24;
            this.routeUnitTo(u, tavern.worldX + ox, tavern.worldZ + oz, "TAVERN", 6.0 + Math.random() * 4.0);
            return;
          }
        } else if (this.navMesh.pois.churches && this.navMesh.pois.churches.length > 0) {
          const church = this.findNearestPOI(u, this.navMesh.pois.churches);
          if (church) {
            const ox = (Math.random() - 0.5) * 0.35;
            const oz = (Math.random() - 0.5) * 0.35;
            u.tool = null;
            this.routeUnitTo(u, church.worldX + ox, church.worldZ + oz, "PRAYING", 6.0 + Math.random() * 4.0);
            return;
          }
        }
        this.strollAroundVillage(u);
        return;
      }

      // Remaining 75-85% of citizens head to cottage and sleep inside
      u.tool = null;
      if (u.homeCottage) {
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "SLEEPING", 10.0, () => {
          u.isResting = true;
          u.isMoving = false;
          this.refreshActivePool();
        });
      } else {
        u.isResting = true;
        u.state = "SLEEPING";
        u.stateTimer = 8.0;
      }
      return;
    }

    // 2. Dusk Schedule: Off-duty workers & citizens visit taverns, churches, or wells
    if (this.timePhase === "DUSK") {
      if (u.role === "sentry") {
        this.patrolSentry(u, false);
        return;
      }

      const pEvening = Math.random();
      if (pEvening < 0.40 && this.navMesh.pois.taverns && this.navMesh.pois.taverns.length > 0) {
        const tavern = this.findNearestPOI(u, this.navMesh.pois.taverns);
        if (tavern) {
          const ox = (Math.random() - 0.5) * 0.35;
          const oz = (Math.random() - 0.5) * 0.35;
          u.tool = "ale";
          u.toolColor = 0xb45309;
          this.routeUnitTo(u, tavern.worldX + ox, tavern.worldZ + oz, "TAVERN", 6.0 + Math.random() * 4.0);
          return;
        }
      } else if (pEvening < 0.65 && this.navMesh.pois.churches && this.navMesh.pois.churches.length > 0) {
        const church = this.findNearestPOI(u, this.navMesh.pois.churches);
        if (church) {
          const ox = (Math.random() - 0.5) * 0.35;
          const oz = (Math.random() - 0.5) * 0.35;
          u.tool = null;
          this.routeUnitTo(u, church.worldX + ox, church.worldZ + oz, "PRAYING", 6.0 + Math.random() * 4.0);
          return;
        }
      } else if (pEvening < 0.85 && ((this.navMesh.pois.wells && this.navMesh.pois.wells.length > 0) || (this.navMesh.pois.plazas && this.navMesh.pois.plazas.length > 0))) {
        const well = this.findNearestPOI(u, this.navMesh.pois.wells) || this.findNearestPOI(u, this.navMesh.pois.plazas);
        if (well) {
          const ox = (Math.random() - 0.5) * 0.40;
          const oz = (Math.random() - 0.5) * 0.40;
          u.tool = null;
          this.routeUnitTo(u, well.worldX + ox, well.worldZ + oz, "GATHERING_WELL", 5.0 + Math.random() * 3.0);
          return;
        }
      }
      this.strollAroundVillage(u);
      return;
    }

    // 3. Daytime & Dawn Schedules
    if (u.role === "lumberjack") {
      // Find reachable forest
      const res = this.findReachablePOI(u, this.navMesh.pois.forests, 2);
      if (res) {
        u.tool = "axe";
        u.toolColor = 0x94a3b8;
        this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "CHOPPING_WOOD", 5.0, () => {
          u.isChopping = true;
        }, res.path);
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "water_carrier") {
      // Find reachable waterbank
      const res = this.findReachablePOI(u, this.navMesh.pois.waterbanks, 2);
      if (res) {
        u.tool = "bucket";
        u.toolColor = 0xca8a04;
        this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "FETCHING_WATER", 3.5, () => {
          u.isDipping = true;
        }, res.path);
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "farmer") {
      // If currently carrying harvested sheaf, deliver it to home or storage
      if (u.tool === "sheaf") {
        this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "DELIVERING_GRAIN", 2.0);
        return;
      }

      const allFarms = this.navMesh.pois.farms;
      if (allFarms && allFarms.length > 0) {
        // Filter to nearby farms within 14 units of current position or home cottage
        const localFarms = allFarms.filter(f => Math.hypot(f.worldX - u.x, f.worldZ - u.z) < 14);
        const candidateFarms = localFarms.length > 0 ? localFarms : allFarms;

        // Priority 1: Harvest Ripe Crops (reachable)
        const ripeFarms = candidateFarms.filter(f => f.state === "RIPE" && (!f.assignedFarmer || f.assignedFarmer === u));
        const reachableRipe = this.findReachablePOI(u, ripeFarms, 2);
        if (reachableRipe) {
          reachableRipe.poi.assignedFarmer = u;
          u.targetFarm = reachableRipe.poi;
          u.tool = "sickle";
          u.toolColor = 0xa8a29e;
          this.routeUnitTo(u, reachableRipe.poi.worldX, reachableRipe.poi.worldZ, "HARVESTING_CROP", 4.5, () => {
            u.isHarvesting = true;
            u.isFarming = false;
          }, reachableRipe.path);
          return;
        }

        // Priority 2: Plant Empty/Tilled Farm Plots (reachable)
        const emptyFarms = candidateFarms.filter(f => (f.state === "TILLED" || !f.state) && (!f.assignedFarmer || f.assignedFarmer === u));
        const reachableEmpty = this.findReachablePOI(u, emptyFarms, 2);
        if (reachableEmpty) {
          reachableEmpty.poi.assignedFarmer = u;
          u.targetFarm = reachableEmpty.poi;
          u.tool = "hoe";
          u.toolColor = 0x78716c;
          this.routeUnitTo(u, reachableEmpty.poi.worldX, reachableEmpty.poi.worldZ, "PLANTING_CROP", 5.0, () => {
            u.isFarming = true;
            u.isHarvesting = false;
          }, reachableEmpty.path);
          return;
        }

        // Priority 3: Cultivate / Tend Growing Crops (reachable)
        const growingFarms = candidateFarms.filter(f => (f.state === "PLANTED" || f.state === "GROWING") && (!f.assignedFarmer || f.assignedFarmer === u));
        const reachableGrowing = this.findReachablePOI(u, growingFarms, 2);
        if (reachableGrowing) {
          reachableGrowing.poi.assignedFarmer = u;
          u.targetFarm = reachableGrowing.poi;
          u.tool = "hoe";
          u.toolColor = 0x78716c;
          this.routeUnitTo(u, reachableGrowing.poi.worldX, reachableGrowing.poi.worldZ, "CULTIVATING_CROP", 4.0, () => {
            u.isFarming = true;
            u.isHarvesting = false;
          }, reachableGrowing.path);
          return;
        }
      }

      this.strollAroundVillage(u);

    } else if (u.role === "merchant") {
      const markets = (this.navMesh.pois.markets && this.navMesh.pois.markets.length > 0) ? this.navMesh.pois.markets : this.navMesh.pois.plazas;
      if (markets && markets.length > 0) {
        const dest = markets.find(m => Math.hypot(m.worldX - u.x, m.worldZ - u.z) > 4.0) || markets[0];
        u.tool = "pack";
        u.toolColor = 0xb45309;
        this.routeUnitTo(u, dest.worldX, dest.worldZ, "TRADING", 5.0 + Math.random() * 3.0, () => {
          u.tool = null;
        });
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "sentry") {
      this.patrolSentry(u, false);

    } else if (u.role === "miner") {
      const quarries = this.navMesh.pois.quarries;
      const res = this.findReachablePOI(u, quarries, 2);
      if (res) {
        u.tool = "pickaxe";
        u.toolColor = 0x64748b;
        this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "MINING", 5.0, () => {
          u.tool = "stone";
          u.toolColor = 0x475569;
        }, res.path);
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "archer") {
      const ranges = this.navMesh.pois.archeryRanges;
      if (ranges && ranges.length > 0) {
        const targetR = ranges[Math.floor(Math.random() * ranges.length)];
        u.tool = "bow";
        u.toolColor = 0x78350f;
        this.routeUnitTo(u, targetR.worldX, targetR.worldZ, "ARCHERY_PRACTICE", 5.0 + Math.random() * 3.0);
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "fisherman") {
      const spots = (this.navMesh.pois.docks && this.navMesh.pois.docks.length > 0) ? this.navMesh.pois.docks : this.navMesh.pois.waterbanks;
      const res = this.findReachablePOI(u, spots, 2);
      if (res) {
        u.tool = "rod";
        u.toolColor = 0xca8a04;
        this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "FISHING", 5.0, () => {
          u.tool = "fish";
          u.toolColor = 0x38bdf8;
        }, res.path);
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "courier") {
      const plazas = this.navMesh.pois.plazas;
      const res = this.findReachablePOI(u, plazas, 2);
      if (res) {
        u.tool = "scroll";
        u.toolColor = 0xfef08a;
        u.speed = 1.35;
        this.routeUnitTo(u, res.poi.worldX, res.poi.worldZ, "DELIVERING_DISPATCH", 4.0, () => {
          u.tool = null;
          u.speed = 0.95;
        }, res.path);
      } else {
        this.strollAroundVillage(u);
      }

    } else if (u.role === "child") {
      // Playful skip to a nearby plaza, road, or meadow (sub-hex sector target)
      const plazas = this.navMesh.pois.plazas;
      const nearbyPlazas = plazas.filter(p => Math.hypot(p.worldX - u.x, p.worldZ - u.z) < 14);
      const targetPlaza = nearbyPlazas.length > 0 ? nearbyPlazas[Math.floor(Math.random() * nearbyPlazas.length)] : null;
      if (targetPlaza && Math.random() > 0.4) {
        const sub = getHexSubAreaWorld(targetPlaza.node || startNode, 'random', 0.36);
        this.routeUnitTo(u, sub.x, sub.z, "IDLE", 3.0, () => {
          u.currentSector = sub.areaIndex;
        });
      } else {
        this.strollAroundVillage(u);
      }

    } else {
      // Socializer: visit a nearby neighboring cottage within the village (sub-hex sector target)
      const cottages = this.navMesh.pois.cottages;
      const nearbyCottages = cottages.filter(c => c !== u.homeCottage && Math.hypot(c.worldX - u.x, c.worldZ - u.z) < 12);
      const otherCottage = nearbyCottages.length > 0 ? nearbyCottages[Math.floor(Math.random() * nearbyCottages.length)] : null;
      if (otherCottage) {
        const sub = getHexSubAreaWorld(otherCottage.node, 'random', 0.35);
        this.routeUnitTo(u, sub.x, sub.z, "VISITING", 4.0, () => {
          u.currentSector = sub.areaIndex;
        });
      } else {
        this.strollAroundVillage(u);
      }
    }
  }

  /**
   * Converts a child into a grown-up adult worker
   */
  growUpChild(u) {
    u.role = (Math.random() > 0.5) ? "farmer" : (Math.random() > 0.5 ? "lumberjack" : "water_carrier");
    u.isChild = false;
    u.scale = 0.26;
    const vTheme = u.homeCottage?.node?.tile?.villageTheme || "blue";
    u.tunicColor = FACTION_COLORS[vTheme] || 0x3b82f6;
    u.speed = 0.95;
    this.updateStats();
  }

  /**
   * Moves human around village perimeter/roads with sub-hex sector variation (0..5 and center)
   */
  strollAroundVillage(u) {
    // Clear any lingering work tool/flags so activity text matches "strolling" not "heading to work"
    u.tool = null;
    u.isChopping = false;
    u.isDipping = false;
    u.isFarming = false;
    u.isHarvesting = false;

    const startNode = u.currentHexNode || this.navMesh.findNearestNode(u.x, u.z);
    if (!startNode) {
      u.state = "IDLE";
      u.stateTimer = 2.0;
      return;
    }

    // If unit has wandered far from home cottage, guide them back towards home
    const homeDist = u.homeCottage ? Math.hypot(u.x - u.homeCottage.worldX, u.z - u.homeCottage.worldZ) : 0;
    if (homeDist > 7.0 && u.homeCottage) {
      const sub = getHexSubAreaWorld(u.homeCottage.node || startNode, 'random', 0.35);
      this.routeUnitTo(u, sub.x, sub.z, "IDLE", 2.5, () => {
        u.currentSector = sub.areaIndex;
      });
      return;
    }

    // 25% chance for idle adults near home to take a short rest (despawns them temporarily)
    // Children never rest; this only triggers when NOT already in a forced work task
    if (!u.isChild && u.homeCottage && Math.random() < 0.25) {
      u.isHeadingHome = true;
      this.routeUnitTo(u, u.homeCottage.worldX, u.homeCottage.worldZ, "IDLE", 1.0, () => {
        u.isHeadingHome = false;
        u.isResting = true;
        u.restingUntil = this.simTimeSec + 8.0 + Math.random() * 7.0; // 8–15 sec rest
        this.refreshActivePool();
      });
      return;
    }

    // Sub-hex strolling:
    // 35% chance to wander to one of the other 6 sectors or center within the CURRENT hex
    // 65% chance to route to an eligible neighbor hex, picking a random sector
    const stayInHex = Math.random() < 0.35;
    if (stayInHex) {
      const sub = getHexSubAreaWorld(startNode, 'random', 0.40);
      this.routeUnitTo(u, sub.x, sub.z, "IDLE", 2.5 + Math.random() * 2.0, () => {
        u.currentSector = sub.areaIndex;
      });
      return;
    }

    // Local stroll: prefer neighbors that stay near the village or roads
    if (startNode.neighbors && startNode.neighbors.length > 0) {
      const preferred = startNode.neighbors.filter(edge => {
        const n = edge.node;
        if (!n || n.isWater || n.isPeak) return false;
        if (!u.homeCottage) return true;
        const d = Math.hypot(n.worldX - u.homeCottage.worldX, n.worldZ - u.homeCottage.worldZ);
        return d <= 6.5;
      });

      const chosenEdge = preferred.length > 0
        ? preferred[Math.floor(Math.random() * preferred.length)]
        : startNode.neighbors[Math.floor(Math.random() * startNode.neighbors.length)];

      if (chosenEdge && chosenEdge.node) {
        const sub = getHexSubAreaWorld(chosenEdge.node, 'random', 0.42);
        this.routeUnitTo(u, sub.x, sub.z, "IDLE", 2.5 + Math.random() * 2.0, () => {
          u.currentSector = sub.areaIndex;
        });
        return;
      }
    }

    u.state = "IDLE";
    u.stateTimer = 2.0;
  }

  /**
   * State Machine for Animals (Sheep, Horses, Rabbits)
   * Roams between the 6 sub-hex sectors (0..5) and center (6)
   */
  updateAnimal(u, dt) {
    if (u.state === "WALKING") {
      this.stepAlongPath(u, dt);
      return;
    }

    u.stateTimer -= dt;
    if (u.stateTimer > 0) return;

    if (u.state === "GRAZING") {
      u.isGrazing = false;
      const startNode = u.currentHexNode;
      if (!startNode || !startNode.neighbors || startNode.neighbors.length === 0) {
        u.stateTimer = 3.0;
        return;
      }

      // 6-Sector + Center Grazing & Roaming for all animals:
      // Horses: 40% in-hex, 60% neighbor
      // Sheep: 45% in-hex, 55% neighbor
      // Rabbits: 50% in-hex, 50% neighbor
      const inHexChance = (u.type === "horse") ? 0.40 : ((u.type === "sheep") ? 0.45 : 0.50);
      const stayInHex = Math.random() < inHexChance;

      let targetNode = startNode;
      if (!stayInHex) {
        const eligible = startNode.neighbors.filter(edge => !edge.node.isWater && !edge.node.isPeak && !edge.node.tile.isVillage);
        targetNode = eligible.length > 0 ? eligible[Math.floor(Math.random() * eligible.length)].node : startNode;
      }

      const distRatio = (u.type === "horse") ? (0.38 + Math.random() * 0.16) : (0.32 + Math.random() * 0.16);
      const subAreaChoice = (u.type === "horse") ? Math.floor(Math.random() * 6) : 'random';
      const sub = getHexSubAreaWorld(targetNode, subAreaChoice, distRatio);
      const duration = (u.type === "horse") ? (4.0 + Math.random() * 3.5) : (3.5 + Math.random() * 3.0);

      this.routeUnitTo(u, sub.x, sub.z, "GRAZING", duration, () => {
        u.isGrazing = true;
        u.currentSector = sub.areaIndex;
        u.currentQuadrant = sub.areaIndex;
        if (sub.areaIndex < 6) {
          u.facingY = sub.angleRad + (Math.random() - 0.5) * 0.5;
        } else {
          u.facingY = Math.random() * Math.PI * 2;
        }
      });
    }
  }

  /**
   * Plans path to target coordinates and sets up walking state.
   * Modifies destination waypoint to target exact sub-hex coordinates.
   */
  routeUnitTo(u, targetX, targetZ, nextState, nextDuration = 2.0, onArrivalCallback = null, precalculatedPath = null) {
    const startNode = u.currentHexNode || this.navMesh.findNearestNode(u.x, u.z);
    const endNode = this.navMesh.findNearestNode(targetX, targetZ);

    if (!startNode || !endNode) {
      u.state = nextState;
      u.stateTimer = nextDuration;
      return;
    }

    if (startNode === endNode) {
      const dist = Math.hypot(targetX - u.x, targetZ - u.z);
      if (dist > 0.15) {
        const targetY = (this.navMesh && this.navMesh.getTerrainHeightAt)
          ? this.navMesh.getTerrainHeightAt(targetX, targetZ)
          : u.y;
        u.path = [
          { x: u.x, y: u.y, z: u.z, node: startNode },
          { x: targetX, y: targetY, z: targetZ, node: startNode }
        ];
        u.pathIndex = 1;
        u.state = "WALKING";
        u.isMoving = true;
        u.nextStateOnArrival = nextState;
        u.nextDurationOnArrival = nextDuration;
        u.onArrival = onArrivalCallback;
        return;
      }
      u.state = nextState;
      u.stateTimer = nextDuration;
      if (onArrivalCallback) onArrivalCallback();
      return;
    }

    const path = (precalculatedPath && precalculatedPath.length > 1)
      ? precalculatedPath
      : this.navMesh.findPath(startNode, endNode);

    if (path && path.length > 1) {
      // Modify last waypoint to arrive precisely at the target sub-hex sector coordinates
      const finalWp = Object.assign({}, path[path.length - 1]);
      finalWp.x = targetX;
      finalWp.z = targetZ;
      if (this.navMesh && this.navMesh.getTerrainHeightAt) {
        finalWp.y = this.navMesh.getTerrainHeightAt(targetX, targetZ);
      }
      u.path = path.slice(0, -1).concat([finalWp]);
      u.pathIndex = 1; // 0 is start node
      u.state = "WALKING";
      u.isMoving = true;
      u.nextStateOnArrival = nextState;
      u.nextDurationOnArrival = nextDuration;
      u.onArrival = onArrivalCallback;
    } else {
      // Unreachable destination: cancel task cleanly, do NOT fake arrival!
      // Also clear all work-state so activity text matches what's visually happening
      if (u.targetFarm) {
        u.targetFarm.assignedFarmer = null;
        u.targetFarm = null;
      }
      u.tool = null;
      u.isChopping = false;
      u.isDipping = false;
      u.isFarming = false;
      u.isHarvesting = false;
      u.isMoving = false;
      u.path = [];
      u.state = "IDLE";
      u.stateTimer = 1.0 + Math.random() * 1.5;
    }
  }

  /**
   * Moves a unit along its calculated path waypoints with natural movement physics:
   * - Damped angular yaw turning
   * - Natural waypoint corner smoothing
   * - Anti-clipping obstacle repulsion against cottages, fences, and walls
   * - Continuous 3D terrain surface height conformity (bridges, ramps, and terraces)
   */
  stepAlongPath(u, dt) {
    if (!u.path || u.pathIndex >= u.path.length) {
      // Arrived at destination
      u.isMoving = false;
      u.state = u.nextStateOnArrival || "IDLE";
      u.stateTimer = u.nextDurationOnArrival || 2.0;
      if (u.onArrival) {
        u.onArrival();
        u.onArrival = null;
      }
      return;
    }

    const targetWaypoint = u.path[u.pathIndex];
    const dx = targetWaypoint.x - u.x;
    const dz = targetWaypoint.z - u.z;
    const dist2D = Math.hypot(dx, dz);

    // Natural damped angular rotation towards target heading
    if (dist2D > 0.01) {
      const targetYaw = Math.atan2(dx, dz);
      let diff = targetYaw - u.facingY;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      u.facingY += diff * Math.min(1.0, dt * 10.0);
    }

    const stepDist = u.speed * dt;

    // Corner smoothing: advance early if nearing intermediate waypoint
    if (dist2D <= 0.15 && u.pathIndex < u.path.length - 1) {
      u.pathIndex++;
      if (targetWaypoint.node) u.currentHexNode = targetWaypoint.node;
    } else if (dist2D <= stepDist) {
      u.x = targetWaypoint.x;
      u.z = targetWaypoint.z;
      if (targetWaypoint.node) u.currentHexNode = targetWaypoint.node;
      u.pathIndex++;
    } else {
      u.x += (dx / dist2D) * stepDist;
      u.z += (dz / dist2D) * stepDist;
    }

    // Anti-clipping obstacle collision resolution
    const unitRadius = u.isAnimal ? (u.type === 'horse' ? 0.16 : 0.12) : (u.isChild ? 0.08 : 0.10);
    const resolved = this.navMesh.resolveObstacleCollisions(u.x, u.z, unitRadius);
    u.x = resolved.x;
    u.z = resolved.z;

    // Continuous 3D terrain surface height sampling
    const surfaceY = this.navMesh.getTerrainHeightAt(u.x, u.z);
    u.y += (surfaceY - u.y) * Math.min(1.0, dt * 12.0);

    if (targetWaypoint.node) {
      u.currentHexNode = targetWaypoint.node;
    }
  }

  findReachablePOI(u, poiList, maxCandidates = 2) {
    if (!poiList || poiList.length === 0) return null;
    const startNode = u.currentHexNode || this.navMesh.findNearestNode(u.x, u.z);
    if (!startNode) return null;

    let candidates = [];
    for (let i = 0; i < poiList.length; i++) {
      const poi = poiList[i];
      const dx = poi.worldX - u.x;
      const dz = poi.worldZ - u.z;
      const distSq = dx * dx + dz * dz;
      if (distSq <= 256) {
        candidates.push({ poi, distSq });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.distSq - b.distSq);
    if (candidates.length > maxCandidates) candidates.length = maxCandidates;

    for (const item of candidates) {
      const targetNode = item.poi.node || this.navMesh.findNearestNode(item.poi.worldX, item.poi.worldZ);
      if (!targetNode || targetNode.isWater || targetNode.isPeak) continue;
      if (targetNode === startNode) return { poi: item.poi, path: null };
      const path = this.navMesh.findPath(startNode, targetNode);
      if (path && path.length > 0) {
        return { poi: item.poi, path };
      }
    }
    return null;
  }

  findNearestPOI(u, poiList) {
    if (!poiList || poiList.length === 0) return null;
    let closest = null;
    let minDist = Infinity;
    for (const poi of poiList) {
      const d = Math.hypot(poi.worldX - u.x, poi.worldZ - u.z);
      if (d < minDist) {
        minDist = d;
        closest = poi;
      }
    }
    return closest;
  }

  selectUnitById(id) {
    this.selectedUnit = this.allUnits.find(u => u.id === id) || null;
    return this.selectedUnit;
  }
}
