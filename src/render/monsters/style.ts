// A player's look-and-feel choices for their monster: a colour tint and a hat or horns. Purely cosmetic: it never touches
// the simulation. Chosen in the lobby, saved on the device and shared with the room over the ephemeral channel (a few
// bytes alongside the gametag), so everyone sees everyone's style.

export interface Style {
  /** Index into TINTS. */
  readonly tint: number;
  /** Index into HATS. */
  readonly hat: number;
}

export const DEFAULT_STYLE: Style = { tint: 0, hat: 0 };

/** The colour is multiplied into the monster's own colours, so it shifts the whole monster's mood without repainting it. */
export const TINTS: readonly { readonly name: string; readonly color: number }[] = [
  { name: 'Natural', color: 0xffffff },
  { name: 'Moss', color: 0xa9e0a0 },
  { name: 'Ash', color: 0xb9bdcc },
  { name: 'Ember', color: 0xffa98a },
  { name: 'Frost', color: 0x9fc8ff },
  { name: 'Orchid', color: 0xffa9e2 },
];

export const HATS: readonly { readonly name: string; readonly glyph: string }[] = [
  { name: 'None', glyph: '' },
  { name: 'Top hat', glyph: '🎩' },
  { name: 'Witch hat', glyph: '🧙' },
  { name: 'Crown', glyph: '👑' },
  { name: 'Devil horns', glyph: '😈' },
  { name: 'Antlers', glyph: '🦌' },
  { name: 'Halo', glyph: '😇' },
];

const within = (value: unknown, count: number): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count ? value : 0);

/** Anything read from storage or from another player is checked before use. */
export function cleanStyle(raw: unknown): Style {
  const r = (raw ?? {}) as { tint?: unknown; hat?: unknown };
  return { tint: within(r.tint, TINTS.length), hat: within(r.hat, HATS.length) };
}

/** A style as one small number (for the ephemeral channel). */
export const packStyle = (s: Style): number => s.tint * 16 + s.hat;

export function unpackStyle(value: unknown): Style | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) return undefined;
  return cleanStyle({ tint: Math.floor(value / 16), hat: value % 16 });
}

/** AI racers get a look of their own, always the same for a given slot. */
export function botStyle(slot: number): Style {
  return { tint: (slot * 5 + 1) % TINTS.length, hat: (slot * 3 + 2) % HATS.length };
}
