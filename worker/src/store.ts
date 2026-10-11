// D1 access. Every query is scoped to the channel from the JWT.

import { MAX_ITEMS_PER_LIST } from './config';
import { HttpError } from './http';
import type { ChannelList, ItemRow, ListRow } from './snapshot';
import { parseTheme, type ChannelTheme } from './theme';

// The queue is ordered like the auction: the biggest bid first; titles without a bid (not from Pointauc) follow in the
// streamer's own order. Watched items: newest first. Every place that shows or numbers the queue uses this.
export const ITEM_ORDER = `CASE WHEN items.status = 'queue' THEN -COALESCE(items.points, -1) ELSE 0 END,
  CASE WHEN items.status = 'queue' THEN items.position ELSE -items.watched_at END, items.id DESC`;

export type PendingLot = { id: number; list_id: number; name: string; points: number | null };

export const loadChannel = async (db: D1Database, channelId: string): Promise<ChannelList[]> => {
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

export const loadSettings = (db: D1Database, channelId: string) =>
  db
    .prepare('SELECT theme, pointauc_token, pointauc_list_id FROM channels WHERE channel_id = ?')
    .bind(channelId)
    .first<{ theme: string | null; pointauc_token: string | null; pointauc_list_id: number | null }>();

export const loadTheme = async (db: D1Database, channelId: string): Promise<ChannelTheme | null> => {
  const stored = (await loadSettings(db, channelId))?.theme;
  return stored ? parseTheme(JSON.parse(stored)) : null;
};

export const saveSetting = (
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

/** `value` comes from a path, a JSON body or a query string: an integer or a string of digits, nothing else. */
export const getOwnedList = async (db: D1Database, channelId: string, value: unknown) => {
  const listId = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(listId)) throw new HttpError(400, 'list_id must be an integer');
  const list = await db
    .prepare('SELECT * FROM lists WHERE id = ? AND channel_id = ?')
    .bind(listId, channelId)
    .first<ListRow>();
  if (!list) throw new HttpError(404, 'List not found');
  return list;
};

export const getOwnedItem = async (db: D1Database, channelId: string, itemId: number) => {
  const item = await db
    .prepare('SELECT items.* FROM items JOIN lists ON lists.id = items.list_id WHERE items.id = ? AND lists.channel_id = ?')
    .bind(itemId, channelId)
    .first<ItemRow>();
  if (!item) throw new HttpError(404, 'Item not found');
  return item;
};

/** The place after the last queued item of a list; `listId` is the SQL parameter that holds the list id. */
export const nextQueuePosition = (listId: string) =>
  `(SELECT COALESCE(MAX(position), 0) + 1 FROM items WHERE list_id = ${listId} AND status = 'queue')`;

type NewItem = Pick<ItemRow, 'list_id' | 'title' | 'status'> &
  Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path' | 'tmdb_type' | 'source' | 'points' | 'lot_id'>>;

/**
 * Inserts one item at the end of the queue; RETURNING gives the row, or nothing if it was skipped: the list already
 * has its title or its Pointauc lot. The callers check that in JS first, and this repeats it inside the write, so two
 * requests at once (a double click, two sync passes) cannot both add it. `checkLimit` keeps the list within
 * MAX_ITEMS_PER_LIST the same way (batches count beforehand).
 */
export const insertItem = (db: D1Database, item: NewItem, now: number, { checkLimit = false } = {}) => {
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
