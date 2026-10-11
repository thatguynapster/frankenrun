// Bakes cached OSM data for a preset route into the compact map the game loads (dev-only, deterministic).
//   node scripts/run-ts.mjs bake/bake-map.ts route1
// Output: public/cdn-assets/accra/<id>.map.json.gz (shipped) and bake/out/<id>.map.json (digest source).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createDeterministicPhysicsWorld3D, stepDeterministicPhysicsWorld3D } from '@series-inc/rundot-syncplay/creator';
import { dist, project, type Pt } from './lib/geo.ts';
import type { BuildingData, MapData, RoadSeg, WallData } from '../src/sim/mapdata.ts';
import { ROUTES } from './routes.ts';

const id = process.argv[2] ?? 'route1';
const def = ROUTES[id];
if (!def) throw new Error(`unknown route ${id}`);
// Data source: the reproducible Geofabrik extract by default; SOURCE=overpass uses the Overpass cache instead.
const SOURCE = process.env['SOURCE'] ?? 'pbf';
const cache = (name: string): string => (name === 'corridor' || SOURCE === 'overpass' ? `bake/cache/${id}-${name}.json` : `bake/cache/${id}-pbf-${name}.json`);

interface Geom { lat: number; lon: number }
interface El { type: string; id: number; tags?: Record<string, string>; geometry?: Geom[]; lat?: number; lon?: number }
const load = (name: string): { osmDate: string; elements: El[] } => {
  const j = JSON.parse(readFileSync(cache(name), 'utf8')) as { osm3s?: { timestamp_osm_base?: string }; elements: El[] };
  return { osmDate: j.osm3s?.timestamp_osm_base ?? '?', elements: j.elements };
};
const corridor = JSON.parse(readFileSync(cache('corridor'), 'utf8')) as { polyline: Pt[]; length: number; bbox: Record<string, number> };

// ---- tunables (spec values) ----
const ROAD_HALF_WIDTH_M: Record<string, number> = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3.5, residential: 3, unclassified: 2, living_street: 2, service: 2, pedestrian: 2 };
const SIMPLIFY_ROAD_M = 1.5, SIMPLIFY_BUILDING_M = 1.0, MIN_BUILDING_AREA_M2 = 20;
const COLLIDE_NEAR_ROAD_M = Number(process.env['COLLIDE_NEAR'] ?? 25);
const MAX_HULL_VERTS = 8;
const dm = (m: number): number => Math.round(m * 10);

// ---- geometry helpers ----
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i += 1) { const d = segDist(pts[i]!, pts[a]!, pts[b]!); if (d > wd) { wd = d; worst = i; } }
    if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}
