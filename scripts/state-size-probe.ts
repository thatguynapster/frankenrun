// How big is the state a rejoining or late-joining player has to download?  node scripts/run-ts.mjs scripts/state-size-probe.ts
import { encodeCanonicalBytes } from '@series-inc/rundot-syncplay/browser';
import { createGameState, stepGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const prep = getPreparedMap('route1');
for (const players of [2, 4]) {
  const config = { game: 'frankenrun', map: 'route1', players, seed: 5, tickRateHz: 30, version: 1 };
  let state: GameState = createGameState(config, prep);
  const sizes: string[] = [];
  for (let f = 0; f < 90 + 900; f++) {
    const inputs: GameInput[] = [];
    for (let slot = 0; slot < players; slot++) inputs.push({ ...DEFAULT_INPUT, present: true, ready: true, start: true, throttle: 100, steer: Math.round(30 * Math.sin((f + slot * 17) / 35)) });
    state = stepGame(state, inputs, prep);
    if (f === 0 || f === 100 || f === 400 || f === 900) sizes.push(`tick ${f}: ${(encodeCanonicalBytes(state as never).byteLength / 1024).toFixed(0)} KB`);
  }
  console.log(`${players} players: ${sizes.join(', ')}`);
}
