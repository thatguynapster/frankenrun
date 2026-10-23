// Scores the five proposed preset routes and draws them on one map (dev-only):
//   node scripts/run-ts.mjs bake/propose-routes.ts   ->  docs/route-proposals.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { dist, project } from './lib/geo.ts';
import { fmt, loadGraph, nearestNode, route, scoreRoute, type Graph } from './lib/roadgraph.ts';

interface Cand { id: string; label: string; file: string; a: [number, number]; b: [number, number]; maxM?: number; color: string }
const CANDS: Cand[] = [
  { id: 'route1', label: '1 Osu-Labone twist (existing)', file: 'bake/cache/roads-ring.json', a: [5.5525, -0.1796], b: [5.5653, -0.1748], color: '#e63946' },
  { id: 'osu-backstreets', label: '2 Osu back streets', file: 'bake/cache/roads-osu.json', a: [5.5493, -0.1782], b: [5.5612, -0.1765], color: '#f4a261' },
  { id: 'cantonments', label: '3 Osu to Cantonments', file: 'bake/cache/roads-osu.json', a: [5.5697, -0.1725], b: [5.5512, -0.1719], color: '#2a9d8f' },
  { id: 'jamestown', label: '4 Jamestown maze', file: 'bake/cache/roads-jamestown.json', a: [5.5433, -0.2162], b: [5.5532, -0.2064], color: '#4361ee' },
  { id: 'ring-sprint', label: '5 Ring Road sprint', file: 'bake/cache/roads-ring.json', a: [5.57, -0.215], b: [5.5607, -0.1745], maxM: 3800, color: '#9d4edd' },
];

const names = (file: string): Map<number, string> => {
  const m = new Map<number, string>();
  const j = JSON.parse(readFileSync(file, 'utf8')) as { elements: { type: string; nodes?: number[]; tags?: Record<string, string> }[] };
  for (const e of j.elements) if (e.type === 'way' && e.tags?.['name']) for (const n of e.nodes ?? []) m.set(n, e.tags['name']);
  return m;
};

const graphs = new Map<string, Graph>();
const polys: { c: Cand; poly: { x: number; z: number }[]; length: number }[] = [];
for (const c of CANDS) {
  let g = graphs.get(c.file);
  if (!g) graphs.set(c.file, (g = loadGraph(c.file)));
  const r = route(g, nearestNode(g, project(...c.a)), nearestNode(g, project(...c.b)))!;
  let nodes = r.nodes, length = r.length;
  if (c.maxM && length > c.maxM) {
    let acc = 0, cut = nodes.length;
    for (let i = 1; i < nodes.length; i += 1) { acc += dist(g.pts.get(nodes[i - 1]!)!, g.pts.get(nodes[i]!)!); if (acc > c.maxM) { cut = i; break; } }
    nodes = nodes.slice(0, cut); length = acc;
  }
  const nm = names(c.file), tally = new Map<string, number>();
  for (let i = 1; i < nodes.length; i += 1) { const n = nm.get(nodes[i]!); if (n) tally.set(n, (tally.get(n) ?? 0) + dist(g.pts.get(nodes[i - 1]!)!, g.pts.get(nodes[i]!)!)); }
  const top = [...tally].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([n, m]) => `${n} ${Math.round(m)} m`).join(', ');
  const end = g.pts.get(nodes[nodes.length - 1]!)!;
  console.log(`\n${c.label}\n  ${fmt(scoreRoute(g, nodes, length))}\n  roads: ${top}\n  end x=${end.x.toFixed(0)} z=${end.z.toFixed(0)}`);
  polys.push({ c, poly: nodes.map((n) => g!.pts.get(n)!), length });
}

// One overview map.
const all = polys.flatMap((p) => p.poly);
const pad = 600, minX = Math.min(...all.map((p) => p.x)) - pad, maxX = Math.max(...all.map((p) => p.x)) + pad;
const minZ = Math.min(...all.map((p) => p.z)) - pad, maxZ = Math.max(...all.map((p) => p.z)) + pad;
const W = 1000, H = Math.round((W * (maxZ - minZ)) / (maxX - minX));
const sx = (x: number): number => ((x - minX) / (maxX - minX)) * W, sz = (z: number): number => ((z - minZ) / (maxZ - minZ)) * H;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 120}" width="${W}"><rect width="${W}" height="${H + 120}" fill="#14162a"/>`;
const drawn = new Set<string>();
for (const g of graphs.values()) for (const [a, list] of g.adj) for (const e of list) {
  const k = a < e.to ? `${a}-${e.to}` : `${e.to}-${a}`;
  if (drawn.has(k) || a > e.to) continue;
  drawn.add(k);
  const pa = g.pts.get(a)!, pb = g.pts.get(e.to)!;
  if (pa.x < minX || pa.x > maxX || pa.z < minZ || pa.z > maxZ) continue;
  svg += `<line x1="${sx(pa.x).toFixed(1)}" y1="${sz(pa.z).toFixed(1)}" x2="${sx(pb.x).toFixed(1)}" y2="${sz(pb.z).toFixed(1)}" stroke="#343a63" stroke-width="1"/>`;
}
polys.forEach(({ c, poly, length }, i) => {
  svg += `<polyline fill="none" stroke="${c.color}" stroke-width="4" stroke-linejoin="round" points="${poly.map((p) => `${sx(p.x).toFixed(1)},${sz(p.z).toFixed(1)}`).join(' ')}"/>`;
  const s = poly[0]!;
  svg += `<circle cx="${sx(s.x).toFixed(1)}" cy="${sz(s.z).toFixed(1)}" r="7" fill="${c.color}" stroke="#fff"/><text x="${sx(s.x) + 10}" y="${sz(s.z) - 8}" fill="#fff" font-size="22" font-family="sans-serif" font-weight="700">${i + 1}</text>`;
  svg += `<text x="20" y="${H + 30 + i * 22}" fill="${c.color}" font-size="18" font-family="sans-serif">${c.label} · ${(length / 1000).toFixed(2)} km</text>`;
});
svg += '</svg>';
writeFileSync('docs/route-proposals.svg', svg);
console.log('\nwrote docs/route-proposals.svg');
