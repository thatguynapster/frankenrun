// AI racers. A bot is an ordinary player slot whose input is worked out by the simulation itself from the game state, so
// it is deterministic and the same on every client (a bot can fill an empty seat in an online room as well as a practice
// race). It follows the route's centre line with pure pursuit, slows for bends, recovers when it is wedged, and uses its
// parts: Crab Claws on a rival ahead, Slime Gland on a rival behind.

import { deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
import { ARM_CLAWS, DEFAULT_INPUT, HEAD_SLIME, NEW_BRAIN, carId, findGrabTarget, hash32, type Brain, type GameInput, type GameState } from './game.js';
import { TIP_TICKS } from './parts.js';
import type { PreparedMap } from './world.js';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The body a bot picks for a race: varied from race to race and from bot to bot, never the stump-legged one. */
function chooseBuild(state: GameState, slot: number): Pick<GameInput, 'bodySel' | 'legsSel' | 'armsSel' | 'headSel'> {
  const seed = state.seed + state.phaseStart;
  return {
    bodySel: hash32(seed, slot, 1) % 2,
    legsSel: 1 + (hash32(seed, slot, 2) % 2),
    armsSel: hash32(seed, slot, 3) % 3,
    headSel: hash32(seed, slot, 4) % 3,
  };
}

/** This bot's input for the coming tick, and its updated memory. */
export function botInput(state: GameState, prep: PreparedMap, slot: number, frame: number): { input: GameInput; brain: Brain } {
  const player = state.players[slot]!;
  const brain = player.brain;
  const base: GameInput = { ...DEFAULT_INPUT, present: true, ready: true, ...chooseBuild(state, slot) };
  if (state.phase !== 'RACING') return { input: base, brain: state.phase === 'BUILD' ? NEW_BRAIN : brain };
  const body = deterministicPhysicsBodyById3D(state.physics, carId(slot));
  if (body === undefined || player.finishTick >= 0 || !player.inRace) return { input: base, brain };

  const route = prep.map.route;
  const n = route === undefined ? 0 : route.length / 2;
  const point = (i: number): { x: number; z: number } => (n === 0 ? prep.checkpoints[Math.min(prep.checkpoints.length - 1, player.nextCheckpoint)]! : { x: route![i * 2]! / 10, z: route![i * 2 + 1]! / 10 });

  const speed = Math.hypot(body.vx, body.vz) * 30;
  const yaw = 2 * Math.atan2(body.orientation?.y ?? 0, body.orientation?.w ?? 1);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);

  // progress along the route: the nearest route point just ahead of where it has got to
  let index = brain.index;
  if (n > 0) {
    let best = index, bestD = Infinity;
    for (let i = Math.max(0, index - 2); i < Math.min(n, index + 24); i += 1) {
      const p = point(i);
      const d = Math.hypot(p.x - body.x, p.z - body.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    index = Math.max(index, best);
  }

  // each bot has its own pace, so a pack spreads out instead of travelling as one
  const pace = 0.84 + 0.16 * (hash32(state.seed, slot, 99) / 4294967296);
  const lookAhead = n === 0 ? 0 : Math.round(clamp(3 + speed * 0.22, 4, 12));
  let target = point(n === 0 ? 0 : Math.min(n - 1, index + lookAhead));
  const cp = prep.checkpoints[player.nextCheckpoint];
  if (cp !== undefined && Math.hypot(cp.x - body.x, cp.z - body.z) < 40) target = cp; // aim straight at a close checkpoint
  const far = point(n === 0 ? 0 : Math.min(n - 1, index + lookAhead + 10));

  const angleTo = (t: { x: number; z: number }): number => {
    const dx = t.x - body.x, dz = t.z - body.z;
    return Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
  };
  const err = angleTo(target);
  const errFar = angleTo(far);
  const kmh = speed * 3.6;
  // How sharp is the sharpest bend coming up within braking distance? Slow down for it before reaching it.
  let bend = Math.abs(errFar);
  if (n > 2) {
    const heading = (k: number): number => {
      const p0 = point(Math.min(n - 2, k)), p1 = point(Math.min(n - 1, k + 1));
      return Math.atan2(p1.x - p0.x, p1.z - p0.z);
    };
    const h0 = heading(index);
    const reach = Math.round(4 + speed * 0.6);
    for (let j = 2; j <= reach; j += 2) {
      let d = Math.abs(heading(index + j) - h0);
      if (d > Math.PI) d = 2 * Math.PI - d;
      bend = Math.max(bend, d);
    }
  }
  const wanted = (bend > 1.2 ? 16 : bend > 0.8 ? 26 : bend > 0.5 ? 38 : bend > 0.3 ? 58 : 140) * pace;
  let steer = clamp(Math.round((err * 160) / 10) * 10, -100, 100);
  let throttle = Math.abs(err) > 0.7 ? 35 : kmh > wanted + 10 ? -60 : kmh > wanted ? 0 : 100;

  // not getting anywhere (wedged against something, or crawling along a wall): pivot on the spot and drive off, and when
  // that does not help for about 8 seconds, hold Reset like a person would
  const live = frame >= player.frozenUntil;
  const idle = index > brain.index || !live ? 0 : brain.idle + 1; // ticks without getting any further along the route
  let stuck = live && speed < 0.6 ? brain.stuck + 1 : speed > 2 || !live ? 0 : brain.stuck;
  let recover = brain.recover;
  let dir = brain.dir;
  if (recover > 0) {
    recover -= 1;
    steer = 100 * dir;
    throttle = recover > 20 ? 0 : 100;
  } else if (stuck > 45 || (idle > 90 && idle % 130 === 100)) {
    recover = 45;
    dir = hash32(state.seed, slot, frame) % 2 === 0 ? 1 : -1;
    stuck = 0;
  }
  const reset = false; // bots are rescued by the simulation instead (see rescuePose)

  // held in somebody's claws: swing the steering from side to side to break free
  if (player.grabbedBy >= 0) steer = Math.floor(frame / 4) % 2 === 0 ? 100 : -100;

  // parts
  let arms = false, head = false, slimeFwd = false;
  if (player.build.arms === ARM_CLAWS && player.armsCooldown === 0 && frame % 12 === slot % 12 && findGrabTarget(state.physics, state, frame, player, body).kind === 'rival') arms = true;
  if (player.build.head === HEAD_SLIME && player.headCooldown === 0 && frame % 15 === (slot * 4) % 15) {
    for (const other of state.players) {
      if (other.slot === slot || !other.inRace || other.finishTick >= 0) continue;
      const ob = deterministicPhysicsBodyById3D(state.physics, carId(other.slot));
      if (ob === undefined) continue;
      const dx = ob.x - body.x, dz = ob.z - body.z, d = Math.hypot(dx, dz);
      if (d < 4 || d > 16) continue;
      const along = (fx * dx + fz * dz) / d;
      if (along < -0.6) head = true; // a rival close behind: slime the road for it
    }
  }
  const getUp = player.tippedTicks >= TIP_TICKS;

  return {
    input: { ...base, throttle: clamp(throttle, -100, 100), steer, arms, head, slimeFwd, reset, getUp },
    brain: { index, stuck, idle, recover, resetFor: 0, dir },
  };
}

/** How long a bot may go without getting anywhere before it is put back on the route (ticks). */
export const BOT_RESCUE_TICKS = 270;

/** Where a lost bot is put back: on the route centre line a little further along, facing the way to go. */
export function rescuePose(prep: PreparedMap, index: number): { x: number; z: number; yaw: number } | undefined {
  const route = prep.map.route;
  if (route === undefined || route.length < 6) return undefined;
  const n = route.length / 2;
  const i = Math.min(n - 2, index + 12);
  const x = route[i * 2]! / 10, z = route[i * 2 + 1]! / 10;
  return { x, z, yaw: Math.atan2(route[i * 2 + 2]! / 10 - x, route[i * 2 + 3]! / 10 - z) };
}
