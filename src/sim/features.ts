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
  /** Mystery boxes: drive through one for a random power-up (or a jinx); it comes back after a while. */
  readonly boxes: readonly TrackFeature[];
  /** Wandering creatures that stroll back and forth across the road at these spots. */
  readonly roamers: readonly TrackFeature[];
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

export const BOX_RADIUS = 2.4;
/** A mystery box comes back this long after it was opened. */
export const BOX_RESPAWN_TICKS = 12 * 30;
const BOX_FIRST_M = 115;
const BOX_SPACING_M = 175;

export const ROAMER_RADIUS = 1.5;
/** How far a roamer strolls to each side of the route line. */
export const ROAMER_SWING_M = 3.4;
const ROAMER_FIRST_M = 210;
const ROAMER_SPACING_M = 240;

const NONE: TrackFeatures = { pads: [], oils: [], crates: [], boxes: [], roamers: [] };

export function trackFeaturesFor(map: MapData): TrackFeatures {
  const route = map.route;
  if (!route || route.length < 6) return NONE;
  const stops = [{ x: map.start.x / 10, z: map.start.z / 10 }, ...map.checkpoints.map((c) => ({ x: c.x / 10, z: c.z / 10 }))];
  const clear = (x: number, z: number): boolean => stops.every((s) => Math.hypot(s.x - x, s.z - z) > CLEAR_M);
  const pads: TrackFeature[] = [];
  const oils: TrackFeature[] = [];
  const crates: TrackFeature[] = [];
  const boxes: TrackFeature[] = [];
  const roamers: TrackFeature[] = [];
  let nextCrate = CRATE_FIRST_M;
  let nextBox = BOX_FIRST_M;
  let nextRoamer = ROAMER_FIRST_M;
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
    while (walked + len >= nextBox) {
      const t = (nextBox - walked) / len;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (clear(x, z)) boxes.push({ x, z, dx: (x1 - x0) / len, dz: (z1 - z0) / len, radius: BOX_RADIUS });
      nextBox += BOX_SPACING_M;
    }
    while (walked + len >= nextRoamer) {
      const t = (nextRoamer - walked) / len;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (clear(x, z)) roamers.push({ x, z, dx: (x1 - x0) / len, dz: (z1 - z0) / len, radius: ROAMER_RADIUS });
      nextRoamer += ROAMER_SPACING_M;
    }
    walked += len;
  }
  return { pads, oils, crates, boxes, roamers };
}

export function featureAt(list: readonly TrackFeature[], x: number, z: number): TrackFeature | undefined {
  for (const f of list) if (Math.hypot(x - f.x, z - f.z) <= f.radius) return f;
  return undefined;
}

/** Where a roamer is at a given tick: it strolls across the road and back. `salt` makes each race different. */
export function roamerAt(r: TrackFeature, index: number, salt: number, frame: number): { x: number; z: number; heading: number } {
  const h = hashMix(salt, index);
  const period = 150 + (h % 90); // 5 to 8 s for a full there-and-back
  const phase = ((h >>> 8) % 1000) / 1000;
  const angle = (frame / period + phase) * Math.PI * 2;
  const lateral = Math.sin(angle) * ROAMER_SWING_M;
  const x = r.x - r.dz * lateral, z = r.z + r.dx * lateral;
  // walking sideways: the facing follows the sign of the lateral velocity
  const sign = Math.cos(angle) >= 0 ? 1 : -1;
  return { x, z, heading: Math.atan2(-r.dz * sign, r.dx * sign) };
}

function hashMix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

/** The route point `ahead` metres further along the line from the route vertex nearest to (x, z), with the heading there. */
export function routeAhead(map: MapData, x: number, z: number, ahead: number): { x: number; z: number; dx: number; dz: number } | undefined {
  const route = map.route;
  if (!route || route.length < 6) return undefined;
  let best = 0, bestD = Infinity;
  for (let i = 0; i + 1 < route.length; i += 2) {
    const d = Math.hypot(route[i]! / 10 - x, route[i + 1]! / 10 - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  let walked = 0;
  for (let i = best; i + 3 < route.length; i += 2) {
    const x0 = route[i]! / 10, z0 = route[i + 1]! / 10, x1 = route[i + 2]! / 10, z1 = route[i + 3]! / 10;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len === 0) continue;
    if (walked + len >= ahead) {
      const t = (ahead - walked) / len;
      return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / len, dz: (z1 - z0) / len };
    }
    walked += len;
  }
  return undefined;
}
