/**
 * livingWorldNavMesh.js
 * High-performance spatial navigation graph and height-aware A* pathfinder
 * for the Living World simulation on KayKit hex maps up to 50x50 (2,500 hexes).
 *
 * Strict Movement Invariants:
 * 1. Water Blocking: Cannot enter ocean or lakes (biome === "water").
 * 2. River Blocking: Cannot traverse across a river edge UNLESS on an active bridge (isBridge === true).
 * 3. Wall / Fortification Blocking: Cannot pass through a perimeter wall UNLESS on an active gate (isGate === true).
 * 4. Height Awareness & Climbing:
 *    - Flat movement (deltaElevation == 0): normal cost 1.0 (0.5 along roads).
 *    - Gentle ramps (deltaElevation <= 1.0 with a slope ramp): climbing cost 1.8x.
 *    - Sheer vertical cliffs (deltaElevation >= 1.0 without a slope ramp): STRICTLY IMPASSABLE.
 *    - Mountain peaks (elevationLevel >= 2.5): Impassable crags.
 */

import { HEX_DIRECTIONS, getOppositeEdge, getHexQuadrantLocal, hexToWorld, worldToHex, HEX_APOTHEM } from "./hexMath.js";

const getKey = (q, r) => q + ',' + r;

class BinaryHeap {
  constructor(scoreFunction) {
    this.content = [];
    this.scoreFunction = scoreFunction;
  }

  push(element) {
    this.content.push(element);
    this.bubbleUp(this.content.length - 1);
  }

  pop() {
    const result = this.content[0];
    const end = this.content.pop();
    if (this.content.length > 0) {
      this.content[0] = end;
      this.sinkDown(0);
    }
    return result;
  }

  size() {
    return this.content.length;
  }

  bubbleUp(n) {
    const element = this.content[n];
    const score = this.scoreFunction(element);
    while (n > 0) {
      const parentN = Math.floor((n + 1) / 2) - 1;
      const parent = this.content[parentN];
      if (score >= this.scoreFunction(parent)) break;
      this.content[parentN] = element;
      this.content[n] = parent;
      n = parentN;
    }
  }

  sinkDown(n) {
    const length = this.content.length;
    const element = this.content[n];
    const elemScore = this.scoreFunction(element);

    while (true) {
      const child2N = (n + 1) * 2;
      const child1N = child2N - 1;
      let swap = null;
      let child1Score;

      if (child1N < length) {
        const child1 = this.content[child1N];
        child1Score = this.scoreFunction(child1);
        if (child1Score < elemScore) swap = child1N;
      }

      if (child2N < length) {
        const child2 = this.content[child2N];
        const child2Score = this.scoreFunction(child2);
        if (child2Score < (swap === null ? elemScore : child1Score)) swap = child2N;
      }

      if (swap === null) break;
      this.content[n] = this.content[swap];
      this.content[swap] = element;
      n = swap;
    }
  }
}

export class LivingWorldNavMesh {
  constructor(worldData) {
    this.grid = worldData.grid;
    this.hexList = worldData.hexList;
    this.nodes = new Map();
    this.pois = {
      cottages: [],
      workplaces: [],
      forests: [],
      waterbanks: [],
      farms: [],
      plazas: [],
      taverns: [],
      churches: [],
      markets: [],
      archeryRanges: [],
      blacksmiths: [],
      stables: [],
      wells: [],
      docks: [],
      quarries: []
    };

    this.buildGraph();
    this.categorizePOIs();
  }

