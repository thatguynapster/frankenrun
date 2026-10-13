// Deterministic race simulation. Plain data in, plain data out: stepGame never mutates its
// input and never reads Math.random, Date, performance.now, the DOM or the network.
// Time is counted in ticks (TICK_RATE ticks = 1 s).

import {
  applyDeterministicForces3D,
  applyDeterministicImpulses3D,
  applyDeterministicWorldEdit3D,
  createDeterministicPhysicsWorld3D,
  deterministicPhysicsBodyById3D,
  stepDeterministicPhysicsWorld3D,
  stepDeterministicVehicle3D,
  type DeterministicPhysicsBody3D,
  type DeterministicPhysicsJoint3D,
  type DeterministicPhysicsWorld3D,
  type DeterministicVehicle3D,
  type DeterministicVehicleWheel3D,
} from '@series-inc/rundot-syncplay/creator';
import {
  ARMS,
  ARM_PARTS,
  BASE_ACCEL,
  BASE_TOP_SPEED,
  BODIES,
  CHASSIS_HALF,
  CHECKPOINT_RADIUS,
  COUNTDOWN_TICKS,
  FINISH_WINDOW_TICKS,
  GRAVITY_Y,
  HEADS,
  HEAD_PARTS,
  HIT_COOLDOWN_TICKS,
  HIT_MIN_CLOSING_MS,
  LEG_PARTS,
  MISSING_SLOT_MASS,
  MISSING_SLOT_SPEED,
  PICKUP_ARM_TICKS,
  PICKUP_LIFE_TICKS,
  PICKUP_OWNER_BLOCK_TICKS,
  PICKUP_RADIUS,
  WALL_HIT_MIN_CLOSING_MS,
  WALL_HIT_MIN_SPEED_MS,
  MASS_UNIT,
  RESET_FREEZE_TICKS,
  RESET_HOLD_TICKS,
  RIDE_HEIGHT,
  STEER_FADE_SPEED,
  PIVOT_SPEED,
  PIVOT_MIN_STEER,
  PIVOT_TORQUE,
  STEER_MIN_SCALE,
  TICK_RATE,
  type LegsDef,
} from './parts.js';
import type { PreparedMap } from './world.js';

export type Phase = 'BUILD' | 'COUNTDOWN' | 'RACING' | 'RESULTS';

/** One tick of player input. Build selections and ready are only read during BUILD. */
export interface GameInput {
  readonly throttle: number; // -100..100, negative = reverse
  readonly steer: number; // -100..100, positive = right
  readonly arms: boolean;
  readonly head: boolean;
  readonly legs: boolean;
  readonly reset: boolean;
  readonly ready: boolean;
  readonly bodySel: number; // index into BODIES
  readonly legsSel: number; // 0 none, else index into LEG_PARTS
  readonly armsSel: number; // 0 none, else index into ARM_PARTS
  readonly headSel: number; // 0 none, else index into HEAD_PARTS
}

export const DEFAULT_INPUT: GameInput = {
  throttle: 0,
  steer: 0,
  arms: false,
  head: false,
  legs: false,
  reset: false,
  ready: false,
  bodySel: 0,
  legsSel: 1,
  armsSel: 1,
  headSel: 1,
};

/** A monster: a body and one part id per slot (0 = empty slot). */
export interface Build {
  readonly body: number;
  readonly legs: number;
  readonly arms: number;
  readonly head: number;
}

export const DEFAULT_BUILD: Build = { body: 0, legs: 1, arms: 1, head: 1 };

export interface Swing {
  readonly pole: number;
  readonly maxLength: number;
  readonly ticksLeft: number;
}

export interface PlayerState {
  readonly slot: number;
  readonly build: Build;
  readonly ready: boolean;
  /** Index of the next checkpoint to hit; equals the checkpoint count once finished. */
  readonly nextCheckpoint: number;
  readonly finishTick: number; // -1 until finished
  readonly prevArms: boolean;
  readonly prevHead: boolean;
  readonly armsCooldown: number;
  readonly headCooldown: number;
  readonly trailLeft: number;
  readonly spinLeft: number;
  readonly swing: Swing | null;
  readonly resetHold: number;
  readonly frozenUntil: number;
  /** Hits taken since the last part fell off. */
  readonly hits: number;
  readonly hitCooldownUntil: number;
  readonly partsLost: number;
  readonly partsGained: number;
  readonly lastLossTick: number;
}

