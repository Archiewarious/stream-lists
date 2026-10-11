// The API, one entry per route: the broadcaster's lists and settings, and the reads viewers may make.

import {
  ITEM_STATUSES,
  LIST_KINDS,
  MAX_BULK_ITEMS,
  MAX_ITEM_TITLE_LENGTH,
  MAX_ITEMS_PER_LIST,
  MAX_LIST_TITLE_LENGTH,
  MAX_LISTS,
  MAX_TMDB_LOOKUPS,
  SUBREQUEST_LIMIT,
  type Env,
} from './config';
import { encryptText } from './crypto';
import { HttpError, readBody, readEnum, readMovieFields, readOptionalInt, readStatus, readTitle } from './http';
import { matchLots, normalizeTitle } from './pointauc';
import { buildChannelSnapshot } from './publish';
import { searchItems, VIEWER_FIELDS, VIEWER_PAGE, type ItemRow, type ListRow, type ViewerItem } from './snapshot';
import {
  getOwnedItem,
  getOwnedList,
  insertItem,
  ITEM_ORDER,
  loadChannel,
  loadSettings,
  nextQueuePosition,
  saveSetting,
  type PendingLot,
} from './store';
import { parseTheme } from './theme';
import { toMovieDetails } from './tmdb';
import { lookUpTyped, matchTitles, requestBudget, searchTmdb, tmdbRequest } from './tmdbFetch';
import { autoSyncChannel, fetchPointaucLots, getEncryptionKey, importLots, loadHiddenLots, loadPointaucLots, readPointaucToken } from './sync';

export interface RouteContext {
  request: Request;
  env: Env;
  db: D1Database;
  channelId: string;
  /** The number in the path (`:id`). */
  id: number;
  now: number;
}

interface Route {
  handle: (context: RouteContext) => Promise<unknown>;
  /** Any viewer of the channel may call it; every other route is the broadcaster's. */
  viewer?: boolean;
  /** Whether the answer means the viewers' snapshot changed; it is then published once the response is out. */
  publishes?: boolean | ((data: any) => boolean);
}

