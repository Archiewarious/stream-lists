import { describe, expect, it } from 'vitest';

import { buildSnapshot, type ChannelList, type ItemRow } from '@worker/snapshot';

import { addPage, fromChannelLists, parseSnapshot, withPages, type PanelItem } from './panelLists';

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
    expect(parseSnapshot('{"v":1,"lists":[]}')).toBeNull();
    expect(parseSnapshot('{oops')).toBeNull();
  });

  it('reads a later version the Worker may publish (it only adds fields)', () => {
    const snapshot = parseSnapshot('{"v":3,"x":1,"lists":[{"i":1,"t":"A","k":"movies","qn":0,"wn":0,"q":[],"w":[]}]}');
    expect(snapshot?.lists.map((list) => list.title)).toEqual(['A']);
  });

  it('drops items and lists of the wrong shape instead of breaking the panel', () => {
    const snapshot = parseSnapshot(
      JSON.stringify({
        v: 2,
        lists: [
          { i: 1, t: 'A', k: 'movies', qn: 'x', wn: 1, q: [{ i: 1, t: {} }, { i: 2, t: 'Ok', d: 'abc', r: {}, y: 1e400 }], w: 'nope' },
          { i: 2, t: 'B', k: 'books', qn: 0, wn: 0, q: [], w: [] },
        ],
      }),
    );
    expect(snapshot?.lists).toEqual([
      {
        id: 1,
        title: 'A',
        kind: 'movies',
        queueCount: 1,
        watchedCount: 1,
        queue: [{ id: 2, title: 'Ok', year: null, poster_path: null, watched_at: null, points: null, rating: null, tmdb_id: null, tmdb_type: null }],
        watched: [],
      },
    ]);
  });
});

describe('pages beyond the snapshot', () => {
  const panelItem = (id: number): PanelItem => ({ ...fromChannelLists([{ ...channel[0], items: [item(id, {})] }])[0].queue[0] });
  const [list] = fromChannelLists(channel);

  it('follow the snapshot, without what the snapshot shows itself', () => {
    let pages = addPage({}, 1, 'queue', [panelItem(4), panelItem(5)]);
    pages = addPage(pages, 1, 'queue', [panelItem(5), panelItem(6)]); // the list moved: 5 came again
    expect(withPages([list], pages)[0].queue.map((each) => each.id)).toEqual([1, 2, 4, 5, 6]);
    // A new snapshot shows 4 at the top: it is not repeated below, and nothing loaded is lost.
    const next = { ...list, queue: [panelItem(4), ...list.queue] };
    expect(withPages([next], pages)[0].queue.map((each) => each.id)).toEqual([4, 1, 2, 5, 6]);
    expect(withPages([list], pages)[0].watched).toEqual(list.watched);
  });
});
