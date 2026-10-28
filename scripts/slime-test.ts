// The slime blob: node scripts/run-ts.mjs scripts/slime-test.ts
// A press spits one blob up out of the head; it falls behind the monster and becomes a slick that makes the road slippery.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';

const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

let state: GameState = createGameState(config, prep);
const step = (over: Partial<GameInput> = {}): void => {
  const base: GameInput = state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true, headSel: 1 } : { ...DEFAULT_INPUT, present: true, headSel: 1 };
  state = stepGame(state, [{ ...base, ...over }, { ...base }], prep);
};
while (state.phase !== 'RACING') step();
for (let i = 0; i < 60; i += 1) step({ throttle: 100 });
check(state.blobs.length === 0 && state.slicks.length === 0, 'nothing in the air before the button');

const before = projectGame(state, prep).players[0]!;
step({ throttle: 100, head: true });
check(state.blobs.length === 1, 'pressing the button spits one blob');
const blob0 = state.blobs[0]!;
check(blob0.y > before.y + 1, 'it starts out of the head, above the body');

// the launch angle, relative to the monster: vertical speed against horizontal speed
const bodyV = projectGame(state, prep).players[0]!;
void bodyV;
let peak = blob0.y;
let landedAt = -1;
let behind = 0;
for (let i = 0; i < 120 && landedAt < 0; i += 1) {
  step({ throttle: 100, head: i < 3 });
  for (const b of state.blobs) peak = Math.max(peak, b.y);
  if (state.blobs.length === 0 && state.slicks.length > 0) {
    landedAt = i;
    const me = projectGame(state, prep).players[0]!;
    const s = state.slicks[state.slicks.length - 1]!;
    const yaw = 2 * Math.atan2(me.qy, me.qw);
    behind = -((s.x - me.x) * Math.sin(yaw) + (s.z - me.z) * Math.cos(yaw)); // metres behind the monster along its heading
  }
}
check(peak > blob0.y + 0.8 && peak < blob0.y + 4, `a steep lob, not a tall spout (peak ${(peak - blob0.y).toFixed(1)} m above the start)`);
check(landedAt >= 0, 'it lands and becomes a slick');
check(behind > 3 && behind < 14, `it lands behind the monster (${behind.toFixed(1)} m behind)`);
check(state.slicks.length === 1, 'exactly one slick, not a trail');

// the cooldown stops a second blob right away
step({ throttle: 100, head: false });
step({ throttle: 100, head: true });
check(state.blobs.length === 0, 'the cooldown blocks a second blob');

// thrown forwards it lands ahead
state = createGameState(config, prep);
while (state.phase !== 'RACING') step();
for (let i = 0; i < 60; i += 1) step({ throttle: 100 });
step({ throttle: 100, head: true, slimeFwd: true });
const launch = state.blobs[0]!;
const before2 = projectGame(state, prep).players[0]!;
const yaw2 = 2 * Math.atan2(before2.qy, before2.qw);
const along = (launch.vx - 0) * Math.sin(yaw2) + launch.vz * Math.cos(yaw2);
check(launch.vy > 0 && along > 0, 'thrown forwards: leaves upward and along the heading');
let ahead = 0;
for (let i = 0; i < 150 && state.blobs.length > 0; i += 1) step({ throttle: 100 });
{
  const me = projectGame(state, prep).players[0]!;
  const s = state.slicks[state.slicks.length - 1]!;
  ahead = (s.x - me.x) * Math.sin(2 * Math.atan2(me.qy, me.qw)) + (s.z - me.z) * Math.cos(2 * Math.atan2(me.qy, me.qw));
}
check(ahead > 4 && ahead < 22, `thrown forwards it lands ahead of the monster (${ahead.toFixed(1)} m ahead)`);

console.log(failures === 0 ? 'all slime checks pass' : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
