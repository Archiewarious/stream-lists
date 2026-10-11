import { Loader } from '@mantine/core';
import { useCallback, useState } from 'react';

import { searchItems, VIEWER_PAGE } from '@worker/snapshot';
import { fromChannelLists } from '@domains/lists/lib/panelLists';
import { useChannel } from '@domains/lists/model/useChannel';
import { useLiveSync } from '@domains/lists/model/useLiveSync';
import { useRole } from '@shared/twitch/useRole';
import AuthorPanel from '@pages/panel/AuthorPanel';
import ViewerPanel, { ViewerPanelView } from '@pages/panel/ViewerPanel';

/** The streamer's side: one set of live data for editing and for the "as viewer" preview. */
const AuthorSide = () => {
  const channel = useChannel();
  const syncError = useLiveSync(channel);
  const [isViewerPreview, setIsViewerPreview] = useState(false);
  // The preview has every item already: it searches them in place, the way the Worker searches for viewers.
  const { lists } = channel;
  const search = useCallback(
    async (listId: number, query: string) => searchItems(lists?.find((list) => list.id === listId)?.items ?? [], query, VIEWER_PAGE),
    [lists],
  );

  if (isViewerPreview) {
    return <ViewerPanelView lists={lists ? fromChannelLists(lists) : null} search={search} onEdit={() => setIsViewerPreview(false)} />;
  }
  return <AuthorPanel channel={channel} syncError={syncError} onViewAsViewer={() => setIsViewerPreview(true)} />;
};

/**
 * Viewers get the read-only panel (snapshot from Twitch); the streamer gets the same panel with editing, and "as
 * viewer" previews what the others see. Until Twitch tells who is watching, neither is shown.
 */
const PanelPage = () => {
  const role = useRole();
  if (role === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader color="var(--primary-hi)" size="sm" />
      </div>
    );
  }
  return role === 'broadcaster' ? <AuthorSide /> : <ViewerPanel />;
};

export default PanelPage;
