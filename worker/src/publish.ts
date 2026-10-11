// The viewers' snapshot: built from D1 and sent to Twitch (config segment and PubSub).

import { SNAPSHOT_PACE_MS } from './config';
import type { Env } from './env';
import { signJwt } from './jwt';
import { buildSnapshot, SNAPSHOT_MAX_ITEMS, SNAPSHOT_VERSION, type ChannelList, type ItemRow, type ListRow } from './snapshot';
import { ITEM_ORDER, loadTheme } from './store';

/** The channel's lists with only the items a snapshot can hold (the first of each kind, in display order). */
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

/** The channel's snapshot as it is in D1 now. */
export const buildChannelSnapshot = async (db: D1Database, channelId: string) =>
  buildSnapshot(await loadSnapshotLists(db, channelId), await loadTheme(db, channelId));

/**
 * Sends the channel's snapshot to Twitch (config segment and PubSub). Twitch takes about 20 config writes a minute,
 * so publishes of a channel go out at least SNAPSHOT_PACE_MS apart: the call that gets the next turn waits for it and
 * only then reads the channel; a call that finds the next turn already taken stops — the waiting one will read what
 * its request wrote. A publish Twitch did not take is marked, and the cron sends it again.
 */
export const publishSnapshot = async (env: Env, channelId: string) => {
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

  const content = await buildChannelSnapshot(db, channelId);
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