  buildGraph() {
    for (const tile of this.hexList) {
      const key = getKey(tile.q, tile.r);
      const isWater = (tile.biome === "water");
      const isPeak = (tile.elevationLevel >= 2.5);

      const blockedWalls = new Set();
      if (Array.isArray(tile.walls)) {
        for (const w of tile.walls) {
          if (!w.isGate) {
            blockedWalls.add(w.edge);
          }
        }
      }

      const node = {
        q: tile.q,
        r: tile.r,
        key,
        tile,
        worldX: tile.worldPos ? tile.worldPos.x : (tile.q + tile.r / 2) * 2.0,
        worldY: tile.worldPos ? tile.worldPos.y : tile.elevationLevel * 0.5,
        worldZ: tile.worldPos ? tile.worldPos.z : tile.r * 1.732,
        elevation: tile.elevationLevel,
        isWater,
        isPeak,
        isBridge: Boolean(tile.isBridge),
        hasRoad: Boolean(tile.hasRoad),
        roadEdges: tile.roadEdges || [],
        hasRiver: Boolean(tile.hasRiver),
        riverEdges: tile.riverEdges || [],
        blockedWalls,
        slope: tile.slope,
        neighbors: []
      };

      this.nodes.set(key, node);
    }

    for (const [key, node] of this.nodes) {
      if (node.isWater || node.isPeak) continue;

      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nKey = getKey(node.q + dir.q, node.r + dir.r);
        const neighbor = this.nodes.get(nKey);
        if (!neighbor) continue;

        if (neighbor.isWater || neighbor.isPeak) continue;

        if (node.blockedWalls.has(i)) continue;
        const oppEdge = getOppositeEdge(i);
        if (neighbor.blockedWalls.has(oppEdge)) continue;

        let isRiverBlocked = false;
        if (node.hasRiver && node.riverEdges.includes(i)) {
          if (!node.isBridge) isRiverBlocked = true;
        }
        if (neighbor.hasRiver && neighbor.riverEdges.includes(oppEdge)) {
          if (!neighbor.isBridge) isRiverBlocked = true;
        }
        if (isRiverBlocked) continue;

        const deltaElev = Math.abs(neighbor.elevation - node.elevation);
        let climbCost = 1.0;

        if (deltaElev > 0.05) {
          if (deltaElev > 1.05) continue;

          const hasRamp = (node.slope && (node.slope.dir === i || node.slope.dir === oppEdge)) ||
                          (neighbor.slope && (neighbor.slope.dir === oppEdge || neighbor.slope.dir === i)) ||
                          (deltaElev <= 0.5);

          if (!hasRamp) continue;
          climbCost = 1.8;
        }

        const isRoadConnected = (node.hasRoad && node.roadEdges.includes(i)) &&
                                (neighbor.hasRoad && neighbor.roadEdges.includes(oppEdge));
        const baseCost = isRoadConnected ? 0.5 : 1.0;
        const totalCost = baseCost * climbCost;

        node.neighbors.push({
          node: neighbor,
          cost: totalCost,
          edgeDir: i
        });
      }
    }
    this.computeConnectedComponents();
  }

  computeConnectedComponents() {
    let currentComponentId = 1;
    for (const [key, node] of this.nodes) {
      if (node.isWater || node.componentId) continue;

      const queue = [node];
      node.componentId = currentComponentId;

      while (queue.length > 0) {
        const curr = queue.shift();
        for (const edge of curr.neighbors) {
          const neighbor = edge.node;
          if (!neighbor.isWater && !neighbor.componentId) {
            neighbor.componentId = currentComponentId;
            queue.push(neighbor);
          }
        }
      }
      currentComponentId++;
    }
  }

  categorizePOIs() {
    this.obstacles = [];
    for (const [key, node] of this.nodes) {
      const tile = node.tile;
      if (node.isWater) continue;

      if (Array.isArray(tile.subBuildings)) {
        for (const sb of tile.subBuildings) {
          const offsetX = sb.offset ? sb.offset.x : 0;
          const offsetY = sb.offset ? sb.offset.y : 0.05;
          const offsetZ = sb.offset ? sb.offset.z : 0;

          // Register collision obstacle for anti-clipping
          const radius = (sb.type === 'fence') ? 0.16 : 0.24;
          this.obstacles.push({
            x: node.worldX + offsetX,
            z: node.worldZ + offsetZ,
            radius,
            key
          });

          const poiEntry = {
            key,
            node,
            worldX: node.worldX + offsetX,
            worldY: node.worldY + offsetY,
            worldZ: node.worldZ + offsetZ,
            villageId: tile.villageId,
            villageTheme: tile.villageTheme || "blue",
            type: sb.type
          };

          if (sb.type === "home_A" || sb.type === "home_B") {
            this.pois.cottages.push({
              ...poiEntry,
              capacity: 3,
              residents: []
            });
          } else if (sb.type === "tavern") {
            this.pois.taverns.push(poiEntry);
            this.pois.cottages.push({
              ...poiEntry,
              capacity: 6,
              residents: []
            });
          } else if (sb.type === "church") {
            this.pois.churches.push(poiEntry);
          } else if (sb.type === "market") {
            this.pois.markets.push(poiEntry);
          } else if (sb.type === "archeryrange") {
            this.pois.archeryRanges.push(poiEntry);
          } else if (sb.type === "blacksmith") {
            this.pois.blacksmiths.push(poiEntry);
          } else if (sb.type === "stables") {
            this.pois.stables.push(poiEntry);
          } else if (sb.type === "well") {
            this.pois.wells.push(poiEntry);
          } else if (sb.type === "townhall") {
            this.pois.plazas.push(poiEntry);
          }
        }
      }

      if (tile.building) {
        const ox = tile.building.offset ? tile.building.offset.x : 0;
        const oy = tile.building.offset ? tile.building.offset.y : 0.05;
        const oz = tile.building.offset ? tile.building.offset.z : 0;

        // Register collision obstacle for anti-clipping
        const bRadius = tile.building.type === 'castle' ? 0.35 : 0.28;
        this.obstacles.push({
          x: node.worldX + ox,
          z: node.worldZ + oz,
          radius: bRadius,
          key
        });

        const bPoiEntry = {
          key,
          node,
          worldX: node.worldX + ox,
          worldY: node.worldY + oy,
          worldZ: node.worldZ + oz,
          villageId: tile.villageId || 'rural',
          villageTheme: tile.villageTheme || 'blue',
          type: tile.building.type
        };

        if (tile.building.type === "home") {
          this.pois.cottages.push({
            ...bPoiEntry,
            capacity: 3,
            residents: []
          });
        } else if (tile.building.type === "tavern") {
          this.pois.taverns.push(bPoiEntry);
        } else if (tile.building.type === "church") {
          this.pois.churches.push(bPoiEntry);
        } else if (tile.building.type === "market") {
          this.pois.markets.push(bPoiEntry);
        } else if (tile.building.type === "archeryrange" || tile.building.type === "barracks") {
          this.pois.archeryRanges.push(bPoiEntry);
        } else if (tile.building.type === "blacksmith" || tile.building.type === "workshop") {
          this.pois.blacksmiths.push(bPoiEntry);
        } else if (tile.building.type === "stables") {
          this.pois.stables.push(bPoiEntry);
        } else if (tile.building.type === "well") {
          this.pois.wells.push(bPoiEntry);
        } else if (tile.building.type === "dock" || tile.building.type === "watermill") {
          this.pois.docks.push(bPoiEntry);
        } else if (tile.building.type === "townhall" || tile.building.type === "castle") {
          this.pois.plazas.push(bPoiEntry);
        } else {
          this.pois.workplaces.push(bPoiEntry);
        }
      }

      if (tile.decoration && tile.decoration.path && tile.decoration.path.includes("trees")) {
        this.pois.forests.push({
          key,
          node,
          worldX: node.worldX,
          worldY: node.worldY,
          worldZ: node.worldZ,
          hasTimber: true,
          respawnTimer: 0
        });
      }

      let isWaterBank = false;
      let waterDir = 0;
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nTile = this.grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
        if (nTile && (nTile.biome === "water" || nTile.hasRiver)) {
          isWaterBank = true;
          waterDir = i;
          break;
        }
      }
      if (isWaterBank) {
        const edgeOffset = getHexQuadrantLocal(waterDir, 0.55);
        this.pois.waterbanks.push({
          key,
          node,
          waterDir,
          worldX: node.worldX + edgeOffset.x,
          worldY: node.worldY + edgeOffset.y,
          worldZ: node.worldZ + edgeOffset.z
        });
      }

      if (tile.biome === "plains" && tile.elevationLevel === 0 && !tile.hasRoad && !tile.hasRiver && !tile.building) {
        if (tile.biomeTheme !== "winter") {
          // Keep agricultural fields near village cottages (within ~5 hexes / 8 units)
          let isNearVillage = Boolean(tile.isVillage);
          if (!isNearVillage && this.pois.cottages.length > 0) {
            for (let cIdx = 0; cIdx < this.pois.cottages.length; cIdx++) {
              const c = this.pois.cottages[cIdx];
              if (Math.hypot(c.worldX - node.worldX, c.worldZ - node.worldZ) < 8.0) {
                isNearVillage = true;
                break;
              }
            }
          } else if (!isNearVillage && this.pois.cottages.length === 0) {
            isNearVillage = true;
          }

          if (isNearVillage && this.pois.farms.length < 36) {
            this.pois.farms.push({
              id: this.pois.farms.length + 1,
              key,
              node,
              tile,
              worldX: node.worldX,
              worldY: node.worldY,
              worldZ: node.worldZ,
              state: "TILLED", // "TILLED" | "PLANTED" | "GROWING" | "RIPE"
              cropGrowth: 0.0,
              hasCrop: false,
              cropModel: "building_grain"
            });
          }
        }
      }

      if (tile.hasRoad && tile.roadEdges.length >= 2) {
        this.pois.plazas.push({
          key,
          node,
          worldX: node.worldX,
          worldY: node.worldY,
          worldZ: node.worldZ
        });
      }

      if (Array.isArray(tile.walls)) {
        for (const w of tile.walls) {
          if (!w.isGate) {
            const edgeOffset = getHexQuadrantLocal(w.edge, HEX_APOTHEM * 0.95);
            this.obstacles.push({
              x: node.worldX + edgeOffset.x,
              z: node.worldZ + edgeOffset.z,
              radius: 0.18,
              key
            });
          }
        }
      }

      // Mountain Peak Obstacle: Central rock peak blocks units from clipping inside the rock,
      // steering them smoothly around the mountain peak via outer sub-hex sectors.
      // (Forests/trees intentionally have NO obstacle, allowing units to freely walk among trees)
      const isMountainTile = (tile.biome === 'mountain') || 
                             (tile.decoration && String(tile.decoration.path).includes('mountain'));
      if (isMountainTile && !tile.hasRoad) {
        this.obstacles.push({
          x: node.worldX,
          z: node.worldZ,
          radius: 0.38,
          key
        });
      }

      if (tile.decoration && tile.decoration.path && (tile.decoration.path.includes("rock") || tile.decoration.path.includes("stone"))) {
        this.pois.quarries.push({
          key,
          node,
          worldX: node.worldX,
          worldY: node.worldY,
          worldZ: node.worldZ
        });
      } else if ((tile.biome === "mountain" || tile.elevationLevel >= 1.5) && !node.isWater) {
        this.pois.quarries.push({
          key,
          node,
          worldX: node.worldX,
          worldY: node.worldY,
          worldZ: node.worldZ
        });
      }
    }

    // Index obstacles into a spatial hash by hex key for instant O(1) queries
    this.obstaclesByHex = new Map();
    for (const obs of this.obstacles) {
      const homeKey = obs.key || getKey(worldToHex(obs.x, obs.z).q, worldToHex(obs.x, obs.z).r);
      const hexCenterNode = this.nodes.get(homeKey);
      const centerX = hexCenterNode ? hexCenterNode.worldX : 0;
      const centerZ = hexCenterNode ? hexCenterNode.worldZ : 0;
      const distFromCenter = Math.hypot(obs.x - centerX, obs.z - centerZ);

      // Only edge obstacles (walls / fences near perimeter) need neighbor hex coverage
      const keys = [homeKey];
      if (distFromCenter > 0.58) {
        const hex = worldToHex(obs.x, obs.z);
        for (let i = 0; i < 6; i++) {
          const d = HEX_DIRECTIONS[i];
          keys.push(getKey(hex.q + d.q, hex.r + d.r));
        }
      }

      for (const k of keys) {
        if (!this.obstaclesByHex.has(k)) {
          this.obstaclesByHex.set(k, []);
        }
        this.obstaclesByHex.get(k).push(obs);
      }
    }
  }

  /**
   * Samples exact continuous 3D terrain surface height at world coordinates (x, z).
   * Seamlessly resolves base elevations, KayKit sloped ramps, and elevated bridge decks.
   *
   * @param {number} x - World X coordinate
   * @param {number} z - World Z coordinate
   * @returns {number} Exact terrain Y elevation
   */
  getTerrainHeightAt(x, z) {
    const hexCoord = worldToHex(x, z);
    const key = getKey(hexCoord.q, hexCoord.r);
    const node = this.nodes.get(key);

    if (!node) {
      return 0.0;
    }

    let height = node.worldY;

    // 1. KayKit Sloped Ramp Surface Interpolation
    if (node.slope && node.slope.dir !== undefined) {
      const dirIndex = node.slope.dir;
      const dir = HEX_DIRECTIONS[dirIndex];
      const neighborKey = getKey(node.q + dir.q, node.r + dir.r);
      const neighborNode = this.nodes.get(neighborKey);

      if (neighborNode) {
        const dx = neighborNode.worldX - node.worldX;
        const dz = neighborNode.worldZ - node.worldZ;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.001) {
          const udx = dx / dist;
          const udz = dz / dist;
          // Project continuous position onto the ramp inclination axis
          const proj = (x - node.worldX) * udx + (z - node.worldZ) * udz;
          // Parameter t runs from 0 (at ramp base) to 1 (at high terrace edge)
          const t = Math.max(0.0, Math.min(1.0, (proj + HEX_APOTHEM) / (2.0 * HEX_APOTHEM)));
          const rise = (node.slope.type === 'high') ? 1.0 : 0.5;
          height = node.worldY + t * rise;
        }
      }
    }

    // 2. Elevated Bridge Deck Clearance (+0.18 over river water)
    if (node.isBridge) {
      height += 0.18;
    }

    // 3. Hill Mound Continuous Surface Elevation (climb up and down over hills like tiles)
    const isHill = (node.tile && (node.tile.biome === 'hill' || (node.tile.decoration && String(node.tile.decoration.path).includes('hill'))));
    if (isHill) {
      const distFromCenter = Math.hypot(x - node.worldX, z - node.worldZ);
      if (distFromCenter < 1.0) {
        const normDist = distFromCenter / 1.0;
        // Smooth dome curve: rises up to +0.48 at center crest, sloping down smoothly to 0 at perimeter
        const hillOffset = 0.48 * Math.max(0, 1.0 - normDist * normDist);
        height += hillOffset;
      }
    }

    // 4. Mountain Foothill Surface Elevation (foothills slope up towards peak)
    const isMountain = (node.tile && (node.tile.biome === 'mountain' || (node.tile.decoration && String(node.tile.decoration.path).includes('mountain'))));
    if (isMountain) {
      const distFromCenter = Math.hypot(x - node.worldX, z - node.worldZ);
      if (distFromCenter < 1.0) {
        const normDist = distFromCenter / 1.0;
        const mtnOffset = 0.52 * Math.max(0, 1.0 - normDist);
        height += mtnOffset;
      }
    }

    return height;
  }

  /**
   * Resolves collisions with village buildings, fences, and walls to eliminate mesh clipping.
   * Uses fast O(1) localized spatial hashing.
   *
   * @param {number} x - World X coordinate
   * @param {number} z - World Z coordinate
   * @param {number} unitRadius - Collision radius of the unit
   * @returns {{x: number, z: number}} Corrected non-clipping position
   */
  resolveObstacleCollisions(x, z, unitRadius = 0.10) {
    const hex = worldToHex(x, z);
    const nearby = this.obstaclesByHex.get(getKey(hex.q, hex.r));
    if (!nearby || nearby.length === 0) return { x, z };

    let curX = x;
    let curZ = z;

    for (let i = 0; i < nearby.length; i++) {
      const obs = nearby[i];
      const dx = curX - obs.x;
      const dz = curZ - obs.z;
      const minDist = obs.radius + unitRadius;
      const distSq = dx * dx + dz * dz;

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.0001) {
          const overlap = minDist - dist;
          curX += (dx / dist) * overlap;
          curZ += (dz / dist) * overlap;
        } else {
          curX += minDist;
        }
      }
    }

    // Water boundary safeguard: never allow an obstacle push to shove a unit into water
    const targetHex = worldToHex(curX, curZ);
    const targetNode = this.nodes.get(getKey(targetHex.q, targetHex.r));
    if (targetNode && targetNode.isWater) {
      return { x, z };
    }

    return { x: curX, z: curZ };
  }

  heuristic(a, b) {
    const dq = Math.abs(a.q - b.q);
    const dr = Math.abs(a.r - b.r);
    const ds = Math.abs((a.q + a.r) - (b.q + b.r));
    return Math.max(dq, dr, ds);
  }

  findPath(startNode, endNode) {
    if (!startNode || !endNode) return null;
    if (startNode === endNode) {
      return [{ x: startNode.worldX, y: startNode.worldY, z: startNode.worldZ, node: startNode }];
    }
    if (startNode.isWater || endNode.isWater) return null;

    // O(1) Instant Rejection: Nodes belong to disconnected land components (e.g. across rivers/walls)
    if (startNode.componentId && endNode.componentId && startNode.componentId !== endNode.componentId) {
      return null;
    }

    const openSet = new BinaryHeap(node => node.f);
    const cameFrom = new Map();
    const gScore = new Map();
    const closedSet = new Set();

    startNode.f = this.heuristic(startNode, endNode);
    startNode.g = 0;
    openSet.push(startNode);
    gScore.set(startNode.key, 0);

    let iterations = 0;
    const maxIter = 300; // Capped to 300 to bound worst-case search latency

    while (openSet.size() > 0) {
      iterations++;
      if (iterations > maxIter) break;

      const current = openSet.pop();
      if (current.key === endNode.key) {
        const nodeSeq = [];
        let curr = current;
        while (curr) {
          nodeSeq.unshift(curr);
          curr = cameFrom.get(curr.key);
        }

        const path = [];
        for (let i = 0; i < nodeSeq.length; i++) {
          const n = nodeSeq[i];
          if (i > 0) {
            const prev = nodeSeq[i - 1];
            // Midpoint at edge crossing (e.g. gate opening, bridge entrance, ramp base)
            const edgeX = (prev.worldX + n.worldX) * 0.5;
            const edgeZ = (prev.worldZ + n.worldZ) * 0.5;
            const edgeY = this.getTerrainHeightAt(edgeX, edgeZ);
            path.push({
              x: edgeX,
              y: edgeY,
              z: edgeZ,
              node: n,
              isEdgeTransition: true
            });
          }
          path.push({
            x: n.worldX,
            y: this.getTerrainHeightAt(n.worldX, n.worldZ),
            z: n.worldZ,
            node: n
          });
        }
        return path;
      }

      closedSet.add(current.key);

      for (const edge of current.neighbors) {
        const neighbor = edge.node;
        if (closedSet.has(neighbor.key)) continue;

        const tentativeG = (gScore.get(current.key) ?? Infinity) + edge.cost;
        const prevG = gScore.get(neighbor.key) ?? Infinity;

        if (tentativeG < prevG) {
          cameFrom.set(neighbor.key, current);
          gScore.set(neighbor.key, tentativeG);
          neighbor.g = tentativeG;
          neighbor.f = tentativeG + this.heuristic(neighbor, endNode);
          openSet.push(neighbor);
        }
      }
    }

    return null;
  }

  findNearestNode(x, z) {
    const hex = worldToHex(x, z);
    const directNode = this.nodes.get(getKey(hex.q, hex.r));
    if (directNode && !directNode.isWater) {
      return directNode;
    }

    // Check immediate 1-ring neighbors first (fast O(1))
    let closestNode = null;
    let minDist = Infinity;
    for (const dir of HEX_DIRECTIONS) {
      const nKey = getKey(hex.q + dir.dq, hex.r + dir.dr);
      const neighbor = this.nodes.get(nKey);
      if (neighbor && !neighbor.isWater) {
        const d = Math.hypot(neighbor.worldX - x, neighbor.worldZ - z);
        if (d < minDist) {
          minDist = d;
          closestNode = neighbor;
        }
      }
    }
    if (closestNode) return closestNode;

    // Fallback: full scan if position is far out or surrounded by water
    for (const [key, node] of this.nodes) {
      if (node.isWater) continue;
      const d = Math.hypot(node.worldX - x, node.worldZ - z);
      if (d < minDist) {
        minDist = d;
        closestNode = node;
      }
    }
    return closestNode;
  }
}
