// Boost pads and oil patches laid along a route. Derived only from the map's route line and checkpoints (integers in,
// numbers out), so every client builds the same set; nothing here is random.

import type { MapData } from './mapdata.js';
import { STOMP_PERIOD_TICKS } from './events.js';

export interface TrackFeature {
  /** Metres. */
  readonly x: number;
  readonly z: number;
  /** Heading along the route (unit vector), pads push this way. */
  readonly dx: number;
  readonly dz: number;
  readonly radius: number;
  /** Roamers only: half-extent in metres of the area the creature wanders, along the road and across it. */
  readonly reach?: number;
  readonly across?: number;
}

export interface TrackFeatures {
  readonly pads: readonly TrackFeature[];
  readonly oils: readonly TrackFeature[];
  /** Spots where a loose part appears on the road every so often. */
  readonly crates: readonly TrackFeature[];
  /** Mystery boxes: drive through one for a random power-up (or a jinx); it comes back after a while. */
  readonly boxes: readonly TrackFeature[];
  /** Wandering creatures: each wanders at random inside a small area of road around its spot, anywhere on the map. */
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
/** Boxes and creatures are scattered along every road of the map, not only the route; no two closer than this. */
const BOX_APART_M = 55;
const ROAMER_APART_M = 90;

export const ROAMER_KINDS = 3;
const ROAMER_FIRST_M = 210;
const ROAMER_SPACING_M = 240;
const ROAMER_REACH_M = 9;
const ROAMER_ACROSS_M = 5;

const NONE: TrackFeatures = { pads: [], oils: [], crates: [], boxes: [], roamers: [] };

export function trackFeaturesFor(map: MapData, onRoad: (x: number, z: number) => boolean = () => true): TrackFeatures {
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
  // Mystery boxes and wandering creatures go along the route first (so it always has them), then along every other road.
  const boxes: TrackFeature[] = [];
  const roamers: TrackFeature[] = [];
  const apart = (list: readonly TrackFeature[], x: number, z: number, d: number): boolean => list.every((f) => Math.hypot(f.x - x, f.z - z) >= d);
  const addBox = (x: number, z: number, dx: number, dz: number, force: boolean): void => {
    if (clear(x, z) && (force || (onRoad(x, z) && apart(boxes, x, z, BOX_APART_M)))) boxes.push({ x, z, dx, dz, radius: BOX_RADIUS });
  };
  const addRoamer = (x: number, z: number, dx: number, dz: number, halfRoad: number): void => {
    if (!clear(x, z) || !apart(roamers, x, z, ROAMER_APART_M)) return;
    // The wander area must lie on the road: try the full size, then smaller ones.
    for (const scale of [1, 0.7, 0.5]) {
      const reach = ROAMER_REACH_M * scale, across = Math.min(halfRoad * 0.85, ROAMER_ACROSS_M) * scale;
      let fits = true;
      for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) fits = fits && onRoad(x + dx * u * reach - dz * v * across, z + dz * u * reach + dx * v * across);
      if (fits && across >= 1.2) {
        roamers.push({ x, z, dx, dz, radius: 1, reach, across });
        return;
      }
    }
  };
  walkLine(route, BOX_SPACING_M, BOX_FIRST_M, (x, z, dx, dz) => addBox(x, z, dx, dz, true));
  walkLine(route, ROAMER_SPACING_M, ROAMER_FIRST_M, (x, z, dx, dz) => addRoamer(x, z, dx, dz, 3.4));
  for (const road of map.roads) {
    walkLine(road.pts, BOX_SPACING_M, BOX_FIRST_M / 2, (x, z, dx, dz) => addBox(x, z, dx, dz, false));
    walkLine(road.pts, ROAMER_SPACING_M, ROAMER_FIRST_M / 2, (x, z, dx, dz) => addRoamer(x, z, dx, dz, road.hw / 10));
  }
  return { pads, oils, crates, boxes, roamers };
}

/** Calls `emit` at `first` metres along a polyline (flat decimetres) and then every `spacing` metres, with the heading there. */
function walkLine(pts: readonly number[], spacing: number, first: number, emit: (x: number, z: number, dx: number, dz: number) => void): void {
  let walked = 0;
  let next = first;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i]! / 10, z0 = pts[i + 1]! / 10, x1 = pts[i + 2]! / 10, z1 = pts[i + 3]! / 10;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len === 0) continue;
    while (walked + len >= next) {
      const t = (next - walked) / len;
      emit(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, (x1 - x0) / len, (z1 - z0) / len);
      next += spacing;
    }
    walked += len;
  }
}

export function featureAt(list: readonly TrackFeature[], x: number, z: number): TrackFeature | undefined {
  for (const f of list) if (Math.hypot(x - f.x, z - f.z) <= f.radius) return f;
  return undefined;
}

/**
 * Where a roamer is at a given tick and which way it faces: it wanders at random (two slow drifts added together along
 * and across the road) inside its area, so it never walks a fixed line. `salt` makes each race different.
 */
export function roamerAt(r: TrackFeature, index: number, salt: number, frame: number): { x: number; z: number; heading: number; speed: number } {
  const h1 = hashMix(salt, index * 3 + 1), h2 = hashMix(salt, index * 3 + 2);
  const f = (h: number, shift: number, lo: number, span: number): number => lo + (((h >>> shift) & 255) / 255) * span;
  const w1 = f(h1, 0, 0.12, 0.13), w2 = f(h1, 8, 0.25, 0.15), w3 = f(h2, 0, 0.1, 0.13), w4 = f(h2, 8, 0.27, 0.15);
  const p1 = f(h1, 16, 0, 6.28), p2 = f(h1, 24, 0, 6.28), p3 = f(h2, 16, 0, 6.28), p4 = f(h2, 24, 0, 6.28);
  const t = frame / 30;
  const reach = r.reach ?? 0, across = r.across ?? 0;
  const u = reach * (0.6 * Math.sin(w1 * t + p1) + 0.4 * Math.sin(w2 * t + p2));
  const v = across * (0.6 * Math.sin(w3 * t + p3) + 0.4 * Math.sin(w4 * t + p4));
  const du = reach * (0.6 * w1 * Math.cos(w1 * t + p1) + 0.4 * w2 * Math.cos(w2 * t + p2));
  const dv = across * (0.6 * w3 * Math.cos(w3 * t + p3) + 0.4 * w4 * Math.cos(w4 * t + p4));
  const vx = r.dx * du - r.dz * dv, vz = r.dz * du + r.dx * dv;
  return { x: r.x + r.dx * u - r.dz * v, z: r.z + r.dz * u + r.dx * v, heading: Math.atan2(vx, vz), speed: Math.hypot(vx, vz) };
}

/** Which creature a roamer is: 0 zombie, 1 ghost, 2 pumpkin walker. */
export const roamerKind = (index: number): number => hashMix(0x5eed, index) % ROAMER_KINDS;

/** Ticks until this roamer's next stomp (0 on the tick it happens); only pumpkin walkers stomp. */
export function stompIn(index: number, salt: number, frame: number): number {
  const off = hashMix(salt, index + 777) % STOMP_PERIOD_TICKS;
  return (STOMP_PERIOD_TICKS - ((frame + off) % STOMP_PERIOD_TICKS)) % STOMP_PERIOD_TICKS;
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
