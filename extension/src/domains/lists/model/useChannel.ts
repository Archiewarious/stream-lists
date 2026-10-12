import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_TMDB_LOOKUPS } from '@worker/config';
import { buildSnapshot, type ChannelList, type ItemRow, type ListRow } from '@worker/snapshot';
import type { ChannelTheme } from '@worker/theme';
import { applyTheme } from '@app/presets';
import { reorderInPlace, requeueIndex } from '@domains/lists/lib/items';
import { callWorker } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

export type ListKind = ListRow['kind'];

/** A Pointauc lot the sync could not verify with TMDB — waits for the streamer's decision. */
export interface PendingLot {
  id: number;
  list_id: number;
  name: string;
  points: number | null;
}
export type ItemStatus = ItemRow['status'];
export type MovieFields = Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path' | 'tmdb_type'>>;
export type EditableItemFields = MovieFields & Partial<Pick<ItemRow, 'title' | 'rating'>>;
/** A bulk add or an import: `unchecked` titles went in without a TMDB lookup. */
export type AddResult = { added: ItemRow[]; skipped: number; unchecked?: number };

type ListsUpdate = (lists: ChannelList[]) => ChannelList[];

const updateItem = (lists: ChannelList[], itemId: number, update: (items: ItemRow[], item: ItemRow) => ItemRow[]) =>
  lists.map((list) => {
    const item = list.items.find((candidate) => candidate.id === itemId);
    return item ? { ...list, items: update(list.items, item) } : list;
  });

/**
 * The streamer's lists from the Worker. Edits show up at once (optimistic) and the channel is reloaded
 * once every pending request has finished, so the server stays the source of truth. A snapshot the Worker
 * broadcasts reloads it too, unless it is what the window shows already (its own edit).
 */
