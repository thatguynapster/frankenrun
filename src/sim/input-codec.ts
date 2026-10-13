import { defineSyncplayInputCodec, type CanonicalValue } from '@series-inc/rundot-syncplay';
import type { GameInput } from './game.js';

const codec = defineSyncplayInputCodec<GameInput>({
  throttle: { kind: 'int', min: -100, max: 100 },
  steer: { kind: 'int', min: -100, max: 100 },
  arms: { kind: 'boolean' },
  head: { kind: 'boolean' },
  legs: { kind: 'boolean' },
  reset: { kind: 'boolean' },
  ready: { kind: 'boolean' },
  bodySel: { kind: 'int', min: 0, max: 7, neutral: 0 },
  legsSel: { kind: 'int', min: 0, max: 7, neutral: 1 },
  armsSel: { kind: 'int', min: 0, max: 7, neutral: 1 },
  headSel: { kind: 'int', min: 0, max: 7, neutral: 1 },
});

export const encodeInput = codec.encodeInput;
export const decodeInput = (value: CanonicalValue): GameInput => codec.decodeInput(value);
