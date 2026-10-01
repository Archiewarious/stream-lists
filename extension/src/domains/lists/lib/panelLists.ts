import type { ChannelList, ItemRow, ListRow } from '@worker/snapshot';

export type PanelItem = Pick<ItemRow, 'id' | 'title' | 'year' | 'poster_path' | 'watched_at'>;

/** What the viewer panel shows: the snapshot may hold only part of the items, the counts are always full. */
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

const fromSnapshotItem = (item: SnapshotItem): PanelItem => ({
  id: item.i,
  title: item.t,
  year: item.y ?? null,
  poster_path: item.p ?? null,
  watched_at: item.d ?? null,
});

/** Lists from the Twitch config snapshot (v2); null for anything else — empty, the old phase-1 format, garbage. */
export const parseSnapshot = (content: string | undefined): PanelList[] | null => {
  try {
    const data = JSON.parse(content ?? '');
    if (data?.v !== 2 || !Array.isArray(data.lists)) return null;
    return data.lists.map((list: SnapshotList) => ({
      id: list.i,
      title: list.t,
      kind: list.k,
      queueCount: list.qn,
      watchedCount: list.wn,
      queue: list.q.map(fromSnapshotItem),
      watched: list.w.map(fromSnapshotItem),
    }));
  } catch {
    return null;
  }
};

const toPanelItem = ({ id, title, year, poster_path, watched_at }: ItemRow): PanelItem => ({
  id,
  title,
  year,
  poster_path,
  watched_at,
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

export const checkIsTrimmed = (list: PanelList) =>
  list.queue.length < list.queueCount || list.watched.length < list.watchedCount;
