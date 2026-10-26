// Deterministic race simulation. Plain data in, plain data out: stepGame never mutates its
// input and never reads Math.random, Date, performance.now, the DOM or the network.
// Time is counted in ticks (TICK_RATE ticks = 1 s).

import { CRATE_PERIOD_TICKS, featureAt, OIL_GRIP_MUL, PAD_ACCEL } from './features.js';
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
  BLOB_GRAVITY,
  HEADS,
  CLAW_COOLDOWN_TICKS,
  CLAW_GRAB_RANGE,
  CLAW_GRAB_CONE_COS,
  CLAW_PICKUP_RANGE,
  CLAW_PICKUP_CONE_COS,
  CLAW_GRAB_TICKS,
  CLAW_GRAB_COOLDOWN,
  CLAW_MISS_COOLDOWN,
  CLAW_FREED_COOLDOWN,
  CLAW_PICKUP_COOLDOWN,
  STRUGGLE_FLIPS,
  GRAB_IMMUNE_TICKS,
  CLAW_REAR_COS,
  HEAD_PARTS,
  HIT_COOLDOWN_TICKS,
  HIT_MIN_CLOSING_MS,
  HIT_HEAVY_CLOSING_MS,
  GRAB_SHIELD_TICKS,
  LEG_PARTS,
  PRESENCE_TIMEOUT_TICKS,
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
  TIP_MIN_UP,
  TIP_TICKS,
  GETUP_FREEZE_TICKS,
  GETUP_COOLDOWN_TICKS,
  GETUP_HOP,
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
import { BOT_RESCUE_TICKS, botInput, rescuePose } from './bot.js';
import { CELL_M, type PreparedMap } from './world.js';

export type Phase = 'BUILD' | 'COUNTDOWN' | 'RACING' | 'RESULTS';

