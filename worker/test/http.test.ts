// Safety net for the HTTP layer: auth, roles, channel isolation, validation, routing and snapshot publishing.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptText } from '../src/crypto';
import { verifyJwt } from '../src/jwt';
import { CLIENT_ID, ENCRYPTION_KEY, OWNER_ID, SECRET, startWorker, type TestWorker } from './harness';

let w: TestWorker;
beforeAll(async () => {
  w = await startWorker();
}, 60_000);
afterAll(() => w?.dispose());

const nowS = () => Math.floor(Date.now() / 1000);
const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');
/** A JWT with any header, signed (HMAC) with the given algorithm and secret. */
const craftJwt = (header: object, payload: object, { hash = 'sha256', secret = SECRET } = {}) => {
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${createHmac(hash, Buffer.from(secret, 'base64')).update(body).digest('base64url')}`;
};

/** Channel A with a movie list (3 queued, 1 watched, one from a Pointauc lot), a custom list, a pending lot. */
const seedChannel = async (channel: string) => {
  const movies = await w.seedList(channel, 'movies', [
    { title: `${channel} queue 1` },
    { title: `${channel} queue 2`, points: 100, lot_id: `lot-${channel}`, source: 'pointauc' },
    { title: `${channel} queue 3` },
    { title: `${channel} watched`, status: 'watched', watched_at: 2000, rating: 7, tmdb_id: 550, tmdb_type: 'movie' },
  ]);
  const custom = await w.seedList(channel, 'custom', [{ title: `${channel} custom` }]);
  await w.connectPointauc(channel, movies.list.id, `token-${channel}-0000`, [{ id: `lot-${channel}`, name: `${channel} queue 2`, amount: 100 }]);
  const pending = await w.db
    .prepare("INSERT INTO pending_lots (list_id, lot_id, name, points, created_at) VALUES (?, ?, ?, 5, 1) RETURNING id")
    .bind(movies.list.id, `pending-${channel}`, `Pending ${channel}`)
    .first<number>('id');
  return { list: movies.list.id, other: custom.list.id, items: movies.ids, pending: pending! };
};

type Seeded = Awaited<ReturnType<typeof seedChannel>>;
/** Every row that belongs to one channel. */
const dumpChannel = async (channel: string) => ({
  lists: await w.all('SELECT * FROM lists WHERE channel_id = ? ORDER BY id', channel),
  items: await w.all('SELECT items.* FROM items JOIN lists ON lists.id = items.list_id WHERE channel_id = ? ORDER BY items.id', channel),
  pending: await w.all('SELECT p.* FROM pending_lots p JOIN lists ON lists.id = p.list_id WHERE channel_id = ? ORDER BY p.id', channel),
  channel: await w.all('SELECT * FROM channels WHERE channel_id = ?', channel),
});
/** Every broadcaster route but the two read-only GETs of the viewer; the body is a valid one for channel `t`. */
const writeRoutes = (t: Seeded): [string, string, unknown?][] => [
  ['PUT', '/api/theme', { preset: 'ice' }],
  ['PUT', '/api/pointauc/token', { token: 'another-token-0000' }],
  ['POST', '/api/pointauc/import', { list_id: t.list, lot_ids: ['lot-x'] }],
  ['PUT', '/api/pointauc/sync', { list_id: t.other }],
  ['POST', '/api/pointauc/refresh'],
  ['POST', `/api/pending/${t.pending}/accept`, {}],
  ['DELETE', `/api/pending/${t.pending}`],
  ['POST', '/api/lists', { title: 'X', kind: 'custom' }],
  ['PATCH', `/api/lists/${t.list}`, { title: 'renamed' }],
  ['POST', `/api/lists/${t.list}/match-missing`],
  ['PUT', `/api/lists/${t.list}/order`, { ids: [...t.items.slice(0, 3)].reverse() }],
  ['POST', '/api/items', { list_id: t.list, title: 'Injected' }],
  ['POST', '/api/items/bulk', { list_id: t.list, titles: ['Bulk 1'] }],
  ['PATCH', `/api/items/${t.items[0]}`, { title: 'renamed' }],
  ['DELETE', `/api/items/${t.items[1]}`],
  ['DELETE', `/api/lists/${t.list}`],
  ['DELETE', '/api/pointauc/token'],
];
const readRoutes = (t: Seeded): [string, string][] => [
  ['GET', '/api/channel'],
  ['GET', `/api/pointauc/lots?list_id=${t.list}`],
  ['GET', '/api/tmdb/search?q=matrix'],
];

describe('auth', () => {
  const routes = ['/api/channel', '/api/viewer/channel', '/api/movie/550'];

  it('answers 401 without a valid token and touches nothing', async () => {
    w.clock.auto = false; // the crafted tokens below live a minute
    const payload = { exp: nowS() + 60, channel_id: 'auth', role: 'broadcaster', user_id: 'u1' };
    const header = { alg: 'HS256', typ: 'JWT' };
    const [, , foreignSignature] = craftJwt(header, { ...payload, channel_id: 'other' }).split('.');
    const bad: [string, string | null][] = [
      ['no header', null],
      ['not Bearer', `Basic ${craftJwt(header, payload)}`],
      ['garbage', 'Bearer not.a.jwt'],
      ['expired', `Bearer ${craftJwt(header, { ...payload, exp: nowS() - 1 })}`],
      ['exp missing', `Bearer ${craftJwt(header, { channel_id: 'auth', role: 'broadcaster' })}`],
      ['wrong secret', `Bearer ${craftJwt(header, payload, { secret: btoa('another secret') })}`],
      ['payload of another token', `Bearer ${craftJwt(header, payload).split('.').slice(0, 2).join('.')}.${foreignSignature}`],
      ['alg none', `Bearer ${craftJwt({ alg: 'none' }, payload).split('.').slice(0, 2).join('.')}.`],
      ['alg HS512', `Bearer ${craftJwt({ alg: 'HS512' }, payload, { hash: 'sha512' })}`],
      ['alg HS384 header, HS256 signature', `Bearer ${craftJwt({ alg: 'HS384' }, payload)}`],
      ['channel_id not a string', `Bearer ${craftJwt(header, { ...payload, channel_id: 1 })}`],
      ['role missing', `Bearer ${craftJwt(header, { exp: payload.exp, channel_id: 'auth' })}`],
    ];
    const before = await w.dump();
    for (const [label, auth] of bad) {
      for (const path of routes) {
        const response = await w.call('GET', path, { auth });
        expect(response.status, `${label} ${path}`).toBe(401);
        expect(response.out, `${label} ${path}`).toEqual([]);
      }
      expect((await w.call('POST', '/api/lists', { auth, body: { title: 'x', kind: 'custom' } })).status, label).toBe(401);
    }
    expect(await w.dump()).toEqual(before);
    // Control: the same payload, signed properly.
    expect((await w.call('GET', '/api/channel', { auth: `Bearer ${craftJwt(header, payload)}` })).status).toBe(200);
    w.clock.auto = true;
  });

  it('answers a CORS preflight without a token', async () => {
    const response = await w.call('OPTIONS', '/api/lists/1', { auth: null });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });
});

describe('roles and channel isolation', () => {
  let a: Seeded;
  let b: Seeded;
  beforeAll(async () => {
    a = await seedChannel('iso-a');
    b = await seedChannel('iso-b');
  });

  it('lets viewers, moderators and external tokens read, never write', async () => {
    for (const role of ['viewer', 'moderator', 'external']) {
      for (const [method, path, body] of [...writeRoutes(a), ...readRoutes(a)]) {
        const before = await w.dump();
        const response = await w.call(method, path, { channel: 'iso-a', role, body });
        expect(response.status, `${role} ${method} ${path}`).toBe(403);
        expect(response.out, `${role} ${method} ${path}`).toEqual([]);
        expect(await w.dump(), `${role} ${method} ${path}`).toEqual(before);
      }
      const viewer = await w.call('GET', '/api/viewer/channel', { channel: 'iso-a', role });
      expect(viewer.status).toBe(200);
      expect(viewer.data.lists.map((list: any) => list.id)).toEqual([a.list, a.other]);
    }
  });

  it("answers 404 to a broadcaster on another channel's lists, items and lots, and changes nothing of theirs", async () => {
    const foreign: [string, string, unknown?][] = [
      ['GET', `/api/pointauc/lots?list_id=${a.list}`],
      ['POST', '/api/pointauc/import', { list_id: a.list, lot_ids: [] }],
      ['PUT', '/api/pointauc/sync', { list_id: a.list }],
      ['POST', `/api/pending/${a.pending}/accept`, {}],
      ['PATCH', `/api/lists/${a.list}`, { title: 'hacked' }],
      ['POST', `/api/lists/${a.list}/match-missing`],
      ['PUT', `/api/lists/${a.list}/order`, { ids: a.items }],
      ['POST', '/api/items', { list_id: a.list, title: 'Injected' }],
      ['POST', '/api/items/bulk', { list_id: a.list, titles: ['Injected'] }],
      ['PATCH', `/api/items/${a.items[0]}`, { title: 'hacked' }],
      ['DELETE', `/api/items/${a.items[1]}`],
      ['DELETE', `/api/lists/${a.list}`],
    ];
    const before = await dumpChannel('iso-a');
    for (const [method, path, body] of foreign) {
      const response = await w.call(method, path, { channel: 'iso-b', body });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.published, `${method} ${path}`).toEqual([]);
    }
    // Hiding someone else's pending lot is silently a no-op.
    expect((await w.call('DELETE', `/api/pending/${a.pending}`, { channel: 'iso-b' })).status).toBe(200);
    // Reordering own list with the other channel's item ids moves nothing of theirs.
    await w.call('PUT', `/api/lists/${b.list}/order`, { channel: 'iso-b', body: { ids: [...a.items].reverse() } });
    expect(await dumpChannel('iso-a')).toEqual(before);
  });

  it("never returns another channel's data or the Pointauc token", async () => {
    const viewerB = await w.call('GET', '/api/viewer/channel', { channel: 'iso-b', role: 'viewer' });
    expect(viewerB.text).not.toContain('iso-a');
    const channelB = await w.call('GET', '/api/channel', { channel: 'iso-b' });
    expect(channelB.text).not.toContain('iso-a');
    expect(channelB.data.pending.map((lot: any) => lot.name)).toEqual(['Pending iso-b']);
    // The viewer read has no pending lots at all.
    expect(viewerB.text).not.toContain('Pending iso-b');
  });
});

describe('Pointauc token', () => {
  it('is stored encrypted and never sent back', async () => {
    w.pointauc.set('tok-0123456789', []);
    expect((await w.call('PUT', '/api/pointauc/token', { channel: 'tok', body: { token: ' tok-0123456789 ' } })).status).toBe(200);
    const [{ pointauc_token: stored }] = await w.all<{ pointauc_token: string }>("SELECT pointauc_token FROM channels WHERE channel_id = 'tok'");
    expect(stored).not.toContain('tok-0123456789');
    expect(await decryptText(stored, ENCRYPTION_KEY)).toBe('tok-0123456789');
    const channel = await w.call('GET', '/api/channel', { channel: 'tok' });
    expect(channel.data.pointauc).toBe(true);
    expect(channel.text).not.toContain('tok-0123456789');
    expect(channel.text).not.toContain(stored);
  });

  it('is checked against Pointauc before saving', async () => {
    const response = await w.call('PUT', '/api/pointauc/token', { channel: 'tok-bad', body: { token: 'unknown-token-000' } });
    expect(response.status).toBe(502);
    expect(await w.all("SELECT * FROM channels WHERE channel_id = 'tok-bad'")).toEqual([]);
    expect((await w.call('PUT', '/api/pointauc/token', { channel: 'tok-bad', body: { token: 'short' } })).status).toBe(400);
  });

  it('can be disconnected, which stops the sync', async () => {
    const { list } = await w.seedList('tok-off', 'movies');
    await w.connectPointauc('tok-off', list.id, 'token-off-0000');
    expect((await w.call('DELETE', '/api/pointauc/token', { channel: 'tok-off' })).status).toBe(200);
    expect(await w.all("SELECT pointauc_token, pointauc_list_id FROM channels WHERE channel_id = 'tok-off'")).toEqual([
      { pointauc_token: null, pointauc_list_id: null },
    ]);
    expect((await w.call('GET', '/api/channel', { channel: 'tok-off' })).data.pointauc).toBe(false);
  });
});

describe('validation', () => {
  let list: number;
  let item: number;
  beforeAll(async () => {
    const seeded = await w.seedList('val', 'movies', [{ title: 'Watched', status: 'watched', watched_at: 1 }]);
    list = seeded.list.id;
    item = seeded.ids[0];
  });

  it('answers 400 to bad bodies and changes nothing', async () => {
    const bad: [string, string, unknown][] = [
      ['POST', '/api/lists', null],
      ['POST', '/api/lists', ['title']],
      ['POST', '/api/lists', { title: '', kind: 'movies' }],
      ['POST', '/api/lists', { title: 'x'.repeat(41), kind: 'movies' }],
      ['POST', '/api/lists', { title: 'Ok', kind: 'books' }],
      ['POST', '/api/items', { list_id: list, title: '\u0007\u0000' }],
      ['POST', '/api/items', { list_id: list, title: 'x'.repeat(201) }],
      ['POST', '/api/items', { list_id: list, title: 'A', year: '2000' }],
      ['POST', '/api/items', { list_id: list, title: 'A', year: 1869 }],
      ['POST', '/api/items', { list_id: list, title: 'A', year: 2101 }],
      ['POST', '/api/items', { list_id: list, title: 'A', tmdb_id: 0 }],
      ['POST', '/api/items', { list_id: list, title: 'A', tmdb_type: 'book' }],
      ['POST', '/api/items', { list_id: list, title: 'A', poster_path: 'https://evil.example/x.jpg' }],
      ['POST', '/api/items', { list_id: list, title: 'A', status: 'watching' }],
      ['POST', '/api/items/bulk', { list_id: list, titles: 'A' }],
      ['POST', '/api/items/bulk', { list_id: list, titles: Array(201).fill('A') }],
      ['POST', '/api/items/bulk', { list_id: list, titles: ['A', ''] }],
      ['PATCH', `/api/items/${item}`, { rating: 0 }],
      ['PATCH', `/api/items/${item}`, { rating: 11 }],
      ['PATCH', `/api/items/${item}`, { rating: 7.5 }],
      ['PATCH', `/api/items/${item}`, { status: 'deleted' }],
      ['PATCH', `/api/lists/${list}`, { kind: 'books' }],
      ['PUT', `/api/lists/${list}/order`, { ids: ['1'] }],
      ['PUT', `/api/lists/${list}/order`, { ids: Array(2001).fill(1) }],
      ['PUT', '/api/theme', { preset: 'neon' }],
      ['PUT', '/api/theme', { primary: 'red', accent: '#000000' }],
      ['POST', '/api/pointauc/import', { list_id: list, lot_ids: [1] }],
      ['POST', '/api/pointauc/import', { list_id: list, lot_ids: Array(201).fill('a') }],
    ];
    const before = await w.dump();
    for (const [method, path, body] of bad) {
      const response = await w.call(method, path, { channel: 'val', body });
      expect(response.status, `${method} ${path} ${JSON.stringify(body)?.slice(0, 60)}`).toBe(400);
      expect(response.data.error).toEqual(expect.any(String));
      expect(response.out).toEqual([]);
    }
    expect((await w.call('GET', '/api/tmdb/search?q=', { channel: 'val' })).status).toBe(400);
    expect((await w.call('GET', `/api/tmdb/search?q=${'x'.repeat(101)}`, { channel: 'val' })).status).toBe(400);
    expect(await w.dump()).toEqual(before);
  });

  it('accepts the boundary values', async () => {
    expect((await w.call('POST', '/api/items', { channel: 'val', body: { list_id: list, title: 'Old', year: 1870, tmdb_id: null } })).status).toBe(200);
    expect((await w.call('PATCH', `/api/items/${item}`, { channel: 'val', body: { rating: 10 } })).data.rating).toBe(10);
    expect((await w.call('PATCH', `/api/items/${item}`, { channel: 'val', body: { rating: 1 } })).data.rating).toBe(1);
    expect((await w.call('PATCH', `/api/items/${item}`, { channel: 'val', body: { rating: null } })).data.rating).toBeNull();
    const title = (await w.call('POST', '/api/lists', { channel: 'val', body: { title: ` ${'я'.repeat(40)} `, kind: 'custom' } })).data.title;
    expect(title).toBe('я'.repeat(40));
  });

  it('caps a channel at 20 lists', async () => {
    for (let i = 0; i < 20; i++) expect((await w.call('POST', '/api/lists', { channel: 'cap', body: { title: `L${i}`, kind: 'custom' } })).status).toBe(200);
    expect((await w.call('POST', '/api/lists', { channel: 'cap', body: { title: 'L21', kind: 'custom' } })).status).toBe(409);
  });
});

describe('routing', () => {
  it('maps numeric path segments to :id and nothing else', async () => {
    const { list } = await w.seedList('route', 'custom', [{ title: 'One' }]);
    expect((await w.call('PATCH', `/api/lists/${list.id}`, { channel: 'route', body: { title: 'Renamed' } })).data.title).toBe('Renamed');
    expect((await w.call('PUT', `/api/lists/${list.id}/order`, { channel: 'route', body: { ids: [] } })).status).toBe(200);
    for (const [method, path] of [
      ['GET', '/api/nothing'],
      ['PATCH', '/api/lists/abc'],
      ['PATCH', `/api/lists/${list.id}/`],
      ['PATCH', `/api/lists/${list.id}/x`],
      ['GET', `/api/lists/${list.id}`],
      ['HEAD', '/api/channel'],
      ['PATCH', '/x/api/channel'],
    ]) {
      const response = await w.call(method, path, { channel: 'route', body: method === 'GET' || method === 'HEAD' ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect((await w.call('PATCH', '/api/lists/99999999', { channel: 'route', body: { title: 'x' } })).status).toBe(404);
  });
});

describe('snapshot publishing', () => {
  it('publishes once per successful write, never on a read or an error', async () => {
    const { list, ids } = await w.seedList('pub', 'movies', [{ title: 'Queued' }]);
    const writes: [string, string, unknown?][] = [
      ['PUT', '/api/theme', { preset: 'mint' }],
      ['PATCH', `/api/lists/${list.id}`, { title: 'Films' }],
      ['POST', '/api/items', { list_id: list.id, title: 'Dune' }],
      ['POST', '/api/items/bulk', { list_id: list.id, titles: ['Alien', 'Heat'] }],
      ['PATCH', `/api/items/${ids[0]}`, { status: 'watched' }],
      ['PUT', `/api/lists/${list.id}/order`, { ids: [] }],
      ['DELETE', `/api/items/${ids[0]}`],
    ];
    for (const [method, path, body] of writes) {
      const response = await w.call(method, path, { channel: 'pub', body });
      expect(response.status, `${method} ${path}`).toBe(200);
      expect(response.out.filter((call) => call.kind === 'twitch-config').length, `${method} ${path}`).toBe(1);
      expect(response.out.filter((call) => call.kind === 'twitch-pubsub').length, `${method} ${path}`).toBe(1);
    }
    for (const [method, path, body] of [
      ['GET', '/api/channel'],
      ['GET', '/api/viewer/channel'],
      ['PATCH', `/api/lists/${list.id}`, { kind: 'books' }],
      ['PATCH', '/api/items/99999999', { title: 'x' }],
      // Nothing to look up: match-missing answers { updated: 0 } and stays quiet.
      ['POST', `/api/lists/${list.id}/match-missing`],
    ] as [string, string, unknown?][]) {
      expect((await w.call(method, path, { channel: 'pub', body })).published, `${method} ${path}`).toEqual([]);
    }
  });

  it('sends the snapshot to the config segment and PubSub, signed as the extension owner', async () => {
    const response = await w.call('PUT', '/api/theme', { channel: 'pub-shape', body: { preset: 'mint' } });
    const config = response.out.find((call) => call.kind === 'twitch-config')!;
    const pubsub = response.out.find((call) => call.kind === 'twitch-pubsub')!;
    expect(config.url).toBe('https://api.twitch.tv/helix/extensions/configurations');
    expect(config.body).toMatchObject({ extension_id: CLIENT_ID, segment: 'broadcaster', broadcaster_id: 'pub-shape', version: '2' });
    expect(JSON.parse(config.body.content)).toEqual({ v: 2, th: { preset: 'mint' }, lists: [] });
    expect(pubsub.url).toBe('https://api.twitch.tv/helix/extensions/pubsub');
    expect(pubsub.body).toEqual({ target: ['broadcast'], broadcaster_id: 'pub-shape', message: config.body.content });
    const claims = (await verifyJwt(config.auth!, SECRET)) as any;
    expect(claims).toMatchObject({ role: 'external', user_id: OWNER_ID, channel_id: 'pub-shape', pubsub_perms: { send: ['broadcast'] } });
    expect(claims.exp - nowS()).toBeGreaterThan(50);
    expect(claims.exp - nowS()).toBeLessThanOrEqual(60);
  });

  it('orders the queue by bid, then by position; watched items newest first', async () => {
    await w.seedList('order', 'movies', [
      { title: 'No bid', points: null },
      { title: 'Bid 500', points: 500 },
      { title: 'Bid 900', points: 900 },
      { title: 'No bid 2', points: null },
      { title: 'Zero bid', points: 0 },
      { title: 'Watched long ago', status: 'watched', watched_at: 1000 },
      { title: 'Watched recently', status: 'watched', watched_at: 2000 },
    ]);
    const [snapshot] = (await w.call('PUT', '/api/theme', { channel: 'order', body: { preset: 'fox' } })).published;
    expect(snapshot.lists[0].q.map((item: any) => item.t)).toEqual(['Bid 900', 'Bid 500', 'Zero bid', 'No bid', 'No bid 2']);
    expect(snapshot.lists[0].w.map((item: any) => item.t)).toEqual(['Watched recently', 'Watched long ago']);
    const viewer = await w.call('GET', '/api/viewer/channel', { channel: 'order', role: 'viewer' });
    const titles = (status: string) => viewer.data.lists[0].items.filter((item: any) => item.status === status).map((item: any) => item.title);
    expect(titles('queue')).toEqual(['Bid 900', 'Bid 500', 'Zero bid', 'No bid', 'No bid 2']);
    expect(titles('watched')).toEqual(['Watched recently', 'Watched long ago']);
  });
});

describe('items', () => {
  it('skips titles already in the list or repeated in the paste, ignoring case and spaces', async () => {
    const { list } = await w.seedList('bulk', 'custom', [{ title: 'Alien' }]);
    const response = await w.call('POST', '/api/items/bulk', { channel: 'bulk', body: { list_id: list.id, titles: [' Дюна', ' ДЮНА ', 'Дюна', 'alien '] } });
    expect(response.data.added.map((item: any) => item.title)).toEqual(['Дюна']);
    expect(response.data.skipped).toBe(3);
  });

  it('stamps watched_at on "watched", keeps it on other edits, clears it and the rating on requeue', async () => {
    const { list, ids } = await w.seedList('status', 'custom', [{ title: 'A' }, { title: 'B', position: 7 }]);
    const before = Date.now();
    const watched = (await w.call('PATCH', `/api/items/${ids[0]}`, { channel: 'status', body: { status: 'watched', rating: 8 } })).data;
    expect(watched.watched_at).toBeGreaterThanOrEqual(before);
    expect(watched.rating).toBe(8);
    const edited = (await w.call('PATCH', `/api/items/${ids[0]}`, { channel: 'status', body: { title: 'A2' } })).data;
    expect(edited).toMatchObject({ title: 'A2', watched_at: watched.watched_at, rating: 8, status: 'watched' });
    const requeued = (await w.call('PATCH', `/api/items/${ids[0]}`, { channel: 'status', body: { status: 'queue' } })).data;
    expect(requeued).toMatchObject({ status: 'queue', watched_at: null, rating: null, position: 8 });
    // A rating is only kept on watched items.
    expect((await w.call('PATCH', `/api/items/${ids[1]}`, { channel: 'status', body: { rating: 5 } })).data.rating).toBeNull();
    expect(list.id).toBeGreaterThan(0);
  });

  it('looks a typed movie title up in TMDB, but not a custom list item', async () => {
    const { list } = await w.seedList('tmdb-add', 'movies');
    const movie = await w.call('POST', '/api/items', { channel: 'tmdb-add', body: { list_id: list.id, title: 'Dune' } });
    expect(movie.data).toMatchObject({ title: 'Dune', tmdb_id: 1004, poster_path: '/p.jpg', year: 2000, tmdb_type: 'movie' });
    const custom = await w.seedList('tmdb-add', 'custom');
    const plain = await w.call('POST', '/api/items', { channel: 'tmdb-add', body: { list_id: custom.list.id, title: 'Dune' } });
    expect(plain.data.tmdb_id).toBeNull();
    expect(plain.out.filter((call) => call.kind === 'tmdb')).toEqual([]);
  });
});

describe('automatic Pointauc sync', () => {
  it('queues a lot TMDB knows with enough votes, parks the others for the streamer', async () => {
    const { list } = await w.seedList('votes', 'movies');
    w.fake.tmdb = (url) => {
      const query = url.searchParams.get('query') ?? '';
      const votes = query === 'Popular' ? 50 : 5;
      return Response.json({ results: [{ id: votes, media_type: 'movie', title: query, release_date: '2001-01-01', vote_count: votes }] });
    };
    try {
      const sync = await w.connectPointauc('votes', list.id, 'token-votes-0000', [
        { id: 'L1', name: 'Popular', amount: 10 },
        { id: 'L2', name: 'Obscure', amount: 20 },
      ]);
      expect(sync.data).toEqual({ ok: true, synced: true });
    } finally {
      w.fake.tmdb = (await import('./harness')).tmdbKnowsEverything;
    }
    expect(await w.all('SELECT title, tmdb_id, points, lot_id, source FROM items WHERE list_id = ?', list.id)).toEqual([
      { title: 'Popular', tmdb_id: 50, points: 10, lot_id: 'L1', source: 'pointauc' },
    ]);
    expect(await w.all('SELECT lot_id, name, points, status FROM pending_lots WHERE list_id = ?', list.id)).toEqual([
      { lot_id: 'L2', name: 'Obscure', points: 20, status: 'pending' },
    ]);
  });

  it('switching the sync on publishes once, from its first pass', async () => {
    const { list } = await w.seedList('sync-once', 'movies');
    const sync = await w.connectPointauc('sync-once', list.id, 'token-once-0000', [{ id: 'L1', name: 'Heat', amount: 3 }]);
    expect(sync.published.length).toBe(1);
    expect(sync.published[0].lists[0].q[0]).toMatchObject({ t: 'Heat', b: 3 });
  });

  it('refreshes bids, publishes only when something changed', async () => {
    const { list } = await w.seedList('bids', 'movies');
    await w.connectPointauc('bids', list.id, 'token-bids-0000', [{ id: 'L1', name: 'Dune', amount: 10 }]);
    const quiet = await w.call('POST', '/api/pointauc/refresh', { channel: 'bids' });
    expect(quiet.data).toEqual({ updated: 0, changed: false });
    expect(quiet.published).toEqual([]);
    w.pointauc.set('token-bids-0000', [{ id: 'L1', name: 'Dune', amount: 99 }]);
    const changed = await w.call('POST', '/api/pointauc/refresh', { channel: 'bids' });
    expect(changed.data).toEqual({ updated: 0, changed: true });
    expect(changed.published.length).toBe(1);
    expect(changed.published[0].lists[0].q[0]).toMatchObject({ t: 'Dune', b: 99 });
  });

  it('never brings back a deleted lot, even renamed', async () => {
    const { list } = await w.seedList('deleted', 'movies');
    await w.connectPointauc('deleted', list.id, 'token-deleted-0000', [{ id: 'L1', name: 'Dune', amount: 10 }]);
    const [{ id }] = await w.all<{ id: number }>('SELECT id FROM items WHERE list_id = ?', list.id);
    await w.call('DELETE', `/api/items/${id}`, { channel: 'deleted' });
    await w.call('POST', '/api/pointauc/refresh', { channel: 'deleted' });
    w.pointauc.set('token-deleted-0000', [{ id: 'L1', name: 'Dune (2021)', amount: 10 }]);
    await w.call('POST', '/api/pointauc/refresh', { channel: 'deleted' });
    await w.scheduled();
    expect(await w.all('SELECT * FROM items WHERE list_id = ?', list.id)).toEqual([]);
    expect(await w.all('SELECT lot_id, status FROM pending_lots WHERE list_id = ?', list.id)).toEqual([{ lot_id: 'L1', status: 'dismissed' }]);
  });

  it('runs from cron for channels that switched it on', async () => {
    const { list } = await w.seedList('cron', 'movies');
    await w.connectPointauc('cron', list.id, 'token-cron-0000');
    w.pointauc.set('token-cron-0000', [{ id: 'L1', name: 'Heat', amount: 3 }]);
    // The cron takes a few channels at random: leave only this one synced.
    await w.db.prepare("UPDATE channels SET pointauc_list_id = NULL WHERE channel_id <> 'cron'").run();
    const out = await w.scheduled();
    expect(out.some((call) => call.kind === 'pointauc' && call.auth === 'token-cron-0000')).toBe(true);
    expect(await w.all('SELECT title FROM items WHERE list_id = ?', list.id)).toEqual([{ title: 'Heat' }]);
  });
});
