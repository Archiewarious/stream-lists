import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';

import { theme } from '@app/theme';
import { useTwitchTheme } from '@shared/twitch/useTwitchTheme';

interface AppProvidersProps {
  children: ReactNode;
}

const AppProviders = ({ children }: AppProvidersProps) => {
  const colorScheme = useTwitchTheme();

  return (
    <MantineProvider theme={theme} forceColorScheme={colorScheme}>
      {children}
    </MantineProvider>
  );
};

export default AppProviders;
