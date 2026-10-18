// All tuning numbers live here so balance can change without touching sim code.
// Times are in ticks (30 ticks = 1 s). Physics velocities are per tick.

export const TICK_RATE = 30;
export const seconds = (s: number): number => Math.round(s * TICK_RATE);

/** Physics mass of a body with spec mass 1.0. Forces below are scaled against it. */
export const MASS_UNIT = 1200;
/** Gravity in m/tick² (9.8 m/s² at 30 Hz). */
export const GRAVITY_Y = -9.8 / (TICK_RATE * TICK_RATE);
/** Base forward acceleration of a mass-1.0 body at full throttle, m/tick². */
export const BASE_ACCEL = 0.01;
/** Base top speed in m/s before part multipliers. */
export const BASE_TOP_SPEED = 22;

export interface BodyDef {
  readonly name: string;
  readonly mass: number;
  /** Collisions with another monster (or a wall at speed) needed before one equipped part falls off. */
  readonly hitsToLose: number;
  readonly accel: number;
  readonly turn: number;
}

export interface LegsDef {
  readonly name: string;
  readonly blurb: string;
  readonly driveMul: number;
  readonly topSpeedMul: number;
  readonly gripMul: number;
  /** Drive multiplier when there is no road under the monster (1 = no penalty). */
  readonly offRoadMul: number;
  readonly mass: number;
}

export interface ArmsDef {
  readonly name: string;
  readonly blurb: string;
  readonly mass: number;
  readonly grabRange: number;
  readonly swingTicks: number;
  readonly cooldownTicks: number;
  readonly missCooldownTicks: number;
  readonly missSpinTicks: number;
  readonly missSpinTorque: number;
}

export interface HeadDef {
  readonly name: string;
  readonly blurb: string;
  readonly mass: number;
  readonly trailTicks: number;
  readonly dropEveryTicks: number;
  readonly slickLifeTicks: number;
  readonly slickRadius: number;
  readonly slickGripMul: number;
  readonly cooldownTicks: number;
}

// Body numbers follow the spec ratios (Brute turn 0.8 : Rattler 1.1); `turn` is the grip multiplier, scaled to the
// handling tuned on the Brute (1.8).
export const BODIES: readonly BodyDef[] = [
  { name: 'Stitched Brute', mass: 1.4, hitsToLose: 3, accel: 0.8, turn: 1.8 },
  { name: 'Bone Rattler', mass: 0.7, hitsToLose: 1, accel: 1.2, turn: 2.475 },
];

// Part tables are indexed by part id; id 0 is an empty slot (a monster that never had, or has lost, that part).
const NO_LEGS: LegsDef = { name: 'Stumps', blurb: 'No legs: slow but steady', driveMul: 1, topSpeedMul: 1, gripMul: 1, offRoadMul: 0.5, mass: 0 };
export const LEGS: Readonly<Record<'none' | 'werewolf' | 'spider', LegsDef>> = {
  none: NO_LEGS,
  werewolf: { name: 'Werewolf Legs', blurb: 'Fastest on straights, slides wide in corners', driveMul: 1.35, topSpeedMul: 1.25, gripMul: 0.7, offRoadMul: 0.5, mass: 0 },
  // Spider Legs: the spec's wall climbing needs baked low obstacles, so for now they give grip and rough-ground
  // traction (crosses grass, gutters and medians almost unslowed) at the price of top speed.
  spider: { name: 'Spider Legs', blurb: 'Grips corners and rough ground, 25% slower', driveMul: 1, topSpeedMul: 0.75, gripMul: 1.2, offRoadMul: 0.9, mass: 0 },
};
export const LEG_PARTS: readonly LegsDef[] = [LEGS.none, LEGS.werewolf, LEGS.spider];

const NO_ARMS: ArmsDef = { name: 'No arms', blurb: 'Empty slot', mass: 0, grabRange: 0, swingTicks: 0, cooldownTicks: 0, missCooldownTicks: 0, missSpinTicks: 0, missSpinTorque: 0 };
export const ARMS: Readonly<Record<'none' | 'tentacles' | 'claws', ArmsDef>> = {
  none: NO_ARMS,
  tentacles: {
    name: 'Tentacles',
    blurb: 'Grab a pole and swing round it',
    mass: 0,
    grabRange: 6,
    swingTicks: 60,
    cooldownTicks: seconds(3),
    missCooldownTicks: seconds(3),
    missSpinTicks: 12,
    missSpinTorque: 6,
  },
  // Crab Claws steal a part from a rival hit from behind (added with part loss); the cost is weight.
  claws: { ...NO_ARMS, name: 'Crab Claws', blurb: 'Hit a rival from behind to steal a part', mass: 0.2 },
};
export const ARM_PARTS: readonly ArmsDef[] = [ARMS.none, ARMS.tentacles, ARMS.claws];

