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
  readonly accel: number;
  readonly turn: number;
}

export interface LegsDef {
  readonly name: string;
  readonly driveMul: number;
  readonly topSpeedMul: number;
  readonly gripMul: number;
}

export interface ArmsDef {
  readonly name: string;
  readonly grabRange: number;
  readonly swingTicks: number;
  readonly cooldownTicks: number;
  readonly missCooldownTicks: number;
  readonly missSpinTicks: number;
  readonly missSpinTorque: number;
}

export interface HeadDef {
  readonly name: string;
  readonly trailTicks: number;
  readonly dropEveryTicks: number;
  readonly slickLifeTicks: number;
  readonly slickRadius: number;
  readonly slickGripMul: number;
  readonly cooldownTicks: number;
}

export const BODIES: readonly BodyDef[] = [{ name: 'Stitched Brute', mass: 1.4, accel: 0.8, turn: 0.8 }];

export const LEGS: Readonly<Record<'none' | 'werewolf', LegsDef>> = {
  none: { name: 'Stumps', driveMul: 1, topSpeedMul: 1, gripMul: 1 },
  werewolf: { name: 'Werewolf Legs', driveMul: 1.35, topSpeedMul: 1.25, gripMul: 0.7 },
};

export const ARMS: Readonly<Record<'tentacles', ArmsDef>> = {
  tentacles: {
    name: 'Tentacles',
    grabRange: 6,
    swingTicks: 60,
    cooldownTicks: seconds(3),
    missCooldownTicks: seconds(3),
    missSpinTicks: 12,
    missSpinTorque: 6,
  },
};

export const HEADS: Readonly<Record<'slime', HeadDef>> = {
  slime: {
    name: 'Slime Gland',
    trailTicks: seconds(4),
    dropEveryTicks: 3,
    slickLifeTicks: seconds(4),
    slickRadius: 2.5,
    slickGripMul: 0.2,
    cooldownTicks: seconds(8),
  },
};

// Race flow
export const COUNTDOWN_TICKS = 90;
export const FINISH_WINDOW_TICKS = seconds(30);
export const CHECKPOINT_RADIUS = 12;
export const RESET_HOLD_TICKS = 30;
export const RESET_FREEZE_TICKS = 60;

// Chassis geometry (metres)
export const CHASSIS_HALF = { x: 0.7, y: 0.35, z: 1.2 } as const;
export const RIDE_HEIGHT = 1.0;
