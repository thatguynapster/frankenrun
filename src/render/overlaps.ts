// Buildings in the map data often overlap (a building and its parts, or two outlines drawn over the same plot) at the same
// height. Their roofs and walls then sit in exactly the same place and the GPU flickers between them (z-fighting).
// This gives every building in an overlapping group a few centimetres of its own: a little taller and a little smaller than
// the one before it. It only changes how buildings are drawn; collision is untouched, so nothing here affects the simulation.

import type { BuildingData } from '../sim/mapdata.js';

export interface Separation {
  /** Metres added to the building's height. */
  readonly lift: number;
  /** Metres its walls are pulled in from the outline. */
  readonly shrink: number;
}

const LIFT_STEP = 0.06;
const SHRINK_STEP = 0.05;
const MAX_RANK = 6;
const NONE: Separation = { lift: 0, shrink: 0 };

interface Box {
  readonly i: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly cx: number;
  readonly cz: number;
  readonly pts: readonly number[];
}

function inside(x: number, z: number, p: readonly number[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!, zi = p[i + 1]!, xj = p[j]!, zj = p[j + 1]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** True when a corner of `a` (nudged toward its centre, so a shared edge does not count) lies inside `b`. */
function reaches(a: Box, b: Box): boolean {
  for (let k = 0; k < a.pts.length; k += 2) {
    if (inside(a.cx + (a.pts[k]! - a.cx) * 0.9, a.cz + (a.pts[k + 1]! - a.cz) * 0.9, b.pts)) return true;
  }
  return false;
}

/** One entry per building (same order as `buildings`); parked cars and buildings that overlap nothing get no change. */
export function separateOverlaps(buildings: readonly BuildingData[]): readonly Separation[] {
  const boxes: Box[] = [];
  buildings.forEach((b, i) => {
    if (b.car !== undefined || b.pts.length < 6) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sx = 0, sz = 0;
    for (let k = 0; k < b.pts.length; k += 2) {
      const x = b.pts[k]!, z = b.pts[k + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      sx += x;
      sz += z;
    }
    const n = b.pts.length / 2;
    boxes.push({ i, minX, maxX, minZ, maxZ, cx: sx / n, cz: sz / n, pts: b.pts });
  });
  // Earlier buildings stay put; each overlapping later one steps one rank up from the highest rank it overlaps.
  const below: number[][] = buildings.map(() => []);
  const sorted = [...boxes].sort((p, q) => p.minX - q.minX);
  for (let a = 0; a < sorted.length; a += 1) {
    const p = sorted[a]!;
    for (let c = a + 1; c < sorted.length && sorted[c]!.minX <= p.maxX; c += 1) {
      const q = sorted[c]!;
      if (q.minZ > p.maxZ || q.maxZ < p.minZ) continue;
      if (!reaches(p, q) && !reaches(q, p)) continue;
      if (p.i < q.i) below[q.i]!.push(p.i);
      else below[p.i]!.push(q.i);
    }
  }
  const rank: number[] = buildings.map(() => 0);
  const out: Separation[] = buildings.map(() => NONE);
  for (let i = 0; i < buildings.length; i += 1) {
    const under = below[i]!;
    if (under.length === 0) continue;
    rank[i] = Math.min(MAX_RANK, Math.max(...under.map((j) => rank[j]!)) + 1);
    out[i] = { lift: rank[i]! * LIFT_STEP, shrink: rank[i]! * SHRINK_STEP };
  }
  return out;
}
