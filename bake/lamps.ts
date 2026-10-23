// Where street lamps stand (dev-only, run by the bake): just outside the road edge, alternating sides, never close to a
// building and never on a carriageway. The result is stored in the baked map, so the renderer draws exactly what the
// simulation's tentacle anchors use, and the phone never has to search for spots.
import type { BuildingData, MapData } from '../src/sim/mapdata.ts';

// ---------- tunables ----------

/** Lamp posts keep at least this far from every building (metres), so they stand in the open and not against a wall. */
export const LAMP_BUILDING_GAP = 2.5;
/** Distance between lamps along a road, and the closest two may be (metres). */
const LAMP_SPACING = 34;
const LAMP_MIN_APART = 16;
/** Lamps stand this far outside the edge of the carriageway. */
const LAMP_SETBACK = 1.2;
const MAX_LAMPS = 700;

export const h32 = (n: number): number => {
  let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
};
export const rand01 = (n: number): number => h32(n) / 4294967296;

// ---------- footprint helpers ----------

export interface Footprint {
  readonly xs: number[];
  readonly zs: number[];
  readonly area: number;
  readonly cx: number;
  readonly cz: number;
}

export function footprintOf(b: BuildingData): Footprint | undefined {
  const xs: number[] = [], zs: number[] = [];
  for (let k = 0; k < b.pts.length; k += 2) {
    const x = b.pts[k]! / 10, z = b.pts[k + 1]! / 10;
    const lx = xs[xs.length - 1], lz = zs[zs.length - 1];
    if (lx !== undefined && Math.hypot(x - lx, z - lz!) < 0.05) continue;
    xs.push(x);
    zs.push(z);
  }
  if (xs.length > 2 && Math.hypot(xs[0]! - xs[xs.length - 1]!, zs[0]! - zs[zs.length - 1]!) < 0.05) {
    xs.pop();
    zs.pop();
  }
  if (xs.length < 3) return undefined;
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const j = (i + 1) % xs.length;
    a += xs[i]! * zs[j]! - xs[j]! * zs[i]!;
    cx += xs[i]!;
    cz += zs[i]!;
  }
  return { xs, zs, area: a / 2, cx: cx / xs.length, cz: cz / xs.length };
}

export function inside(f: Footprint, x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = f.xs.length - 1; i < f.xs.length; j = i, i += 1) {
    if (f.zs[i]! > z !== f.zs[j]! > z && x < ((f.xs[j]! - f.xs[i]!) * (z - f.zs[i]!)) / (f.zs[j]! - f.zs[i]!) + f.xs[i]!) c = !c;
  }
  return c;
}

// ---------- a uniform grid over line segments, for "how close is the nearest wall or road" ----------

export class SegmentGrid {
  private readonly cells = new Map<number, number[]>();
  readonly segs: number[] = []; // x0, z0, x1, z1, tag
  constructor(private readonly cell = 16) {}
  private key(cx: number, cz: number): number {
    return (cx + 8192) * 16384 + (cz + 8192);
  }
  add(x0: number, z0: number, x1: number, z1: number, tag: number): void {
    const id = this.segs.length / 5;
    this.segs.push(x0, z0, x1, z1, tag);
    const c0x = Math.floor(Math.min(x0, x1) / this.cell), c1x = Math.floor(Math.max(x0, x1) / this.cell);
    const c0z = Math.floor(Math.min(z0, z1) / this.cell), c1z = Math.floor(Math.max(z0, z1) / this.cell);
    for (let cx = c0x; cx <= c1x; cx += 1) for (let cz = c0z; cz <= c1z; cz += 1) {
      const k = this.key(cx, cz);
      const list = this.cells.get(k);
      if (list) list.push(id);
      else this.cells.set(k, [id]);
    }
  }
  /** Calls `visit(distance, tag)` for every segment within `radius` of the point. */
  near(x: number, z: number, radius: number, visit: (d: number, tag: number) => void): void {
    const seen = new Set<number>();
    for (let cx = Math.floor((x - radius) / this.cell); cx <= Math.floor((x + radius) / this.cell); cx += 1) {
      for (let cz = Math.floor((z - radius) / this.cell); cz <= Math.floor((z + radius) / this.cell); cz += 1) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          const s = this.segs;
          const x0 = s[id * 5]!, z0 = s[id * 5 + 1]!, x1 = s[id * 5 + 2]!, z1 = s[id * 5 + 3]!;
          const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
          const d = Math.hypot(x - x0 - t * dx, z - z0 - t * dz);
          if (d <= radius) visit(d, s[id * 5 + 4]!);
        }
      }
    }
  }
}

// ---------- lamp placement (pure: no drawing, so it can be tested) ----------

export interface LampSpot {
  readonly x: number;
  readonly z: number;
  /** Direction from the post toward the road it lights (unit vector); the lamp's arm reaches that way. */
  readonly dx: number;
  readonly dz: number;
}