const area = (pts: Pt[]): number => { let s = 0; for (let i = 0; i < pts.length; i += 1) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; s += a.x * b.z - b.x * a.z; } return Math.abs(s) / 2; };
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i -= 1) { const q = p[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** Reduce a convex polygon to <= n vertices by repeatedly removing the vertex whose removal loses the least area. */
function reduceHull(h: Pt[], n: number): Pt[] {
  const out = [...h];
  while (out.length > n) {
    let best = 0, bestLoss = Infinity;
    for (let i = 0; i < out.length; i += 1) {
      const a = out[(i + out.length - 1) % out.length]!, b = out[i]!, c = out[(i + 1) % out.length]!;
      const loss = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
      if (loss < bestLoss) { bestLoss = loss; best = i; }
    }
    out.splice(best, 1);
  }
  return out;
}
/** Smallest-area oriented rectangle around a polygon (rotating over the polygon's edge directions). */
function boundingRect(pts: Pt[]): Pt[] {
  let best: Pt[] = [], bestArea = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const len = dist(a, b) || 1, ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) { const u = (p.x - a.x) * ux + (p.z - a.z) * uz, v = -(p.x - a.x) * uz + (p.z - a.z) * ux; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const ar = (maxU - minU) * (maxV - minV);
    if (ar < bestArea) {
      bestArea = ar;
      const pt = (u: number, v: number): Pt => ({ x: a.x + u * ux - v * uz, z: a.z + u * uz + v * ux });
      best = [pt(minU, minV), pt(maxU, minV), pt(maxU, maxV), pt(minU, maxV)];
    }
  }
  return best;
}

/** True when the physics engine accepts this convex footprint extruded to heightM as a static hull. */
function engineAccepts(footprint: Pt[], heightM: number): boolean {
  // Same representation as src/sim/world.ts: vertices relative to the footprint centre, placed by the child offset.
  const cx = Math.round((footprint.reduce((t, p) => t + dm(p.x), 0) / footprint.length)), cz = Math.round((footprint.reduce((t, p) => t + dm(p.z), 0) / footprint.length));
  const vertices: { x: number; y: number; z: number }[] = [];
  for (const p of footprint) { const x = (dm(p.x) - cx) / 10, z = (dm(p.z) - cz) / 10; vertices.push({ x, y: 0, z }, { x, y: heightM, z }); }
  try {
    const w = createDeterministicPhysicsWorld3D([
      { id: 's', kind: 'static', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, shape: { type: 'compound', children: [{ shape: { type: 'hull', vertices }, offset: { x: cx / 10, y: 0, z: cz / 10 } }] }, layer: 1, mask: 1 },
      { id: 'd', kind: 'dynamic', x: 0, y: 500, z: 0, vx: 0, vy: 0, vz: 0, mass: 1, orientation: { x: 0, y: 0, z: 0, w: 1 }, shape: { type: 'sphere', radius: 0.5 }, layer: 2, mask: 1 },
    ]);
    stepDeterministicPhysicsWorld3D(w, { gravityY: 0, dtTicks: 1 });
    return true;
  } catch {
    return false;
  }
}

/** The best collider the engine accepts for a footprint: full hull, then a 4-vertex hull, then a rectangle. */
function colliderFor(pts: Pt[], heightM: number): Pt[] | undefined {
  const full = reduceHull(hull(pts), MAX_HULL_VERTS);
  const options = [full, reduceHull(full, 4), boundingRect(full)];
  for (const o of options) if (o.length >= 3 && area(o) >= MIN_BUILDING_AREA_M2 * 0.5 && engineAccepts(o, heightM)) return o;
  return undefined;
}

const flat = (pts: Pt[]): number[] => pts.flatMap((p) => [dm(p.x), dm(p.z)]);
const toPts = (g: Geom[]): Pt[] => g.map((q) => project(q.lat, q.lon));

// ---- roads ----
const roadsIn = load('roads');
const roads: RoadSeg[] = [];
const roadLines: Pt[][] = [];
const roadHalfWidths: number[] = [];
for (const el of roadsIn.elements) {
  if (el.type !== 'way' || !el.geometry || !el.tags?.['highway']) continue;
  const hw = ROAD_HALF_WIDTH_M[el.tags['highway'].replace('_link', '')];
  if (hw === undefined) continue; // footway/path/steps/cycleway/track are not road surface
  const line = simplify(toPts(el.geometry), SIMPLIFY_ROAD_M);
  if (line.length < 2) continue;
  roadLines.push(line);
  roadHalfWidths.push(hw);
  roads.push({ hw: dm(hw), pts: flat(line) });
}
roads.sort((a, b) => a.pts[0]! - b.pts[0]! || a.pts[1]! - b.pts[1]! || a.pts.length - b.pts.length); // deterministic order

// Spatial grid over road segments for the "near a road" test.
const GRID = 40;
const grid = new Map<string, [Pt, Pt, number][]>();
const cellKey = (x: number, z: number): string => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
roadLines.forEach((line, li) => { for (let i = 0; i + 1 < line.length; i += 1) {
  const a = line[i]!, b = line[i + 1]!;
  const x0 = Math.floor(Math.min(a.x, b.x) / GRID), x1 = Math.floor(Math.max(a.x, b.x) / GRID), z0 = Math.floor(Math.min(a.z, b.z) / GRID), z1 = Math.floor(Math.max(a.z, b.z) / GRID);
  for (let gx = x0; gx <= x1; gx += 1) for (let gz = z0; gz <= z1; gz += 1) {
    const k = `${gx},${gz}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push([a, b, roadHalfWidths[li]!]);
  }
} });
function distToRoad(p: Pt, within: number): number {
  let best = Infinity;
  const r = Math.ceil(within / GRID);
  const cx = Math.floor(p.x / GRID), cz = Math.floor(p.z / GRID);
  for (let gx = cx - r; gx <= cx + r; gx += 1) for (let gz = cz - r; gz <= cz + r; gz += 1)
    for (const [a, b] of grid.get(`${gx},${gz}`) ?? []) { const d = segDist(p, a, b); if (d < best) best = d; }
  return best;
}

// ---- clearance: a collider must never block a road ----
function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const ccw = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
/** How much a polygon intrudes into a road lane: negative means a road runs through or past it with room to spare. */
function roadIntrusion(poly: Pt[], margin: number): number {
  let worst = Infinity; // smallest (distance - (half-width + margin)) over nearby road segments
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const reach = 12;
  const gx0 = Math.floor((Math.min(...xs) - reach) / GRID), gx1 = Math.floor((Math.max(...xs) + reach) / GRID);
  const gz0 = Math.floor((Math.min(...zs) - reach) / GRID), gz1 = Math.floor((Math.max(...zs) + reach) / GRID);
  for (let gx = gx0; gx <= gx1; gx += 1) {
    for (let gz = gz0; gz <= gz1; gz += 1) {
      for (const [a, b, hw] of grid.get(`${gx},${gz}`) ?? []) {
        let d: number;
        if (pointInPoly(a, poly) || pointInPoly(b, poly)) d = 0;
        else {
          d = Infinity;
          for (let i = 0; i < poly.length; i += 1) d = Math.min(d, segSegDist(a, b, poly[i]!, poly[(i + 1) % poly.length]!));
        }
        worst = Math.min(worst, d - (hw + margin));
      }
    }
  }
  return worst;
}
const ROAD_CLEARANCE_M = Number(process.env['CLEARANCE'] ?? 1.2); // free margin kept beside each road's half-width
let carved = 0;

// ---- buildings ----
const bIn = load('buildings');
const buildings: BuildingData[] = [];
let collidable = 0, dropped = 0, rejected = 0;
for (const el of bIn.elements) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) { dropped += 1; continue; }
  let pts = toPts(el.geometry);
  if (dist(pts[0]!, pts[pts.length - 1]!) < 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) { dropped += 1; continue; }
  if (area(pts) < MIN_BUILDING_AREA_M2) { dropped += 1; continue; }
  pts = simplify(pts, SIMPLIFY_BUILDING_M);
  if (pts.length < 3) { dropped += 1; continue; }
  const levels = Number(el.tags?.['building:levels']);
  const height = Number(el.tags?.['height']);
  const hM = Number.isFinite(height) && height > 0 ? height : Number.isFinite(levels) && levels > 0 ? levels * 3 : 6;
  const centroid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  const near = distToRoad(centroid, COLLIDE_NEAR_ROAD_M + 15) <= COLLIDE_NEAR_ROAD_M + 15 && pts.some((p) => distToRoad(p, COLLIDE_NEAR_ROAD_M) <= COLLIDE_NEAR_ROAD_M);
  let hullFlat: number[] | undefined;
  if (near) {
    const h = colliderFor(pts, hM);
    if (h && roadIntrusion(h, ROAD_CLEARANCE_M) < 0) carved += 1; // a road runs through/along it: render only
    else if (h) { hullFlat = flat(h); collidable += 1; } else rejected += 1;
  }
  buildings.push(hullFlat ? { h: dm(hM), pts: flat(pts), hull: hullFlat } : { h: dm(hM), pts: flat(pts) });
}
buildings.sort((a, b) => a.pts[0]! - b.pts[0]! || a.pts[1]! - b.pts[1]!);

// ---- walls and anchors ----
const dIn = load('details');
const walls: WallData[] = [];
const lamps: Pt[] = [];
for (const el of dIn.elements) {
  if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) lamps.push(project(el.lat, el.lon));
  else if (el.type === 'way' && el.geometry && /^(wall|retaining_wall|city_wall)$/.test(el.tags?.['barrier'] ?? '')) {
    const line = simplify(toPts(el.geometry), 1.5);
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i]!, b = line[i + 1]!;
      if (dist(a, b) >= 4 && distToRoad({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, 15) <= 15) walls.push({ pts: [dm(a.x), dm(a.z), dm(b.x), dm(b.z)], h: 25 });
    }
  }
}
walls.sort((a, b) => a.pts[0] - b.pts[0] || a.pts[1] - b.pts[1]);

// Junctions: points where >= 3 road segment ends meet; anchors sit at nearby building corners (and lamps).
const deg = new Map<string, { p: Pt; n: number }>();
for (const line of roadLines) for (const [i, p] of [[0, line[0]!], [1, line[line.length - 1]!]] as [number, Pt][]) {
  void i; const k = `${Math.round(p.x)},${Math.round(p.z)}`; const e = deg.get(k); if (e) e.n += 1; else deg.set(k, { p, n: 1 });
}
const junctions = [...deg.values()].filter((e) => e.n >= 3).map((e) => e.p).sort((a, b) => a.x - b.x || a.z - b.z);
const cornerPool: Pt[] = [];
for (const b of buildings) if (b.hull) for (let i = 0; i < b.hull.length; i += 2) cornerPool.push({ x: b.hull[i]! / 10, z: b.hull[i + 1]! / 10 });
const anchors: Pt[] = [];
const spaced = (p: Pt): boolean => anchors.every((a) => dist(a, p) >= 20);
for (const l of lamps) if (distToRoad(l, 12) <= 12 && spaced(l)) anchors.push(l);
for (const j of junctions) {
  const nearby = cornerPool.filter((c) => dist(c, j) <= 14).sort((a, b) => dist(a, j) - dist(b, j));
  let taken = 0;
  for (const c of nearby) if (taken < 2 && spaced(c)) { anchors.push(c); taken += 1; }
}

// ---- checkpoints: every ~400 m, at each turn > 60 degrees, plus start and finish; cap 12 ----
const poly = corridor.polyline;
const cum: number[] = [0];
for (let i = 1; i < poly.length; i += 1) cum.push(cum[i - 1]! + dist(poly[i - 1]!, poly[i]!));
const total = cum[cum.length - 1]!;
const at = (s: number): Pt => {
  let i = 1; while (i < poly.length - 1 && cum[i]! < s) i += 1;
  const a = poly[i - 1]!, b = poly[i]!, t = (s - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
};
const turnAngle = (s: number): number => {
  const a = at(Math.max(0, s - 30)), b = at(s), c = at(Math.min(total, s + 30));
  const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
  let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};
const turns: { s: number; a: number }[] = [];
for (let s = 40; s < total - 40; s += 10) {
  const a = turnAngle(s);
  if (a > (60 * Math.PI) / 180) {
    const last = turns[turns.length - 1];
    if (last && s - last.s < 50) { if (a > last.a) { last.s = s; last.a = a; } } else turns.push({ s, a });
  }
}
let marks = [...turns.map((t) => t.s)];
// Fill gaps larger than 450 m.
marks.sort((a, b) => a - b);
const withEnds = [0, ...marks, total];
const filled: number[] = [];
for (let i = 0; i + 1 < withEnds.length; i += 1) {
  const a = withEnds[i]!, b = withEnds[i + 1]!;
  if (a > 0) filled.push(a);
  const n = Math.floor((b - a) / 450);
  for (let k = 1; k <= n; k += 1) filled.push(a + ((b - a) * k) / (n + 1));
}
marks = filled.sort((a, b) => a - b);
// Enforce a minimum spacing and the cap (keep the sharpest turns when over the cap).
const MIN_GAP = 120, MAX_CP = 12;
while (marks.length + 1 > MAX_CP || marks.some((m, i) => (i === 0 ? m : m - marks[i - 1]!) < MIN_GAP || total - m < MIN_GAP)) {
  let worst = -1, ws = Infinity;
  marks.forEach((m, i) => {
    const gapPrev = i === 0 ? m : m - marks[i - 1]!;
    const gapNext = i === marks.length - 1 ? total - m : marks[i + 1]! - m;
    const score = Math.min(gapPrev, gapNext) + turnAngle(m) * 100;
    if (score < ws) { ws = score; worst = i; }
  });
  if (worst < 0) break;
  marks.splice(worst, 1);
}
const checkpoints = [...marks.map(at), poly[poly.length - 1]!].map((p) => ({ x: dm(p.x), z: dm(p.z) }));

// ---- start pose ----
const p0 = poly[0]!, p1 = at(Math.min(total, 25));
const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);

const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
const PAD = 250;
const map: MapData = {
  id,
  version: 1,
  name: def.name,
  osmDate: bIn.osmDate,
  bounds: { minX: dm(Math.min(...xs) - PAD), maxX: dm(Math.max(...xs) + PAD), minZ: dm(Math.min(...zs) - PAD), maxZ: dm(Math.max(...zs) + PAD) },
  start: { x: dm(p0.x), z: dm(p0.z), yaw: Math.round(yaw * 1e6) },
  checkpoints,
  roads,
  buildings,
  walls,
  anchors: anchors.map((a) => ({ x: dm(a.x), z: dm(a.z) })),
  lengthM: Math.round(corridor.length),
};

const json = Buffer.from(JSON.stringify(map), 'utf8');
const gz = gzipSync(json, { level: 9 });
mkdirSync('bake/out', { recursive: true });
mkdirSync('public/cdn-assets/accra', { recursive: true });
writeFileSync(`bake/out/${id}.map.json`, json);
writeFileSync(`public/cdn-assets/accra/${id}.map.json.gz`, gz);
console.log(`${id}: ${(json.length / 1024).toFixed(0)} KB json, ${(gz.length / 1024).toFixed(0)} KB gzip`);
console.log(`  roads ${roads.length}, buildings ${buildings.length} (collidable ${collidable}, carved for road clearance ${carved}, dropped ${dropped}, no valid collider ${rejected}), walls ${walls.length}, anchors ${anchors.length}, lamps ${lamps.length}, junctions ${junctions.length}`);
console.log(`  checkpoints ${checkpoints.length}, route ${Math.round(total)} m, OSM base ${bIn.osmDate}`);
const BUDGET = 4 * 1024 * 1024;
if (gz.length > BUDGET) { console.error(`BUDGET EXCEEDED: ${gz.length} > ${BUDGET}`); process.exit(1); }
