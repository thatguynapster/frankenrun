// Mystery boxes, street events and wandering creatures: node scripts/run-ts.mjs scripts/events-test.ts
// Placement is sane on every route, creatures wander on the road and affect monsters that meet them, and in a bot race the
// boxes get opened and events happen.
import { applyDeterministicWorldEdit3D, deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
import { createGameState, stepGame, projectGame, carId, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { roamerAt, roamerKind, stompIn } from '../src/sim/features.ts';
import { GHOST_AURA_M } from '../src/sim/events.ts';
import { getPreparedMap, type PreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';
import { ROUTES } from '../src/routes.ts';

loadBakedMaps();
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

const kindsSeen: Record<number, { map: string; index: number }> = {};
for (const r of ROUTES) {
  const prep = getPreparedMap(r.id);
  const { boxes, roamers } = prep.features;
  const stops = [{ x: prep.map.start.x / 10, z: prep.map.start.z / 10 }, ...prep.checkpoints];
  const clear = [...boxes, ...roamers].every((f) => stops.every((s) => Math.hypot(s.x - f.x, s.z - f.z) > 25));
  const onRoad = boxes.every((f) => prep.onRoad(f.x, f.z));
  // Creatures wander at random but must stay on the road: sample each one over a few minutes.
  let on = 0, total = 0, minX = Infinity;
  roamers.forEach((rm, i) => {
    for (let f = 0; f < 9000; f += 150) {
      const at = roamerAt(rm, i, 777, f);
      total += 1;
      if (prep.onRoad(at.x, at.z)) on += 1;
    }
    minX = Math.min(minX, rm.reach ?? 0);
    const k = roamerKind(i);
    if (kindsSeen[k] === undefined) kindsSeen[k] = { map: r.id, index: i };
  });
  const routeBoxes = boxes.filter((b) => (prep.map.route ?? []).some((_, j, a) => j % 2 === 0 && Math.hypot(a[j]! / 10 - b.x, a[j + 1]! / 10 - b.z) < 3)).length;
  check(boxes.length >= 5 && routeBoxes >= 5, `${r.id}: ${boxes.length} mystery boxes (${routeBoxes} on the route), ${roamers.length} creatures`);
  check(clear, `${r.id}: none sits on the start or a checkpoint`);
  check(onRoad, `${r.id}: all boxes are on the road`);
  check(total === 0 || on / total > 0.93, `${r.id}: creatures stay on the road (${total === 0 ? 100 : Math.round((100 * on) / total)}% of samples)`);
}
check(kindsSeen[0] !== undefined && kindsSeen[1] !== undefined && kindsSeen[2] !== undefined, 'all three creature kinds appear');

// Wandering is not a fixed line: positions over time must spread in both directions, and be reproducible.
{
  const prep = getPreparedMap('route1');
  const rm = prep.features.roamers[0]!;
  const xs: number[] = [], zs: number[] = [];
  for (let f = 0; f < 6000; f += 30) {
    const at = roamerAt(rm, 0, 100, f);
    xs.push(at.x);
    zs.push(at.z);
  }
  const spread = (a: number[]): number => Math.max(...a) - Math.min(...a);
  check(spread(xs) > 3 && spread(zs) > 3, 'a creature wanders across an area, not along a line');
  const a = roamerAt(rm, 0, 100, 1234), b = roamerAt(rm, 0, 100, 1234);
  check(a.x === b.x && a.z === b.z && a.heading === b.heading, 'creature position is a pure function of the tick');
}

// Meeting a creature: drive car 0 at it along the road and watch what happens.
const SALT_FRAME = 0;
function meet(prep: PreparedMap, index: number): { minDist: number; endSpeedAlong: number; state: GameState; hitFrame: number } {
  const config = { game: 'frankenrun', map: prep.id, players: 2, bots: 0, seed: 1, tickRateHz: 30, version: 1 };
  let state: GameState = createGameState(config, prep);
  const press = (): GameInput[] => [{ ...DEFAULT_INPUT, present: true, ready: true, start: true }, { ...DEFAULT_INPUT, present: true, ready: true }];
  while (state.phase !== 'RACING') state = stepGame(state, press(), prep);
  // let the creature wander a little, then put the car on the road 9 m before it, driving at it
  for (let i = 0; i < 20; i += 1) state = stepGame(state, [{ ...DEFAULT_INPUT, present: true }, { ...DEFAULT_INPUT, present: true }], prep);
  const rm = prep.features.roamers[index]!;
  const at0 = roamerAt(rm, index, state.raceStart, state.frame);
  const ux = rm.dx, uz = rm.dz;
  const body = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
  const yaw = Math.atan2(ux, uz);
  const placed = { ...body, x: at0.x - ux * 9, z: at0.z - uz * 9, y: 0.6, vx: ux * 0.4, vy: 0, vz: uz * 0.4, orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } };
  state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [placed] }) };
  let minDist = Infinity, hitFrame = -1;
  let along = 0;
  for (let i = 0; i < 45; i += 1) {
    state = stepGame(state, [{ ...DEFAULT_INPUT, present: true, throttle: 100 }, { ...DEFAULT_INPUT, present: true }], prep);
    const b = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
    const at = roamerAt(rm, index, state.raceStart, state.frame);
    const d = Math.hypot(b.x - at.x, b.z - at.z);
    if (d < minDist) minDist = d;
    along = (b.vx * ux + b.vz * uz) * 30;
    if (hitFrame < 0 && d < 3.2) hitFrame = i;
  }
  void SALT_FRAME;
  return { minDist, endSpeedAlong: along, state, hitFrame };
}

