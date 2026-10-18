// Registers the baked maps for Node-side tests and probes (the browser loads them through the CDN).
import { readFileSync, readdirSync } from 'node:fs';
import { registerMapBytes } from '../../src/sim/runtime.ts';

export function loadBakedMaps(): void {
  for (const f of readdirSync('bake/out').filter((n) => n.endsWith('.map.json'))) {
    registerMapBytes(f.replace('.map.json', ''), new Uint8Array(readFileSync(`bake/out/${f}`)));
  }
}
