# Hexagonal Autotiling Specification

This document defines the mathematical foundations, coordinate standards, connector socket schemas, and autotiling invariants for `POC_Kaykit`.

---

## 1. Hexagonal Mathematics & Coordinate Systems

The system uses **pointy-topped regular hexagons** arranged in an **axial coordinate system** $(q, r)$:

```
           +r  / \  (0, -1)
              |   |
  (-1, 0) / \  \ /  / \ (1, -1)
         |   |     |   |
  (-1, 1) \ /  / \  \ / (1, 0)
              |   |
          +q   \ /  (0, 1)
```

### Conversion to 3D Cartesian Coordinates $(x, y, z)$:
With outer radius $R = 1.0$ and apothem $w = R \cdot \frac{\sqrt{3}}{2} \approx 0.866025$:
- Hex width (flat-to-flat) = $2 \cdot w = \sqrt{3} \approx 1.73205$
- Hex horizontal spacing = $\sqrt{3}$
- Hex vertical spacing = $1.5 \cdot R = 1.5$
- Cartesian formulas:
  $$x = \sqrt{3} \cdot \left(q + \frac{r}{2}\right)$$
  $$z = 1.5 \cdot r$$
  $$y = \text{elevation}$$

---

## 2. Six-Edge Indexing Standard (0 to 5)

Every hexagon has exactly 6 edges, indexed clockwise starting from North-East:

| Edge Index | Compass Direction | Angle from +X axis | Local Offset $(dx, dz)$ | Opposite Edge `(i + 3) % 6` |
| :---: | :---: | :---: | :---: | :---: |
| **E0** | **North-East (NE)** | $300^\circ$ ($-60^\circ$) | $(+0.433, -0.750)$ | **E3 (SW)** |
| **E1** | **East (E)** | $0^\circ$ | $(+0.866, 0.000)$ | **E4 (W)** |
| **E2** | **South-East (SE)** | $60^\circ$ | $(+0.433, +0.750)$ | **E5 (NW)** |
| **E3** | **South-West (SW)** | $120^\circ$ | $(-0.433, +0.750)$ | **E0 (NE)** |
| **E4** | **West (W)** | $180^\circ$ | $(-0.866, 0.000)$ | **E1 (E)** |
| **E5** | **North-West (NW)** | $240^\circ$ | $(-0.433, -0.750)$ | **E2 (SE)** |

### Reciprocity Invariant:
If tile $A$ at $(q_A, r_A)$ shares edge $i$ with tile $B$ at $(q_B, r_B)$, then:
$$\text{NeighborEdge}(B, A) = (i + 3) \pmod 6$$
The socket tag on $A$'s edge $i$ MUST be compatible with $B$'s edge $(i + 3) \pmod 6$.

---

## 3. Rotation Transformation Math

A 3D model placed on a hex can be rotated in 6 discrete steps of $60^\circ$ ($k \in \{0, 1, 2, 3, 4, 5\}$):
$$\theta = k \cdot \frac{\pi}{3} = k \cdot 60^\circ$$

When a model with native edge sockets $[S_0, S_1, S_2, S_3, S_4, S_5]$ is rotated clockwise by $k$ steps:
$$\text{RotatedSocket}[i] = S_{(i - k + 6) \pmod 6}$$

Conversely, to find which rotation step $k$ will align native socket $S_0$ with world edge $i$:
$$k = i$$

---

## 4. Connector Types & Sockets

The system classifies edge boundaries using `CONNECTOR_TYPES` (`tileRegistry.js`):

