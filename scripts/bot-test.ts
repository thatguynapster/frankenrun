// AI racers: node scripts/run-ts.mjs scripts/bot-test.ts [mapId...]
// One idle human and three bots race a baked route; every bot should keep moving and make real progress.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const maps = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['route1', 'ring-sprint'];
const SECONDS = Number(process.env['SECS'] ?? 240);
let failures = 0;
for (const mapId of maps) {
  const prep = getPreparedMap(mapId);
  const config = { game: 'frankenrun', map: mapId, players: 4, bots: 3, seed: 1, tickRateHz: 30, version: 1 };
  let state: GameState = createGameState(config, prep);
  const finished = new Map<number, number>();
  let resets = 0, maxMs = 0, sumMs = 0, ticks = 0;
  for (let f = 0; f < SECONDS * 30; f += 1) {
    const human: GameInput = state.phase === 'BUILD' ? { ...DEFAULT_INPUT, present: true, ready: true, start: true } : { ...DEFAULT_INPUT, present: true };
    const t0 = performance.now();
    const prevHold = state.players.map((p) => p.resetHold);
    state = stepGame(state, [human, DEFAULT_INPUT, DEFAULT_INPUT, DEFAULT_INPUT], prep);
    const ms = performance.now() - t0;
    maxMs = Math.max(maxMs, ms);
    sumMs += ms;
    ticks += 1;
    state.players.forEach((p, i) => { if (i > 0 && p.resetHold === 0 && (prevHold[i] ?? 0) >= 29) resets += 1; if (p.finishTick >= 0 && !finished.has(p.slot)) finished.set(p.slot, (p.finishTick - state.raceStart) / 30); });
    if (state.phase === 'RESULTS') break;
  }
  const view = projectGame(state, prep).players;
  const total = prep.checkpoints.length;
  console.log(`${mapId}: ${total} checkpoints, ${SECONDS} s allowed; sim ${(sumMs / ticks).toFixed(2)} ms/tick avg, ${maxMs.toFixed(0)} ms worst`);
  for (const p of view.filter((v) => v.bot)) {
    const done = finished.get(p.slot);
    console.log(`  bot ${p.slot}: ${done !== undefined ? `finished in ${done.toFixed(0)} s` : `reached ${p.nextCheckpoint}/${total}`} (${p.build.body}${p.build.legs}${p.build.arms}${p.build.head})`);
    if (p.nextCheckpoint < Math.ceil(total / 2)) failures += 1;
  }
  console.log(`  bot resets used: ${resets}`);
}
console.log(failures === 0 ? 'all bots make good progress' : `${failures} bots made too little progress`);
process.exit(failures === 0 ? 0 : 1);
