/**
 * tileCatalog.js
 * Interactive Tile & Edge Aligner for KayKit Hexagons.
 * Displays 3D edge connector sockets, allows editing connector types (Road, River, Coast, None)
 * directly in 3D or via UI, and updates tileRegistry.
 */

import * as THREE from 'three';
import { HEX_APOTHEM, HEX_DIRECTIONS, getEdgeCenterLocal, getRotationRadians } from './hexMath.js';
import { tileRegistry, CONNECTOR_COLORS, CONNECTOR_TYPES } from './tileRegistry.js';

export class TileCatalogInspector {
  constructor(scene, gltfLoader) {
    this.scene = scene;
    this.loader = gltfLoader;
    this.currentModel = null;
    this.currentTileKey = 'road_A';
    this.modelCache = new Map();
    this.edgeMarkersGroup = new THREE.Group();
    this.scene.add(this.edgeMarkersGroup);

    this.currentRotationStep = 0; // 0..5
    this.interactiveEdgeMeshes = []; // for raycasting
    this.edgeSprites = [];
    this.edgeArrows = [];

    this.buildEdgeVisualizers();
  }

  buildEdgeVisualizers() {
    this.edgeMarkersGroup.clear();
    this.interactiveEdgeMeshes = [];
    this.edgeSprites = [];
    this.edgeArrows = [];

    for (let i = 0; i < 6; i++) {
      const dir = HEX_DIRECTIONS[i];
      const pos = getEdgeCenterLocal(i);

      // Interactive 3D socket disk on the edge midpoint
      const diskGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 24);
      const diskMat = new THREE.MeshStandardMaterial({
        color: CONNECTOR_COLORS.none,
        roughness: 0.3,
        metalness: 0.2
      });
      const disk = new THREE.Mesh(diskGeo, diskMat);
      disk.position.set(pos.x, 0.08, pos.z);
      disk.userData = { edgeIndex: i };
      this.edgeMarkersGroup.add(disk);
      this.interactiveEdgeMeshes.push(disk);

      // Directional arrow pointing outward
      const arrowDir = new THREE.Vector3(pos.x, 0, pos.z).normalize();
      const arrow = new THREE.ArrowHelper(arrowDir, new THREE.Vector3(pos.x * 0.3, 0.08, pos.z * 0.3), 0.65, CONNECTOR_COLORS.none, 0.2, 0.15);
      this.edgeMarkersGroup.add(arrow);
      this.edgeArrows.push(arrow);

      // 3D text label above the edge
      const sprite = this.createTextSprite(`E${i} (${dir.name})`);
      sprite.position.set(pos.x * 1.35, 0.5, pos.z * 1.35);
      this.edgeMarkersGroup.add(sprite);
      this.edgeSprites.push(sprite);
    }

    // Hex border guide line (flat edges)
    const linePoints = [];
    // 6 corners of regular hex (at 30, 90, 150, 210, 270, 330 deg)
    for (let c = 0; c <= 6; c++) {
      const angle = (c * 60 + 30) * (Math.PI / 180);
      const R = HEX_APOTHEM / Math.cos(Math.PI / 6); // R ≈ 1.097
      linePoints.push(new THREE.Vector3(Math.cos(angle) * R, 0.02, Math.sin(angle) * R));
    }
    const borderGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.6 });
    const border = new THREE.Line(borderGeo, borderMat);
    this.edgeMarkersGroup.add(border);
  }

  createTextSprite(text, color = '#38bdf8') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 110;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.roundRect(10, 15, 236, 80, 16);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 55);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.85, 0.38, 1);
    return sprite;
  }

  async loadTile(tileKey, path) {
    this.currentTileKey = tileKey;
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }

    try {
      let model;
      if (this.modelCache.has(path)) {
        model = this.modelCache.get(path).clone();
      } else {
        const res = await this.loader.loadAsync(path);
        model = res.scene || res;
        model.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.modelCache.set(path, model.clone());
      }

      this.currentModel = model;
      this.currentModel.position.set(0, 0, 0);
      this.currentModel.visible = this.edgeMarkersGroup.visible;
      this.applyRotation();
      this.scene.add(this.currentModel);

      this.refreshEdgeVisuals();
      return true;
    } catch (err) {
      console.error(`Error loading model ${path}:`, err);
      return false;
    }
  }

  refreshEdgeVisuals() {
    const tileDef = tileRegistry.getTile(this.currentTileKey);
    const edges = tileDef ? tileDef.edges : { 0: 'none', 1: 'none', 2: 'none', 3: 'none', 4: 'none', 5: 'none' };

    for (let i = 0; i < 6; i++) {
      const type = edges[i] || 'none';
      const color = CONNECTOR_COLORS[type] || CONNECTOR_COLORS.none;

      // Update disk color
      if (this.interactiveEdgeMeshes[i]) {
        this.interactiveEdgeMeshes[i].material.color.setHex(color);
        if (type !== 'none') {
          this.interactiveEdgeMeshes[i].material.emissive.setHex(color);
          this.interactiveEdgeMeshes[i].material.emissiveIntensity = 0.5;
        } else {
          this.interactiveEdgeMeshes[i].material.emissive.setHex(0x000000);
          this.interactiveEdgeMeshes[i].material.emissiveIntensity = 0;
        }
      }

      // Update arrow color
      if (this.edgeArrows[i]) {
        this.edgeArrows[i].setColor(color);
      }

      // Update sprite text
      const dir = HEX_DIRECTIONS[i];
      const typeLabel = type !== 'none' ? `[${type.toUpperCase()}]` : '';
      const hexColorStr = type === 'road' ? '#f59e0b' : (type === 'water' ? '#0ea5e9' : (type === 'sand' ? '#facc15' : '#64748b'));
      
      const newSprite = this.createTextSprite(`E${i}: ${dir.name} ${typeLabel}`, hexColorStr);
      newSprite.position.copy(this.edgeSprites[i].position);
      this.edgeMarkersGroup.remove(this.edgeSprites[i]);
      this.edgeMarkersGroup.add(newSprite);
      this.edgeSprites[i] = newSprite;
    }
  }

  setRotationStep(step) {
    this.currentRotationStep = ((step % 6) + 6) % 6;
    this.applyRotation();
    return this.currentRotationStep;
  }

  applyRotation() {
    if (this.currentModel) {
      this.currentModel.rotation.y = getRotationRadians(this.currentRotationStep);
    }
  }

  setVisible(visible) {
    this.edgeMarkersGroup.visible = visible;
    if (this.currentModel) {
      this.currentModel.visible = visible;
    }
  }
}
