import i18n from 'i18next';

import { twitchApi, type TwitchAuth } from '@shared/twitch/twitchApi';

// Twitch re-sends the token before it expires, so the latest one is kept; requests wait for the first.
let auth: TwitchAuth | undefined;
const authorized = new Promise<void>((resolve) =>
  twitchApi.onAuthorized((nextAuth) => {
    auth = nextAuth;
    resolve();
  }),
);

// Bulk adds and Pointauc imports look titles up in TMDB, so a request may take a while — but never forever.
const TIMEOUT_MS = 60_000;

/** The Worker's error messages (worker/src) → texts for the streamer; anything else is "the server failed". */
const ERROR_TEXTS: [RegExp, string][] = [
  [/^Already in the list/, 'errors.duplicate'],
  [/^Pointauc token must be entered again/, 'errors.pointaucToken'],
  [/^Pointauc is not connected/, 'errors.pointaucNotConnected'],
  [/^Pointauc/, 'errors.pointaucUnavailable'],
  [/^Invalid token/, 'errors.pointaucTokenFormat'],
  [/^At most (?<max>\d+) items/, 'errors.itemsLimit'],
  [/^At most (?<max>\d+) lists/, 'errors.listsLimit'],
  [/^Title must be 1–(?<max>\d+)/, 'errors.title'],
  [/^TMDB/, 'errors.tmdb'],
  [/not found$/, 'errors.notFound'],
  [/^Invalid Twitch token|^Only the broadcaster/, 'errors.auth'],
];

/** A failed request: `message` is for people, `status` and `reason` (the Worker's own words) for code. */
export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason = '',
  ) {
    super(message);
  }
}

export const describeWorkerError = (reason: string, status: number) => {
  for (const [pattern, key] of ERROR_TEXTS) {
    const match = pattern.exec(reason);
    if (match) return i18n.t(key, match.groups);
  }
  return i18n.t('errors.server', { status });
};

/** Calls the Worker API as the current Twitch user. Throws a WorkerError with a text to show. */
export const callWorker = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  await authorized;
  let response: Response;
  try {
    response = await fetch(twitchApi.workerUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${auth!.token}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WorkerError(i18n.t((error as Error).name === 'TimeoutError' ? 'errors.timeout' : 'errors.network'), 0);
  }
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new WorkerError(describeWorkerError(data?.error ?? '', response.status), response.status, data?.error);
  // Every route answers JSON; anything else (a proxy's page, a cut connection) is not an answer.
  if (data === undefined) throw new WorkerError(i18n.t('errors.badAnswer'), response.status);
  return data as T;
};
