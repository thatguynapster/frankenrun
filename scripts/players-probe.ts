// How many cars can the sim carry? node scripts/run-ts.mjs scripts/players-probe.ts [route1|greybox]
import { createGameState, stepGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const MAP = process.argv[2] ?? 'route1';
const prep = getPreparedMap(MAP);
for (const players of [2, 4, 8, 10]) {
  const config = { game: 'frankenrun', map: MAP, players, seed: 5, tickRateHz: 30, version: 1 };
  let state: GameState = createGameState(config, prep);
  const ms: number[] = [];
  for (let f = 0; f < 90 + 600; f++) {
    const inputs: GameInput[] = [];
    for (let slot = 0; slot < players; slot++) {
      inputs.push(state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true } : { ...DEFAULT_INPUT, throttle: 100, steer: Math.round(30 * Math.sin((f + slot * 17) / 35)) });
    }
    const t0 = performance.now();
    state = stepGame(state, inputs, prep);
    if (state.phase === 'RACING') ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
  const cars = state.players.map((p) => p.slot).length;
  console.log(`${players} players: avg ${avg.toFixed(2)} ms/tick, p95 ${ms[Math.floor(ms.length * 0.95)]!.toFixed(2)}, max ${ms[ms.length - 1]!.toFixed(1)} ms, active cells ${state.activeCells.length}, cars ${cars}`);
}
