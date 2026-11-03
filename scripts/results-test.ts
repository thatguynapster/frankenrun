// The results do not stop the race for anyone still running:  npm run test:results
//  1. A human finishes while three bots are still racing: the results phase starts, but the bots keep going and
//     finish later, each getting a finish time (none is marked as not finishing).
//  2. Two humans: when the finish window closes on the one who is still racing, they keep driving and can still finish.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { FINISH_WINDOW_TICKS } from '../src/sim/parts.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
};

const mapId = process.env['MAP'] ?? 'route1';
const prep = getPreparedMap(mapId);
const total = prep.checkpoints.length;

/** Runs until the race has started, then returns the state a few ticks in. */
function startRace(state: GameState, inputs: (s: GameState) => GameInput[]): GameState {
  let s = state;
  for (let f = 0; f < 600 && !(s.phase === 'RACING' && s.frame - s.raceStart > 20); f += 1) s = stepGame(s, inputs(s), prep);
  return s;
}

// ---- 1. bots keep racing after the human finishes ----
{
  const config = { game: 'frankenrun', map: mapId, players: 4, bots: 3, seed: 1, tickRateHz: 30, version: 1 };
  const human = (s: GameState): GameInput => (s.phase === 'BUILD' ? { ...DEFAULT_INPUT, present: true, ready: true, start: true } : { ...DEFAULT_INPUT, present: true });
  const inputs = (s: GameState): GameInput[] => [human(s), DEFAULT_INPUT, DEFAULT_INPUT, DEFAULT_INPUT];
  let s = startRace(createGameState(config, prep), inputs);
  for (let f = 0; f < 300; f += 1) s = stepGame(s, inputs(s), prep); // ten seconds of racing
  // the human crosses the line
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, nextCheckpoint: total, finishTick: s.frame } : p)), finishOrder: [0] };
  s = stepGame(s, inputs(s), prep);
  check(s.phase === 'RESULTS', 'the results phase starts when the only human has finished');
  const atResults = s.players.map((p) => p.nextCheckpoint);
  let moving = 0;
  for (let f = 0; f < 30 * 400 && s.players.some((p, i) => i > 0 && p.finishTick < 0); f += 1) {
    s = stepGame(s, inputs(s), prep);
    if (f === 150) moving = projectGame(s, prep).players.filter((p, i) => i > 0 && p.speed > 2).length;
    if (s.phase !== 'RESULTS') { check(false, `the phase stayed RESULTS (it became ${s.phase})`); break; }
  }
  check(moving >= 2, `bots keep driving in the results (${moving} of 3 were moving 5 s after)`);
  check(s.players.slice(1).every((p, k) => p.nextCheckpoint > (atResults[k + 1] ?? 0)), 'every bot made progress after the results began');
  const finished = s.players.slice(1).filter((p) => p.finishTick >= 0).length;
  check(finished === 3, `all three bots got a finish time (${finished} of 3)`);
  check(s.finishOrder.length === 4 && s.finishOrder[0] === 0, 'the finish order lists the human first, then the bots as they finished');
}

// ---- 2. a human still racing when the finish window closes is not frozen ----
{
  const config = { game: 'frankenrun', map: mapId, players: 2, bots: 0, seed: 1, tickRateHz: 30, version: 1 };
  const inputs = (s: GameState): GameInput[] =>
    s.phase === 'BUILD'
      ? [{ ...DEFAULT_INPUT, present: true, ready: true, start: true }, { ...DEFAULT_INPUT, present: true, ready: true }]
      : [{ ...DEFAULT_INPUT, present: true }, { ...DEFAULT_INPUT, present: true, throttle: s.phase === 'RESULTS' ? 100 : 0 }]; // the second human waits at the line until the results begin
  let s = startRace(createGameState(config, prep), inputs);
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, nextCheckpoint: total, finishTick: s.frame } : p)), finishOrder: [0] };
  let resultsAt = -1;
  for (let f = 0; f < FINISH_WINDOW_TICKS + 200 && resultsAt < 0; f += 1) {
    s = stepGame(s, inputs(s), prep);
    if (s.phase === 'RESULTS') resultsAt = s.frame;
  }
  check(resultsAt > 0, 'the results phase starts once the finish window closes on the human still racing');
  const before = projectGame(s, prep).players[1]!;
  let top = 0;
  for (let f = 0; f < 90; f += 1) {
    s = stepGame(s, inputs(s), prep);
    top = Math.max(top, projectGame(s, prep).players[1]!.speed);
  }
  const after = projectGame(s, prep).players[1]!;
  check(top > 3 && Math.hypot(after.x - before.x, after.z - before.z) > 4, `the human still racing keeps driving in the results (top speed ${(top * 3.6).toFixed(0)} km/h)`);
}

console.log(failures === 0 ? 'all results checks pass' : `${failures} results check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