export type SlotKey = 'legs' | 'arms' | 'head';
const SLOT_KEYS: readonly SlotKey[] = ['legs', 'arms', 'head'];

/** A part lying in the world after it fell off a monster. */
export interface Pickup {
  readonly id: number;
  readonly slot: SlotKey;
  readonly part: number;
  readonly x: number;
  readonly z: number;
  readonly expires: number;
  /** Cannot be picked up before this tick. */
  readonly armedAt: number;
  /** The monster it fell off cannot pick it up again before this tick. */
  readonly owner: number;
  readonly ownerArmedAt: number;
}

export interface Slick {
  readonly x: number;
  readonly z: number;
  readonly expires: number;
  readonly owner: number;
}

export interface GameState {
  readonly frame: number;
  readonly phase: Phase;
  readonly phaseStart: number;
  readonly physics: DeterministicPhysicsWorld3D;
  readonly players: readonly PlayerState[];
  readonly slicks: readonly Slick[];
  readonly pickups: readonly Pickup[];
  readonly nextPickupId: number;
  readonly seed: number;
  readonly finishOrder: readonly number[];
  /** Sorted collision cells whose building colliders are currently loaded in the physics world. */
  readonly activeCells: readonly number[];
}

export interface SessionConfig {
  readonly game: string;
  /** Id of the map this room races on (a baked route, or 'greybox'). */
  readonly map: string;
  readonly players: number;
  readonly seed: number;
  readonly tickRateHz: number;
  readonly version: number;
}

export interface PlayerView {
  readonly slot: number;
  readonly build: Build;
  readonly ready: boolean;
  readonly present: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  readonly speed: number; // m/s
  readonly nextCheckpoint: number;
  readonly finishTick: number;
  readonly armsCooldown: number;
  readonly headCooldown: number;
  readonly swingPole: number; // -1 when not swinging
  readonly trailing: boolean;
  readonly partsLost: number;
  readonly partsGained: number;
  readonly lastLossTick: number;
}

export interface GameProjection {
  readonly frame: number;
  readonly phase: Phase;
  readonly phaseTicks: number; // ticks elapsed in the current phase
  readonly players: readonly PlayerView[];
  readonly slicks: readonly Slick[];
  readonly pickups: readonly Pickup[];
  readonly finishOrder: readonly number[];
  /** Collision cells whose colliders are currently loaded (for the collider debug view). */
  readonly activeCells: readonly number[];
}

const CAR_LAYER = 2;
const ANCHOR_ATTACH_HEIGHT = 2.6;
const ALL = 0xffffffff;

const carId = (slot: number): string => `car-${slot}`;
const ropeId = (slot: number): string => `rope-${slot}`;

const PIVOT_SPEED_SIGN = -1;
export const ARM_TENTACLES = 1;
export const HEAD_SLIME = 1;

const clampInt = (value: number, lo: number, hi: number): number => {
  const v = Math.round(value);
  return v < lo ? lo : v > hi ? hi : v;
};

/** Steering lock narrows with speed (per-tick velocity in, 0..1 out) so fast corners don't scrub speed. */
function steerScale(vx: number, vz: number): number {
  const speedMs = Math.hypot(vx, vz) * TICK_RATE;
  const scale = 1 - speedMs / STEER_FADE_SPEED;
  return scale < STEER_MIN_SCALE ? STEER_MIN_SCALE : scale;
}

function legsOf(build: Build): LegsDef {
  return LEG_PARTS[build.legs] ?? LEG_PARTS[0]!;
}

/** Total mass multiplier: body plus the weight of its parts. */
export function massOf(build: Build): number {
  const body = BODIES[build.body] ?? BODIES[0]!;
  const mass = body.mass + legsOf(build).mass + (ARM_PARTS[build.arms]?.mass ?? 0) + (HEAD_PARTS[build.head]?.mass ?? 0);
  return Math.max(0.3, mass - MISSING_SLOT_MASS * missingSlots(build));
}

