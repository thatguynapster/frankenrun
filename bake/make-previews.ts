// Draws a small preview picture of every baked route (dev-only):
//   npm run bake:previews   ->  public/route-previews/<id>.svg
// Roads in grey, the route in green with a dot at every checkpoint, start in white and finish in orange.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { MapData } from '../src/sim/mapdata.ts';

const W = 320, H = 200, PAD = 16;
mkdirSync('public/route-previews', { recursive: true });
for (const file of readdirSync('bake/out').filter((n) => n.endsWith('.map.json'))) {
  const id = file.replace('.map.json', '');
  const map = JSON.parse(readFileSync(`bake/out/${id}.map.json`, 'utf8')) as MapData;
  const route = map.route ?? [];
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < route.length; i += 2) { xs.push(route[i]! / 10); zs.push(route[i + 1]! / 10); }
  // Frame the route with some margin so the nearby streets show around it.
  const margin = 120;
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin, minZ = Math.min(...zs) - margin, maxZ = Math.max(...zs) + margin;
  const scale = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * scale) / 2, oz = (H - (maxZ - minZ) * scale) / 2;
  const px = (x: number): string => (ox + (x - minX) * scale).toFixed(1);
  const pz = (z: number): string => (oz + (z - minZ) * scale).toFixed(1);

  let roads = '';
  for (const r of map.roads) {
    const pts: string[] = [];
    let inside = false;
    for (let i = 0; i < r.pts.length; i += 2) {
      const x = r.pts[i]! / 10, z = r.pts[i + 1]! / 10;
      if (x > minX && x < maxX && z > minZ && z < maxZ) inside = true;
      pts.push(`${px(x)} ${pz(z)}`);
    }
    if (inside && pts.length > 1) roads += `M${pts.join('L')}`;
  }
  const line = xs.map((x, i) => `${px(x)} ${pz(zs[i]!)}`).join('L');
  const dots = map.checkpoints.map((c) => `<circle cx="${px(c.x / 10)}" cy="${pz(c.z / 10)}" r="2.6"/>`).join('');
  const start = map.start, last = map.checkpoints[map.checkpoints.length - 1]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#10132a"/>
<path d="${roads}" fill="none" stroke="#3b4170" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M${line}" fill="none" stroke="#6fbf5a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="#10132a" stroke="#6fbf5a" stroke-width="1.4">${dots}</g>
<circle cx="${px(start.x / 10)}" cy="${pz(start.z / 10)}" r="5" fill="#fff" stroke="#10132a" stroke-width="1.5"/>
<circle cx="${px(last.x / 10)}" cy="${pz(last.z / 10)}" r="5.5" fill="#ff9a2e" stroke="#10132a" stroke-width="1.5"/>
</svg>
`;
  writeFileSync(`public/route-previews/${id}.svg`, svg);
  console.log(`${id}: ${(svg.length / 1024).toFixed(1)} KB`);
}
