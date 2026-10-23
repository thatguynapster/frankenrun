// All tuning numbers live here so balance can change without touching sim code.
// Times are in ticks (30 ticks = 1 s). Physics velocities are per tick.

export const TICK_RATE = 30;
export const seconds = (s: number): number => Math.round(s * TICK_RATE);

/** Physics mass of a body with spec mass 1.0. Forces below are scaled against it. */
export const MASS_UNIT = 1200;
/** Gravity in m/tick² (9.8 m/s² at 30 Hz). */
/** Gravity for slime blobs, in metres per second squared (a bit stronger than the world's, so they snap down). */
export const BLOB_GRAVITY = 18;
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
  /** Legs that can leap: hold the legs button to charge, let go to jump. */
  readonly hop?: HopDef;
}

export interface HopDef {
  /** Ticks of holding for a full charge. */
  readonly chargeTicks: number;
  /** A release before this many ticks of charge only gives a small hop. */
  readonly minChargeTicks: number;
  /** Upward speed at a full charge, metres per second (a small hop gets 40% of it). */
  readonly leapUp: number;
  /** Extra forward speed at a full charge, metres per second. */
  readonly leapForward: number;
  readonly cooldownTicks: number;
  /** Share of the throttle kept while crouching to charge. */
  readonly chargeThrottle: number;
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
  /** How long the head keeps spewing after the button (drives the swell animation and the sound for rivals). */
  readonly spewTicks: number;
  /** The blob leaves the head at this angle above the ground (degrees). */
  readonly blobAngleDeg: number;
  /** Thrown backwards, it lands this far behind the monster, measured where the monster is when it lands (metres). */
  readonly blobBack: number;
  /** Thrown forwards, it lands this far ahead of the monster (metres). */
  readonly blobAhead: number;
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
export const LEGS: Readonly<Record<'none' | 'werewolf' | 'spider' | 'hopper', LegsDef>> = {
  none: NO_LEGS,
  werewolf: { name: 'Werewolf Legs', blurb: 'Fastest on straights, slides wide in corners', driveMul: 1.35, topSpeedMul: 1.25, gripMul: 0.7, offRoadMul: 0.5, mass: 0 },
  // Spider Legs: the spec's wall climbing needs baked low obstacles, so for now they give grip and rough-ground
  // traction (crosses grass, gutters and medians almost unslowed) at the price of top speed.
  spider: { name: 'Spider Legs', blurb: 'Grips corners and rough ground, 25% slower', driveMul: 1, topSpeedMul: 0.75, gripMul: 1.2, offRoadMul: 0.9, mass: 0 },
  // Hopper Haunches: a charged leap over parked cars and gaps, paid for with a slower, looser everyday drive. No steering in the air.
  hopper: {
    name: 'Hopper Haunches',
    blurb: 'Hold to charge, release to leap over obstacles; no steering in the air',
    driveMul: 0.95,
    topSpeedMul: 0.9,
    gripMul: 0.85,
    offRoadMul: 0.7,
    mass: 0.05,
    hop: { chargeTicks: seconds(0.8), minChargeTicks: seconds(0.25), leapUp: 7.2, leapForward: 7, cooldownTicks: seconds(3), chargeThrottle: 0.5 },
  },
};
export const LEG_PARTS: readonly LegsDef[] = [LEGS.none, LEGS.werewolf, LEGS.spider, LEGS.hopper];

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

const NO_HEAD: HeadDef = { name: 'No head part', blurb: 'Empty slot', mass: 0, spewTicks: 0, blobAngleDeg: 0, blobBack: 0, blobAhead: 0, slickLifeTicks: 0, slickRadius: 0, slickGripMul: 1, cooldownTicks: 0 };
export const HEADS: Readonly<Record<'none' | 'slime' | 'lantern' | 'hump', HeadDef>> = {
  none: NO_HEAD,
  slime: {
    name: 'Slime Gland',
    blurb: 'Spit slime behind you (or ahead of you) so rivals skid on it',
    mass: 0,
    spewTicks: seconds(0.5),
    blobAngleDeg: 60,
    blobBack: 4.5,
    blobAhead: 14,
    slickLifeTicks: seconds(7),
    slickRadius: 3.4,
    slickGripMul: 0.2,
    cooldownTicks: seconds(8),
  },
  // Jack-o'-Lantern Head is passive: it lights up the shortcut to the next checkpoint (HUD side only).
  lantern: { ...NO_HEAD, name: "Jack-o'-Lantern", blurb: 'Lights the way to the next checkpoint' },
  // Hunchback Hump: a sack that carries one spare part (not a head part) and swaps it in when that slot is empty.
  hump: { ...NO_HEAD, name: 'Hunchback Hump', blurb: 'Carries one spare part and fits it when a slot empties; a bit heavier', mass: 0.2 },
};
export const HEAD_PARTS: readonly HeadDef[] = [HEADS.none, HEADS.slime, HEADS.lantern, HEADS.hump];

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
/** A monster-to-monster contact is a crash only when the bodies close at least this fast (m/s, about 29 km/h); a gentler bump does not count. */
export const HIT_MIN_CLOSING_MS = 8;
/** A monster-to-monster impact this hard (m/s, about 58 km/h closing) counts as two hits: a serious crash. */
export const HIT_HEAVY_CLOSING_MS = 16;
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

// Crab Claws grab (the arms button): clamp onto a rival ahead and hold on; if the rival does not break free in time the
// grabber steals a part from them. With no rival in reach it reaches for a loose part instead.
/** A rival must be within this many metres, and within CLAW_GRAB_CONE_COS of the nose, to be grabbed. */
export const CLAW_GRAB_RANGE = 6.5;
export const CLAW_GRAB_CONE_COS = 0.64;
/** Loose parts can be reached from farther away, in a wider cone. */
export const CLAW_PICKUP_RANGE = 9;
export const CLAW_PICKUP_CONE_COS = 0.5;
export const CLAW_GRAB_TICKS = seconds(1.6);
export const CLAW_GRAB_COOLDOWN = seconds(6);
export const CLAW_MISS_COOLDOWN = seconds(1.2);
export const CLAW_FREED_COOLDOWN = seconds(3);
export const CLAW_PICKUP_COOLDOWN = seconds(3);
/** A grabbed monster frees itself by swinging the steering hard from one side to the other this many times. */
export const STRUGGLE_FLIPS = 3;
/** A grabber and the monster it grabs cannot hurt each other (or steal from each other by ramming) while the grab lasts and for this long after. */
export const GRAB_SHIELD_TICKS = seconds(1);
/** After breaking free (or being let go) a monster cannot be grabbed again for this long. */
export const GRAB_IMMUNE_TICKS = seconds(2.5);

// Lobby: a player counts as being in the room while their client keeps announcing itself; after this long without
// hearing from them they are treated as gone (so a ghost can never block the host from starting).
export const PRESENCE_TIMEOUT_TICKS = seconds(6);
