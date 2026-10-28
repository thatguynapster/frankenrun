export const theme = {
  // Monster Mash: plum-black night, pumpkin orange as the loud accent, witch purple in support, bone-white text.
  background: '#0d0716',
  surface: '#1b1033',
  primary: '#ff8a1f',
  secondary: '#9a5abf',
  text: '#f3ecd2',
  textMuted: 'rgba(243, 236, 210, 0.72)',
};

export type Theme = typeof theme;

export function applyTheme(t: Theme): void {
  const s = document.documentElement.style;
  s.setProperty('--color-background', t.background);
  s.setProperty('--color-surface', t.surface);
  s.setProperty('--color-primary', t.primary);
  s.setProperty('--color-secondary', t.secondary);
  s.setProperty('--color-text', t.text);
  s.setProperty('--color-text-muted', t.textMuted);
}
