// Pointauc lots matched against a list. Shared with the extension, so no Workers-only APIs here.

import type { ItemRow } from './snapshot';

export interface PointaucLot {
  id: string;
  name: string;
  amount: number;
}

export type LotStatus = 'new' | 'queue' | 'watched';

export interface ImportLot extends PointaucLot {
  status: LotStatus;
  /** Place in the queue (1-based) for 'queue', the date for 'watched'. */
  position?: number;
  watched_at?: number;
}

export const normalizeTitle = (title: string) => title.trim().toLowerCase();

/** GET /api/oshino/lots answers [{ fastId, id, name, amount, investors }]; anything malformed is skipped. */
export const toPointaucLots = (data: unknown): PointaucLot[] =>
  (Array.isArray(data) ? data : [])
    .map((raw) => ({
      id: String(raw?.id ?? raw?.fastId ?? ''),
      name: typeof raw?.name === 'string' ? raw.name.trim().slice(0, 200) : '',
      amount: Number(raw?.amount) || 0,
    }))
    .filter((lot) => lot.id && lot.name);

/** Each lot with what the list already knows about it (same title, case-insensitive). Biggest bids first. */
export const matchLots = (lots: PointaucLot[], items: Pick<ItemRow, 'title' | 'status' | 'watched_at'>[]): ImportLot[] => {
  const queue = items.filter((item) => item.status === 'queue');
  const byTitle = new Map(items.map((item) => [normalizeTitle(item.title), item]));

  return lots
    .map((lot): ImportLot => {
      const item = byTitle.get(normalizeTitle(lot.name));
      if (!item) return { ...lot, status: 'new' };
      if (item.status === 'watched') return { ...lot, status: 'watched', watched_at: item.watched_at ?? undefined };
      return { ...lot, status: 'queue', position: queue.indexOf(item) + 1 };
    })
    .sort((a, b) => b.amount - a.amount);
};
