// Data integrity and security of the Worker: concurrent requests, limits, lot matching, logs and keys.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { encryptText } from '../src/crypto';
import { startWorker, tmdbKnowsEverything, type TestWorker } from './harness';

let w: TestWorker;
beforeAll(async () => {
  w = await startWorker();
});
afterAll(() => w?.dispose());
afterEach(() => {
  w.fake.tmdb = tmdbKnowsEverything;
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** TMDB answers after a delay, so two requests in flight overlap. */
const slowTmdb = (ms = 30) => {
  w.fake.tmdb = async (url) => {
    await sleep(ms);
    return tmdbKnowsEverything(url);
  };
};
const fillList = (listId: number, count: number) =>
  w.db
    .prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO items (list_id, title, status, position, added_at) SELECT ?, 'Filler ' || i, 'queue', i, 0 FROM n`,
    )
    .bind(count, listId)
    .run();
const count = async (sql: string, ...params: unknown[]) => (await w.db.prepare(sql).bind(...params).first<number>('n'))!;

describe('concurrent requests do not duplicate', () => {
  it('two sync passes over the same new lot add it once', async () => {
    const { list } = await w.seedList('race-sync', 'movies');
    await w.connectPointauc('race-sync', list.id, 'token-race-0000');
    w.pointauc.set('token-race-0000', [{ id: 'L1', name: 'Interstellar', amount: 50 }]);
    slowTmdb();
    await Promise.all([1, 2].map(() => w.call('POST', '/api/pointauc/refresh', { channel: 'race-sync' })));
    expect(await count("SELECT COUNT(*) AS n FROM items WHERE lot_id = 'L1'")).toBe(1);
  });

  it('a double "accept" of a pending lot adds it once', async () => {
    const { list } = await w.seedList('race-accept', 'movies');
    const pending = await w.db
      .prepare("INSERT INTO pending_lots (list_id, lot_id, name, created_at) VALUES (?, 'P1', 'Solaris', 0) RETURNING id")
      .bind(list.id)
      .first<number>('id');
    slowTmdb();
    const answers = await Promise.all([1, 2].map(() => w.call('POST', `/api/pending/${pending}/accept`, { channel: 'race-accept', body: {} })));
    expect(await count('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', list.id)).toBe(1);
    expect(answers.filter((answer) => answer.data?.added).length).toBe(1);
  });

  it('a double bulk paste adds each title once', async () => {
    const { list } = await w.seedList('race-bulk', 'movies');
    slowTmdb();
    const body = { list_id: list.id, titles: ['Alien', 'Heat', 'Ran'] };
    await Promise.all([1, 2].map(() => w.call('POST', '/api/items/bulk', { channel: 'race-bulk', body })));
    expect(await count('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', list.id)).toBe(3);
  });

  it('two parallel "create list" at 19 lists stop at 20', async () => {
    for (let i = 0; i < 19; i++) await w.call('POST', '/api/lists', { channel: 'race-lists', body: { title: `L${i}`, kind: 'custom' } });
    const answers = await Promise.all([1, 2].map(() => w.call('POST', '/api/lists', { channel: 'race-lists', body: { title: 'Last', kind: 'custom' } })));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(await count("SELECT COUNT(*) AS n FROM lists WHERE channel_id = 'race-lists'")).toBe(20);
  });

  it('a title edit and a status change at the same time both stick', async () => {
    const { ids } = await w.seedList('race-patch', 'movies', [{ title: 'Dune' }]);
    slowTmdb(60);
    const rename = w.call('PATCH', `/api/items/${ids[0]}`, { channel: 'race-patch', body: { title: 'Dune 2' } });
    await sleep(15);
    await w.call('PATCH', `/api/items/${ids[0]}`, { channel: 'race-patch', body: { status: 'watched' } });
    await rename;
    expect(await w.all('SELECT title, status FROM items WHERE id = ?', ids[0])).toEqual([{ title: 'Dune 2', status: 'watched' }]);
  });
});

describe('limits', () => {
  it('"accept" does not grow a full list past 2000', async () => {
    const { list } = await w.seedList('full-accept', 'custom');
    await fillList(list.id, 2000);
    const pending = await w.db
      .prepare("INSERT INTO pending_lots (list_id, lot_id, name, created_at) VALUES (?, 'P1', 'One more', 0) RETURNING id")
      .bind(list.id)
      .first<number>('id');
    expect((await w.call('POST', `/api/pending/${pending}/accept`, { channel: 'full-accept', body: {} })).status).toBe(409);
    expect(await count('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', list.id)).toBe(2000);
  });

  it('adding to a full list answers 409 before asking TMDB', async () => {
    const { list } = await w.seedList('full-add', 'movies');
    await fillList(list.id, 2000);
    const response = await w.call('POST', '/api/items', { channel: 'full-add', body: { list_id: list.id, title: 'Dune' } });
    expect(response.status).toBe(409);
    expect(response.out.filter((call) => call.kind === 'tmdb')).toEqual([]);
  });
});

describe('Pointauc lots', () => {
  it('deleting the synced list switches the sync off', async () => {
    const { list } = await w.seedList('del-sync', 'movies');
    await w.connectPointauc('del-sync', list.id, 'token-del-0000', [{ id: 'L1', name: 'Heat', amount: 1 }]);
    await w.call('DELETE', `/api/lists/${list.id}`, { channel: 'del-sync' });
    expect(await w.all("SELECT pointauc_list_id FROM channels WHERE channel_id = 'del-sync'")).toEqual([{ pointauc_list_id: null }]);
    const { list: next } = await w.seedList('del-sync', 'movies');
    await w.call('POST', '/api/pointauc/refresh', { channel: 'del-sync' });
    await w.scheduled();
    expect(await count('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', next.id)).toBe(0);
  });

  it('deleting an item hides its lot even if the lot was waiting in "pending"', async () => {
    const { list, ids } = await w.seedList('del-pending', 'movies', [{ title: 'Heat', lot_id: 'L1', source: 'pointauc' }]);
    await w.db.prepare("INSERT INTO pending_lots (list_id, lot_id, name, created_at) VALUES (?, 'L1', 'Heat', 0)").bind(list.id).run();
    await w.call('DELETE', `/api/items/${ids[0]}`, { channel: 'del-pending' });
    expect(await w.all('SELECT status FROM pending_lots WHERE list_id = ?', list.id)).toEqual([{ status: 'dismissed' }]);
  });

  it('a pending lot that is in the list already is not offered again', async () => {
    const { list } = await w.seedList('pending-imported', 'movies', [{ title: 'Alien' }]);
    await w.db
      .prepare("INSERT INTO pending_lots (list_id, lot_id, name, created_at) VALUES (?, 'L1', 'Heat', 0), (?, 'L2', 'ALIEN ', 0)")
      .bind(list.id, list.id)
      .run();
    w.pointauc.set('token-pi-0000', [{ id: 'L1', name: 'Heat', amount: 3 }]);
    await w.call('PUT', '/api/pointauc/token', { channel: 'pending-imported', body: { token: 'token-pi-0000' } });
    await w.call('POST', '/api/pointauc/import', { channel: 'pending-imported', body: { list_id: list.id, lot_ids: ['L1'] } });
    expect((await w.call('GET', '/api/channel', { channel: 'pending-imported' })).data.pending).toEqual([]);
  });

  it('a renamed item keeps getting its bids and is not imported twice', async () => {
    const { list } = await w.seedList('renamed', 'movies');
    await w.connectPointauc('renamed', list.id, 'token-ren-0000', [{ id: 'L1', name: 'Dune', amount: 10 }]);
    const [{ id }] = await w.all<{ id: number }>('SELECT id FROM items WHERE list_id = ?', list.id);
    await w.call('PATCH', `/api/items/${id}`, { channel: 'renamed', body: { title: 'Дюна' } });
    w.pointauc.set('token-ren-0000', [{ id: 'L1', name: 'Dune', amount: 80 }]);
    await w.call('POST', '/api/pointauc/refresh', { channel: 'renamed' });
    await w.call('POST', '/api/pointauc/import', { channel: 'renamed', body: { list_id: list.id, lot_ids: ['L1'] } });
    expect(await w.all('SELECT title, points FROM items WHERE list_id = ?', list.id)).toEqual([{ title: 'Дюна', points: 80 }]);
  });
});

describe('list_id', () => {
  it('must be an integer', async () => {
    const { list } = await w.seedList('strict-id', 'custom');
    for (const listId of [true, null, [list.id], `${list.id}.0`, ` ${list.id} `, `0x${list.id.toString(16)}`]) {
      const response = await w.call('POST', '/api/items', { channel: 'strict-id', body: { list_id: listId, title: 'A' } });
      expect(response.status, JSON.stringify(listId)).toBe(400);
    }
    expect((await w.call('POST', '/api/items', { channel: 'strict-id', body: { list_id: String(list.id), title: 'A' } })).status).toBe(200);
    expect((await w.call('GET', `/api/pointauc/lots?list_id=${list.id}e0`, { channel: 'strict-id' })).status).toBe(400);
  });
});

describe('movie card', () => {
  it("opens only TMDB ids from the viewer's channel", async () => {
    await w.seedList('card-a', 'movies', [{ title: 'Fight Club', tmdb_id: 550, tmdb_type: 'movie' }]);
    const foreign = await w.call('GET', '/api/movie/550?type=movie&lang=en', { channel: 'card-b', role: 'viewer' });
    expect(foreign.status).toBe(404);
    expect(foreign.out).toEqual([]);
    const own = await w.call('GET', '/api/movie/550?type=movie&lang=en', { channel: 'card-a', role: 'viewer' });
    expect(own.status).toBe(200);
    expect(own.data).not.toHaveProperty('tmdb_url');
  });

  it('answers 404 quietly when TMDB has no such entry', async () => {
    await w.seedList('card-gone', 'movies', [{ title: 'Gone', tmdb_id: 999, tmdb_type: 'movie' }]);
    w.fake.tmdb = () => new Response('{}', { status: 404 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await w.call('GET', '/api/movie/999?type=movie', { channel: 'card-gone', role: 'viewer' })).status).toBe(404);
    expect(errors).not.toHaveBeenCalled();
  });

  it('gives the viewer no Pointauc lot ids or add dates', async () => {
    await w.seedList('viewer-fields', 'movies', [{ title: 'Heat', lot_id: 'L1', points: 3 }]);
    const [item] = (await w.call('GET', '/api/viewer/channel', { channel: 'viewer-fields', role: 'viewer' })).data.lists[0].items;
    expect(item).not.toHaveProperty('lot_id');
    expect(item).not.toHaveProperty('added_at');
    expect(item).toMatchObject({ title: 'Heat', points: 3 });
  });
});

describe('logs', () => {
  it('never contain the TMDB key or a lot title', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    w.fake.tmdb = (url) => {
      throw new TypeError(`Too many redirects. ${url.href}`);
    };
    const { list } = await w.seedList('logs', 'movies');
    await w.connectPointauc('logs', list.id, 'token-logs-0000', [{ id: 'L1', name: 'Секретный лот', amount: 1 }]);
    await w.call('POST', '/api/items', { channel: 'logs', body: { list_id: list.id, title: 'Тайное название' } });
    await w.call('GET', '/api/tmdb/search?q=matrix', { channel: 'logs' });
    const logged = JSON.stringify(errors.mock.calls.map((args) => args.map(String)));
    expect(errors).toHaveBeenCalled();
    expect(logged).not.toContain('test-tmdb-key');
    expect(logged).not.toContain('Секретный лот');
    expect(logged).not.toContain('Тайное название');
  });

  it('a TMDB redirect is an error, not followed', async () => {
    w.fake.tmdb = () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } });
    const response = await w.call('GET', '/api/tmdb/search?q=matrix', { channel: 'logs' });
    expect(response.status).toBe(502);
    expect(response.out.map((call) => call.redirect)).toEqual(['manual']);
  });
});

describe('Pointauc token key', () => {
  it('a key of the wrong size is a configuration error', async () => {
    w.env.TOKEN_ENCRYPTION_KEY = btoa('x'.repeat(48));
    try {
      w.pointauc.set('token-key-0000', []);
      const response = await w.call('PUT', '/api/pointauc/token', { channel: 'bad-key', body: { token: 'token-key-0000' } });
      expect(response.status).toBe(503);
    } finally {
      w.env.TOKEN_ENCRYPTION_KEY = (await import('./harness')).ENCRYPTION_KEY;
    }
  });

  it('a token saved with another key asks for the token again', async () => {
    const { list } = await w.seedList('old-key', 'movies');
    const stored = await encryptText('token-old-0000', btoa('o'.repeat(32)));
    await w.db
      .prepare("INSERT INTO channels (channel_id, pointauc_token, pointauc_list_id) VALUES ('old-key', ?, ?)")
      .bind(stored, list.id)
      .run();
    w.pointauc.set('token-old-0000', []);
    const response = await w.call('POST', '/api/pointauc/refresh', { channel: 'old-key' });
    expect(response.status).toBe(409);
    expect(response.data.error).toBe('Pointauc token must be entered again');
  });
});
