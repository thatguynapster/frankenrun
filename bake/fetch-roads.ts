// Fetches drivable road geometry for a bounding box from the Overpass API into bake/cache/.
// Dev-time only: the shipped game never contacts a map service.
//   node scripts/run-ts.mjs bake/fetch-roads.ts <name> <south> <west> <north> <east>
import { mkdirSync, writeFileSync } from 'node:fs';

const [name, south, west, north, east] = process.argv.slice(2);
if (!name || !south || !west || !north || !east) {
  console.error('usage: fetch-roads.ts <name> <south> <west> <north> <east>');
  process.exit(2);
}

const query = `[out:json][timeout:90];
(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|pedestrian)$"](${south},${west},${north},${east});>;);
out body qt;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function fetchOverpass(): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]!;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'frankenrun-bake/0.1 (RUN.world game jam; contact: andy.poke94@gmail.com)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) return res;
      console.warn(`  ${endpoint} -> ${res.status}, retrying`);
    } catch (e) {
      console.warn(`  ${endpoint} -> ${(e as Error).message}, retrying`);
    }
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw new Error('all Overpass endpoints failed');
}

const response = await fetchOverpass();
const text = await response.text();
const json = JSON.parse(text) as { osm3s?: { timestamp_osm_base?: string }; elements: { type: string }[] };
mkdirSync('bake/cache', { recursive: true });
const file = `bake/cache/roads-${name}.json`;
writeFileSync(file, text);
const ways = json.elements.filter((e) => e.type === 'way').length;
const nodes = json.elements.filter((e) => e.type === 'node').length;
console.log(`${name}: ${(text.length / 1e6).toFixed(2)} MB, ${ways} ways, ${nodes} nodes, OSM base ${json.osm3s?.timestamp_osm_base ?? '?'} -> ${file}`);
