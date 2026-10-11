import { decryptText, encryptText } from './crypto';
import { signJwt, verifyJwt } from './jwt';
import { matchLots, normalizeTitle, planLotSync, toPointaucLots, type PointaucLot } from './pointauc';
import { buildSnapshot, SNAPSHOT_VERSION, type ChannelList, type ItemRow, type ListRow } from './snapshot';
import { parseTheme, type ChannelTheme } from './theme';
import { pickMatch, POSTER_PATH, searchQueries, toMovieDetails, toTmdbResults, type TmdbResult } from './tmdb';

interface Env {
  DB: D1Database;
  EXTENSION_SECRET: string;
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
// A Worker request may make 50 subrequests; a few go to Pointauc and Twitch, the rest to TMDB lookups.
const MAX_TMDB_LOOKUPS = 25;
// The automatic sync queues a lot by itself only if TMDB's entry has this many votes — viewers write the lots,
// and TMDB has odd entries named like anything.
const AUTO_ADD_MIN_VOTES = 20;

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

const loadChannel = async (db: D1Database, channelId: string): Promise<ChannelList[]> => {
  const [lists, items] = await db.batch([
    db.prepare('SELECT * FROM lists WHERE channel_id = ? ORDER BY id').bind(channelId),
    db
      .prepare(
        `SELECT items.* FROM items JOIN lists ON lists.id = items.list_id WHERE lists.channel_id = ?
         ORDER BY CASE WHEN items.status = 'queue' THEN items.position ELSE -items.watched_at END, items.id DESC`,
      )
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
  if (!env.TOKEN_ENCRYPTION_KEY) throw new HttpError(503, 'TOKEN_ENCRYPTION_KEY is not configured');
  return env.TOKEN_ENCRYPTION_KEY;
};

// Pointauc relays the request to the streamer's open pointauc.com tab; with the tab closed (or a bad token)
// it answers 500, not 403 — so every failure means "open Pointauc / check the token".
const fetchPointaucLots = async (token: string) => {
  const response = await fetch('https://pointauc.com/api/oshino/lots', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new HttpError(502, `Pointauc ${response.status}`);
  return toPointaucLots(await response.json());
};

const getOwnedList = async (db: D1Database, channelId: string, listId: number) => {
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

const countItems = async (db: D1Database, listId: number) =>
  (await db.prepare('SELECT COUNT(*) AS count FROM items WHERE list_id = ?').bind(listId).first<number>('count')) ?? 0;

const NEXT_QUEUE_POSITION = "(SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE list_id = ? AND status = 'queue')";

// --- TMDB (the key stays here; the browser only sees the results) ---

/** Movies and shows; `language` like "ru-RU". Accepts a v3 API key or a v4 read access token (JWT, "eyJ…"). */
const tmdbRequest = async (path: string, params: Record<string, string>, apiKey: string) => {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
  else url.searchParams.set('api_key', apiKey);

  // Same request → same answer for a day; saves TMDB requests (typing, many viewers opening one film).
  const response = await fetch(url, { headers, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json<any>(); // shaped by toTmdbResults / toMovieDetails, which drop everything unexpected
};

const searchTmdb = async (query: string, language: string, apiKey: string) =>
  toTmdbResults(await tmdbRequest('search/multi', { query, language, include_adult: 'false' }, apiKey));

type TmdbFields = Pick<ItemRow, 'tmdb_id' | 'year' | 'poster_path' | 'tmdb_type'>;

/** Poster, year and TMDB id for the titles TMDB knows for sure; the others are simply absent from the map. */
const matchTitles = async (env: Env, titles: string[], minVotes = 0): Promise<Map<string, TmdbFields>> => {
  const found = new Map<string, TmdbFields>();
  const apiKey = env.TMDB_API_KEY;
  if (!apiKey) return found;
  await Promise.all(
    titles.slice(0, MAX_TMDB_LOOKUPS).map(async (title) => {
      try {
        let match: TmdbResult | null = null;
        for (const query of searchQueries(title)) {
          match = pickMatch(title, await searchTmdb(query.slice(0, 100), 'ru-RU', apiKey));
          if (match) break;
        }
        if (match && match.votes >= minVotes) {
          found.set(title, { tmdb_id: match.tmdb_id, year: match.year, poster_path: match.poster_path, tmdb_type: match.type });
        }
      } catch (error) {
        console.error('TMDB lookup failed', title, error);
      }
    }),
  );
  return found;
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

  const matched =
    list.kind === 'movies' ? await matchTitles(env, plan.toAdd.map((lot) => lot.name)) : new Map<string, TmdbFields>();
  const basePosition = (await db.prepare(`SELECT ${NEXT_QUEUE_POSITION} AS next`).bind(list.id).first<number>('next')) ?? 1;

  const update = db.prepare('UPDATE items SET points = ?, lot_id = ? WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, tmdb_type, status, position, added_at, watched_at, source, points, lot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pointauc', ?, ?) RETURNING *`,
  );
  const updates = plan.toUpdate.map((change) => update.bind(change.points, change.lot_id, change.id));
  const inserts = plan.toAdd.map((lot, index) => {
    const movie = matched.get(lot.name);
    return insert.bind(
      list.id,
      lot.name,
      movie?.year ?? null,
      movie?.tmdb_id ?? null,
      movie?.poster_path ?? null,
      movie?.tmdb_type ?? null,
      status,
      basePosition + index,
      now,
      status === 'watched' ? now : null,
      lot.amount,
      lot.id,
    );
  });
  const results = updates.length + inserts.length ? await db.batch<ItemRow>([...updates, ...inserts]) : [];
  return { added: results.slice(updates.length).map((result) => result.results[0]), updated: updates.length };
};

// --- Twitch snapshot ---

// ponytail: one publish per write request, no cross-request debounce; concurrent writes may land out of order
// until the next write. Add a Durable Object debounce if Twitch rate limits (config ~20/min per channel) bite.
const publishSnapshot = async (env: Env, channelId: string) => {
  const content = buildSnapshot(await loadChannel(env.DB, channelId), await loadTheme(env.DB, channelId));
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
    if (!response.ok) console.error('Twitch snapshot failed', response.url, response.status, await response.text());
  }
};

// --- automatic Pointauc sync ---

type PendingLot = { id: number; list_id: number; name: string; points: number | null };

/**
 * One sync pass for a channel: bids of known titles are refreshed; a new lot goes straight into the queue when TMDB
 * knows the title for sure (a movie list), otherwise it waits in "pending" for the streamer. A lot seen once is never
 * looked at again, so deleting or hiding it is final.
 */
const autoSyncChannel = async (env: Env, channelId: string, listId: number, storedToken: string) => {
  const db = env.DB;
  const list = await db.prepare('SELECT * FROM lists WHERE id = ? AND channel_id = ?').bind(listId, channelId).first<ListRow>();
  if (!list) return;
  const lots = await fetchPointaucLots(await decryptText(storedToken, getEncryptionKey(env)));

  const [items, pending] = await Promise.all([
    db
      .prepare('SELECT id, title, points, lot_id FROM items WHERE list_id = ?')
      .bind(list.id)
      .all<Pick<ItemRow, 'id' | 'title' | 'points' | 'lot_id'>>(),
    db.prepare('SELECT lot_id, name FROM pending_lots WHERE list_id = ?').bind(list.id).all<{ lot_id: string; name: string }>(),
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

  // At most a few lookups per pass (the Worker's subrequest budget); the rest are picked up a minute later.
  const batch = fresh.slice(0, MAX_TMDB_LOOKUPS);
  const matched = list.kind === 'movies'
      ? await matchTitles(env, batch.map((lot) => lot.name), AUTO_ADD_MIN_VOTES)
      : new Map<string, TmdbFields>();
  const toQueue = batch.filter((lot) => matched.has(lot.name));
  const toPending = batch.filter((lot) => !matched.has(lot.name));
  if (items.results.length + toQueue.length > MAX_ITEMS_PER_LIST) return;

  const now = Date.now();
  const basePosition = (await db.prepare(`SELECT ${NEXT_QUEUE_POSITION} AS next`).bind(list.id).first<number>('next')) ?? 1;
  const update = db.prepare('UPDATE items SET points = ?, lot_id = ? WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, tmdb_type, status, position, added_at, source, points, lot_id)
     VALUES (?, ?, ?, ?, ?, ?, 'queue', ?, ?, 'pointauc', ?, ?)`,
  );
  const park = db.prepare('INSERT OR IGNORE INTO pending_lots (list_id, lot_id, name, points, created_at) VALUES (?, ?, ?, ?, ?)');

  const statements = [
    ...plan.toUpdate.map((change) => update.bind(change.points, change.lot_id, change.id)),
    ...toQueue.map((lot, index) => {
      const movie = matched.get(lot.name)!;
      return insert.bind(list.id, lot.name, movie.year, movie.tmdb_id, movie.poster_path, movie.tmdb_type, basePosition + index, now, lot.amount, lot.id);
    }),
    ...toPending.map((lot) => park.bind(list.id, lot.id, lot.name, lot.amount, now)),
  ];
  if (!statements.length) return;

  await db.batch(statements);
  await publishSnapshot(env, channelId);
};

/** Cron entry: every channel that switched the sync on. A failing channel (Pointauc tab closed) is just skipped. */
// ponytail: channels are handled one after another within one invocation's subrequest budget (50); with many
// channels, spread them over several cron ticks or use a queue.
const runAutoSync = async (env: Env) => {
  const channels = await env.DB
    .prepare('SELECT channel_id, pointauc_list_id, pointauc_token FROM channels WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL LIMIT 10')
    .all<{ channel_id: string; pointauc_list_id: number; pointauc_token: string }>();

  for (const channel of channels.results) {
    try {
      await autoSyncChannel(env, channel.channel_id, channel.pointauc_list_id, channel.pointauc_token);
    } catch (error) {
      console.error('Auto sync failed', channel.channel_id, error);
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
      return {
        lists: await loadChannel(db, channelId),
        theme: settings?.theme ? parseTheme(JSON.parse(settings.theme)) : null,
        pointauc: !!settings?.pointauc_token,
        pointauc_list_id: settings?.pointauc_list_id ?? null,
        // Lots TMDB did not know — the streamer decides (the viewer snapshot never contains them).
        pending: (
          await db
            .prepare(
              `SELECT p.id, p.list_id, p.name, p.points FROM pending_lots p JOIN lists ON lists.id = p.list_id
               WHERE lists.channel_id = ? AND p.status = 'pending' ORDER BY p.id`,
            )
            .bind(channelId)
            .all<PendingLot>()
        ).results,
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
      const list = await getOwnedList(db, channelId, Number(new URL(request.url).searchParams.get('list_id')));
      const stored = (await loadSettings(db, channelId))?.pointauc_token;
      if (!stored) throw new HttpError(409, 'Pointauc is not connected');
      const lots = await fetchPointaucLots(await decryptText(stored, getEncryptionKey(env)));
      const items = await db
        .prepare(`SELECT title, status, watched_at FROM items WHERE list_id = ? ORDER BY position, id`)
        .bind(list.id)
        .all<Pick<ItemRow, 'title' | 'status' | 'watched_at'>>();
      return matchLots(lots, items.results);
    }

    case 'POST /api/pointauc/import': {
      // The lots are read from Pointauc here, not taken from the browser: only their ids come from the dialog.
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, Number(body.list_id));
      const status = body.status === undefined ? 'queue' : readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status');
      const lotIds = body.lot_ids;
      if (!Array.isArray(lotIds) || lotIds.length > MAX_BULK_ITEMS || !lotIds.every((lotId) => typeof lotId === 'string')) {
        throw new HttpError(400, `lot_ids must be an array of at most ${MAX_BULK_ITEMS} strings`);
      }
      const stored = (await loadSettings(db, channelId))?.pointauc_token;
      if (!stored) throw new HttpError(409, 'Pointauc is not connected');
      const lots = await fetchPointaucLots(await decryptText(stored, getEncryptionKey(env)));
      const { added } = await syncLots(env, list, lots, new Set<string>(lotIds), status);
      return { added, skipped: lotIds.length - added.length };
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
      const list = await getOwnedList(db, channelId, Number(listId));
      await saveSetting(db, channelId, 'pointauc_list_id', list.id);
      try {
        await autoSyncChannel(env, channelId, list.id, stored);
        return { ok: true, synced: true };
      } catch (error) {
        console.error('First sync failed', error); // stays on: the next minute may find the Pointauc tab open
        return { ok: true, synced: false };
      }
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
      if (list.kind === 'movies' && !('tmdb_id' in body)) Object.assign(fields, (await matchTitles(env, [title])).get(title));
      const { year = null, tmdb_id = null, poster_path = null, tmdb_type = null } = fields;

      const done = db.prepare("UPDATE pending_lots SET status = 'dismissed' WHERE id = ?").bind(row.id);
      const existing = await db.prepare('SELECT id, title FROM items WHERE list_id = ?').bind(list.id).all<{ id: number; title: string }>();
      if (existing.results.some((item) => normalizeTitle(item.title) === normalizeTitle(title))) {
        await done.run(); // the list has it already
        return { ok: true, added: false };
      }
      const insert = db
        .prepare(
          `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, tmdb_type, status, position, added_at, source, points, lot_id)
           VALUES (?, ?, ?, ?, ?, ?, 'queue', ${NEXT_QUEUE_POSITION}, ?, 'pointauc', ?, ?) RETURNING *`,
        )
        .bind(list.id, title, year, tmdb_id, poster_path, tmdb_type, list.id, now, row.points, row.lot_id);
      const [inserted] = await db.batch<ItemRow>([insert, done]);
      return { ok: true, added: true, item: inserted.results[0] };
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
      const listCount = await db.prepare('SELECT COUNT(*) AS count FROM lists WHERE channel_id = ?').bind(channelId).first<number>('count');
      if ((listCount ?? 0) >= MAX_LISTS) throw new HttpError(409, `At most ${MAX_LISTS} lists`);
      return db
        .prepare('INSERT INTO lists (channel_id, title, kind, created_at) VALUES (?, ?, ?, ?) RETURNING *')
        .bind(channelId, title, kind, now)
        .first<ListRow>();
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
      await db.prepare('DELETE FROM lists WHERE id = ?').bind(id).run(); // items go with it (ON DELETE CASCADE)
      return { ok: true };

    case 'POST /api/lists/:id/match-missing': {
      // Titles that were added without a poster get one if TMDB knows them for sure (a few per call).
      const list = await getOwnedList(db, channelId, id);
      if (list.kind !== 'movies') return { updated: 0 };
      const missing = await db
        .prepare('SELECT id, title FROM items WHERE list_id = ? AND tmdb_id IS NULL AND poster_path IS NULL ORDER BY id LIMIT ?')
        .bind(list.id, MAX_TMDB_LOOKUPS)
        .all<Pick<ItemRow, 'id' | 'title'>>();
      const matched = await matchTitles(env, missing.results.map((item) => item.title));
      const update = db.prepare('UPDATE items SET tmdb_id = ?, year = ?, poster_path = ?, tmdb_type = ? WHERE id = ?');
      const statements = missing.results.flatMap((item) => {
        const movie = matched.get(item.title);
        return movie ? [update.bind(movie.tmdb_id, movie.year, movie.poster_path, movie.tmdb_type, item.id)] : [];
      });
      if (statements.length) await db.batch(statements);
      return { updated: statements.length };
    }

    case 'PUT /api/lists/:id/order': {
      // Queue order after drag & drop: ids in their new order.
      await getOwnedList(db, channelId, id);
      const { ids } = await readBody(request);
      if (!Array.isArray(ids) || ids.length > MAX_ITEMS_PER_LIST || !ids.every(Number.isInteger)) {
        throw new HttpError(400, 'ids must be an array of item ids');
      }
      if (ids.length) {
        const update = db.prepare("UPDATE items SET position = ? WHERE id = ? AND list_id = ? AND status = 'queue'");
        await db.batch(ids.map((itemId, index) => update.bind(index + 1, itemId, id)));
      }
      return { ok: true };
    }

    case 'POST /api/items': {
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, Number(body.list_id));
      const title = readTitle(body.title, MAX_ITEM_TITLE_LENGTH);
      const status = body.status === undefined ? 'queue' : readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status');
      const fields = readMovieFields(body);
      // Typed without picking a suggestion: TMDB may still know it for sure.
      if (list.kind === 'movies' && !('tmdb_id' in body)) Object.assign(fields, (await matchTitles(env, [title])).get(title));
      const { year = null, tmdb_id = null, poster_path = null, tmdb_type = null } = fields;
      if ((await countItems(db, list.id)) >= MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
      return db
        .prepare(
          `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, tmdb_type, status, position, added_at, watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${NEXT_QUEUE_POSITION}, ?, ?) RETURNING *`,
        )
        .bind(list.id, title, year, tmdb_id, poster_path, tmdb_type, status, list.id, now, status === 'watched' ? now : null)
        .first<ItemRow>();
    }

    case 'POST /api/items/bulk': {
      // "Списком": many titles at once. Titles already in the list (or repeated in the paste) are skipped.
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, Number(body.list_id));
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

      const basePosition = (await db.prepare(`SELECT ${NEXT_QUEUE_POSITION} AS next`).bind(list.id).first<number>('next')) ?? 1;
      const matched = list.kind === 'movies' ? await matchTitles(env, titles) : new Map<string, TmdbFields>();
      const insert = db.prepare(
        `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, tmdb_type, status, position, added_at, watched_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      );
      const results = await db.batch<ItemRow>(
        titles.map((title, index) => {
          const movie = matched.get(title);
          return insert.bind(
            list.id,
            title,
            movie?.year ?? null,
            movie?.tmdb_id ?? null,
            movie?.poster_path ?? null,
            movie?.tmdb_type ?? null,
            status,
            basePosition + index,
            now,
            status === 'watched' ? now : null,
            source,
          );
        }),
      );
      return { added: results.map((result) => result.results[0]), skipped: body.titles.length - titles.length };
    }

    case 'PATCH /api/items/:id': {
      const item = await getOwnedItem(db, channelId, id);
      const body = await readBody(request);
      const next: ItemRow = { ...item, ...readMovieFields(body) };
      if ('title' in body) next.title = readTitle(body.title, MAX_ITEM_TITLE_LENGTH);
      if ('status' in body) next.status = readEnum(body.status, ITEM_STATUSES, 'status');
      if ('rating' in body) next.rating = readOptionalInt(body.rating, 'rating', 1, 10);
      if (next.status !== 'watched') next.rating = null; // only watched items are rated; a requeued one starts over

      // The title was corrected and no poster was picked by hand: look it up again (clears a wrong poster too).
      if (next.title !== item.title && !('tmdb_id' in body) && !('poster_path' in body)) {
        const list = await getOwnedList(db, channelId, item.list_id);
        const movie = list.kind === 'movies' ? (await matchTitles(env, [next.title])).get(next.title) : undefined;
        Object.assign(next, { tmdb_id: null, year: null, poster_path: null, tmdb_type: null }, movie);
      }

      // "Просмотрено" stamps the date; "Вернуть в очередь" clears it and puts the item last in line.
      const isStatusChanged = next.status !== item.status;
      next.watched_at = next.status === 'watched' ? (isStatusChanged ? now : item.watched_at) : null;
      const isRequeued = isStatusChanged && next.status === 'queue';

      return db
        .prepare(
          `UPDATE items SET title = ?, year = ?, tmdb_id = ?, poster_path = ?, tmdb_type = ?, rating = ?, status = ?, watched_at = ?,
           position = ${isRequeued ? NEXT_QUEUE_POSITION : '?'} WHERE id = ? RETURNING *`,
        )
        .bind(
          next.title,
          next.year,
          next.tmdb_id,
          next.poster_path,
          next.tmdb_type,
          next.rating,
          next.status,
          next.watched_at,
          isRequeued ? item.list_id : item.position,
          id,
        )
        .first<ItemRow>();
    }

    case 'DELETE /api/items/:id':
      const item = await getOwnedItem(db, channelId, id);
      const statements = [db.prepare('DELETE FROM items WHERE id = ?').bind(id)];
      if (item.lot_id) {
        statements.unshift(
          db
            .prepare(
              "INSERT OR IGNORE INTO pending_lots (list_id, lot_id, name, points, status, created_at) VALUES (?, ?, ?, ?, 'dismissed', ?)",
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
      const claims = await verifyJwt(token, env.EXTENSION_SECRET);
      if (!claims) throw new HttpError(401, 'Invalid Twitch token');

      const { pathname } = new URL(request.url);
      const route = `${request.method} ${pathname.replace(/\/\d+(?=\/|$)/, '/:id')}`;
      const id = Number(pathname.match(/\/(\d+)(?=\/|$)/)?.[1]);

      // Viewers read the full lists of the channel they are watching (history and search beyond the snapshot).
      // ponytail: one D1 read per viewer request, no edge cache; add caches.default keyed by channel if traffic grows.
      if (route === 'GET /api/viewer/channel') return json({ lists: await loadChannel(env.DB, claims.channel_id) });

      // The details card a viewer opens by clicking a title (TMDB id and type come from the snapshot).
      if (route === 'GET /api/movie/:id') {
        if (!env.TMDB_API_KEY) throw new HttpError(503, 'TMDB is not configured');
        const params = new URL(request.url).searchParams;
        const type = params.get('type') === 'tv' ? 'tv' : 'movie';
        const language = params.get('lang') === 'ru' ? 'ru-RU' : 'en-US';
        try {
          const details = await tmdbRequest(`${type}/${id}`, { language }, env.TMDB_API_KEY);
          return json(toMovieDetails(details, type, id));
        } catch (error) {
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
