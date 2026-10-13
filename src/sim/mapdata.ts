// The baked map format shared by the bake tool and the game (no DOM, no Node APIs).
// All coordinates are integer decimetres in local metres around the bake origin (see geo.ts), so
// the file contains no floats and the simulation derives identical numbers on every client.

export interface RoadSeg {
  /** Half-width in decimetres. */
  readonly hw: number;
  /** Flat [x0, z0, x1, z1, ...] decimetres. */
  readonly pts: readonly number[];
}

export interface BuildingData {
  /** Height in decimetres. */
  readonly h: number;
  /** Flat footprint [x, z, ...] decimetres (render). */
  readonly pts: readonly number[];
  /**
   * Convex collider pieces (each <= 8 vertices, flat [x, z, ...] decimetres). A building is normally one
   * piece; a building that overlaps a road is cut back from the lane into several. Absent when it has none.
   */
  readonly hulls?: readonly (readonly number[])[];
}

export interface WallData {
  /** Two end points [x0, z0, x1, z1] decimetres. */
  readonly pts: readonly [number, number, number, number];
  readonly h: number;
}

export interface MapData {
  readonly id: string;
  readonly version: 1;
  readonly name: string;
  readonly osmDate: string;
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly start: { readonly x: number; readonly z: number; readonly yaw: number }; // dm, dm, micro-radians
  readonly checkpoints: readonly { readonly x: number; readonly z: number }[];
  readonly roads: readonly RoadSeg[];
  readonly buildings: readonly BuildingData[];
  readonly walls: readonly WallData[];
  readonly anchors: readonly { readonly x: number; readonly z: number }[];
  readonly lengthM: number;
  /** The route's centre line, flat [x, z, ...] decimetres, about one point per 3 m (for the Lantern's guide line). */
  readonly route?: readonly number[];
}
