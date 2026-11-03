import RundotGameAPI from '@series-inc/rundot-game-sdk/api';
import type { MapData } from '../sim/mapdata.js';
import { routeInfo } from '../routes.js';
import { registerMapBytes } from '../sim/runtime.js';
import { getPreparedMap } from '../sim/world.js';

const loaded = new Map<string, Promise<MapData>>();

/**
 * Fetches a baked map from the CDN, decompresses it, verifies its digest against the runtime identity
 * and registers it for the simulation. Safe to call repeatedly; the work happens once per map.
 * 'greybox' is built in and needs no download.
 */
export function ensureMap(id: string): Promise<MapData> {
  if (id === 'greybox') return Promise.resolve(getPreparedMap('greybox').map);
  let pending = loaded.get(id);
  if (!pending) {
    pending = load(id);
    loaded.set(id, pending);
    // A failed load must be retryable (e.g. a dropped connection), so forget it.
    pending.catch(() => loaded.delete(id));
  }
  return pending;
}

/** A slow or flaky connection often drops a download part way: try a few times before giving up. */
async function fetchWithRetry(path: string): Promise<Blob> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    try {
      return await RundotGameAPI.cdn.fetchAsset(path);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function load(id: string): Promise<MapData> {
  const blob = await fetchWithRetry(`${routeInfo(id)?.city ?? 'accra'}/${id}.map.json.gz`);
  let bytes = new Uint8Array(await blob.arrayBuffer());
  // Some hosts (including the dev server) send .gz with Content-Encoding: gzip, so the browser has already
  // decompressed it; others hand over the raw gzip. Only decompress when the gzip magic bytes are present.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  registerMapBytes(id, bytes); // throws on a digest mismatch; never fall back to other content
  return getPreparedMap(id).map;
}
