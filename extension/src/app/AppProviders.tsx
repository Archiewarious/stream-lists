import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/cyrillic-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/cyrillic-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/cyrillic-800.css';
import '@fontsource/great-vibes/latin-400.css';
import '@fontsource/great-vibes/cyrillic-400.css';

import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';

import { cssVariablesResolver, theme } from '@app/theme';

interface AppProvidersProps {
  children: ReactNode;
}

/** Always dark: the panel wears the streamer's theme, not the viewer's Twitch light/dark mode. */
const AppProviders = ({ children }: AppProvidersProps) => (
  <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="dark">
    {children}
  </MantineProvider>
);

export default AppProviders;
