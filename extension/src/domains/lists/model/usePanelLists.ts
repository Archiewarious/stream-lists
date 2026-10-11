import { useDebouncedValue } from '@mantine/hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { VIEWER_PAGE, type SearchResult } from '@worker/snapshot';
import { applyTheme } from '@app/presets';
import { addPage, parseSnapshot, withPages, type LoadedPages, type PanelItem, type PanelList, type PanelSnapshot, type PanelStatus } from '@domains/lists/lib/panelLists';
import { callWorker } from '@shared/api/workerApi';
import { twitchApi } from '@shared/twitch/twitchApi';

// How long to wait for Twitch's configuration before showing the empty state.
const CONFIG_WAIT_MS = 1500;
const SEARCH_DELAY_MS = 300;

/** Loading the next page: in progress, failed (retry by hand), or there is no more. */
export type PageState = 'loading' | 'failed' | 'end';
export type SearchAnswer = { results: SearchResult[]; total: number };
export type Search = (listId: number, query: string) => Promise<SearchAnswer>;

const pageKey = (listId: number, status: PanelStatus) => `${listId}:${status}`;

/**
 * Viewer lists. The snapshot from the Twitch config shows up at once and follows PubSub updates; the rest of the
 * queue and the history come from the Worker a page at a time, as the viewer scrolls to them. A new snapshot only
 * replaces the first items — nothing is fetched again because of it.
 */
export const usePanelLists = () => {
  const [snapshot, setSnapshot] = useState<PanelList[] | null>(null);
  const [pages, setPages] = useState<LoadedPages>({});
  const [pageStates, setPageStates] = useState<Record<string, PageState | undefined>>({});
  const inFlight = useRef(new Set<string>());

  // A layout effect: the streamer's theme is painted before the first frame.
  useLayoutEffect(() => {
    let lastContent: string | undefined;
    const apply = (next: PanelSnapshot) => {
      setSnapshot(next.lists);
      applyTheme(next.theme); // viewers see the streamer's theme
      // The counts may have grown: "no more" is asked again.
      setPageStates((current) => Object.fromEntries(Object.entries(current).filter(([, state]) => state !== 'end')));
    };
    /** Returns whether there was a configuration to read. */
    const read = (content: string | undefined) => {
      if (content === undefined) return false;
      if (content === lastContent) return true; // the same announcement twice (config and PubSub)
      lastContent = content;
      const next = parseSnapshot(content);
      if (next) apply(next);
      else {
        // Twitch has something the panel cannot read: the Worker serves the same snapshot.
        callWorker<unknown>('GET', '/api/viewer/snapshot')
          .then((data) => {
            const fromWorker = parseSnapshot(JSON.stringify(data));
            if (fromWorker) apply(fromWorker);
            else setSnapshot((current) => current ?? []);
          })
          .catch(() => setSnapshot((current) => current ?? []));
      }
      return true;
    };

    // Twitch announces the configuration once and does not repeat it for a late subscriber (the panel re-created
    // by "as viewer", or a page that mounted after the announcement): read what is there right away too.
    const stopConfig = twitchApi.onConfigChanged(() => read(twitchApi.getBroadcasterConfig()));
    const giveUpTimer = read(twitchApi.getBroadcasterConfig())
      ? undefined
      : window.setTimeout(() => setSnapshot((current) => current ?? []), CONFIG_WAIT_MS);
    const stopListening = twitchApi.listenBroadcast(read);
    return () => {
      window.clearTimeout(giveUpTimer);
      stopConfig();
      stopListening();
    };
  }, []);

  const lists = useMemo(() => snapshot && withPages(snapshot, pages), [snapshot, pages]);

  const loadMore = useCallback((list: PanelList, status: PanelStatus) => {
    const key = pageKey(list.id, status);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPageStates((current) => ({ ...current, [key]: 'loading' }));
    const params = new URLSearchParams({ list_id: String(list.id), status, offset: String(list[status].length) });
    callWorker<{ items: PanelItem[] }>('GET', `/api/viewer/items?${params}`)
      .then(({ items }) => {
        setPages((current) => addPage(current, list.id, status, items));
        // A short page is the end; so is a page of items already shown (the list moved under the offset).
        const shown = new Set(list[status].map((item) => item.id));
        const isEnd = items.length < VIEWER_PAGE || items.every((item) => shown.has(item.id));
        setPageStates((current) => ({ ...current, [key]: isEnd ? 'end' : undefined }));
      })
      .catch(() => setPageStates((current) => ({ ...current, [key]: 'failed' })))
      .finally(() => inFlight.current.delete(key));
  }, []);

  const pageState = (listId: number, status: PanelStatus) => pageStates[pageKey(listId, status)];

  return { lists, loadMore, pageState };
};

export const searchOnServer: Search = (listId, query) =>
  callWorker<SearchAnswer>('GET', `/api/viewer/search?${new URLSearchParams({ list_id: String(listId), q: query })}`);

/**
 * A viewer's search, asked once typing pauses. While the next answer is on its way the previous one for the same list
 * stays on screen.
 */
export const usePanelSearch = (search: Search, listId: number, query: string) => {
  const [debouncedQuery] = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const [answer, setAnswer] = useState<{ listId: number; query: string; data?: SearchAnswer } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!debouncedQuery) return;
    let isCancelled = false;
    search(listId, debouncedQuery)
      .then((data) => !isCancelled && setAnswer({ listId, query: debouncedQuery, data }))
      .catch(() => !isCancelled && setAnswer({ listId, query: debouncedQuery }));
    return () => {
      isCancelled = true;
    };
  }, [search, listId, debouncedQuery, attempt]);

  const isCurrent = answer?.listId === listId && answer.query === query.trim();
  return {
    answer: answer?.listId === listId ? (answer.data ?? null) : null,
    isLoading: !isCurrent,
    isFailed: isCurrent && !answer.data,
    retry: () => setAttempt((count) => count + 1),
  };
};
