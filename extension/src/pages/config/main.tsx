import { createRoot } from 'react-dom/client';

import '@app/styles.css';
import AppProviders from '@app/AppProviders';
import { initI18n } from '@assets/i18n/initI18n';
import ConfigPage from '@pages/config/ConfigPage';

initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <AppProviders>
      <ConfigPage />
    </AppProviders>,
  );
});
