import { createGameState, stepGame, projectGame, DEFAULT_INPUT, type GameInput, type GameState } from '../src/sim/game.ts';
import { CHECKPOINTS } from '../src/sim/track.ts';
import { getPreparedMap } from '../src/sim/world.ts';
const prep = getPreparedMap('greybox');

const config = { game: 'frankenrun', map: 'greybox', players: 2, seed: 1, tickRateHz: 30, version: 1 };
const pilot = (state: GameState, slot: number, useAbilities: boolean): GameInput => {
  const view = projectGame(state, prep).players[slot]!;
  if (state.phase === 'BUILD') return { ...DEFAULT_INPUT, ready: true, present: true, start: true };
  const target = CHECKPOINTS[Math.min(view.nextCheckpoint, CHECKPOINTS.length - 1)]!;
  // forward vector from quaternion (yaw only approx)
  const yaw = 2 * Math.atan2(view.qy, view.qw);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dx = target.x - view.x, dz = target.z - view.z;
  const cross = fz * dx - fx * dz; // + => target is to the right of heading? sign tuned below
  const dot = fx * dx + fz * dz;
  const err = Math.atan2(cross, dot);
  const steer = Math.max(-100, Math.min(100, Math.round(err * 140)));
  return { ...DEFAULT_INPUT, throttle: 100, steer: Number(process.env.SIGN ?? 1) * steer, arms: useAbilities && state.frame % 90 < 20, head: useAbilities && state.frame % 200 < 3 };
};

let state = createGameState(config, prep);
const t0 = Date.now();
for (let f = 0; f < 30 * 70; f++) {
  state = stepGame(state, [pilot(state, 0, true), pilot(state, 1, false)], prep);
  if (f % 60 === 0 || state.phase === 'RESULTS') {
    const v = projectGame(state, prep);
    console.log(f, state.phase, v.players.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)} v${p.speed.toFixed(1)} cp${p.nextCheckpoint}${p.swingPole >= 0 ? ' swing' : ''}`).join(' | '));
  }
  if (state.phase === 'RESULTS') break;
}
console.log('order', state.finishOrder, 'finish ticks', state.players.map((p) => p.finishTick), 'ms', Date.now() - t0);
