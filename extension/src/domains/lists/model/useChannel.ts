import { useCallback, useEffect, useRef, useState } from 'react';

import { buildSnapshot, type ChannelList, type ItemRow, type ListRow } from '@worker/snapshot';
import type { ChannelTheme } from '@worker/theme';
import { applyTheme } from '@app/presets';
import { callWorker } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

export type ListKind = ListRow['kind'];
export type ItemStatus = ItemRow['status'];
export type MovieFields = Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path'>>;

type ListsUpdate = (lists: ChannelList[]) => ChannelList[];

const updateItem = (lists: ChannelList[], itemId: number, update: (items: ItemRow[], item: ItemRow) => ItemRow[]) =>
  lists.map((list) => {
    const item = list.items.find((candidate) => candidate.id === itemId);
    return item ? { ...list, items: update(list.items, item) } : list;
  });

/**
 * The streamer's lists from the Worker. Edits show up at once (optimistic) and the channel is reloaded
 * once every pending request has finished, so the server stays the source of truth.
 */
export const useChannel = () => {
  const [lists, setLists] = useState<ChannelList[] | null>(null);
  const [theme, setTheme] = useState<ChannelTheme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(0);

  const reload = useCallback(async () => {
    try {
      const channel = await callWorker<{ lists: ChannelList[]; theme: ChannelTheme | null }>('GET', '/api/channel');
      setLists(channel.lists);
      setTheme(channel.theme);
      applyTheme(channel.theme); // the streamer sees their window in the same colors as viewers
      setLoadError(null);
      if (import.meta.env.DEV) twitchApi.mirrorSnapshot?.(buildSnapshot(channel.lists, channel.theme));
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

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
        await reload(); // also rolls back an optimistic edit that failed
        setIsSaving(false);
      }
    }
  };

  return {
    lists,
    theme,
    loadError,
    reload,
    isSaving,
    saveError,
    clearSaveError: () => setSaveError(null),

    /** Instant local repaint while the streamer is picking; saveTheme stores it for viewers. */
    previewTheme: (nextTheme: ChannelTheme) => {
      setTheme(nextTheme);
      applyTheme(nextTheme);
    },

    saveTheme: (nextTheme: ChannelTheme) => run(() => callWorker('PUT', '/api/theme', nextTheme)),

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

    addBulk: (listId: number, titles: string[], status: ItemStatus) =>
      run(() =>
        callWorker<{ added: ItemRow[]; skipped: number }>('POST', '/api/items/bulk', { list_id: listId, titles, status }),
      ),

    setStatus: (itemId: number, status: ItemStatus) =>
      run(
        () => callWorker('PATCH', `/api/items/${itemId}`, { status }),
        // Watched goes on top (newest first), a requeued item to the end of the line — as the Worker orders them.
        (current) =>
          updateItem(current, itemId, (items, item) => {
            const moved = { ...item, status, watched_at: status === 'watched' ? Date.now() : null };
            const rest = items.filter((candidate) => candidate.id !== itemId);
            return status === 'watched' ? [moved, ...rest] : [...rest, moved];
          }),
      ),

    deleteItem: (itemId: number) =>
      run(
        () => callWorker('DELETE', `/api/items/${itemId}`),
        (current) => updateItem(current, itemId, (items) => items.filter((item) => item.id !== itemId)),
      ),

    /** New queue order after drag & drop. */
    reorderQueue: (listId: number, ids: number[]) =>
      run(
        () => callWorker('PUT', `/api/lists/${listId}/order`, { ids }),
        (current) =>
          current.map((list) => {
            if (list.id !== listId) return list;
            const byId = new Map(list.items.map((item) => [item.id, item]));
            const queue = ids.map((id) => byId.get(id)!).filter(Boolean);
            return { ...list, items: [...queue, ...list.items.filter((item) => item.status !== 'queue')] };
          }),
      ),
  };
};

export type Channel = ReturnType<typeof useChannel>;
