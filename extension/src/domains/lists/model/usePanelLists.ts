import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChannelList } from '@worker/snapshot';
import { fromChannelLists, parseSnapshot, type PanelList } from '@domains/lists/lib/panelLists';
import { callWorker } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

/**
 * Viewer lists. The snapshot from the Twitch config shows up instantly and follows PubSub updates;
 * the full lists (whole history, search) are fetched from the Worker only when the viewer needs them.
 */
export const usePanelLists = () => {
  const [snapshot, setSnapshot] = useState<PanelList[] | null>(null);
  const [full, setFull] = useState<PanelList[] | null>(null);
  // Bumped on every snapshot: a full fetch started before it is stale and dropped.
  const generation = useRef(0);
  const fullRequest = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const applySnapshot = (content: string | undefined) => {
      generation.current += 1;
      fullRequest.current = null;
      setSnapshot(parseSnapshot(content) ?? []);
      setFull(null);
    };
    twitchApi.onConfigChanged(() => applySnapshot(twitchApi.getBroadcasterConfig()));
    return twitchApi.listenBroadcast(applySnapshot);
  }, []);

  const loadFull = useCallback(() => {
    const requestGeneration = generation.current;
    fullRequest.current ??= callWorker<{ lists: ChannelList[] }>('GET', '/api/viewer/channel')
      .then(({ lists }) => {
        if (requestGeneration === generation.current) setFull(fromChannelLists(lists));
      })
      .catch(() => {
        fullRequest.current = null; // the snapshot stays on screen; the next need retries
      });
  }, []);

  return { lists: full ?? snapshot, isFull: !!full, loadFull };
};
