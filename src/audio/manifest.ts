// Every sound the game plays. Monster sounds only: the playable characters are monsters, so there are no engine or
// vehicle sounds. `prompt` is what scripts/generate-audio.ts asks the RUN audio generator for; the files it writes
// (public/cdn-assets/audio/<id>[_<n>].mp3) are what the game loads. A missing file just means that sound stays silent.

export type SoundId =
  | 'click'
  | 'count'
  | 'go'
  | 'finish'
  | 'results'
  | 'step'
  | 'growl'
  | 'impact'
  | 'partLoss'
  | 'pickup'
  | 'steal'
  | 'tentacle'
  | 'slime'
  | 'denied'
  | 'respawn';

export interface SoundDef {
  readonly id: SoundId;
  /** Different takes of the same sound, picked at random so repeats do not sound mechanical. */
  readonly variants: number;
  readonly seconds: number;
  /** Relative loudness (0..1) before the player's volume setting. */
  readonly volume: number;
  readonly prompt: string;
}

export const SOUNDS: readonly SoundDef[] = [
  { id: 'click', variants: 1, seconds: 0.5, volume: 0.5, prompt: 'short dry bone tap, a single soft wooden knock, UI button click' },
  { id: 'count', variants: 1, seconds: 1, volume: 0.8, prompt: 'single deep monster drum thump with a low guttural growl, countdown beat' },
  { id: 'go', variants: 2, seconds: 1.5, volume: 1, prompt: 'big punchy monster roar, short and fierce, race start' },
  { id: 'finish', variants: 1, seconds: 2.5, volume: 1, prompt: 'triumphant monster victory roar followed by a gleeful cackle' },
  { id: 'results', variants: 1, seconds: 2, volume: 0.7, prompt: 'spooky playful sting, low monster growl over a ghostly choir swell' },
  { id: 'step', variants: 4, seconds: 0.6, volume: 0.7, prompt: 'single heavy monster footstep stomp on pavement with a wet squelch' },
  { id: 'growl', variants: 3, seconds: 1.5, volume: 0.6, prompt: 'short low menacing monster growl' },
  { id: 'impact', variants: 3, seconds: 1, volume: 0.9, prompt: 'two monster bodies colliding, meaty thud with a pained grunt' },
  { id: 'partLoss', variants: 3, seconds: 1.2, volume: 1, prompt: 'bone crack and wet pop as a monster limb tears off' },
  { id: 'pickup', variants: 2, seconds: 1, volume: 0.9, prompt: 'happy wet gulp and magical sparkle as a monster grabs a body part' },
  { id: 'steal', variants: 2, seconds: 0.8, volume: 0.9, prompt: 'sharp crab claw snap and slash' },
  { id: 'tentacle', variants: 2, seconds: 1, volume: 0.8, prompt: 'wet tentacle whip crack and slither' },
  { id: 'slime', variants: 2, seconds: 1.2, volume: 0.8, prompt: 'gooey slime squelch and splat' },
  { id: 'denied', variants: 1, seconds: 0.5, volume: 0.6, prompt: 'short muffled monster grunt with a dull thud, rejected, not available' },
  { id: 'respawn', variants: 2, seconds: 1, volume: 0.9, prompt: 'quick airy whoosh with a sparkling magical chime, short teleport sound' },
];

export interface MusicDef {
  readonly id: 'music_lobby' | 'music_race';
  readonly seconds: number;
  readonly volume: number;
  readonly prompt: string;
}

export const MUSIC: readonly MusicDef[] = [
  { id: 'music_lobby', seconds: 45, volume: 0.5, prompt: 'mischievous spooky Halloween loop, pizzicato strings and low organ, playful and mysterious, instrumental, seamless loop' },
  { id: 'music_race', seconds: 60, volume: 0.5, prompt: 'energetic playful horror chase music, driving drums, eerie synths and stabbing strings, instrumental, seamless loop' },
];

/** Path of a sound file under the CDN assets folder. */
export function soundFile(id: string, variant = 0, variants = 1): string {
  return variants > 1 ? `audio/${id}_${variant + 1}.mp3` : `audio/${id}.mp3`;
}
