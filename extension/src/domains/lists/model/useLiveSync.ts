import { useEffect } from 'react';

import type { Channel } from '@domains/lists/model/useChannel';
import { callWorker } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

// How often the open panel asks the Worker to look at Pointauc (the cron there runs once a minute at best).
const REFRESH_MS = 12_000;

/**
 * Keeps the streamer's open panel current without a page reload:
 * - every update the Worker publishes (cron sync, another window) arrives as a broadcast → reload the lists;
 * - while Pointauc sync is on, a sync pass is requested every few seconds, so a lot added in the auction
 *   shows up in the queue almost at once.
 */
export const useLiveSync = ({ reload, pointaucListId }: Pick<Channel, 'reload' | 'pointaucListId'>) => {
  useEffect(() => twitchApi.listenBroadcast(() => reload()), [reload]);

  useEffect(() => {
    if (pointaucListId === null) return;
    let isStopped = false;

    const refresh = async () => {
      try {
        const { changed } = await callWorker<{ changed: boolean }>('POST', '/api/pointauc/refresh');
        if (changed && !isStopped) await reload();
      } catch {
        // Pointauc tab closed or Twitch hiccup: the next tick tries again
      }
    };

    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      isStopped = true;
      window.clearInterval(timer);
    };
  }, [pointaucListId, reload]);
};
