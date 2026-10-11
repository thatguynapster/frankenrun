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
  legsSel: { kind: 'boolean', neutral: true },
  armsSel: { kind: 'boolean', neutral: true },
  headSel: { kind: 'boolean', neutral: true },
});

export const encodeInput = codec.encodeInput;
export const decodeInput = (value: CanonicalValue): GameInput => codec.decodeInput(value);
