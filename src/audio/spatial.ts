// How loud another monster's sound is, by distance. Pure so it can be tested without a browser.

/** Inside NEAR metres a sound plays at full level; beyond FAR it is inaudible. */
export const NEAR = 8;
export const FAR = 70;

export function distanceGain(distance: number): number {
  if (distance <= NEAR) return 1;
  if (distance >= FAR) return 0;
  const t = (distance - NEAR) / (FAR - NEAR);
  return (1 - t) * (1 - t);
}
