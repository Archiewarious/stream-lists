// Pointauc: the streamer's token, their auction's lots, the import dialog and the automatic sync (cron and panel).

import {
  AUTO_ADD_MIN_VOTES,
  CRON_CHANNELS,
  HIDDEN_LOT_TTL_MS,
  HIDDEN_LOTS_PER_RUN,
  MAX_ITEMS_PER_LIST,
  OUTSIDE_TIMEOUT_MS,
  SUBREQUEST_LIMIT,
  SYNC_GIVE_UP_MS,
  SYNC_PACE_MS,
  SYNC_RETRY_MAX_MS,
  type Env,
} from './config';
import { decryptText } from './crypto';
import { base64ToBytes } from './base64';
import { HttpError } from './http';
import { knownLots, planLotSync, toPointaucLots, type LotSyncPlan, type PointaucLot } from './pointauc';
import { publishSnapshot } from './publish';
import type { ItemRow, ListRow } from './snapshot';
import { insertItem } from './store';
import { matchTitles, requestBudget, type Budget, type TmdbFields } from './tmdbFetch';

export const getEncryptionKey = (env: Env) => {
  let size = 0;
  try {
    size = base64ToBytes(env.TOKEN_ENCRYPTION_KEY ?? '').length;
  } catch {} // not base64
  if (size !== 32) throw new HttpError(503, 'TOKEN_ENCRYPTION_KEY must be base64 of 32 bytes');
  return env.TOKEN_ENCRYPTION_KEY!;
};

/** The stored Pointauc token in clear; one saved under another key cannot be read and has to be entered again. */
export const readPointaucToken = async (env: Env, stored: string) => {
  const key = getEncryptionKey(env);
  try {
    return await decryptText(stored, key);
  } catch {
    throw new HttpError(409, 'Pointauc token must be entered again');
  }
};

