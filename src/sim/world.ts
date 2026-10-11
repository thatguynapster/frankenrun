// Turns a MapData (baked from OSM, or the built-in greybox arena) into the static physics world,
// checkpoints, tentacle anchors, start grid and the on-road lookup. Pure and deterministic: every
// number is derived from the map's integer decimetre values, with no randomness or wall-clock input.

import type { DeterministicPhysicsBody3D } from '@series-inc/rundot-syncplay/creator';
import type { MapData } from './mapdata.js';
import { ARENA_HALF, CHECKPOINTS, OBSTACLES, POLES, START_DX, START_X0, START_Z } from './track.js';

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface PreparedMap {
  readonly id: string;
  readonly map: MapData;
  readonly checkpoints: readonly Vec2[];
  readonly anchors: readonly Vec2[];
  readonly staticBodies: readonly DeterministicPhysicsBody3D[];
  /** World-space spawn for a grid slot (metres) and the shared heading (radians). */
  startPose(slot: number): Vec2;
  readonly startYaw: number;
  /** True when (x, z) is on a road surface. Maps with no roads (the greybox arena) are all road. */
  onRoad(x: number, z: number): boolean;
  /** Collision cell containing (x, z). Building colliders stream in and out of the physics world by cell. */
  cellOf(x: number, z: number): number;
  /** The static body holding one cell's building colliders (id `bld-<cell>`), or undefined when the cell has none. */
  cellBody(cell: number): DeterministicPhysicsBody3D | undefined;
}

/** Edge length of a collision cell in metres. A car keeps its own cell and the 8 around it loaded. */
export const CELL_M = 50;

const GROUND_LAYER = 1;
const ALL = 0xffffffff;
const STILL = { vx: 0, vy: 0, vz: 0 } as const;
const WALL_HEIGHT = 6;
const ANCHOR_HEIGHT = 3;

const m = (decimetres: number): number => decimetres / 10;

/** The built-in M1 arena, expressed as a MapData so the whole sim has a single code path. */
export function greyboxMap(): MapData {
  const dm = (metres: number): number => Math.round(metres * 10);
  return {
    id: 'greybox',
    version: 1,
    name: 'Greybox arena',
    osmDate: 'none',
    bounds: { minX: dm(-ARENA_HALF), maxX: dm(ARENA_HALF), minZ: dm(-ARENA_HALF), maxZ: dm(ARENA_HALF) },
    start: { x: dm(START_X0 + START_DX / 2), z: dm(START_Z), yaw: 0 },
    checkpoints: CHECKPOINTS.map((c) => ({ x: dm(c.x), z: dm(c.z) })),
    roads: [],
    buildings: OBSTACLES.map((o) => {
      const hull = [o.x - o.halfX, o.z - o.halfZ, o.x + o.halfX, o.z - o.halfZ, o.x + o.halfX, o.z + o.halfZ, o.x - o.halfX, o.z + o.halfZ].map(dm);
      return { h: dm(o.height), pts: hull, hull };
    }),
    walls: [],
    anchors: POLES.map((p) => ({ x: dm(p.x), z: dm(p.z) })),
    lengthM: 0,
  };
}

/**
 * A convex extruded footprint as a compound child. Vertices are stored relative to the footprint's own
 * centre and the child's offset places it in the world: the engine computes mass properties about the
 * origin, and doing that for a small hull ~2 km away loses enough precision to produce a degenerate hull.
 */
function hullChild(footprint: readonly number[], heightM: number): { shape: { type: 'hull'; vertices: { x: number; y: number; z: number }[] }; offset: { x: number; y: number; z: number } } {
  let cx = 0, cz = 0;
  const n = footprint.length / 2;
  for (let i = 0; i < footprint.length; i += 2) {
    cx += footprint[i]!;
    cz += footprint[i + 1]!;
  }
  cx = Math.round(cx / n);
  cz = Math.round(cz / n);
  const vertices: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < footprint.length; i += 2) {
    const x = m(footprint[i]! - cx), z = m(footprint[i + 1]! - cz);
    vertices.push({ x, y: 0, z }, { x, y: heightM, z });
  }
  return { shape: { type: 'hull', vertices }, offset: { x: m(cx), y: 0, z: m(cz) } };
}

