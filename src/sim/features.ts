// Boost pads and oil patches laid along a route. Derived only from the map's route line and checkpoints (integers in,
// numbers out), so every client builds the same set; nothing here is random.

import type { MapData } from './mapdata.js';

export interface TrackFeature {
  /** Metres. */
  readonly x: number;
  readonly z: number;
  /** Heading along the route (unit vector), pads push this way. */
  readonly dx: number;
  readonly dz: number;
  readonly radius: number;
}

export interface TrackFeatures {
  readonly pads: readonly TrackFeature[];
  readonly oils: readonly TrackFeature[];
  /** Spots where a loose part appears on the road every so often. */
  readonly crates: readonly TrackFeature[];
}

export const PAD_RADIUS = 3.4;
export const OIL_RADIUS = 3.2;
/** Grip multiplier on oil (a slick from the Slime Gland is 0.2). */
export const OIL_GRIP_MUL = 0.3;
/** Extra forward speed per tick while on a pad (metres per tick per tick). */
export const PAD_ACCEL = 0.05;

const SPACING_M = 130;
const FIRST_M = 80;
const CLEAR_M = 28; // keep clear of checkpoints and the start

/** A loose part appears at each crate spot this often (and stays 30 s). */
export const CRATE_PERIOD_TICKS = 20 * 30;
const CRATE_FIRST_M = 150;
const CRATE_SPACING_M = 330;

const NONE: TrackFeatures = { pads: [], oils: [], crates: [] };

export function trackFeaturesFor(map: MapData): TrackFeatures {
  const route = map.route;
  if (!route || route.length < 6) return NONE;
  const stops = [{ x: map.start.x / 10, z: map.start.z / 10 }, ...map.checkpoints.map((c) => ({ x: c.x / 10, z: c.z / 10 }))];
  const clear = (x: number, z: number): boolean => stops.every((s) => Math.hypot(s.x - x, s.z - z) > CLEAR_M);
  const pads: TrackFeature[] = [];
  const oils: TrackFeature[] = [];
  const crates: TrackFeature[] = [];
  let nextCrate = CRATE_FIRST_M;
  let walked = 0;
  let next = FIRST_M;
  let n = 0;
  for (let i = 0; i + 3 < route.length; i += 2) {
    const x0 = route[i]! / 10, z0 = route[i + 1]! / 10, x1 = route[i + 2]! / 10, z1 = route[i + 3]! / 10;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len === 0) continue;
    while (walked + len >= next) {
      const t = (next - walked) / len;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (n % 2 === 0) {
        if (clear(x, z)) pads.push({ x, z, dx, dz, radius: PAD_RADIUS });
      } else {
        // Oil sits a little off the middle, alternating sides, so it can be driven round.
        const side = n % 4 === 1 ? 1 : -1;
        const ox = x - dz * 1.6 * side, oz = z + dx * 1.6 * side;
        if (clear(ox, oz)) oils.push({ x: ox, z: oz, dx, dz, radius: OIL_RADIUS });
      }
      n += 1;
      next += SPACING_M;
    }
    while (walked + len >= nextCrate) {
      const t = (nextCrate - walked) / len;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (clear(x, z)) crates.push({ x, z, dx: (x1 - x0) / len, dz: (z1 - z0) / len, radius: 1 });
      nextCrate += CRATE_SPACING_M;
    }
    walked += len;
  }
  return { pads, oils, crates };
}

export function featureAt(list: readonly TrackFeature[], x: number, z: number): TrackFeature | undefined {
  for (const f of list) if (Math.hypot(x - f.x, z - f.z) <= f.radius) return f;
  return undefined;
}