// Pointauc relays the request to the streamer's open pointauc.com tab; with the tab closed (or a bad token)
// it answers 500, not 403 — so every failure (no answer, not JSON, no lots) means "open Pointauc / check the token".
export const fetchPointaucLots = async (token: string) => {
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

/** The lots of the channel's auction now, by its stored token. */
export const loadPointaucLots = async (env: Env, storedToken: string | null | undefined) => {
  if (!storedToken) throw new HttpError(409, 'Pointauc is not connected');
  return fetchPointaucLots(await readPointaucToken(env, storedToken));
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type HiddenLot = { id: number; lot_id: string; name: string; seen_at: number | null };

/**
 * Hidden lots (deleted from the list or hidden from "pending") among the auction's lots now — by lot id or by title,
 * as ids change when the Pointauc tab is reloaded. Returns the test, and the write that marks them as still in the
 * auction (a hidden lot is forgotten 90 days after it was last there) — at most once a day per lot, as passes run
 * every few seconds.
 */
const matchHidden = (db: D1Database, hidden: HiddenLot[], lots: PointaucLot[], now: number) => {
  const isHiddenLot = knownLots(hidden.map((lot) => lot.lot_id), hidden.map((lot) => lot.name));
  const inAuction = knownLots(lots.map((lot) => lot.id), lots.map((lot) => lot.name));
  const seen = hidden.filter((lot) => inAuction(lot.lot_id, lot.name) && (lot.seen_at ?? 0) < now - DAY_MS).map((lot) => lot.id);
  return {
    isHidden: (lot: PointaucLot) => isHiddenLot(lot.id, lot.name),
    markSeen: seen.length
      ? db.prepare('UPDATE pending_lots SET seen_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now, JSON.stringify(seen))
      : null,
  };
};

/** The hidden lots of a list, for the import dialog: it never offers them again (typing the title in brings one back). */
export const loadHiddenLots = async (db: D1Database, listId: number, lots: PointaucLot[]) => {
  const hidden = await db
    .prepare("SELECT id, lot_id, name, seen_at FROM pending_lots WHERE list_id = ? AND status = 'dismissed'")
    .bind(listId)
    .all<HiddenLot>();
  const { isHidden, markSeen } = matchHidden(db, hidden.results, lots, Date.now());
  await markSeen?.run();
  return isHidden;
};

type ItemLots = Pick<ItemRow, 'id' | 'title' | 'points' | 'lot_id'>;
const loadItemLots = async (db: D1Database, listId: number) =>
  (await db.prepare('SELECT id, title, points, lot_id FROM items WHERE list_id = ?').bind(listId).all<ItemLots>()).results;

/** Writes of a sync: fresh bids for the items in `toUpdate`, and `lots` put into the list with what TMDB found. */
const lotWrites = (
  db: D1Database,
  list: ListRow,
  toUpdate: LotSyncPlan['toUpdate'],
  lots: PointaucLot[],
  found: Map<string, TmdbFields>,
  status: ItemRow['status'],
  now: number,
) => {
  const update = db.prepare('UPDATE items SET points = ?, lot_id = ? WHERE id = ?');
  return [
    ...toUpdate.map((change) => update.bind(change.points, change.lot_id, change.id)),
    ...lots.map((lot) =>
      insertItem(db, { ...found.get(lot.name), list_id: list.id, title: lot.name, status, source: 'pointauc', points: lot.amount, lot_id: lot.id }, now),
    ),
  ];
};

/**
 * The import dialog: puts the lots in `addIds` into the list (movies get their poster from TMDB) and refreshes the
 * bids of lots the list already has.
 */
export const importLots = async (env: Env, list: ListRow, lots: PointaucLot[], addIds: Set<string>, status: ItemRow['status']) => {
  const db = env.DB;
  const items = await loadItemLots(db, list.id);
  const plan = planLotSync(lots, items, addIds);
  if (items.length + plan.toAdd.length > MAX_ITEMS_PER_LIST) throw new HttpError(409, `At most ${MAX_ITEMS_PER_LIST} items`);

  const { found, unchecked } = await matchTitles(env, list.kind === 'movies' ? plan.toAdd.map((lot) => lot.name) : [], requestBudget());
  const writes = lotWrites(db, list, plan.toUpdate, plan.toAdd, found, status, Date.now());
  const results = writes.length ? await db.batch<ItemRow>(writes) : [];
  return { added: results.slice(plan.toUpdate.length).flatMap((result) => result.results), unchecked: unchecked.length };
};

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
export const autoSyncChannel = async (env: Env, channelId: string, listId: number, storedToken: string, budget: Budget, force = false) => {
  const db = env.DB;
  if (budget.left < 3) return false; // Pointauc and a publish do not fit: the next run will
  const list = await db.prepare('SELECT * FROM lists WHERE id = ? AND channel_id = ?').bind(listId, channelId).first<ListRow>();
  if (!list) return false;
  const now = Date.now();
  // The cron's next turn for the channel is a minute after its latest pass, however it ran (cron or panel).
  const claim = await db
    .prepare(
      `UPDATE channels SET pointauc_synced_at = ?1, pointauc_due_at = ?1
       WHERE channel_id = ?2 AND (?3 OR pointauc_synced_at IS NULL OR pointauc_synced_at <= ?1 - ${SYNC_PACE_MS})
       RETURNING pointauc_lots_hash, pointauc_failing_since`,
    )
    .bind(now, channelId, force ? 1 : 0)
    .first<{ pointauc_lots_hash: string | null; pointauc_failing_since: number | null }>();
  if (!claim) return false; // another pass ran moments ago

  budget.left -= 3; // Pointauc now, the publish at the end
  let lots: PointaucLot[];
  try {
    lots = await loadPointaucLots(env, storedToken);
  } catch (error) {
    // No answer (the Pointauc tab is closed, or the token has to be entered again): the cron asks again 1, 2, 4…
    // minutes later, at most hourly, and stops after 30 days — until the streamer opens a window (GET /api/channel).
    const since = claim.pointauc_failing_since ?? now;
    const retryAt = now - since > SYNC_GIVE_UP_MS ? null : now + Math.min(Math.max(now - since, MINUTE_MS), SYNC_RETRY_MAX_MS);
    await db
      .prepare('UPDATE channels SET pointauc_failing_since = ?, pointauc_due_at = ? WHERE channel_id = ?')
      .bind(since, retryAt, channelId)
      .run();
    budget.left += 2;
    throw error;
  }
  const answered =
    claim.pointauc_failing_since === null
      ? []
      : [db.prepare('UPDATE channels SET pointauc_failing_since = NULL WHERE channel_id = ?').bind(channelId)];
  // The day is part of the fingerprint: once a day a pass looks at the list even if the lots stay the same, so the
  // hidden lots still in the auction are marked as seen.
  const lotsHash = await fingerprint(JSON.stringify([list.id, Math.floor(now / DAY_MS), lots]));
  if (!force && lotsHash === claim.pointauc_lots_hash) {
    if (answered.length) await db.batch(answered);
    budget.left += 2;
    return false;
  }

  const [items, pending] = await Promise.all([
    loadItemLots(db, list.id),
    db
      .prepare('SELECT id, lot_id, name, points, status, seen_at FROM pending_lots WHERE list_id = ?')
      .bind(list.id)
      .all<HiddenLot & { points: number | null; status: 'pending' | 'dismissed' }>(),
  ]);
  // New: lots neither in the list (by lot or title) nor seen before in "pending" (by lot or title).
  const isSeen = knownLots(pending.results.map((lot) => lot.lot_id), pending.results.map((lot) => lot.name));
  const unseen = lots.filter((lot) => !isSeen(lot.id, lot.name));
  const plan = planLotSync(lots, items, new Set(unseen.map((lot) => lot.id)));
  const fresh = plan.toAdd;

  // A movie list looks new lots up in TMDB as far as the budget goes; the rest are picked up next pass. Other lists
  // have nothing to look up.
  const titles = list.kind === 'movies' ? fresh.map((lot) => lot.name) : [];
  const { found, failed, unchecked } = await matchTitles(env, titles, budget, AUTO_ADD_MIN_VOTES);
  const handled = fresh.filter((lot) => !failed.has(lot.name) && !unchecked.includes(lot.name));
  // Into the queue while the list has room; the rest waits for the streamer. A failed lookup is not "TMDB does not
  // know it": that lot stays unseen and is looked up again next pass.
  const room = Math.max(MAX_ITEMS_PER_LIST - items.length, 0);
  const toQueue = handled.filter((lot) => found.has(lot.name)).slice(0, room);
  const toPending = handled.filter((lot) => !toQueue.includes(lot));
  // Bids keep changing while a lot waits in "pending" too.
  const pendingBids = new Map(pending.results.filter((lot) => lot.status === 'pending').map((lot) => [lot.lot_id, lot.points]));
  const toRebid = lots.filter((lot) => pendingBids.has(lot.id) && pendingBids.get(lot.id) !== lot.amount);

  const park = db.prepare('INSERT OR IGNORE INTO pending_lots (list_id, lot_id, name, points, created_at) VALUES (?, ?, ?, ?, ?)');
  const rebid = db.prepare("UPDATE pending_lots SET points = ? WHERE list_id = ? AND lot_id = ? AND status = 'pending'");
  const statements = [
    ...lotWrites(db, list, plan.toUpdate, toQueue, found, 'queue', now),
    ...toPending.map((lot) => park.bind(list.id, lot.id, lot.name, lot.amount, now)),
    ...toRebid.map((lot) => rebid.bind(lot.amount, list.id, lot.id)),
  ];
  const { markSeen } = matchHidden(db, pending.results.filter((lot) => lot.status === 'dismissed'), lots, now);
  // The fingerprint is kept only when every lot was handled: lots left for later must not look done.
  const isComplete = handled.length === fresh.length;
  const remember = db.prepare('UPDATE channels SET pointauc_lots_hash = ? WHERE channel_id = ?').bind(isComplete ? lotsHash : null, channelId);
  await db.batch([...statements, ...(markSeen ? [markSeen] : []), ...answered, remember]);

  const isVisible = plan.toUpdate.length + toQueue.length > 0; // pending lots are not in the snapshot
  if (isVisible) await publishSnapshot(env, channelId);
  else budget.left += 2;
  return statements.length > 0;
};

/**
 * Cron entry: snapshots Twitch did not take go out again, then the channels whose turn has come — the longest
 * waiting first (a channel's turn is a minute after its latest pass, later while Pointauc does not answer, none after
 * 30 days of silence). A failing channel is just skipped. Last, a few hidden lots gone from the auction are forgotten.
 */
// ponytail: CRON_CHANNELS channels a minute, so with a few hundred syncing channels whose panels are closed each
// waits minutes for its turn — then a sync queue (or Workers Paid, with more subrequests per run).
export const runAutoSync = async (env: Env) => {
  const budget: Budget = { left: SUBREQUEST_LIMIT };
  const now = Date.now();
  const stale = await env.DB.prepare(`SELECT channel_id FROM channels WHERE snapshot_stale = 1 LIMIT ${CRON_CHANNELS}`).all<{ channel_id: string }>();
  for (const { channel_id } of stale.results) {
    budget.left -= 2;
    await publishSnapshot(env, channel_id);
  }

  const channels = await env.DB.prepare(
    `SELECT channel_id, pointauc_list_id, pointauc_token FROM channels
     WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL AND pointauc_due_at <= ?
     ORDER BY pointauc_due_at LIMIT ${CRON_CHANNELS}`,
  )
    .bind(now)
    .all<{ channel_id: string; pointauc_list_id: number; pointauc_token: string }>();
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

  await env.DB.prepare(
    `DELETE FROM pending_lots WHERE id IN (
       SELECT id FROM pending_lots WHERE status = 'dismissed' AND COALESCE(seen_at, created_at) < ? LIMIT ${HIDDEN_LOTS_PER_RUN})`,
  )
    .bind(now - HIDDEN_LOT_TTL_MS)
    .run();
};
