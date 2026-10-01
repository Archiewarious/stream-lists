import { createDevTwitchApi } from '@shared/twitch/devTwitchApi';

/** The subset of Twitch.ext the extension uses — so it can be swapped for a local imitation. */
export interface TwitchApi {
  getBroadcasterConfig: () => string | undefined;
  onConfigChanged: (callback: () => void) => void;
  setBroadcasterConfig: (content: string) => void;
  sendBroadcast: (content: string) => void;
  /** Returns an unsubscribe function. */
  listenBroadcast: (callback: (content: string) => void) => () => void;
}

const CONFIG_VERSION = '1';

const realTwitchApi: TwitchApi = {
  getBroadcasterConfig: () => Twitch.ext.configuration.broadcaster?.content,
  onConfigChanged: (callback) => Twitch.ext.configuration.onChanged(callback),
  setBroadcasterConfig: (content) => Twitch.ext.configuration.set('broadcaster', CONFIG_VERSION, content),
  sendBroadcast: (content) => Twitch.ext.send('broadcast', 'application/json', content),
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
