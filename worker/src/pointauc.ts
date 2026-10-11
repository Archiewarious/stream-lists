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

/** GET /api/oshino/lots answers { lots: [{ fastId, id, name, amount, investors }] }; anything malformed is skipped. */
export const toPointaucLots = (data: unknown): PointaucLot[] =>
  (Array.isArray((data as { lots?: unknown })?.lots) ? (data as { lots: any[] }).lots : [])
    .map((raw) => ({
      id: String(raw?.id ?? raw?.fastId ?? ''),
      name: typeof raw?.name === 'string' ? raw.name.replace(/\p{Cc}/gu, '').trim().slice(0, 200) : '',
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

export interface LotSyncPlan {
  /** Lots to put into the list. */
  toAdd: PointaucLot[];
  /** Items already in the list whose bid (or lot) changed. */
  toUpdate: { id: number; points: number; lot_id: string }[];
}

/**
 * What a sync does with the current lots: matched items only get fresh bids; lots that the list does not have
 * yet are added if their id is in `addIds` (null — add none). The same title twice in one auction is one item.
 */
export const planLotSync = (
  lots: PointaucLot[],
  items: Pick<ItemRow, 'id' | 'title' | 'points' | 'lot_id'>[],
  addIds: Set<string> | null,
): LotSyncPlan => {
  const byTitle = new Map(items.map((item) => [normalizeTitle(item.title), item]));
  const addedTitles = new Set<string>();
  const plan: LotSyncPlan = { toAdd: [], toUpdate: [] };

  for (const lot of lots) {
    const key = normalizeTitle(lot.name);
    const item = byTitle.get(key);
    if (item) {
      if (item.points !== lot.amount || item.lot_id !== lot.id) plan.toUpdate.push({ id: item.id, points: lot.amount, lot_id: lot.id });
    } else if (addIds?.has(lot.id) && !addedTitles.has(key)) {
      plan.toAdd.push(lot);
      addedTitles.add(key);
    }
  }
  return plan;
};
