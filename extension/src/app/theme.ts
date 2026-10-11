import { Button, createTheme, Modal, type CSSVariablesResolver } from '@mantine/core';

/** Fonts come from styles.css (--sans; titles get --script there). `closeLabel` names the × of every dialog. */
export const createAppTheme = (closeLabel: string) =>
  createTheme({
    fontFamily: 'var(--sans)',
    defaultRadius: 'xl',
    components: {
      // Explicit, so styles.css can target [data-variant='filled'] (Mantine omits the attribute for the default).
      Button: Button.extend({ defaultProps: { variant: 'filled' } }),
      Modal: Modal.extend({ defaultProps: { closeButtonProps: { 'aria-label': closeLabel } } }),
    },
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
