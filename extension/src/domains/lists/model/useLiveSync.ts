import { useEffect, useState } from 'react';

import type { Channel } from '@domains/lists/model/useChannel';
import { callWorker, WorkerError } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

// How often the open panel asks the Worker to look at Pointauc (the cron there runs once a minute at best). Twice as
// long after each failure (Pointauc's tab closed), up to MAX_REFRESH_MS; nothing while the page is hidden.
const REFRESH_MS = 12_000;
const MAX_REFRESH_MS = 120_000;

/** Every snapshot the Worker broadcasts (cron sync, another window) reloads the lists, unless it shows what they have. */
export const useBroadcastReload = ({ onBroadcast }: Pick<Channel, 'onBroadcast'>) => {
  useEffect(() => twitchApi.listenBroadcast(onBroadcast), [onBroadcast]);
};

/**
 * Keeps the streamer's open panel current without a page reload: broadcasts as above, and while Pointauc sync is on,
 * a sync pass every REFRESH_MS, so a lot added in the auction shows up in the queue almost at once — one request at
 * a time. Returns why the latest pass failed (null — it did not).
 */
export const useLiveSync = ({ reload, onBroadcast, pointaucListId }: Pick<Channel, 'reload' | 'onBroadcast' | 'pointaucListId'>) => {
  useBroadcastReload({ onBroadcast });
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setSyncError(null);
    if (pointaucListId === null) return;
    let isStopped = false;
    let isRunning = false;
    let timer: number | undefined;
    let delay = REFRESH_MS;

    const refresh = async () => {
      window.clearTimeout(timer);
      timer = undefined;
      if (isRunning || document.hidden) return; // a hidden page starts again on visibilitychange
      isRunning = true;
      try {
        const { changed } = await callWorker<{ changed: boolean }>('POST', '/api/pointauc/refresh');
        if (isStopped) return;
        delay = REFRESH_MS;
        setSyncError(null);
        if (changed) await reload();
      } catch (error) {
        if (isStopped) return;
        delay = Math.min(delay * 2, MAX_REFRESH_MS);
        setSyncError((error as Error).message);
        // The token has to be entered again: the reload shows Pointauc as not connected.
        if (error instanceof WorkerError && error.status === 409) reload();
      } finally {
        isRunning = false;
      }
      if (!isStopped && !document.hidden) timer = window.setTimeout(refresh, delay);
    };
    const handleVisibility = () => {
      if (!document.hidden && timer === undefined) refresh();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    refresh();
    return () => {
      isStopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [pointaucListId, reload]);

  return syncError;
};
