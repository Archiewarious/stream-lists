import { useState } from 'react';

import { useRole } from '@shared/twitch/useRole';
import AuthorPanel from '@pages/panel/AuthorPanel';
import ViewerPanel from '@pages/panel/ViewerPanel';

/**
 * Viewers get the read-only panel at once (snapshot from Twitch). The streamer, as soon as Twitch says so,
 * gets the same panel with editing; "as viewer" previews what the others see.
 */
const PanelPage = () => {
  const role = useRole();
  const [isViewerPreview, setIsViewerPreview] = useState(false);

  if (role !== 'broadcaster') return <ViewerPanel />;
  if (isViewerPreview) return <ViewerPanel onEdit={() => setIsViewerPreview(false)} />;
  return <AuthorPanel onViewAsViewer={() => setIsViewerPreview(true)} />;
};

export default PanelPage;
