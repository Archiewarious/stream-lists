import { decryptText, encryptText } from './crypto';
import { signJwt, verifyJwt } from './jwt';
import { matchLots, normalizeTitle, planLotSync, toPointaucLots, type PointaucLot } from './pointauc';
import { buildSnapshot, SNAPSHOT_MAX_ITEMS, SNAPSHOT_VERSION, type ChannelList, type ItemRow, type ListRow } from './snapshot';
import { parseTheme, type ChannelTheme } from './theme';
import { pickMatch, POSTER_PATH, searchQueries, toMovieDetails, toTmdbResults, type TmdbResult } from './tmdb';

interface Env {
  DB: D1Database;
  EXTENSION_SECRET: string;
  /** The secret before a rotation, accepted until every viewer has a token signed with the new one. */
  EXTENSION_SECRET_PREVIOUS?: string;
  CLIENT_ID: string;
  OWNER_ID: string;
  TMDB_API_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}

const MAX_LISTS = 20;
const MAX_ITEMS_PER_LIST = 2000;
const MAX_BULK_ITEMS = 200;
const MAX_LIST_TITLE_LENGTH = 40;
const MAX_ITEM_TITLE_LENGTH = 200;
const LIST_KINDS = ['movies', 'games', 'custom'];
const ITEM_STATUSES = ['queue', 'watched'];
const TMDB_TYPES = ['movie', 'tv'];
// Cloudflare Free: one request or one cron run may make 50 subrequests to the outside (D1 does not count). A sync pass
// spends one on Pointauc and two on the snapshot publish; TMDB lookups get the rest (see Budget).
const SUBREQUEST_LIMIT = 50;
// Titles looked up per request (each one or two TMDB searches) — also keeps a burst under TMDB's ~40 a second.
const MAX_TMDB_LOOKUPS = 20;
// One sync pass per channel this often, however many panels ask; the panel asks every 12 s.
const SYNC_PACE_MS = 10_000;
// Snapshot publishes per channel at most this often: Twitch takes about 20 config writes a minute.
const SNAPSHOT_PACE_MS = 3_100;
// Channels one cron run syncs (picked at random): a run must fit Free's 10 ms of CPU.
const CRON_CHANNELS = 4;
// The automatic sync queues a lot by itself only if TMDB's entry has this many votes — viewers write the lots,
// and TMDB has odd entries named like anything.
const AUTO_ADD_MIN_VOTES = 20;
// Pointauc and TMDB answer in well under a second; one that hangs must not hold a request or the cron run.
const OUTSIDE_TIMEOUT_MS = 8000;

// The token travels in a header, not a cookie, so any origin is fine.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS_HEADERS });

// --- input validation ---

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  return body as Record<string, unknown>;
};

const readTitle = (value: unknown, maxLength: number) => {
  // Control characters are dropped: JSON escapes each as 6 bytes and could push the snapshot past 5 KB.
  const title = typeof value === 'string' ? value.replace(/\p{Cc}/gu, '').trim() : '';
  if (!title || title.length > maxLength) throw new HttpError(400, `Title must be 1–${maxLength} characters`);
  return title;
};

const readEnum = <T extends string>(value: unknown, allowed: string[], field: string) => {
  if (!allowed.includes(value as string)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value as T;
};

const readOptionalInt = (value: unknown, field: string, min: number, max: number) => {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new HttpError(400, `${field} must be an integer ${min}–${max}`);
  }
  return value as number;
};

// TMDB poster path, rendered as an image URL on the panel — so only the TMDB shape is accepted.
const readPosterPath = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !POSTER_PATH.test(value)) throw new HttpError(400, 'Invalid poster_path');
  return value;
};

/** Optional movie details (filled from TMDB). Only keys present in the body are returned. */
const readMovieFields = (body: Record<string, unknown>) => {
  const fields: Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path' | 'tmdb_type'>> = {};
  if ('tmdb_type' in body) {
    fields.tmdb_type = body.tmdb_type === null ? null : readEnum<'movie' | 'tv'>(body.tmdb_type, TMDB_TYPES, 'tmdb_type');
  }
  if ('year' in body) fields.year = readOptionalInt(body.year, 'year', 1870, 2100);
  if ('tmdb_id' in body) fields.tmdb_id = readOptionalInt(body.tmdb_id, 'tmdb_id', 1, 2 ** 31);
  if ('poster_path' in body) fields.poster_path = readPosterPath(body.poster_path);
  return fields;
};

// --- data access (every query is scoped to the channel from the JWT) ---

// The queue is ordered like the auction: the biggest bid first; titles without a bid (not from Pointauc) follow in the
// streamer's own order. Watched items: newest first. Every place that shows or numbers the queue uses this.
const ITEM_ORDER = `CASE WHEN items.status = 'queue' THEN -COALESCE(items.points, -1) ELSE 0 END,
  CASE WHEN items.status = 'queue' THEN items.position ELSE -items.watched_at END, items.id DESC`;

const loadChannel = async (db: D1Database, channelId: string): Promise<ChannelList[]> => {
  const [lists, items] = await db.batch([
    db.prepare('SELECT * FROM lists WHERE channel_id = ? ORDER BY id').bind(channelId),
    db
      .prepare(`SELECT items.* FROM items JOIN lists ON lists.id = items.list_id WHERE lists.channel_id = ? ORDER BY ${ITEM_ORDER}`)
      .bind(channelId),
  ]);
  const itemRows = items.results as unknown as ItemRow[];
  return (lists.results as unknown as ListRow[]).map((list) => ({
    ...list,
    items: itemRows.filter((item) => item.list_id === list.id),
  }));
};

const loadSettings = (db: D1Database, channelId: string) =>
  db
    .prepare('SELECT theme, pointauc_token, pointauc_list_id FROM channels WHERE channel_id = ?')
    .bind(channelId)
    .first<{ theme: string | null; pointauc_token: string | null; pointauc_list_id: number | null }>();

const loadTheme = async (db: D1Database, channelId: string): Promise<ChannelTheme | null> => {
  const stored = (await loadSettings(db, channelId))?.theme;
  return stored ? parseTheme(JSON.parse(stored)) : null;
};

