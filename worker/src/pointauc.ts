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

/** How titles are compared: case, ё/е, extra spaces and Unicode composition do not matter. */
export const normalizeTitle = (title: string) => title.normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/**
 * GET /api/oshino/lots answers { lots: [{ fastId, id, name, amount, investors }] }; anything malformed is skipped.
 * A lot id holds only while the streamer's Pointauc tab stays open (a reload makes new ones; fastId is just a number
 * in the auction), so the title is what ties a lot to an item and the id only follows an item that was renamed.
 */
export const toPointaucLots = (data: unknown): PointaucLot[] =>
  (Array.isArray((data as { lots?: unknown })?.lots) ? (data as { lots: any[] }).lots : [])
    .map((raw) => ({
      id: String(raw?.id ?? ''),
      name: typeof raw?.name === 'string' ? raw.name.replace(/\p{Cc}/gu, '').trim().slice(0, 200) : '',
      amount: Number(raw?.amount) || 0,
    }))
    .filter((lot) => lot.id && lot.name);

/** Each lot with what the list already knows about it (same title, case-insensitive). Biggest bids first. */
export const matchLots = (lots: PointaucLot[], items: Pick<ItemRow, 'title' | 'status' | 'watched_at'>[]): ImportLot[] => {
  const queue = items.filter((item) => item.status === 'queue');
  // The same title twice (watched once, queued again): the queued one is what the lot is about.
  const byTitle = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!byTitle.has(key) || item.status === 'queue') byTitle.set(key, item);
  }

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
 * yet are added if their id is in `addIds` (null — add none). An item matches the lot it came from (`lot_id`, so a
 * renamed item keeps its bids), otherwise a lot with its title. The same title twice in one auction is one item,
 * and the biggest bid is the one that counts.
 */
export const planLotSync = (
  lots: PointaucLot[],
  items: Pick<ItemRow, 'id' | 'title' | 'points' | 'lot_id'>[],
  addIds: Set<string> | null,
): LotSyncPlan => {
  const byLot = new Map(items.filter((item) => item.lot_id).map((item) => [item.lot_id, item]));
  const byTitle = new Map(items.map((item) => [normalizeTitle(item.title), item]));
  const bestLot = new Map<(typeof items)[number], PointaucLot>();
  const newLots = new Map<string, PointaucLot>();

  for (const lot of lots) {
    const key = normalizeTitle(lot.name);
    const item = byLot.get(lot.id) ?? byTitle.get(key);
    if (item) {
      const best = bestLot.get(item);
      // On a tie the lot the item already follows stays, so two equal lots do not take turns.
      if (!best || lot.amount > best.amount || (lot.amount === best.amount && lot.id === item.lot_id)) bestLot.set(item, lot);
    } else if (addIds?.has(lot.id) && lot.amount > (newLots.get(key)?.amount ?? -Infinity)) {
      newLots.set(key, lot);
    }
  }

  const toUpdate = [...bestLot]
    .filter(([item, lot]) => item.points !== lot.amount || item.lot_id !== lot.id)
    .map(([item, lot]) => ({ id: item.id, points: lot.amount, lot_id: lot.id }));
  return { toAdd: [...newLots.values()], toUpdate };
};
