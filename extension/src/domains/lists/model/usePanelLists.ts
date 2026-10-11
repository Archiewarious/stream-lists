import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChannelList } from '@worker/snapshot';
import { applyTheme } from '@app/presets';
import { fromChannelLists, parseSnapshot, type PanelList } from '@domains/lists/lib/panelLists';
import { callWorker } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

// How long to wait for Twitch's configuration before showing the empty state.
const CONFIG_WAIT_MS = 1500;

/**
 * Viewer lists. The snapshot from the Twitch config shows up instantly and follows PubSub updates;
 * the full lists (whole history, search) are fetched from the Worker only when the viewer needs them.
 */
export const usePanelLists = () => {
  const [snapshotLists, setSnapshotLists] = useState<PanelList[] | null>(null);
  const [full, setFull] = useState<PanelList[] | null>(null);
  // Bumped on every snapshot: a full fetch started before it is stale and dropped.
  const generation = useRef(0);
  const fullRequest = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const applySnapshot = (content: string | undefined) => {
      generation.current += 1;
      fullRequest.current = null;
      const snapshot = parseSnapshot(content);
      setSnapshotLists(snapshot?.lists ?? []);
      applyTheme(snapshot?.theme ?? null); // viewers see the streamer's theme
      setFull(null);
    };
    twitchApi.onConfigChanged(() => applySnapshot(twitchApi.getBroadcasterConfig()));

    // Twitch announces the configuration once and does not repeat it for a late subscriber (the panel re-created
    // by "as viewer", or a page that mounted after the announcement): read what is there right away.
    const initial = twitchApi.getBroadcasterConfig();
    let giveUpTimer: number | undefined;
    if (initial !== undefined) applySnapshot(initial);
    else giveUpTimer = window.setTimeout(() => setSnapshotLists((current) => current ?? []), CONFIG_WAIT_MS);

    const stopListening = twitchApi.listenBroadcast(applySnapshot);
    return () => {
      window.clearTimeout(giveUpTimer);
      stopListening();
    };
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

  return { lists: full ?? snapshotLists, isFull: !!full, loadFull };
};
