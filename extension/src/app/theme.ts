import { createTheme } from '@mantine/core';

/** Twitch-like palette so the extension blends into the channel page. */
export const theme = createTheme({
  primaryColor: 'twitch',
  primaryShade: { light: 5, dark: 4 },
  fontFamily: 'Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif',
  colors: {
    twitch: [
      '#f3ecff',
      '#e3d5ff',
      '#c7a8ff',
      '#a970ff',
      '#9147ff',
      '#772ce8',
      '#5c16c5',
      '#451093',
      '#330c6e',
      '#1f0745',
    ],
    dark: [
      '#efeff1',
      '#dedee3',
      '#adadb8',
      '#848494',
      '#53535f',
      '#3d3d40',
      '#26262c',
      '#1f1f23',
      '#18181b',
      '#0e0e10',
    ],
  },
});
