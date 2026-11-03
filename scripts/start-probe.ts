import { readFileSync } from 'node:fs';
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';
loadBakedMaps();
const prep = getPreparedMap('route1');
const { polyline } = JSON.parse(readFileSync('bake/cache/route1-corridor.json', 'utf8')) as { polyline: { x: number; z: number }[] };
console.log('start (map)', prep.map.start, 'yaw deg', (prep.startYaw * 180 / Math.PI).toFixed(1), 'poly[0]', polyline[0], 'poly[1]', polyline[1], 'poly[3]', polyline[3]);
console.log('slot0', prep.startPose(0), 'slot1', prep.startPose(1), 'cp1', prep.checkpoints[0], 'onRoad(slot0)', prep.onRoad(prep.startPose(0).x, prep.startPose(0).z));
const cfg = { game: 'frankenrun', map: 'route1', players: 2, seed: 1, tickRateHz: 30, version: 1 };
let state: GameState = createGameState(cfg, prep);
for (let f = 0; f < 90 + 30 * 8; f++) {
  state = stepGame(state, [{ ...DEFAULT_INPUT, ready: state.phase === 'BUILD', present: true, start: state.phase === 'BUILD', throttle: 100 }, { ...DEFAULT_INPUT, ready: state.phase === 'BUILD', present: true, start: state.phase === 'BUILD' }], prep);
  if (f % 30 === 0 && f > 80) { const v = projectGame(state, prep).players[0]!; console.log(f, state.phase, `pos ${v.x.toFixed(1)},${v.z.toFixed(1)} y ${v.y.toFixed(2)} speed ${(v.speed * 3.6).toFixed(0)} cells ${state.activeCells.length}`); }
}
