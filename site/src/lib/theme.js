/** 開催回ごとのアクセント色。 */

const THEMES = {
  '2026-summer': {
    accent: '#473DC1',
    accentInk: '#473DC1',
    accentInkDark: '#A9A2F5',
    onAccent: '#FFFFFF',
  },
  '2026-winter': {
    accent: '#FCD56B',
    accentInk: '#8A5A00',
    accentInkDark: '#F4CE74',
    onAccent: '#2A2100',
  },
  '2025-summer': {
    accent: '#288BD2',
    accentInk: '#1B6FAA',
    accentInkDark: '#7FC3EE',
    onAccent: '#FFFFFF',
  },
};

/** 未登録の開催回に使うテーマ色。 */
const FALLBACK = {
  accent: '#0E7A62',
  accentInk: '#0B5C4A',
  accentInkDark: '#6FD9BE',
  onAccent: '#FFFFFF',
};

export function eventTheme(eventId) {
  return THEMES[eventId] ?? FALLBACK;
}

/** 開催回テーマをCSSカスタムプロパティに変換する。 */
export function themeStyle(eventId) {
  const theme = eventTheme(eventId);
  return [
    `--accent:${theme.accent}`,
    `--accent-ink-light:${theme.accentInk}`,
    `--accent-ink-dark:${theme.accentInkDark}`,
    `--on-accent:${theme.onAccent}`,
  ].join(';');
}