const saveSetting = (
  db: D1Database,
  channelId: string,
  column: 'theme' | 'pointauc_token' | 'pointauc_list_id',
  value: string | number | null,
) =>
  db
    .prepare(
      `INSERT INTO channels (channel_id, ${column}) VALUES (?, ?) ON CONFLICT (channel_id) DO UPDATE SET ${column} = excluded.${column}`,
    )
    .bind(channelId, value)
    .run();

const getEncryptionKey = (env: Env) => {
  let size = 0;
  try {
    size = atob(env.TOKEN_ENCRYPTION_KEY ?? '').length;
  } catch {} // not base64
  if (size !== 32) throw new HttpError(503, 'TOKEN_ENCRYPTION_KEY must be base64 of 32 bytes');
  return env.TOKEN_ENCRYPTION_KEY!;
};

/** The stored Pointauc token in clear; one saved under another key cannot be read and has to be entered again. */
const readPointaucToken = async (env: Env, stored: string) => {
  const key = getEncryptionKey(env);
  try {
    return await decryptText(stored, key);
  } catch {
    throw new HttpError(409, 'Pointauc token must be entered again');
  }
};

// Pointauc relays the request to the streamer's open pointauc.com tab; with the tab closed (or a bad token)
// it answers 500, not 403 — so every failure (no answer, not JSON, no lots) means "open Pointauc / check the token".
const fetchPointaucLots = async (token: string) => {
  let data: { lots?: unknown } | null;
  try {
    const response = await fetch('https://pointauc.com/api/oshino/lots', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(OUTSIDE_TIMEOUT_MS),
    });
    if (!response.ok) throw new HttpError(502, `Pointauc ${response.status}`);
    data = await response.json();
  } catch (error) {
    throw error instanceof HttpError ? error : new HttpError(502, 'Pointauc is unavailable');
  }
  if (!Array.isArray(data?.lots)) throw new HttpError(502, 'Pointauc answered without lots');
  return toPointaucLots(data);
};

/** `value` comes from a path, a JSON body or a query string: an integer or a string of digits, nothing else. */
const getOwnedList = async (db: D1Database, channelId: string, value: unknown) => {
  const listId = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(listId)) throw new HttpError(400, 'list_id must be an integer');
  const list = await db
    .prepare('SELECT * FROM lists WHERE id = ? AND channel_id = ?')
    .bind(listId, channelId)
    .first<ListRow>();
  if (!list) throw new HttpError(404, 'List not found');
  return list;
};

const getOwnedItem = async (db: D1Database, channelId: string, itemId: number) => {
  const item = await db
    .prepare('SELECT items.* FROM items JOIN lists ON lists.id = items.list_id WHERE items.id = ? AND lists.channel_id = ?')
    .bind(itemId, channelId)
    .first<ItemRow>();
  if (!item) throw new HttpError(404, 'Item not found');
  return item;
};

/** The place after the last queued item of a list; `listId` is the SQL parameter that holds the list id. */
const nextQueuePosition = (listId: string) =>
  `(SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE list_id = ${listId} AND status = 'queue')`;

type NewItem = Pick<ItemRow, 'list_id' | 'title' | 'status'> &
  Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path' | 'tmdb_type' | 'source' | 'points' | 'lot_id'>>;

/**
 * Inserts one item at the end of the queue; RETURNING gives the row, or nothing if it was skipped: the list already
 * has its title or its Pointauc lot. The callers check that in JS first, and this repeats it inside the write, so two
 * requests at once (a double click, two sync passes) cannot both add it. `checkLimit` keeps the list within
 * MAX_ITEMS_PER_LIST the same way (batches count beforehand).
 */
const insertItem = (db: D1Database, item: NewItem, now: number, { checkLimit = false } = {}) => {
  const conditions = [
    'NOT EXISTS (SELECT 1 FROM items WHERE list_id = ?1 AND title = ?2)',
    'NOT EXISTS (SELECT 1 FROM items WHERE list_id = ?1 AND lot_id = ?12)',
    ...(checkLimit ? [`(SELECT COUNT(*) FROM items WHERE list_id = ?1) < ${MAX_ITEMS_PER_LIST}`] : []),
  ];
  return db
    .prepare(
      `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, tmdb_type, status, position, added_at, watched_at, source, points, lot_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ${nextQueuePosition('?1')}, ?8, ?9, ?10, ?11, ?12
       WHERE ${conditions.join(' AND ')} RETURNING *`,
    )
    .bind(
      item.list_id,
      item.title,
      item.year ?? null,
      item.tmdb_id ?? null,
      item.poster_path ?? null,
      item.tmdb_type ?? null,
      item.status,
      now,
      item.status === 'watched' ? now : null,
      item.source ?? 'manual',
      item.points ?? null,
      item.lot_id ?? null,
    );
};

// --- TMDB (the key stays here; the browser only sees the results) ---

/** Movies and shows; `language` like "ru-RU". Accepts a v3 API key or a v4 read access token (JWT, "eyJ…"). */
const tmdbRequest = async (path: string, params: Record<string, string>, apiKey: string) => {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
  else url.searchParams.set('api_key', apiKey);

  // Same request → same answer for a day; saves TMDB requests (typing, many viewers opening one film).
  // The URL may carry the key, so neither a redirect nor a fetch error (whose text may quote it) goes anywhere.
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(OUTSIDE_TIMEOUT_MS),
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
  } catch {
    throw new HttpError(502, 'TMDB request failed');
  }
  if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 502, `TMDB ${response.status}`);
  return response.json<any>(); // shaped by toTmdbResults / toMovieDetails, which drop everything unexpected
};

const searchTmdb = async (query: string, language: string, apiKey: string) =>
  toTmdbResults(await tmdbRequest('search/multi', { query, language, include_adult: 'false' }, apiKey));

type TmdbFields = Pick<ItemRow, 'tmdb_id' | 'year' | 'poster_path' | 'tmdb_type'>;

/** Subrequests to the outside this invocation may still make (see SUBREQUEST_LIMIT). */
type Budget = { left: number };
/** For a request: the rest after Pointauc and the snapshot publish. */
const requestBudget = (): Budget => ({ left: SUBREQUEST_LIMIT - 3 });

