// Street scenery (dev-only, run by the bake): trees, dead trees, gravestones, pumpkins and parked cars. Trees and props are
// scenery only; parked cars are made solid by the bake (they become collider "buildings"). Everything keeps clear of
// buildings, lamps and the carriageway, and the spots nearest the route are chosen first.
import type { MapData } from '../src/sim/mapdata.ts';
import { SegmentGrid, footprintOf, h32, inside, rand01, type Footprint, type LampSpot } from './lamps.ts';

export type DecorKind = 0 | 1 | 2 | 3; // tree, dead tree, gravestones, pumpkin

export interface DecorSpot {
  readonly x: number;
  readonly z: number;
  readonly kind: DecorKind;
  readonly seed: number;
}

export interface CarSpot {
  readonly x: number;
  readonly z: number;
  /** Direction along the road (unit vector): the car's length runs this way. */
  readonly ux: number;
  readonly uz: number;
  readonly color: number;
}

const MAX_DECOR = 260;
const MAX_CARS = 36;
const DECOR_SPACING = 17;
const DECOR_SETBACK = 3.4; // beyond the carriageway edge
const DECOR_BUILDING_GAP = 3;
const CAR_LENGTH = 4.3, CAR_WIDTH = 1.9;
const CAR_CENTRE_SETBACK = 1.2 + CAR_WIDTH / 2 + 0.25; // clear of the 1.2 m margin kept free beside every road

type Shape = Pick<MapData, 'bounds' | 'roads' | 'buildings'>;

