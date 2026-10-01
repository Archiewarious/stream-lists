import type { ItemRow } from '@worker/snapshot';

export const MAX_BULK_ITEMS = 200;

/** "Списком": one title per line, blank lines dropped, numbering like "1. " or "- " stripped. */
export const parseBulkTitles = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*(\d+[.)]|[-*•])\s+/, '').trim())
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

export const formatDay = (timestamp: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(timestamp);

export const matchesTitle = (title: string, query: string) => title.toLowerCase().includes(query.trim().toLowerCase());
