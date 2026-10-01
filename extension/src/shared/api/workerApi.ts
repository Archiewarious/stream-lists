import { twitchApi, type TwitchAuth } from '@shared/twitch/twitchApi';

// Twitch re-sends the token before it expires, so the latest one is kept; requests wait for the first.
let auth: TwitchAuth | undefined;
const authorized = new Promise<void>((resolve) =>
  twitchApi.onAuthorized((nextAuth) => {
    auth = nextAuth;
    resolve();
  }),
);

/** Calls the Worker API as the current Twitch user. Throws with the Worker's error message. */
export const callWorker = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  await authorized;
  const response = await fetch(twitchApi.workerUrl + path, {
    method,
    headers: {
      Authorization: `Bearer ${auth!.token}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
};
