import { MantineProvider } from '@mantine/core';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { createAppTheme, cssVariablesResolver } from '@app/theme';
import ErrorBoundary from '@shared/ui/ErrorBoundary';

interface AppProvidersProps {
  children: ReactNode;
}

const Failed = () => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm" role="alert">
      <p>{t('common.crashed')}</p>
      <button type="button" className="font-bold text-[var(--primary-text)]" onClick={() => window.location.reload()}>
        {t('common.reload')}
      </button>
    </div>
  );
};

/** Always dark: the panel wears the streamer's theme, not the viewer's Twitch light/dark mode. */
const AppProviders = ({ children }: AppProvidersProps) => {
  const { t } = useTranslation();
  const theme = useMemo(() => createAppTheme(t('common.close')), [t]);

  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="dark">
      <ErrorBoundary fallback={<Failed />}>{children}</ErrorBoundary>
    </MantineProvider>
  );
};

export default AppProviders;
