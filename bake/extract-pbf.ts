// Extracts a preset route's corridor from a Geofabrik .osm.pbf into the same JSON shape the Overpass
// fetch produces (dev-only, offline, reproducible):
//   node scripts/run-ts.mjs bake/extract-pbf.ts route1 bake/cache/ghana-261009.osm.pbf
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readOsmPbf, type OsmPbfBlock } from '@osmix/pbf';

const id = process.argv[2] ?? 'route1';
const pbfFile = process.argv[3] ?? 'bake/cache/ghana-261009.osm.pbf';
const { bbox } = JSON.parse(readFileSync(`bake/cache/${id}-corridor.json`, 'utf8')) as {
  bbox: { south: number; west: number; north: number; east: number };
};
const MARGIN = 0.0025; // ~275 m of extra nodes so ways crossing the bbox keep their full geometry
const inBox = (lat: number, lon: number): boolean => lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
const inMargin = (lat: number, lon: number): boolean =>
  lat >= bbox.south - MARGIN && lat <= bbox.north + MARGIN && lon >= bbox.west - MARGIN && lon <= bbox.east + MARGIN;

const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'service', 'pedestrian',
]);
const WALL_TYPES = new Set(['wall', 'retaining_wall', 'city_wall']);

interface Out { type: 'way' | 'node'; id: number; tags: Record<string, string>; geometry?: { lat: number; lon: number }[]; lat?: number; lon?: number }
const buildings: Out[] = [], roads: Out[] = [], details: Out[] = [];
const coords = new Map<number, [number, number]>(); // node id -> [lat, lon] (inside the margin box)
const decoder = new TextDecoder();
const text = (st: Uint8Array[], i: number): string => decoder.decode(st[i]!);

function tagsOf(st: Uint8Array[], keys: number[], vals: number[]): Record<string, string> {
  const t: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += 1) t[text(st, keys[i]!)] = text(st, vals[i]!);
  return t;
}

function handle(block: OsmPbfBlock): void {
  const gran = block.granularity ?? 100, latOff = block.lat_offset ?? 0, lonOff = block.lon_offset ?? 0;
  const st = block.stringtable;
  for (const group of block.primitivegroup) {
    // Plain nodes (rare in Geofabrik extracts) and dense nodes: ids and coordinates are delta-coded.
    for (const n of group.nodes ?? []) {
      const lat = 1e-9 * (latOff + gran * n.lat), lon = 1e-9 * (lonOff + gran * n.lon);
      if (inMargin(lat, lon)) coords.set(n.id, [lat, lon]);
    }
    const d = group.dense;
    if (d) {
      let nid = 0, la = 0, lo = 0, kv = 0;
      for (let i = 0; i < d.id.length; i += 1) {
        nid += d.id[i]!; la += d.lat[i]!; lo += d.lon[i]!;
        const lat = 1e-9 * (latOff + gran * la), lon = 1e-9 * (lonOff + gran * lo);
        const tags: Record<string, string> = {};
        // keys_vals is [k, v, k, v, ..., 0] per node; nodes without tags contribute a single 0.
        while (kv < d.keys_vals.length && d.keys_vals[kv] !== 0) { tags[text(st, d.keys_vals[kv]!)] = text(st, d.keys_vals[kv + 1]!); kv += 2; }
        kv += 1;
        if (!inMargin(lat, lon)) continue;
        coords.set(nid, [lat, lon]);
        if (inBox(lat, lon) && (tags['highway'] === 'street_lamp' || tags['man_made'] === 'street_lamp')) details.push({ type: 'node', id: nid, tags, lat, lon });
      }
    }
    for (const w of group.ways ?? []) {
      let r = 0;
      const geometry: { lat: number; lon: number }[] = [];
      let touches = false;
      for (const delta of w.refs) {
        r += delta;
        const c = coords.get(r);
        if (!c) continue;
        geometry.push({ lat: c[0], lon: c[1] });
        if (inBox(c[0], c[1])) touches = true;
      }
      if (!touches || geometry.length < 2) continue;
      const tags = tagsOf(st, w.keys, w.vals);
      if (tags['building']) buildings.push({ type: 'way', id: w.id, tags, geometry });
      else if (tags['highway'] && ROAD_CLASSES.has(tags['highway'])) roads.push({ type: 'way', id: w.id, tags, geometry });
      else if (WALL_TYPES.has(tags['barrier'] ?? '')) details.push({ type: 'way', id: w.id, tags, geometry });
    }
  }
}

const t0 = Date.now();
const stream = Readable.toWeb(createReadStream(pbfFile)) as unknown as ReadableStream<Uint8Array>;
const { header, blocks } = await readOsmPbf(stream);
let n = 0;
for await (const block of blocks) {
  handle(block);
  n += 1;
  if (n % 200 === 0) process.stdout.write(`\r${n} blocks, ${coords.size} nodes in box, ${buildings.length} buildings, ${roads.length} roads   `);
}
const ts = header.osmosis_replication_timestamp;
const osmDate = ts ? new Date(ts * 1000).toISOString() : 'unknown';
const sort = (a: Out[]): Out[] => a.sort((x, y) => x.id - y.id);
for (const [name, elements] of [['buildings', buildings], ['roads', roads], ['details', details]] as const) {
  const file = `bake/cache/${id}-pbf-${name}.json`;
  writeFileSync(file, JSON.stringify({ osm3s: { timestamp_osm_base: osmDate }, bbox, source: pbfFile, elements: sort(elements) }));
  console.log(`\n${name}: ${elements.length} elements -> ${file}`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s, blocks ${n}, OSM base ${osmDate}`);
