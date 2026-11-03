// Tipping over and getting up: node scripts/run-ts.mjs scripts/getup-test.ts
import { applyDeterministicWorldEdit3D, deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';

const carId = (slot: number): string => `car-${slot}`;
const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

let state: GameState = createGameState(config, prep);
const press = (over: Partial<GameInput>): GameInput[] => {
  const base: GameInput = state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, present: true, start: true } : { ...DEFAULT_INPUT, present: true };
  return [{ ...base, ...over }, { ...base }];
};
const me = () => projectGame(state, prep).players[0]!;
const step = (over: Partial<GameInput> = {}): void => {
  state = stepGame(state, press(over), prep);
};
const upness = (): number => {
  const p = me();
  return 1 - 2 * (p.qx * p.qx + p.qz * p.qz);
};

while (state.phase !== 'RACING') step();
for (let i = 0; i < 40; i += 1) step({ throttle: 100 });
check(!me().tipped, 'upright monster is not tipped');
check(upness() > 0.9, 'upright monster has its up axis up');

// Lay the monster on its side (roll 90 degrees about its forward axis) and let it settle.
const body = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
const s = Math.SQRT1_2;
state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [{ ...body, vx: 0, vz: 0, orientation: { x: 0, y: 0, z: s, w: s }, angularVel: { x: 0, y: 0, z: 0 } }] }) };
for (let i = 0; i < 5; i += 1) step();
check(!me().tipped, 'not tipped until it has stayed down a moment');
for (let i = 0; i < 30; i += 1) step();
check(me().tipped, 'tipped after staying on its side');
const x0 = me().x, z0 = me().z;

// Pressing Get up while upright does nothing; here it is tipped, so it works.
step({ getUp: true });
for (let i = 0; i < 20; i += 1) step();
check(!me().tipped, 'Get up rights the monster');
check(upness() > 0.9, 'upright again after Get up');
check(Math.hypot(me().x - x0, me().z - z0) < 2, 'stays where it fell');

// Spamming Get up while upright must not teleport or hop it.
const before = me();
for (let i = 0; i < 60; i += 1) step({ getUp: true });
check(Math.hypot(me().x - before.x, me().z - before.z) < 3 && me().y < 2, 'Get up while upright does nothing');

// Other players are not affected, and a second fall can be recovered from after the cooldown.
const b2 = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [{ ...b2, vx: 0, vz: 0, orientation: { x: s, y: 0, z: 0, w: s }, angularVel: { x: 0, y: 0, z: 0 } }] }) };
for (let i = 0; i < 40; i += 1) step();
check(me().tipped, 'tipped again (on its nose)');
step({ getUp: true });
for (let i = 0; i < 20; i += 1) step();
check(!me().tipped && upness() > 0.9, 'recovers from a nose-down fall too');
console.log(failures === 0 ? 'all get-up checks pass' : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
