// AI racers in an online room: node scripts/run-ts.mjs scripts/bots-online-test.ts
// The host fills the empty seats with bots; a person arriving takes a seat back; the host can send the bots home; skill levels differ.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};
const prep = getPreparedMap('route1');
const config = { game: 'frankenrun', map: 'route1', players: 4, seed: 3, tickRateHz: 30, version: 1 };

const fresh = (): GameState => createGameState(config, prep);
/** One tick with `present` seats announcing themselves; seat 0 is the host. */
const tick = (state: GameState, present: number[], over: Partial<GameInput> = {}, per: Record<number, Partial<GameInput>> = {}): GameState => {
  const inputs = [0, 1, 2, 3].map((slot) => (present.includes(slot) ? { ...DEFAULT_INPUT, present: true, ready: true, ...(slot === 0 ? over : {}), ...(per[slot] ?? {}) } : DEFAULT_INPUT));
  return stepGame(state, inputs, prep);
};

// 1. the host fills the empty seats
let s = fresh();
for (let i = 0; i < 5; i += 1) s = tick(s, [0]);
check(s.players.every((p) => !p.isBot), 'before the host asks, nobody is a bot');
s = tick(s, [0], { fillBots: true, botLevel: 2 });
const view = projectGame(s, prep).players;
check(view[0]!.bot === false && view[1]!.bot && view[2]!.bot && view[3]!.bot, 'filling puts bots in the three empty seats and leaves the host a person');
s = tick(s, [0]); // one more tick: the bots now answer for themselves
check(s.botLevel === 2 && s.players[1]!.ready && s.players[3]!.ready, 'the bots are ready and carry the chosen skill');

// 2. the host can start with the bots, and they race
s = tick(s, [0], { start: true });
check(s.phase === 'COUNTDOWN', 'the host starts a race against the bots');
for (let i = 0; i < 30 * 70; i += 1) s = tick(s, [0], { throttle: 0 });
const cps = projectGame(s, prep).players.slice(1).map((p) => p.nextCheckpoint);
check(cps.every((c) => c >= 2), `the bots drive the route (checkpoints after 70 s: ${cps.join(', ')})`);

// 3. a person arriving takes a seat back in the lobby
let t = fresh();
for (let i = 0; i < 5; i += 1) t = tick(t, [0]);
t = tick(t, [0], { fillBots: true });
t = tick(t, [0, 2]);
check(projectGame(t, prep).players[2]!.bot === false && t.players[2]!.isBot === false, 'someone who arrives takes their seat back from a bot');
check(projectGame(t, prep).players[1]!.bot === true, 'the other bots stay');

// 4. the host sends the bots home
t = tick(t, [0, 2], { removeBots: true });
const left = projectGame(t, prep).players;
check(!left[1]!.bot && !left[3]!.bot && left[2]!.bot === false, 'the host can remove the bots again');

// 5. skill levels: an easy bot is slower than a hard one
const progress = (level: number): number => {
  let g = fresh();
  for (let i = 0; i < 5; i += 1) g = tick(g, [0]);
  g = tick(g, [0], { fillBots: true, botLevel: level });
  g = tick(g, [0], { start: true });
  for (let i = 0; i < 30 * 100; i += 1) g = tick(g, [0]);
  return projectGame(g, prep).players.slice(1).reduce((sum, p) => sum + p.nextCheckpoint, 0);
};
const easy = progress(0), hard = progress(2);
check(hard > easy, `hard bots get further than easy bots (checkpoints reached by three bots in 100 s: easy ${easy}, hard ${hard})`);

console.log(failures === 0 ? 'all online-bot checks pass' : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
