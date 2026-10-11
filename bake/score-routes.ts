// Scores candidate preset routes on the real OSM road network (dev-only).
//   node scripts/run-ts.mjs bake/score-routes.ts
// Reports length (spec rule: 1.5-4.0 km), sinuosity, sharp turns and longest straight, and also
// searches each area for the windiest legal route.
import { dist, project, unproject } from './lib/geo.ts';
import { fmt, loadGraph, nearestNode, route, scoreRoute } from './lib/roadgraph.ts';

const legal = (len: number): string => (len >= 1500 && len <= 4000 ? 'OK' : len < 1500 ? 'TOO SHORT' : 'TOO LONG');

interface Candidate { name: string; file: string; a: [number, number]; b: [number, number] }
const CANDIDATES: Candidate[] = [
  { name: 'A Jamestown Lighthouse -> Black Star Square', file: 'bake/cache/roads-jamestown.json', a: [5.533, -0.2125], b: [5.5405, -0.1953] },
  { name: 'B Osu Oxford St -> Danquah Circle', file: 'bake/cache/roads-osu.json', a: [5.5565, -0.183], b: [5.5607, -0.1745] },
  { name: 'C Kwame Nkrumah Circle -> Danquah Circle (Ring Rd)', file: 'bake/cache/roads-ring.json', a: [5.57, -0.215], b: [5.5607, -0.1745] },
];

console.log('=== The three proposed routes (snapped to the nearest drivable node) ===');
for (const c of CANDIDATES) {
  const g = loadGraph(c.file);
  const sa = nearestNode(g, project(...c.a)), sb = nearestNode(g, project(...c.b));
  const snapA = dist(g.pts.get(sa)!, project(...c.a)), snapB = dist(g.pts.get(sb)!, project(...c.b));
  const r = route(g, sa, sb);
  console.log(`\n${c.name}\n  snap distance: start ${Math.round(snapA)} m, end ${Math.round(snapB)} m`);
  if (!r) { console.log('  NO ROUTE'); continue; }
  console.log(`  ${legal(r.length)}  ${fmt(scoreRoute(g, r.nodes, r.length))}`);
}

// Search each area for the windiest legal (1.5-4.0 km) route between distinct nodes.
console.log('\n=== Windiest legal routes found in each area (automatic search) ===');
let rng = 12345;
const rand = (): number => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 2 ** 32; };
for (const c of CANDIDATES) {
  const g = loadGraph(c.file);
  const ids = [...g.adj.keys()];
  const found: { s: Score; a: number; b: number; nodes: number[] }[] = [];
  for (let i = 0; i < 700; i += 1) {
    const a = ids[Math.floor(rand() * ids.length)]!, b = ids[Math.floor(rand() * ids.length)]!;
    const d = dist(g.pts.get(a)!, g.pts.get(b)!);
    if (d < 1200 || d > 3200) continue;
    const r = route(g, a, b);
    if (!r || r.length < 1500 || r.length > 4000) continue;
    const s = scoreRoute(g, r.nodes, r.length);
    found.push({ s, a, b, nodes: r.nodes });
  }
  // Rank: many sharp turns per km but no long boring straights.
  found.sort((x, y) => y.s.sharp60PerKm * 2 + y.s.turn30PerKm - y.s.longestStraight / 200 - (x.s.sharp60PerKm * 2 + x.s.turn30PerKm - x.s.longestStraight / 200));
  console.log(`\n${c.name.split(' ')[0]} area: ${found.length} legal routes sampled; top 3:`);
  for (const f of found.slice(0, 3)) {
    const ua = unproject(g.pts.get(f.a)!), ub = unproject(g.pts.get(f.b)!);
    console.log(`  start ${ua.lat.toFixed(4)}, ${ua.lon.toFixed(4)} -> end ${ub.lat.toFixed(4)}, ${ub.lon.toFixed(4)}\n    ${fmt(f.s)}`);
  }
}
