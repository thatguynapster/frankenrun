// Mystery boxes, street events and roamers: node scripts/run-ts.mjs scripts/events-test.ts
// Placement is sane on every route, and in a bot race the boxes get opened, events happen and creatures bump racers.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { roamerAt } from '../src/sim/features.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';
import { ROUTES } from '../src/routes.ts';

loadBakedMaps();
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

for (const r of ROUTES) {
  const prep = getPreparedMap(r.id);
  const { boxes, roamers } = prep.features;
  const stops = [{ x: prep.map.start.x / 10, z: prep.map.start.z / 10 }, ...prep.checkpoints];
  const clear = [...boxes, ...roamers].every((f) => stops.every((s) => Math.hypot(s.x - f.x, s.z - f.z) > 25));
  const onRoad = boxes.every((f) => prep.onRoad(f.x, f.z));
  check(boxes.length >= 5, `${r.id}: ${boxes.length} mystery boxes, ${roamers.length} roamers`);
  check(clear, `${r.id}: none sits on the start or a checkpoint`);
  check(onRoad, `${r.id}: all boxes are on the road`);
}

for (const mapId of ['route1', 'london-westminster-soho']) {
  const prep = getPreparedMap(mapId);
  const config = { game: 'frankenrun', map: mapId, players: 4, bots: 3, seed: 1, tickRateHz: 30, version: 1 };
  let state: GameState = createGameState(config, prep);
  const items = new Map<number, number>();
  const kinds = new Set<number>();
  const slowed = new Set<number>();
  let bumps = 0;
  for (let f = 0; f < 200 * 30; f += 1) {
    const human: GameInput = state.phase === 'BUILD' ? { ...DEFAULT_INPUT, present: true, ready: true, start: true } : { ...DEFAULT_INPUT, present: true };
    const before = state;
    state = stepGame(state, [human, DEFAULT_INPUT, DEFAULT_INPUT, DEFAULT_INPUT], prep);
    if (state.phase !== 'RACING') continue;
    for (const e of state.events) kinds.add(e.kind);
    for (const p of state.players) {
      if (p.itemTick === state.frame) items.set(p.itemKind, (items.get(p.itemKind) ?? 0) + 1);
      if (p.bumpUntil > before.frame && p.bumpUntil - state.frame === 39) bumps += 1;
      if (state.frame < p.slowUntil) slowed.add(p.slot);
    }
  }
  const opened = [...items.values()].reduce((a, b) => a + b, 0);
  const view = projectGame(state, prep);
  console.log(`${mapId}: ${opened} boxes opened (${[...items].map(([k, n]) => `${k}x${n}`).join(' ')}), events seen: ${[...kinds].join(',')}, roamer bumps: ${bumps}, slowed racers: ${slowed.size}`);
  check(opened > 0, `${mapId}: bots open mystery boxes`);
  check(kinds.size >= 1, `${mapId}: street events happen`);
  check(view.boxReady.length === prep.features.boxes.length, `${mapId}: projection carries box state`);
  const a = roamerAt(prep.features.roamers[0]!, 0, 100, 10), b = roamerAt(prep.features.roamers[0]!, 0, 100, 10);
  check(a.x === b.x && a.z === b.z, 'roamer position is a pure function of the tick');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
