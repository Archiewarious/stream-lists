import type { ChannelList, ItemRow, ListRow, ViewerItem } from '@worker/snapshot';
import { parseTheme, type ChannelTheme } from '@worker/theme';

export type PanelItem = ViewerItem;
export type PanelStatus = ItemRow['status'];

/** What the viewer panel shows: the snapshot holds only the first items, the counts are always full. */
export interface PanelList {
  id: number;
  title: string;
  kind: ListRow['kind'];
  queueCount: number;
  watchedCount: number;
  queue: PanelItem[];
  /** Newest first. */
  watched: PanelItem[];
}

// The compact snapshot format written by worker/src/snapshot.ts.
interface SnapshotItem {
  i: number;
  t: string;
  y?: number;
  p?: string;
  d?: number;
  b?: number;
  r?: number;
  m?: number;
  k?: 1;
}

interface SnapshotList {
  i: number;
  t: string;
  k: ListRow['kind'];
  qn: number;
  wn: number;
  q: SnapshotItem[];
  w: SnapshotItem[];
}

const LIST_KINDS = ['movies', 'games', 'custom'];
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One item of the snapshot; null for one that is not what the Worker writes. */
const fromSnapshotItem = (item: SnapshotItem): PanelItem | null => {
  if (!isCount(item?.i) || typeof item.t !== 'string') return null;
  const tmdbId = numberOrNull(item.m);
  return {
    id: item.i,
    title: item.t,
    year: numberOrNull(item.y),
    poster_path: typeof item.p === 'string' ? item.p : null,
    watched_at: numberOrNull(item.d),
    points: numberOrNull(item.b),
    rating: numberOrNull(item.r),
    tmdb_id: tmdbId,
    tmdb_type: tmdbId ? (item.k ? 'tv' : 'movie') : null,
  };
};

const fromSnapshotItems = (items: unknown) =>
  (Array.isArray(items) ? items : []).map(fromSnapshotItem).filter((item): item is PanelItem => !!item);

export interface PanelSnapshot {
  lists: PanelList[];
  theme: ChannelTheme | null;
}

/**
 * The Twitch config snapshot; null for anything else — empty, the old phase-1 format, garbage. A later version is
 * read too: the Worker only ever adds fields to v2, so a panel already uploaded keeps working.
 */
export const parseSnapshot = (content: string | undefined): PanelSnapshot | null => {
  try {
    const data = JSON.parse(content ?? '');
    if (typeof data?.v !== 'number' || data.v < 2 || !Array.isArray(data.lists)) return null;
    const lists = (data.lists as SnapshotList[])
      .filter((list) => isCount(list?.i) && typeof list.t === 'string' && LIST_KINDS.includes(list.k))
      .map((list) => {
        const queue = fromSnapshotItems(list.q);
        const watched = fromSnapshotItems(list.w);
        return {
          id: list.i,
          title: list.t,
          kind: list.k,
          queueCount: isCount(list.qn) ? Math.max(list.qn, queue.length) : queue.length,
          watchedCount: isCount(list.wn) ? Math.max(list.wn, watched.length) : watched.length,
          queue,
          watched,
        };
      });
    return { lists, theme: parseTheme(data.th) };
  } catch {
    return null;
  }
};

const toPanelItem = ({ id, title, year, poster_path, watched_at, points, rating, tmdb_id, tmdb_type }: ItemRow): PanelItem => ({
  id,
  title,
  year,
  poster_path,
  watched_at,
  points,
  rating,
  tmdb_id,
  tmdb_type,
});

/** Full lists from the Worker (items already in display order). */
export const fromChannelLists = (lists: ChannelList[]): PanelList[] =>
  lists.map((list) => {
    const queue = list.items.filter((item) => item.status === 'queue').map(toPanelItem);
    const watched = list.items.filter((item) => item.status === 'watched').map(toPanelItem);
    return {
      id: list.id,
      title: list.title,
      kind: list.kind,
      queueCount: queue.length,
      watchedCount: watched.length,
      queue,
      watched,
    };
  });

/** Items a viewer loaded beyond the snapshot, page by page: list id → status → items. */
export type LoadedPages = Record<number, Partial<Record<PanelStatus, PanelItem[]>>>;

/**
 * The snapshot with the pages loaded beyond it. A new snapshot replaces only the first items: what was loaded
 * further stays (no reload for every viewer at every snapshot), minus what the new snapshot shows elsewhere.
 */
// ponytail: items further down that changed after they were loaded stay as they were until the panel is reopened.
export const withPages = (lists: PanelList[], pages: LoadedPages): PanelList[] =>
  lists.map((list) => {
    const own = pages[list.id];
    if (!own) return list;
    const shown = new Set([...list.queue, ...list.watched].map((item) => item.id));
    const extend = (head: PanelItem[], more: PanelItem[] = []) => [...head, ...more.filter((item) => !shown.has(item.id))];
    return { ...list, queue: extend(list.queue, own.queue), watched: extend(list.watched, own.watched) };
  });

/** Adds a page to what was loaded, without the items already there. */
export const addPage = (pages: LoadedPages, listId: number, status: PanelStatus, page: PanelItem[]): LoadedPages => {
  const loaded = pages[listId]?.[status] ?? [];
  const known = new Set(loaded.map((item) => item.id));
  return { ...pages, [listId]: { ...pages[listId], [status]: [...loaded, ...page.filter((item) => !known.has(item.id))] } };
};

/**
 * Where a new snapshot shows other items first while pages beyond them are loaded. An item pushed past the first
 * ones is then in neither, so the page right after them has to be loaded again.
 */
export const pagesToReload = (previous: PanelList[], next: PanelList[], pages: LoadedPages) =>
  next.flatMap((list) => {
    const before = previous.find((old) => old.id === list.id);
    return (['queue', 'watched'] as const)
      .filter((status) => {
        if (!before || !pages[list.id]?.[status]?.length) return false;
        const ids = new Set(before[status].map((item) => item.id));
        return list[status].length !== ids.size || list[status].some((item) => !ids.has(item.id));
      })
      .map((status) => ({ list, status }));
  });

/** The page right after the snapshot, loaded again, in front of what was loaded (without the items it has). */
export const putFirstPage = (pages: LoadedPages, listId: number, status: PanelStatus, page: PanelItem[]): LoadedPages => {
  const known = new Set(page.map((item) => item.id));
  const loaded = pages[listId]?.[status] ?? [];
  return { ...pages, [listId]: { ...pages[listId], [status]: [...page, ...loaded.filter((item) => !known.has(item.id))] } };
};
