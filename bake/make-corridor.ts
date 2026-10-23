// Computes a preset route on the road graph and its padded bounding box (offline, no network).
//   node scripts/run-ts.mjs bake/make-corridor.ts route1
import { mkdirSync, writeFileSync } from 'node:fs';
import { project, unproject } from './lib/geo.ts';
import { fmt, loadGraph, nearestNode, route, scoreRoute } from './lib/roadgraph.ts';
import { ROUTES } from './routes.ts';

const id = process.argv[2] ?? 'route1';
const def = ROUTES[id];
if (!def) throw new Error(`unknown route ${id}`);
const PAD_M = Number(process.env['PAD'] ?? 250);

const g = loadGraph(def.roadsFile);
const a = nearestNode(g, project(...def.start)), b = nearestNode(g, project(...def.end));
const r = route(g, a, b);
if (!r) throw new Error('no route');
const poly = r.nodes.map((n) => g.pts.get(n)!);
const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
const sw = unproject({ x: Math.min(...xs) - PAD_M, z: Math.max(...zs) + PAD_M });
const ne = unproject({ x: Math.max(...xs) + PAD_M, z: Math.min(...zs) - PAD_M });
const out = {
  id: def.id,
  length: r.length,
  bbox: { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon },
  polyline: poly.map((p) => ({ x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 })),
};
mkdirSync('bake/cache', { recursive: true });
writeFileSync(`bake/cache/${def.id}-corridor.json`, JSON.stringify(out));
const w = (Math.max(...xs) - Math.min(...xs) + 2 * PAD_M) / 1000, h = (Math.max(...zs) - Math.min(...zs) + 2 * PAD_M) / 1000;
console.log(`${def.id}: ${fmt(scoreRoute(g, r.nodes, r.length))}`);
console.log(`bbox S${out.bbox.south.toFixed(5)} W${out.bbox.west.toFixed(5)} N${out.bbox.north.toFixed(5)} E${out.bbox.east.toFixed(5)}  (${w.toFixed(2)} x ${h.toFixed(2)} km = ${(w * h).toFixed(2)} km2)`);
