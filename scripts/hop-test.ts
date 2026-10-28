// Hopper Haunches: node scripts/run-ts.mjs scripts/hop-test.ts
// Hold the legs button to charge, let go to leap; no steering in the air; a cooldown follows.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';

const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

function fresh(legsSel: number): GameState {
  let s = createGameState(config, prep);
  const base = (): GameInput => (s.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true, legsSel } : { ...DEFAULT_INPUT, present: true, legsSel });
  while (s.phase !== 'RACING') s = stepGame(s, [base(), base()], prep);
  return s;
}
const me = (s: GameState) => projectGame(s, prep).players[0]!;
const yawOf = (s: GameState): number => 2 * Math.atan2(me(s).qy, me(s).qw);

// a full charge
let state = fresh(3);
const step = (over: Partial<GameInput> = {}): void => {
  const base: GameInput = { ...DEFAULT_INPUT, present: true, legsSel: 3, throttle: 100 };
  state = stepGame(state, [{ ...base, ...over }, { ...base }], prep);
};
for (let i = 0; i < 40; i += 1) step();
const before = state;
for (let i = 0; i < 24; i += 1) step();
const freeSpeed = me(state).speed;
state = before;
for (let i = 0; i < 24; i += 1) step({ legs: true });
check(me(state).hopCharge > 0.9, `holding the button charges it (${me(state).hopCharge.toFixed(2)})`);
check(me(state).speed < freeSpeed - 0.5, `throttle is cut while crouching (${me(state).speed.toFixed(1)} against ${freeSpeed.toFixed(1)} m/s)`);
step({ legs: false });
check(me(state).airborne, 'letting go leaps');
let peak = me(state).y;
const yaw0 = yawOf(state);
for (let i = 0; i < 12; i += 1) {
  step({ steer: 100 });
  peak = Math.max(peak, me(state).y);
}
check(peak > 2.2, `a full leap rises well above the ground (peak ${peak.toFixed(2)} m)`);
check(Math.abs(yawOf(state) - yaw0) < 0.15, 'steering does nothing in the air');
for (let i = 0; i < 120 && me(state).airborne; i += 1) step();
check(!me(state).airborne, 'it lands');
check(me(state).hopCooldown > 0, `a cooldown follows (${(me(state).hopCooldown / 30).toFixed(1)} s left)`);
for (let i = 0; i < 30; i += 1) step({ legs: true });
step({ legs: false });
check(!me(state).airborne, 'no second leap during the cooldown');

// a tap gives a small hop, and ordinary legs do nothing
state = fresh(3);
for (let i = 0; i < 40; i += 1) step();
step({ legs: true });
step({ legs: false });
let tapPeak = me(state).y;
for (let i = 0; i < 40; i += 1) { step(); tapPeak = Math.max(tapPeak, me(state).y); }
check(tapPeak < peak - 0.5, `a quick tap hops lower (${tapPeak.toFixed(2)} m)`);
state = fresh(1);
for (let i = 0; i < 40; i += 1) step({ legsSel: 1 });
for (let i = 0; i < 24; i += 1) step({ legs: true, legsSel: 1 });
step({ legs: false, legsSel: 1 });
check(!me(state).airborne && me(state).hopCharge === 0, 'werewolf legs ignore the button');

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all hop checks pass');
