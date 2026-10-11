// Main scenarios of the Worker: queue order, TMDB lookups, Pointauc sync edge cases.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

const queueTitles = async (listId: number) =>
  (await w.all<{ title: string }>("SELECT title FROM items WHERE list_id = ? AND status = 'queue' ORDER BY position, id", listId)).map(
    (row) => row.title,
  );
/** TMDB knows only these titles (for sure, 500 votes); anything else finds nothing. */
const tmdbKnows = (...titles: string[]) => {
  w.fake.tmdb = (url) => {
    const query = url.searchParams.get('query') ?? '';
    return titles.includes(query) ? tmdbKnowsEverything(url) : Response.json({ results: [] });
  };
};

describe('queue order', () => {
  it('a reorder of some items (a search was on) moves only them, in their own places', async () => {
    const { list, ids } = await w.seedList('order-subset', 'custom', ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title })));
    const [, b, , d] = ids;
    expect((await w.call('PUT', `/api/lists/${list.id}/order`, { channel: 'order-subset', body: { ids: [d, b] } })).status).toBe(200);
    expect(await queueTitles(list.id)).toEqual(['A', 'D', 'C', 'B', 'E']);
    const positions = await w.all<{ position: number }>('SELECT position FROM items WHERE list_id = ?', list.id);
    expect(new Set(positions.map((row) => row.position)).size).toBe(5);
  });

  it('a full reorder sets the order, and only changed rows are written', async () => {
    const { list, ids } = await w.seedList('order-full', 'custom', ['A', 'B', 'C'].map((title) => ({ title })));
    await w.call('PUT', `/api/lists/${list.id}/order`, { channel: 'order-full', body: { ids: [ids[2], ids[0], ids[1]] } });
    expect(await queueTitles(list.id)).toEqual(['C', 'A', 'B']);
    const batch = vi.spyOn(w.db, 'batch');
    await w.call('PUT', `/api/lists/${list.id}/order`, { channel: 'order-full', body: { ids: [ids[2], ids[0], ids[1]] } });
    const written = batch.mock.calls.flatMap(([statements]) => statements as unknown as { sql: string }[]);
    expect(written.filter((statement) => statement.sql.includes('SET position'))).toEqual([]);
  });

  it('refuses repeated ids', async () => {
    const { list, ids } = await w.seedList('order-repeat', 'custom', [{ title: 'A' }]);
    expect((await w.call('PUT', `/api/lists/${list.id}/order`, { channel: 'order-repeat', body: { ids: [ids[0], ids[0]] } })).status).toBe(400);
  });

  it('the import dialog numbers the queue the way the panel shows it (by bid)', async () => {
    const { list } = await w.seedList('import-place', 'movies', [
      { title: 'Small bid', points: 100 },
      { title: 'Big bid', points: 500 },
    ]);
    w.pointauc.set('token-place-0000', [
      { id: 'L1', name: 'Small bid', amount: 100 },
      { id: 'L2', name: 'Big bid', amount: 500 },
    ]);
    await w.call('PUT', '/api/pointauc/token', { channel: 'import-place', body: { token: 'token-place-0000' } });
    const lots = (await w.call('GET', `/api/pointauc/lots?list_id=${list.id}`, { channel: 'import-place' })).data;
    expect(lots.map((lot: any) => [lot.name, lot.position])).toEqual([
      ['Big bid', 1],
      ['Small bid', 2],
    ]);
  });
});

describe('adding items', () => {
  it('refuses a title the list already has, the way the panel compares titles', async () => {
    const { list } = await w.seedList('dup-add', 'custom', [{ title: 'Ёжик в тумане' }]);
    const response = await w.call('POST', '/api/items', { channel: 'dup-add', body: { list_id: list.id, title: ' ежик  В тумане ' } });
    expect(response.status).toBe(409);
    expect(await w.all('SELECT title FROM items WHERE list_id = ?', list.id)).toEqual([{ title: 'Ёжик в тумане' }]);
  });

  it('says how many titles of a paste were not looked up in TMDB (one request has a budget)', async () => {
    const { list } = await w.seedList('bulk-budget', 'movies');
    const titles = Array.from({ length: 30 }, (_, i) => `Film ${i + 1}`);
    const response = await w.call('POST', '/api/items/bulk', { channel: 'bulk-budget', body: { list_id: list.id, titles } });
    expect(response.data.added.length).toBe(30);
    expect(response.data.unchecked).toBe(5);
  });

  it('"match-missing" gets to every title without a poster, a few per call', async () => {
    const titles = Array.from({ length: 30 }, (_, i) => ({ title: `Unknown ${i + 1}` }));
    titles[27] = { title: 'Known' };
    const { list } = await w.seedList('match-round', 'movies', titles);
    tmdbKnows('Known');
    expect((await w.call('POST', `/api/lists/${list.id}/match-missing`, { channel: 'match-round' })).data).toEqual({ updated: 0 });
    expect((await w.call('POST', `/api/lists/${list.id}/match-missing`, { channel: 'match-round' })).data).toEqual({ updated: 1 });
    expect(await w.all('SELECT title FROM items WHERE list_id = ? AND tmdb_id IS NOT NULL', list.id)).toEqual([{ title: 'Known' }]);
  });
});

