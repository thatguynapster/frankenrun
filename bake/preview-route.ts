// Renders candidate routes over the road network to an SVG for eyeballing:  PREVIEW=1 node scripts/run-ts.mjs bake/preview-route.ts
import { writeFileSync } from 'node:fs';
import { project } from './lib/geo.ts';
import { fmt, loadGraph, nearestNode, route, scoreRoute } from './lib/roadgraph.ts';

const ROUTES = [
  { id: '1', label: 'Route 1 (windiest, Osu-Labone area)', file: 'bake/cache/roads-ring.json', a: [5.5525, -0.1796], b: [5.5653, -0.1748], color: '#e63946' },
  { id: '2', label: 'Route 2 (Osu-Cantonments, shorter)', file: 'bake/cache/roads-osu.json', a: [5.5493, -0.1782], b: [5.5612, -0.1765], color: '#f4a261' },
  { id: '3', label: 'Route 3 (longer, north)', file: 'bake/cache/roads-osu.json', a: [5.5697, -0.1725], b: [5.5512, -0.1719], color: '#2a9d8f' },
];

for (const r of ROUTES) {
  const g = loadGraph(r.file);
  const sa = nearestNode(g, project(...(r.a as [number, number]))), sb = nearestNode(g, project(...(r.b as [number, number])));
  const res = route(g, sa, sb)!;
  const poly = res.nodes.map((n) => g.pts.get(n)!);
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const pad = 250;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minZ = Math.min(...zs) - pad, maxZ = Math.max(...zs) + pad;
  const W = 900, H = Math.round((W * (maxZ - minZ)) / (maxX - minX));
  const sx = (x: number): number => ((x - minX) / (maxX - minX)) * W, sz = (z: number): number => ((z - minZ) / (maxZ - minZ)) * H;
  let roads = '';
  const drawn = new Set<string>();
  for (const [a, list] of g.adj) for (const e of list) {
    const key = a < e.to ? `${a}-${e.to}` : `${e.to}-${a}`;
    if (drawn.has(key)) continue; drawn.add(key);
    const pa = g.pts.get(a)!, pb = g.pts.get(e.to)!;
    if (pa.x < minX || pa.x > maxX || pa.z < minZ || pa.z > maxZ) continue;
    roads += `<line x1="${sx(pa.x).toFixed(1)}" y1="${sz(pa.z).toFixed(1)}" x2="${sx(pb.x).toFixed(1)}" y2="${sz(pb.z).toFixed(1)}"/>`;
  }
  const path = poly.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sz(p.z).toFixed(1)}`).join(' ');
  const s = scoreRoute(g, res.nodes, res.length);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40}" viewBox="0 0 ${W} ${H + 40}"><rect width="100%" height="100%" fill="#0b1020"/><g stroke="#3b4468" stroke-width="1.2">${roads}</g><path d="${path}" fill="none" stroke="${r.color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx(poly[0]!.x)}" cy="${sz(poly[0]!.z)}" r="9" fill="#6fbf5a" stroke="#fff" stroke-width="2"/><circle cx="${sx(poly[poly.length - 1]!.x)}" cy="${sz(poly[poly.length - 1]!.z)}" r="9" fill="#ffd23b" stroke="#fff" stroke-width="2"/><text x="10" y="${H + 26}" fill="#fff" font-family="Arial" font-size="15">${r.label}: ${(s.length / 1000).toFixed(2)} km, ${s.sharp60} sharp turns, longest straight ${Math.round(s.longestStraight)} m  (green = start, yellow = end, north is up)</text></svg>`;
  writeFileSync(`bake/cache/route-${r.id}.svg`, svg);
  console.log(r.id, fmt(s));
}