/**
 * Poster, year and TMDB id for the titles TMDB knows for sure (`found`). The rest were looked up and not found,
 * or the lookup `failed` (TMDB down or rate-limited — worth another try), or were `unchecked`: past
 * MAX_TMDB_LOOKUPS titles or past the subrequest `budget` (each search takes one).
 */
const matchTitles = async (env: Env, titles: string[], budget: Budget, minVotes = 0) => {
  const found = new Map<string, TmdbFields>();
  const failed = new Set<string>();
  const unchecked = titles.slice(MAX_TMDB_LOOKUPS);
  const apiKey = env.TMDB_API_KEY;
  if (!apiKey) return { found, failed, unchecked: titles };
  await Promise.all(
    titles.slice(0, MAX_TMDB_LOOKUPS).map(async (title) => {
      try {
        let match: TmdbResult | null = null;
        for (const query of searchQueries(title)) {
          if (budget.left < 1) return unchecked.push(title);
          budget.left -= 1;
          match = pickMatch(title, await searchTmdb(query.slice(0, 100), 'ru-RU', apiKey));
          if (match) break;
        }
        if (match && match.votes >= minVotes) {
          found.set(title, { tmdb_id: match.tmdb_id, year: match.year, poster_path: match.poster_path, tmdb_type: match.type });
        }
      } catch (error) {
        failed.add(title);
        console.error('TMDB lookup failed', error); // not the title: viewers write lot names
      }
    }),
  );
  return { found, failed, unchecked };
};

/**
 * Puts the lots in `addIds` into the list (movies get their poster from TMDB) and refreshes the bids of lots the
 * list already has. Used by the import dialog; the automatic sync will call it with every new lot.
 */
const syncLots = async (env: Env, list: ListRow, lots: PointaucLot[], addIds: Set<string> | null, status: ItemRow['status']) => {
  const db = env.DB;
  const now = Date.now();
  const existing = await db
    .prepare('SELECT id, title, points, lot_id FROM items WHERE list_id = ?')
    .bind(list.id)
    .all<Pick<ItemRow, 'id' | 'title' | 'points' | 'lot_id'>>();
  const plan = planLotSync(lots, existing.results, addIds);
  if (existing.results.length + plan.toAdd.length > MAX_ITEMS_PER_LIST) {
    throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
  }

  const { found, unchecked } = await matchTitles(env, list.kind === 'movies' ? plan.toAdd.map((lot) => lot.name) : [], requestBudget());

  const update = db.prepare('UPDATE items SET points = ?, lot_id = ? WHERE id = ?');
  const updates = plan.toUpdate.map((change) => update.bind(change.points, change.lot_id, change.id));
  const inserts = plan.toAdd.map((lot) =>
    insertItem(
      db,
      { ...found.get(lot.name), list_id: list.id, title: lot.name, status, source: 'pointauc', points: lot.amount, lot_id: lot.id },
      now,
    ),
  );
  const results = updates.length + inserts.length ? await db.batch<ItemRow>([...updates, ...inserts]) : [];
  return { added: results.slice(updates.length).flatMap((result) => result.results), updated: updates.length, unchecked: unchecked.length };
};

// --- Twitch snapshot ---

//** The channel's lists with only the items a snapshot can hold (the first of each kind, in display order). */
const loadSnapshotLists = async (db: D1Database, channelId: string): Promise<ChannelList[]> => {
  const [lists, items] = await db.batch([
    db.prepare('SELECT * FROM lists WHERE channel_id = ? ORDER BY id').bind(channelId),
    db
      .prepare(
        `SELECT * FROM (
           SELECT items.*, ROW_NUMBER() OVER (PARTITION BY items.list_id, items.status ORDER BY ${ITEM_ORDER}) AS place,
                  COUNT(*) OVER (PARTITION BY items.list_id, items.status) AS total
           FROM items JOIN lists ON lists.id = items.list_id WHERE lists.channel_id = ?
         ) WHERE place <= CASE status WHEN 'queue' THEN ${SNAPSHOT_MAX_ITEMS.queue} ELSE ${SNAPSHOT_MAX_ITEMS.watched} END
         ORDER BY place`,
      )
      .bind(channelId),
  ]);
  const rows = items.results as unknown as (ItemRow & { total: number })[];
  return (lists.results as unknown as ListRow[]).map((list) => {
    const own = rows.filter((item) => item.list_id === list.id);
    const count = (status: ItemRow['status']) => own.find((item) => item.status === status)?.total ?? 0;
    return { ...list, items: own, counts: { queue: count('queue'), watched: count('watched') } };
  });
};

/**
 * Sends the channel's snapshot to Twitch (config segment and PubSub). Twitch takes about 20 config writes a minute,
 * so publishes of a channel go out at least SNAPSHOT_PACE_MS apart: the call that gets the next turn waits for it and
 * only then reads the channel; a call that finds the next turn already taken stops — the waiting one will read what
 * its request wrote. A publish Twitch did not take is marked, and the cron sends it again.
 */
const publishSnapshot = async (env: Env, channelId: string) => {
  const db = env.DB;
  const now = Date.now();
  const turn = await db
    .prepare(
      `INSERT INTO channels (channel_id, snapshot_at) VALUES (?1, ?2)
       ON CONFLICT (channel_id) DO UPDATE SET snapshot_at = MAX(?2, COALESCE(snapshot_at, 0) + ${SNAPSHOT_PACE_MS})
       WHERE snapshot_at IS NULL OR snapshot_at <= ?2
       RETURNING snapshot_at`,
    )
    .bind(channelId, now)
    .first<number>('snapshot_at');
  if (turn === null) return;
  if (turn > now) await new Promise((resolve) => setTimeout(resolve, turn - now));

  const content = buildSnapshot(await loadSnapshotLists(db, channelId), await loadTheme(db, channelId));
  const token = await signJwt(
    {
      exp: Math.floor(Date.now() / 1000) + 60,
      user_id: env.OWNER_ID,
      role: 'external',
      channel_id: channelId,
      pubsub_perms: { send: ['broadcast'] },
    },
    env.EXTENSION_SECRET,
  );
  const headers = { Authorization: `Bearer ${token}`, 'Client-Id': env.CLIENT_ID, 'Content-Type': 'application/json' };

  let isSent = true;
  try {
    const responses = await Promise.all([
      fetch('https://api.twitch.tv/helix/extensions/configurations', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          extension_id: env.CLIENT_ID,
          segment: 'broadcaster',
          broadcaster_id: channelId,
          version: SNAPSHOT_VERSION,
          content,
        }),
      }),
      fetch('https://api.twitch.tv/helix/extensions/pubsub', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target: ['broadcast'], broadcaster_id: channelId, message: content }),
      }),
    ]);
    for (const response of responses) {
      if (response.ok) continue;
      isSent = false;
      console.error('Twitch snapshot failed', response.url, response.status, await response.text());
    }
  } catch (error) {
    isSent = false;
    console.error('Twitch snapshot failed', error);
  }
  await db
    .prepare('UPDATE channels SET snapshot_stale = ?1 WHERE channel_id = ?2 AND snapshot_stale IS NOT ?1')
    .bind(isSent ? 0 : 1, channelId)
    .run();
};

