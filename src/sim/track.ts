// Greybox arena for M1: a flat plane, box obstacles, tentacle anchor poles, 3 checkpoints.
// Plain data only (no DOM, no Math.random) so it can be bound into runtime identity.

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface BoxObstacle {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly height: number;
}

export const ARENA_HALF = 260;

/** Start grid: slot i spawns at x = START_X0 + i * START_DX, facing +z. */
export const START_Z = 0;
export const START_X0 = -6;
export const START_DX = 4;

/** Ordered checkpoints. The last one is the finish. */
export const CHECKPOINTS: readonly Vec2[] = [
  { x: 0, z: 140 },
  { x: 150, z: 200 },
  { x: 150, z: 40 },
];

/** Tentacle anchor poles at the corners. */
export const POLES: readonly (Vec2 & { readonly id: string })[] = [
  { id: 'pole-0', x: 22, z: 160 },
  { id: 'pole-1', x: 130, z: 180 },
  { id: 'pole-2', x: 130, z: 20 },
];

export const OBSTACLES: readonly BoxObstacle[] = [
  { id: 'box-0', x: -8, z: 60, halfX: 3, halfZ: 3, height: 3 },
  { id: 'box-1', x: 8, z: 90, halfX: 3, halfZ: 3, height: 3 },
  { id: 'box-2', x: 70, z: 190, halfX: 4, halfZ: 4, height: 3 },
  { id: 'box-3', x: 95, z: 215, halfX: 4, halfZ: 4, height: 3 },
  { id: 'box-4', x: 150, z: 120, halfX: 6, halfZ: 3, height: 3 },
  { id: 'box-5', x: 135, z: 80, halfX: 3, halfZ: 6, height: 3 },
];
