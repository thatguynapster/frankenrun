// Standstill pivot: node scripts/run-ts.mjs scripts/pivot-probe.ts
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { getPreparedMap } from '../src/sim/world.ts';
const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
function run(label: string, steer: number, throttle: number) {
  let state: GameState = createGameState(config, prep);
  let raceStart = -1;
  let yaw0 = 0;
  for (let f = 0; f < 90 + 1 * 30 + 5; f++) {
    const racing = state.phase === 'RACING';
    const input = (slot: number): GameInput =>
      state.phase === 'BUILD' ? { ...DEFAULT_INPUT, ready: true, legsSel: 1 } : slot === 0 && racing ? { ...DEFAULT_INPUT, legsSel: 1, throttle, steer } : DEFAULT_INPUT;
    state = stepGame(state, [input(0), input(1)], prep);
    if (state.phase === 'RACING' && raceStart < 0) { raceStart = f; const p = projectGame(state, prep).players[0]!; yaw0 = 2 * Math.atan2(p.qy, p.qw); }
  }
  const p = projectGame(state, prep).players[0]!;
  let d = (2 * Math.atan2(p.qy, p.qw) - yaw0) * 180 / Math.PI; d = ((d + 540) % 360) - 180;
  console.log(label.padEnd(24), `yaw change ${d.toFixed(0)}deg in 1s, speed ${(p.speed * 3.6).toFixed(1)} km/h, moved x=${p.x.toFixed(1)} z=${p.z.toFixed(1)}`);
}
run('steer +100, no throttle', 100, 0);
run('steer -100, no throttle', -100, 0);
run('steer +100, throttle', 100, 100);
run('no steer, brake(S)', 0, -100);
