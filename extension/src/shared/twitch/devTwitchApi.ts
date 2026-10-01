import type { TwitchApi } from '@shared/twitch/twitchApi';

const STORAGE_KEY = 'stream-lists:dev-config';

/**
 * Local stand-in for Twitch.ext used only in development: the broadcaster config lives in localStorage
 * and PubSub runs between tabs over BroadcastChannel, so config.html and panel.html can be opened side by side.
 */
export const createDevTwitchApi = (): TwitchApi => {
  const pubsub = new BroadcastChannel('stream-lists:dev-pubsub');

  return {
    getBroadcasterConfig: () => localStorage.getItem(STORAGE_KEY) ?? undefined,
    onConfigChanged: (callback) => {
      setTimeout(callback);
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) callback();
      });
    },
    setBroadcasterConfig: (content) => localStorage.setItem(STORAGE_KEY, content),
    sendBroadcast: (content) => pubsub.postMessage(content),
    listenBroadcast: (callback) => {
      const handleMessage = (event: MessageEvent<string>) => callback(event.data);
      pubsub.addEventListener('message', handleMessage);
      return () => pubsub.removeEventListener('message', handleMessage);
    },
  };
};