for (const [kind, name] of [[0, 'zombie'], [2, 'pumpkin walker'], [1, 'ghost']] as const) {
  const where = kindsSeen[kind];
  if (where === undefined) continue;
  const prep = getPreparedMap(where.map);
  const real = meet(prep, where.index);
  // the same meeting with the creatures taken away: the car should simply drive through the spot
  const without = meet({ ...prep, features: { ...prep.features, roamers: prep.features.roamers.map((r, i) => (i === where.index ? r : { ...r, x: 1e6, z: 1e6 })) } }, where.index);
  const p0 = real.state.players[0]!;
  console.log(`${name}: closest ${real.minDist.toFixed(2)} m, speed along the road at the end ${real.endSpeedAlong.toFixed(1)} m/s (${where.map} #${where.index})`);
  if (kind === 0) {
    check(real.minDist > 1.2, 'a zombie blocks the way (the car cannot drive through it)');
    check(real.endSpeedAlong < without.endSpeedAlong - 3 || real.endSpeedAlong < 4, 'a zombie stops the car');
  } else if (kind === 2) {
    check(real.minDist > 1.5, 'a pumpkin walker blocks the way');
    check(real.endSpeedAlong < 2, 'a pumpkin walker bounces the car back');
  } else {
    check(real.minDist < 2.4, 'a ghost does not stop the car (it passes through)');
    check(p0.chillUntil > real.state.frame - 60 || p0.spookUntil > real.state.frame - 60, 'a ghost chills or spooks the car');
  }
}

// A pumpkin stomp: standing next to a pumpkin walker when it stomps shoves and slows the monster.
{
  const where = kindsSeen[2];
  if (where !== undefined) {
    const prep = getPreparedMap(where.map);
    const config = { game: 'frankenrun', map: prep.id, players: 2, bots: 0, seed: 1, tickRateHz: 30, version: 1 };
    let state: GameState = createGameState(config, prep);
    const press = (): GameInput[] => [{ ...DEFAULT_INPUT, present: true, ready: true, start: true }, { ...DEFAULT_INPUT, present: true, ready: true }];
    while (state.phase !== 'RACING') state = stepGame(state, press(), prep);
    const rm = prep.features.roamers[where.index]!;
    // wait until just before a stomp, then place the car 5 m from the pumpkin, standing still
    while (stompIn(where.index, state.raceStart, state.frame + 1) !== 3) state = stepGame(state, [{ ...DEFAULT_INPUT, present: true }, { ...DEFAULT_INPUT, present: true }], prep);
    const at = roamerAt(rm, where.index, state.raceStart, state.frame);
    const body = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
    state = { ...state, physics: applyDeterministicWorldEdit3D(state.physics, { replace: [{ ...body, x: at.x + rm.dx * 5, z: at.z + rm.dz * 5, y: 0.6, vx: 0, vy: 0, vz: 0 }] }) };
    for (let i = 0; i < 14; i += 1) state = stepGame(state, [{ ...DEFAULT_INPUT, present: true }, { ...DEFAULT_INPUT, present: true }], prep);
    const after = deterministicPhysicsBodyById3D(state.physics, carId(0))!;
    const moved = Math.hypot(after.x - (at.x + rm.dx * 5), after.z - (at.z + rm.dz * 5));
    check(moved > 0.5, `a pumpkin stomp shoves a monster 5 m away (${moved.toFixed(1)} m)`);
    check(state.players[0]!.slowUntil > state.frame, 'a pumpkin stomp slows the monster');
  }
}
void GHOST_AURA_M;

for (const mapId of ['route1', 'london-westminster-soho']) {
  const prep = getPreparedMap(mapId);
  const config = { game: 'frankenrun', map: mapId, players: 4, bots: 3, seed: 1, tickRateHz: 30, version: 1 };
  let state: GameState = createGameState(config, prep);
  const items = new Map<number, number>();
  const kinds = new Set<number>();
  for (let f = 0; f < 200 * 30; f += 1) {
    const human: GameInput = state.phase === 'BUILD' ? { ...DEFAULT_INPUT, present: true, ready: true, start: true } : { ...DEFAULT_INPUT, present: true };
    state = stepGame(state, [human, DEFAULT_INPUT, DEFAULT_INPUT, DEFAULT_INPUT], prep);
    if (state.phase !== 'RACING') continue;
    for (const e of state.events) kinds.add(e.kind);
    for (const p of state.players) if (p.itemTick === state.frame) items.set(p.itemKind, (items.get(p.itemKind) ?? 0) + 1);
  }
  const opened = [...items.values()].reduce((a, b) => a + b, 0);
  const view = projectGame(state, prep);
  console.log(`${mapId}: ${opened} boxes opened (${[...items].map(([k, n]) => `${k}x${n}`).join(' ')}), events seen: ${[...kinds].join(',')}`);
  check(opened > 0, `${mapId}: bots open mystery boxes`);
  check(kinds.size >= 1, `${mapId}: street events happen`);
  check(view.boxReady.length === prep.features.boxes.length, `${mapId}: projection carries box state`);
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
