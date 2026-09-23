/**
 * worldGenerator.js
 * Procedural hex world generator using KayKit Medieval Hexagons.
 * Generates biomes, elevation levels, coasts, road networks via A*, and building/tree placement.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hexToWorld, HEX_DIRECTIONS, getRotationRadians, getOppositeEdge, getHexQuadrantLocal, getPerimeterWallTransform, getHexVertexLocal, HEX_APOTHEM } from './hexMath.js';
import { ASSET_MANIFEST, TEXTURE_ATLASES, BIOME_CONFIGS } from './assetManifest.js';
import { resolveRoadTile, resolveCoastTileAutotiled, resolveCoastByExactEdges, isContiguousEdges, resolveRiverTile, resolveRiverMouthTile, resolveBridgeTile, resolveBridgeProp } from './roadAutotile.js';

// Physical transition tile (hex_transition.fbx) edge materials at rotationStep = 0:
// Edge 0 (NE), 1 (E), 2 (SE): Material Slot 1 (secondaryBiome)
// Edge 3 (SW), 4 (W), 5 (NW): Material Slot 0 (primaryBiome / tile.biomeTheme)
export const TRANSITION_BASE_SLOTS = [1, 1, 1, 0, 0, 0];

export function getTransitionEdgeSlot(worldEdge, rotStep) {
  const localEdge = (worldEdge - rotStep + 6) % 6;
  return TRANSITION_BASE_SLOTS[localEdge];
}

export function getTileEdgeMaterial(tile, worldEdge) {
  if (!tile) return null;
  if (tile.biome === 'water') return 'water';
  if (!tile.isTransition) return tile.biomeTheme;
  const slot = getTransitionEdgeSlot(worldEdge, tile.transitionRotationStep || 0);
  return slot === 1 ? tile.transitionSecondaryBiome : tile.biomeTheme;
}

// Simple deterministic pseudo-random number generator (Mulberry32)
function createPRNG(seed) {
  let s = Math.imul(seed ^ 0xdeadbeef, 1);
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D Perlin/Simplex gradient noise implementation for zero-dependency noise
class SimpleNoise2D {
  constructor(seed = 1337) {
    const prng = createPRNG(seed);
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      const tmp = this.p[i];
      this.p[i] = this.p[j];
      this.p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
  }

  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(t, a, b) { return a + t * (b - a); }
  grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = this.lerp(u, this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf));
    const x2 = this.lerp(u, this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1));

    return this.lerp(v, x1, x2);
  }

  fbm(x, y, octaves = 3, lacunarity = 2.0, persistence = 0.5) {
    let total = 0;
    let freq = 1.0;
    let amp = 1.0;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * freq, y * freq) * amp;
      max += amp;
      freq *= lacunarity;
      amp *= persistence;
    }
    return total / max;
  }
}

/**
 * StaticGeometryBatcher
 * Merges static hex tiles, skirts, buildings, walls, sub-buildings, props and flora
 * sharing the same material into spatial-chunked THREE.BufferGeometry meshes.
 * 
 * - Chunking by spatial coordinates (default 16.0 world units, ~8-10 hexes across)
 * - Subdivides batches by (chunkKey, biomeTheme, isCastShadow)
 * - Enables Three.js frustum culling per chunk
 * - Bounds total scene draw calls from ~800-1200+ down to ~20-40
 */
export class StaticGeometryBatcher {
  constructor(chunkSize = 16.0) {
    this.chunkSize = chunkSize;
    this.batches = new Map();
  }

  add(object3D, biomeKey, tileWorldX, tileWorldZ) {
    if (!object3D) return;
    object3D.updateMatrixWorld(true);

    const chunkX = Math.floor(tileWorldX / this.chunkSize);
    const chunkZ = Math.floor(tileWorldZ / this.chunkSize);
    const chunkKey = `${chunkX},${chunkZ}`;

    object3D.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const isCastShadow = Boolean(child.castShadow);
        const batchKey = `${chunkKey}|${biomeKey}|${isCastShadow ? '1' : '0'}`;

        let list = this.batches.get(batchKey);
        if (!list) {
          list = [];
          this.batches.set(batchKey, list);
        }

        let geom = child.geometry.clone();
        geom.applyMatrix4(child.matrixWorld);

        // Sanitize attributes: only keep standard position, normal, uv
        for (const attrName in geom.attributes) {
          if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
            geom.deleteAttribute(attrName);
          }
        }

        // De-index if indexed so mergeGeometries never encounters index attribute mismatches
        if (geom.index) {
          geom = geom.toNonIndexed();
        }

        list.push(geom);
      }
    });
  }

  build(targetGroup, biomeMaterials) {
    let createdMeshes = 0;

    for (const [batchKey, geoms] of this.batches.entries()) {
      if (!geoms || geoms.length === 0) continue;

      const parts = batchKey.split('|');
      const biomeKey = parts[1];
      const isCastShadow = parts[2] === '1';

      let mergedGeom = null;
      if (geoms.length === 1) {
        mergedGeom = geoms[0];
      } else {
        try {
          mergedGeom = mergeGeometries(geoms, false);
        } catch (err) {
          console.warn('[StaticGeometryBatcher] mergeGeometries failed on batch:', batchKey, err);
        }
      }

      if (mergedGeom) {
        mergedGeom.computeBoundingBox();
        mergedGeom.computeBoundingSphere();

        const mat = (biomeMaterials && biomeMaterials.get(biomeKey)) ||
                    (biomeMaterials && biomeMaterials.get('spring')) ||
                    new THREE.MeshBasicMaterial();

        const mesh = new THREE.Mesh(mergedGeom, mat);
        mesh.castShadow = isCastShadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);

        targetGroup.add(mesh);
        createdMeshes++;
      } else {
        // Fallback: add unmerged geoms individually so no geometry is lost
        for (const g of geoms) {
          g.computeBoundingBox();
          g.computeBoundingSphere();
          const mat = (biomeMaterials && biomeMaterials.get(biomeKey)) ||
                      (biomeMaterials && biomeMaterials.get('spring')) ||
                      new THREE.MeshBasicMaterial();
          const mesh = new THREE.Mesh(g, mat);
          mesh.castShadow = isCastShadow;
          mesh.receiveShadow = true;
          mesh.frustumCulled = true;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          mesh.updateMatrixWorld(true);
          targetGroup.add(mesh);
          createdMeshes++;
        }
      }

      // Dispose original unmerged cloned geometries if they were merged into a new geometry
      if (mergedGeom && geoms.length > 1) {
        for (const g of geoms) {
          g.dispose();
        }
      }
    }

    targetGroup.updateMatrixWorld(true);
    this.batches.clear();
    return createdMeshes;
  }
}

export class WorldGenerator {
  constructor(scene, gltfLoader) {
    this.scene = scene;
    this.loader = gltfLoader;
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);