/** One tick of player input. Build selections and ready are only read during BUILD. */
export interface GameInput {
  readonly throttle: number; // -100..100, negative = reverse
  readonly steer: number; // -100..100, positive = right
  readonly arms: boolean;
  readonly head: boolean;
  /** With `head`: throw the slime ahead of the monster instead of behind it. */
  readonly slimeFwd: boolean;
  /** Host only, in the lobby: fill every empty seat with an AI racer (at the `botLevel` skill). */
  readonly fillBots: boolean;
  /** Host only, in the lobby: send the AI racers that were added this way home again. */
  readonly removeBots: boolean;
  /** Host only: how good the AI racers are, 0 easy, 1 normal, 2 hard. */
  readonly botLevel: number;
  readonly legs: boolean;
  readonly reset: boolean;
  /** Right a monster that has fallen on its side (only does anything while it is tipped over). */
  readonly getUp: boolean;
  readonly ready: boolean;
  /** Always true from a connected client: announces that this slot is occupied (an empty slot sends the neutral input). */
  readonly present: boolean;
  /** Host only: start the race (needs 2+ players in the lobby, all of them ready). */
  readonly start: boolean;
  /** Results screen (or a race you are not in): this player goes to the lobby for the next race. */
  readonly rematch: boolean;
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
  slimeFwd: false,
  fillBots: false,
  removeBots: false,
  botLevel: 1,
  legs: false,
  reset: false,
  getUp: false,
  ready: false,
  present: false,
  start: false,
  rematch: false,
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

/** What an AI racer remembers from tick to tick (see bot.ts). */
export interface Brain {
  /** How far along the route's centre line it has got (index of a route point). */
  readonly index: number;
  /** Ticks it has been nearly stationary while it should be moving. */
  readonly stuck: number;
  /** Ticks without getting any further along the route. */
  readonly idle: number;
  /** Ticks left of a get-unstuck manoeuvre. */
  readonly recover: number;
  /** Ticks left of holding Reset (a reset needs the button held for a while). */
  readonly resetFor: number;
  /** Which way it pivots when wedged (+1 or -1). */
  readonly dir: number;
}
export const NEW_BRAIN: Brain = { index: 0, stuck: 0, idle: 0, recover: 0, resetFor: 0, dir: 1 };

/** A Crab Claws grab in progress, on the grabber's side. */
export interface Grab {
  readonly target: number;
  readonly ticksLeft: number;
  /** The tether between the two monsters, in metres. */
  readonly maxLength: number;
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
  /** Hopper Haunches: ticks of charge held so far, the tick the next leap is allowed, and ticks since a leap while still in the air (0 = on the ground). */
  readonly hopCharge: number;
  readonly hopReadyAt: number;
  readonly hopAir: number;
  /** Hunchback Hump: the spare part being carried (slot and part id), if any. */
  readonly spare: { readonly slot: SlotKey; readonly part: number } | null;
  readonly armsCooldown: number;
  readonly headCooldown: number;
  readonly trailLeft: number;
  readonly spinLeft: number;
  readonly swing: Swing | null;
  /** Crab Claws: the rival this monster is holding. */
  readonly grab: Grab | null;
  /** AI racers only: what the bot remembers. */
  readonly brain: Brain;
  /** This seat was filled with an AI racer by the host (the last `bots` seats are always AI racers on top of this). */
  readonly isBot: boolean;
  /** Slot of the monster holding this one, or -1. */
  readonly grabbedBy: number;
  /** The monster this one last held, and until when the two are shielded from hurting each other. */
  readonly lastGrab: { readonly partner: number; readonly until: number } | null;
  /** Hard steering swings made while held; enough of them break free. */
  readonly struggle: number;
  readonly steerSign: number;
  readonly grabImmuneUntil: number;
  readonly resetHold: number;
  /** Consecutive ticks the monster has been tilted past upright. */
  readonly tippedTicks: number;
  readonly getUpReadyAt: number;
  readonly frozenUntil: number;
  /** Hits taken since the last part fell off. */
  readonly hits: number;
  readonly hitCooldownUntil: number;
  readonly partsLost: number;
  readonly partsGained: number;
  readonly partsStolen: number;
  readonly clawCooldownUntil: number;
  readonly lastLossTick: number;
  /** Latched on the results screen: this player left the results for the build screen. */
  readonly rematch: boolean;
  /** Frame this player's client was last heard from (presence). */
  readonly lastSeen: number;
  /** True for the monsters in the current race; players who are not (late joiners, or still on the results) only watch. */
  readonly inRace: boolean;
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

/** A glob of slime in the air: it rises out of a monster's head and falls, then becomes a slick on the road. */
export interface Blob {
  /** Metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Metres per tick. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly owner: number;
}

export interface GameState {
  readonly frame: number;
  readonly phase: Phase;
  readonly phaseStart: number;
  readonly physics: DeterministicPhysicsWorld3D;
  readonly players: readonly PlayerState[];
  readonly slicks: readonly Slick[];
  readonly blobs: readonly Blob[];
  readonly pickups: readonly Pickup[];
  readonly nextPickupId: number;
  readonly seed: number;
  /** Number of bot slots (the last ones). The race ends when every human has finished. */
  readonly bots: number;
  /** How good the AI racers are: 0 easy, 1 normal, 2 hard. */
  readonly botLevel: number;
  /** Frame the race started on (finish times are measured from here). */
  readonly raceStart: number;
  readonly finishOrder: readonly number[];
  /** Sorted collision cells whose building colliders are currently loaded in the physics world. */
  readonly activeCells: readonly number[];
}

export interface SessionConfig {
  readonly game: string;
  /** Id of the map this room races on (a baked route, or 'greybox'). */
  readonly map: string;
  readonly players: number;
  /** Bot slots at the end of the roster (practice); 0 in a real room. */
  readonly bots?: number;
  /** AI skill for the `bots` seats (0 easy, 1 normal, 2 hard). */
  readonly botLevel?: number;
  readonly seed: number;
  readonly tickRateHz: number;
  readonly version: number;
}

export interface PlayerView {
  readonly slot: number;
  readonly build: Build;
  readonly ready: boolean;
  readonly present: boolean;
  /** The player's client is in the room (or it is a bot). */
  readonly joined: boolean;
  readonly inRace: boolean;
  readonly host: boolean;
  readonly bot: boolean;
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
  /** Hopper Haunches: 0..1 of a full charge, ticks until the next leap, and whether the monster is mid-leap. */
  readonly hopCharge: number;
  readonly hopCooldown: number;
  readonly airborne: boolean;
  /** Hunchback Hump: the spare part in the sack. */
  readonly spare: { readonly slot: SlotKey; readonly part: number } | null;
  readonly swingPole: number; // -1 when not swinging
  /** Slot of the rival held in this monster's claws, or -1. */
  readonly grabbing: number;
  /** Slot of the monster holding this one, or -1. */
  readonly grabbedBy: number;
  readonly trailing: boolean;
  /** Fallen on its side and waiting for the Get up button. */
  readonly tipped: boolean;
  readonly partsLost: number;
  readonly partsGained: number;
  readonly partsStolen: number;
  readonly lastLossTick: number;
  readonly rematch: boolean;
}

export interface GameProjection {
  /** Id of the baked map (route) this room races on. */
  readonly mapId: string;
  readonly frame: number;
  readonly phase: Phase;
  readonly phaseTicks: number; // ticks elapsed in the current phase
  /** Frame the race started on; a finish time is finishTick - raceStart. */
  readonly raceStart: number;
  /** Slot of the host (the room's creator while they are present), or -1. */
  readonly hostSlot: number;
  readonly players: readonly PlayerView[];
  readonly slicks: readonly Slick[];
  readonly blobs: readonly Blob[];
  readonly pickups: readonly Pickup[];
  readonly finishOrder: readonly number[];
  /** Collision cells whose colliders are currently loaded (for the collider debug view). */
  readonly activeCells: readonly number[];
}

const CAR_LAYER = 2;
const ANCHOR_ATTACH_HEIGHT = 2.6;
const ALL = 0xffffffff;

export const carId = (slot: number): string => `car-${slot}`;
const ropeId = (slot: number): string => `rope-${slot}`;

const PIVOT_SPEED_SIGN = -1;
export const ARM_TENTACLES = 1;
export const ARM_CLAWS = 2;
export const LEGS_HOPPER = 3;
export const HEAD_HUMP = 3;
export const HEAD_SLIME = 1;
export const HEAD_LANTERN = 2;

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
    hopCharge: 0,
    hopReadyAt: 0,
    hopAir: 0,
    spare: null,
    armsCooldown: 0,
    headCooldown: 0,
    trailLeft: 0,
    spinLeft: 0,
    swing: null,
    grab: null,
    brain: NEW_BRAIN,
    isBot: false,
    grabbedBy: -1,
    lastGrab: null,
    struggle: 0,
    steerSign: 0,
    grabImmuneUntil: 0,
    resetHold: 0,
    tippedTicks: 0,
    getUpReadyAt: 0,
    frozenUntil: 0,
    hits: 0,
    hitCooldownUntil: 0,
    partsLost: 0,
    partsGained: 0,
    partsStolen: 0,
    clawCooldownUntil: 0,
    lastLossTick: -1000,
    rematch: false,
    lastSeen: -100000,
    inRace: false,
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
    blobs: [],
    pickups: [],
    nextPickupId: 1,
    seed: config.seed,
    bots: config.bots ?? 0,
    botLevel: config.botLevel ?? 1,
    raceStart: 0,
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

const BLOB_G_TICK = BLOB_GRAVITY / (TICK_RATE * TICK_RATE);

/** tan(60 degrees): spelled out so the throw never depends on a platform's trigonometry. */
const TAN_60 = 1.7320508075688772;

/**
 * Spits a blob out of a monster's head at a 60 degree angle, straight back (or straight ahead). It carries the monster's
 * own speed, and is thrown so it lands `blobBack` (or `blobAhead`) metres from the monster. Later this can take an
 * aim direction from the reticle instead of "back or ahead".
 */
function launchBlob(body: DeterministicPhysicsBody3D, owner: number, ahead: boolean): Blob {
  const o = body.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
  let fx = 2 * (o.x * o.z + o.w * o.y), fz = 1 - 2 * (o.x * o.x + o.y * o.y);
  const len = Math.hypot(fx, fz) || 1;
  const sign = ahead ? 1 : -1;
  fx = (fx / len) * sign;
  fz = (fz / len) * sign;
  const range = ahead ? HEADS.slime.blobAhead : HEADS.slime.blobBack;
  const y0 = body.y + 1.9; // out of the top of the head
  // Relative to the monster the blob moves at 60 degrees: vertical speed = TAN_60 x horizontal speed. Landing after
  // `flight` ticks at `range` metres away means y0 + range x TAN_60 = gravity x flight^2 / 2.
  const flight = Math.sqrt((2 * (y0 + range * TAN_60)) / BLOB_G_TICK);
  const horizontal = range / flight;
  return { x: body.x, y: y0, z: body.z, vx: body.vx + fx * horizontal, vy: horizontal * TAN_60, vz: body.vz + fz * horizontal, owner };
}

const grabId = (slot: number): string => `grab-${slot}`;

/**
 * What a claw can reach from where a monster stands: the nearest rival ahead (within range and a forward cone), else the
 * nearest loose part it has room for, else nothing. Later an aim direction from the reticle can replace "the nose".
 */
export function findGrabTarget(
  world: DeterministicPhysicsWorld3D,
  state: GameState,
  frame: number,
  me: PlayerState,
  body: DeterministicPhysicsBody3D,
): { kind: 'rival'; slot: number; distance: number } | { kind: 'part'; id: number } | { kind: 'none' } {
  const o = body.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
  let fx = 2 * (o.x * o.z + o.w * o.y), fz = 1 - 2 * (o.x * o.x + o.y * o.y);
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  let best: { slot: number; distance: number } | null = null;
  for (const other of state.players) {
    if (other.slot === me.slot || !other.inRace || other.finishTick >= 0 || other.grabbedBy >= 0 || frame < other.grabImmuneUntil) continue;
    const ob = deterministicPhysicsBodyById3D(world, carId(other.slot));
    if (ob === undefined) continue;
    const dx = ob.x - body.x, dz = ob.z - body.z, d = Math.hypot(dx, dz);
    if (d < 0.01 || d > CLAW_GRAB_RANGE || (fx * dx + fz * dz) / d < CLAW_GRAB_CONE_COS) continue;
    if (best === null || d < best.distance) best = { slot: other.slot, distance: d };
  }
  if (best !== null) return { kind: 'rival', slot: best.slot, distance: best.distance };
  let part: { id: number; distance: number } | null = null;
  for (const pk of state.pickups) {
    if (pk.expires <= frame || me.build[pk.slot] !== 0 || frame < pk.armedAt || (pk.owner === me.slot && frame < pk.ownerArmedAt)) continue;
    const dx = pk.x - body.x, dz = pk.z - body.z, d = Math.hypot(dx, dz);
    if (d < 0.01 || d > CLAW_PICKUP_RANGE || (fx * dx + fz * dz) / d < CLAW_PICKUP_CONE_COS) continue;
    if (part === null || d < part.distance) part = { id: pk.id, distance: d };
  }
  return part !== null ? { kind: 'part', id: part.id } : { kind: 'none' };
}

function slickGripMul(slicks: readonly Slick[], x: number, z: number, slot: number): number {
  const radius = HEADS.slime.slickRadius;
  for (const s of slicks) {
    if (s.owner === slot) continue; // a monster never skids on its own slime
    if (Math.hypot(x - s.x, z - s.z) <= radius) return HEADS.slime.slickGripMul;
  }
  return 1;
}

export function nearestAnchor(prep: PreparedMap, x: number, z: number, range: number): { index: number; distance: number } | null {
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
    // The car's own cell and the neighbour on the side it is nearer to, on each axis: a 2 x 2 block that always keeps at
    // least half a cell (10 m) of loaded ground on every side. Physics cost grows with the colliders loaded, and in a dense
    // city a 3 x 3 block held more than twice as many as the car could reach within a tick.
    const sx = body.x / CELL_M - Math.floor(body.x / CELL_M) < 0.5 ? -1 : 1;
    const sz = body.z / CELL_M - Math.floor(body.z / CELL_M) < 0.5 ? -1 : 1;
    for (const dx of [0, sx]) for (const dz of [0, sz]) wanted.add((cx + dx) * 4096 + (cz + dz));
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
export function hash32(a: number, b: number, c: number): number {
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

/** Rematch: back to the build phase in the same room (fresh world, same map and seed, nothing carried over). */
function restartState(state: GameState, frame: number, prep: PreparedMap): GameState {
  return {
    ...state,
    frame,
    phase: 'BUILD',
    phaseStart: frame,
    physics: createDeterministicPhysicsWorld3D(prep.staticBodies),
    // Everyone is back at the build screen; a player who had already readied up stays ready.
    players: state.players.map((p) => ({ ...newPlayer(p.slot), build: p.build, ready: p.ready, lastSeen: p.lastSeen, isBot: p.isBot })),
    slicks: [],
    blobs: [],
    pickups: [],
    nextPickupId: 1,
    finishOrder: [],
    activeCells: [],
    raceStart: 0,
  };
}

const buildOf = (input: GameInput): Build => ({ body: input.bodySel, legs: input.legsSel, arms: input.armsSel, head: input.headSel });

/** True for an AI racer: one of the last `bots` seats, or a seat the host filled. */
const isBotSeat = (p: PlayerState, humans: number): boolean => p.isBot || p.slot >= humans;

/** True while a player is in the room: bots always, humans while their client keeps announcing itself. */
function isHere(p: PlayerState, frame: number, humans: number): boolean {
  return isBotSeat(p, humans) || frame - p.lastSeen < PRESENCE_TIMEOUT_TICKS;
}

/** The host is the room's creator (slot 0, the first to join) while they are present, else the lowest present human. */
function hostSlotOf(players: readonly PlayerState[], frame: number, humans: number): number {
  for (const p of players) if (!isBotSeat(p, humans) && isHere(p, frame, humans)) return p.slot;
  return -1;
}

/** The host may start once at least 2 players (bots count) are in the lobby and every other human there is ready. */
function canStartRace(lobby: readonly PlayerState[], hostSlot: number, humans: number): boolean {
  return lobby.length >= 2 && lobby.some((p) => p.slot === hostSlot) && lobby.every((p) => p.slot === hostSlot || isBotSeat(p, humans) || p.ready);
}

/** Puts the given slots on the start grid (in order) and begins the countdown. Everyone else watches. */
function beginRace(s: GameState, frame: number, prep: PreparedMap, participants: readonly number[]): GameState {
  const physics = applyDeterministicWorldEdit3D(s.physics, {
    add: participants.map((slot, rank) => {
      const pose = prep.startPose(rank);
      return chassisBody(slot, s.players[slot]!.build, pose.x, pose.z, prep.startYaw);
    }),
  });
  return {
    ...s,
    frame,
    phase: 'COUNTDOWN',
    phaseStart: frame,
    physics,
    players: s.players.map((p) => ({ ...p, inRace: participants.includes(p.slot), rematch: false })),
  };
}

export function stepGame(state: GameState, rawInputs: readonly GameInput[], prep: PreparedMap): GameState {
  const frame = state.frame + 1;
  const humans = state.players.length - state.bots;
  // A person who arrives in a seat the host had filled with an AI racer takes it back (in the lobby, never mid-race).
  const lobbyNow = state.phase === 'BUILD' || state.phase === 'RESULTS';
  const reclaimed = state.players.map((p) => (p.isBot && p.slot < humans && lobbyNow && rawInputs[p.slot]?.present === true ? { ...p, isBot: false, brain: NEW_BRAIN, ready: false, lastSeen: frame } : p));
  const stateNow: GameState = reclaimed.some((p, i) => p !== state.players[i]) ? { ...state, players: reclaimed } : state;
  // AI racers are driven by the simulation itself, from the state, so every client agrees on them.
  const brains = new Map<number, Brain>();
  const inputs = stateNow.players.map((p) => {
    if (!isBotSeat(p, humans)) return normaliseInput(rawInputs[p.slot]);
    const bot = botInput(stateNow, prep, p.slot, frame);
    brains.set(p.slot, bot.brain);
    return normaliseInput(bot.input);
  });
  // Presence: a connected client announces itself every tick; an empty slot sends the neutral input.
  let seen = stateNow.players.map((p, i) => (!isBotSeat(p, humans) ? (inputs[i]!.present ? { ...p, lastSeen: frame } : p) : { ...p, brain: brains.get(p.slot) ?? p.brain }));
  const here = (p: PlayerState): boolean => isHere(p, frame, humans);
  const hostSlot = hostSlotOf(seen, frame, humans);
  const startPressed = hostSlot >= 0 && inputs[hostSlot]!.start;
  // The host fills the empty seats with AI racers, or sends the ones it added home again.
  let botLevel = stateNow.botLevel;
  if (lobbyNow && hostSlot >= 0) {
    const hostInput = inputs[hostSlot]!;
    if (hostInput.fillBots) {
      botLevel = hostInput.botLevel;
      seen = seen.map((p) => (here(p) ? p : { ...p, isBot: true, ready: true, brain: NEW_BRAIN }));
    } else if (hostInput.removeBots) {
      seen = seen.map((p) => (p.isBot ? { ...p, isBot: false, ready: false, brain: NEW_BRAIN, lastSeen: -100000 } : p));
    }
  }

  // Back to the lobby is each player's own choice: pressing Rematch (on the results, or while a race they are not in is
  // running) moves only that player to the build screen; their build and ready flag follow their input from then on.
  let basePlayers = seen;
  if (state.phase !== 'BUILD') {
    basePlayers = seen.map((p, i) => {
      if (isBotSeat(p, humans) || !here(p)) return p;
      const input = inputs[i]!;
      const mayLatch = state.phase === 'RESULTS' || !p.inRace;
      if (!mayLatch || !(p.rematch || input.rematch)) return p;
      return { ...p, rematch: true, ready: input.ready, build: buildOf(input) };
    });
  }
  if (state.phase === 'RESULTS') {
    const presentHumans = basePlayers.filter((p) => !isBotSeat(p, humans) && here(p));
    // Everyone who is here has come back: a fresh build phase for the whole room.
    if (presentHumans.length > 0 && presentHumans.every((p) => p.rematch)) return restartState({ ...stateNow, botLevel, players: basePlayers }, frame, prep);
    // The host does not have to wait for stragglers: start for those who are already in the lobby.
    const lobby = basePlayers.filter((p) => isBotSeat(p, humans) || (here(p) && p.rematch));
    if (startPressed && canStartRace(lobby, hostSlot, humans)) {
      const fresh = restartState({ ...stateNow, botLevel, players: basePlayers }, frame, prep);
      return beginRace(fresh, frame, prep, lobby.map((p) => p.slot));
    }
  }
  let world = state.physics;
  let players = basePlayers;
  let slicks = state.slicks;
  let blobs = state.blobs;
  /** Grabs that ran out of time this tick: the grabber steals a part (resolved with the other steals after the physics step). */
  const grabSteals: { attacker: number; victim: number }[] = [];
  /** Loose parts a claw reached for this tick: slot of the grabber -> pickup id. */
  const clawPickups = new Map<number, number>();
  let phase = state.phase;
  let phaseStart = state.phaseStart;
  let finishOrder = state.finishOrder;
  let activeCells = state.activeCells;
  let raceStart = state.raceStart;

  if (phase === 'BUILD') {
    players = players.map((p, i) => (here(p) ? { ...p, ready: inputs[i]!.ready, build: buildOf(inputs[i]!) } : p));
    const lobby = players.filter(here);
    if (startPressed && canStartRace(lobby, hostSlot, humans)) {
      return beginRace({ ...stateNow, botLevel, players }, frame, prep, lobby.map((p) => p.slot));
    }
  } else if (phase === 'COUNTDOWN' && frame - phaseStart >= COUNTDOWN_TICKS) {
    phase = 'RACING';
    phaseStart = frame;
    raceStart = frame;
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
    const newBlobs: Blob[] = [];

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
      let grab = p.grab;
      let grabbedBy = p.grabbedBy;
      let lastGrab = p.lastGrab;
      let struggle = p.struggle;
      let steerSign = p.steerSign;
      let grabImmuneUntil = p.grabImmuneUntil;
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

        // Crab Claws: a grab in progress ends when time runs out, the rival breaks free, or the rival is gone.
        if (grab !== null) {
          const victim = state.players[grab.target];
          const vb = victim === undefined ? undefined : deterministicPhysicsBodyById3D(world, carId(grab.target));
          const gone = victim === undefined || vb === undefined || victim.finishTick >= 0 || !victim.inRace || p.build.arms !== ARM_CLAWS || Math.hypot(vb.x - body.x, vb.z - body.z) > 14;
          if (gone || victim.grabbedBy !== p.slot) {
            lastGrab = { partner: grab.target, until: frame + GRAB_SHIELD_TICKS };
            ropesToRemove.push(grabId(p.slot));
            armsCooldown = CLAW_FREED_COOLDOWN;
            grab = null;
          } else if (grab.ticksLeft <= 1) {
            lastGrab = { partner: grab.target, until: frame + GRAB_SHIELD_TICKS };
            ropesToRemove.push(grabId(p.slot));
            grabSteals.push({ attacker: p.slot, victim: grab.target });
            armsCooldown = CLAW_GRAB_COOLDOWN;
            grab = null;
          } else {
            grab = { ...grab, ticksLeft: grab.ticksLeft - 1 };
          }
        } else if (p.build.arms === ARM_CLAWS && armsEdge && armsCooldown === 0) {
          const target = findGrabTarget(world, state, frame, p, body);
          if (target.kind === 'rival') {
            grab = { target: target.slot, ticksLeft: CLAW_GRAB_TICKS, maxLength: Math.max(2.8, target.distance) };
          } else if (target.kind === 'part') {
            clawPickups.set(p.slot, target.id);
            armsCooldown = CLAW_PICKUP_COOLDOWN;
          } else {
            armsCooldown = CLAW_MISS_COOLDOWN;
          }
        }

        if (p.build.head === HEAD_SLIME && headEdge && headCooldown === 0 && trailLeft === 0) {
          trailLeft = HEADS.slime.spewTicks;
          headCooldown = HEADS.slime.cooldownTicks;
          newBlobs.push(launchBlob(body, p.slot, input.slimeFwd));
        }
        if (trailLeft > 0) trailLeft -= 1;
      }

      // Held in somebody's claws: swinging the steering from side to side breaks free.
      if (grabbedBy >= 0) {
        const side = Math.abs(input.steer) >= 50 ? Math.sign(input.steer) : 0;
        if (side !== 0 && steerSign !== 0 && side !== steerSign) struggle += 1;
        if (side !== 0) steerSign = side;
        if (struggle >= STRUGGLE_FLIPS) {
          grabbedBy = -1;
          struggle = 0;
          steerSign = 0;
          grabImmuneUntil = frame + GRAB_IMMUNE_TICKS;
        }
      } else {
        struggle = 0;
        steerSign = 0;
      }
      if (grab !== null) {
        const victimBody = deterministicPhysicsBodyById3D(world, carId(grab.target));
        if (victimBody !== undefined) {
          joints.push({ id: grabId(p.slot), type: 'distance', a: carId(p.slot), b: carId(grab.target), anchorA: { x: 0, y: 0, z: 0 }, anchorB: { x: 0, y: 0, z: 0 }, maxLength: grab.maxLength });
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

      // --- a bot that is lost is put back on the route a little further on ---
      let botBrain = p.brain;
      if (racing && isBotSeat(p, humans) && p.brain.idle > BOT_RESCUE_TICKS && frame >= p.frozenUntil && p.finishTick < 0) {
        const pose = rescuePose(prep, p.brain.index);
        if (pose !== undefined) {
          respawns.push(chassisBody(p.slot, p.build, pose.x, pose.z, pose.yaw));
          p = { ...p, frozenUntil: frame + 30 };
          botBrain = { ...p.brain, index: p.brain.index + 12, idle: 0, stuck: 0, recover: 0 };
        }
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
          if (grabbedBy >= 0) {
            grabbedBy = -1;
            grabImmuneUntil = frame + GRAB_IMMUNE_TICKS;
          }
          if (swing !== null) {
            ropesToRemove.push(ropeId(p.slot));
            swing = null;
          }
        }
      } else {
        resetHold = 0;
      }

      // --- tipped over: right the monster in place (manual only: it stays down until the player asks) ---
      const o = body.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
      const up = 1 - 2 * (o.x * o.x + o.z * o.z);
      const tippedTicks = racing && p.finishTick < 0 && up < TIP_MIN_UP ? p.tippedTicks + 1 : 0;
      let getUpReadyAt = p.getUpReadyAt;
      if (racing && input.getUp && tippedTicks >= TIP_TICKS && frame >= getUpReadyAt) {
        let fx = 2 * (o.x * o.z + o.w * o.y), fz = 1 - 2 * (o.x * o.x + o.y * o.y);
        if (Math.hypot(fx, fz) < 0.2) {
          // nose pointing at the sky or the ground: take the heading from the monster's left side instead
          fx = 2 * (o.w * o.y - o.x * o.z);
          fz = 1 - 2 * (o.y * o.y + o.z * o.z);
        }
        const upright = chassisBody(p.slot, p.build, body.x, body.z, Math.atan2(fx, fz));
        respawns.push({ ...upright, vy: GETUP_HOP });
        frozenUntil = frame + GETUP_FREEZE_TICKS;
        getUpReadyAt = frame + GETUP_COOLDOWN_TICKS;
        if (swing !== null) {
          ropesToRemove.push(ropeId(p.slot));
          swing = null;
        }
      }

      // --- vehicle controls ---
      const live = racing && frame >= frozenUntil && p.finishTick < 0; // a finished monster stops and brakes

      // --- Hopper Haunches: hold to crouch and charge, let go to leap; no steering until it lands ---
      const hop = legsOf(p.build).hop;
      let hopCharge = p.hopCharge;
      let hopReadyAt = p.hopReadyAt;
      let hopAir = p.hopAir;
      const grounded = body.y < RIDE_HEIGHT + 0.35;
      if (hop === undefined || !live || grabbedBy >= 0) {
        hopCharge = 0;
        hopAir = 0;
      } else {
        if (hopAir > 0) {
          hopAir += 1;
          if ((grounded && hopAir > 6) || hopAir > 120) hopAir = 0;
          hopCharge = 0;
        } else if (input.legs && frame >= hopReadyAt) {
          hopCharge = Math.min(hop.chargeTicks, hopCharge + 1);
        } else if (hopCharge > 0) {
          if (!input.legs && grounded) {
            const frac = Math.max(0.4, hopCharge / hop.chargeTicks);
            const fwd = hopCharge >= hop.minChargeTicks ? hop.leapForward * frac : 0;
            const fx = 2 * (o.x * o.z + o.w * o.y), fz = 1 - 2 * (o.x * o.x + o.y * o.y);
            const fl = Math.hypot(fx, fz) || 1;
            const mass = MASS_UNIT * massOf(p.build);
            impulses.push({
              bodyId: carId(p.slot),
              impulse: { x: (fx / fl) * fwd * mass / TICK_RATE, y: hop.leapUp * frac * mass / TICK_RATE, z: (fz / fl) * fwd * mass / TICK_RATE },
              worldPoint: { x: body.x, y: body.y, z: body.z },
            });
            hopAir = 1;
            hopReadyAt = frame + hop.cooldownTicks;
          }
          hopCharge = 0;
        }
      }
      const airborne = hopAir > 0;
      const oil = featureAt(prep.features.oils, body.x, body.z) !== undefined;
      const gripMul = Math.min(slickGripMul(state.slicks, body.x, body.z, p.slot), oil ? OIL_GRIP_MUL : 1);
      const vehicle = vehicleFor(p.slot, p.build, gripMul, (prep.onRoad(body.x, body.z) ? 1 : legsOf(p.build).offRoadMul));
      // Pivot in place at a standstill so the monster can turn around when it is stuck: while it is nearly
      // stopped and steering hard it stops driving into the obstacle and spins on the spot instead.
      const speedMs = Math.hypot(body.vx, body.vz) * TICK_RATE;
      const pivoting = live && Math.abs(input.steer) >= PIVOT_MIN_STEER && speedMs < PIVOT_SPEED;
      const result = stepDeterministicVehicle3D(vehicle, {
        // No reverse: a negative throttle (S / down) is a brake instead.
        throttle: live && !pivoting ? clampInt((input.throttle / 10) * (hopCharge > 0 && hop !== undefined ? hop.chargeThrottle : 1), 0, 10) : 0,
        steer: live && !airborne ? clampInt((input.steer / 10) * steerScale(body.vx, body.vz), -10, 10) : 0,
        brake: live ? (input.throttle < 0 ? 10 : 0) : 10,
      }, world);
      for (const imp of result.impulses) {
        impulses.push({ bodyId: imp.bodyId, impulse: imp.impulse, worldPoint: imp.point });
      }
      // A boost pad shoves a driving monster along the road (it must be moving that way: no launching backwards).
      const pad = live ? featureAt(prep.features.pads, body.x, body.z) : undefined;
      if (pad !== undefined && body.vx * pad.dx + body.vz * pad.dz > -0.05) {
        const push = MASS_UNIT * massOf(p.build) * PAD_ACCEL;
        impulses.push({ bodyId: carId(p.slot), impulse: { x: pad.dx * push, y: 0, z: pad.dz * push }, worldPoint: { x: body.x, y: body.y, z: body.z } });
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
        hopCharge,
        hopReadyAt,
        hopAir,
        armsCooldown,
        headCooldown,
        trailLeft,
        spinLeft,
        swing,
        grab,
        brain: botBrain,
        grabbedBy,
        lastGrab,
        struggle,
        steerSign,
        grabImmuneUntil,
        resetHold,
        tippedTicks,
        getUpReadyAt,
        frozenUntil,
      };
      return p;
    });

    // Who is being held: set from the grabbers' side once the tick's decisions are made.
    const held = new Map<number, number>();
    for (const g of players) if (g.grab !== null) held.set(g.grab.target, g.slot);
    players = players.map((pl) => {
      const by = held.get(pl.slot);
      if (by !== undefined && pl.grabbedBy < 0 && frame >= pl.grabImmuneUntil) return { ...pl, grabbedBy: by };
      if (by === undefined && pl.grabbedBy >= 0) return { ...pl, grabbedBy: -1, struggle: 0, steerSign: 0 };
      return pl;
    });

    if (impulses.length > 0) world = applyDeterministicImpulses3D(world, impulses);
    if (torques.length > 0) world = applyDeterministicForces3D(world, torques);
    if (respawns.length > 0) world = applyDeterministicWorldEdit3D(world, { replace: respawns });
    if (ropesToRemove.length > 0) world = applyDeterministicWorldEdit3D(world, { removeJointIds: ropesToRemove });
    // Blobs in flight fall under their own gravity; one that reaches the road splats into a slick.
    const flying: Blob[] = [];
    for (const b of state.blobs) {
      const moved = { ...b, x: b.x + b.vx, y: b.y + b.vy, z: b.z + b.vz, vy: b.vy - BLOB_G_TICK };
      if (moved.y <= 0.1) newSlicks.push({ x: moved.x, z: moved.z, expires: frame + HEADS.slime.slickLifeTicks, owner: b.owner });
      else flying.push(moved);
    }
    blobs = [...flying, ...newBlobs];
    slicks = [...state.slicks.filter((s) => s.expires > frame), ...newSlicks];
  }

  if (driving) ({ world, activeCells } = syncBuildings(world, prep, players, activeCells));
  const preSpeed = new Map<number, number>();
  /** Velocities (metres per tick) just before the step: the real approach speed of a crash (the engine's own figure is measured after its solver has already slowed the bodies). */
  const preVelocity = new Map<number, { vx: number; vz: number }>();
  for (const p of players) {
    const b = deterministicPhysicsBodyById3D(world, carId(p.slot));
    if (b !== undefined) {
      preSpeed.set(p.slot, Math.hypot(b.vx, b.vz) * TICK_RATE);
      preVelocity.set(p.slot, { vx: b.vx, vz: b.vz });
    }
  }
  const stepped = stepDeterministicPhysicsWorld3D(world, { gravityY: GRAVITY_Y, dtTicks: 1, joints, computeChecksum: false });
  world = stepped.world;
  let pickups = state.pickups.filter((pk) => pk.expires > frame);
  let nextPickupId = state.nextPickupId;

  // Loose parts appear on the road along the route every so often, so a stripped monster can build itself back up.
  if (racing && prep.features.crates.length > 0) {
    const since = frame - state.raceStart;
    prep.features.crates.forEach((crate, i) => {
      if (since < CRATE_PERIOD_TICKS / 2 || (since + i * 37) % CRATE_PERIOD_TICKS !== 0) return;
      if (pickups.some((pk) => Math.hypot(pk.x - crate.x, pk.z - crate.z) < 2)) return;
      const h = hash32(state.seed, frame, 1000 + i);
      const slot = SLOT_KEYS[h % SLOT_KEYS.length]!;
      const count = (slot === 'legs' ? LEG_PARTS : slot === 'arms' ? ARM_PARTS : HEAD_PARTS).length - 1;
      const part = 1 + ((h >>> 8) % count);
      pickups = [...pickups, { id: nextPickupId, slot, part, x: crate.x, z: crate.z, expires: frame + PICKUP_LIFE_TICKS, armedAt: frame, owner: -1, ownerArmedAt: frame }];
      nextPickupId += 1;
    });
  }

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
    const hitAt = new Map<number, { x: number; z: number; weight: number }>();
    /** True while two monsters are in a grab (or just out of one): they cannot crash into each other or ram-steal. */
    const shielded = (a: number, b: number): boolean => {
      const pa = players[a], pb = players[b];
      if (pa === undefined || pb === undefined) return false;
      return pa.grab?.target === b || pb.grab?.target === a || (pa.lastGrab?.partner === b && frame < pa.lastGrab.until) || (pb.lastGrab?.partner === a && frame < pb.lastGrab.until);
    };
    const steals: { attacker: number; victim: number; x: number; z: number }[] = [];
    const stealing = new Set<number>();
    const stolenFrom = new Set<number>();
    /** True when `attacker` (with Crab Claws) is behind `victim`, facing it, and the claws are ready. */
    const clawsCanSteal = (attacker: number, victim: number): boolean => {
      const a = players[attacker], v = players[victim];
      if (a === undefined || v === undefined || a.finishTick >= 0 || v.finishTick >= 0) return false;
      if (a.build.arms !== ARM_CLAWS || frame < a.clawCooldownUntil || stealing.has(attacker) || stolenFrom.has(victim)) return false;
      if (SLOT_KEYS.every((k) => v.build[k] === 0)) return false;
      const ba = deterministicPhysicsBodyById3D(world, carId(attacker)), bv = deterministicPhysicsBodyById3D(world, carId(victim));
      if (ba === undefined || bv === undefined) return false;
      const dx = bv.x - ba.x, dz = bv.z - ba.z, dist = Math.hypot(dx, dz);
      if (dist < 0.01) return false;
      const ya = 2 * Math.atan2(ba.orientation?.y ?? 0, ba.orientation?.w ?? 1), yv = 2 * Math.atan2(bv.orientation?.y ?? 0, bv.orientation?.w ?? 1);
      const facingVictim = (Math.sin(ya) * dx + Math.cos(ya) * dz) / dist; // attacker's nose points at the victim
      const behindVictim = (Math.sin(yv) * dx + Math.cos(yv) * dz) / dist; // victim's heading points away from the attacker
      return facingVictim >= CLAW_REAR_COS && behindVictim >= CLAW_REAR_COS;
    };
    // A grab that was held to the end steals a part, the same way a rear hit does.
    for (const gs of grabSteals) {
      if (stealing.has(gs.attacker) || stolenFrom.has(gs.victim)) continue;
      const vb = deterministicPhysicsBodyById3D(world, carId(gs.victim));
      if (vb === undefined) continue;
      steals.push({ attacker: gs.attacker, victim: gs.victim, x: vb.x, z: vb.z });
      stealing.add(gs.attacker);
      stolenFrom.add(gs.victim);
    }
    const contacts = [...stepped.contacts]
      .filter((c) => c.type === 'enter' && !c.trigger)
      .sort((a, b) => (a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0));
    for (const c of contacts) {
      let closing = (c.closingSpeed ?? 0) * TICK_RATE;
      const sa = slotOfCar(c.a), sb = slotOfCar(c.b);
      if (sa >= 0 && sb >= 0) {
        // how fast the two monsters were really approaching each other just before they touched
        const ba = deterministicPhysicsBodyById3D(world, carId(sa)), bb = deterministicPhysicsBodyById3D(world, carId(sb));
        const va = preVelocity.get(sa), vb = preVelocity.get(sb);
        if (ba !== undefined && bb !== undefined && va !== undefined && vb !== undefined) {
          const dx = bb.x - ba.x, dz = bb.z - ba.z, d = Math.hypot(dx, dz);
          if (d > 0.01) closing = Math.max(closing, (((va.vx - vb.vx) * dx + (va.vz - vb.vz) * dz) / d) * TICK_RATE);
        }
      }
      const point = { x: c.point?.x ?? 0, z: c.point?.z ?? 0 };
      if (sa >= 0 && sb >= 0) {
        if (closing >= HIT_MIN_CLOSING_MS && !shielded(sa, sb)) {
          for (const [attacker, victim] of [[sa, sb], [sb, sa]] as const) {
            if (clawsCanSteal(attacker, victim)) {
              steals.push({ attacker, victim, x: point.x, z: point.z });
              stealing.add(attacker);
              stolenFrom.add(victim);
            }
          }
          const weight = closing >= HIT_HEAVY_CLOSING_MS ? 2 : 1; // a harder crash does more damage
          hitAt.set(sa, { ...point, weight });
          hitAt.set(sb, { ...point, weight });
        }
      } else {
        const car = sa >= 0 ? sa : sb;
        if (car >= 0 && (preSpeed.get(car) ?? 0) >= WALL_HIT_MIN_SPEED_MS && closing >= WALL_HIT_MIN_CLOSING_MS) hitAt.set(car, { ...point, weight: 1 });
      }
    }
    const changed = new Set<number>();

    // --- Crab Claws steals: the victim loses a random part; the attacker takes it into the matching empty slot, or it drops ---
    if (steals.length > 0) {
      const next = [...players];
      for (const st of steals) {
        const v = next[st.victim]!, a = next[st.attacker]!;
        const equipped = SLOT_KEYS.filter((k) => v.build[k] !== 0);
        if (equipped.length === 0) continue;
        const key = equipped[hash32(state.seed ^ 0x51ea1, frame, st.victim) % equipped.length]!;
        const part = v.build[key];
        next[st.victim] = { ...v, build: { ...v.build, [key]: 0 }, partsLost: v.partsLost + 1, lastLossTick: frame };
        changed.add(st.victim);
        if (a.build[key] === 0) {
          next[st.attacker] = { ...a, build: { ...a.build, [key]: part }, partsGained: a.partsGained + 1, partsStolen: a.partsStolen + 1, clawCooldownUntil: frame + CLAW_COOLDOWN_TICKS };
          changed.add(st.attacker);
        } else {
          pickups = [
            ...pickups,
            { id: nextPickupId, slot: key, part, x: st.x, z: st.z, expires: frame + PICKUP_LIFE_TICKS, armedAt: frame + PICKUP_ARM_TICKS, owner: st.victim, ownerArmedAt: frame + PICKUP_OWNER_BLOCK_TICKS },
          ];
          nextPickupId += 1;
          next[st.attacker] = { ...a, partsStolen: a.partsStolen + 1, clawCooldownUntil: frame + CLAW_COOLDOWN_TICKS };
        }
      }
      players = next;
    }
    // A stolen-from monster loses a part instead of taking a normal hit from that contact.
    for (const victim of stolenFrom) hitAt.delete(victim);

    players = players.map((p) => {
      const point = hitAt.get(p.slot);
      if (point === undefined || p.finishTick >= 0 || frame < p.hitCooldownUntil) return p;
      const body = BODIES[p.build.body] ?? BODIES[0]!;
      const hits = p.hits + point.weight;
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

    // --- claws reaching for a loose part: it goes straight into the empty slot ---
    if (clawPickups.size > 0) {
      const taken = new Set<number>();
      players = players.map((p) => {
        const id = clawPickups.get(p.slot);
        if (id === undefined) return p;
        const pk = pickups.find((x) => x.id === id);
        if (pk === undefined || taken.has(pk.id) || p.build[pk.slot] !== 0) return p;
        taken.add(pk.id);
        changed.add(p.slot);
        return { ...p, build: { ...p.build, [pk.slot]: pk.part }, partsGained: p.partsGained + 1 };
      });
      if (taken.size > 0) pickups = pickups.filter((pk) => !taken.has(pk.id));
    }

    // --- pickups: driving through one fills an empty slot ---
    if (pickups.length > 0) {
      const taken = new Set<number>();
      players = players.map((p) => {
        if (p.finishTick >= 0) return p;
        const body = deterministicPhysicsBodyById3D(world, carId(p.slot));
        if (body === undefined) return p;
        let q = p;
        for (const pk of pickups) {
          if (taken.has(pk.id)) continue;
          // A full slot means the part cannot be fitted, unless a Hunchback Hump has room for it as a spare.
          const sack = q.build[pk.slot] !== 0 && q.build.head === HEAD_HUMP && q.spare === null && pk.slot !== 'head';
          if (q.build[pk.slot] !== 0 && !sack) continue;
          if (frame < pk.armedAt || (pk.owner === q.slot && frame < pk.ownerArmedAt)) continue;
          if (Math.hypot(body.x - pk.x, body.z - pk.z) > PICKUP_RADIUS) continue;
          taken.add(pk.id);
          q = sack ? { ...q, spare: { slot: pk.slot, part: pk.part }, partsGained: q.partsGained + 1 } : { ...q, build: { ...q.build, [pk.slot]: pk.part }, partsGained: q.partsGained + 1 };
        }
        if (q !== p) changed.add(q.slot);
        return q;
      });
      if (taken.size > 0) pickups = pickups.filter((pk) => !taken.has(pk.id));
    }

    // Hunchback Hump: a spare part is fitted the moment its slot is empty, and is lost with the hump.
    players = players.map((pl) => {
      if (pl.spare === null) return pl;
      if (pl.build.head !== HEAD_HUMP) return { ...pl, spare: null };
      if (pl.build[pl.spare.slot] !== 0) return pl;
      changed.add(pl.slot);
      return { ...pl, build: { ...pl.build, [pl.spare.slot]: pl.spare.part }, spare: null, partsGained: pl.partsGained + 1 };
    });

    // A changed build changes mass and top speed: retune each affected body, and drop abilities that lost their part.
    if (changed.size > 0) {
      const edits: DeterministicPhysicsBody3D[] = [];
      const ropes: string[] = [];
      const lostSwing = new Set<number>();
      const lostGrab = new Set<number>();
      const lostTrail = new Set<number>();
      for (const slot of [...changed].sort((a, b) => a - b)) {
        const cur = players[slot]!;
        const body = deterministicPhysicsBodyById3D(world, carId(slot));
        if (body !== undefined) edits.push(retuned(body, slot, cur.build));
        if (cur.grab !== null && cur.build.arms !== ARM_CLAWS) {
          ropes.push(grabId(slot));
          lostGrab.add(slot);
        }
        if (cur.swing !== null && cur.build.arms !== ARM_TENTACLES) {
          ropes.push(ropeId(slot));
          lostSwing.add(slot);
        }
        if (cur.trailLeft > 0 && cur.build.head !== HEAD_SLIME) lostTrail.add(slot);
      }
      if (lostSwing.size > 0 || lostTrail.size > 0 || lostGrab.size > 0) {
        players = players.map((pl) => ({
          ...pl,
          swing: lostSwing.has(pl.slot) ? null : pl.swing,
          grab: lostGrab.has(pl.slot) ? null : pl.grab,
          trailLeft: lostTrail.has(pl.slot) ? 0 : pl.trailLeft,
        }));
      }
      world = applyDeterministicWorldEdit3D(world, { replace: edits, removeJointIds: ropes });
    }
    // The race ends when every human in it has finished (bots and spectators never hold it open).
    const racersHuman = players.filter((p) => p.inRace && !isBotSeat(p, humans));
    const allDone = racersHuman.length > 0 && racersHuman.every((p) => p.finishTick >= 0);
    const firstFinish = finishOrder.length > 0 ? players[finishOrder[0]!]!.finishTick : -1;
    if (allDone || (firstFinish >= 0 && frame - firstFinish >= FINISH_WINDOW_TICKS)) {
      phase = 'RESULTS';
      phaseStart = frame;
    }
  }

  return { frame, phase, phaseStart, physics: world, players, slicks, blobs, pickups, nextPickupId, seed: state.seed, bots: state.bots, botLevel, raceStart, finishOrder, activeCells };
}

export function projectGame(state: GameState, prep: PreparedMap): GameProjection {
  const hostSlot = hostSlotOf(state.players, state.frame, state.players.length - state.bots);
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
      joined: isHere(p, state.frame, state.players.length - state.bots),
      inRace: p.inRace,
      host: p.slot === hostSlot,
      bot: isBotSeat(p, state.players.length - state.bots),
      ...pose,
      nextCheckpoint: p.nextCheckpoint,
      finishTick: p.finishTick,
      armsCooldown: p.armsCooldown,
      headCooldown: p.headCooldown,
      swingPole: p.swing === null ? -1 : p.swing.pole,
      grabbing: p.grab === null ? -1 : p.grab.target,
      grabbedBy: p.grabbedBy,
      trailing: p.trailLeft > 0,
      tipped: p.tippedTicks >= TIP_TICKS,
      hopCharge: (legsOf(p.build).hop?.chargeTicks ?? 0) > 0 ? p.hopCharge / legsOf(p.build).hop!.chargeTicks : 0,
      hopCooldown: Math.max(0, p.hopReadyAt - state.frame),
      airborne: p.hopAir > 0,
      spare: p.spare,
      partsLost: p.partsLost,
      partsGained: p.partsGained,
      partsStolen: p.partsStolen,
      lastLossTick: p.lastLossTick,
      rematch: p.rematch,
    };
  });
  return {
    frame: state.frame,
    phase: state.phase,
    mapId: prep.map.id,
    phaseTicks: state.frame - state.phaseStart,
    raceStart: state.raceStart,
    hostSlot,
    players,
    slicks: state.slicks,
    blobs: state.blobs,
    pickups: state.pickups,
    finishOrder: state.finishOrder,
    activeCells: state.activeCells,
  };
}

/** Who is in the lobby and whether the host may start; mirrors the sim's own rule (the sim has the final say). */
export function lobbyStatus(frame: GameProjection): { members: PlayerView[]; count: number; notReady: number; canStart: boolean } {
  const members = frame.players.filter((p) => p.joined && (p.bot || frame.phase === 'BUILD' || p.rematch));
  const notReady = members.filter((p) => !p.bot && !p.host && !p.ready).length;
  const hostIn = members.some((p) => p.host);
  return { members, count: members.length, notReady, canStart: hostIn && members.length >= 2 && notReady === 0 };
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
