// Shared map maths for the bake pipeline (dev-only, never shipped).
// Projection matches the spec: local metres around a fixed origin, flat world.
export const ORIGIN = { lat: 5.56, lon: -0.2 } as const;
const COS_LAT0 = Math.cos((ORIGIN.lat * Math.PI) / 180);

export interface Pt {
  readonly x: number;
  readonly z: number;
}

export function project(lat: number, lon: number): Pt {
  return { x: (lon - ORIGIN.lon) * COS_LAT0 * 111320, z: -(lat - ORIGIN.lat) * 110540 };
}

export function unproject(p: Pt): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - p.z / 110540, lon: ORIGIN.lon + p.x / (COS_LAT0 * 111320) };
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);
