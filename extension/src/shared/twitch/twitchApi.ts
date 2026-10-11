import { createDevTwitchApi } from '@shared/twitch/devTwitchApi';
import { fanOut } from '@shared/twitch/fanOut';

export interface TwitchAuth {
  token: string;
  channelId: string;
}

/** The subset of Twitch.ext the extension uses — so it can be swapped for a local imitation. */
export interface TwitchApi {
  workerUrl: string;
  /** Returns an unsubscribe function, like the two below. */
  onAuthorized: (callback: (auth: TwitchAuth) => void) => () => void;
  getBroadcasterConfig: () => string | undefined;
  onConfigChanged: (callback: () => void) => () => void;
  listenBroadcast: (callback: (content: string) => void) => () => void;
  /** Dev only: the local Worker can't reach Twitch, so useChannel (settings window, streamer's panel) hands the snapshot to the imitation itself. */
  mirrorSnapshot?: (content: string) => void;
}

const realTwitchApi: TwitchApi = {
  workerUrl: 'https://stream-lists.begidan32.workers.dev',
  onAuthorized: fanOut<TwitchAuth>((emit) => Twitch.ext.onAuthorized(({ token, channelId }) => emit({ token, channelId }))),
  getBroadcasterConfig: () => Twitch.ext.configuration.broadcaster?.content,
  onConfigChanged: fanOut<void>((emit) => Twitch.ext.configuration.onChanged(() => emit())),
  listenBroadcast: (callback) => {
    const handleMessage = (_target: string, _contentType: string, message: string) => callback(message);
    Twitch.ext.listen('broadcast', handleMessage);
    return () => Twitch.ext.unlisten('broadcast', handleMessage);
  },
};

/** Outside the Twitch iframe (`npm run dev` in a regular tab) Twitch is imitated locally. */
const checkIsOutsideTwitch = () => window.self === window.top;

export const twitchApi: TwitchApi =
  import.meta.env.DEV && checkIsOutsideTwitch() ? createDevTwitchApi() : realTwitchApi;
