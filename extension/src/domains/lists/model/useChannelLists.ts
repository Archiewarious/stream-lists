import { useEffect, useRef, useState } from 'react';

import {
  checkFitsConfigLimit,
  EMPTY_CHANNEL_LISTS,
  parseChannelLists,
  serializeChannelLists,
} from '@domains/lists/lib/channelLists';
import type { ChannelLists, ChannelListsChange } from '@domains/lists/model/types';
import { twitchApi } from '@shared/twitch/twitchApi';

// Twitch PubSub rate-limits sends: a burst of clicks becomes one message carrying the latest state.
const BROADCAST_DELAY_MS = 1000;

interface UseChannelListsOptions {
  isEditor: boolean;
}

/**
 * Channel lists stored in the Twitch broadcaster config segment.
 * Viewers follow every update (config + PubSub). The editor loads once and then owns the state:
 * a late echo of its own save would otherwise roll back newer edits.
 */
export const useChannelLists = ({ isEditor }: UseChannelListsOptions) => {
  const [channelLists, setChannelLists] = useState<ChannelLists>(EMPTY_CHANNEL_LISTS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isCorrupted, setIsCorrupted] = useState(false);
  const broadcastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let hasLoaded = false;

    const applyContent = (content: string | undefined) => {
      if (isEditor && hasLoaded) return;
      hasLoaded = true;

      const parsed = parseChannelLists(content);
      setIsCorrupted(parsed === null);
      setChannelLists(parsed ?? EMPTY_CHANNEL_LISTS);
      setIsLoaded(true);
    };

    twitchApi.onConfigChanged(() => applyContent(twitchApi.getBroadcasterConfig()));
    if (isEditor) return;
    return twitchApi.listenBroadcast(applyContent);
  }, [isEditor]);

  /** Saves the change for viewers. Returns false and keeps the old state if it exceeds Twitch's 5 KB limit. */
  const applyChange = (change: ChannelListsChange): boolean => {
    const nextChannelLists = change(channelLists);
    const content = serializeChannelLists(nextChannelLists);
    if (!checkFitsConfigLimit(content)) return false;

    setChannelLists(nextChannelLists);
    twitchApi.setBroadcasterConfig(content);
    window.clearTimeout(broadcastTimer.current);
    broadcastTimer.current = window.setTimeout(() => twitchApi.sendBroadcast(content), BROADCAST_DELAY_MS);
    return true;
  };

  return { channelLists, isLoaded, isCorrupted, applyChange };
};
