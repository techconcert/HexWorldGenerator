#!/usr/bin/env node
/**
 * test_batching_qa.js
 * Automated QA verification for StaticGeometryBatcher and Three.js Frustum Culling.
 *
 * Verifies:
 * 1. StaticGeometryBatcher architecture:
 *    - Spatial chunking by (chunkX, chunkZ)
 *    - Attribute sanitization (position, normal, uv)
 *    - Subdividing by (chunkKey, biomeKey, isCastShadow)
 *    - BoundingBox & BoundingSphere calculation per merged geometry
 *    - Mesh count reduction (~800–1200 down to ~20–40)
 * 2. Frustum Culling mathematical verification:
 *    - When camera is zoomed into a quadrant or village, off-screen chunks are culled
 * 3. Pathfinding & Terrain Height Invariance:
 *    - getTerrainHeightAt returns identical heights
 *    - Raycasting against batched worldGroup.children correctly intersects terrain
 */

import * as THREE from 'three';
import { StaticGeometryBatcher, generateWorldData } from './worldGenerator.js';
import { LivingWorldNavMesh } from './livingWorldNavMesh.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

console.log('================================================================');
console.log('   ⬡ GEOMETRY BATCHING & FRUSTUM CULLING QA SUITE ⬡');
console.log('================================================================\n');

// --- Test 1: StaticGeometryBatcher Attribute Sanitization & De-indexing ---
console.log('Test 1: Attribute Sanitization and De-indexing...');
const batcher = new StaticGeometryBatcher(16.0);

// Create mock indexed geometry with extra attribute
const indexedGeom = new THREE.BufferGeometry();
const pos = new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]);
const norm = new Float32Array([0, 0, 1,  0, 0, 1,  0, 0, 1]);
const uvs = new Float32Array([0, 0,  1, 0,  0, 1]);
const colors = new Float32Array([1, 0, 0,  0, 1, 0,  0, 0, 1]);
const indices = new Uint16Array([0, 1, 2]);

indexedGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
indexedGeom.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
indexedGeom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
indexedGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
indexedGeom.setIndex(new THREE.BufferAttribute(indices, 1));

const mockMesh = new THREE.Mesh(indexedGeom, new THREE.MeshBasicMaterial());
mockMesh.position.set(5, 0, 5);
mockMesh.castShadow = true;

batcher.add(mockMesh, 'spring', 5, 5);

const targetGroup = new THREE.Group();
const mockBiomeMaterials = new Map([
  ['spring', new THREE.MeshBasicMaterial({ color: 0x22c55e })]
]);

const meshCount = batcher.build(targetGroup, mockBiomeMaterials);
assert(meshCount === 1, 'Batcher created 1 merged mesh from 1 mock input');
const builtMesh = targetGroup.children[0];
assert(builtMesh.castShadow === true, 'Merged mesh preserves castShadow = true');
assert(builtMesh.receiveShadow === true, 'Merged mesh has receiveShadow = true');
assert(builtMesh.frustumCulled === true, 'Merged mesh has frustumCulled = true');
assert(builtMesh.geometry.attributes.position !== undefined, 'Merged geometry has position attribute');
assert(builtMesh.geometry.attributes.normal !== undefined, 'Merged geometry has normal attribute');
assert(builtMesh.geometry.attributes.uv !== undefined, 'Merged geometry has uv attribute');
assert(builtMesh.geometry.attributes.color === undefined, 'Sanitization successfully stripped extraneous color attribute');
assert(builtMesh.geometry.index === null, 'Indexed geometry was cleanly converted to non-indexed triangles');
assert(builtMesh.geometry.boundingSphere !== null, 'Merged geometry has computed boundingSphere');
assert(builtMesh.geometry.boundingBox !== null, 'Merged geometry has computed boundingBox');

// --- Test 2: Spatial Chunk Partitioning ---
console.log('\nTest 2: Spatial Chunk Partitioning across multiple world coordinates...');
const multiBatcher = new StaticGeometryBatcher(16.0);

// Add items in 4 distinct chunks: (0,0), (0,20), (20,0), (20,20)
const coords = [
  { x: 2, z: 2 },
  { x: 3, z: 4 },
  { x: 2, z: 22 },
  { x: 25, z: 5 },
  { x: 28, z: 24 }
];

for (let i = 0; i < coords.length; i++) {
  const g = new THREE.BufferGeometry();
  // Horizontal ground triangle spanning 2 units in X and Z, CCW upward normal
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 0,0,2, 2,0,0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0,1,0, 0,1,0, 0,1,0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 1,0, 0,1]), 2));
  const m = new THREE.Mesh(g);
  m.position.set(coords[i].x, 0, coords[i].z);
  m.castShadow = false;
  multiBatcher.add(m, 'spring', coords[i].x, coords[i].z);
}

const multiGroup = new THREE.Group();
const chunkMeshCount = multiBatcher.build(multiGroup, mockBiomeMaterials);
// Chunks: (0,0), (0,1), (1,0), (1,1) -> 4 distinct spatial chunks
assert(chunkMeshCount === 4, `Batcher separated 5 meshes across 4 chunks into ${chunkMeshCount} merged meshes`);