export function placeDecor(map: Shape, lamps: readonly LampSpot[], route: readonly { x: number; z: number }[]): { decor: DecorSpot[]; cars: CarSpot[] } {
  const footprints: Footprint[] = [];
  const walls = new SegmentGrid();
  for (const b of map.buildings) {
    const f = footprintOf(b);
    if (f === undefined) continue;
    footprints.push(f);
    for (let i = 0; i < f.xs.length; i += 1) {
      const j = (i + 1) % f.xs.length;
      walls.add(f.xs[i]!, f.zs[i]!, f.xs[j]!, f.zs[j]!, footprints.length - 1);
    }
  }
  const roads = new SegmentGrid();
  for (const r of map.roads) for (let i = 0; i + 3 < r.pts.length; i += 2) roads.add(r.pts[i]! / 10, r.pts[i + 1]! / 10, r.pts[i + 2]! / 10, r.pts[i + 3]! / 10, r.hw / 10);
  const taken = new SegmentGrid(8); // lamps, decor and cars already placed, as points
  for (const l of lamps) taken.add(l.x, l.z, l.x, l.z, 1);
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const inBounds = (x: number, z: number): boolean => x > minX / 10 + 6 && x < maxX / 10 - 6 && z > minZ / 10 + 6 && z < maxZ / 10 - 6;
  const distToRoute = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i + 1 < route.length; i += 1) {
      const dx = route[i + 1]!.x - route[i]!.x, dz = route[i + 1]!.z - route[i]!.z, l2 = dx * dx + dz * dz;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - route[i]!.x) * dx + (z - route[i]!.z) * dz) / l2));
      best = Math.min(best, Math.hypot(x - route[i]!.x - t * dx, z - route[i]!.z - t * dz));
    }
    return best;
  };
  const clearOfBuildings = (x: number, z: number, gap: number): boolean => {
    let ok = true;
    walls.near(x, z, gap, () => { ok = false; });
    if (!ok) return false;
    for (const f of footprints) if (Math.abs(f.cx - x) < 40 && Math.abs(f.cz - z) < 40 && inside(f, x, z)) return false;
    return true;
  };
  const clearOfRoads = (x: number, z: number, extra: number): boolean => {
    let ok = true;
    roads.near(x, z, 14, (d, hw) => { if (d < hw + extra) ok = false; });
    return ok;
  };
  const apart = (x: number, z: number, gap: number): boolean => {
    let ok = true;
    taken.near(x, z, gap, () => { ok = false; });
    return ok;
  };

  const roadOrder = [...map.roads].sort((a, b) => {
    const mid = (r: MapData['roads'][number]): number => distToRoute(r.pts[Math.floor(r.pts.length / 4) * 2]! / 10, r.pts[Math.floor(r.pts.length / 4) * 2 + 1]! / 10);
    return mid(a) - mid(b) || a.pts[0]! - b.pts[0]! || a.pts[1]! - b.pts[1]!;
  });
  const decor: DecorSpot[] = [];
  const cars: CarSpot[] = [];
  let counter = 0;
  for (const r of roadOrder) {
    const hw = r.hw / 10;
    if (hw < 2.5) continue;
    let carry = (h32(r.pts[0]! * 17 + r.pts[1]! * 3) % 1000) / 1000 * DECOR_SPACING;
    let carCarry = (h32(r.pts[0]! * 5 + r.pts[1]! * 11) % 1000) / 1000 * 60;
    for (let i = 0; i + 3 < r.pts.length && (decor.length < MAX_DECOR || cars.length < MAX_CARS); i += 2) {
      const x0 = r.pts[i]! / 10, z0 = r.pts[i + 1]! / 10, x1 = r.pts[i + 2]! / 10, z1 = r.pts[i + 3]! / 10;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.5) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len, nx = -uz, nz = ux;
      // scenery
      while (carry < len && decor.length < MAX_DECOR) {
        const t = carry / len;
        const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
        counter += 1;
        const side = h32(counter * 7 + 3) % 2 === 0 ? 1 : -1;
        const off = hw + DECOR_SETBACK + rand01(counter + 11) * 2.5;
        const x = px + nx * side * off, z = pz + nz * side * off;
        if (inBounds(x, z) && clearOfBuildings(x, z, DECOR_BUILDING_GAP) && clearOfRoads(x, z, 1.5) && apart(x, z, 5)) {
          const roll = rand01(counter + 29);
          const kind: DecorKind = roll < 0.42 ? 0 : roll < 0.68 ? 1 : roll < 0.84 ? 2 : 3;
          decor.push({ x, z, kind, seed: h32(counter * 13 + 5) % 251 });
          taken.add(x, z, x, z, 2);
        }
        carry += DECOR_SPACING * (0.7 + 0.6 * rand01(counter + 47));
      }
      carry -= len;
      // parked cars, a little way off the carriageway so they never sit in a lane
      if (hw >= 3) {
        while (carCarry < len && cars.length < MAX_CARS) {
          const t = carCarry / len;
          const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
          counter += 1;
          const side = h32(counter * 5 + 1) % 2 === 0 ? 1 : -1;
          const x = px + nx * side * (hw + CAR_CENTRE_SETBACK), z = pz + nz * side * (hw + CAR_CENTRE_SETBACK);
          if (
            inBounds(x, z) && clearOfBuildings(x, z, CAR_LENGTH / 2 + 1.2) && clearOfRoads(x, z, CAR_WIDTH / 2 + 0.9) && apart(x, z, 4.5) &&
            distToRoute(x, z) > 3.5 && distToRoute(route[0]?.x ?? 0, route[0]?.z ?? 0) >= 0 && Math.hypot(x - (route[0]?.x ?? 0), z - (route[0]?.z ?? 0)) > 30
          ) {
            cars.push({ x, z, ux, uz, color: h32(counter * 3 + 9) % 6 });
            taken.add(x, z, x, z, 3);
          }
          carCarry += 55 * (0.8 + 0.5 * rand01(counter + 61));
        }
        carCarry -= len;
      }
    }
  }
  return { decor, cars };
}

/** The four corners of a parked car (metres), long side along the road: counter-clockwise from the rear left. */
export function carCorners(c: CarSpot): { x: number; z: number }[] {
  const hl = CAR_LENGTH / 2, hw = CAR_WIDTH / 2, nx = -c.uz, nz = c.ux;
  const at = (u: number, v: number): { x: number; z: number } => ({ x: c.x + c.ux * u + nx * v, z: c.z + c.uz * u + nz * v });
  return [at(-hl, -hw), at(hl, -hw), at(hl, hw), at(-hl, hw)];
}
