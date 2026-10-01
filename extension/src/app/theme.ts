import { createTheme, type CSSVariablesResolver } from '@mantine/core';

export const theme = createTheme({
  fontFamily: 'Nunito, system-ui, sans-serif',
  headings: { fontFamily: "'Great Vibes', cursive", fontWeight: '400' },
  defaultRadius: 'xl',
});

/** Points Mantine's own colors at the theme variables from styles.css, so presets repaint Mantine too. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': 'var(--bg)',
    '--mantine-color-text': 'var(--text)',
    '--mantine-color-dimmed': 'var(--text-2)',
    '--mantine-color-placeholder': 'var(--text-3)',
    '--mantine-color-default-border': 'var(--glass-edge)',
    '--mantine-primary-color-filled': 'var(--primary)',
    '--mantine-primary-color-filled-hover': 'var(--primary-lo)',
    '--mantine-primary-color-light': 'var(--selected)',
    '--mantine-primary-color-light-hover': 'var(--selected)',
    '--mantine-primary-color-light-color': 'var(--tint)',
  },
});