/** Slots with nothing equipped (never chosen, or lost in the race). */
export function missingSlots(build: Build): number {
  return (build.legs === 0 ? 1 : 0) + (build.arms === 0 ? 1 : 0) + (build.head === 0 ? 1 : 0);
}

/** Top speed multiplier from empty slots (the comeback mechanic). */
function stripBonus(build: Build): number {
  return 1 + MISSING_SLOT_SPEED * missingSlots(build);
}

function chassisBody(slot: number, build: Build, x: number, z: number, yaw: number): DeterministicPhysicsBody3D {
  const body = BODIES[build.body] ?? BODIES[0]!;
  const legs = legsOf(build);
  const drive = BASE_ACCEL * body.accel * legs.driveMul;
  const topPerTick = (BASE_TOP_SPEED * legs.topSpeedMul * stripBonus(build)) / 30;
  const half = yaw / 2;
  return {
    id: carId(slot),
    kind: 'dynamic',
    x,
    y: RIDE_HEIGHT,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    mass: MASS_UNIT * massOf(build),
    // Linear damping is a per-tick velocity retention factor: top speed = accel / (1 - retention).
    linearDamping: 1 - drive / topPerTick,
    angularDamping: 0.93,
    orientation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
    angularVel: { x: 0, y: 0, z: 0 },
    shape: { type: 'box', halfX: CHASSIS_HALF.x, halfY: CHASSIS_HALF.y, halfZ: CHASSIS_HALF.z },
    layer: CAR_LAYER,
    mask: ALL,
    material: { friction: 0.3, restitution: 0.3 },
    callbackMask: 1, // collisionEnter events, which drive part loss
  };
}

function wheel(x: number, z: number, steered: boolean, grip: number, massRatio: number): DeterministicVehicleWheel3D {
  return {
    localAnchor: { x, y: -0.2, z },
    suspensionDir: { x: 0, y: -1, z: 0 },
    suspensionRestLength: 0.5,
    suspensionMaxTravel: 0.3,
    radius: 0.35,
    stiffness: 55 * massRatio,
    damping: 160 * massRatio,
    grip,
    maxSteerAngleTurns: 0.075,
    isSteered: steered,
    isDriven: true,
  };
}

function vehicleFor(slot: number, build: Build, gripMul: number, driveMul: number): DeterministicVehicle3D {
  const body = BODIES[build.body] ?? BODIES[0]!;
  const legs = legsOf(build);
  const grip = legs.gripMul * gripMul * body.turn;
  const massRatio = massOf(build);
  const wx = CHASSIS_HALF.x - 0.05;
  const wz = CHASSIS_HALF.z - 0.2;
  return {
    chassisId: carId(slot),
    driveForce: MASS_UNIT * massRatio * BASE_ACCEL * body.accel * legs.driveMul * driveMul,
    brakeForce: MASS_UNIT * massRatio * 0.02,
    wheels: [
      wheel(-wx, wz, true, grip, massRatio),
      wheel(wx, wz, true, grip, massRatio),
      wheel(-wx, -wz, false, grip, massRatio),
      wheel(wx, -wz, false, grip, massRatio),
    ],
  };
}

function newPlayer(slot: number): PlayerState {
  return {
    slot,
    build: DEFAULT_BUILD,
    ready: false,
    nextCheckpoint: 0,
    finishTick: -1,
    prevArms: false,
    prevHead: false,
    armsCooldown: 0,
    headCooldown: 0,
    trailLeft: 0,
    spinLeft: 0,
    swing: null,
    resetHold: 0,
    frozenUntil: 0,
    hits: 0,
    hitCooldownUntil: 0,
    partsLost: 0,
    partsGained: 0,
    lastLossTick: -1000,
  };
}

export function createGameState(config: SessionConfig, prep: PreparedMap): GameState {
  const players: PlayerState[] = [];
  for (let slot = 0; slot < config.players; slot += 1) players.push(newPlayer(slot));
  return {
    frame: 0,
    phase: 'BUILD',
    phaseStart: 0,
    physics: createDeterministicPhysicsWorld3D(prep.staticBodies),
    players,
    slicks: [],
    pickups: [],
    nextPickupId: 1,
    seed: config.seed,
    finishOrder: [],
    activeCells: [],
  };
}

