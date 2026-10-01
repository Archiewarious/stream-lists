// The streamer's panel theme: a preset or two own colors. Shared with the extension, so no Workers-only APIs here.

export const THEME_PRESETS = ['fox', 'twitch', 'sunset', 'mint', 'ice', 'cherry'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
export type ChannelTheme = { preset: ThemePreset } | { primary: string; accent: string };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A valid theme from untrusted JSON (request body, stored row, snapshot), otherwise null. */
export const parseTheme = (value: unknown): ChannelTheme | null => {
  if (!value || typeof value !== 'object') return null;
  const { preset, primary, accent } = value as Record<string, unknown>;
  if (THEME_PRESETS.includes(preset as ThemePreset)) return { preset: preset as ThemePreset };
  if (typeof primary === 'string' && typeof accent === 'string' && HEX_COLOR.test(primary) && HEX_COLOR.test(accent)) {
    return { primary: primary.toLowerCase(), accent: accent.toLowerCase() };
  }
  return null;
};
