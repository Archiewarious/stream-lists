// The public snapshot viewers read from the Twitch config segment (and receive via PubSub). Both cap at 5 KB.

export interface ListRow {
  id: number;
  channel_id: string;
  title: string;
  kind: 'movies' | 'games' | 'custom';
  created_at: number;
}

export interface ItemRow {
  id: number;
  list_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  tmdb_id: number | null;
  status: 'queue' | 'watched';
  position: number;
  added_at: number;
  watched_at: number | null;
  source: 'manual' | 'pointauc';
}

/** Items are expected in display order: queue by position, watched newest first. */
export type ChannelList = ListRow & { items: ItemRow[] };

export const SNAPSHOT_VERSION = '2';
export const SNAPSHOT_LIMIT_BYTES = 5000;
// Queue / watched items kept per list; the first step that fits wins. The full history comes from the Worker.
const SNAPSHOT_STEPS = [
  [25, 15],
  [20, 12],
  [15, 8],
  [10, 5],
  [5, 3],
  [2, 1],
  [0, 0],
] as const;

// Short keys: the snapshot is size-capped. Null fields are dropped by JSON.stringify.
const compactItem = (item: ItemRow) => ({
  i: item.id,
  t: item.title,
  y: item.year ?? undefined,
  p: item.poster_path ?? undefined,
  d: item.watched_at ?? undefined,
});

export const getByteSize = (content: string) => new TextEncoder().encode(content).length;

export const buildSnapshot = (lists: ChannelList[]): string => {
  const sections = lists.map((list) => ({
    list,
    queue: list.items.filter((item) => item.status === 'queue'),
    watched: list.items.filter((item) => item.status === 'watched'),
  }));

  for (const [queueLimit, watchedLimit] of SNAPSHOT_STEPS) {
    const content = JSON.stringify({
      v: Number(SNAPSHOT_VERSION),
      lists: sections.map(({ list, queue, watched }) => ({
        i: list.id,
        t: list.title,
        k: list.kind,
        qn: queue.length,
        wn: watched.length,
        q: queue.slice(0, queueLimit).map(compactItem),
        w: watched.slice(0, watchedLimit).map(compactItem),
      })),
    });
    if (getByteSize(content) <= SNAPSHOT_LIMIT_BYTES) return content;
  }
  // Unreachable while lists are capped (MAX_LISTS × list title length).
  throw new Error('Snapshot exceeds 5 KB even without items');
};
