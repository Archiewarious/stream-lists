import { Loader } from '@mantine/core';
import { lazy, Suspense } from 'react';

import { useRole } from '@shared/twitch/useRole';
import ViewerPanel from '@pages/panel/ViewerPanel';

// The editor (drag and drop, modals, forms) is the streamer's alone: viewers never download it.
const AuthorSide = lazy(() => import('@pages/panel/AuthorSide'));

const Loading = () => (
  <div className="flex h-full items-center justify-center">
    <Loader color="var(--primary-hi)" size="sm" />
  </div>
);

/**
 * Viewers get the read-only panel (snapshot from Twitch); the streamer gets the same panel with editing, and "as
 * viewer" previews what the others see. Until Twitch tells who is watching, neither is shown.
 */
const PanelPage = () => {
  const role = useRole();
  if (role === null) return <Loading />;
  if (role !== 'broadcaster') return <ViewerPanel />;
  return (
    <Suspense fallback={<Loading />}>
      <AuthorSide />
    </Suspense>
  );
};

export default PanelPage;
