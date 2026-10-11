import { useState } from 'react';

import { fromChannelLists } from '@domains/lists/lib/panelLists';
import { useChannel } from '@domains/lists/model/useChannel';
import { useRole } from '@shared/twitch/useRole';
import AuthorPanel from '@pages/panel/AuthorPanel';
import ViewerPanel from '@pages/panel/ViewerPanel';

/** The streamer's side: one set of live data for editing and for the "as viewer" preview. */
const AuthorSide = () => {
  const channel = useChannel();
  const [isViewerPreview, setIsViewerPreview] = useState(false);

  if (isViewerPreview) {
    return (
      <ViewerPanel
        lists={channel.lists ? fromChannelLists(channel.lists) : null}
        onEdit={() => setIsViewerPreview(false)}
      />
    );
  }
  return <AuthorPanel channel={channel} onViewAsViewer={() => setIsViewerPreview(true)} />;
};

/**
 * Viewers get the read-only panel at once (snapshot from Twitch). The streamer, as soon as Twitch says so,
 * gets the same panel with editing; "as viewer" previews what the others see.
 */
const PanelPage = () => {
  const role = useRole();
  return role === 'broadcaster' ? <AuthorSide /> : <ViewerPanel />;
};

export default PanelPage;
