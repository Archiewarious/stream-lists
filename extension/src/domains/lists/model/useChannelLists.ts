import { useEffect, useState } from 'react';

import { EMPTY_CHANNEL_LISTS, parseChannelLists } from '@domains/lists/lib/channelLists';
import type { ChannelLists } from '@domains/lists/model/types';
import { twitchApi } from '@shared/twitch/twitchApi';

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

  return { channelLists, isLoaded, isCorrupted };
};