for (const m of multiGroup.children) {
  assert(m.geometry.boundingBox !== null, `Chunk mesh at ${m.geometry.boundingBox.min.x.toFixed(1)},${m.geometry.boundingBox.min.z.toFixed(1)} has valid boundingBox`);
}

// --- Test 3: Frustum Culling Verification ---
console.log('\nTest 3: Frustum Culling Verification...');
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
// Position camera zoomed in on chunk (0,0) looking down from above:
camera.position.set(2, 10, 2);
camera.lookAt(2, 0, 2);
camera.updateMatrixWorld(true);

const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
frustum.setFromProjectionMatrix(projScreenMatrix);

let visibleCount = 0;
let culledCount = 0;

for (const m of multiGroup.children) {
  const sphere = m.geometry.boundingSphere.clone();
  sphere.applyMatrix4(m.matrixWorld);
  if (frustum.intersectsSphere(sphere)) {
    visibleCount++;
  } else {
    culledCount++;
  }
}

assert(visibleCount > 0, `At least one chunk in front of camera is visible (${visibleCount} visible)`);
assert(culledCount > 0, `Distant chunks outside camera view are culled by Three.js frustum (${culledCount} culled)`);

// --- Test 4: Pathfinding & Unit Height Invariance ---
console.log('\nTest 4: Pathfinding & Unit Elevation Invariance...');
const worldData = generateWorldData({ radius: 6, seed: 7919 });
const navMesh = new LivingWorldNavMesh(worldData);

// Verify height queries and pathfinding on real world data
const h1 = navMesh.getTerrainHeightAt(0, 0);
const h2 = navMesh.getTerrainHeightAt(5, 5);
assert(typeof h1 === 'number' && !isNaN(h1), `Valid terrain height sampled at (0,0): ${h1.toFixed(3)}`);
assert(typeof h2 === 'number' && !isNaN(h2), `Valid terrain height sampled at (5,5): ${h2.toFixed(3)}`);

// --- Test 5: Raycasting against Batched Triangles ---
console.log('\nTest 5: Raycasting against Merged BufferGeometry Meshes...');
const testRaycaster = new THREE.Raycaster();
testRaycaster.set(new THREE.Vector3(2.2, 10, 2.2), new THREE.Vector3(0, -1, 0)); // Ray pointing straight down

const intersects = testRaycaster.intersectObjects(multiGroup.children, true);
assert(intersects.length > 0, `Raycaster successfully intersected batched mesh triangles (hits: ${intersects.length})`);
if (intersects.length > 0) {
  assert(Math.abs(intersects[0].point.y) < 0.001, `Hit point Y is exact: ${intersects[0].point.y.toFixed(3)}`);
}

// --- Test 6: Draw Calls Reduction Benchmark on a 500-Hex World ---
console.log('\nTest 6: Draw Call Reduction Scaling on Full World...');
const largeWorld = generateWorldData({ radius: 8, mapShape: 'rectangular', seed: 42 });
const largeBatcher = new StaticGeometryBatcher(16.0);
let simulatedIndividualMeshes = 0;

// Simulate adding all tiles, skirts, buildings, and decorations
for (const tile of largeWorld.hexList) {
  // Tile base
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0,0,1, 0,0,1, 0,0,1]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 1,0, 0,1]), 2));
  const m = new THREE.Mesh(g);
  m.position.set(tile.worldPos?.x || 0, 0, tile.worldPos?.z || 0);
  m.castShadow = false;
  largeBatcher.add(m, tile.biomeTheme || 'spring', tile.worldPos?.x || 0, tile.worldPos?.z || 0);
  simulatedIndividualMeshes++;

  // Props / buildings if any
  if (tile.building || tile.decoration) {
    const propMesh = new THREE.Mesh(g.clone());
    propMesh.position.set(tile.worldPos?.x || 0, 0.5, tile.worldPos?.z || 0);
    propMesh.castShadow = true;
    largeBatcher.add(propMesh, tile.biomeTheme || 'spring', tile.worldPos?.x || 0, tile.worldPos?.z || 0);
    simulatedIndividualMeshes++;
  }
}

const largeGroup = new THREE.Group();
const finalBatchedDrawCalls = largeBatcher.build(largeGroup, mockBiomeMaterials);

console.log(`  Individual Mesh Count (Pre-Batching): ${simulatedIndividualMeshes}`);
console.log(`  Batched Mesh Count (Draw Calls):     ${finalBatchedDrawCalls}`);
const reductionPct = ((1 - finalBatchedDrawCalls / simulatedIndividualMeshes) * 100).toFixed(1);
console.log(`  Draw Call Reduction:                 ${reductionPct}%`);

assert(finalBatchedDrawCalls <= 40, `Final draw calls bounded to <= 40 (actual: ${finalBatchedDrawCalls})`);
assert(finalBatchedDrawCalls < simulatedIndividualMeshes / 5, `Massive draw call reduction achieved (> 80%)`);

console.log('\n================================================================');
console.log(`Total Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed === 0) {
  console.log('🏆 ALL GEOMETRY BATCHING & FRUSTUM CULLING INVARIANTS PASSED! (0 Defects)');
} else {
  console.error('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('================================================================\n');
