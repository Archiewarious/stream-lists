// Cloudflare Free and Twitch limits: subrequests per invocation, cron rotation, sync pacing, snapshot publishing.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildSnapshot } from '../src/snapshot';
import { startWorker, tmdbKnowsEverything, type TestWorker } from './harness';

let w: TestWorker;
beforeAll(async () => {
  w = await startWorker();
});
afterAll(() => w?.dispose());
afterEach(() => {
  w.fake.tmdb = tmdbKnowsEverything;
  w.fake.twitchStatus = 204;
  w.clock.auto = true;
  vi.restoreAllMocks();
});

const nothingFound = () => {
  w.fake.tmdb = () => Response.json({ results: [] });
};
/** Lots with a trailing year: TMDB is asked twice for each (with and without the year). */
const yearLots = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} фильм ${i} 2014`, amount: i }));
const syncedChannel = async (channel: string, lots = yearLots(channel, 1)) => {
  const { list } = await w.seedList(channel, 'movies');
  w.pointauc.set(`token-${channel}-0000`, lots);
  await w.call('PUT', '/api/pointauc/token', { channel, body: { token: `token-${channel}-0000` } });
  await w.db.prepare('UPDATE channels SET pointauc_list_id = ?, pointauc_due_at = 0 WHERE channel_id = ?').bind(list.id, channel).run();
  return list;
};

describe('subrequests (Free: 50 per invocation)', () => {
  it('one sync pass with many new lots stays within 50 and still publishes', async () => {
    nothingFound();
    const list = await syncedChannel('budget-one', [{ id: 'OLD', name: 'Old', amount: 99 }, ...yearLots('A', 25)]);
    await w.db.prepare("INSERT INTO items (list_id, title, status, position, added_at, points) VALUES (?, 'Old', 'queue', 1, 0, 1)").bind(list.id).run();
    const response = await w.call('POST', '/api/pointauc/refresh', { channel: 'budget-one' });
    expect(response.out.length).toBeLessThanOrEqual(50);
    expect(response.out.some((call) => call.kind === 'twitch-config')).toBe(true);
  });

  it('a cron run shares the 50 between channels', async () => {
    nothingFound();
    await w.db.prepare('UPDATE channels SET pointauc_list_id = NULL').run(); // only these two
    const a = await syncedChannel('budget-a', yearLots('A', 25));
    const b = await syncedChannel('budget-b', [{ id: 'B1', name: 'B film', amount: 1 }]);
    const out = await w.scheduled();
    expect(out.length).toBeLessThanOrEqual(50);
    expect(await w.all('SELECT COUNT(*) AS n FROM pending_lots WHERE list_id = ?', b.id)).toEqual([{ n: 1 }]);
    expect((await w.all<{ n: number }>('SELECT COUNT(*) AS n FROM pending_lots WHERE list_id = ?', a.id))[0].n).toBeGreaterThan(0);
  });
});

describe('cron', () => {
  it('gets to every channel over a few runs, a few channels per run', async () => {
    await w.db.prepare('UPDATE channels SET pointauc_list_id = NULL').run();
    const channels = Array.from({ length: 11 }, (_, i) => `cron-${i}`);
    for (const channel of channels) await syncedChannel(channel, []);
    const seen = new Set<string>();
    for (let run = 0; run < 30; run++) {
      const tokens = (await w.scheduled()).filter((call) => call.kind === 'pointauc').map((call) => call.auth);
      expect(tokens.length).toBeLessThanOrEqual(4);
      for (const token of tokens) seen.add(token!);
    }
    expect(seen.size).toBe(11);
  });

  it('publishes again a snapshot Twitch did not take', async () => {
    const { list } = await w.seedList('stale', 'custom');
    w.fake.twitchStatus = 500;
    await w.call('POST', '/api/items', { channel: 'stale', body: { list_id: list.id, title: 'Lost' } });
    w.fake.twitchStatus = 204;
    const out = await w.scheduled();
    const config = out.find((call) => call.kind === 'twitch-config' && call.body.broadcaster_id === 'stale');
    expect(JSON.parse(config!.body.content).lists[0].q[0].t).toBe('Lost');
    expect((await w.scheduled()).filter((call) => call.kind === 'twitch-config' && call.body.broadcaster_id === 'stale')).toEqual([]);
  });
});

describe('sync pacing', () => {
  it('one pass per 10 seconds per channel, however many panels ask', async () => {
    await syncedChannel('pace', [{ id: 'L1', name: 'Heat', amount: 1 }]);
    w.clock.auto = false;
    const first = await w.call('POST', '/api/pointauc/refresh', { channel: 'pace' });
    w.clock.now += 5_000;
    const second = await w.call('POST', '/api/pointauc/refresh', { channel: 'pace' });
    w.clock.now += 6_000;
    const third = await w.call('POST', '/api/pointauc/refresh', { channel: 'pace' });
    const pointauc = (response: typeof first) => response.out.filter((call) => call.kind === 'pointauc').length;
    expect([pointauc(first), pointauc(second), pointauc(third)]).toEqual([1, 0, 1]);
  });

  it('does not read the list again while Pointauc lots stay the same', async () => {
    const list = await syncedChannel('same-lots', [{ id: 'L1', name: 'Heat', amount: 1 }]);
    await w.call('POST', '/api/pointauc/refresh', { channel: 'same-lots' });
    const prepare = vi.spyOn(w.db, 'prepare');
    await w.call('POST', '/api/pointauc/refresh', { channel: 'same-lots' });
    expect(prepare.mock.calls.filter(([sql]) => /FROM (items|pending_lots) WHERE list_id/.test(sql))).toEqual([]);
    prepare.mockRestore();
    w.pointauc.set('token-same-lots-0000', [{ id: 'L1', name: 'Heat', amount: 7 }]);
    await w.call('POST', '/api/pointauc/refresh', { channel: 'same-lots' });
    expect(await w.all('SELECT points FROM items WHERE list_id = ?', list.id)).toEqual([{ points: 7 }]);
  });

  it('looks at the list again after the streamer changes it, though the lots stay the same', async () => {
    const list = await syncedChannel('typed-in', [{ id: 'L1', name: 'Alien', amount: 500 }]);
    await w.db.prepare("UPDATE lists SET kind = 'games' WHERE id = ?").bind(list.id).run(); // the lot waits in "pending"
    await w.call('POST', '/api/pointauc/refresh', { channel: 'typed-in' });
    await w.call('POST', '/api/items', { channel: 'typed-in', body: { list_id: list.id, title: 'Alien' } });
    await w.call('POST', '/api/pointauc/refresh', { channel: 'typed-in' });
    expect(await w.all('SELECT points, lot_id FROM items WHERE list_id = ?', list.id)).toEqual([{ points: 500, lot_id: 'L1' }]);
  });

  it('a pass cut short by the budget is not taken as done', async () => {
    nothingFound();
    const list = await syncedChannel('cut-short', yearLots('C', 30));
    await w.call('POST', '/api/pointauc/refresh', { channel: 'cut-short' });
    await w.call('POST', '/api/pointauc/refresh', { channel: 'cut-short' });
    expect(await w.all('SELECT COUNT(*) AS n FROM pending_lots WHERE list_id = ?', list.id)).toEqual([{ n: 30 }]);
  });
});

describe('snapshot publishing', () => {
  it('is built from the first items of each list only, the same as from the whole channel', async () => {
    await w.seedList('trimmed', 'movies', [
      ...Array.from({ length: 40 }, (_, i) => ({ title: `Q${i}`, points: i % 7 })),
      ...Array.from({ length: 30 }, (_, i) => ({ title: `W${i}`, status: 'watched', watched_at: 1000 + i, rating: 5 })),
    ]);
    const [published] = (await w.call('PUT', '/api/theme', { channel: 'trimmed', body: { preset: 'ice' } })).published;
    const { lists } = (await w.call('GET', '/api/channel', { channel: 'trimmed' })).data;
    expect(published).toEqual(JSON.parse(buildSnapshot(lists, { preset: 'ice' })));
  });

  it('a burst of edits goes out as at most two publishes, the last with the final state', async () => {
    const { ids } = await w.seedList('burst', 'custom', ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title })));
    await w.call('PUT', '/api/theme', { channel: 'burst', body: { preset: 'fox' } }); // an earlier publish, long ago
    w.clock.auto = false;
    w.clock.now += 60_000;
    const start = w.outbound.length;
    await Promise.all(ids.map((id, i) => w.call('PATCH', `/api/items/${id}`, { channel: 'burst', body: { title: `Edited ${i}` } })));
    const published = w.outbound
      .slice(start)
      .filter((call) => call.kind === 'twitch-config')
      .map((call) => JSON.parse(call.body.content));
    expect(published.length).toBeLessThanOrEqual(2);
    expect(published.at(-1).lists[0].q.map((item: any) => item.t).sort()).toEqual(ids.map((_, i) => `Edited ${i}`));
  });
});

describe('automatic sync without an answer from Pointauc', () => {
  const MINUTE = 60_000;
  /** Minutes (from now) at which the cron asked Pointauc for the channel's lots. */
  const cronCalls = async (token: string, minutes: number) => {
    w.clock.auto = false;
    const start = w.clock.now;
    const calls: number[] = [];
    for (let minute = 0; minute <= minutes; minute++) {
      w.clock.now = start + minute * MINUTE;
      if ((await w.scheduled()).some((call) => call.kind === 'pointauc' && call.auth === token)) calls.push(minute);
    }
    return calls;
  };
  const closedTab = async (channel: string) => {
    await w.db.prepare('UPDATE channels SET pointauc_list_id = NULL').run(); // only this channel syncs
    await syncedChannel(channel, []);
    w.pointauc.delete(`token-${channel}-0000`); // Pointauc answers 500, as with its tab closed
  };

  it('asks 1, 2, 4... minutes apart, at most hourly', async () => {
    await closedTab('backoff');
    expect(await cronCalls('token-backoff-0000', 190)).toEqual([0, 1, 2, 4, 8, 16, 32, 64, 124, 184]);
  });

  it('goes back to every minute once Pointauc answers', async () => {
    await closedTab('answers');
    await cronCalls('token-answers-0000', 5);
    w.pointauc.set('token-answers-0000', []);
    w.clock.now += 3 * MINUTE;
    expect(await cronCalls('token-answers-0000', 3)).toEqual([0, 1, 2, 3]);
  });

  it('stops after 30 days of silence and starts again when the streamer opens a window', async () => {
    await closedTab('silent');
    w.clock.auto = false;
    await w.db
      .prepare("UPDATE channels SET pointauc_failing_since = ?, pointauc_due_at = ? WHERE channel_id = 'silent'")
      .bind(w.clock.now - 31 * 24 * 60 * MINUTE, w.clock.now)
      .run();
    expect(await cronCalls('token-silent-0000', 0)).toEqual([0]);
    w.clock.now += MINUTE;
    expect(await cronCalls('token-silent-0000', 120)).toEqual([]);
    await w.call('GET', '/api/channel', { channel: 'silent' });
    w.clock.now += MINUTE;
    expect(await cronCalls('token-silent-0000', 0)).toEqual([0]);
  });

  it('the cron finds due channels by an index', async () => {
    const plan = await w.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT channel_id FROM channels WHERE pointauc_list_id IS NOT NULL AND pointauc_token IS NOT NULL
       AND pointauc_due_at <= 0 ORDER BY pointauc_due_at LIMIT 4`,
    );
    expect(plan.map((row) => row.detail).join()).toContain('USING INDEX channels_sync_due');
  });
});

