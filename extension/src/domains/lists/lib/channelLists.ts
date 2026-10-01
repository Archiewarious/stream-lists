import type {
  ChannelLists,
  ItemStatus,
  ListItem,
  ListKind,
  StreamList,
} from '@domains/lists/model/types';

// ponytail: the whole channel lives in one Twitch config segment (5 KB ≈ 100 items); phase 2 moves it to D1.
export const CONFIG_LIMIT_BYTES = 5000;
export const MAX_LIST_TITLE_LENGTH = 40;
export const MAX_ITEM_TITLE_LENGTH = 100;

export const LIST_KINDS: ListKind[] = ['games', 'movies', 'custom'];
export const ITEM_STATUSES: ItemStatus[] = ['now', 'queue', 'done'];
export const EMPTY_CHANNEL_LISTS: ChannelLists = { lists: [] };

export const createId = () => crypto.randomUUID().slice(0, 8);

const checkIsListKind = (value: unknown): value is ListKind => LIST_KINDS.includes(value as ListKind);
const checkIsItemStatus = (value: unknown): value is ItemStatus => ITEM_STATUSES.includes(value as ItemStatus);

const checkIsListItem = (value: any): value is ListItem =>
  typeof value?.id === 'string' && typeof value?.title === 'string' && checkIsItemStatus(value?.status);

const checkIsStreamList = (value: any): value is StreamList =>
  typeof value?.id === 'string' &&
  typeof value?.title === 'string' &&
  checkIsListKind(value?.kind) &&
  Array.isArray(value?.items);

/**
 * Reads the stored config, dropping malformed entries. Returns null when the content is not JSON at all:
 * the editor must stop then, otherwise its next save would overwrite whatever the channel had.
 */
export const parseChannelLists = (content: string | undefined): ChannelLists | null => {
  if (!content) return EMPTY_CHANNEL_LISTS;

  let raw: any;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }

  const lists: unknown[] = Array.isArray(raw?.lists) ? raw.lists : [];
  return {
    lists: lists.filter(checkIsStreamList).map(({ id, title, kind, items }) => ({
      id,
      title,
      kind,
      items: items.filter(checkIsListItem).map(({ id, title, status }) => ({ id, title, status })),
    })),
  };
};

export const serializeChannelLists = (data: ChannelLists) => JSON.stringify(data);

/** Twitch counts the limit in bytes, and Cyrillic takes 2 bytes per letter. */
export const getByteSize = (content: string) => new TextEncoder().encode(content).length;

export const checkFitsConfigLimit = (content: string) => getByteSize(content) <= CONFIG_LIMIT_BYTES;

export const getItemsByStatus = (list: StreamList, status: ItemStatus) =>
  list.items.filter((item) => item.status === status);

const updateList = (data: ChannelLists, listId: string, update: (list: StreamList) => StreamList) => ({
  lists: data.lists.map((list) => (list.id === listId ? update(list) : list)),
});

export const addList = (data: ChannelLists, listId: string, title: string, kind: ListKind): ChannelLists => ({
  lists: [...data.lists, { id: listId, title, kind, items: [] }],
});

export const renameList = (data: ChannelLists, listId: string, title: string) =>
  updateList(data, listId, (list) => ({ ...list, title }));

export const changeListKind = (data: ChannelLists, listId: string, kind: ListKind) =>
  updateList(data, listId, (list) => ({ ...list, kind }));

export const removeList = (data: ChannelLists, listId: string): ChannelLists => ({
  lists: data.lists.filter((list) => list.id !== listId),
});

export const addItem = (data: ChannelLists, listId: string, title: string) =>
  updateList(data, listId, (list) => ({
    ...list,
    items: [...list.items, { id: createId(), title, status: 'queue' }],
  }));

export const removeItem = (data: ChannelLists, listId: string, itemId: string) =>
  updateList(data, listId, (list) => ({ ...list, items: list.items.filter((item) => item.id !== itemId) }));

/**
 * All statuses share one array and each section shows its items in array order:
 * "done" moves to the front (latest first), back to "queue" goes to the end (last in line), "now" keeps its place.
 */
export const setItemStatus = (data: ChannelLists, listId: string, itemId: string, status: ItemStatus) =>
  updateList(data, listId, (list) => {
    const item = list.items.find((candidate) => candidate.id === itemId);
    if (!item) return list;

    const movedItem = { ...item, status };
    const otherItems = list.items.filter((candidate) => candidate.id !== itemId);

    if (status === 'done') return { ...list, items: [movedItem, ...otherItems] };
    if (status === 'queue') return { ...list, items: [...otherItems, movedItem] };
    return { ...list, items: list.items.map((candidate) => (candidate.id === itemId ? movedItem : candidate)) };
  });
