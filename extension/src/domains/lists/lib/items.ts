import { clipTitle, normalizeTitle } from '@worker/pointauc';
import type { ItemRow } from '@worker/snapshot';

export const MAX_BULK_ITEMS = 200;
const MAX_TITLE_LENGTH = 200; // the Worker rejects the whole batch over a longer one

/**
 * "Списком": one title per line, blank lines dropped, numbering like "1. " or "- " stripped. Control characters go
 * first, as the Worker drops them too (a line of only those would fail the whole batch).
 */
export const parseBulkTitles = (text: string) =>
  text
    .split('\n')
    .map((line) => clipTitle(line.replace(/\p{Cc}/gu, '').replace(/^\s*(\d+[.)]|[-*•])\s+/, '').trim(), MAX_TITLE_LENGTH))
    .filter(Boolean);

export interface MonthGroup<T> {
  key: string;
  title: string;
  items: T[];
}

/** Watched items (newest first) grouped by calendar month: "сентябрь 2026", "август 2026"… */
export const groupByMonth = <T extends Pick<ItemRow, 'watched_at'>>(items: T[], locale: string): MonthGroup<T>[] => {
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' });
  const groups: MonthGroup<T>[] = [];

  for (const item of items) {
    const date = new Date(item.watched_at ?? 0);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    let group = groups.at(-1);
    if (group?.key !== key) {
      group = { key, title: `${monthName.format(date)} ${date.getFullYear()}`, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
};

const dayFormats = new Map<string, Intl.DateTimeFormat>();

export const formatDay = (timestamp: number, locale: string) => {
  let format = dayFormats.get(locale);
  if (!format) dayFormats.set(locale, (format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })));
  return format.format(timestamp);
};

/** The streamer's search in a list: case, ё/е and extra spaces do not matter (the same as the viewers' search). */
export const matchesTitle = (title: string, query: string) => normalizeTitle(title).includes(normalizeTitle(query));

type QueueItem = Pick<ItemRow, 'id' | 'points'>;

/**
 * The queue after dragging `activeId` onto `overId` among the shown items; null when the drop is not a move. Titles
 * with a bid stand by their bid, so nothing is dropped onto one of them.
 */
export const dragQueueOrder = (shown: QueueItem[], activeId: number, overId: number): number[] | null => {
  const from = shown.findIndex((item) => item.id === activeId);
  const to = shown.findIndex((item) => item.id === overId);
  if (from < 0 || to < 0 || from === to || shown[to].points !== null) return null;
  const ids = shown.map((item) => item.id);
  ids.splice(to, 0, ...ids.splice(from, 1));
  return ids;
};

/**
 * The whole queue after reordering some of it (`ids`, dragged while a search hid the rest): those items share out
 * the places they held, the others stay put — as the Worker does it.
 */
export const reorderInPlace = <T extends Pick<ItemRow, 'id'>>(queue: T[], ids: number[]): T[] => {
  const byId = new Map(queue.map((item) => [item.id, item]));
  const moved = ids.filter((id) => byId.has(id));
  const isMoved = new Set(moved);
  let next = 0;
  return queue.map((item) => (isMoved.has(item.id) ? byId.get(moved[next++])! : item));
};

/** Where an item put back into the queue lands: after every title with the same or a bigger bid, as the Worker orders it. */
export const requeueIndex = (queue: Pick<ItemRow, 'points'>[], points: number | null) => {
  const index = queue.findIndex((item) => (item.points ?? -1) < (points ?? -1));
  return index < 0 ? queue.length : index;
};
