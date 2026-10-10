export const theme = {
  background: '#1a1a2e',
  surface: '#16213e',
  primary: '#667eea',
  secondary: '#764ba2',
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.7)',
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
