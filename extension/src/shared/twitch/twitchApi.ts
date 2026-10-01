import { createDevTwitchApi } from '@shared/twitch/devTwitchApi';

export interface TwitchAuth {
  token: string;
  channelId: string;
}

/** The subset of Twitch.ext the extension uses — so it can be swapped for a local imitation. */
export interface TwitchApi {
  workerUrl: string;
  onAuthorized: (callback: (auth: TwitchAuth) => void) => void;
  getBroadcasterConfig: () => string | undefined;
  onConfigChanged: (callback: () => void) => void;
  /** Returns an unsubscribe function. */
  listenBroadcast: (callback: (content: string) => void) => () => void;
  /** Dev only: the local Worker can't reach Twitch, so the config page hands the snapshot to the imitation itself. */
  mirrorSnapshot?: (content: string) => void;
}

const realTwitchApi: TwitchApi = {
  workerUrl: 'https://stream-lists.begidan32.workers.dev',
  onAuthorized: (callback) => Twitch.ext.onAuthorized(({ token, channelId }) => callback({ token, channelId })),
  getBroadcasterConfig: () => Twitch.ext.configuration.broadcaster?.content,
  onConfigChanged: (callback) => Twitch.ext.configuration.onChanged(callback),
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
