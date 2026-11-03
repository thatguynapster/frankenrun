// Hunchback Hump: node scripts/run-ts.mjs scripts/hump-test.ts
// A part that cannot be fitted is kept as a spare, and is fitted the moment its slot empties.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, carId, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';

const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

function race(headSel: number): GameState {
  let s = createGameState(config, prep);
  const base = (): GameInput => (s.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true, headSel } : { ...DEFAULT_INPUT, present: true, headSel });
  while (s.phase !== 'RACING') s = stepGame(s, [base(), { ...base(), headSel: 1 }], prep);
  return s;
}
const here = (s: GameState) => projectGame(s, prep).players[0]!;
let state = race(3);
const step = (): void => {
  state = stepGame(state, [{ ...DEFAULT_INPUT, present: true, headSel: 3 }, { ...DEFAULT_INPUT, present: true, headSel: 1 }], prep);
};
const drop = (slot: 'legs' | 'arms' | 'head', part: number): void => {
  const me = here(state);
  state = { ...state, pickups: [...state.pickups, { id: 900 + state.pickups.length, slot, part, x: me.x, z: me.z, expires: state.frame + 300, armedAt: 0, owner: -1, ownerArmedAt: 0 }], nextPickupId: state.nextPickupId + 1 };
};

check(here(state).build.head === 3 && here(state).spare === null, 'starts with the hump and an empty sack');
drop('legs', 2);
step();
check(here(state).spare?.slot === 'legs' && here(state).spare?.part === 2, 'a part that does not fit goes into the sack');
check(here(state).build.legs === 1, 'the fitted legs stay as they were');
check(state.pickups.length === 0, 'the pickup is gone');
drop('arms', 2);
step();
check(here(state).spare?.slot === 'legs', 'the sack holds only one spare');
check(state.pickups.length === 1, `the second part stays on the road (${state.pickups.length} left)`);
// the legs fall off: the spare is fitted at once
state = { ...state, pickups: [], players: state.players.map((p) => (p.slot === 0 ? { ...p, build: { ...p.build, legs: 0 } } : p)) };
step();
check(here(state).build.legs === 2 && here(state).spare === null, 'the spare is fitted when its slot empties');
// losing the hump loses the spare
drop('legs', 1);
step();
check(here(state).spare?.part === 1, 'carries another spare');
state = { ...state, players: state.players.map((p) => (p.slot === 0 ? { ...p, build: { ...p.build, head: 0 } } : p)) };
step();
check(here(state).spare === null, 'the spare goes when the hump does');
void carId;
if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all hump checks pass');
