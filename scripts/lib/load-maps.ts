// Registers the baked maps for Node-side tests and probes (the browser loads them through the CDN).
import { readFileSync } from 'node:fs';
import { registerMapBytes } from '../../src/sim/runtime.ts';

export function loadBakedMaps(): void {
  registerMapBytes('route1', new Uint8Array(readFileSync('bake/out/route1.map.json')));
}