const NO_HEAD: HeadDef = { name: 'No head part', blurb: 'Empty slot', mass: 0, trailTicks: 0, dropEveryTicks: 1, slickLifeTicks: 0, slickRadius: 0, slickGripMul: 1, cooldownTicks: 0 };
export const HEADS: Readonly<Record<'none' | 'slime' | 'lantern', HeadDef>> = {
  none: NO_HEAD,
  slime: {
    name: 'Slime Gland',
    blurb: 'Drop a slick trail behind you',
    mass: 0,
    trailTicks: seconds(4),
    dropEveryTicks: 3,
    slickLifeTicks: seconds(4),
    slickRadius: 2.5,
    slickGripMul: 0.2,
    cooldownTicks: seconds(8),
  },
  // Jack-o'-Lantern Head is passive: it lights up the shortcut to the next checkpoint (HUD side only).
  lantern: { ...NO_HEAD, name: "Jack-o'-Lantern", blurb: 'Lights the way to the next checkpoint' },
};
export const HEAD_PARTS: readonly HeadDef[] = [HEADS.none, HEADS.slime, HEADS.lantern];

// Race flow
export const COUNTDOWN_TICKS = 90;
export const FINISH_WINDOW_TICKS = seconds(30);
export const CHECKPOINT_RADIUS = 12;
export const RESET_HOLD_TICKS = 30;
export const RESET_FREEZE_TICKS = 60;
// Tipping over: the monster counts as fallen once its up direction has been tilted past TIP_MIN_UP (cos 60 degrees)
// for TIP_TICKS in a row; Get up rights it in place, with a short loss of control and a cooldown.
export const TIP_MIN_UP = 0.5;
export const TIP_TICKS = 15;
export const GETUP_FREEZE_TICKS = 60;
export const GETUP_COOLDOWN_TICKS = 45;
export const GETUP_HOP = 0.12; // metres per tick, a small hop as it rights itself

// Steering lock fades linearly with speed: full lock at rest, STEER_MIN_SCALE at/above STEER_FADE_SPEED (m/s).
export const STEER_FADE_SPEED = 24;
export const STEER_MIN_SCALE = 0.2;

// Off-road (no road surface under the monster) halves drive force, which halves top speed.
export const OFF_ROAD_DRIVE_MUL = 0.5;

// Chassis geometry (metres)
export const CHASSIS_HALF = { x: 0.7, y: 0.35, z: 1.2 } as const;
export const RIDE_HEIGHT = 1.0;

// A monster cannot reverse. Instead, near a standstill it can pivot on the spot (so it can turn around when stuck
// against a wall): below PIVOT_SPEED (m/s) steering adds a yaw torque, fading out to zero at that speed.
export const PIVOT_SPEED = 2.5;
export const PIVOT_TORQUE = 0.05;
export const PIVOT_MIN_STEER = 60;

// Part loss and pickups
/** A monster-to-monster contact counts as a hit when the bodies close at least this fast (m/s). */
export const HIT_MIN_CLOSING_MS = 3;
/** A wall or pole counts only when the monster was already doing at least this (m/s, = 60 km/h) and hits it solidly. */
export const WALL_HIT_MIN_SPEED_MS = 60 / 3.6;
export const WALL_HIT_MIN_CLOSING_MS = 4;
/** Ticks after a hit during which further contacts do not count (a scrape fires several contacts). */
export const HIT_COOLDOWN_TICKS = 20;
export const PICKUP_LIFE_TICKS = seconds(30);
export const PICKUP_RADIUS = 3.5;
/** A dropped part cannot be grabbed for this long by anyone, and by the monster it fell off for longer. */
export const PICKUP_ARM_TICKS = 20;
export const PICKUP_OWNER_BLOCK_TICKS = 75;
/** Comeback mechanic: every empty slot makes the monster lighter and a little faster. */
export const MISSING_SLOT_MASS = 0.15;
export const MISSING_SLOT_SPEED = 0.05;

// Crab Claws: a rear hit steals a part. The attacker must be behind the victim (within this cosine of its heading)
// and facing it, and can steal again only after the cooldown.
export const CLAW_REAR_COS = 0.5;
export const CLAW_COOLDOWN_TICKS = seconds(2);

// Lobby: a player counts as being in the room while their client keeps announcing itself; after this long without
// hearing from them they are treated as gone (so a ghost can never block the host from starting).
export const PRESENCE_TIMEOUT_TICKS = seconds(6);