function compound(id: string, children: ReturnType<typeof hullChild>[], friction: number): DeterministicPhysicsBody3D {
  return {
    id,
    kind: 'static',
    x: 0,
    y: 0,
    z: 0,
    ...STILL,
    shape: { type: 'compound', children },
    layer: GROUND_LAYER,
    mask: ALL,
    material: { friction, restitution: 0.25 },
  };
}

function buildStaticBodies(map: MapData): DeterministicPhysicsBody3D[] {
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const cx = m(minX + maxX) / 2, cz = m(minZ + maxZ) / 2;
  const hx = m(maxX - minX) / 2, hz = m(maxZ - minZ) / 2;
  const box = (id: string, x: number, z: number, halfX: number, halfZ: number): DeterministicPhysicsBody3D => ({
    id,
    kind: 'static',
    x,
    y: WALL_HEIGHT / 2,
    z,
    ...STILL,
    shape: { type: 'box', halfX, halfY: WALL_HEIGHT / 2, halfZ },
    layer: GROUND_LAYER,
    mask: ALL,
    material: { friction: 0.4, restitution: 0.2 },
  });
  const bodies: DeterministicPhysicsBody3D[] = [
    {
      id: 'ground',
      kind: 'static',
      x: cx,
      y: -0.5,
      z: cz,
      ...STILL,
      shape: { type: 'box', halfX: hx + 20, halfY: 0.5, halfZ: hz + 20 },
      layer: GROUND_LAYER,
      mask: ALL,
      material: { friction: 24, restitution: 0 },
    },
    // Boundary walls keep players inside the baked area.
    box('wall-n', cx, cz + hz + 1, hx + 2, 1),
    box('wall-s', cx, cz - hz - 1, hx + 2, 1),
    box('wall-e', cx + hx + 1, cz, 1, hz),
    box('wall-w', cx - hx - 1, cz, 1, hz),
  ];

  // Building colliders are NOT part of the always-on world: see buildCellIndex / buildingsBody.
  const wallChildren = map.walls.map((w) => {
    const [x0, z0, x1, z1] = w.pts;
    const dx = m(x1 - x0), dz = m(z1 - z0), len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * 0.15, nz = (dx / len) * 0.15; // half-thickness 0.15 m
    return hullChild([x0 + nx * 10, z0 + nz * 10, x1 + nx * 10, z1 + nz * 10, x1 - nx * 10, z1 - nz * 10, x0 - nx * 10, z0 - nz * 10].map(Math.round), m(w.h));
  });
  if (wallChildren.length > 0) bodies.push(compound('walls', wallChildren, 0.4));

  // Anchors are thin posts; a single compound keeps the per-tick static cost low and the rope joint
  // targets it with a local offset (the compound sits at the world origin, so local = world).
  const anchorChildren = map.anchors.map((a) => {
    const r = 2; // 0.2 m half-width
    return hullChild([a.x - r, a.z - r, a.x + r, a.z - r, a.x + r, a.z + r, a.x - r, a.z + r], ANCHOR_HEIGHT);
  });
  if (anchorChildren.length > 0) bodies.push(compound('anchors', anchorChildren, 0.4));
  return bodies;
}

