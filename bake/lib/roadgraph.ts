// Road graph, A* routing and route scoring shared by the bake tools (dev-only).
import { readFileSync } from 'node:fs';
import { dist, project, type Pt } from './geo.ts';

interface OsmNode { type: 'node'; id: number; lat: number; lon: number }
interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
type Elem = OsmNode | OsmWay | { type: string };

// Spec: skip footway|path|steps|service unless tagged drivable. pedestrian is off-road-legal, not routed.
const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

export interface Graph {
  pts: Map<number, Pt>;
  adj: Map<number, { to: number; len: number; cls: string }[]>;
}

export function loadGraph(file: string): Graph {
  const json = JSON.parse(readFileSync(file, 'utf8')) as { elements: Elem[] };
  const pts = new Map<number, Pt>();
  for (const e of json.elements) if (e.type === 'node') pts.set((e as OsmNode).id, project((e as OsmNode).lat, (e as OsmNode).lon));
  const adj = new Map<number, { to: number; len: number; cls: string }[]>();
  const add = (a: number, b: number, len: number, cls: string): void => {
    let list = adj.get(a);
    if (!list) adj.set(a, (list = []));
    list.push({ to: b, len, cls });
  };
  for (const e of json.elements) {
    if (e.type !== 'way') continue;
    const w = e as OsmWay;
    const cls = w.tags?.['highway'];
    if (!cls || !DRIVABLE.has(cls)) continue;
    const oneway = w.tags?.['oneway'] === 'yes' || cls === 'motorway';
    for (let i = 0; i + 1 < w.nodes.length; i += 1) {
      const a = w.nodes[i]!, b = w.nodes[i + 1]!;
      const pa = pts.get(a), pb = pts.get(b);
      if (!pa || !pb) continue;
      const len = dist(pa, pb);
      add(a, b, len, cls);
      // Players may take any road in any direction (it is a game, not traffic law), so ignore oneway.
      if (oneway || true) add(b, a, len, cls);
    }
  }
  // Keep only the largest connected component so every snapped endpoint is mutually reachable.
  const seen = new Set<number>();
  let best: number[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const edge of adj.get(n) ?? []) if (!seen.has(edge.to)) { seen.add(edge.to); stack.push(edge.to); }
    }
    if (comp.length > best.length) best = comp;
  }
  const keep = new Set(best);
  for (const k of [...adj.keys()]) if (!keep.has(k)) adj.delete(k);
  return { pts, adj };
}

export function nearestNode(g: Graph, p: Pt): number {
  let bestId = -1, bestD = Infinity;
  for (const id of g.adj.keys()) {
    const d = dist(g.pts.get(id)!, p);
    if (d < bestD) { bestD = d; bestId = id; }
  }
  return bestId;
}

class MinHeap {
  private a: { k: number; v: number }[] = [];
  get size(): number { return this.a.length; }
  push(k: number, v: number): void {
    const a = this.a; a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p]!.k <= a[i]!.k) break; [a[p], a[i]] = [a[i]!, a[p]!]; i = p; }
  }
  pop(): { k: number; v: number } {
    const a = this.a, top = a[0]!, last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l]!.k < a[m]!.k) m = l;
        if (r < a.length && a[r]!.k < a[m]!.k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!]; i = m;
      }
    }
    return top;
  }
}

export function route(g: Graph, from: number, to: number): { nodes: number[]; length: number } | null {
  const goal = g.pts.get(to)!;
  const best = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new MinHeap();
  open.push(dist(g.pts.get(from)!, goal), from);
  while (open.size) {
    const { v: n } = open.pop();
    if (n === to) break;
    const base = best.get(n)!;
    for (const e of g.adj.get(n) ?? []) {
      const cost = base + e.len;
      if (cost < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, cost); prev.set(e.to, n);
        open.push(cost + dist(g.pts.get(e.to)!, goal), e.to);
      }
    }
  }
  if (!best.has(to)) return null;
  const nodes = [to];
  while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0]!)!);
  return { nodes, length: best.get(to)! };
}

export interface Score {
  length: number; straight: number; sinuosity: number;
  sharp60PerKm: number; turn30PerKm: number; longestStraight: number; sharp60: number;
  classMix: string;
}

function resample(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [points[0]!];
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    let a = points[i - 1]!; const b = points[i]!;
    let seg = dist(a, b);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      a = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      out.push(a); seg = dist(a, b); acc = 0;
    }
    acc += seg;
  }
  return out;
}

export function scoreRoute(g: Graph, nodes: number[], length: number): Score {
  const poly = nodes.map((n) => g.pts.get(n)!);
  const straight = dist(poly[0]!, poly[poly.length - 1]!);
  const pts = resample(poly, 15);
  const heading = (a: Pt, b: Pt): number => Math.atan2(b.x - a.x, b.z - a.z);
  const delta = (a: number, b: number): number => {
    let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d;
  };
  // Net heading change across a ~60 m window; a "sharp turn" is a >60 degree peak, a "bend" is >30 degrees.
  const WIN = 4;
  const net: number[] = [];
  for (let i = WIN; i + WIN < pts.length; i += 1) net.push(Math.abs(delta(heading(pts[i - WIN]!, pts[i]!), heading(pts[i]!, pts[i + WIN]!))));
  const peaks = (thresh: number): number => {
    let count = 0, i = 0;
    while (i < net.length) {
      if (net[i]! > thresh) { count += 1; while (i < net.length && net[i]! > thresh * 0.7) i += WIN; } else i += 1;
    }
    return count;
  };
  const sharp60 = peaks((60 * Math.PI) / 180), bends30 = peaks((30 * Math.PI) / 180);
  // Longest near-straight run.
  let longest = 0, run = 0;
  for (const d of net) { if (d < (12 * Math.PI) / 180) run += 15; else { longest = Math.max(longest, run); run = 0; } }
  longest = Math.max(longest, run);
  const mix = new Map<string, number>();
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const e = (g.adj.get(nodes[i]!) ?? []).find((x) => x.to === nodes[i + 1]!);
    if (e) mix.set(e.cls, (mix.get(e.cls) ?? 0) + e.len);
  }
  const classMix = [...mix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, m]) => `${c} ${Math.round((m / length) * 100)}%`).join(', ');
  const km = length / 1000;
  return { length, straight, sinuosity: length / straight, sharp60, sharp60PerKm: sharp60 / km, turn30PerKm: bends30 / km, longestStraight: longest, classMix };
}

export const fmt = (s: Score): string =>
  `${(s.length / 1000).toFixed(2)} km (straight ${(s.straight / 1000).toFixed(2)}, sinuosity ${s.sinuosity.toFixed(2)}) | sharp turns >60°: ${s.sharp60} (${s.sharp60PerKm.toFixed(1)}/km) | bends >30°: ${s.turn30PerKm.toFixed(1)}/km | longest straight ${Math.round(s.longestStraight)} m | ${s.classMix}`;