export const useChannel = () => {
  const [lists, setLists] = useState<ChannelList[] | null>(null);
  const [theme, setTheme] = useState<ChannelTheme | null>(null);
  const [isPointaucConnected, setIsPointaucConnected] = useState(false);
  const [pointaucListId, setPointaucListId] = useState<number | null>(null);
  const [pendingLots, setPendingLots] = useState<PendingLot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(0);
  const reloadSeq = useRef(0);
  // The server's state as last loaded, to tell a broadcast of the window's own edit from a change made elsewhere.
  const loaded = useRef<{ lists: ChannelList[]; theme: ChannelTheme | null } | null>(null);
  // A color being picked and not saved yet: a reload meanwhile must not repaint the window with the old one.
  const unsavedTheme = useRef<ChannelTheme | null>(null);

  // `afterEdit`: the load follows the window's own edit, so a failure also says the edit may not be saved.
  const load = useCallback(async (afterEdit: boolean) => {
    const seq = ++reloadSeq.current;
    try {
      const channel = await callWorker<{
        lists: ChannelList[];
        theme: ChannelTheme | null;
        pointauc: boolean;
        pointauc_list_id: number | null;
        pending: PendingLot[];
      }>('GET', '/api/channel');
      // A newer reload is coming, or an edit started meanwhile (its own reload follows): this answer is stale
      // and would roll back the newer optimistic state.
      if (seq !== reloadSeq.current || pending.current) return;
      loaded.current = { lists: channel.lists, theme: channel.theme };
      setLists(channel.lists);
      if (!unsavedTheme.current) {
        setTheme(channel.theme);
        applyTheme(channel.theme); // the streamer sees their window in the same colors as viewers
      }
      setIsPointaucConnected(channel.pointauc);
      setPointaucListId(channel.pointauc_list_id);
      setPendingLots(channel.pending);
      setLoadError(null);
      if (import.meta.env.DEV) twitchApi.mirrorSnapshot?.(buildSnapshot(channel.lists, channel.theme));
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      // The lists on screen may hold an edit the server never confirmed: say so where save errors show.
      if (afterEdit && loaded.current) setSaveError((current) => current ?? message);
    }
  }, []);
  const reload = useCallback(() => load(false), [load]);

  // Every snapshot the Worker broadcasts (cron sync, another window) reloads the lists, unless it shows what they have.
  useEffect(
    () =>
      twitchApi.listenBroadcast((content) => {
        const current = loaded.current;
        if (pending.current || (current && content === buildSnapshot(current.lists, current.theme))) return;
        reload();
      }),
    [reload],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  /** Returns the response, or undefined if the request failed (the error is shown via saveError). */
  const run = async <T>(request: () => Promise<T>, optimistic?: ListsUpdate): Promise<T | undefined> => {
    if (optimistic) setLists((current) => current && optimistic(current));
    pending.current += 1;
    setIsSaving(true);
    try {
      return await request();
    } catch (error) {
      setSaveError((error as Error).message);
      return undefined;
    } finally {
      pending.current -= 1;
      if (!pending.current) {
        await load(true); // also rolls back an optimistic edit that failed
        if (!pending.current) setIsSaving(false);
      }
    }
  };

  /** Posters for titles that were added without one: `rounds` calls of up to MAX_TMDB_LOOKUPS titles each ("match-missing" looks up that many). */
  const matchMissing = async (listId: number, rounds = 1) => {
    for (let round = 0; round < rounds; round++) {
      if (!(await run(() => callWorker<{ updated: number }>('POST', `/api/lists/${listId}/match-missing`)))) return;
    }
  };

  /** Titles a bulk add or an import put in without a lookup (the request's TMDB budget ran out): looked up now. */
  const matchUnchecked = (listId: number, result: AddResult | undefined) => {
    if (result?.unchecked) matchMissing(listId, Math.ceil(result.unchecked / MAX_TMDB_LOOKUPS));
    return result;
  };

  // Once per list per visit: titles that were added without a poster get one if TMDB knows them for sure.
  const triedMatching = useRef(new Set<number>());
  useEffect(() => {
    const target = lists?.find(
      (candidate) =>
        candidate.kind === 'movies' &&
        !triedMatching.current.has(candidate.id) &&
        candidate.items.some((item) => !item.poster_path && !item.tmdb_id),
    );
    if (!target) return;
    triedMatching.current.add(target.id);
    matchMissing(target.id);
  }, [lists]); // eslint-disable-line react-hooks/exhaustive-deps -- run only reads refs and stable setters

  return {
    lists,
    theme,
    isPointaucConnected,
    pointaucListId,
    pendingLots,
    loadError,
    reload,
    isSaving,
    saveError,
    clearSaveError: () => setSaveError(null),

    /** Instant local repaint while the streamer is picking; saveTheme stores it for viewers. */
    previewTheme: (nextTheme: ChannelTheme) => {
      unsavedTheme.current = nextTheme;
      setTheme(nextTheme);
      applyTheme(nextTheme);
    },

    // Saved, or failed (the reload that follows puts the stored theme back) — unless another color came meanwhile.
    saveTheme: (nextTheme: ChannelTheme) =>
      run(async () => {
        try {
          return await callWorker('PUT', '/api/theme', nextTheme);
        } finally {
          if (unsavedTheme.current === nextTheme) unsavedTheme.current = null;
        }
      }),

    createList: (title: string, kind: ListKind) => run(() => callWorker<ListRow>('POST', '/api/lists', { title, kind })),

    updateList: (listId: number, fields: Pick<ListRow, 'title' | 'kind'>) =>
      run(
        () => callWorker('PATCH', `/api/lists/${listId}`, fields),
        (current) => current.map((list) => (list.id === listId ? { ...list, ...fields } : list)),
      ),

    deleteList: (listId: number) =>
      run(
        () => callWorker('DELETE', `/api/lists/${listId}`),
        (current) => current.filter((list) => list.id !== listId),
      ),

    addItem: (listId: number, title: string, status: ItemStatus, movie: MovieFields = {}) =>
      run(() => callWorker<ItemRow>('POST', '/api/items', { list_id: listId, title, status, ...movie })),

    addBulk: async (listId: number, titles: string[], status: ItemStatus, source: ItemRow['source'] = 'manual') =>
      matchUnchecked(
        listId,
        await run(() => callWorker<AddResult>('POST', '/api/items/bulk', { list_id: listId, titles, status, source })),
      ),

    /** Imports Pointauc lots by id: the Worker reads them from Pointauc, finds posters and keeps the bids. */
    importLots: async (listId: number, lotIds: string[], status: ItemStatus) =>
      matchUnchecked(
        listId,
        await run(() => callWorker<AddResult>('POST', '/api/pointauc/import', { list_id: listId, lot_ids: lotIds, status })),
      ),

    /** Throws with the Worker's message (bad token, Pointauc tab closed) so the dialog can show it. */
    connectPointauc: async (token: string) => {
      await callWorker('PUT', '/api/pointauc/token', { token });
      setIsPointaucConnected(true);
    },

    /** Automatic sync of one list (null — off). Resolves false when the first pass could not reach Pointauc. */
    setPointaucSync: async (listId: number | null) => {
      const result = await run(() => callWorker<{ synced: boolean }>('PUT', '/api/pointauc/sync', { list_id: listId }));
      return result?.synced ?? false;
    },

    /** Puts a pending lot into the queue; `fields` may carry a corrected title and the picked TMDB movie. */
    acceptPending: (lotId: number, fields: EditableItemFields = {}) =>
      run(() => callWorker('POST', `/api/pending/${lotId}/accept`, fields)),

    dismissPending: (lotId: number) => run(() => callWorker('DELETE', `/api/pending/${lotId}`)),

    disconnectPointauc: () => run(() => callWorker('DELETE', '/api/pointauc/token')),

    setStatus: (itemId: number, status: ItemStatus) =>
      run(
        () => callWorker('PATCH', `/api/items/${itemId}`, { status }),
        // Watched goes on top (newest first), a requeued item after the titles with the same or a bigger bid — as the
        // Worker orders them.
        (current) =>
          updateItem(current, itemId, (items, item) => {
            const moved = { ...item, status, watched_at: status === 'watched' ? Date.now() : null, rating: null };
            const rest = items.filter((candidate) => candidate.id !== itemId);
            if (status === 'watched') return [moved, ...rest];
            const queue = rest.filter((candidate) => candidate.status === 'queue');
            const at = requeueIndex(queue, item.points);
            return [...queue.slice(0, at), moved, ...queue.slice(at), ...rest.filter((candidate) => candidate.status !== 'queue')];
          }),
      ),

    /**
     * Title, rating or the TMDB details of an item. A new title without TMDB fields makes the Worker look the
     * title up again, so the reload after the request brings the poster.
     */
    editItem: (itemId: number, fields: EditableItemFields) =>
      run(
        () => callWorker('PATCH', `/api/items/${itemId}`, fields),
        (current) =>
          updateItem(current, itemId, (items) =>
            items.map((candidate) => (candidate.id === itemId ? { ...candidate, ...fields } : candidate)),
          ),
      ),

    deleteItem: (itemId: number) =>
      run(
        () => callWorker('DELETE', `/api/items/${itemId}`),
        (current) => updateItem(current, itemId, (items) => items.filter((item) => item.id !== itemId)),
      ),

    /** New order of the queue — or of the part of it a search shows — after drag & drop. */
    reorderQueue: (listId: number, ids: number[]) =>
      run(
        () => callWorker('PUT', `/api/lists/${listId}/order`, { ids }),
        (current) =>
          current.map((list) => {
            if (list.id !== listId) return list;
            const queue = reorderInPlace(list.items.filter((item) => item.status === 'queue'), ids);
            return { ...list, items: [...queue, ...list.items.filter((item) => item.status !== 'queue')] };
          }),
      ),
  };
};

export type Channel = ReturnType<typeof useChannel>;

/**
 * What the streamer does with a row — the same in the panel and the settings window. Marking a title watched asks
 * for a rating once the change is saved.
 */
export const streamerActions = (channel: Channel, askRating: (itemId: number) => void, edit: (itemId: number) => void) => ({
  onWatched: async (itemId: number) => {
    if (await channel.setStatus(itemId, 'watched')) askRating(itemId);
  },
  onRequeue: (itemId: number) => channel.setStatus(itemId, 'queue'),
  onDelete: channel.deleteItem,
  onEdit: (item: ItemRow) => edit(item.id),
  onRate: (itemId: number, rating: number | null) => channel.editItem(itemId, { rating }),
});
