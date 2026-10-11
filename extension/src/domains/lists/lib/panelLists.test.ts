import { describe, expect, it } from 'vitest';

import { buildSnapshot, type ChannelList, type ItemRow } from '@worker/snapshot';

import { fromChannelLists, parseSnapshot } from './panelLists';

const item = (id: number, fields: Partial<ItemRow>): ItemRow => ({
  id,
  list_id: 1,
  title: `Фильм ${id}`,
  year: null,
  poster_path: null,
  tmdb_id: null,
  status: 'queue',
  position: id,
  added_at: 0,
  watched_at: null,
  source: 'manual',
  points: null,
  lot_id: null,
  rating: null,
  tmdb_type: null,
  ...fields,
});

const channel: ChannelList[] = [
  {
    id: 1,
    channel_id: '1',
    title: 'Фильмы',
    kind: 'movies',
    created_at: 0,
    items: [
      item(1, { year: 2014, poster_path: '/a.jpg', tmdb_id: 157336, tmdb_type: 'movie', points: 1250 }),
      item(2, {}),
      item(3, { status: 'watched', watched_at: 1790553600000, rating: 8 }),
    ],
  },
];

describe('parseSnapshot', () => {
  it('reads back what the Worker publishes, same as the full lists', () => {
    expect(parseSnapshot(buildSnapshot(channel, { preset: 'mint' }))).toEqual({
      lists: fromChannelLists(channel),
      theme: { preset: 'mint' },
    });
  });

  it('ignores empty, old and broken content', () => {
    expect(parseSnapshot(undefined)).toBeNull();
    expect(parseSnapshot('{"lists":[]}')).toBeNull(); // phase-1 format had no version
    expect(parseSnapshot('{oops')).toBeNull();
  });
});
