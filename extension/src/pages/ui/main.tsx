import { createRoot } from 'react-dom/client';

import '@app/styles.css';
import AppProviders from '@app/AppProviders';
import UiPage from '@pages/ui/UiPage';

createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <UiPage />
  </AppProviders>,
);
