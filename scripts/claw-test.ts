// Crab Claws grab: node scripts/run-ts.mjs scripts/claw-test.ts
// Press the arms button with a rival ahead: it is held; wiggling the steering breaks free; held to the end it loses a part.
// With no rival, the claws reach for a loose part ahead.
import { applyDeterministicWorldEdit3D, deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState, type Pickup } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';

const carId = (slot: number): string => `car-${slot}`;
const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

let state: GameState;
let bodyA = 0; // body of car 0 (1 = the fragile Bone Rattler, which loses a part on any single hit)
const step = (a: Partial<GameInput> = {}, b: Partial<GameInput> = {}): void => {
  const build = (slot: number): GameInput => ({ ...DEFAULT_INPUT, present: true, ready: true, start: state.phase === 'BUILD', bodySel: slot === 0 ? bodyA : 0, legsSel: 1, armsSel: slot === 0 ? 2 : 1, headSel: 1 });
  state = stepGame(state, [{ ...build(0), ...a }, { ...build(1), ...b }], prep);
};
const fresh = (): void => {
  state = createGameState(config, prep);
  while (state.phase !== 'RACING') step();
  for (let i = 0; i < 5; i += 1) step();
};
/** Puts car 1 `ahead` metres in front of car 0 (both stationary, facing the same way). */
const placeRival = (ahead: number): void => {
  const b0 = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
  const b1 = deterministicPhysicsBodyById3D(state.physics, carId(1))!;
  const yaw = 2 * Math.atan2(b0.orientation!.y, b0.orientation!.w);
  state = {
    ...state,
    physics: applyDeterministicWorldEdit3D(state.physics, {
      replace: [
        { ...b0, vx: 0, vz: 0, angularVel: { x: 0, y: 0, z: 0 } },
        { ...b1, x: b0.x + Math.sin(yaw) * ahead, z: b0.z + Math.cos(yaw) * ahead, vx: 0, vz: 0, orientation: b0.orientation, angularVel: { x: 0, y: 0, z: 0 } },
      ],
    }),
  };
};
const view = (slot: number) => projectGame(state, prep).players[slot]!;
const parts = (slot: number): number => Object.values(state.players[slot]!.build).slice(1).filter((v) => v !== 0).length;

// 1. a grab holds the rival
fresh();
placeRival(4);
step({ arms: true });
step();
check(view(0).grabbing === 1 && view(1).grabbedBy === 0, 'pressing the arms button with a rival 4 m ahead grabs it');

// 2. wiggling the steering frees the rival, and nobody loses a part
const partsBefore = parts(1);
for (let i = 0; i < 6; i += 1) { step({}, { steer: i % 2 === 0 ? 100 : -100 }); }
check(view(1).grabbedBy === -1 && view(0).grabbing === -1, 'the rival breaks free by swinging the steering side to side');
check(parts(1) === partsBefore, 'a rival that breaks free keeps its parts');
placeRival(4);
step({ arms: true });
step();
check(view(0).grabbing === -1, 'a freed rival cannot be grabbed again straight away');

// 3. held to the end it loses a part
fresh();
placeRival(4);
step({ arms: true });
const before = parts(1);
for (let i = 0; i < 70; i += 1) step();
check(view(0).grabbing === -1 && parts(1) < before, 'a rival held for the whole grab loses a part');

// 4. nothing ahead: a miss, with a short cooldown
fresh();
placeRival(30);
step({ arms: true });
check(view(0).grabbing === -1 && state.players[0]!.armsCooldown > 0, 'with no rival in reach the claws miss and cool down');

// 5. a loose part ahead is pulled in
fresh();
placeRival(30);
const b0 = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
const yaw = 2 * Math.atan2(b0.orientation!.y, b0.orientation!.w);
const pickup: Pickup = { id: 1, slot: 'head', part: 1, x: b0.x + Math.sin(yaw) * 7, z: b0.z + Math.cos(yaw) * 7, expires: state.frame + 900, armedAt: state.frame, owner: 1, ownerArmedAt: state.frame };
state = { ...state, players: state.players.map((p) => (p.slot === 0 ? { ...p, build: { ...p.build, head: 0 } } : p)), pickups: [pickup], nextPickupId: 2 };
step({ arms: true });
check(state.players[0]!.build.head === 1 && state.pickups.length === 0, 'with no rival, the claws reach 7 m for a loose part and fill the empty slot');


// 6. grabbing a rival from very close range, while moving, hurts nobody
const withSpeed = (speed: number): void => {
  const b0 = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
  const yaw = 2 * Math.atan2(b0.orientation!.y, b0.orientation!.w);
  state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [{ ...b0, vx: (Math.sin(yaw) * speed) / 30, vz: (Math.cos(yaw) * speed) / 30 }] }) };
};
for (const [dist, speed] of [[2.4, 6], [2.2, 10], [2.4, 0]] as const) {
  bodyA = 1;
  fresh();
  placeRival(dist);
  withSpeed(speed);
  step({ arms: true });
  for (let i = 0; i < 25; i += 1) step();
  check(state.players[0]!.partsLost === 0 && state.players[1]!.partsLost === 0, `grabbing at ${dist} m while moving at ${speed} m/s costs nobody a part`);
}
bodyA = 0;

// 7. a gentle bump is not a crash; a hard impact is
fresh();
placeRival(2.6);
withSpeed(5);
for (let i = 0; i < 40; i += 1) step({ throttle: 0 });
check(state.players[0]!.hits === 0 && state.players[1]!.hits === 0 && state.players[1]!.partsLost === 0, 'a gentle bump (about 18 km/h) does not count as a crash');
fresh();
placeRival(4);
withSpeed(24);
for (let i = 0; i < 40; i += 1) step({ throttle: 0 });
check(state.players[1]!.hits > 0 || state.players[1]!.partsLost > 0, 'a hard impact (about 86 km/h) registers a crash');

// 8. a head-on crash at racing speed hurts both monsters (two hits each, so a Brute is one hit from losing a part)
fresh();
{
  const a = deterministicPhysicsBodyById3D(state.physics, carId(0))!, b = deterministicPhysicsBodyById3D(state.physics, carId(1))!;
  const yaw0 = 2 * Math.atan2(a.orientation!.y, a.orientation!.w);
  const half = (yaw0 + Math.PI) / 2;
  state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [
    { ...a, vx: (Math.sin(yaw0) * 20) / 30, vz: (Math.cos(yaw0) * 20) / 30 },
    { ...b, x: a.x + Math.sin(yaw0) * 12, z: a.z + Math.cos(yaw0) * 12, vx: (-Math.sin(yaw0) * 20) / 30, vz: (-Math.cos(yaw0) * 20) / 30, orientation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) } },
  ] }) };
  for (let i = 0; i < 40; i += 1) step({ throttle: 0 }, { throttle: 0 });
  check(state.players[0]!.hits >= 2 && state.players[1]!.hits >= 2, `a head-on crash at 20 m/s each counts as a serious crash for both (hits ${state.players[0]!.hits} and ${state.players[1]!.hits})`);
}
console.log(failures === 0 ? 'all claw checks pass' : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
