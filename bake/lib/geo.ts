// Shared map maths for the bake pipeline (dev-only, never shipped).
// Projection matches the spec: local metres around a fixed origin, flat world. Each city has its own origin, picked
// from the route id on the command line (london-soho -> london) or from the CITY environment variable, so no city's
// coordinates get large enough to lose precision.
export const CITY_ORIGINS: Readonly<Record<string, { lat: number; lon: number }>> = {
  accra: { lat: 5.56, lon: -0.2 },
  london: { lat: 51.51, lon: -0.11 },
  newyork: { lat: 40.72, lon: -73.99 },
  tokyo: { lat: 35.68, lon: 139.74 },
  mexicocity: { lat: 19.43, lon: -99.15 },
};

/** The city a route id belongs to: its prefix before the first dash if that is a known city, else Accra. */
export function cityOfRoute(routeId: string): string {
  const prefix = routeId.split('-')[0] ?? '';
  return prefix in CITY_ORIGINS ? prefix : 'accra';
}

const CITY = process.env['CITY'] ?? cityOfRoute(process.argv[2] ?? '');
export const ORIGIN = CITY_ORIGINS[CITY] ?? CITY_ORIGINS['accra']!;
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