// --- automatic Pointauc sync ---

type PendingLot = { id: number; list_id: number; name: string; points: number | null };

/** SHA-256 of a string, hex — fingerprints the Pointauc lots a sync pass handled. */
const fingerprint = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/**
 * One sync pass for a channel: bids of known titles are refreshed; a new lot goes straight into the queue when TMDB
 * knows the title for sure (a movie list), otherwise it waits in "pending" for the streamer. A lot seen once is never
 * looked at again, so deleting or hiding it is final.
 *
 * A pass runs at most once per SYNC_PACE_MS for a channel, and does not read the list at all when Pointauc answers
 * the same lots as the last pass that handled them all. `force` (switching the sync on) skips both. Returns whether
 * anything was written; the snapshot is published by the pass itself, and only if viewers would see a change.
 */
const autoSyncChannel = async (env: Env, channelId: string, listId: number, storedToken: string, budget: Budget, force = false) => {
  const db = env.DB;
  if (budget.left < 3) return false; // Pointauc and a publish do not fit: the next run will
  const list = await db.prepare('SELECT * FROM lists WHERE id = ? AND channel_id = ?').bind(listId, channelId).first<ListRow>();
  if (!list) return false;
  const now = Date.now();
  const claim = await db
    .prepare(
      `UPDATE channels SET pointauc_synced_at = ?1
       WHERE channel_id = ?2 AND (?3 OR pointauc_synced_at IS NULL OR pointauc_synced_at <= ?1 - ${SYNC_PACE_MS})
       RETURNING pointauc_lots_hash`,
    )
    .bind(now, channelId, force ? 1 : 0)
    .first<{ pointauc_lots_hash: string | null }>();
  if (!claim) return false; // another pass ran moments ago

  budget.left -= 3; // Pointauc now, the publish at the end
  const lots = await fetchPointaucLots(await readPointaucToken(env, storedToken));
  const lotsHash = await fingerprint(JSON.stringify([list.id, lots]));
  if (!force && lotsHash === claim.pointauc_lots_hash) {
    budget.left += 2;
    return false;
  }

  const [items, pending] = await Promise.all([
    db
      .prepare('SELECT id, title, points, lot_id FROM items WHERE list_id = ?')
      .bind(list.id)
      .all<Pick<ItemRow, 'id' | 'title' | 'points' | 'lot_id'>>(),
    db
      .prepare('SELECT lot_id, name, points, status FROM pending_lots WHERE list_id = ?')
      .bind(list.id)
      .all<{ lot_id: string; name: string; points: number | null; status: 'pending' | 'dismissed' }>(),
  ]);
  const plan = planLotSync(lots, items.results, null);

  const knownTitles = new Set([...items.results.map((item) => item.title), ...pending.results.map((lot) => lot.name)].map(normalizeTitle));
  const knownLotIds = new Set([...items.results.map((item) => item.lot_id), ...pending.results.map((lot) => lot.lot_id)]);
  const fresh: PointaucLot[] = [];
  for (const lot of lots) {
    const key = normalizeTitle(lot.name);
    if (knownTitles.has(key) || knownLotIds.has(lot.id)) continue;
    knownTitles.add(key);
    fresh.push(lot);
  }

  // A movie list looks new lots up in TMDB as far as the budget goes; the rest are picked up next pass. Other lists
  // have nothing to look up.
  const titles = list.kind === 'movies' ? fresh.map((lot) => lot.name) : [];
  const { found, failed, unchecked } = await matchTitles(env, titles, budget, AUTO_ADD_MIN_VOTES);
  const handled = fresh.filter((lot) => !failed.has(lot.name) && !unchecked.includes(lot.name));
  // Into the queue while the list has room; the rest waits for the streamer. A failed lookup is not "TMDB does not
  // know it": that lot stays unseen and is looked up again next pass.
  const room = Math.max(MAX_ITEMS_PER_LIST - items.results.length, 0);
  const toQueue = handled.filter((lot) => found.has(lot.name)).slice(0, room);
  const toPending = handled.filter((lot) => !toQueue.includes(lot));
  // Bids keep changing while a lot waits in "pending" too.
  const pendingBids = new Map(pending.results.filter((lot) => lot.status === 'pending').map((lot) => [lot.lot_id, lot.points]));
  const toRebid = lots.filter((lot) => pendingBids.has(lot.id) && pendingBids.get(lot.id) !== lot.amount);

  const update = db.prepare('UPDATE items SET points = ?, lot_id = ? WHERE id = ?');
  const park = db.prepare('INSERT OR IGNORE INTO pending_lots (list_id, lot_id, name, points, created_at) VALUES (?, ?, ?, ?, ?)');
  const rebid = db.prepare("UPDATE pending_lots SET points = ? WHERE list_id = ? AND lot_id = ? AND status = 'pending'");
  const statements = [
    ...plan.toUpdate.map((change) => update.bind(change.points, change.lot_id, change.id)),
    ...toQueue.map((lot) =>
      insertItem(
        db,
        { ...found.get(lot.name), list_id: list.id, title: lot.name, status: 'queue', source: 'pointauc', points: lot.amount, lot_id: lot.id },
        now,
      ),
    ),
    ...toPending.map((lot) => park.bind(list.id, lot.id, lot.name, lot.amount, now)),
    ...toRebid.map((lot) => rebid.bind(lot.amount, list.id, lot.id)),
  ];
  // The fingerprint is kept only when every lot was handled: lots left for later must not look done.
  const isComplete = handled.length === fresh.length;
  const remember = db.prepare('UPDATE channels SET pointauc_lots_hash = ? WHERE channel_id = ?').bind(isComplete ? lotsHash : null, channelId);
  await db.batch([...statements, remember]);

  const isVisible = plan.toUpdate.length + toQueue.length > 0; // pending lots are not in the snapshot
  if (isVisible) await publishSnapshot(env, channelId);
  else budget.left += 2;
  return statements.length > 0;
};

