import { signJwt } from '@worker/jwt';

import type { TwitchApi } from '@shared/twitch/twitchApi';

const STORAGE_KEY = 'stream-lists:dev-config';
// Test secret, the same one `npm run dev:ext` gives the local Worker. Not the real extension secret.
const DEV_SECRET = 'ZGV2LXNlY3JldA==';
const DEV_CHANNEL_ID = '1';

/**
 * Local stand-in for Twitch.ext used only in development: requests go to the local Worker (`worker/: npm run dev:ext`)
 * with a token signed by the test secret; the snapshot lives in localStorage and PubSub runs between tabs
 * over BroadcastChannel, so config.html and panel.html can be opened side by side.
 */
export const createDevTwitchApi = (): TwitchApi => {
  const pubsub = new BroadcastChannel('stream-lists:dev-pubsub');

  return {
    workerUrl: 'http://127.0.0.1:8787',
    onAuthorized: async (callback) => {
      const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      const token = await signJwt({ exp, channel_id: DEV_CHANNEL_ID, role: 'broadcaster' }, DEV_SECRET);
      callback({ token, channelId: DEV_CHANNEL_ID });
    },
    getBroadcasterConfig: () => localStorage.getItem(STORAGE_KEY) ?? undefined,
    onConfigChanged: (callback) => {
      setTimeout(callback);
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) callback();
      });
    },
    listenBroadcast: (callback) => {
      const handleMessage = (event: MessageEvent<string>) => callback(event.data);
      pubsub.addEventListener('message', handleMessage);
      return () => pubsub.removeEventListener('message', handleMessage);
    },
    mirrorSnapshot: (content) => {
      localStorage.setItem(STORAGE_KEY, content);
      pubsub.postMessage(content);
    },
  };
};