function normaliseInput(input: GameInput | undefined): GameInput {
  if (input === undefined) return DEFAULT_INPUT;
  return {
    ...input,
    throttle: clampInt(input.throttle, -100, 100),
    steer: clampInt(input.steer, -100, 100),
    bodySel: clampInt(input.bodySel, 0, BODIES.length - 1),
    legsSel: clampInt(input.legsSel, 0, LEG_PARTS.length - 1),
    armsSel: clampInt(input.armsSel, 0, ARM_PARTS.length - 1),
    headSel: clampInt(input.headSel, 0, HEAD_PARTS.length - 1),
  };
}

function slickGripMul(slicks: readonly Slick[], x: number, z: number): number {
  const radius = HEADS.slime.slickRadius;
  for (const s of slicks) {
    if (Math.hypot(x - s.x, z - s.z) <= radius) return HEADS.slime.slickGripMul;
  }
  return 1;
}

function nearestAnchor(prep: PreparedMap, x: number, z: number, range: number): { index: number; distance: number } | null {
  let best: { index: number; distance: number } | null = null;
  for (let i = 0; i < prep.anchors.length; i += 1) {
    const a = prep.anchors[i]!;
    const d = Math.hypot(a.x - x, a.z - z);
    if (d <= range && (best === null || d < best.distance)) best = { index: i, distance: d };
  }
  return best;
}

function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/**
 * Keeps only the building colliders near the cars in the physics world (each car's cell and the 8 around
 * it). The wanted set depends only on car positions, so every client computes the same set; bodies are
 * added or dropped only for the cells that change when a car crosses into a new cell. This is what keeps the 30 Hz tick affordable on a dense city.
 */
function syncBuildings(
  world: DeterministicPhysicsWorld3D,
  prep: PreparedMap,
  players: readonly PlayerState[],
  active: readonly number[],
): { world: DeterministicPhysicsWorld3D; activeCells: readonly number[] } {
  const wanted = new Set<number>();
  for (const p of players) {
    const body = deterministicPhysicsBodyById3D(world, carId(p.slot));
    if (body === undefined) continue;
    const key = prep.cellOf(body.x, body.z);
    const cx = Math.floor(key / 4096), cz = key % 4096;
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) wanted.add((cx + dx) * 4096 + (cz + dz));
  }
  const next = [...wanted].sort((a, b) => a - b);
  if (next.length === active.length && next.every((k, i) => k === active[i])) return { world, activeCells: active };
  // One static body per cell, so a crossing only builds the few cells that came into range and drops the rest.
  const had = new Set(active), want = new Set(next);
  const add: DeterministicPhysicsBody3D[] = [];
  for (const key of next) {
    if (had.has(key)) continue;
    const body = prep.cellBody(key);
    if (body !== undefined) add.push(body);
  }
  const remove = active.filter((key) => !want.has(key) && deterministicPhysicsBodyById3D(world, `bld-${key}`) !== undefined).map((key) => `bld-${key}`);
  const edited = add.length > 0 || remove.length > 0 ? applyDeterministicWorldEdit3D(world, { add, remove }) : world;
  return { world: edited, activeCells: next };
}