/**
 * Cron entry: snapshots Twitch did not take go out again, then a few channels that switched the sync on (picked at
 * random, so every channel gets its turn). A failing channel (Pointauc tab closed) is just skipped.
 */
// ponytail: CRON_CHANNELS random channels a minute; with dozens of syncing channels each waits minutes for its
// turn — then add a sync queue (or move to Workers Paid).
const runAutoSync = async (env: Env) => {
  const budget: Budget = { left: SUBREQUEST_LIMIT };
  const stale = await env.DB.prepare(`SELECT channel_id FROM channels WHERE snapshot_stale = 1 LIMIT ${CRON_CHANNELS}`).all<{ channel_id: string }>();
  for (const { channel_id } of stale.results) {
    budget.left -= 2;
    await publishSnapshot(env, channel_id);
  }

  const channels = await env.DB.prepare(
    `SELECT channel_id, pointauc_list_id, pointauc_token FROM channels
     WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL ORDER BY random() LIMIT ${CRON_CHANNELS}`,
  ).all<{ channel_id: string; pointauc_list_id: number; pointauc_token: string }>();
  for (const channel of channels.results) {
    try {
      await autoSyncChannel(env, channel.channel_id, channel.pointauc_list_id, channel.pointauc_token, budget);
    } catch (error) {
      // A closed Pointauc tab (502) or a token to enter again (409) is the usual state, not worth a log line a minute.
      if (!(error instanceof HttpError && (error.status === 502 || error.status === 409))) {
        console.error('Auto sync failed', channel.channel_id, error);
      }
    }
  }
};

// --- routes ---

