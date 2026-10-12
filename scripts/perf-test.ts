// Measures sim cost per tick on a baked map with 2 players driving:  npm run test:perf
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
import { loadBakedMaps } from './lib/load-maps.ts';

loadBakedMaps();
const mapId = process.env['MAP'] ?? 'route1';
const prep = getPreparedMap(mapId);
const config = { game: 'frankenrun', map: mapId, players: 2, seed: 1, tickRateHz: 30, version: 1 };
let state: GameState = createGameState(config, prep);
const input = (): GameInput => (state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true } : { ...DEFAULT_INPUT, throttle: 100, steer: 20 });
const times: number[] = [];
const frames = Number(process.env['FRAMES'] ?? 600);
for (let f = 0; f < frames; f += 1) {
  const t0 = performance.now();
  state = stepGame(state, [input(), input()], prep);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const avg = times.reduce((s, t) => s + t, 0) / times.length;
const p = (q: number): number => times[Math.floor(q * (times.length - 1))]!;
const bodies = state.physics.bodies.length;
console.log(`${mapId}: bodies ${bodies}, static children ${prep.map.buildings.filter((b) => b.hulls?.[0]).length} bldg hulls, ${prep.map.walls.length} walls, ${prep.anchors.length} anchors`);
console.log(`ms/tick avg ${avg.toFixed(2)}  p50 ${p(0.5).toFixed(2)}  p95 ${p(0.95).toFixed(2)}  max ${p(1).toFixed(2)}   (budget at 30 Hz: 33.3 ms)`);
const v = projectGame(state, prep).players[0]!;
console.log(`car0 at ${v.x.toFixed(0)},${v.z.toFixed(0)} speed ${(v.speed * 3.6).toFixed(0)} km/h phase ${state.phase}`);
