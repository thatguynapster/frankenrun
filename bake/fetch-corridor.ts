// Fetches the map features for a preset route's corridor from the Overpass API into bake/cache/.
// Dev-time only: the shipped game never contacts a map service.
//   node scripts/run-ts.mjs bake/fetch-corridor.ts route1
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const id = process.argv[2] ?? 'route1';
const { bbox } = JSON.parse(readFileSync(`bake/cache/${id}-corridor.json`, 'utf8')) as {
  bbox: { south: number; west: number; north: number; east: number };
};
// Split the corridor into ~450 m cells so each Overpass query stays small; cells are cached so reruns resume.
const CELL_M = 450;
const midLat = (bbox.south + bbox.north) / 2;
const nx = Math.max(1, Math.ceil(((bbox.east - bbox.west) * 111320 * Math.cos((midLat * Math.PI) / 180)) / CELL_M));
const ny = Math.max(1, Math.ceil(((bbox.north - bbox.south) * 110540) / CELL_M));
const cells: string[] = [];
for (let iy = 0; iy < ny; iy += 1) {
  for (let ix = 0; ix < nx; ix += 1) {
    const s = bbox.south + ((bbox.north - bbox.south) * iy) / ny, n = bbox.south + ((bbox.north - bbox.south) * (iy + 1)) / ny;
    const w = bbox.west + ((bbox.east - bbox.west) * ix) / nx, e = bbox.west + ((bbox.east - bbox.west) * (ix + 1)) / nx;
    cells.push(`${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`);
  }
}

const QUERIES: Record<string, (b: string) => string> = {
  buildings: (b) => `[out:json][timeout:120];way["building"](${b});out geom qt;`,
  roads: (b) => `[out:json][timeout:120];way["highway"](${b});out geom qt;`,
  details: (b) => `[out:json][timeout:120];(way["barrier"~"^(wall|fence|retaining_wall|city_wall)$"](${b});node["highway"="street_lamp"](${b});node["man_made"="street_lamp"](${b}););out geom qt;`,
};

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function post(query: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
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
      if (res.ok) return await res.text();
      console.warn(`  ${endpoint} -> ${res.status}, retrying`);
    } catch (e) {
      console.warn(`  ${endpoint} -> ${(e as Error).message}, retrying`);
    }
    await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
  }
  throw new Error('all Overpass endpoints failed');
}

mkdirSync(`bake/cache/${id}-cells`, { recursive: true });
let base = '?';
for (const [name, makeQuery] of Object.entries(QUERIES)) {
  const merged = new Map<string, unknown>();
  let bytes = 0;
  for (let i = 0; i < cells.length; i += 1) {
    const cellFile = `bake/cache/${id}-cells/${name}-${i}.json`;
    let text: string;
    if (existsSync(cellFile)) text = readFileSync(cellFile, 'utf8');
    else {
      text = await post(makeQuery(cells[i]!));
      writeFileSync(cellFile, text);
      await new Promise((r) => setTimeout(r, 12000));
    }
    bytes += text.length;
    const json = JSON.parse(text) as { osm3s?: { timestamp_osm_base?: string }; elements: { type: string; id: number }[] };
    base = json.osm3s?.timestamp_osm_base ?? base;
    for (const el of json.elements) merged.set(`${el.type}/${el.id}`, el);
    process.stdout.write(`${name}: cell ${i + 1}/${cells.length}, ${merged.size} unique elements   `);
  }
  const file = `bake/cache/${id}-${name}.json`;
  writeFileSync(file, JSON.stringify({ osm3s: { timestamp_osm_base: base }, bbox, elements: [...merged.values()] }));
  console.log(`
${name}: ${(bytes / 1e6).toFixed(2)} MB downloaded across ${cells.length} cells, ${merged.size} unique elements, OSM base ${base} -> ${file}`);
}