const handleApi = async (request: Request, env: Env, channelId: string, route: string, id: number) => {
  const db = env.DB;
  const now = Date.now();

  switch (route) {
    case 'GET /api/channel': {
      const settings = await loadSettings(db, channelId);
      const lists = await loadChannel(db, channelId);
      // Lots TMDB did not know — the streamer decides (the viewer snapshot never contains them). A lot that got into
      // its list another way meanwhile (import, typed by hand) is not offered again.
      const pending = await db
        .prepare(
          `SELECT p.id, p.list_id, p.lot_id, p.name, p.points FROM pending_lots p JOIN lists ON lists.id = p.list_id
           WHERE lists.channel_id = ? AND p.status = 'pending' ORDER BY p.id`,
        )
        .bind(channelId)
        .all<PendingLot & { lot_id: string }>();
      const isInList = (lot: PendingLot & { lot_id: string }) =>
        !!lists
          .find((list) => list.id === lot.list_id)
          ?.items.some((item) => item.lot_id === lot.lot_id || normalizeTitle(item.title) === normalizeTitle(lot.name));
      return {
        lists,
        theme: settings?.theme ? parseTheme(JSON.parse(settings.theme)) : null,
        pointauc: !!settings?.pointauc_token,
        pointauc_list_id: settings?.pointauc_list_id ?? null,
        pending: pending.results.filter((lot) => !isInList(lot)).map(({ lot_id, ...lot }) => lot),
      };
    }

    case 'PUT /api/theme': {
      const theme = parseTheme(await readBody(request));
      if (!theme) throw new HttpError(400, 'Expected { preset } or { primary, accent } as #rrggbb');
      await saveSetting(db, channelId, 'theme', JSON.stringify(theme));
      return theme;
    }

    case 'PUT /api/pointauc/token': {
      // Checked against Pointauc before saving, so a typo shows up right away (needs the Pointauc tab open).
      const { token } = await readBody(request);
      if (typeof token !== 'string' || !/^\S{10,2000}$/.test(token.trim())) throw new HttpError(400, 'Invalid token');
      await fetchPointaucLots(token.trim());
      await saveSetting(db, channelId, 'pointauc_token', await encryptText(token.trim(), getEncryptionKey(env)));
      return { ok: true };
    }

    case 'DELETE /api/pointauc/token':
      await saveSetting(db, channelId, 'pointauc_token', null);
      await saveSetting(db, channelId, 'pointauc_list_id', null);
      return { ok: true };

    case 'GET /api/pointauc/lots': {
      const list = await getOwnedList(db, channelId, new URL(request.url).searchParams.get('list_id'));
      const stored = (await loadSettings(db, channelId))?.pointauc_token;
      if (!stored) throw new HttpError(409, 'Pointauc is not connected');
      const lots = await fetchPointaucLots(await readPointaucToken(env, stored));
      const items = await db
        .prepare(`SELECT title, status, watched_at FROM items WHERE list_id = ? ORDER BY ${ITEM_ORDER}`) // places as the panel shows them
        .bind(list.id)
        .all<Pick<ItemRow, 'title' | 'status' | 'watched_at'>>();
      return matchLots(lots, items.results);
    }

    case 'POST /api/pointauc/import': {
      // The lots are read from Pointauc here, not taken from the browser: only their ids come from the dialog.
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, body.list_id);
      const status = body.status === undefined ? 'queue' : readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status');
      const lotIds = body.lot_ids;
      if (!Array.isArray(lotIds) || lotIds.length > MAX_BULK_ITEMS || !lotIds.every((lotId) => typeof lotId === 'string')) {
        throw new HttpError(400, `lot_ids must be an array of at most ${MAX_BULK_ITEMS} strings`);
      }
      const stored = (await loadSettings(db, channelId))?.pointauc_token;
      if (!stored) throw new HttpError(409, 'Pointauc is not connected');
      const lots = await fetchPointaucLots(await readPointaucToken(env, stored));
      const { added, unchecked } = await syncLots(env, list, lots, new Set<string>(lotIds), status);
      return { added, skipped: lotIds.length - added.length, unchecked };
    }

    case 'PUT /api/pointauc/sync': {
      // Switches the automatic sync on for one list (or off with list_id: null); the first pass runs right away.
      const { list_id: listId } = await readBody(request);
      if (listId === null) {
        await saveSetting(db, channelId, 'pointauc_list_id', null);
        return { ok: true, synced: true };
      }
      const stored = (await loadSettings(db, channelId))?.pointauc_token;
      if (!stored) throw new HttpError(409, 'Pointauc is not connected');
      const list = await getOwnedList(db, channelId, listId);
      await saveSetting(db, channelId, 'pointauc_list_id', list.id);
      try {
        await autoSyncChannel(env, channelId, list.id, stored, { left: SUBREQUEST_LIMIT }, true);
        return { ok: true, synced: true };
      } catch (error) {
        console.error('First sync failed', error); // stays on: the next minute may find the Pointauc tab open
        return { ok: true, synced: false };
      }
    }

    case 'POST /api/pointauc/refresh': {
      // A sync pass on demand: the streamer's open panel calls it every few seconds, so a lot added in Pointauc
      // shows up almost at once instead of at the next cron tick. Publishing is done by the pass itself.
      const settings = await loadSettings(db, channelId);
      if (!settings?.pointauc_token || settings.pointauc_list_id === null) return { updated: 0, changed: false };
      const changed = await autoSyncChannel(env, channelId, settings.pointauc_list_id, settings.pointauc_token, { left: SUBREQUEST_LIMIT });
      return { updated: 0, changed }; // updated: 0 — no second snapshot publish from the generic handler
    }

    case 'POST /api/pending/:id/accept': {
      // The streamer looked at a lot TMDB did not know: put it into the queue (title may be corrected first).
      const row = await db
        .prepare(
          `SELECT p.* FROM pending_lots p JOIN lists ON lists.id = p.list_id
           WHERE p.id = ? AND lists.channel_id = ? AND p.status = 'pending'`,
        )
        .bind(id, channelId)
        .first<{ id: number; list_id: number; lot_id: string; name: string; points: number | null }>();
      if (!row) throw new HttpError(404, 'Lot not found');
      const body = await readBody(request).catch(() => ({}) as Record<string, unknown>);
      const list = await getOwnedList(db, channelId, row.list_id);
      const title = 'title' in body ? readTitle(body.title, MAX_ITEM_TITLE_LENGTH) : row.name;

      const fields = readMovieFields(body);
      if (list.kind === 'movies' && !('tmdb_id' in body)) Object.assign(fields, (await matchTitles(env, [title], requestBudget())).found.get(title));

      const existing = await db.prepare('SELECT title FROM items WHERE list_id = ?').bind(list.id).all<{ title: string }>();
      if (existing.results.some((item) => normalizeTitle(item.title) === normalizeTitle(title))) {
        await db.prepare("UPDATE pending_lots SET status = 'dismissed' WHERE id = ?").bind(row.id).run(); // the list has it already
        return { ok: true, added: false };
      }
      if (existing.results.length >= MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
      const item = { ...fields, list_id: list.id, title, status: 'queue', source: 'pointauc', points: row.points, lot_id: row.lot_id } as const;
      // Closed once its item is in the list — not when the insert was skipped because the list filled up meanwhile.
      const close = db
        .prepare(
          `UPDATE pending_lots SET status = 'dismissed'
           WHERE id = ? AND EXISTS (SELECT 1 FROM items WHERE list_id = ? AND (lot_id = ? OR title = ?))`,
        )
        .bind(row.id, list.id, row.lot_id, title);
      const [inserted] = await db.batch<ItemRow>([insertItem(db, item, now, { checkLimit: true }), close]);
      return inserted.results[0] ? { ok: true, added: true, item: inserted.results[0] } : { ok: true, added: false };
    }

    case 'DELETE /api/pending/:id': {
      await db
        .prepare(
          `UPDATE pending_lots SET status = 'dismissed'
           WHERE id = ? AND list_id IN (SELECT id FROM lists WHERE channel_id = ?)`,
        )
        .bind(id, channelId)
        .run();
      return { ok: true };
    }

    case 'GET /api/tmdb/search': {
      const params = new URL(request.url).searchParams;
      const query = params.get('q')?.trim() ?? '';
      if (!query || query.length > 100) throw new HttpError(400, 'q must be 1–100 characters');
      if (!env.TMDB_API_KEY) throw new HttpError(503, 'TMDB is not configured');
      const language = params.get('lang') === 'ru' ? 'ru-RU' : 'en-US';
      try {
        return await searchTmdb(query, language, env.TMDB_API_KEY);
      } catch (error) {
        console.error(error);
        throw new HttpError(502, 'TMDB is unavailable');
      }
    }

    case 'POST /api/lists': {
      const body = await readBody(request);
      const title = readTitle(body.title, MAX_LIST_TITLE_LENGTH);
      const kind = readEnum(body.kind, LIST_KINDS, 'kind');
      // The cap is checked inside the insert, so two requests at once cannot both pass it.
      const list = await db
        .prepare(
          `INSERT INTO lists (channel_id, title, kind, created_at) SELECT ?1, ?2, ?3, ?4
           WHERE (SELECT COUNT(*) FROM lists WHERE channel_id = ?1) < ${MAX_LISTS} RETURNING *`,
        )
        .bind(channelId, title, kind, now)
        .first<ListRow>();
      if (!list) throw new HttpError(409, `At most ${MAX_LISTS} lists`);
      return list;
    }

    case 'PATCH /api/lists/:id': {
      const list = await getOwnedList(db, channelId, id);
      const body = await readBody(request);
      const title = 'title' in body ? readTitle(body.title, MAX_LIST_TITLE_LENGTH) : list.title;
      const kind = 'kind' in body ? readEnum(body.kind, LIST_KINDS, 'kind') : list.kind;
      return db.prepare('UPDATE lists SET title = ?, kind = ? WHERE id = ? RETURNING *').bind(title, kind, id).first<ListRow>();
    }

    case 'DELETE /api/lists/:id':
      await getOwnedList(db, channelId, id);
      await db.batch([
        db.prepare('DELETE FROM lists WHERE id = ?').bind(id), // items go with it (ON DELETE CASCADE)
        // The sync stops with its list — a list created later may get the same id.
        db.prepare('UPDATE channels SET pointauc_list_id = NULL WHERE channel_id = ? AND pointauc_list_id = ?').bind(channelId, id),
      ]);
      return { ok: true };

    case 'POST /api/lists/:id/match-missing': {
      // Titles that were added without a poster get one if TMDB knows them for sure — a few per call, the ones never
      // (or longest ago) tried first, so every title gets its turn.
      const list = await getOwnedList(db, channelId, id);
      if (list.kind !== 'movies') return { updated: 0 };
      const missing = await db
        .prepare(
          `SELECT id, title FROM items WHERE list_id = ? AND tmdb_id IS NULL AND poster_path IS NULL
           ORDER BY match_tried_at IS NOT NULL, match_tried_at, id LIMIT ?`,
        )
        .bind(list.id, MAX_TMDB_LOOKUPS)
        .all<Pick<ItemRow, 'id' | 'title'>>();
      const { found, failed } = await matchTitles(env, missing.results.map((item) => item.title), requestBudget());
      const update = db.prepare('UPDATE items SET tmdb_id = ?, year = ?, poster_path = ?, tmdb_type = ? WHERE id = ?');
      const tried = db.prepare('UPDATE items SET match_tried_at = ? WHERE id = ?');
      const updates = missing.results.flatMap((item) => {
        const movie = found.get(item.title);
        return movie ? [update.bind(movie.tmdb_id, movie.year, movie.poster_path, movie.tmdb_type, item.id)] : [];
      });
      const misses = missing.results.filter((item) => !found.has(item.title) && !failed.has(item.title));
      if (updates.length + misses.length) await db.batch([...updates, ...misses.map((item) => tried.bind(now, item.id))]);
      return { updated: updates.length }; // updated: 0 — nothing viewers see changed, no snapshot
    }

    case 'PUT /api/lists/:id/order': {
      // Queue order after drag & drop: ids in their new order. Only some of the queue (dragged while a search hid the
      // rest, or a lot came in meanwhile): those items share out the places they held, the others stay put.
      await getOwnedList(db, channelId, id);
      const { ids } = await readBody(request);
      if (!Array.isArray(ids) || ids.length > MAX_ITEMS_PER_LIST || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length) {
        throw new HttpError(400, 'ids must be an array of distinct item ids');
      }
      const queue = (
        await db
          .prepare(`SELECT id, position FROM items WHERE list_id = ? AND status = 'queue' ORDER BY ${ITEM_ORDER}`)
          .bind(id)
          .all<Pick<ItemRow, 'id' | 'position'>>()
      ).results;
      const queued = new Set(queue.map((item) => item.id));
      const moved = (ids as number[]).filter((itemId) => queued.has(itemId));
      if (!moved.length) return { ok: true };
      const requested = new Set(moved);
      let next = 0;
      const order = queue.map((item) => (requested.has(item.id) ? moved[next++] : item.id));
      // Only rows whose place changed are written.
      const positions = new Map(queue.map((item) => [item.id, item.position]));
      const update = db.prepare("UPDATE items SET position = ? WHERE id = ? AND list_id = ? AND status = 'queue'");
      const changes = order.flatMap((itemId, index) => (positions.get(itemId) === index + 1 ? [] : [update.bind(index + 1, itemId, id)]));
      if (changes.length) await db.batch(changes);
      return { ok: true };
    }

    case 'POST /api/items': {
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, body.list_id);
      const title = readTitle(body.title, MAX_ITEM_TITLE_LENGTH);
      const status = body.status === undefined ? 'queue' : readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status');
      const fields = readMovieFields(body);
      // Checked before TMDB (no lookup for nothing). The panel checks the title too, but against the list it loaded.
      const existing = await db.prepare('SELECT title FROM items WHERE list_id = ?').bind(list.id).all<{ title: string }>();
      if (existing.results.some((item) => normalizeTitle(item.title) === normalizeTitle(title))) throw new HttpError(409, 'Already in the list');
      if (existing.results.length >= MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
      // Typed without picking a suggestion: TMDB may still know it for sure.
      if (list.kind === 'movies' && !('tmdb_id' in body)) Object.assign(fields, (await matchTitles(env, [title], requestBudget())).found.get(title));
      const item = await insertItem(db, { ...fields, list_id: list.id, title, status }, now, { checkLimit: true }).first<ItemRow>();
      if (!item) throw new HttpError(409, 'Already in the list'); // the same title came in meanwhile
      return item;
    }

    case 'POST /api/items/bulk': {
      // "Списком": many titles at once. Titles already in the list (or repeated in the paste) are skipped.
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, body.list_id);
      const status = body.status === undefined ? 'queue' : readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status');
      const source = body.source === 'pointauc' ? 'pointauc' : 'manual';
      if (!Array.isArray(body.titles) || body.titles.length > MAX_BULK_ITEMS) {
        throw new HttpError(400, `titles must be an array of at most ${MAX_BULK_ITEMS}`);
      }

      const existing = await db.prepare('SELECT title FROM items WHERE list_id = ?').bind(list.id).all<{ title: string }>();
      const seen = new Set(existing.results.map((item) => normalizeTitle(item.title)));
      const titles: string[] = [];
      for (const value of body.titles) {
        const title = readTitle(value, MAX_ITEM_TITLE_LENGTH);
        if (seen.has(normalizeTitle(title))) continue;
        seen.add(normalizeTitle(title));
        titles.push(title);
      }
      if (existing.results.length + titles.length > MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
      if (!titles.length) return { added: [], skipped: body.titles.length };

      const { found, unchecked } = await matchTitles(env, list.kind === 'movies' ? titles : [], requestBudget());
      const results = await db.batch<ItemRow>(
        titles.map((title) => insertItem(db, { ...found.get(title), list_id: list.id, title, status, source }, now)),
      );
      const added = results.flatMap((result) => result.results);
      // unchecked: titles past this request's TMDB budget; "match-missing" finds their posters later.
      return { added, skipped: body.titles.length - added.length, unchecked: unchecked.length };
    }

    case 'PATCH /api/items/:id': {
      const item = await getOwnedItem(db, channelId, id);
      const body = await readBody(request);
      // Only what the body names is written: the rest stays as it is in the row now, even if another request changed
      // it meanwhile (a title lookup in TMDB takes a while).
      const fields: Partial<Pick<ItemRow, 'title' | 'year' | 'tmdb_id' | 'poster_path' | 'tmdb_type'>> = readMovieFields(body);
      if ('title' in body) fields.title = readTitle(body.title, MAX_ITEM_TITLE_LENGTH);
      const status = 'status' in body ? readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status') : undefined;
      const rating = 'rating' in body ? readOptionalInt(body.rating, 'rating', 1, 10) : undefined;

      // The title was corrected and no poster was picked by hand: look it up again (clears a wrong poster too).
      if (fields.title !== undefined && fields.title !== item.title && !('tmdb_id' in body) && !('poster_path' in body)) {
        const list = await getOwnedList(db, channelId, item.list_id);
        const movie = list.kind === 'movies' ? (await matchTitles(env, [fields.title], requestBudget())).found.get(fields.title) : undefined;
        Object.assign(fields, { tmdb_id: null, year: null, poster_path: null, tmdb_type: null }, movie);
      }

      const values: unknown[] = [status ?? null, now, item.list_id, rating ?? null]; // ?1–?4
      const sets = Object.entries(fields).map(([column, value]) => `${column} = ?${values.push(value)}`);
      // SET reads the row as it was, so `status` below is the old one.
      if (status) {
        // "Просмотрено" stamps the date; "Вернуть в очередь" clears it and puts the item last in line.
        sets.push(
          `watched_at = CASE WHEN ?1 = 'queue' THEN NULL WHEN status = 'watched' THEN watched_at ELSE ?2 END`,
          `position = CASE WHEN ?1 = 'queue' AND status <> 'queue' THEN ${nextQueuePosition('?3')} ELSE position END`,
        );
      }
      if (status || rating !== undefined) {
        // Only watched items are rated; a requeued one starts over.
        sets.push(`rating = CASE WHEN ${status ? '?1' : 'status'} = 'watched' THEN ${rating !== undefined ? '?4' : 'rating'} ELSE NULL END`);
      }
      if (status) sets.push('status = ?1');
      if (!sets.length) return item;
      return db
        .prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?${values.push(id)} RETURNING *`)
        .bind(...values)
        .first<ItemRow>();
    }

    case 'DELETE /api/items/:id':
      const item = await getOwnedItem(db, channelId, id);
      const statements = [db.prepare('DELETE FROM items WHERE id = ?').bind(id)];
      if (item.lot_id) {
        statements.unshift(
          db
            .prepare(
              `INSERT INTO pending_lots (list_id, lot_id, name, points, status, created_at) VALUES (?, ?, ?, ?, 'dismissed', ?)
               ON CONFLICT (list_id, lot_id) DO UPDATE SET status = 'dismissed'`,
            )
            .bind(item.list_id, item.lot_id, item.title, item.points, now),
        );
      }
      await db.batch(statements);
      return { ok: true };

    default:
      throw new HttpError(404, 'Not found');
  }
};

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runAutoSync(env));
  },

  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      const secrets = [env.EXTENSION_SECRET, env.EXTENSION_SECRET_PREVIOUS].filter((secret): secret is string => !!secret);
      const claims = await verifyJwt(token, secrets);
      if (!claims) throw new HttpError(401, 'Invalid Twitch token');

      const { pathname } = new URL(request.url);
      const route = `${request.method} ${pathname.replace(/\/\d+(?=\/|$)/, '/:id')}`;
      const id = Number(pathname.match(/\/(\d+)(?=\/|$)/)?.[1]);

      // Viewers read the full lists of the channel they are watching (history and search beyond the snapshot) —
      // without what only the Worker needs (Pointauc lot ids, TMDB retries) and the add dates the panel never shows.
      // ponytail: one D1 read per viewer request, no edge cache; add caches.default keyed by channel if traffic grows.
      if (route === 'GET /api/viewer/channel') {
        const lists = await loadChannel(env.DB, claims.channel_id);
        const forViewer = ({ lot_id, added_at, match_tried_at, ...item }: ItemRow & { match_tried_at?: number | null }) => item;
        return json({ lists: lists.map((list) => ({ ...list, items: list.items.map(forViewer) })) });
      }

      // The details card a viewer opens by clicking a title (TMDB id and type come from the snapshot). Only titles of
      // this channel: the TMDB key is shared, so it is not a lookup service for any id.
      if (route === 'GET /api/movie/:id') {
        if (!env.TMDB_API_KEY) throw new HttpError(503, 'TMDB is not configured');
        const params = new URL(request.url).searchParams;
        const type = params.get('type') === 'tv' ? 'tv' : 'movie';
        const language = params.get('lang') === 'ru' ? 'ru-RU' : 'en-US';
        const isListed = await env.DB.prepare(
          `SELECT 1 FROM items JOIN lists ON lists.id = items.list_id
           WHERE lists.channel_id = ? AND items.tmdb_id = ? AND COALESCE(items.tmdb_type, 'movie') = ? LIMIT 1`,
        )
          .bind(claims.channel_id, id, type)
          .first();
        if (!isListed) throw new HttpError(404, 'Movie not found');
        try {
          return json(toMovieDetails(await tmdbRequest(`${type}/${id}`, { language }, env.TMDB_API_KEY), type));
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) throw new HttpError(404, 'Movie not found');
          console.error(error);
          throw new HttpError(502, 'TMDB is unavailable');
        }
      }
      if (claims.role !== 'broadcaster') throw new HttpError(403, 'Only the broadcaster can edit lists');

      const data = await handleApi(request, env, claims.channel_id, route, id);
      const isNoop = typeof data === 'object' && data !== null && 'updated' in data && data.updated === 0;
      if (request.method !== 'GET' && !isNoop) ctx.waitUntil(publishSnapshot(env, claims.channel_id));
      return json(data);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: 'Internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
