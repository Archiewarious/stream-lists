import { describe, expect, it } from 'vitest';

import {
  addItem,
  addList,
  checkFitsConfigLimit,
  EMPTY_CHANNEL_LISTS,
  getItemsByStatus,
  parseChannelLists,
  serializeChannelLists,
  setItemStatus,
} from '@domains/lists/lib/channelLists';

const titlesOf = (items: { title: string }[]) => items.map((item) => item.title);

describe('channelLists', () => {
  it('moves items between statuses: done goes first, back to queue goes last', () => {
    let data = addList(EMPTY_CHANNEL_LISTS, 'games', 'Игры', 'games');
    data = addItem(addItem(addItem(data, 'games', 'A'), 'games', 'B'), 'games', 'C');
    const [itemA, itemB] = data.lists[0].items;

    data = setItemStatus(data, 'games', itemA.id, 'done');
    data = setItemStatus(data, 'games', itemB.id, 'done');
    data = setItemStatus(data, 'games', itemA.id, 'queue');

    const [list] = data.lists;
    expect(titlesOf(getItemsByStatus(list, 'queue'))).toEqual(['C', 'A']);
    expect(titlesOf(getItemsByStatus(list, 'done'))).toEqual(['B']);
  });

  it('round-trips the config, drops malformed entries and flags unreadable content', () => {
    const data = addItem(addList(EMPTY_CHANNEL_LISTS, 'movies', 'Фильмы', 'movies'), 'movies', 'Дюна');
    expect(parseChannelLists(serializeChannelLists(data))).toEqual(data);

    const withJunk = JSON.stringify({ lists: [...data.lists, { id: 1 }, { ...data.lists[0], kind: 'books' }] });
    expect(parseChannelLists(withJunk)).toEqual(data);

    expect(parseChannelLists(undefined)).toEqual(EMPTY_CHANNEL_LISTS);
    expect(parseChannelLists('{broken')).toBeNull();
  });

  it('counts the 5 KB limit in bytes, not characters', () => {
    expect(checkFitsConfigLimit('я'.repeat(2500))).toBe(true);
    expect(checkFitsConfigLimit('я'.repeat(2501))).toBe(false);
  });
});
