// Reads drivable road geometry for one or more boxes out of an .osm.pbf, writing the same node-and-way JSON that
// fetch-roads.ts gets from Overpass (bake/cache/roads-<name>.json). Dev-time only, offline, one pass over the file:
//   node scripts/run-ts.mjs bake/roads-from-pbf.ts <file.osm.pbf> <name>:<south>,<west>,<north>,<east> [<name>:... ]
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { readOsmPbf, type OsmPbfBlock } from '@osmix/pbf';

const [pbfFile, ...specs] = process.argv.slice(2);
if (!pbfFile || specs.length === 0) {
  console.error('usage: roads-from-pbf.ts <file.osm.pbf> <name>:<south>,<west>,<north>,<east> [...]');
  process.exit(2);
}
interface Box { name: string; south: number; west: number; north: number; east: number; ways: { id: number; refs: number[]; tags: Record<string, string> }[] }
const boxes: Box[] = specs.map((s) => {
  const [name, rest] = s.split(':');
  const [south, west, north, east] = rest!.split(',').map(Number) as [number, number, number, number];
  return { name: name!, south, west, north, east, ways: [] };
});
const MARGIN = 0.003; // a little beyond each box so ways that cross its edge keep their nodes
const near = (lat: number, lon: number): boolean => boxes.some((b) => lat >= b.south - MARGIN && lat <= b.north + MARGIN && lon >= b.west - MARGIN && lon <= b.east + MARGIN);
const inside = (b: Box, lat: number, lon: number): boolean => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'service', 'pedestrian',
]);
const coords = new Map<number, [number, number]>();
const decoder = new TextDecoder();
const text = (st: Uint8Array[], i: number): string => decoder.decode(st[i]!);

function handle(block: OsmPbfBlock): void {
  const gran = block.granularity ?? 100, latOff = block.lat_offset ?? 0, lonOff = block.lon_offset ?? 0;
  const st = block.stringtable;
  for (const group of block.primitivegroup) {
    for (const n of group.nodes ?? []) {
      const lat = 1e-9 * (latOff + gran * n.lat), lon = 1e-9 * (lonOff + gran * n.lon);
      if (near(lat, lon)) coords.set(n.id, [lat, lon]);
    }
    const d = group.dense;
    if (d) {
      let nid = 0, la = 0, lo = 0, kv = 0;
      for (let i = 0; i < d.id.length; i += 1) {
        nid += d.id[i]!; la += d.lat[i]!; lo += d.lon[i]!;
        // keys_vals is [k, v, k, v, ..., 0] per node; nodes without tags contribute a single 0.
        while (kv < d.keys_vals.length && d.keys_vals[kv] !== 0) kv += 2;
        kv += 1;
        const lat = 1e-9 * (latOff + gran * la), lon = 1e-9 * (lonOff + gran * lo);
        if (near(lat, lon)) coords.set(nid, [lat, lon]);
      }
    }
    for (const w of group.ways ?? []) {
      const tags: Record<string, string> = {};
      for (let i = 0; i < w.keys.length; i += 1) tags[text(st, w.keys[i]!)] = text(st, w.vals[i]!);
      if (!tags['highway'] || !ROAD_CLASSES.has(tags['highway'])) continue;
      const refs: number[] = [];
      let r = 0;
      for (const delta of w.refs) { r += delta; refs.push(r); }
      for (const b of boxes) {
        if (refs.some((id) => { const c = coords.get(id); return c !== undefined && inside(b, c[0], c[1]); })) b.ways.push({ id: w.id, refs, tags });
      }
    }
  }
}

const t0 = Date.now();
const { header, blocks } = await readOsmPbf(Readable.toWeb(createReadStream(pbfFile)) as unknown as ReadableStream<Uint8Array>);
let n = 0;
for await (const block of blocks) {
  handle(block);
  n += 1;
  if (n % 200 === 0) process.stdout.write(`\r${n} blocks, ${coords.size} nodes held   `);
}
const ts = header.osmosis_replication_timestamp;
const osmDate = ts ? new Date(ts * 1000).toISOString() : 'unknown';
mkdirSync('bake/cache', { recursive: true });
for (const b of boxes) {
  const used = new Set<number>();
  for (const w of b.ways) for (const id of w.refs) if (coords.has(id)) used.add(id);
  const elements: unknown[] = [...used].sort((x, y) => x - y).map((id) => ({ type: 'node', id, lat: coords.get(id)![0], lon: coords.get(id)![1] }));
  for (const w of b.ways) elements.push({ type: 'way', id: w.id, nodes: w.refs.filter((id) => coords.has(id)), tags: w.tags });
  const file = `bake/cache/roads-${b.name}.json`;
  writeFileSync(file, JSON.stringify({ osm3s: { timestamp_osm_base: osmDate }, elements }));
  console.log(`\n${b.name}: ${b.ways.length} ways, ${used.size} nodes -> ${file}`);
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s, blocks ${n}, OSM base ${osmDate}`);
