// Boost pads and oil: node scripts/run-ts.mjs scripts/features-test.ts
// Placement is sane on every route, and in a bot race the bots really get faster over pads and slower on oil.
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { featureAt } from '../src/sim/features.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
let failures = 0;
const check = (ok: boolean, what: string): void => {
  console.log(ok ? 'ok  ' : 'FAIL', what);
  if (!ok) failures += 1;
};

for (const id of ['route1', 'osu-backstreets', 'cantonments', 'jamestown', 'ring-sprint']) {
  const prep = getPreparedMap(id);
  const { pads, oils } = prep.features;
  const stops = [{ x: prep.map.start.x / 10, z: prep.map.start.z / 10 }, ...prep.checkpoints];
  const clear = [...pads, ...oils].every((f) => stops.every((s) => Math.hypot(s.x - f.x, s.z - f.z) > 25));
  const onRoad = pads.every((f) => prep.onRoad(f.x, f.z)) && oils.every((f) => prep.onRoad(f.x, f.z));
  check(pads.length >= 4 && oils.length >= 4, `${id}: ${pads.length} pads and ${oils.length} oil patches`);
  check(clear, `${id}: none sits on the start or a checkpoint`);
  check(onRoad, `${id}: all of them are on the road`);
}

const mapId = 'route1';
const prep = getPreparedMap(mapId);
const config = { game: 'frankenrun', map: mapId, players: 4, bots: 3, seed: 1, tickRateHz: 30, version: 1 };
// The same bot race twice: with the pads and oil, and with them switched off. Speeds are compared at the same places.
function race(withFeatures: boolean): { pad: number[]; oil: number[]; crates: number } {
  const usePrep = withFeatures ? prep : { ...prep, features: { pads: [], oils: [], crates: [] } };
  let state: GameState = createGameState(config, usePrep);
  const pad: number[] = [], oil: number[] = [];
  const seen = new Set<number>();
  for (let f = 0; f < 150 * 30; f += 1) {
    const human: GameInput = state.phase === 'BUILD' ? { ...DEFAULT_INPUT, present: true, ready: true, start: true } : { ...DEFAULT_INPUT, present: true };
    state = stepGame(state, [human, DEFAULT_INPUT, DEFAULT_INPUT, DEFAULT_INPUT], usePrep);
    if (state.phase !== 'RACING') continue;
    for (const pk of state.pickups) if (pk.owner === -1) seen.add(pk.id);
    for (const p of projectGame(state, usePrep).players) {
      if (p.slot === 0 || p.finishTick >= 0) continue;
      const kmh = p.speed * 3.6;
      if (featureAt(prep.features.pads, p.x, p.z)) pad.push(kmh);
      else if (featureAt(prep.features.oils, p.x, p.z)) oil.push(kmh);
    }
  }
  return { pad, oil, crates: seen.size };
}
const avg = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length);
const on = race(true), off = race(false);
console.log(`on a pad: ${avg(on.pad).toFixed(0)} km/h with pads, ${avg(off.pad).toFixed(0)} without (${on.pad.length}/${off.pad.length} samples)`);
console.log(`on oil: ${avg(on.oil).toFixed(0)} km/h with oil, ${avg(off.oil).toFixed(0)} without (${on.oil.length}/${off.oil.length} samples)`);
check(on.crates > 0 && off.crates === 0, `loose parts appear on the road (${on.crates} in 150 s)`);
check(on.pad.length > 0, 'bots drive over pads');
check(avg(on.pad) > avg(off.pad) * 1.08, 'speed on a pad is clearly above the same spot without pads');
check(on.oil.length === 0 || avg(on.oil) <= avg(off.oil) * 1.02, 'oil does not speed anyone up');
if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all feature checks pass');
