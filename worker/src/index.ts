import { signJwt, verifyJwt } from './jwt';
import { buildSnapshot, SNAPSHOT_VERSION, type ChannelList, type ItemRow, type ListRow } from './snapshot';

interface Env {
  DB: D1Database;
  EXTENSION_SECRET: string;
  CLIENT_ID: string;
  OWNER_ID: string;
}

const MAX_LISTS = 20;
const MAX_ITEMS_PER_LIST = 2000;
const MAX_BULK_ITEMS = 200;
const MAX_LIST_TITLE_LENGTH = 40;
const MAX_ITEM_TITLE_LENGTH = 200;
const LIST_KINDS = ['movies', 'games', 'custom'];
const ITEM_STATUSES = ['queue', 'watched'];

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
  const title = typeof value === 'string' ? value.trim() : '';
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
  if (typeof value !== 'string' || !/^\/[\w-]{1,64}\.(jpg|png)$/.test(value)) throw new HttpError(400, 'Invalid poster_path');
  return value;
};

/** Optional movie details (filled from TMDB). Only keys present in the body are returned. */
const readMovieFields = (body: Record<string, unknown>) => {
  const fields: Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path'>> = {};
  if ('year' in body) fields.year = readOptionalInt(body.year, 'year', 1870, 2100);
  if ('tmdb_id' in body) fields.tmdb_id = readOptionalInt(body.tmdb_id, 'tmdb_id', 1, 2 ** 31);
  if ('poster_path' in body) fields.poster_path = readPosterPath(body.poster_path);
  return fields;
};

const normalizeTitle = (title: string) => title.trim().toLowerCase();

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

// --- Twitch snapshot ---

// ponytail: one publish per write request, no cross-request debounce; concurrent writes may land out of order
// until the next write. Add a Durable Object debounce if Twitch rate limits (config ~20/min per channel) bite.
const publishSnapshot = async (env: Env, channelId: string) => {
  const content = buildSnapshot(await loadChannel(env.DB, channelId));
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

// --- routes ---

const handleApi = async (request: Request, env: Env, channelId: string, route: string, id: number) => {
  const db = env.DB;
  const now = Date.now();

  switch (route) {
    case 'GET /api/channel':
      return { lists: await loadChannel(db, channelId) };

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
      const { year = null, tmdb_id = null, poster_path = null } = readMovieFields(body);
      if ((await countItems(db, list.id)) >= MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);
      return db
        .prepare(
          `INSERT INTO items (list_id, title, year, tmdb_id, poster_path, status, position, added_at, watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ${NEXT_QUEUE_POSITION}, ?, ?) RETURNING *`,
        )
        .bind(list.id, title, year, tmdb_id, poster_path, status, list.id, now, status === 'watched' ? now : null)
        .first<ItemRow>();
    }

    case 'POST /api/items/bulk': {
      // "Списком": many titles at once. Titles already in the list (or repeated in the paste) are skipped.
      const body = await readBody(request);
      const list = await getOwnedList(db, channelId, Number(body.list_id));
      const status = body.status === undefined ? 'queue' : readEnum<ItemRow['status']>(body.status, ITEM_STATUSES, 'status');
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
      const insert = db.prepare(
        'INSERT INTO items (list_id, title, status, position, added_at, watched_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
      );
      const results = await db.batch<ItemRow>(
        titles.map((title, index) =>
          insert.bind(list.id, title, status, basePosition + index, now, status === 'watched' ? now : null),
        ),
      );
      return { added: results.map((result) => result.results[0]), skipped: body.titles.length - titles.length };
    }

    case 'PATCH /api/items/:id': {
      const item = await getOwnedItem(db, channelId, id);
      const body = await readBody(request);
      const next: ItemRow = { ...item, ...readMovieFields(body) };
      if ('title' in body) next.title = readTitle(body.title, MAX_ITEM_TITLE_LENGTH);
      if ('status' in body) next.status = readEnum(body.status, ITEM_STATUSES, 'status');

      // "Просмотрено" stamps the date; "Вернуть в очередь" clears it and puts the item last in line.
      const isStatusChanged = next.status !== item.status;
      next.watched_at = next.status === 'watched' ? (isStatusChanged ? now : item.watched_at) : null;
      const isRequeued = isStatusChanged && next.status === 'queue';

      return db
        .prepare(
          `UPDATE items SET title = ?, year = ?, tmdb_id = ?, poster_path = ?, status = ?, watched_at = ?,
           position = ${isRequeued ? NEXT_QUEUE_POSITION : '?'} WHERE id = ? RETURNING *`,
        )
        .bind(
          next.title,
          next.year,
          next.tmdb_id,
          next.poster_path,
          next.status,
          next.watched_at,
          isRequeued ? item.list_id : item.position,
          id,
        )
        .first<ItemRow>();
    }

    case 'DELETE /api/items/:id':
      await getOwnedItem(db, channelId, id);
      await db.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
      return { ok: true };

    default:
      throw new HttpError(404, 'Not found');
  }
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      const claims = await verifyJwt(token, env.EXTENSION_SECRET);
      if (!claims) throw new HttpError(401, 'Invalid Twitch token');
      if (claims.role !== 'broadcaster') throw new HttpError(403, 'Only the broadcaster can edit lists');

      const { pathname } = new URL(request.url);
      const route = `${request.method} ${pathname.replace(/\/\d+(?=\/|$)/, '/:id')}`;
      const id = Number(pathname.match(/\/(\d+)(?=\/|$)/)?.[1]);

      const data = await handleApi(request, env, claims.channel_id, route, id);
      if (request.method !== 'GET') ctx.waitUntil(publishSnapshot(env, claims.channel_id));
      return json(data);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: 'Internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