/** Where street lamps stand: just outside the road edge, alternating sides, never close to a building. */
export function placeLamps(map: Pick<MapData, 'bounds' | 'roads' | 'buildings'>, route: readonly { x: number; z: number }[] = []): LampSpot[] {
  const footprints: Footprint[] = [];
  const walls = new SegmentGrid();
  const owner: number[] = [];
  map.buildings.forEach((b) => {
    const f = footprintOf(b);
    if (f === undefined) return;
    const id = footprints.length;
    footprints.push(f);
    for (let i = 0; i < f.xs.length; i += 1) {
      const j = (i + 1) % f.xs.length;
      walls.add(f.xs[i]!, f.zs[i]!, f.xs[j]!, f.zs[j]!, id);
    }
    owner.push(id);
  });
  const roadGrid = new SegmentGrid();
  map.roads.forEach((r) => {
    for (let i = 0; i + 3 < r.pts.length; i += 2) roadGrid.add(r.pts[i]! / 10, r.pts[i + 1]! / 10, r.pts[i + 2]! / 10, r.pts[i + 3]! / 10, r.hw / 10);
  });
  const placed = new SegmentGrid(LAMP_MIN_APART); // lamps stored as zero-length segments
  const spots: LampSpot[] = [];
  const { minX, maxX, minZ, maxZ } = map.bounds;

  const free = (x: number, z: number): boolean => {
    if (x < minX / 10 + 4 || x > maxX / 10 - 4 || z < minZ / 10 + 4 || z > maxZ / 10 - 4) return false;
    let ok = true;
    walls.near(x, z, LAMP_BUILDING_GAP, () => {
      ok = false;
    });
    if (!ok) return false;
    // not inside a building either (a footprint can swallow a lamp spot without any wall being near)
    for (let k = 0; k < footprints.length && ok; k += 1) {
      const f = footprints[k]!;
      if (Math.abs(f.cx - x) < 40 && Math.abs(f.cz - z) < 40 && inside(f, x, z)) ok = false;
    }
    if (!ok) return false;
    // not on another road's carriageway
    roadGrid.near(x, z, 12, (d, hw) => {
      if (d < hw + 0.5) ok = false; // on a carriageway (its own road is LAMP_SETBACK past the edge, so it passes)
    });
    if (!ok) return false;
    placed.near(x, z, LAMP_MIN_APART, () => {
      ok = false;
    });
    return ok;
  };

  // Roads closest to the route come first, so the lamp cap is spent where the race is.
  const routeDistance = (r: MapData['roads'][number]): number => {
    if (route.length < 2) return 0;
    const mx = r.pts[Math.floor(r.pts.length / 4) * 2]! / 10, mz = r.pts[Math.floor(r.pts.length / 4) * 2 + 1]! / 10;
    let best = Infinity;
    for (let i = 0; i + 1 < route.length; i += 1) {
      const dx = route[i + 1]!.x - route[i]!.x, dz = route[i + 1]!.z - route[i]!.z, l2 = dx * dx + dz * dz;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - route[i]!.x) * dx + (mz - route[i]!.z) * dz) / l2));
      best = Math.min(best, Math.hypot(mx - route[i]!.x - t * dx, mz - route[i]!.z - t * dz));
    }
    return best;
  };
  const ordered = [...map.roads].sort((a, b) => routeDistance(a) - routeDistance(b) || a.pts[0]! - b.pts[0]! || a.pts[1]! - b.pts[1]!);
  let counter = 0;
  for (const r of ordered) {
    const hw = r.hw / 10;
    if (hw < 2.5) continue; // lanes and service roads get no lamps
    let carry = (h32(r.pts[0]! * 31 + r.pts[1]!) % 1000) / 1000 * LAMP_SPACING; // where along the road the first lamp falls
    let side = h32(r.pts[0]! + r.pts[1]! * 7) % 2 === 0 ? 1 : -1;
    for (let i = 0; i + 3 < r.pts.length && spots.length < MAX_LAMPS; i += 2) {
      const x0 = r.pts[i]! / 10, z0 = r.pts[i + 1]! / 10, x1 = r.pts[i + 2]! / 10, z1 = r.pts[i + 3]! / 10;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.5) continue;
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      while (carry < len) {
        const t = carry / len;
        const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
        counter += 1;
        for (const s of [side, -side]) {
          const lx = px + nx * s * (hw + LAMP_SETBACK), lz = pz + nz * s * (hw + LAMP_SETBACK);
          if (free(lx, lz)) {
            spots.push({ x: lx, z: lz, dx: -nx * s, dz: -nz * s });
            placed.add(lx, lz, lx, lz, 0);
            side = -s;
            break;
          }
        }
        carry += LAMP_SPACING * (0.85 + 0.3 * rand01(counter));
      }
      carry -= len;
    }
  }
  return spots;
}

