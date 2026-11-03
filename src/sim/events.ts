// Random-feeling moments in a race: mystery boxes, street events and wandering creatures. Everything here is a pure
// function of the tick and the room's seed, so every client sees the same thing at the same time.

/** What a mystery box can give. 0 means nothing. */
export const ITEM_SURGE = 1;
export const ITEM_SHIELD = 2;
export const ITEM_SLIME = 3;
export const ITEM_MEND = 4;
export const ITEM_JINX = 5;

export const SURGE_TICKS = 105;
export const SHIELD_TICKS = 300;
export const SLIME_TICKS = 150;
export const JINX_TICKS = 75;
/** Extra push along the heading while surging (metres per tick per tick; a boost pad is 0.05). */
export const SURGE_ACCEL = 0.035;
/** Drive multiplier while slowed (a jinx, a roamer bump or a lightning strike). */
export const SLOW_DRIVE_MUL = 0.4;

/**
 * Picks a mystery box prize. `behind` is 0 for the leader up to 1 for last place: those behind get better odds
 * of a surge or a mend, the leader is more likely to be jinxed.
 */
export function rollItem(behind: number, hasEmptySlot: boolean, roll: number): number {
  const weights = [
    [ITEM_SURGE, 30 + 40 * behind],
    [ITEM_SHIELD, 25],
    [ITEM_SLIME, 20],
    [ITEM_MEND, hasEmptySlot ? 15 + 25 * behind : 0],
    [ITEM_JINX, 2 + 10 * (1 - behind)],
  ] as const;
  const total = weights.reduce((sum, w) => sum + w[1], 0);
  let pick = ((roll % 1000) / 1000) * total;
  for (const [item, weight] of weights) {
    if (pick < weight) return item;
    pick -= weight;
  }
  return ITEM_SURGE;
}

/** Street events: a warning is shown on the road, then it happens. */
export const EVENT_LIGHTNING = 1;
export const EVENT_FLOOD = 2;
export const EVENT_RAIN = 3;

export interface StreetEvent {
  readonly kind: number;
  /** Metres. */
  readonly x: number;
  readonly z: number;
  /** Heading of the road there (unit vector). */
  readonly dx: number;
  readonly dz: number;
  /** Tick it happens; the warning has been showing since EVENT_TELEGRAPH_TICKS before. */
  readonly fireAt: number;
}

export const EVENT_FIRST_TICKS = 18 * 30;
export const EVENT_PERIOD_TICKS = 24 * 30;
export const EVENT_TELEGRAPH_TICKS = 75;
/** How far ahead of the leader an event is placed, along the route. */
export const EVENT_AHEAD_M = 95;
/** How long a finished event stays in the list (so the flash can play). */
export const EVENT_LINGER_TICKS = 30;
export const LIGHTNING_RADIUS = 6.5;
export const LIGHTNING_SHOVE = 0.16;
export const LIGHTNING_SLOW_TICKS = 45;
export const FLOOD_PUDDLES = 5;
export const FLOOD_STEP_M = 7;
export const FLOOD_LIFE_TICKS = 14 * 30;
export const RAIN_PARTS = 3;
export const RAIN_STEP_M = 13;
/** Wandering creatures (see features.ts): what each kind does to a monster. */
/** Only creatures within this distance of a racing monster are looked at by the simulation. */
export const ROAMER_ACTIVE_M = 40;

/** Zombie: a solid body. Closer than this (monster centre to zombie centre) it blocks the way. */
export const ZOMBIE_CONTACT_M = 2.1;
/** Approach speed (m/s) from which hitting a zombie counts as a crash, and how long it slows the monster. */
export const ZOMBIE_HIT_MS = 11;
export const ZOMBIE_SLOW_TICKS = 25;

/** Ghost: a chilling aura that slows, and a touch that spooks (steering is reversed for a moment). */
export const GHOST_AURA_M = 6.5;
export const GHOST_TOUCH_M = 2.4;
export const SPOOK_TICKS = 36;
export const CHILL_DRIVE_MUL = 0.62;

/** Pumpkin walker: a springy bumper, and a stomp every few seconds that shoves and slows everyone close. */
export const PUMPKIN_CONTACT_M = 2.5;
export const STOMP_PERIOD_TICKS = 150;
export const STOMP_WINDUP_TICKS = 36;
export const STOMP_RADIUS_M = 7.5;
export const STOMP_SHOVE = 0.26;
export const STOMP_SLOW_TICKS = 30;