function buildRoadIndex(map: MapData): (x: number, z: number) => boolean {
  if (map.roads.length === 0) return () => true;
  const CELL = 40; // metres
  const grid = new Map<number, { x0: number; z0: number; x1: number; z1: number; hw2: number }[]>();
  const key = (gx: number, gz: number): number => gx * 100003 + gz;
  for (const road of map.roads) {
    const hw = m(road.hw) + 1; // 1 m of tolerance for imprecise OSM centrelines
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const seg = { x0: m(road.pts[i]!), z0: m(road.pts[i + 1]!), x1: m(road.pts[i + 2]!), z1: m(road.pts[i + 3]!), hw2: hw * hw };
      const gx0 = Math.floor((Math.min(seg.x0, seg.x1) - hw) / CELL), gx1 = Math.floor((Math.max(seg.x0, seg.x1) + hw) / CELL);
      const gz0 = Math.floor((Math.min(seg.z0, seg.z1) - hw) / CELL), gz1 = Math.floor((Math.max(seg.z0, seg.z1) + hw) / CELL);
      for (let gx = gx0; gx <= gx1; gx += 1) {
        for (let gz = gz0; gz <= gz1; gz += 1) {
          const k = key(gx, gz);
          const list = grid.get(k);
          if (list) list.push(seg);
          else grid.set(k, [seg]);
        }
      }
    }
  }
  return (x, z) => {
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const s of list) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0, l2 = dx * dx + dz * dz;
      let t = l2 === 0 ? 0 : ((x - s.x0) * dx + (z - s.z0) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x - (s.x0 + t * dx), pz = z - (s.z0 + t * dz);
      if (px * px + pz * pz <= s.hw2) return true; // squared distance: no sqrt in the sim
    }
    return false;
  };
}

const cellKey = (cx: number, cz: number): number => (cx + 2048) * 4096 + (cz + 2048);
const cellOf = (x: number, z: number): number => cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M));

/** Groups every collidable building by the cell of its first footprint vertex (a stable, deterministic rule). */
function buildCellIndex(map: MapData): Map<number, number[]> {
  const index = new Map<number, number[]>();
  map.buildings.forEach((b, i) => {
    if (!b.hull) return;
    const key = cellOf(m(b.hull[0]!), m(b.hull[1]!));
    const list = index.get(key);
    if (list) list.push(i);
    else index.set(key, [i]);
  });
  return index;
}

const prepared = new WeakMap<MapData, PreparedMap>();

export function prepareMap(map: MapData): PreparedMap {
  const cached = prepared.get(map);
  if (cached) return cached;
  const cellIndex = buildCellIndex(map);
  const yaw = map.start.yaw / 1e6;
  const sx = m(map.start.x), sz = m(map.start.z);
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  const result: PreparedMap = {
    id: map.id,
    map,
    checkpoints: map.checkpoints.map((c) => ({ x: m(c.x), z: m(c.z) })),
    anchors: map.anchors.map((a) => ({ x: m(a.x), z: m(a.z) })),
    staticBodies: buildStaticBodies(map),
    startYaw: yaw,
    startPose(slot: number): Vec2 {
      // Two columns, rows spaced back along the heading.
      const row = Math.floor(slot / 2), side = slot % 2 === 0 ? -1.4 : 1.4;
      const back = row * 5;
      return { x: sx - fwdX * back + fwdZ * side, z: sz - fwdZ * back - fwdX * side };
    },
    onRoad: buildRoadIndex(map),
    cellOf,
    cellBody(cell: number): DeterministicPhysicsBody3D | undefined {
      const list = cellIndex.get(cell);
      if (!list || list.length === 0) return undefined;
      return compound(`bld-${cell}`, list.map((i) => hullChild(map.buildings[i]!.hull!, m(map.buildings[i]!.h))), 0.4);
    },
  };
  prepared.set(map, result);
  return result;
}

// Registry of maps available to the runtime. The greybox arena is built in; baked maps are registered
// (after their digest is verified against the runtime identity) before a session starts.
const registry = new Map<string, PreparedMap>();
registry.set('greybox', prepareMap(greyboxMap()));

export function registerMap(map: MapData): void {
  registry.set(map.id, prepareMap(map));
}

export function getPreparedMap(id: string): PreparedMap {
  const found = registry.get(id);
  if (!found) throw new Error(`FRANKENRUN_MAP_NOT_LOADED ${id}`);
  return found;
}