| Connector Type | Key | Visual Color | Description & Adjacency Rules |
| :--- | :--- | :--- | :--- |
| **None / Grass** | `'none'` | Emerald Green (`#22c55e`) | Pure land/grass boundary. May only touch other grass edges or internal inland tiles. |
| **Road Exit** | `'road'` | Amber Orange (`#f59e0b`) | Road lane crossing the boundary. Must strictly connect to an adjacent tile with a matching `road` exit. |
| **River Exit** | `'river'` | Cyan / River Blue (`#06b6d4`) | Flowing river channel. Must strictly connect to another `river` exit, a river mouth into water, or a bridge. **NEVER connects to grass.** |
| **Coast (Sand)** | `'coast_sand'` | Golden Sand (`#eab308`) | Sandy beach boundary. Must strictly connect to adjacent coast beach edges. **STRICTLY FORBIDDEN from bordering open water.** |
| **Coast (Water)** | `'coast_water'` | Deep Ocean Blue (`#0284c7`) | Submerged water boundary on a coast tile. Must face open water or another submerged coast boundary. |

---

## 5. Algorithmic Invariants & Quality Rules

### 1. Coastline Invariant (Wave Function Collapse)
- Open water tiles have 6 `water` edges.
- Coast tiles (`hex_coast_A` through `E`) transition between inland grass and open water.
- **Critical Invariant**: A `sand` edge must NEVER border open water or an unpopulated void cell. Sand edges only connect to sand edges, creating continuous beach perimeters.

### 2. River Network Invariants
- **High-to-Low Flow**: Rivers originate at higher elevations (hills/mountains) and carve downward toward sea level.
- **Confluence Rule**: Where two river branches join, the junction tile MUST be a multi-way river piece (e.g. `hex_river_D` or `hex_river_I`) where all tributary edges are tagged `river`. A river edge must NEVER terminate into a solid grass edge.
- **Estuary / River Mouth**: Rivers terminate into ocean or lakes via dedicated mouth/delta tiles (`hex_river_J` or coast transitions).

### 3. Road & Bridge Invariants
- Roads form a connected graph between points of interest (settlements, castle, coast).
- **Bridge Placement**: When a road trajectory crosses a river or water tile, a bridge tile is placed.
  - The bridge model MUST align along the road axis.
  - The bridge connects road edges on opposite sides while permitting water flow underneath.

---

## 6. Sub-Hex 6-Sector Geometry & Horse Quadrants

To prevent artificial clustering at tile centers and eliminate repetitive circular pathing, each hexagon is partitioned into 6 radial sectors plus a central core.

### Radial Sector Decomposition
For a pointy-topped hexagon with radius $R = 1.0$:
- **Center Core (Sector 6 / Center)**:
  $$(dx, dz) = (0.0, 0.0)$$
- **Radial Sectors (0 to 5)**:
  Each sector corresponds to an edge direction with radial offset distance $d \in [0.35, 0.65]$:
  $$\theta_s = s \cdot \frac{\pi}{3} + \frac{\pi}{6} \quad (s \in \{0, 1, 2, 3, 4, 5\})$$
  $$dx = d \cdot \cos(\theta_s)$$
  $$dz = d \cdot \sin(\theta_s)$$

### Sub-Hex Roaming Behavior
- **Citizens & Pedestrians**: Select wander targets across all 6 outer sectors and center with equal probability, generating organic human movement.
- **Horse Quadrant Partitioning**:
  - Domestic horses (`horse_A`..`G`) are restricted to the 6 outer sectors (quadrants $0..5$).
  - **Distance Constraint**: Horses must maintain $r = \sqrt{dx^2 + dz^2} > 0.25$, avoiding the center core to simulate perimeter grazing and paddock behaviors.

---

## 7. Wave Function Collapse (WFC) Contradiction Guard

In dense archipelagos or complex shorelines, conflicting local constraints can occasionally produce an empty candidate set.

### Contradiction Resolution Strategy
1. **Sand-to-Water Isolation Guard**:
   If an edge evaluation produces `sand` adjacent to open `water` or unallocated `void`, candidate tiles containing exposed sand on that edge are discarded.
2. **Deterministic Fallback Hierarchy**:
   If zero valid coast tiles satisfy strict socket matching on all 6 edges:
   - Relax edge requirements from strict multi-edge matches to dominant water-facing edges.
   - Default to `hex_coast_A` oriented towards the primary water neighbor.
   - Under no circumstances may a grass cliff (`hex_grass`) or bare sand cliff border open water without a coast mesh.

