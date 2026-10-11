// The Worker's environment and the limits everything here is sized to.

export interface Env {
  DB: D1Database;
  EXTENSION_SECRET: string;
  /** The secret before a rotation, accepted until every viewer has a token signed with the new one. */
  EXTENSION_SECRET_PREVIOUS?: string;
  CLIENT_ID: string;
  OWNER_ID: string;
  TMDB_API_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}

export const MAX_LISTS = 20;
export const MAX_ITEMS_PER_LIST = 2000;
export const MAX_BULK_ITEMS = 200;
export const MAX_LIST_TITLE_LENGTH = 40;
export const MAX_ITEM_TITLE_LENGTH = 200;
// The same lists are CHECK constraints in migrations/ (a test compares them).
export const LIST_KINDS = ['movies', 'games', 'custom'];
export const ITEM_STATUSES = ['queue', 'watched'];
export const TMDB_TYPES = ['movie', 'tv'];
// Cloudflare Free: one request or one cron run may make 50 subrequests to the outside (D1 does not count). A sync pass
// spends one on Pointauc and two on the snapshot publish; TMDB lookups get the rest (see Budget).
export const SUBREQUEST_LIMIT = 50;
// Titles looked up per request (each one or two TMDB searches) — also keeps a burst under TMDB's ~40 a second.
export const MAX_TMDB_LOOKUPS = 20;
// One sync pass per channel this often, however many panels ask; the panel asks every 12 s.
export const SYNC_PACE_MS = 10_000;
// Snapshot publishes per channel at most this often: Twitch takes about 20 config writes a minute.
export const SNAPSHOT_PACE_MS = 3_100;
// Channels one cron run syncs (picked at random): a run must fit Free's 10 ms of CPU.
export const CRON_CHANNELS = 4;
// The automatic sync queues a lot by itself only if TMDB's entry has this many votes — viewers write the lots,
// and TMDB has odd entries named like anything.
export const AUTO_ADD_MIN_VOTES = 20;
// Pointauc and TMDB answer in well under a second; one that hangs must not hold a request or the cron run.
export const OUTSIDE_TIMEOUT_MS = 8000;
