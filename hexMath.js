/**
 * hexMath.js
 * Hexagonal coordinate math and orientation utilities for KayKit Medieval Hexagons.
 * 
 * KayKit Hex Geometry:
 * - Corner vertices: at 30°, 90°, 150°, 210°, 270°, 330°
 * - Flat edges (midpoints) at:
 *     Edge 0: 300° (-60°) -> North-East (q:  1, r: -1)
 *     Edge 1:   0° (  0°) -> East       (q:  1, r:  0)
 *     Edge 2:  60° (+60°) -> South-East (q:  0, r:  1)
 *     Edge 3: 120°(+120°) -> South-West (q: -1, r:  1)
 *     Edge 4: 180°(+180°) -> West       (q: -1, r:  0)
 *     Edge 5: 240°(+240°) -> North-West (q:  0, r: -1)
 */

export const HEX_APOTHEM = 0.95; // Inner radius (center to flat edge midpoint)
export const HEX_WIDTH = 2.0;    // Flat-to-flat spacing along X
export const HEX_VERT_SPACING = 1.7320508; // sqrt(3) spacing along Z
export const HEX_HEIGHT = 1.0;   // Vertical model height

export const HEX_DIRECTIONS = [
  { edge: 0, q:  1, r: -1, name: "NE", angleDeg: 300, rad: (5 * Math.PI) / 3 },
  { edge: 1, q:  1, r:  0, name: "E",  angleDeg:   0, rad: 0 },
  { edge: 2, q:  0, r:  1, name: "SE", angleDeg:  60, rad: Math.PI / 3 },
  { edge: 3, q: -1, r:  1, name: "SW", angleDeg: 120, rad: (2 * Math.PI) / 3 },
  { edge: 4, q: -1, r:  0, name: "W",  angleDeg: 180, rad: Math.PI },
  { edge: 5, q:  0, r: -1, name: "NW", angleDeg: 240, rad: (4 * Math.PI) / 3 }
];

/**
 * Convert axial coordinates (q, r) to 3D world position (X, Z).
 */
export function hexToWorld(q, r, elevation = 0) {
  const x = (q + r * 0.5) * HEX_WIDTH;
  const z = r * HEX_VERT_SPACING;
  const y = elevation * HEX_HEIGHT;
  return { x, y, z };
}

/**
 * Convert 3D world position (X, Z) to nearest axial coordinates (q, r).
 */
export function worldToHex(x, z) {
  const rFrac = z / HEX_VERT_SPACING;
  const qFrac = (x / HEX_WIDTH) - (rFrac * 0.5);
  const sFrac = -qFrac - rFrac;

  let q = Math.round(qFrac);
  let r = Math.round(rFrac);
  let s = Math.round(sFrac);

  const qDiff = Math.abs(q - qFrac);
  const rDiff = Math.abs(r - rFrac);
  const sDiff = Math.abs(s - sFrac);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  }
  return { q, r };
}

/**
 * Get the exact flat edge midpoint in local 3D model space
 */
export function getEdgeCenterLocal(edgeIndex) {
  const dir = HEX_DIRECTIONS[edgeIndex % 6];
  const rad = dir.rad;
  return {
    x: Math.cos(rad) * HEX_APOTHEM,
    y: 0.05,
    z: Math.sin(rad) * HEX_APOTHEM
  };
}

export function getOppositeEdge(edgeIndex) {
  return (edgeIndex + 3) % 6;
}

/**
 * Three.js Clockwise Rotation around Y axis
 */
export function getRotationRadians(step) {
  return -step * (Math.PI / 3);
}

/**
 * Get local position of a sub-tile quadrant/sector (0 to 5) within a hex
 * at a given radial distance ratio (default 0.44 * HEX_APOTHEM).
 */
export function getHexQuadrantLocal(quadrantIndex, distanceRatio = 0.44) {
  const dir = HEX_DIRECTIONS[quadrantIndex % 6];
  const rad = dir.rad;
  const d = HEX_APOTHEM * distanceRatio;
  return {
    x: Math.cos(rad) * d,
    y: 0.05,
    z: Math.sin(rad) * d,
    rad
  };
}

/**
 * Returns the local (x, z) coordinates for one of the 7 sub-hex areas:
 * - 0 to 5: The 6 radial sectors (0: NE, 1: E, 2: SE, 3: SW, 4: W, 5: NW)
 * - 6: The hex center
 *
 * @param {number|string} areaIndex - 0..5 for radial sectors, 6 or 'center' for center. If 'random', picks 0..6.
 * @param {number} distanceRatio - Radial distance for sectors (default 0.44 * HEX_APOTHEM)
 * @returns {{ x: number, y: number, z: number, areaIndex: number, angleRad: number }}
 */
export function getHexSubAreaLocal(areaIndex = 'random', distanceRatio = 0.44) {
  let idx = areaIndex;
  if (idx === 'random' || idx === undefined || idx === null) {
    idx = Math.floor(Math.random() * 7); // 0 to 6
  } else if (idx === 'center') {
    idx = 6;
  } else {
    idx = Math.max(0, Math.min(6, parseInt(idx, 10) || 0));
  }

  if (idx === 6) {
    return {
      x: (Math.random() - 0.5) * 0.14,
      y: 0.05,
      z: (Math.random() - 0.5) * 0.14,
      areaIndex: 6,
      angleRad: 0
    };
  }

  const dir = HEX_DIRECTIONS[idx % 6];
  const rad = dir.rad;
  const d = HEX_APOTHEM * distanceRatio;
  return {
    x: Math.cos(rad) * d,
    y: 0.05,
    z: Math.sin(rad) * d,
    areaIndex: idx % 6,
    angleRad: rad
  };
}

/**
 * Returns world coordinates (x, y, z) for a given sub-hex area (0..5 or 6/center) on a node.
 */
export function getHexSubAreaWorld(node, areaIndex = 'random', distanceRatio = 0.44) {
  const local = getHexSubAreaLocal(areaIndex, distanceRatio);
  return {
    x: node.worldX + local.x,
    y: (node.worldY || 0) + local.y,
    z: node.worldZ + local.z,
    areaIndex: local.areaIndex,
    angleRad: local.angleRad
  };
}

/**
 * Get transform (local offset position and Y-rotation) for placing a perimeter wall / fence
 * along a specified flat edge (0 to 5) using the model's native center-hex origin.
 */
export function getPerimeterWallTransform(edgeIndex) {
  return {
    position: {
      x: 0.0,
      y: 0.0,
      z: 0.0
    },
    rotationY: ((4 - (edgeIndex % 6) + 6) % 6) * (Math.PI / 3)
  };
}

/**
 * Get local position of a hex corner vertex (0 to 5) at 30°, 90°, 150°, 210°, 270°, 330°.
 */
export function getHexVertexLocal(vertexIndex) {
  const angleDeg = 30 + (vertexIndex % 6) * 60;
  const rad = (angleDeg * Math.PI) / 180;
  const vertexRadius = HEX_APOTHEM / Math.cos(Math.PI / 6); // ~1.097
  return {
    x: Math.cos(rad) * vertexRadius,
    y: 0.0,
    z: Math.sin(rad) * vertexRadius,
    angleDeg,
    rad
  };
}
