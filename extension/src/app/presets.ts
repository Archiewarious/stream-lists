import type { ChannelTheme, ThemePreset } from '@worker/theme';

/** A theme is four colors; glass, chips, glow and the aurora background are derived from them in styles.css. */
export interface ThemeColors {
  bg: string;
  /** Top and bottom of the button gradient. */
  primaryHi: string;
  primaryLo: string;
  /** "Watched" chips and the second aurora glow. */
  accent: string;
}

// `fox` is also the default in styles.css (`:root`) so the page is painted before any JS runs — keep them in sync.
export const PRESETS = {
  fox: { bg: '#140b1f', primaryHi: '#f290ff', primaryLo: '#9a2fe0', accent: '#ff7ac1' },
  twitch: { bg: '#100c18', primaryHi: '#b98cff', primaryLo: '#772ce8', accent: '#ff7ad9' },
  sunset: { bg: '#1c0d12', primaryHi: '#ffc27a', primaryLo: '#ff5f7e', accent: '#ff9a6b' },
  mint: { bg: '#0a1615', primaryHi: '#8ff5d6', primaryLo: '#1aa889', accent: '#7fd4ff' },
  ice: { bg: '#0a1020', primaryHi: '#b4e1ff', primaryLo: '#4a86ff', accent: '#9f8bff' },
  cherry: { bg: '#1a0a10', primaryHi: '#ff8aa8', primaryLo: '#c4123f', accent: '#ffb36b' },
} satisfies Record<ThemePreset, ThemeColors>;

export type PresetId = ThemePreset;

export const DEFAULT_THEME: ChannelTheme = { preset: 'fox' };

/** Own colors: one main color gives the gradient and a dark tinted background (CSS color-mix, no JS color math). */
export const getThemeColors = (theme: ChannelTheme | null): ThemeColors => {
  if (!theme) return PRESETS.fox;
  if ('preset' in theme) return PRESETS[theme.preset];
  return {
    bg: `color-mix(in oklab, ${theme.primary} 12%, #0b0710)`,
    primaryHi: `color-mix(in oklab, ${theme.primary}, white 40%)`,
    primaryLo: `color-mix(in oklab, ${theme.primary}, black 25%)`,
    accent: theme.accent,
  };
};

export const applyTheme = (theme: ChannelTheme | null) => {
  const { bg, primaryHi, primaryLo, accent } = getThemeColors(theme);
  const { style } = document.documentElement;
  style.setProperty('--bg', bg);
  style.setProperty('--primary-hi', primaryHi);
  style.setProperty('--primary-lo', primaryLo);
  style.setProperty('--accent', accent);
};