    this.modelCache = new Map();
    this.biomeMaterials = null;
    this.isGenerating = false;
  }

  initBiomeMaterials() {
    if (this.biomeMaterials) return;
    this.biomeMaterials = new Map();
    if (typeof document === 'undefined') return;

    const texLoader = new THREE.TextureLoader();
    const loadedTextures = new Map();
    const configs = BIOME_CONFIGS || {};

    for (const [key, path] of Object.entries(TEXTURE_ATLASES)) {
      try {
        let tex = loadedTextures.get(path);
        if (!tex) {
          tex = texLoader.load(path);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.NearestFilter;
          loadedTextures.set(path, tex);
        }
        const cfg = configs[key];
        const tint = (cfg && cfg.tint && cfg.tint !== 0xffffff) ? new THREE.Color(cfg.tint) : new THREE.Color(0xffffff);
        const mat = new THREE.MeshPhongMaterial({
          map: tex,
          color: tint,
          shininess: 20,
          specular: 0x222222
        });
        this.biomeMaterials.set(key, mat);
      } catch (e) {
        console.warn('Failed to load biome texture/material:', key, path, e);
      }
    }
  }

  applyBiomeToMesh(meshOrGroup, primaryBiome, secondaryBiome = null) {
    this.initBiomeMaterials();
    if (!this.biomeMaterials || this.biomeMaterials.size === 0) return;

    const pMat = this.biomeMaterials.get(primaryBiome) || this.biomeMaterials.get('spring');
    const sMat = secondaryBiome ? (this.biomeMaterials.get(secondaryBiome) || pMat) : null;

    meshOrGroup.traverse(node => {
      if (node.isMesh) {
        if (sMat && (Array.isArray(node.material) || node.name.includes('transition'))) {
          node.material = [pMat, sMat];
        } else if (pMat) {
          node.material = pMat;
        }
      }
    });
  }

  resolveBiomeTheme(normX, normY, e, isLargeWorld, biomeMode) {
    const ALL_SINGLE_BIOMES = ['spring', 'summer', 'fall', 'winter'];
    if (ALL_SINGLE_BIOMES.includes(biomeMode)) {
      return biomeMode;
    }

    if (!isLargeWorld) {
      // Classic 4-Biome Mode (matching reference diorama):
      // 1 section of each: NW: Winter, NE: Fall, SW: Spring, SE: Summer
      const warpX = this.noise2D(normX * 1.3, normY * 1.3) * 0.32;
      const warpZ = this.noise2D(normX * 1.3 + 6.1, normY * 1.3 + 2.7) * 0.32;
      const px = normX + warpX;
      const pz = normY + warpZ;
      if (pz <= 0) {
        return (px <= 0) ? 'winter' : 'fall';
      } else {
        return (px <= 0) ? 'spring' : 'summer';
      }
    }

    // Extended 4-Biome Multi-Section Mode (for large maps > 500 hexes):
    // Uses the original 4 materials (spring, summer, fall, winter) with multiple organic
    // sections/regions of each distributed across the map instead of just 1 quadrant of each.
    const warpX = this.noise2D(normX * 1.8 + 4.2, normY * 1.8 + 1.7) * 0.40;
    const warpZ = this.noise2D(normX * 1.8 + 8.5, normY * 1.8 + 5.3) * 0.40;
    const px = normX + warpX;
    const pz = normY + warpZ;

    const temp = this.noise2D(px * 2.2 + 15.3, pz * 2.2 + 8.1);
    const moist = this.noise2D(px * 2.2 + 27.9, pz * 2.2 + 39.4);

    if (temp < 0) {
      return (moist < 0) ? 'winter' : 'spring';
    } else {
      return (moist < 0) ? 'fall' : 'summer';
    }
  }

  async loadModel(path) {
    if (!path) {
      return new THREE.Group();
    }
    if (this.modelCache.has(path)) {
      return this.modelCache.get(path).clone();
    }
    const res = await this.loader.loadAsync(path);
    const root = res.scene || res;
    root.traverse(node => {
      if (node.isMesh) {
        node.receiveShadow = true;
        // Cast shadow on elevated structures (buildings, trees, rocks, hills, bridges)
        // Flat ground tiles (base grass/water, roads, coast, non-crossing rivers) do not cast shadows
        const isFlatTerrain = path.includes('/tiles/base/') || 
                              path.includes('/tiles/roads/') || 
                              path.includes('/tiles/coast/') || 
                              (path.includes('/tiles/rivers/') && !path.includes('river_crossing'));
        if (!isFlatTerrain) {
          node.castShadow = true;
        } else {
          node.castShadow = false;
        }
      }
    });
    this.modelCache.set(path, root);
    return root.clone();
  }

  /**
   * Preload a set of paths sequentially to avoid connection limits / ECONNRESET
   */
  async preloadModels(paths) {
    const unique = [...new Set(paths.filter(p => p && !this.modelCache.has(p)))];
    for (const p of unique) {
      try {
        await this.loadModel(p);
      } catch (err) {
        console.warn('Failed to preload model:', p, err);
      }
    }
  }

  clear() {
    for (const child of this.worldGroup.children) {
      if (child && child.isMesh && child.geometry) {
        child.geometry.dispose();
      }
    }
    this.worldGroup.clear();
  }

  clearWorld() {
    this.clear();
  }

  setVisible(visible) {
    this.worldGroup.visible = visible;
  }

  generateGrid({ radius = 6, seed = 42, waterLevel = 0.08, mountainDensity = 0.45, treeDensity = 0.4, riverDensity = 1, mapShape = 'rectangular', biomeMode = 'multi', wfcSafety = 'safe', villageCount, villages: inputVillages, wallFortification = 'walled', onProgress } = {}) {
    this.radius = radius;
    this.mapShape = mapShape;
    this.biomeMode = biomeMode;
    this.wfcSafety = wfcSafety;
    this.villageCount = (villageCount !== undefined ? villageCount : inputVillages);
    this.wallFortification = wallFortification;
    const noise = new SimpleNoise2D(seed);
    this.noise2D = (x, y) => noise.noise(x, y);

    const prng = createPRNG(seed);
    const hexList = [];
    const grid = new Map();
    const getKey = (q, r) => `${q},${r}`;

    // Helper to position watermills on the riverbank edge at 1/4 village scale
    const getWatermillPlacement = (tile, termEdgeIn) => {
      const riverDir = HEX_DIRECTIONS[termEdgeIn % 6];
      const riverAngle = riverDir.rad;

      // Two perpendicular bank sides (+90 deg and -90 deg from river axis)
      const bankAngle1 = riverAngle + Math.PI / 2;
      const bankAngle2 = riverAngle - Math.PI / 2;

      // Check neighbor land availability on bank sides
      const bankEdge1 = (termEdgeIn + 2) % 6;
      const bankEdge2 = (termEdgeIn + 4) % 6;
      const n1 = grid.get(getKey(tile.q + HEX_DIRECTIONS[bankEdge1].q, tile.r + HEX_DIRECTIONS[bankEdge1].r));
      const n2 = grid.get(getKey(tile.q + HEX_DIRECTIONS[bankEdge2].q, tile.r + HEX_DIRECTIONS[bankEdge2].r));

      let chosenAngle = bankAngle1;
      let chosenEdge = bankEdge1;
      let isSide2 = false;

      if ((!n1 || n1.biome === 'water' || n1.hasRiver) && (n2 && n2.biome !== 'water' && !n2.hasRiver)) {
        chosenAngle = bankAngle2;
        chosenEdge = bankEdge2;
        isSide2 = true;
      }

      const bankDist = 0.44;
      const offset = {
        x: Math.cos(chosenAngle) * bankDist,
        y: 0.05,
        z: Math.sin(chosenAngle) * bankDist
      };

      // Align water wheel parallel to river flow, facing into the river channel
      const baseRot = getRotationRadians(termEdgeIn);
      const rotY = isSide2 ? baseRot + Math.PI : baseRot;

      return {
        type: 'watermill',
        path: ASSET_MANIFEST.buildings.blue.watermill,
        scale: 0.30, // Smaller village scale
        offset,
        rotationY: rotY,
        rotation: termEdgeIn, // Backward compatibility for tests
        bankEdge: chosenEdge
      };
    };

    // Randomly choose between Coastal Ocean (~50%) and Inland Lake (~50%)
    const isEdgeOcean = prng() < 0.50;

    // 1. Generate Hex Grid (Rectangular Diorama or Hexagonal)
    if (mapShape === 'rectangular') {
      let cols, rows;
      if (this.radius <= 12) {
        cols = Math.max(8, Math.round(this.radius * 1.75));
        rows = Math.max(5, Math.round(this.radius * 1.05));
      } else {
        const t = Math.min(1.0, (this.radius - 12) / (50 - 12));
        cols = Math.min(50, Math.round(21 + t * (50 - 21)));
        rows = Math.min(50, Math.round(13 + t * (50 - 13)));
      }
      const halfCols = Math.floor(cols / 2);
      const halfRows = Math.floor(rows / 2);
      const totalHexes = cols * rows;
      const isLargeWorld = totalHexes > 500;

      // Water Basins for Rectangular Worlds:
      // When > 500 hexes, generate multiple distributed lakes & coastal bays
      const waterBasins = [];
      if (isLargeWorld) {
        // Basin 1: South-East coastal bay / open sea
        waterBasins.push({
          col: Math.round(halfCols * 0.55),
          row: Math.round(halfRows * 0.65),
          radCols: Math.max(4.5, halfCols * 0.52),
          radRows: Math.max(3.5, halfRows * 0.52),
          isEdgeWater: true
        });
        // Basin 2: North-West Glacial/Alpine Lake (in winter/tundra border)
        waterBasins.push({
          col: Math.round(-halfCols * 0.45),
          row: Math.round(-halfRows * 0.35),
          radCols: Math.max(3.5, halfCols * 0.36),
          radRows: Math.max(2.5, halfRows * 0.36),
          isEdgeWater: false
        });
        // Basin 3: Eastern Swamp / Lowland Lake
        waterBasins.push({
          col: Math.round(halfCols * 0.45),
          row: Math.round(-halfRows * 0.15),
          radCols: Math.max(3.5, halfCols * 0.34),
          radRows: Math.max(2.5, halfRows * 0.34),
          isEdgeWater: false
        });
        // Basin 4: South-West Oasis Lake (if large enough, cols >= 30)
        if (cols >= 30) {
          waterBasins.push({
            col: Math.round(-halfCols * 0.40),
            row: Math.round(halfRows * 0.45),
            radCols: Math.max(3.0, halfCols * 0.30),
            radRows: Math.max(2.0, halfRows * 0.30),
            isEdgeWater: false
          });
        }
      }

      // Compact diorama ocean placement (<= 500 hexes):
      const oceanCenterCol = Math.round(halfCols * 0.4);
      const oceanCenterRow = halfRows + 1.2;
      const oceanCenterHX = oceanCenterCol * 2.0;
      const oceanCenterHZ = oceanCenterRow * 1.732;

      for (let row = -halfRows; row <= (rows - 1 - halfRows); row++) {
        const r = row;
        const qOffset = Math.floor(r / 2);
        for (let col = -halfCols; col <= (cols - 1 - halfCols); col++) {
          const q = col - qOffset;
          const normX = col / (halfCols || 1);
          const normY = row / (halfRows || 1);
          const hexDist = Math.max(Math.abs(normX), Math.abs(normY));

          const nx = (col / cols) * 1.6;
          const ny = (row / rows) * 1.6;
          const e = (this.noise2D(nx, ny) + 1) / 2;

          let candidateElevation = e;
          if (isLargeWorld) {
            let minBasinScore = 999.0;
            for (const b of waterBasins) {
              const dx = (col - b.col) / b.radCols;
              const dy = (row - b.row) / b.radRows;
              const dist = Math.hypot(dx, dy);
              if (b.isEdgeWater) {
                const score = dist * 0.35 + e * 0.65;
                if (score < minBasinScore) minBasinScore = score;
              } else {
                // Inland lake: keep buffer from outer border so lake shorelines form naturally
                if (hexDist < 0.85) {
                  const score = dist * 0.45 + e * 0.55;
                  if (score < minBasinScore) minBasinScore = score;
                }
              }
            }
            candidateElevation = minBasinScore;
          } else if (isEdgeOcean) {
            const hx = (q + r / 2) * 2.0;
            const hz = r * 1.732;
            const distToOcean = Math.hypot(hx - oceanCenterHX, hz - oceanCenterHZ);
            candidateElevation = distToOcean * 0.35 + e * 0.65;
          } else {
            // Inland Lake: keep water buffered inside map boundary
            candidateElevation = (hexDist >= 0.72) ? 999.0 : e;
          }

          // Biome Theme Assignment (4 Biomes <= 500 hexes, 8 Biomes > 500 hexes)
          const biomeTheme = this.resolveBiomeTheme(normX, normY, e, isLargeWorld, biomeMode);

          const tile = {
            q, r, e, candidateElevation, hexDist, normX, normY,
            elevationLevel: 0.0,
            biome: 'plains',
            biomeTheme,
            isTransition: false,
            transitionSecondaryBiome: null,
            transitionDir: 0,
            hasRoad: false,
            building: null,
            roadEdges: [],
            isCoast: false,
            coastInfo: null,
            hasRiver: false,
            riverEdges: [],
            riverInfo: null,
            isBridge: false,
            bridgeInfo: null,
            bridgeProp: null,
            isVillage: false,
            villageId: null,
            villageTheme: 'blue',
            isWalled: false,
            villageRole: null,
            subBuildings: [],
            walls: []
          };
          hexList.push(tile);
          grid.set(getKey(q, r), tile);
        }
      }
    } else {
      // Hexagonal Radius mode (cap at radius 28 = ~2,437 hexes, matching 50x50 grid)
      const effRadius = Math.min(28, this.radius);
      const totalHexes = 3 * effRadius * (effRadius + 1) + 1;
      const isLargeWorld = totalHexes > 500;
      const oceanAngle = Math.PI * 0.35; // Towards South-East Summer quadrant
      const oceanCenterX = Math.cos(oceanAngle) * (effRadius * 1.4);
      const oceanCenterZ = Math.sin(oceanAngle) * (effRadius * 1.4);

      for (let q = -effRadius; q <= effRadius; q++) {
        const r1 = Math.max(-effRadius, -q - effRadius);
        const r2 = Math.min(effRadius, -q + effRadius);
        for (let r = r1; r <= r2; r++) {
          const hexDist = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / (2 * effRadius);

          const normX = (q + r / 2) / (effRadius * 0.866 || 1);
          const normY = (r * 1.5) / (effRadius * 1.5 || 1);

          const nx = (q + r / 2) * 0.12;
          const ny = r * 0.12;
          const e = (this.noise2D(nx, ny) + 1) / 2;

          let candidateElevation = e;
          if (isEdgeOcean) {
            const hx = q * Math.sqrt(3) + r * (Math.sqrt(3) / 2);
            const hz = r * 1.5;
            const distToOcean = Math.hypot(hx - oceanCenterX, hz - oceanCenterZ);
            candidateElevation = distToOcean * 0.45 + e * 0.55;
          } else {
            candidateElevation = (hexDist >= (effRadius - 1.0) / effRadius) ? 999.0 : e;
          }

          // Biome Theme Assignment (4 Biomes <= 500 hexes, 8 Biomes > 500 hexes)
          const biomeTheme = this.resolveBiomeTheme(normX, normY, e, isLargeWorld, biomeMode);

          const tile = {
            q, r, e, candidateElevation, hexDist, normX, normY,
            elevationLevel: 0.0,
            biome: 'plains',
            biomeTheme,
            isTransition: false,
            transitionSecondaryBiome: null,
            transitionDir: 0,
            hasRoad: false,
            building: null,
            roadEdges: [],
            isCoast: false,
            coastInfo: null,
            hasRiver: false,
            riverEdges: [],
            riverInfo: null,
            isBridge: false,
            bridgeInfo: null,
            bridgeProp: null,
            isVillage: false,
            villageId: null,
            villageTheme: 'blue',
            isWalled: false,
            villageRole: null,
            subBuildings: [],
            walls: []
          };
          hexList.push(tile);
          grid.set(getKey(q, r), tile);
        }
      }
    }

    if (onProgress) onProgress(0.20, `Generated ${hexList.length} Hex Coordinates`);

    // Assign lowest waterLevel fraction of tiles as water (default 8%, user-controlled 5-10%)
    const sorted = [...hexList].sort((a, b) => a.candidateElevation - b.candidateElevation);
    const waterTarget = Math.max(4, Math.round(hexList.length * waterLevel));
    for (let i = 0; i < waterTarget; i++) {
      sorted[i].biome = 'water';
      sorted[i].elevationLevel = 0.0;
    }

    // Assign remaining land elevations based on noise & biome height gradients
    for (const tile of hexList) {
      if (tile.biome === 'water') continue;

      let effectiveE = tile.e;
      if (this.biomeMode === 'multi' || !this.biomeMode) {
        if (tile.biomeTheme === 'winter') {
          effectiveE = tile.e + 0.30; // Winter: High snow peaks & mountain ridges
        } else if (tile.biomeTheme === 'fall') {
          effectiveE = tile.e + 0.12; // Fall: Elevated savanna & autumn hills
        } else if (tile.biomeTheme === 'spring') {
          effectiveE = tile.e * 0.85; // Spring: Lowland rolling river valley
        } else if (tile.biomeTheme === 'summer') {
          effectiveE = tile.e * 0.75; // Summer: Lowland to mid rolling forest
        }
      }

      if (effectiveE > 0.75) {
        tile.biome = 'mountain';
        const steps = Math.floor((effectiveE - 0.75) * 8);
        tile.elevationLevel = 2.0 + (steps * 0.5);
      } else if (effectiveE > 0.55) {
        tile.biome = 'hill';
        const steps = Math.floor((effectiveE - 0.55) * 6);
        tile.elevationLevel = 1.0 + (steps * 0.5);
      } else {
        tile.biome = 'plains';
        tile.elevationLevel = 0.0;
      }
      if (tile.elevationLevel > 3.0) tile.elevationLevel = 3.0;
    }

    // 2. Evaluate Slopes
    for (const tile of hexList) {
      if (tile.biome === 'water') continue;
      let maxDelta = 0;
      let maxEdge = -1;
      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const nKey = getKey(tile.q + dir.q, tile.r + dir.r);
        const nTile = grid.get(nKey);
        if (nTile && nTile.biome !== 'water') {
          const delta = nTile.elevationLevel - tile.elevationLevel;
          if (delta > maxDelta) {
            maxDelta = delta;
            maxEdge = i;
          }
        }
      }
      if (maxDelta >= 1.0) tile.slope = { type: 'high', dir: maxEdge };
      else if (maxDelta >= 0.5) tile.slope = { type: 'low', dir: maxEdge };
    }

    // 3. Detect & Regularize Coastlines (Topological Regularization & Clean WFC Autotile)
    let needsSmoothing = true;
    let maxSmoothIterations = 5;
    
    while (needsSmoothing && maxSmoothIterations > 0) {
      needsSmoothing = false;
      maxSmoothIterations--;
      
      for (const tile of hexList) {
        tile.isCoast = false;
        tile.coastInfo = null;
      }

      const toErode = [];

      for (const tile of hexList) {
        if (tile.biome !== 'water' && tile.elevationLevel === 0) {
          const waterEdges = [];
          for (let i = 0; i < 6; i++) {
            const dir = HEX_DIRECTIONS[i];
            const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
            if (neighbor && neighbor.biome === 'water') {
              waterEdges.push(i);
            }
          }

          // Topological regularizer:
          // - Any isolated land cell with >= 5 water edges has no physical coast tile (KayKit max is 4 water edges).
          // - Any cell with non-contiguous water edges (pinches, diagonal checkerboards) cannot be tiled with KayKit pieces.
          if (waterEdges.length >= 5 || (waterEdges.length > 1 && !isContiguousEdges(waterEdges))) {
            toErode.push(tile);
          }
        }
      }

      if (toErode.length > 0) {
        for (const tile of toErode) {
          tile.biome = 'water';
        }
        needsSmoothing = true;
      }
    }

    // Now place Coast tiles with 100% exact contiguous water bitmask matching
    for (const tile of hexList) {
      if (tile.biome !== 'water' && tile.elevationLevel === 0) {
        const waterEdges = [];
        for (let i = 0; i < 6; i++) {
          const dir = HEX_DIRECTIONS[i];
          const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
          if (neighbor && neighbor.biome === 'water') {
            waterEdges.push(i);
          }
        }

          if (waterEdges.length >= 1 && waterEdges.length <= 4) {
            const match = resolveCoastTileAutotiled(waterEdges);
            let chosen = match;
            if (!chosen) {
              const req = new Array(6).fill(null);
              for (const w of waterEdges) req[w] = 'water';
              const fallback = resolveCoastByExactEdges(req);
              if (fallback && fallback.piece) chosen = fallback.piece;
            }

            // Verify that this coast tile does not point a sand edge into off-map void:
            if (chosen && Array.isArray(chosen.edges)) {
              let sandInVoid = false;
              for (let i = 0; i < 6; i++) {
                if (chosen.edges[i] === 'sand') {
                  const dir = HEX_DIRECTIONS[i];
                  const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
                  if (!neighbor) {
                    sandInVoid = true;
                    break;
                  }
                }
              }
              if (sandInVoid) {
                // Elevate this perimeter headland tile to a natural sea cliff (elevation 1.0)
                // This eliminates the illegal open sand edge into void while seamlessly framing the bay
                tile.biome = 'hill';
                tile.elevationLevel = 1.0;
                tile.isCoast = false;
                tile.coastInfo = null;
                continue;
              }
            }

            if (chosen) {
              tile.coastInfo = chosen;
              tile.isCoast = true;
            } else {
              // Safety fallback: if no valid coast piece fits this socket,
              // elevate to clean sea cliff (elevation 1.0) so no bare grass cliff touches water
              tile.biome = 'hill';
              tile.elevationLevel = 1.0;
              tile.isCoast = false;
              tile.coastInfo = null;
            }
          } else if (waterEdges.length > 4) {
            // Over-surrounded by water: convert to water to maintain valid topology
            tile.biome = 'water';
            tile.isCoast = false;
            tile.coastInfo = null;
          }
        }
      }

      if (onProgress) onProgress(0.40, 'Solved Coastline WFC & Socket Topology');

      // 3.5 Procedural Inland River Generation
      // Natural meandering rivers flowing downhill from elevated mountain/hill springs across valleys
      const isLargeWorld = hexList.length > 500;
      const targetRiverSystems = isLargeWorld
        ? Math.max(0, Math.min(8, Math.round(riverDensity)))
        : Math.max(0, Math.min(2, Math.round(riverDensity)));
      const riverCount = targetRiverSystems;
      if (riverCount > 0) {
        // Strict inland boundary isolation: tile and all 6 neighbors must be strictly land (never water, never coast)
        const isSafeInland = (t) => {
          const maxAllowedDist = this.mapShape === 'rectangular'
            ? 0.70
            : ((Math.min(28, this.radius) - 1.0) / Math.min(28, this.radius));
          if (t.hexDist >= maxAllowedDist) return false; // Stay inside perimeter
          for (let i = 0; i < 6; i++) {
            const dir = HEX_DIRECTIONS[i];
            const n = grid.get(getKey(t.q + dir.q, t.r + dir.r));
            if (!n || n.biome === 'water' || n.isCoast) return false;
          }
          return true;
        };

        const safeTiles = hexList.filter(isSafeInland);
        const elevated = safeTiles.filter(t => t.elevationLevel >= 1.0);
        const lowlands = safeTiles.filter(t => t.elevationLevel === 0.0);

        if (elevated.length > 0 && lowlands.length > 0) {
          // A* River Pathfinding following natural terrain downhill gradient
          const findRiverPath = (start, end, blockedKeys = new Set()) => {
            const openSet = [start];
            const closedSet = new Set();
            const cameFrom = new Map();
            const gScore = new Map();
            const fScore = new Map();

            const startKey = getKey(start.q, start.r);
            const endKey = getKey(end.q, end.r);
            gScore.set(startKey, 0);
            fScore.set(startKey, this.hexDistance(start, end));

            let iter = 0;
            const maxRiverIter = Math.max(2500, hexList.length * 3);
            while (openSet.length > 0) {
              iter++;
              if (iter > maxRiverIter) break;

              let bestIdx = 0;
              let bestF = fScore.get(getKey(openSet[0].q, openSet[0].r)) ?? Infinity;
              for (let i = 1; i < openSet.length; i++) {
                const f = fScore.get(getKey(openSet[i].q, openSet[i].r)) ?? Infinity;
                if (f < bestF) { bestF = f; bestIdx = i; }
              }

              const current = openSet.splice(bestIdx, 1)[0];
              const currKey = getKey(current.q, current.r);
              if (currKey === endKey) {
                const path = [current];
                let c = current;
                while (cameFrom.has(getKey(c.q, c.r))) {
                  c = cameFrom.get(getKey(c.q, c.r));
                  path.unshift(c);
                }
                return path;
              }

              closedSet.add(currKey);

              for (let i = 0; i < 6; i++) {
                const dir = HEX_DIRECTIONS[i];
                const n = grid.get(getKey(current.q + dir.q, current.r + dir.r));
                if (!n || !isSafeInland(n)) continue;

                const nKey = getKey(n.q, n.r);
                if (closedSet.has(nKey)) continue;
                if (n !== end && blockedKeys.has(nKey)) continue;

                const heightPenalty = Math.max(0, n.elevationLevel - current.elevationLevel) * 4.0;
                const cost = 1.0 + heightPenalty + (n.elevationLevel * 0.4) + (prng() * 0.3);
                const tentativeG = (gScore.get(currKey) ?? 0) + cost;

                if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
                  cameFrom.set(nKey, current);
                  gScore.set(nKey, tentativeG);
                  fScore.set(nKey, tentativeG + this.hexDistance(n, end));
                  if (!openSet.some(x => x.q === n.q && x.r === n.r)) {
                    openSet.push(n);
                  }
                }
              }
            }
            return null;
          };

          // Rank springs for scenic path length across inland valleys
          const rankedSprings = [...elevated].sort((a, b) => {
            return (b.elevationLevel + prng()) - (a.elevationLevel + prng());
          });

          const startTile = rankedSprings[0];
          // Find scenic inland lowland destination
          const candidateEnds = lowlands.filter(t => {
            const d = this.hexDistance(startTile, t);
            return d >= 4 && d <= Math.min(10, this.radius + 2);
          }).sort((a, b) => this.hexDistance(startTile, b) - this.hexDistance(startTile, a));

          const endTile = candidateEnds.length > 0 ? candidateEnds[Math.floor(prng() * Math.min(3, candidateEnds.length))] : lowlands[0];
          const mainRiverPath = findRiverPath(startTile, endTile);

          if (mainRiverPath && mainRiverPath.length >= 3) {
            // Carve main river path
            for (let i = 0; i < mainRiverPath.length; i++) {
              const tile = mainRiverPath[i];
              tile.elevationLevel = 0.0;
              tile.biome = 'plains';
              tile.slope = null;
              tile.hasRiver = true;
              tile.isCoast = false;
              tile.coastInfo = null;
              tile.decoration = null;

              if (i > 0) {
                const prev = mainRiverPath[i - 1];
                const edgeIn = this.getDirectionEdge(tile, prev);
                if (edgeIn !== -1 && !tile.riverEdges.includes(edgeIn)) tile.riverEdges.push(edgeIn);
              }
              if (i < mainRiverPath.length - 1) {
                const next = mainRiverPath[i + 1];
                const edgeOut = this.getDirectionEdge(tile, next);
                if (edgeOut !== -1 && !tile.riverEdges.includes(edgeOut)) tile.riverEdges.push(edgeOut);
              }
            }

            // Headwater source tile (index 0): emerges out of a mountain spring prop
            const srcTile = mainRiverPath[0];
            const srcEdgeOut = srcTile.riverEdges[0] ?? 1;
            const srcBack = (srcEdgeOut + 3) % 6;
            if (!srcTile.riverEdges.includes(srcBack)) srcTile.riverEdges.push(srcBack);
            srcTile.isRiverSource = true;
            srcTile.riverSourceEdge = srcBack;
            srcTile.decoration = { path: ASSET_MANIFEST.decoration.nature.mountain_B_grass, scale: 0.95 };

            // Terminal tile (last index): river flows into a watermill or scenic foothill spring
            const lastTile = mainRiverPath[mainRiverPath.length - 1];
            const termEdgeIn = lastTile.riverEdges[0] ?? 4;
            const termBack = (termEdgeIn + 3) % 6;
            if (!lastTile.riverEdges.includes(termBack)) lastTile.riverEdges.push(termBack);
            lastTile.isRiverTerminal = true;
            lastTile.riverTerminalEdge = termBack;
            lastTile.building = getWatermillPlacement(lastTile, termEdgeIn);

            // If riverCount >= 2: Spawn an inland tributary merging into the main river (confluence Y-junction)
            if (riverCount >= 2 && rankedSprings.length > 1) {
              const tribStart = rankedSprings.find(s => this.hexDistance(s, startTile) >= 3 && !mainRiverPath.includes(s));
              if (tribStart) {
                // Target midpoint of main river
                const midIdx = Math.floor(mainRiverPath.length / 2);
                const junctionTile = mainRiverPath[midIdx];

                // Block other main river tiles and neighbors that approach junctionTile along already occupied river edges
                const blockedForTrib = new Set();
                for (const t of mainRiverPath) {
                  if (t !== junctionTile) blockedForTrib.add(getKey(t.q, t.r));
                }
                for (const occEdge of junctionTile.riverEdges) {
                  const dir = HEX_DIRECTIONS[occEdge];
                  blockedForTrib.add(getKey(junctionTile.q + dir.q, junctionTile.r + dir.r));
                }

                const tribPath = findRiverPath(tribStart, junctionTile, blockedForTrib);

                if (tribPath && tribPath.length >= 2) {
                  // Carve tributary up to the tile before the junction
                  for (let i = 0; i < tribPath.length - 1; i++) {
                    const tile = tribPath[i];
                    tile.elevationLevel = 0.0;
                    tile.biome = 'plains';
                    tile.slope = null;
                    tile.hasRiver = true;
                    tile.isCoast = false;
                    tile.coastInfo = null;
                    tile.decoration = null;

                    if (i > 0) {
                      const prev = tribPath[i - 1];
                      const edgeIn = this.getDirectionEdge(tile, prev);
                      if (edgeIn !== -1 && !tile.riverEdges.includes(edgeIn)) tile.riverEdges.push(edgeIn);
                    }
                    if (i < tribPath.length - 1) {
                      const next = tribPath[i + 1];
                      const edgeOut = this.getDirectionEdge(tile, next);
                      if (edgeOut !== -1 && !tile.riverEdges.includes(edgeOut)) tile.riverEdges.push(edgeOut);
                    }
                  }

                  // Connect tributary into junctionTile
                  const prevToJunc = tribPath[tribPath.length - 2];
                  const edgeIntoJunc = this.getDirectionEdge(junctionTile, prevToJunc);
                  if (edgeIntoJunc !== -1 && !junctionTile.riverEdges.includes(edgeIntoJunc)) {
                    junctionTile.riverEdges.push(edgeIntoJunc);
                  }

                  // Tributary spring source
                  const tribSrcTile = tribPath[0];
                  const tribSrcEdge = tribSrcTile.riverEdges[0] ?? 1;
                  const tribSrcBack = (tribSrcEdge + 3) % 6;
                  if (!tribSrcTile.riverEdges.includes(tribSrcBack)) tribSrcTile.riverEdges.push(tribSrcBack);
                  tribSrcTile.isRiverSource = true;
                  tribSrcTile.riverSourceEdge = tribSrcBack;
                  tribSrcTile.decoration = { path: ASSET_MANIFEST.decoration.nature.mountain_B_grass, scale: 0.95 };
                }
              }
            }

            // If targetRiverSystems >= 2 (large rectangular worlds): Carve secondary independent river systems
            if (targetRiverSystems >= 2 && rankedSprings.length > 2) {
              const allRiverTileSet = new Set(hexList.filter(t => t.hasRiver).map(t => getKey(t.q, t.r)));
              // Maintain a buffered forbidden set so independent rivers never run side-by-side on adjacent hexes
              const riverBufferSet = new Set();
              for (const key of allRiverTileSet) {
                riverBufferSet.add(key);
                const [q, r] = key.split(',').map(Number);
                for (let e = 0; e < 6; e++) {
                  const dir = HEX_DIRECTIONS[e];
                  riverBufferSet.add(getKey(q + dir.q, r + dir.r));
                }
              }

              const remainingSprings = rankedSprings.filter(s => !riverBufferSet.has(getKey(s.q, s.r)));

              let carvedSecondary = 0;
              while (carvedSecondary < (targetRiverSystems - 1) && remainingSprings.length > 0) {
                const secSpring = remainingSprings.shift();
                const secCandidateEnds = lowlands.filter(t => {
                  if (riverBufferSet.has(getKey(t.q, t.r))) return false;
                  const d = this.hexDistance(secSpring, t);
                  return d >= 3 && d <= Math.min(25, this.radius * 1.5 + 6);
                }).sort((a, b) => {
                  return Math.abs(this.hexDistance(secSpring, a) - 6) - Math.abs(this.hexDistance(secSpring, b) - 6);
                });

                if (secCandidateEnds.length > 0) {
                  let secPath = null;
                  for (let attempt = 0; attempt < Math.min(6, secCandidateEnds.length); attempt++) {
                    const secEnd = secCandidateEnds[attempt];
                    secPath = findRiverPath(secSpring, secEnd, riverBufferSet);
                    if (secPath && secPath.length >= 3) break;
                  }

                  if (secPath && secPath.length >= 3) {
                    carvedSecondary++;
                    for (let i = 0; i < secPath.length; i++) {
                      const tile = secPath[i];
                      tile.elevationLevel = 0.0;
                      tile.biome = 'plains';
                      tile.slope = null;
                      tile.hasRiver = true;
                      tile.isCoast = false;
                      tile.coastInfo = null;
                      tile.decoration = null;

                      if (i > 0) {
                        const prev = secPath[i - 1];
                        const edgeIn = this.getDirectionEdge(tile, prev);
                        if (edgeIn !== -1 && !tile.riverEdges.includes(edgeIn)) tile.riverEdges.push(edgeIn);
                      }
                      if (i < secPath.length - 1) {
                        const next = secPath[i + 1];
                        const edgeOut = this.getDirectionEdge(tile, next);
                        if (edgeOut !== -1 && !tile.riverEdges.includes(edgeOut)) tile.riverEdges.push(edgeOut);
                      }
                      allRiverTileSet.add(getKey(tile.q, tile.r));
                      riverBufferSet.add(getKey(tile.q, tile.r));
                      for (let e = 0; e < 6; e++) {
                        const dir = HEX_DIRECTIONS[e];
                        riverBufferSet.add(getKey(tile.q + dir.q, tile.r + dir.r));
                      }
                    }

                    // Source
                    const secSrcTile = secPath[0];
                    const secSrcEdge = secSrcTile.riverEdges[0] ?? 1;
                    const secSrcBack = (secSrcEdge + 3) % 6;
                    if (!secSrcTile.riverEdges.includes(secSrcBack)) secSrcTile.riverEdges.push(secSrcBack);
                    secSrcTile.isRiverSource = true;
                    secSrcTile.riverSourceEdge = secSrcBack;
                    secSrcTile.decoration = { path: ASSET_MANIFEST.decoration.nature.mountain_B_grass, scale: 0.95 };

                    // Terminal
                    const secLastTile = secPath[secPath.length - 1];
                    const secTermEdge = secLastTile.riverEdges[0] ?? 4;
                    const secTermBack = (secTermEdge + 3) % 6;
                    if (!secLastTile.riverEdges.includes(secTermBack)) secLastTile.riverEdges.push(secTermBack);
                    secLastTile.isRiverTerminal = true;
                    secLastTile.riverTerminalEdge = secTermBack;
                    secLastTile.building = getWatermillPlacement(secLastTile, secTermEdge);
                  }
                }
              }
            }

            // Autotile all river pieces with exact matching
            for (const tile of hexList) {
              if (tile.hasRiver && tile.riverEdges.length >= 2) {
                tile.riverInfo = resolveRiverTile(tile.riverEdges, prng() < 0.35);
              }
            }
          }
        }
      }

      if (onProgress) onProgress(0.58, 'Carved River Channels & Estuary Networks');

      // 4. Multi-Hex Village Generation (> 1 hex per village)
      const landTiles = hexList.filter(t => t.biome !== 'water');
      const villages = [];
      let castleTile = null;

      if (landTiles.length > 0) {
        landTiles.sort((a, b) => b.elevationLevel - a.elevationLevel);
        const candidateCastles = landTiles.filter(t => !t.isCoast && !t.hasRiver);
        if (candidateCastles.length > 0) {
          castleTile = candidateCastles[0];
          castleTile.building = {
            type: 'castle',
            path: ASSET_MANIFEST.buildings.blue.castle,
            scale: 0.34, // Smaller village scale (1/4 hex)
            offset: { x: 0, y: 0.05, z: 0 }
          };
        }

        // Determine number of villages based on options or map size
        const countParam = (this.villageCount !== undefined) ? this.villageCount : villageCount;
        const numVillages = (countParam !== undefined && parseInt(countParam, 10) > 0)
          ? Math.max(1, parseInt(countParam, 10))
          : (hexList.length < 150 ? 2 : (hexList.length < 600 ? 3 : (hexList.length < 1500 ? 4 : 6)));

        const wallMode = wallFortification || 'walled'; // 'walled', 'fenced', 'mixed'
        const factionColors = ['blue', 'green', 'red', 'yellow'];
        const VILLAGE_NAMES = [
          // Forest / Glade
          "Oakhaven", "Elderglen", "Bramblebrook", "Whisperwind", "Briarwood", 
          "Timbervale", "Pinewood", "Greenbrier", "Willowdale", "Deepwood", 
          "Mossford", "Sylvancrest", "Hazelmere", "Ashford", "Ferndale", 
          // Mountain / Hill / Stone
          "Silverpeak", "Highcrag", "Stonehaven", "Ironforge", "Ravenstone", 
          "Falconridge", "Copperhill", "Redcliff", "Wyverncrag", "Windshear", 
          "Greystone", "Stormwatch", "Eaglecrest", "Granitefall", "Highbank", 
          // River / Water / Vale
          "Riverbend", "Deepwater", "Mistfall", "Crystalbrook", "Swiftwater", 
          "Clearwater", "Rivermouth", "Lakeshire", "Cinderford", "Suncreek", 
          "Frostford", "Whitebridge", "Shadowmere", "Moonwell", "Foggybottom", 
          // Sun / Gold / Royal / Haven
          "Sunhollow", "Goldcrest", "Dawnstar", "Kingsreach", "Goldshire", 
          "Summerhall", "Sunspire", "Amberfall", "Fairview", "Hearthstone", 
          "Starfall", "Valeshire", "Rosewood", "Autumnvale", "Everlund", 
          // Northern / Iron / Fortress
          "Winterfell", "Winterforge", "Ironhaven", "Northwatch", "Duskhaven", 
          "Dragonspire", "Thornbury", "Ashenmoor", "Marrowdell", "Southshore",
          "Crow's Nest", "Brightwood", "Fallowfield", "Blackthorn", "Silverwood"
        ];
        const shuffledNames = [...VILLAGE_NAMES].sort(() => prng() - 0.5);

        // Candidate village seeds: flat inland land tiles with space and habitable elevation
        const candidateVillageSeeds = candidateCastles.filter(t => 
          t !== castleTile && 
          (!castleTile || this.hexDistance(t, castleTile) >= 2) && 
          !t.hasRiver && !t.isCoast && t.elevationLevel <= 1.0
        );
        
        // Shuffle seeds deterministically
        const seedPool = [...candidateVillageSeeds].sort(() => prng() - 0.5);

        for (let vIdx = 0; vIdx < numVillages && seedPool.length > 0; vIdx++) {
          let seed = null;
          for (let i = 0; i < seedPool.length; i++) {
            const cand = seedPool[i];
            const tooClose = villages.some(v => this.hexDistance(cand, v.centerTile) < 3);
            if (!tooClose) {
              seed = seedPool.splice(i, 1)[0];
              break;
            }
          }
          if (!seed && seedPool.length > 0) seed = seedPool.shift();
          if (!seed) break;

          const vId = `village_${vIdx + 1}`;
          const vName = shuffledNames[vIdx % shuffledNames.length];
          const faction = factionColors[vIdx % factionColors.length];
          const isWalled = (wallMode === 'walled') || (wallMode === 'mixed' && vIdx % 2 === 0);

          // Village cluster: ALWAYS > 1 hex.
          // On maps > 500 hexes, allow larger towns (5 to 7 hexes for capitals/major towns)
          const isLargeMap = hexList.length > 500;
          let targetClusterSize;
          if (isLargeMap) {
            if (vIdx === 0) {
              // Primary Regional Capital / Major Town: 5 to 7 contiguous hexes
              targetClusterSize = Math.min(7, Math.max(5, 5 + Math.floor(prng() * 3)));
            } else if (vIdx === 1) {
              // Secondary Town: 4 to 6 contiguous hexes
              targetClusterSize = Math.min(6, Math.max(4, 4 + Math.floor(prng() * 3)));
            } else {
              // Surrounding Walled Hamlets: 3 to 4 contiguous hexes
              targetClusterSize = Math.min(4, Math.max(3, 3 + Math.floor(prng() * 2)));
            }
          } else {
            // Standard Dioramas (<= 500 hexes): 2 to 4 contiguous hexes
            targetClusterSize = Math.min(4, Math.max(2, 2 + Math.floor(prng() * 3)));
          }
          const cluster = [seed];
          seed.isVillage = true;
          seed.villageId = vId;
          seed.villageName = vName;
          seed.villageTheme = faction;
          seed.isWalled = isWalled;
          seed.villageRole = 'center';
          seed.slope = null;  // Village tiles always render as flat — sloped tiles break building/unit placement
          seed.subBuildings = [];
          seed.walls = [];

          // Grow cluster from seed neighbors across flat walkable land
          for (let step = 1; step < targetClusterSize; step++) {
            let bestNeighbor = null;
            // 1. Try neighbor with strict elevation match
            for (const tileInCluster of cluster) {
              for (let e = 0; e < 6; e++) {
                const dir = HEX_DIRECTIONS[e];
                const n = grid.get(getKey(tileInCluster.q + dir.q, tileInCluster.r + dir.r));
                if (n && n.biome !== 'water' && !n.isCoast && !n.hasRiver && !n.isVillage && n.elevationLevel >= 0 && n.elevationLevel <= 1.5) {
                  if (Math.abs(n.elevationLevel - seed.elevationLevel) <= 0.5) {
                    bestNeighbor = n;
                    break;
                  }
                }
              }
              if (bestNeighbor) break;
            }

            // 2. Fallback to any valid land neighbor if needed to satisfy > 1 hex requirement
            if (!bestNeighbor) {
              for (const tileInCluster of cluster) {
                for (let e = 0; e < 6; e++) {
                  const dir = HEX_DIRECTIONS[e];
                  const n = grid.get(getKey(tileInCluster.q + dir.q, tileInCluster.r + dir.r));
                  if (n && n.biome !== 'water' && !n.isCoast && !n.hasRiver && !n.isVillage && n.elevationLevel >= 0 && n.elevationLevel <= 1.5) {
                    bestNeighbor = n;
                    break;
                  }
                }
                if (bestNeighbor) break;
              }
            }

            if (bestNeighbor) {
              bestNeighbor.isVillage = true;
              bestNeighbor.villageId = vId;
              bestNeighbor.villageName = vName;
              bestNeighbor.villageTheme = faction;
              bestNeighbor.isWalled = isWalled;
              bestNeighbor.villageRole = 'district';
              bestNeighbor.slope = null;  // Flatten cluster tiles for correct building/unit placement
              bestNeighbor.subBuildings = [];
              bestNeighbor.walls = [];
              cluster.push(bestNeighbor);
            } else {
              break;
            }
          }

          // Invariant: Village MUST be strictly larger than 1 hex
          if (cluster.length < 2) {
            seed.isVillage = false;
            seed.villageId = null;
            seed.villageName = null;
            continue;
          }

          villages.push({
            id: vId,
            name: vName,
            centerTile: seed,
            tiles: cluster,
            faction,
            isWalled
          });
        }
      }

      if (onProgress) onProgress(0.66, 'Generated Multi-Hex Village Clusters');

      // 5. Build Road Network connecting Castle & Village Centers strictly inland
      const poiCenters = [];
      if (castleTile) poiCenters.push(castleTile);
      for (const v of villages) {
        poiCenters.push(v.centerTile);
      }

      if (poiCenters.length > 1) {
        let currentSource = poiCenters[0];
        for (let pIdx = 1; pIdx < poiCenters.length; pIdx++) {
          const target = poiCenters[pIdx];
          const path = this.findHexPath(grid, currentSource, target);
          if (path && path.length > 1) {
            for (let i = 0; i < path.length; i++) {
              const cur = path[i];
              cur.hasRoad = true;
              if (i > 0) {
                const prev = path[i - 1];
                const edgeIn = this.getDirectionEdge(cur, prev);
                if (edgeIn !== -1 && !cur.roadEdges.includes(edgeIn)) cur.roadEdges.push(edgeIn);
              }
              if (i < path.length - 1) {
                const next = path[i + 1];
                const edgeOut = this.getDirectionEdge(cur, next);
                if (edgeOut !== -1 && !cur.roadEdges.includes(edgeOut)) cur.roadEdges.push(edgeOut);
              }

              // Bridge check if crossing continuous river
              if (cur.hasRiver && cur.riverEdges.length >= 2) {
                const hasSharedEdge = cur.riverEdges.some(re => cur.roadEdges.includes(re));
                if (!hasSharedEdge) {
                  cur.isBridge = true;
                  cur.bridgeInfo = resolveBridgeTile(cur.riverEdges, cur.roadEdges);
                  cur.bridgeProp = resolveBridgeProp(cur.riverEdges, cur.roadEdges);
                  cur.building = null;
                  cur.decoration = null;
                }
              }
            }
          }
          currentSource = target;
        }
      }

      if (onProgress) onProgress(0.72, 'Pathfound Road Network & Bridges');

      // 6. Perimeter Wall Solving for Multi-Hex Villages
      for (const v of villages) {
        if (!v.isWalled) continue;
        const villageTileKeys = new Set(v.tiles.map(t => getKey(t.q, t.r)));

        for (const tile of v.tiles) {
          tile.walls = [];

          // Collect outer boundary edges and walkable exits
          const outerWalkableEdges = [];
          for (let e = 0; e < 6; e++) {
            const dir = HEX_DIRECTIONS[e];
            const nKey = getKey(tile.q + dir.q, tile.r + dir.r);
            const isInternal = villageTileKeys.has(nKey);
            if (!isInternal) {
              const neighbor = grid.get(nKey);
              const isWalkable = neighbor && neighbor.biome !== 'water' && !neighbor.isCoast && neighbor.elevationLevel < 2.0 && Math.abs(neighbor.elevationLevel - tile.elevationLevel) <= 0.5 && !neighbor.hasRiver;
              if (isWalkable) outerWalkableEdges.push(e);
            }
          }

          // Gate selection: any road edge MUST be a gate, plus ensure at least 1-2 exits to wilderness
          const gateEdges = new Set();
          for (let e = 0; e < 6; e++) {
            if (tile.roadEdges.includes(e)) gateEdges.add(e);
          }
          if (gateEdges.size === 0 && outerWalkableEdges.length > 0) {
            gateEdges.add(outerWalkableEdges[0]);
            if (outerWalkableEdges.length >= 3) {
              gateEdges.add(outerWalkableEdges[Math.floor(outerWalkableEdges.length / 2)]);
            }
          } else if (gateEdges.size === 1 && outerWalkableEdges.length >= 2) {
            const extra = outerWalkableEdges.find(e => !gateEdges.has(e));
            if (extra !== undefined) gateEdges.add(extra);
          }

          for (let e = 0; e < 6; e++) {
            const dir = HEX_DIRECTIONS[e];
            const nKey = getKey(tile.q + dir.q, tile.r + dir.r);
            const isInternal = villageTileKeys.has(nKey);

            if (!isInternal) {
              // Edge is on outer boundary perimeter of the village!
              const isGate = gateEdges.has(e);
              const wallTransform = getPerimeterWallTransform(e);

              const wallPath = isGate 
                ? ASSET_MANIFEST.buildings.neutral.fence_stone_straight_gate 
                : ASSET_MANIFEST.buildings.neutral.fence_stone_straight;

              tile.walls.push({
                type: isGate ? 'gate' : 'wall',
                path: wallPath,
                edge: e,
                isGate,
                offset: wallTransform.position,
                rotationY: wallTransform.rotationY
              });
            }
          }
        }
      }

      if (onProgress) onProgress(0.76, 'Solved Village Perimeter Walls & Gates');

      // 7. Sub-Hex Quadrant / Sector Building Placement (1/4 Scale)
      for (const v of villages) {
        const factionBldgs = ASSET_MANIFEST.buildings[v.faction] || ASSET_MANIFEST.buildings.blue;

        const isLargeTown = (v.tiles.length >= 5);
        // Guaranteed civic, trade, craft & tavern buildings distributed across each village cluster
        const civicRoster = isLargeTown
          ? ['tavern', 'church', 'market', 'townhall', 'blacksmith', 'stables', 'archeryrange', 'tavern', 'market']
          : ['tavern', 'church', 'market', 'archeryrange', 'blacksmith', 'stables'];

        for (let tIdx = 0; tIdx < v.tiles.length; tIdx++) {
          const tile = v.tiles[tIdx];
          tile.subBuildings = [];

          // Center Landmark Slot (at 0, 0, 0)
          const centerFree = !tile.hasRoad;
          if (tile.villageRole === 'center' && centerFree) {
            const landmarkType = (v.id === 'village_1') ? 'well' : ((prng() < 0.5) ? 'townhall' : 'church');
            const landmarkPath = factionBldgs[landmarkType] || factionBldgs.well || factionBldgs.market;

            tile.subBuildings.push({
              type: landmarkType,
              path: landmarkPath,
              offset: { x: 0, y: 0.05, z: 0 },
              scale: 0.32,
              rotationY: prng() * Math.PI * 2
            });
          }

          // 6 Radial Quadrants / Sectors (0 to 5)
          for (let s = 0; s < 6; s++) {
            // Keep road corridor clear
            if (tile.roadEdges.includes(s)) continue;

            // Density: populate ~65% of available quadrants
            if (prng() < 0.65) {
              const quadPos = getHexQuadrantLocal(s, 0.44);

              let bldgType;
              let bldgPath;
              let scale = 0.28 + prng() * 0.05; // 0.28 to 0.33 (approx 1/4 hex size)

              if (civicRoster.length > 0 && prng() < 0.70) {
                bldgType = civicRoster.shift();
                bldgPath = factionBldgs[bldgType] || factionBldgs.home_A;
              } else {
                const p = prng();
                if (p < 0.45) {
                  bldgType = 'home_A';
                  bldgPath = factionBldgs.home_A;
                } else if (p < 0.75) {
                  bldgType = 'home_B';
                  bldgPath = factionBldgs.home_B;
                } else if (p < 0.88) {
                  bldgType = 'tavern';
                  bldgPath = factionBldgs.tavern;
                } else if (p < 0.94) {
                  bldgType = 'fence';
                  bldgPath = ASSET_MANIFEST.buildings.neutral.fence_stone_straight;
                  scale = 0.32;
                } else {
                  bldgType = tile.slope ? 'fence' : 'tree';
                  bldgPath = tile.slope ? ASSET_MANIFEST.buildings.neutral.fence_stone_straight : ASSET_MANIFEST.decoration.nature.tree_single_A;
                  scale = 0.32;
                }
              }

              tile.subBuildings.push({
                type: bldgType,
                path: bldgPath,
                sector: s,
                offset: { x: quadPos.x, y: quadPos.y, z: quadPos.z },
                scale,
                rotationY: -quadPos.rad + Math.PI + (prng() - 0.5) * 0.3 // Face towards hex center
              });
            }
          }
        }
      }

      if (onProgress) onProgress(0.80, 'Populated Village Districts (1/4 Scale Buildings)');

      // 8. Place Rural Countryside Houses Along Roads Outside Villages
      for (const tile of hexList) {
        if (!tile.isVillage && tile.hasRoad && !tile.building && !tile.hasRiver) {
          for (let i = 0; i < 6; i++) {
            const dir = HEX_DIRECTIONS[i];
            const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
            if (neighbor && !neighbor.isVillage && neighbor.biome === 'plains' && !neighbor.hasRoad && !neighbor.building && !neighbor.isCoast && !neighbor.hasRiver && prng() < 0.20) {
              const quadPos = getHexQuadrantLocal((i + 3) % 6, 0.42);

              // Find closest village to assign regional faction color and identity
              let nearestVillage = villages[0] || null;
              let nearestDist = Infinity;
              for (const v of villages) {
                const d = this.hexDistance(neighbor, v.centerTile);
                if (d < nearestDist) {
                  nearestDist = d;
                  nearestVillage = v;
                }
              }
              const ruralFaction = nearestVillage ? nearestVillage.faction : 'blue';
              const ruralFactionBldgs = ASSET_MANIFEST.buildings[ruralFaction] || ASSET_MANIFEST.buildings.blue;

              neighbor.villageTheme = ruralFaction;
              neighbor.villageName = nearestVillage ? `${nearestVillage.name} Outskirts` : 'Outskirts';
              neighbor.building = {
                type: 'home',
                path: prng() > 0.5 ? ruralFactionBldgs.home_A : ruralFactionBldgs.home_B,
                scale: 0.28 + prng() * 0.04, // Same smaller size from villages
                offset: { x: quadPos.x, y: 0.05, z: quadPos.z },
                rotation: (i + 3) % 6
              };
            }
          }
        }
      }

      // 7. Decorate with Biome-Themed Props
      // Invariant: Strictly NO trees on sloped hills, ramps, or elevated hills/mountains to prevent clipping
      // 7. Place Natural Decorations (Varied Hills, Mountains, Rocks, Trees & Water Flora)
      // Strictly enforces: ZERO trees on slopes/hills/mountains to eliminate clipping!
      const nat = ASSET_MANIFEST.decoration.nature;
      const hillModels = [
        nat.hills_A,
        nat.hills_B,
        nat.hills_C,
        nat.hill_single_A,
        nat.hill_single_B,
        nat.hill_single_C
      ].filter(Boolean);

      const mountainModelsGeneral = [
        nat.mountain_A,
        nat.mountain_A_grass,
        nat.mountain_B,
        nat.mountain_B_grass,
        nat.mountain_C,
        nat.mountain_C_grass
      ].filter(Boolean);

      const mountainModelsWinter = [
        nat.mountain_A,
        nat.mountain_B,
        nat.mountain_C
      ].filter(Boolean);

      const rockModelsWarm = [
        nat.rock_single_A,
        nat.rock_single_C,
        nat.rock_single_D,
        nat.rock_single_E
      ].filter(Boolean);

      const rockModelsWinter = [
        nat.rock_single_B,
        nat.rock_single_C,
        nat.rock_single_D
      ].filter(Boolean);

      const treeModelsSpringSummer = [
        { path: nat.trees_A_large, scale: 0.85 },
        { path: nat.trees_B_large, scale: 0.85 },
        { path: nat.trees_A_medium, scale: 0.90 },
        { path: nat.trees_B_medium, scale: 0.90 },
        { path: nat.trees_A_small, scale: 0.95 },
        { path: nat.trees_B_small, scale: 0.95 },
        { path: nat.tree_single_A, scale: 1.0 },
        { path: nat.tree_single_B, scale: 1.0 }
      ].filter(t => Boolean(t.path));

      const treeModelsFall = [
        { path: nat.trees_B_large, scale: 0.85 },
        { path: nat.trees_B_medium, scale: 0.90 },
        { path: nat.trees_A_large, scale: 0.85 },
        { path: nat.tree_single_A, scale: 1.0 },
        { path: nat.tree_single_B, scale: 1.0 }
      ].filter(t => Boolean(t.path));

      const treeModelsWinter = [
        { path: nat.trees_A_large, scale: 0.85 },
        { path: nat.trees_A_medium, scale: 0.90 },
        { path: nat.trees_A_small, scale: 0.95 },
        { path: nat.tree_single_B, scale: 1.0 }
      ].filter(t => Boolean(t.path));

      // Small prop basenames that scatter to a random sub-hex sector instead of dead center
      const SMALL_PROP_BASENAMES = new Set([
        'tree_single_A', 'tree_single_B',
        'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E',
        'barrel', 'crate_A_big', 'crate_open', 'tent', 'wheelbarrow'
      ]);

      // Returns the basename of an FBX path (e.g. "rock_single_A" from ".../rock_single_A.fbx")
      const getPropBasename = (path) => {
        if (!path) return '';
        const seg = path.split('/').pop() || '';
        return seg.replace(/\.fbx$/i, '');
      };

      const waterFlora = [
        nat.waterlily_A,
        nat.waterlily_B,
        nat.waterplant_A,
        nat.waterplant_B,
        nat.waterplant_C
      ].filter(Boolean);

      // Lily/waterplant paths (prefer lilies near center, plants near edges)
      const waterLilyPaths = [nat.waterlily_A, nat.waterlily_B].filter(Boolean);
      const waterPlantPaths = [nat.waterplant_A, nat.waterplant_B, nat.waterplant_C].filter(Boolean);

      for (const tile of hexList) {
        if (!tile.building && !tile.hasRoad && !tile.hasRiver && !tile.isBridge) {
          const p = prng();

          // 0. Water tiles: scatter 1–3 lilies/plants at random sub-hex positions
          if (tile.biome === 'water' && !tile.isCoast) {
            let adjacentToLand = false;
            for (let i = 0; i < 6; i++) {
              const dir = HEX_DIRECTIONS[i];
              const nb = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
              if (nb && nb.biome !== 'water') { adjacentToLand = true; break; }
            }

            // Shoreline tiles get higher density; open-water tiles get sparse coverage
            const floraChance = adjacentToLand ? 0.55 : 0.22;
            if (waterFlora.length > 0 && p < floraChance) {
              tile.waterLilies = [];
              // Place 1–3 flora items at different sub-hex positions
              const count = adjacentToLand ? (1 + Math.floor(prng() * 3)) : 1;
              const usedSectors = new Set();

              for (let wi = 0; wi < count; wi++) {
                // Pick an unused sector (0–5) for variety; fall back to random if all used
                let sector;
                let attempts = 0;
                do {
                  sector = Math.floor(prng() * 6);
                  attempts++;
                } while (usedSectors.has(sector) && attempts < 10);
                usedSectors.add(sector);

                // Randomise radius within the sector: 0.18–0.40 for natural scatter
                const dist = 0.18 + prng() * 0.22;
                const quadPos = getHexQuadrantLocal(sector, dist);

                // Bias: inner placements prefer flat lilies, outer prefer tall plants
                const isInner = dist < 0.30;
                const pool = (isInner && waterLilyPaths.length > 0) ? waterLilyPaths : waterFlora;
                const floraPath = pool[Math.floor(prng() * pool.length)];

                tile.waterLilies.push({
                  path: floraPath,
                  offsetX: quadPos.x,
                  offsetZ: quadPos.z,
                  rotY: prng() * Math.PI * 2,
                  scale: 0.70 + prng() * 0.30  // 0.70–1.00 for variety
                });
              }
            }
            continue;
          }

          if (tile.isCoast) continue;

          // 1. Any tile with slope (sloped hill ramp) must NEVER have trees placed on it to prevent clipping
          if (tile.slope) {
            if (p < 0.22) {
              const rockList = (tile.biomeTheme === 'winter') ? rockModelsWinter : rockModelsWarm;
              const rockPath = rockList[Math.floor(prng() * rockList.length)] || nat.rock_single_A;
              tile.decoration = { path: rockPath, scale: 0.65 + prng() * 0.12 };
            }
            continue;
          }

          // 2. Mountains: Only mountain peaks, foothills, and boulders, strictly no trees
          if (tile.biome === 'mountain') {
            if (p < mountainDensity) {
              const mtnList = (tile.biomeTheme === 'winter') ? mountainModelsWinter : mountainModelsGeneral;
              const mtnPath = mtnList[Math.floor(prng() * mtnList.length)] || nat.mountain_A;
              tile.decoration = { path: mtnPath, scale: 0.90 + prng() * 0.10 };
            } else if (p < mountainDensity + 0.25) {
              const rockList = (tile.biomeTheme === 'winter') ? rockModelsWinter : rockModelsWarm;
              const rockPath = rockList[Math.floor(prng() * rockList.length)] || nat.rock_single_B;
              tile.decoration = { path: rockPath, scale: 0.80 + prng() * 0.15 };
            }
          // 3. Hills: Grassy mounds (hills_A..C, hill_single_A..C) and rocks, strictly no trees on hills
          } else if (tile.biome === 'hill') {
            if (p < 0.60 && hillModels.length > 0) {
              const hillPath = hillModels[Math.floor(prng() * hillModels.length)];
              tile.decoration = { path: hillPath, scale: 0.85 + prng() * 0.12 };
            } else if (p < 0.80) {
              const rockList = (tile.biomeTheme === 'winter') ? rockModelsWinter : rockModelsWarm;
              const rockPath = rockList[Math.floor(prng() * rockList.length)] || nat.rock_single_A;
              tile.decoration = { path: rockPath, scale: 0.75 + prng() * 0.15 };
            }
          // 4. Flat Plains: Natural habitat for rich variety of tree sizes, rocks, and biome props
          } else if (tile.biome === 'plains') {
            if (tile.biomeTheme === 'fall') {
              if (p < 0.32 && treeModelsFall.length > 0) {
                const item = treeModelsFall[Math.floor(prng() * treeModelsFall.length)];
                tile.decoration = { path: item.path, scale: item.scale };
              } else if (p < 0.50 && rockModelsWarm.length > 0) {
                const rockPath = rockModelsWarm[Math.floor(prng() * rockModelsWarm.length)];
                tile.decoration = { path: rockPath, scale: 0.75 + prng() * 0.15 };
              } else if (p < 0.58) {
                tile.decoration = { path: ASSET_MANIFEST.decoration.props.tent, scale: 0.75 };
              }
            } else if (tile.biomeTheme === 'winter') {
              if (p < treeDensity * 0.60 && treeModelsWinter.length > 0) {
                const item = treeModelsWinter[Math.floor(prng() * treeModelsWinter.length)];
                tile.decoration = { path: item.path, scale: item.scale };
              } else if (p < treeDensity * 0.80 && rockModelsWinter.length > 0) {
                const rockPath = rockModelsWinter[Math.floor(prng() * rockModelsWinter.length)];
                tile.decoration = { path: rockPath, scale: 0.75 + prng() * 0.15 };
              }
            } else {
              // Spring / Summer: Rich multi-scale groves and boulders
              if (p < treeDensity * 0.65 && treeModelsSpringSummer.length > 0) {
                const item = treeModelsSpringSummer[Math.floor(prng() * treeModelsSpringSummer.length)];
                tile.decoration = { path: item.path, scale: item.scale };
              } else if (p < treeDensity * 0.78 && rockModelsWarm.length > 0) {
                const rockPath = rockModelsWarm[Math.floor(prng() * rockModelsWarm.length)];
                tile.decoration = { path: rockPath, scale: 0.75 + prng() * 0.15 };
              }
            }
          }
        }
      }

      // Post-pass: apply random sub-hex sector offsets to small standalone props.
      // Large props (mountains, hills, grove clusters) stay centered.
      for (const tile of hexList) {
        if (!tile.decoration) continue;
        const basename = getPropBasename(tile.decoration.path);
        if (SMALL_PROP_BASENAMES.has(basename)) {
          // Wider scatter: 0.28–0.35 radius for natural variation (stays inside hex bounds)
          const sector = Math.floor(prng() * 6);
          const dist = 0.28 + prng() * 0.07;
          const quadPos = getHexQuadrantLocal(sector, dist);
          tile.decoration.scatterX = quadPos.x;
          tile.decoration.scatterZ = quadPos.z;
        }
      }

      // 8. Detect & Orient Transition Tiles between adjoining land biomes
      // Strictly enforces: material {n1} <> {n1} and {n2} <> {n2} across ALL 6 edges (0 conflicts)
      const candidateTransitionTiles = [];
      for (const tile of hexList) {
        if (tile.biome === 'water' || tile.isCoast || tile.hasRiver || tile.hasRoad || tile.slope || tile.building) {
          continue;
        }

        const distinctOtherBiomes = new Set();
        for (let i = 0; i < 6; i++) {
          const dir = HEX_DIRECTIONS[i];
          const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
          if (neighbor && neighbor.biome !== 'water') {
            if (neighbor.biomeTheme !== tile.biomeTheme) {
              distinctOtherBiomes.add(neighbor.biomeTheme);
            }
          }
        }

        // Must border exactly one other biome (dual-split, not a tri-biome corner)
        if (distinctOtherBiomes.size === 1) {
          candidateTransitionTiles.push({
            tile,
            otherBiome: [...distinctOtherBiomes][0]
          });
        }
      }

      for (const cand of candidateTransitionTiles) {
        const { tile, otherBiome } = cand;
        if (tile.isTransition) continue;

        const primary = tile.biomeTheme;
        const secondary = otherBiome;

        let bestRot = -1;
        let bestScore = -1;

        for (let rot = 0; rot < 6; rot++) {
          let conflicts = 0;
          let primaryMatches = 0;
          let secondaryMatches = 0;

          for (let i = 0; i < 6; i++) {
            const dir = HEX_DIRECTIONS[i];
            const neighbor = grid.get(getKey(tile.q + dir.q, tile.r + dir.r));
            if (!neighbor || neighbor.biome === 'water') {
              continue; // unconstrained if water or off-map
            }

            const slot = getTransitionEdgeSlot(i, rot);
            const myEdgeMat = (slot === 1) ? secondary : primary;

            // Neighbor's current edge material facing this tile
            const opp = getOppositeEdge(i);
            const neighborEdgeMat = getTileEdgeMaterial(neighbor, opp);

            if (myEdgeMat === neighborEdgeMat) {
              if (slot === 1) secondaryMatches++;
              else primaryMatches++;
            } else {
              conflicts++;
            }
          }

          // Invariant: ZERO conflicts, and must connect to both primary and secondary neighbors
          if (conflicts === 0 && secondaryMatches > 0 && primaryMatches > 0) {
            const score = primaryMatches + secondaryMatches;
            if (score > bestScore) {
              bestScore = score;
              bestRot = rot;
            }
          }
        }

        if (bestRot !== -1) {
          tile.isTransition = true;
          tile.transitionSecondaryBiome = secondary;
          tile.transitionRotationStep = bestRot;
          tile.transitionDir = bestRot;
        }
      }

      if (onProgress) onProgress(0.80, 'Aligned Multi-Biome Transitions');

      return { hexList, grid };
  }

  async generate({ radius = 6, seed = 42, waterLevel = 0.08, mountainDensity = 0.45, treeDensity = 0.4, riverDensity = 1, mapShape = 'rectangular', biomeMode = 'multi', wfcSafety = 'safe', villageCount, wallFortification = 'walled', onProgress } = {}) {
    if (this.isGenerating) return;
    this.isGenerating = true;
    const prng = createPRNG(seed);

    try {
      this.clearWorld();
      if (onProgress) onProgress(0.05, 'Synthesizing heightmap & hex topology...');
      await new Promise(r => setTimeout(r, 10));

      const { hexList, grid } = this.generateGrid({
        radius, seed, waterLevel, mountainDensity, treeDensity, riverDensity, mapShape, biomeMode, wfcSafety, villageCount, wallFortification,
        onProgress: (p, msg) => {
          if (onProgress) onProgress(0.05 + p * 0.70, msg);
        }
      });
      this.grid = grid;
      this.hexList = hexList;

      if (onProgress) onProgress(0.78, 'Preparing 3D model manifest...');
      await new Promise(r => setTimeout(r, 10));

      // 8. Preload models
      const modelsToPreload = [
        ASSET_MANIFEST.tiles.base.water,
        ASSET_MANIFEST.tiles.base.grass,
        ASSET_MANIFEST.tiles.base.grass_bottom,
        ASSET_MANIFEST.tiles.base.transition,
        ASSET_MANIFEST.tiles.coast.coast_A,
        ASSET_MANIFEST.tiles.coast.coast_B,
        ASSET_MANIFEST.tiles.coast.coast_C,
        ASSET_MANIFEST.tiles.coast.coast_D,
        ASSET_MANIFEST.tiles.coast.coast_E
      ];

      // Preload river models
      for (const r of Object.values(ASSET_MANIFEST.tiles.rivers)) {
        if (r && r.path) modelsToPreload.push(r.path);
      }

      for (const tile of hexList) {
        if (tile.isBridge) {
          if (tile.bridgeInfo) modelsToPreload.push(tile.bridgeInfo.path);
          if (tile.riverInfo) modelsToPreload.push(tile.riverInfo.path);
          if (tile.bridgeProp) modelsToPreload.push(tile.bridgeProp.path);
        }
        else if (tile.hasRiver && tile.riverInfo) modelsToPreload.push(tile.riverInfo.path);
        else if (tile.isCoast && tile.coastInfo) modelsToPreload.push(tile.coastInfo.path);
        else if (tile.hasRoad && tile.roadEdges.length > 0) {
          const roadInfo = resolveRoadTile(tile.roadEdges);
          modelsToPreload.push(roadInfo.path);
        }
        if (tile.building) modelsToPreload.push(tile.building.path);
        if (tile.walls && tile.walls.length > 0) {
          for (const w of tile.walls) modelsToPreload.push(w.path);
        }
        if (tile.subBuildings && tile.subBuildings.length > 0) {
          for (const b of tile.subBuildings) modelsToPreload.push(b.path);
        }
        if (tile.decoration) modelsToPreload.push(tile.decoration.path);
        if (tile.waterLilies && tile.waterLilies.length > 0) {
          for (const lily of tile.waterLilies) modelsToPreload.push(lily.path);
        }
      }

      if (onProgress) onProgress(0.82, 'Preloading 3D Assets...');
      await this.preloadModels(modelsToPreload);
      if (onProgress) onProgress(0.85, 'Assembling 3D Hex Scene...');

      // 9. Assemble Scene with Multi-Biome Materials & Spatial-Chunked Geometry Batching
      let count = 0;
      const total = hexList.length;
      const batcher = new StaticGeometryBatcher(16.0);

      // Static mesh matrix freezing: for standalone static meshes like transition tiles
      const addStatic = (obj) => {
        if (!obj) return;
        obj.matrixAutoUpdate = false;
        obj.updateMatrix();
        obj.traverse(child => {
          child.matrixAutoUpdate = false;
          child.updateMatrix();
        });
        this.worldGroup.add(obj);
      };

      for (const tile of hexList) {
        const { x, y, z } = hexToWorld(tile.q, tile.r, tile.elevationLevel);
        tile.worldPos = { x, y, z };

        let tileModel = null;
        if (tile.biome === 'water') {
          tileModel = await this.loadModel(ASSET_MANIFEST.tiles.base.water);
        } else if (tile.isBridge) {
          const bridgeTilePath = (tile.bridgeInfo && tile.bridgeInfo.path) || (tile.riverInfo && tile.riverInfo.path) || ASSET_MANIFEST.tiles.rivers.river_A.path;
          const rotStep = (tile.bridgeInfo && tile.bridgeInfo.rotationStep !== undefined) ? tile.bridgeInfo.rotationStep : (tile.riverInfo ? tile.riverInfo.rotationStep : 0);
          tileModel = await this.loadModel(bridgeTilePath);
          tileModel.rotation.y = getRotationRadians(rotStep);
        } else if (tile.riverInfo) {
          tileModel = await this.loadModel(tile.riverInfo.path);
          tileModel.rotation.y = getRotationRadians(tile.riverInfo.rotationStep);
        } else if (tile.coastInfo) {
          tileModel = await this.loadModel(tile.coastInfo.path);
          tileModel.rotation.y = getRotationRadians(tile.coastInfo.rotationStep);
        } else if (tile.hasRoad && tile.roadEdges && tile.roadEdges.length > 0) {
          const roadInfo = resolveRoadTile(tile.roadEdges);
          tileModel = await this.loadModel(roadInfo.path);
          tileModel.rotation.y = getRotationRadians(roadInfo.rotationStep);
        } else if (tile.slope) {
          if (tile.slope.type === 'high') tileModel = await this.loadModel(ASSET_MANIFEST.tiles.base.grass_sloped_high);
          else tileModel = await this.loadModel(ASSET_MANIFEST.tiles.base.grass_sloped_low);
          tileModel.rotation.y = getRotationRadians((tile.slope.dir - 1 + 6) % 6);
        } else if (tile.isTransition) {
          tileModel = await this.loadModel(ASSET_MANIFEST.tiles.base.transition);
          const rotStep = (tile.transitionRotationStep !== undefined) ? tile.transitionRotationStep : ((tile.transitionDir - 1 + 6) % 6);
          tileModel.rotation.y = getRotationRadians(rotStep);
        } else {
          tileModel = await this.loadModel(ASSET_MANIFEST.tiles.base.grass);
        }

        tileModel.position.set(x, y, z);

        if (tile.isTransition) {
          // Transition tiles use dual-material arrays [pMat, sMat] and are preserved as static meshes
          this.applyBiomeToMesh(tileModel, tile.biomeTheme, tile.transitionSecondaryBiome);
          addStatic(tileModel);
        } else {
          batcher.add(tileModel, tile.biomeTheme, x, z);
        }

        if (tile.elevationLevel > 0) {
          let currentLvl = tile.elevationLevel - 1.0;
          while (currentLvl > -0.6) {
            const skirt = await this.loadModel(ASSET_MANIFEST.tiles.base.grass_bottom);
            skirt.position.set(x, currentLvl, z);
            batcher.add(skirt, tile.biomeTheme, x, z);
            currentLvl -= 1.0;
          }
        }

        if (tile.building) {
          const bldg = await this.loadModel(tile.building.path);
          const bldgScale = tile.building.scale !== undefined ? tile.building.scale : 0.30;
          bldg.scale.setScalar(bldgScale);
          const ox = tile.building.offset ? tile.building.offset.x : 0;
          const oy = tile.building.offset ? tile.building.offset.y : 0;
          const oz = tile.building.offset ? tile.building.offset.z : 0;
          bldg.position.set(x + ox, y + oy, z + oz);
          if (tile.building.rotationY !== undefined) {
            bldg.rotation.y = tile.building.rotationY;
          } else if (tile.building.rotation !== undefined) {
            bldg.rotation.y = getRotationRadians(tile.building.rotation);
          }
          batcher.add(bldg, tile.biomeTheme, x + ox, z + oz);
        }

        // 3D Walls & Gates on Village Perimeter
        if (tile.walls && tile.walls.length > 0) {
          for (const wallDef of tile.walls) {
            const wallMesh = await this.loadModel(wallDef.path);
            wallMesh.position.set(x + wallDef.offset.x, y + wallDef.offset.y, z + wallDef.offset.z);
            wallMesh.rotation.y = wallDef.rotationY;
            batcher.add(wallMesh, tile.biomeTheme, x + wallDef.offset.x, z + wallDef.offset.z);
          }
        }

        // 3D Sub-Tile Buildings (1/4 Scale in Hex Quadrants & Plaza)
        if (tile.subBuildings && tile.subBuildings.length > 0) {
          for (const bldgDef of tile.subBuildings) {
            const bldgMesh = await this.loadModel(bldgDef.path);
            bldgMesh.position.set(x + bldgDef.offset.x, y + bldgDef.offset.y, z + bldgDef.offset.z);
            bldgMesh.scale.setScalar(bldgDef.scale);
            bldgMesh.rotation.y = bldgDef.rotationY;
            batcher.add(bldgMesh, tile.biomeTheme, x + bldgDef.offset.x, z + bldgDef.offset.z);
          }
        }

        if (tile.bridgeProp) {
          const bridgePropMesh = await this.loadModel(tile.bridgeProp.path);
          bridgePropMesh.position.set(x, y, z);
          bridgePropMesh.rotation.y = getRotationRadians(tile.bridgeProp.rotationStep);
          batcher.add(bridgePropMesh, tile.biomeTheme, x, z);
        }

        if (tile.decoration) {
          const deco = await this.loadModel(tile.decoration.path);
          // Small props use pre-computed scatter offset; large props stay centered
          const ox = tile.decoration.scatterX || 0;
          const oz = tile.decoration.scatterZ || 0;
          const decoY = tile.decoration.isWaterFlora ? (y + 0.04) : y;
          deco.position.set(x + ox, decoY, z + oz);
          if (tile.decoration.scale) deco.scale.setScalar(tile.decoration.scale);
          deco.rotation.y = Math.floor(prng() * 6) * (Math.PI / 3);
          batcher.add(deco, tile.biomeTheme, x + ox, z + oz);
        }

        // Water lily & plant clusters — scattered individually at sub-hex positions
        if (tile.waterLilies && tile.waterLilies.length > 0) {
          for (const lily of tile.waterLilies) {
            const lilyMesh = await this.loadModel(lily.path);
            lilyMesh.position.set(x + lily.offsetX, y + 0.04, z + lily.offsetZ);
            lilyMesh.scale.setScalar(lily.scale);
            lilyMesh.rotation.y = lily.rotY;
            batcher.add(lilyMesh, tile.biomeTheme, x + lily.offsetX, z + lily.offsetZ);
          }
        }

        count++;
        // Async yield to browser event loop every 40 tiles so UI never freezes
        if (count % 40 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
        if (onProgress && count % 20 === 0) {
          const pct = 0.85 + 0.10 * (count / total);
          onProgress(pct, `Placing 3D Tiles (${count} / ${total})...`);
        }
      }

      // Finalize batching into merged BufferGeometry meshes
      if (onProgress) onProgress(0.96, 'Merging static 3D batches...');
      await new Promise(r => setTimeout(r, 0));
      this.initBiomeMaterials();
      const batchedMeshesCount = batcher.build(this.worldGroup, this.biomeMaterials);
      console.log(`[StaticGeometryBatcher] Merged static world into ${batchedMeshesCount} batched meshes.`);

      if (onProgress) onProgress(1.0, 'Generation Complete!');
    } catch (err) {
      console.error('World generation encountered error:', err);
      if (onProgress) onProgress(1.0, 'Safely recovered from error');
    } finally {
      this.isGenerating = false;
    }
  }
  getDirectionEdge(tileA, tileB) {
    const dq = tileB.q - tileA.q;
    const dr = tileB.r - tileA.r;
    for (let i = 0; i < 6; i++) {
      if (HEX_DIRECTIONS[i].q === dq && HEX_DIRECTIONS[i].r === dr) {
        return i;
      }
    }
    return -1;
  }

  // Robust, bug-free A* Hex Pathfinding
  findHexPath(grid, start, end) {
    const getKey = (q, r) => `${q},${r}`;
    const startKey = getKey(start.q, start.r);
    const endKey = getKey(end.q, end.r);
    if (startKey === endKey) return [start];

    const openSet = [start];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    gScore.set(startKey, 0);
    fScore.set(startKey, this.hexDistance(start, end));

    let iter = 0;
    const maxRoadIter = Math.max(2500, (grid?.size || 100) * 3);
    while (openSet.length > 0) {
      iter++;
      if (iter > maxRoadIter) break; // Hard safety limit

      // Lowest fScore
      let bestIdx = 0;
      let bestF = fScore.get(getKey(openSet[0].q, openSet[0].r)) ?? Infinity;
      for (let i = 1; i < openSet.length; i++) {
        const f = fScore.get(getKey(openSet[i].q, openSet[i].r)) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          bestIdx = i;
        }
      }

      const current = openSet.splice(bestIdx, 1)[0];
      const currKey = getKey(current.q, current.r);

      if (currKey === endKey) {
        const totalPath = [current];
        let curr = current;
        const visited = new Set([currKey]);
        while (cameFrom.has(getKey(curr.q, curr.r))) {
          curr = cameFrom.get(getKey(curr.q, curr.r));
          const k = getKey(curr.q, curr.r);
          if (visited.has(k)) break;
          visited.add(k);
          totalPath.unshift(curr);
        }
        return totalPath;
      }

      closedSet.add(currKey);

      for (let i = 0; i < 6; i++) {
        const dir = HEX_DIRECTIONS[i];
        const neighbor = grid.get(getKey(current.q + dir.q, current.r + dir.r));
        if (!neighbor || neighbor.biome === 'water' || neighbor.isCoast) continue;
        if (neighbor.isRiverSource || neighbor.isRiverTerminal || (neighbor.building && neighbor.building.type === 'watermill')) continue;

        const neighKey = getKey(neighbor.q, neighbor.r);
        if (closedSet.has(neighKey)) continue;

        const oppDir = (i + 3) % 6;
        let riverPenalty = 0.0;
        if (neighbor.hasRiver) {
          if (neighbor.riverEdges && neighbor.riverEdges.includes(oppDir)) {
            // Road would enter along the river bed itself - skip or heavily penalize
            continue;
          }
          riverPenalty = 0.8;
        }

        const heightDiff = Math.abs(neighbor.elevationLevel - current.elevationLevel);
        const cost = 1.0 + (heightDiff * 3.0) + riverPenalty + (neighbor.hasRoad ? -0.4 : 0.0);
        const currentG = gScore.get(currKey) ?? 0;
        const tentativeG = currentG + cost;
        const neighG = gScore.get(neighKey) ?? Infinity;

        if (tentativeG < neighG) {
          cameFrom.set(neighKey, current);
          gScore.set(neighKey, tentativeG);
          fScore.set(neighKey, tentativeG + this.hexDistance(neighbor, end));
          if (!openSet.some(n => n.q === neighbor.q && n.r === neighbor.r)) {
            openSet.push(neighbor);
          }
        }
      }
    }
    return null;
  }

  hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }
}

export function generateWorldData(options = {}) {
  const dummyScene = { add: () => {} };
  const dummyLoader = {};
  const gen = new WorldGenerator(dummyScene, dummyLoader);
  return gen.generateGrid(options);
}

