// Draws proposed routes on their street maps as one HTML page (dev-only), so routes can be reviewed before they are baked:
//   node scripts/run-ts.mjs bake/render-proposals.ts <city> <route-id> [<route-id> ...]
// Needs bake/cache/<id>-corridor.json (make-corridor.ts) and the roads file named in bake/routes.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { project, type Pt } from './lib/geo.ts';
import { fmt, loadGraph, scoreRoute } from './lib/roadgraph.ts';
import { ROUTES } from './routes.ts';

const [city, ...ids] = process.argv.slice(2);
if (!city || ids.length === 0) {
  console.error('usage: render-proposals.ts <city> <route-id> [...]');
  process.exit(2);
}
interface OsmNode { type: 'node'; id: number; lat: number; lon: number }
interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
const WIDTH: Record<string, number> = { motorway: 5, trunk: 5, primary: 4, secondary: 3.2, tertiary: 2.6, residential: 1.8, unclassified: 1.8, living_street: 1.4, service: 1, pedestrian: 1 };
const COLOUR: Record<string, string> = { motorway: '#6b7090', trunk: '#6b7090', primary: '#59607f', secondary: '#4c5372', tertiary: '#434a68' };

const W = 760, H = 560, PAD = 18;
let cards = '';
for (const id of ids) {
  const def = ROUTES[id]!;
  const corridor = JSON.parse(readFileSync(`bake/cache/${id}-corridor.json`, 'utf8')) as { polyline: Pt[]; length: number };
  const roads = JSON.parse(readFileSync(def.roadsFile, 'utf8')) as { elements: (OsmNode | OsmWay)[] };
  const pts = new Map<number, Pt>();
  for (const e of roads.elements) if (e.type === 'node') pts.set(e.id, project(e.lat, e.lon));
  const xs = corridor.polyline.map((p) => p.x), zs = corridor.polyline.map((p) => p.z);
  const margin = 220;
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin, minZ = Math.min(...zs) - margin, maxZ = Math.max(...zs) + margin;
  const scale = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * scale) / 2, oz = (H - (maxZ - minZ) * scale) / 2;
  const px = (p: Pt): string => `${(ox + (p.x - minX) * scale).toFixed(1)},${(oz + (p.z - minZ) * scale).toFixed(1)}`;

  let svg = '';
  const ways = roads.elements.filter((e): e is OsmWay => e.type === 'way');
  // minor streets first so the big roads sit on top
  const order = (w: OsmWay): number => WIDTH[w.tags?.['highway'] ?? ''] ?? 1;
  for (const w of [...ways].sort((a, b) => order(a) - order(b))) {
    const cls = w.tags?.['highway'] ?? '';
    const line = w.nodes.map((n) => pts.get(n)).filter((p): p is Pt => p !== undefined);
    if (line.length < 2) continue;
    if (line.every((p) => p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ)) continue;
    svg += `<polyline points="${line.map(px).join(' ')}" fill="none" stroke="${COLOUR[cls] ?? '#3a4060'}" stroke-width="${((WIDTH[cls] ?? 1) * 0.9).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const route = corridor.polyline.map(px).join(' ');
  svg += `<polyline points="${route}" fill="none" stroke="#ff9a2e" stroke-opacity="0.35" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<polyline points="${route}" fill="none" stroke="#ffb454" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  // sharp turns (more than 60 degrees)
  let sharp = 0;
  for (let i = 1; i + 1 < corridor.polyline.length; i += 1) {
    const a = corridor.polyline[i - 1]!, b = corridor.polyline[i]!, c = corridor.polyline[i + 1]!;
    const h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    let turn = Math.abs(h2 - h1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 1.05 && Math.hypot(b.x - a.x, b.z - a.z) > 4) {
      sharp += 1;
      const [x, y] = px(b).split(',');
      svg += `<circle cx="${x}" cy="${y}" r="4.5" fill="#ff4f6a" stroke="#14091f" stroke-width="1.5"/>`;
    }
  }
  const [sx, sy] = px(corridor.polyline[0]!).split(',');
  const [ex, ey] = px(corridor.polyline[corridor.polyline.length - 1]!).split(',');
  svg += `<circle cx="${sx}" cy="${sy}" r="8" fill="#5cf08a" stroke="#14091f" stroke-width="2"/><text x="${sx}" y="${Number(sy) - 12}" fill="#5cf08a" font-size="13" font-weight="700" text-anchor="middle">START</text>`;
  svg += `<circle cx="${ex}" cy="${ey}" r="8" fill="#ffffff" stroke="#14091f" stroke-width="2"/><text x="${ex}" y="${Number(ey) - 12}" fill="#ffffff" font-size="13" font-weight="700" text-anchor="middle">FINISH</text>`;
  // scale bar: 500 m
  const bar = 500 * scale;
  svg += `<g><line x1="${PAD}" y1="${H - PAD}" x2="${PAD + bar}" y2="${H - PAD}" stroke="#d9d3b4" stroke-width="3"/><text x="${PAD}" y="${H - PAD - 6}" fill="#d9d3b4" font-size="12">500 m</text></g>`;

  const g = loadGraph(def.roadsFile);
  void g;
  const stats = `${(corridor.length / 1000).toFixed(2)} km, ${sharp} sharp turns`;
  cards += `<section><h2>${def.name}</h2><p class="stats">${stats}</p><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg></section>`;
  console.log(`${id}: ${stats}`);
}
void fmt;
void scoreRoute;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proposed routes: ${city}</title>
<style>
body{margin:0;padding:20px 16px 40px;background:#14091f;color:#f3ecd2;font-family:system-ui,sans-serif}
h1{margin:0 0 4px;font-size:22px;color:#ff9a2e;letter-spacing:.04em;text-transform:uppercase}
.lead{margin:0 0 20px;color:#b9b2d0;font-size:14px}
section{margin:0 auto 28px;max-width:780px}
h2{margin:0;font-size:18px;color:#ffb454}
.stats{margin:2px 0 8px;color:#b9b2d0;font-size:14px}
svg{width:100%;height:auto;background:#1b1230;border:1px solid rgba(243,236,210,.18);border-radius:5px;display:block}
.key{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#b9b2d0;margin-bottom:22px}
.key i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}
</style></head><body>
<h1>Proposed routes: ${city}</h1>
<p class="lead">Drawn on the downloaded street map. North is up. The line is the route a monster would take.</p>
<div class="key"><span><i style="background:#ffb454"></i>route</span><span><i style="background:#5cf08a"></i>start</span><span><i style="background:#fff"></i>finish</span><span><i style="background:#ff4f6a"></i>sharp turn (over 60&deg;)</span></div>
${cards}</body></html>`;
const out = `bake/cache/${city}-routes.html`;
writeFileSync(out, html);
console.log(`wrote ${out}`);
