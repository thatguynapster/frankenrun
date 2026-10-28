// Straight-line and turning measurements for tuning:  node scripts/run-ts.mjs scripts/handling-probe.ts
import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';

import { getPreparedMap } from '../src/sim/world.ts';
const prep = getPreparedMap('greybox');
const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };

function run(label: string, legs: boolean, steer: number, seconds: number, steerAfter = 0) {
  let state: GameState = createGameState(config, prep);
  const input = (slot: number): GameInput => {
    if (state.phase === 'BUILD') return { ...DEFAULT_INPUT, ready: true, present: true, start: true, legsSel: legs ? 1 : 0, armsSel: 0, headSel: 0 };
    const t = raceStart < 0 ? 0 : (stateFrame - raceStart) / 30;
    return slot === 0 ? { ...DEFAULT_INPUT, legsSel: legs ? 1 : 0, throttle: 100, steer: t >= steerAfter ? steer : 0 } : DEFAULT_INPUT;
  };
  const samples: string[] = [];
  let raceStart = -1;
  let stateFrame = 0;
  for (let f = 0; f < 90 + 30 * seconds + 5; f++) {
    stateFrame = f;
    state = stepGame(state, [input(0), input(1)], prep);
    if (state.phase === 'RACING' && raceStart < 0) raceStart = f;
    if (raceStart >= 0 && (f - raceStart) % 30 === 29 && (f - raceStart) < 30 * seconds) {
      const p = projectGame(state, prep).players[0]!;
      samples.push(`${((f - raceStart + 1) / 30).toFixed(0)}s:${(p.speed * 3.6).toFixed(0)}kmh`);
    }
  }
  const p = projectGame(state, prep).players[0]!;
  const yaw = 2 * Math.atan2(p.qy, p.qw);
  console.log(label.padEnd(26), samples.join(' '), `| end x=${p.x.toFixed(0)} z=${p.z.toFixed(0)} yaw=${((yaw * 180) / Math.PI).toFixed(0)}deg`);
}



run('legs, full steer 5s', true, 100, 5);

run('legs, 3s straight+3s turn', true, 100, 6, 3);
run('nolegs, 3s straight+3s turn', false, 100, 6, 3);
