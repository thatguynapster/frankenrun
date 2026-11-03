// Every body/part combination, driven for a few seconds: node scripts/run-ts.mjs scripts/build-probe.ts
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';
loadBakedMaps();
const prep = getPreparedMap('route1');
const config = { game: 'frankenrun', map: 'route1', players: 2, seed: 1, tickRateHz: 30, version: 1 };
for (const body of [0, 1]) for (const legs of [0, 1, 2]) for (const arms of [0, 1, 2]) for (const head of [0, 1, 2]) {
  let state: GameState = createGameState(config, prep);
  const t0 = Date.now();
  for (let f = 0; f < 90 + 150; f++) {
    const input = (slot: number): GameInput =>
      state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true, bodySel: body, legsSel: legs, armsSel: arms, headSel: head } : slot === 0 ? { ...DEFAULT_INPUT, throttle: 100 } : DEFAULT_INPUT;
    state = stepGame(state, [input(0), input(1)], prep);
  }
  const p = projectGame(state, prep).players[0]!;
  console.log(`body ${body} legs ${legs} arms ${arms} head ${head}: ${(p.speed * 3.6).toFixed(0)} km/h, ${Date.now() - t0} ms`);
}