describe('automatic Pointauc sync', () => {
  it('a TMDB failure is not "unknown": the lot waits for the next pass instead of going to "pending"', async () => {
    const { list } = await w.seedList('tmdb-down', 'movies');
    w.fake.tmdb = () => new Response('slow down', { status: 429 });
    await w.connectPointauc('tmdb-down', list.id, 'token-down-0000', [{ id: 'L1', name: 'Heat', amount: 5 }]);
    expect(await w.all('SELECT * FROM pending_lots WHERE list_id = ?', list.id)).toEqual([]);
    w.fake.tmdb = tmdbKnowsEverything;
    await w.call('POST', '/api/pointauc/refresh', { channel: 'tmdb-down' });
    expect(await queueTitles(list.id)).toEqual(['Heat']);
  });

  it('near the 2000 cap, adds what fits, parks the rest and still refreshes bids', async () => {
    const { list } = await w.seedList('near-cap', 'movies', [{ title: 'Old', points: 1, lot_id: 'L0', source: 'pointauc' }]);
    await w.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1997)
         INSERT INTO items (list_id, title, status, position, added_at) SELECT ?, 'Filler ' || i, 'queue', i + 1, 0 FROM n`,
      )
      .bind(list.id)
      .run();
    const lots = [{ id: 'L0', name: 'Old', amount: 99 }, ...['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: `N${i}`, name, amount: 1 }))];
    await w.connectPointauc('near-cap', list.id, 'token-cap-0000', lots);
    expect(await w.all('SELECT COUNT(*) AS n FROM items WHERE list_id = ?', list.id)).toEqual([{ n: 2000 }]);
    expect(await w.all("SELECT points FROM items WHERE lot_id = 'L0'")).toEqual([{ points: 99 }]);
    expect((await w.all('SELECT name FROM pending_lots WHERE list_id = ? ORDER BY name', list.id)).map((row: any) => row.name)).toEqual(['C', 'D', 'E']);
  });

  it('keeps the bid of a lot waiting in "pending" up to date', async () => {
    const { list } = await w.seedList('pending-bid', 'custom');
    await w.connectPointauc('pending-bid', list.id, 'token-pb-0000', [{ id: 'L1', name: 'Game', amount: 50 }]);
    w.pointauc.set('token-pb-0000', [{ id: 'L1', name: 'Game', amount: 500 }]);
    await w.call('POST', '/api/pointauc/refresh', { channel: 'pending-bid' });
    expect(await w.all('SELECT points FROM pending_lots WHERE list_id = ?', list.id)).toEqual([{ points: 500 }]);
  });

  it('a games list takes every new lot in one pass (no TMDB lookups to budget)', async () => {
    const { list } = await w.seedList('games-all', 'games');
    const lots = Array.from({ length: 30 }, (_, i) => ({ id: `G${i}`, name: `Game ${i}`, amount: i }));
    await w.connectPointauc('games-all', list.id, 'token-games-0000', lots);
    expect(await w.all('SELECT COUNT(*) AS n FROM pending_lots WHERE list_id = ?', list.id)).toEqual([{ n: 30 }]);
  });
});

describe('Pointauc answers', () => {
  it('a network failure or an answer without lots is a 502, and the token is not saved', async () => {
    w.pointauc.set('token-net-0000', () => {
      throw new TypeError('network down');
    });
    w.pointauc.set('token-odd-0000', () => Response.json({ error: 'no tab' }));
    w.pointauc.set('token-text-0000', () => new Response('<html>', { status: 200 }));
    for (const token of ['token-net-0000', 'token-odd-0000', 'token-text-0000']) {
      expect((await w.call('PUT', '/api/pointauc/token', { channel: 'pa-bad', body: { token } })).status, token).toBe(502);
    }
    expect(await w.all("SELECT * FROM channels WHERE channel_id = 'pa-bad'")).toEqual([]);
  });

  it('every outside call can time out', async () => {
    const { list } = await w.seedList('timeouts', 'movies');
    const sync = await w.connectPointauc('timeouts', list.id, 'token-to-0000', [{ id: 'L1', name: 'Heat', amount: 1 }]);
    const calls = [...sync.out, ...(await w.call('GET', '/api/tmdb/search?q=heat', { channel: 'timeouts' })).out];
    expect(calls.filter((call) => call.kind === 'pointauc' || call.kind === 'tmdb').every((call) => call.signal)).toBe(true);
    expect(calls.some((call) => call.kind === 'tmdb')).toBe(true);
  });
});