/** Deterministic hash used for part-loss choices: depends only on the session seed, the tick and the monster. */
function hash32(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h ^ c, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

const slotOfCar = (id: string): number => (id.startsWith('car-') ? Number(id.slice(4)) : -1);

/** Same body, new mass and top speed for a changed build (position, velocity and spin are kept). */
function retuned(existing: DeterministicPhysicsBody3D, slot: number, build: Build): DeterministicPhysicsBody3D {
  const fresh = chassisBody(slot, build, 0, 0, 0);
  return { ...existing, mass: fresh.mass, linearDamping: fresh.linearDamping };
}

export function stepGame(state: GameState, rawInputs: readonly GameInput[], prep: PreparedMap): GameState {
  const frame = state.frame + 1;
  const inputs = state.players.map((p) => normaliseInput(rawInputs[p.slot]));
  let world = state.physics;
  let players = state.players;
  let slicks = state.slicks;
  let phase = state.phase;
  let phaseStart = state.phaseStart;
  let finishOrder = state.finishOrder;
  let activeCells = state.activeCells;

  if (phase === 'BUILD') {
    players = players.map((p, i) => {
      const input = inputs[i]!;
      return { ...p, ready: input.ready, build: { body: input.bodySel, legs: input.legsSel, arms: input.armsSel, head: input.headSel } };
    });
    if (players.length > 0 && players.every((p) => p.ready)) {
      world = applyDeterministicWorldEdit3D(world, {
        add: players.map((p) => {
          const pose = prep.startPose(p.slot);
          return chassisBody(p.slot, p.build, pose.x, pose.z, prep.startYaw);
        }),
      });
      phase = 'COUNTDOWN';
      phaseStart = frame;
    }
  } else if (phase === 'COUNTDOWN' && frame - phaseStart >= COUNTDOWN_TICKS) {
    phase = 'RACING';
    phaseStart = frame;
  }

  const driving = phase === 'COUNTDOWN' || phase === 'RACING' || phase === 'RESULTS';
  const racing = phase === 'RACING';
  const joints: DeterministicPhysicsJoint3D[] = [];
  const ropesToRemove: string[] = [];

  if (driving) {
    const impulses: { bodyId: string; impulse: { x: number; y: number; z: number }; worldPoint: { x: number; y: number; z: number } }[] = [];
    const torques: { bodyId: string; torque: { x: number; y: number; z: number } }[] = [];
    const respawns: DeterministicPhysicsBody3D[] = [];
    const newSlicks: Slick[] = [];

    players = players.map((player, i) => {
      const input = inputs[i]!;
      const body = deterministicPhysicsBodyById3D(world, carId(player.slot));
      if (body === undefined) return player;
      let p = player;

      // --- abilities (rising edge, ticks only) ---
      const armsEdge = input.arms && !p.prevArms;
      const headEdge = input.head && !p.prevHead;
      let armsCooldown = p.armsCooldown > 0 ? p.armsCooldown - 1 : 0;
      let headCooldown = p.headCooldown > 0 ? p.headCooldown - 1 : 0;
      let trailLeft = p.trailLeft;
      let spinLeft = p.spinLeft;
      let swing = p.swing;
      const frozen = !racing || frame < p.frozenUntil;

      if (racing && !frozen) {
        if (p.build.arms === ARM_TENTACLES && swing === null && armsEdge && armsCooldown === 0) {
          const hit = nearestAnchor(prep, body.x, body.z, ARMS.tentacles.grabRange);
          if (hit !== null) {
            swing = { pole: hit.index, maxLength: Math.max(hit.distance, 2), ticksLeft: ARMS.tentacles.swingTicks };
          } else {
            spinLeft = ARMS.tentacles.missSpinTicks;
            armsCooldown = ARMS.tentacles.missCooldownTicks;
          }
        } else if (swing !== null) {
          if (!input.arms || swing.ticksLeft <= 1) {
            ropesToRemove.push(ropeId(p.slot));
            swing = null;
            armsCooldown = ARMS.tentacles.cooldownTicks;
          } else {
            swing = { ...swing, ticksLeft: swing.ticksLeft - 1 };
          }
        }

        if (p.build.head === HEAD_SLIME && headEdge && headCooldown === 0 && trailLeft === 0) {
          trailLeft = HEADS.slime.trailTicks;
          headCooldown = HEADS.slime.cooldownTicks;
        }
        if (trailLeft > 0) {
          if ((HEADS.slime.trailTicks - trailLeft) % HEADS.slime.dropEveryTicks === 0) {
            newSlicks.push({
              x: body.x,
              z: body.z,
              expires: frame + HEADS.slime.slickLifeTicks,
              owner: p.slot,
            });
          }
          trailLeft -= 1;
        }
      }

      if (swing !== null) {
        const anchor = prep.anchors[swing.pole]!;
        joints.push({
          id: ropeId(p.slot),
          type: 'distance',
          a: carId(p.slot),
          b: 'anchors', // one static compound body; its origin is the world origin, so local = world
          anchorA: { x: 0, y: 0, z: 0 },
          anchorB: { x: anchor.x, y: ANCHOR_ATTACH_HEIGHT, z: anchor.z },
          maxLength: swing.maxLength,
        });
      }

      // --- reset ---
      let resetHold = p.resetHold;
      let frozenUntil = p.frozenUntil;
      if (racing && input.reset) {
        resetHold += 1;
        if (resetHold >= RESET_HOLD_TICKS) {
          resetHold = 0;
          const last = p.nextCheckpoint > 0 ? prep.checkpoints[p.nextCheckpoint - 1]! : prep.startPose(p.slot);
          const target = prep.checkpoints[Math.min(p.nextCheckpoint, prep.checkpoints.length - 1)]!;
          respawns.push(chassisBody(p.slot, p.build, last.x, last.z, yawToward(last.x, last.z, target.x, target.z)));
          frozenUntil = frame + RESET_FREEZE_TICKS;
          if (swing !== null) {
            ropesToRemove.push(ropeId(p.slot));
            swing = null;
          }
        }
      } else {
        resetHold = 0;
      }

      // --- vehicle controls ---
      const live = racing && frame >= frozenUntil && p.finishTick < 0; // a finished monster stops and brakes
      const gripMul = slickGripMul(state.slicks, body.x, body.z);
      const vehicle = vehicleFor(p.slot, p.build, gripMul, (prep.onRoad(body.x, body.z) ? 1 : legsOf(p.build).offRoadMul));
      // Pivot in place at a standstill so the monster can turn around when it is stuck: while it is nearly
      // stopped and steering hard it stops driving into the obstacle and spins on the spot instead.
      const speedMs = Math.hypot(body.vx, body.vz) * TICK_RATE;
      const pivoting = live && Math.abs(input.steer) >= PIVOT_MIN_STEER && speedMs < PIVOT_SPEED;
      const result = stepDeterministicVehicle3D(vehicle, {
        // No reverse: a negative throttle (S / down) is a brake instead.
        throttle: live && !pivoting ? clampInt(input.throttle / 10, 0, 10) : 0,
        steer: live ? clampInt((input.steer / 10) * steerScale(body.vx, body.vz), -10, 10) : 0,
        brake: live ? (input.throttle < 0 ? 10 : 0) : 10,
      }, world);
      for (const imp of result.impulses) {
        impulses.push({ bodyId: imp.bodyId, impulse: imp.impulse, worldPoint: imp.point });
      }
      if (pivoting) {
        const fade = Math.min(1, (1 - speedMs / PIVOT_SPEED) * 2.5); // full torque until 60% of the pivot speed
        torques.push({ bodyId: carId(p.slot), torque: { x: 0, y: PIVOT_SPEED_SIGN * (input.steer / 100) * fade * PIVOT_TORQUE * MASS_UNIT, z: 0 } });
      }
      if (spinLeft > 0) {
        torques.push({ bodyId: carId(p.slot), torque: { x: 0, y: ARMS.tentacles.missSpinTorque * MASS_UNIT * 0.001, z: 0 } });
        spinLeft -= 1;
      }

      p = {
        ...p,
        prevArms: input.arms,
        prevHead: input.head,
        armsCooldown,
        headCooldown,
        trailLeft,
        spinLeft,
        swing,
        resetHold,
        frozenUntil,
      };
      return p;
    });

    if (impulses.length > 0) world = applyDeterministicImpulses3D(world, impulses);
    if (torques.length > 0) world = applyDeterministicForces3D(world, torques);
    if (respawns.length > 0) world = applyDeterministicWorldEdit3D(world, { replace: respawns });
    if (ropesToRemove.length > 0) world = applyDeterministicWorldEdit3D(world, { removeJointIds: ropesToRemove });
    slicks = [...state.slicks.filter((s) => s.expires > frame), ...newSlicks];
  }

  if (driving) ({ world, activeCells } = syncBuildings(world, prep, players, activeCells));
  const preSpeed = new Map<number, number>();
  for (const p of players) {
    const b = deterministicPhysicsBodyById3D(world, carId(p.slot));
    if (b !== undefined) preSpeed.set(p.slot, Math.hypot(b.vx, b.vz) * TICK_RATE);
  }
  const stepped = stepDeterministicPhysicsWorld3D(world, { gravityY: GRAVITY_Y, dtTicks: 1, joints, computeChecksum: false });
  world = stepped.world;
  let pickups = state.pickups.filter((pk) => pk.expires > frame);
  let nextPickupId = state.nextPickupId;

  if (racing) {
    const finishedNow: number[] = [];
    players = players.map((p) => {
      if (p.finishTick >= 0) return p;
      const body = deterministicPhysicsBodyById3D(world, carId(p.slot));
      if (body === undefined) return p;
      const cp = prep.checkpoints[p.nextCheckpoint];
      if (cp === undefined) return p;
      if (Math.hypot(body.x - cp.x, body.z - cp.z) > CHECKPOINT_RADIUS) return p;
      const next = p.nextCheckpoint + 1;
      if (next >= prep.checkpoints.length) {
        finishedNow.push(p.slot);
        return { ...p, nextCheckpoint: next, finishTick: frame };
      }
      return { ...p, nextCheckpoint: next };
    });
    if (finishedNow.length > 0) finishOrder = [...finishOrder, ...finishedNow];

    // --- hits and part loss ---
    const hitAt = new Map<number, { x: number; z: number }>();
    const contacts = [...stepped.contacts]
      .filter((c) => c.type === 'enter' && !c.trigger)
      .sort((a, b) => (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0));
    for (const c of contacts) {
      const closing = (c.closingSpeed ?? 0) * TICK_RATE;
      const sa = slotOfCar(c.a), sb = slotOfCar(c.b);
      const point = { x: c.point?.x ?? 0, z: c.point?.z ?? 0 };
      if (sa >= 0 && sb >= 0) {
        if (closing >= HIT_MIN_CLOSING_MS) {
          hitAt.set(sa, point);
          hitAt.set(sb, point);
        }
      } else {
        const car = sa >= 0 ? sa : sb;
        if (car >= 0 && (preSpeed.get(car) ?? 0) >= WALL_HIT_MIN_SPEED_MS && closing >= WALL_HIT_MIN_CLOSING_MS) hitAt.set(car, point);
      }
    }
    const changed = new Set<number>();
    players = players.map((p) => {
      const point = hitAt.get(p.slot);
      if (point === undefined || p.finishTick >= 0 || frame < p.hitCooldownUntil) return p;
      const body = BODIES[p.build.body] ?? BODIES[0]!;
      const hits = p.hits + 1;
      const equipped = SLOT_KEYS.filter((k) => p.build[k] !== 0);
      if (hits < body.hitsToLose || equipped.length === 0) {
        return { ...p, hits: Math.min(hits, body.hitsToLose), hitCooldownUntil: frame + HIT_COOLDOWN_TICKS };
      }
      const lostSlot = equipped[hash32(state.seed, frame, p.slot) % equipped.length]!;
      pickups = [
        ...pickups,
        {
          id: nextPickupId,
          slot: lostSlot,
          part: p.build[lostSlot],
          x: point.x,
          z: point.z,
          expires: frame + PICKUP_LIFE_TICKS,
          armedAt: frame + PICKUP_ARM_TICKS,
          owner: p.slot,
          ownerArmedAt: frame + PICKUP_OWNER_BLOCK_TICKS,
        },
      ];
      nextPickupId += 1;
      changed.add(p.slot);
      return { ...p, build: { ...p.build, [lostSlot]: 0 }, hits: 0, hitCooldownUntil: frame + HIT_COOLDOWN_TICKS, partsLost: p.partsLost + 1, lastLossTick: frame };
    });

    // --- pickups: driving through one fills an empty slot ---
    if (pickups.length > 0) {
      const taken = new Set<number>();
      players = players.map((p) => {
        if (p.finishTick >= 0) return p;
        const body = deterministicPhysicsBodyById3D(world, carId(p.slot));
        if (body === undefined) return p;
        let q = p;
        for (const pk of pickups) {
          if (taken.has(pk.id) || q.build[pk.slot] !== 0) continue;
          if (frame < pk.armedAt || (pk.owner === q.slot && frame < pk.ownerArmedAt)) continue;
          if (Math.hypot(body.x - pk.x, body.z - pk.z) > PICKUP_RADIUS) continue;
          taken.add(pk.id);
          q = { ...q, build: { ...q.build, [pk.slot]: pk.part }, partsGained: q.partsGained + 1 };
        }
        if (q !== p) changed.add(q.slot);
        return q;
      });
      if (taken.size > 0) pickups = pickups.filter((pk) => !taken.has(pk.id));
    }

    // A changed build changes mass and top speed: retune each affected body, and drop abilities that lost their part.
    if (changed.size > 0) {
      const edits: DeterministicPhysicsBody3D[] = [];
      const ropes: string[] = [];
      const lostSwing = new Set<number>();
      const lostTrail = new Set<number>();
      for (const slot of [...changed].sort((a, b) => a - b)) {
        const cur = players[slot]!;
        const body = deterministicPhysicsBodyById3D(world, carId(slot));
        if (body !== undefined) edits.push(retuned(body, slot, cur.build));
        if (cur.swing !== null && cur.build.arms !== ARM_TENTACLES) {
          ropes.push(ropeId(slot));
          lostSwing.add(slot);
        }
        if (cur.trailLeft > 0 && cur.build.head !== HEAD_SLIME) lostTrail.add(slot);
      }
      if (lostSwing.size > 0 || lostTrail.size > 0) {
        players = players.map((pl) => ({
          ...pl,
          swing: lostSwing.has(pl.slot) ? null : pl.swing,
          trailLeft: lostTrail.has(pl.slot) ? 0 : pl.trailLeft,
        }));
      }
      world = applyDeterministicWorldEdit3D(world, { replace: edits, removeJointIds: ropes });
    }
    const allDone = players.every((p) => p.finishTick >= 0);
    const firstFinish = finishOrder.length > 0 ? players[finishOrder[0]!]!.finishTick : -1;
    if (allDone || (firstFinish >= 0 && frame - firstFinish >= FINISH_WINDOW_TICKS)) {
      phase = 'RESULTS';
      phaseStart = frame;
    }
  }

  return { frame, phase, phaseStart, physics: world, players, slicks, pickups, nextPickupId, seed: state.seed, finishOrder, activeCells };
}

export function projectGame(state: GameState, prep: PreparedMap): GameProjection {
  const players: PlayerView[] = state.players.map((p) => {
    const body = deterministicPhysicsBodyById3D(state.physics, carId(p.slot));
    const present = body !== undefined;
    const pose = present
      ? {
          x: body.x,
          y: body.y,
          z: body.z,
          qx: body.orientation?.x ?? 0,
          qy: body.orientation?.y ?? 0,
          qz: body.orientation?.z ?? 0,
          qw: body.orientation?.w ?? 1,
          speed: Math.hypot(body.vx, body.vz) * 30,
        }
      : { ...prep.startPose(p.slot), y: RIDE_HEIGHT, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0 };
    return {
      slot: p.slot,
      build: p.build,
      ready: p.ready,
      present,
      ...pose,
      nextCheckpoint: p.nextCheckpoint,
      finishTick: p.finishTick,
      armsCooldown: p.armsCooldown,
      headCooldown: p.headCooldown,
      swingPole: p.swing === null ? -1 : p.swing.pole,
      trailing: p.trailLeft > 0,
      partsLost: p.partsLost,
      partsGained: p.partsGained,
      lastLossTick: p.lastLossTick,
    };
  });
  return {
    frame: state.frame,
    phase: state.phase,
    phaseTicks: state.frame - state.phaseStart,
    players,
    slicks: state.slicks,
    pickups: state.pickups,
    finishOrder: state.finishOrder,
    activeCells: state.activeCells,
  };
}

/** Readable stats for a build (build screen bars). Same formulas the vehicle uses. */
export function buildStats(build: Build): { topKmh: number; accel: number; grip: number; mass: number; hits: number } {
  const body = BODIES[build.body] ?? BODIES[0]!;
  const legs = legsOf(build);
  return {
    topKmh: Math.round(BASE_TOP_SPEED * legs.topSpeedMul * stripBonus(build) * 3.6),
    accel: body.accel * legs.driveMul,
    grip: (body.turn / BODIES[0]!.turn) * legs.gripMul,
    mass: massOf(build),
    hits: body.hitsToLose,
  };
}