export const routes: Record<string, Route> = {
  // The panel shows the snapshot from Twitch and asks for more only as the viewer gets to it: the next page of the
  // queue or the history, a search. Nothing a viewer reads is the whole channel any more.
  'GET /api/viewer/items': {
    viewer: true,
    handle: async ({ request, db, channelId }) => {
      const params = new URL(request.url).searchParams;
      const list = await getOwnedList(db, channelId, params.get('list_id'));
      const status = readEnum<ItemRow['status']>(params.get('status'), ITEM_STATUSES, 'status');
      const offset = Number(params.get('offset') ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > MAX_ITEMS_PER_LIST) throw new HttpError(400, 'Invalid offset');
      // ponytail: ORDER BY an expression sorts the whole status of the list for every page (≤ 2000 rows read);
      // an expression index matching ITEM_ORDER if lists get that long and are paged through a lot.
      const items = await db
        .prepare(`SELECT ${VIEWER_FIELDS.join(', ')} FROM items WHERE list_id = ? AND status = ? ORDER BY ${ITEM_ORDER} LIMIT ? OFFSET ?`)
        .bind(list.id, status, VIEWER_PAGE, offset)
        .all<ViewerItem>();
      return { items: items.results };
    },
  },

  'GET /api/viewer/search': {
    viewer: true,
    handle: async ({ request, db, channelId }) => {
      const params = new URL(request.url).searchParams;
      const list = await getOwnedList(db, channelId, params.get('list_id'));
      const query = params.get('q')?.trim() ?? '';
      if (!query || query.length > 100) throw new HttpError(400, 'q must be 1–100 characters');
      // Matched in JS: SQLite's LIKE and lower() know only ASCII letters, and titles are mostly Cyrillic.
      const items = await db
        .prepare(`SELECT ${VIEWER_FIELDS.join(', ')}, status FROM items WHERE list_id = ? ORDER BY ${ITEM_ORDER}`)
        .bind(list.id)
        .all<ViewerItem & Pick<ItemRow, 'status'>>();
      return searchItems(items.results, query, VIEWER_PAGE);
    },
  },

  // The snapshot itself, for a panel that did not get a readable one from Twitch.
  'GET /api/viewer/snapshot': {
    viewer: true,
    handle: async ({ db, channelId }) => JSON.parse(await buildChannelSnapshot(db, channelId)),
  },

  // The whole channel, as the panel of version 0.0.1 reads it for its history and search.
  'GET /api/viewer/channel': {
    viewer: true,
    handle: async ({ db, channelId }) => {
      const lists = await loadChannel(db, channelId);
      const forViewer = ({ lot_id, added_at, match_tried_at, ...item }: ItemRow & { match_tried_at?: number | null }) => item;
      return { lists: lists.map((list) => ({ ...list, items: list.items.map(forViewer) })) };
    },
  },

  // The details card a viewer opens by clicking a title (TMDB id and type come from the snapshot). Only titles of
  // this channel: the TMDB key is shared, so it is not a lookup service for any id.
  'GET /api/movie/:id': {
    viewer: true,
    handle: async ({ request, env, db, channelId, id }) => {
      if (!env.TMDB_API_KEY) throw new HttpError(503, 'TMDB is not configured');
      const params = new URL(request.url).searchParams;
      const type = params.get('type') === 'tv' ? 'tv' : 'movie';
      const language = params.get('lang') === 'ru' ? 'ru-RU' : 'en-US';
      const isListed = await db
        .prepare(
          `SELECT 1 FROM items JOIN lists ON lists.id = items.list_id
           WHERE lists.channel_id = ? AND items.tmdb_id = ? AND COALESCE(items.tmdb_type, 'movie') = ? LIMIT 1`,
        )
        .bind(channelId, id, type)
        .first();
      if (!isListed) throw new HttpError(404, 'Movie not found');
      try {
        return toMovieDetails(await tmdbRequest(`${type}/${id}`, { language }, env.TMDB_API_KEY), type);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) throw new HttpError(404, 'Movie not found');
        console.error(error);
        throw new HttpError(502, 'TMDB is unavailable');
      }
    },
  },

  'GET /api/channel': {
    handle: async ({ env, db, channelId, now }) => {
      const settings = await loadSettings(db, channelId);
      const lists = await loadChannel(db, channelId);
      // The streamer is back: an automatic sync that stopped after 30 days without Pointauc's answer starts again.
      if (settings?.pointauc_token && settings.pointauc_list_id !== null && settings.pointauc_due_at === null) {
        await db
          .prepare('UPDATE channels SET pointauc_due_at = ?, pointauc_failing_since = NULL WHERE channel_id = ?')
          .bind(now, channelId)
          .run();
      }
      // A token saved under another encryption key cannot be used: the window offers to connect again.
      const isPointaucReadable =
        !!settings?.pointauc_token && (await readPointaucToken(env, settings.pointauc_token).then(() => true, () => false));
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
        pointauc: isPointaucReadable,
        pointauc_list_id: settings?.pointauc_list_id ?? null,
        pending: pending.results.filter((lot) => !isInList(lot)).map(({ lot_id, ...lot }) => lot),
      };
    },
  },

  'PUT /api/theme': {
    publishes: true,
    handle: async ({ request, db, channelId }) => {
      const theme = parseTheme(await readBody(request));
      if (!theme) throw new HttpError(400, 'Expected { preset } or { primary, accent } as #rrggbb');
      await saveSetting(db, channelId, 'theme', JSON.stringify(theme));
      return theme;
    },
  },

  'PUT /api/pointauc/token': {
    handle: async ({ request, env, db, channelId }) => {
      // Checked against Pointauc before saving, so a typo shows up right away (needs the Pointauc tab open).
      const { token } = await readBody(request);
      if (typeof token !== 'string' || !/^\S{10,2000}$/.test(token.trim())) throw new HttpError(400, 'Invalid token');
      await fetchPointaucLots(token.trim());
      await saveSetting(db, channelId, 'pointauc_token', await encryptText(token.trim(), getEncryptionKey(env)));
      return { ok: true };
    },
  },

  'DELETE /api/pointauc/token': {
    handle: async ({ db, channelId }) => {
      await saveSetting(db, channelId, 'pointauc_token', null);
      await saveSetting(db, channelId, 'pointauc_list_id', null);
      return { ok: true };
    },
  },

  'GET /api/pointauc/lots': {
    handle: async ({ request, env, db, channelId }) => {
      const list = await getOwnedList(db, channelId, new URL(request.url).searchParams.get('list_id'));
      const lots = await loadPointaucLots(env, (await loadSettings(db, channelId))?.pointauc_token);
      const items = await db
        .prepare(`SELECT title, status, watched_at FROM items WHERE list_id = ? ORDER BY ${ITEM_ORDER}`) // places as the panel shows them
        .bind(list.id)
        .all<Pick<ItemRow, 'title' | 'status' | 'watched_at'>>();
      // A lot the streamer deleted from the list or hid is not offered again (one typed in is in the list again).
      const isHidden = await loadHiddenLots(db, list.id, lots);
      return matchLots(lots, items.results).filter((lot) => lot.status !== 'new' || !isHidden(lot));
    },
  },

  'POST /api/pointauc/import': {
    publishes: true,
    handle: async ({ request, env, db, channelId }) => {
      // The lots are read from Pointauc here, not taken from the browser: only their ids come from the dialog.
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, body.list_id);
      const status = readStatus(body.status);
      const lotIds = body.lot_ids;
      if (!Array.isArray(lotIds) || lotIds.length > MAX_BULK_ITEMS || !lotIds.every((lotId) => typeof lotId === 'string')) {
        throw new HttpError(400, `lot_ids must be an array of at most ${MAX_BULK_ITEMS} strings`);
      }
      const lots = await loadPointaucLots(env, (await loadSettings(db, channelId))?.pointauc_token);
      const isHidden = await loadHiddenLots(db, list.id, lots);
      const addIds = new Set(lots.filter((lot) => lotIds.includes(lot.id) && !isHidden(lot)).map((lot) => lot.id));
      const { added, unchecked } = await importLots(env, list, lots, addIds, status);
      return { added, skipped: lotIds.length - added.length, unchecked };
    },
  },

  // Switches the automatic sync on for one list (or off with list_id: null); the first pass runs right away and
  // publishes by itself.
  'PUT /api/pointauc/sync': {
    handle: async ({ request, env, db, channelId, now }) => {
      const { list_id: listId } = await readBody(request);
      if (listId === null) {
        await saveSetting(db, channelId, 'pointauc_list_id', null);
        return { ok: true, synced: true };
      }
      const stored = (await loadSettings(db, channelId))?.pointauc_token;
      if (!stored) throw new HttpError(409, 'Pointauc is not connected');
      const list = await getOwnedList(db, channelId, listId);
      // A fresh start: 30 days of Pointauc's silence before the sync stops again.
      await db
        .prepare('UPDATE channels SET pointauc_list_id = ?, pointauc_due_at = ?, pointauc_failing_since = NULL WHERE channel_id = ?')
        .bind(list.id, now, channelId)
        .run();
      try {
        await autoSyncChannel(env, channelId, list.id, stored, { left: SUBREQUEST_LIMIT }, true);
        return { ok: true, synced: true };
      } catch (error) {
        console.error('First sync failed', error); // stays on: the next minute may find the Pointauc tab open
        return { ok: true, synced: false };
      }
    },
  },

  // A sync pass on demand: the streamer's open panel calls it every few seconds, so a lot added in Pointauc shows up
  // almost at once instead of at the next cron tick. Publishing is done by the pass itself.
  'POST /api/pointauc/refresh': {
    handle: async ({ env, db, channelId }) => {
      const settings = await loadSettings(db, channelId);
      if (!settings?.pointauc_token || settings.pointauc_list_id === null) return { updated: 0, changed: false };
      const changed = await autoSyncChannel(env, channelId, settings.pointauc_list_id, settings.pointauc_token, { left: SUBREQUEST_LIMIT });
      return { updated: 0, changed };
    },
  },

  // The streamer looked at a lot TMDB did not know: put it into the queue (title may be corrected first).
  'POST /api/pending/:id/accept': {
    publishes: (data: { added: boolean }) => data.added,
    handle: async ({ request, env, db, channelId, id, now }) => {
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
      const fields = { ...readMovieFields(body), ...(await lookUpTyped(env, list, title, body)) };

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
    },
  },

  'DELETE /api/pending/:id': {
    handle: async ({ db, channelId, id, now }) => {
      await db
        .prepare(
          `UPDATE pending_lots SET status = 'dismissed', seen_at = ?
           WHERE id = ? AND list_id IN (SELECT id FROM lists WHERE channel_id = ?)`,
        )
        .bind(now, id, channelId)
        .run();
      return { ok: true };
    },
  },

  'GET /api/tmdb/search': {
    handle: async ({ request, env }) => {
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
    },
  },

  'POST /api/lists': {
    publishes: true,
    handle: async ({ request, db, channelId, now }) => {
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
    },
  },

  'PATCH /api/lists/:id': {
    publishes: true,
    handle: async ({ request, db, channelId, id }) => {
      const list = await getOwnedList(db, channelId, id);
      const body = await readBody(request);
      const title = 'title' in body ? readTitle(body.title, MAX_LIST_TITLE_LENGTH) : list.title;
      const kind = 'kind' in body ? readEnum(body.kind, LIST_KINDS, 'kind') : list.kind;
      return db.prepare('UPDATE lists SET title = ?, kind = ? WHERE id = ? RETURNING *').bind(title, kind, id).first<ListRow>();
    },
  },

  'DELETE /api/lists/:id': {
    publishes: true,
    handle: async ({ db, channelId, id }) => {
      await getOwnedList(db, channelId, id);
      await db.batch([
        db.prepare('DELETE FROM lists WHERE id = ?').bind(id), // items go with it (ON DELETE CASCADE)
        // The sync stops with its list — a list created later may get the same id.
        db.prepare('UPDATE channels SET pointauc_list_id = NULL WHERE channel_id = ? AND pointauc_list_id = ?').bind(channelId, id),
      ]);
      return { ok: true };
    },
  },

  // Titles that were added without a poster get one if TMDB knows them for sure — a few per call, the ones never
  // (or longest ago) tried first, so every title gets its turn.
  'POST /api/lists/:id/match-missing': {
    publishes: (data: { updated: number }) => data.updated > 0,
    handle: async ({ env, db, channelId, id, now }) => {
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
      return { updated: updates.length };
    },
  },

  // Queue order after drag & drop: ids in their new order. Only some of the queue (dragged while a search hid the
  // rest, or a lot came in meanwhile): those items share out the places they held, the others stay put.
  'PUT /api/lists/:id/order': {
    publishes: true,
    handle: async ({ request, db, channelId, id }) => {
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
    },
  },

  'POST /api/items': {
    publishes: true,
    handle: async ({ request, env, db, channelId, now }) => {
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, body.list_id);
      const title = readTitle(body.title, MAX_ITEM_TITLE_LENGTH);
      const status = readStatus(body.status);
      const fields = readMovieFields(body);
      // Checked before TMDB (no lookup for nothing). The panel checks the title too, but against the list it loaded.
      const existing = await db.prepare('SELECT title FROM items WHERE list_id = ?').bind(list.id).all<{ title: string }>();
      if (existing.results.some((item) => normalizeTitle(item.title) === normalizeTitle(title))) throw new HttpError(409, 'Already in the list');
      if (existing.results.length >= MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
      Object.assign(fields, await lookUpTyped(env, list, title, body));
      const item = await insertItem(db, { ...fields, list_id: list.id, title, status }, now, { checkLimit: true }).first<ItemRow>();
      if (!item) throw new HttpError(409, 'Already in the list'); // the same title came in meanwhile
      return item;
    },
  },

  // "Списком": many titles at once. Titles already in the list (or repeated in the paste) are skipped.
  'POST /api/items/bulk': {
    publishes: true,
    handle: async ({ request, env, db, channelId, now }) => {
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, body.list_id);
      const status = readStatus(body.status);
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
    },
  },

  'PATCH /api/items/:id': {
    publishes: true,
    handle: async ({ request, env, db, channelId, id, now }) => {
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
    },
  },

  'DELETE /api/items/:id': {
    publishes: true,
    handle: async ({ db, channelId, id, now }) => {
      const item = await getOwnedItem(db, channelId, id);
      const statements = [db.prepare('DELETE FROM items WHERE id = ?').bind(id)];
      if (item.lot_id) {
        // Its lot is not brought back by the sync.
        statements.unshift(
          db
            .prepare(
              `INSERT INTO pending_lots (list_id, lot_id, name, points, status, created_at, seen_at)
               VALUES (?1, ?2, ?3, ?4, 'dismissed', ?5, ?5)
               ON CONFLICT (list_id, lot_id) DO UPDATE SET status = 'dismissed', seen_at = ?5`,
            )
            .bind(item.list_id, item.lot_id, item.title, item.points, now),
        );
      }
      await db.batch(statements);
      return { ok: true };
    },
  },
};
