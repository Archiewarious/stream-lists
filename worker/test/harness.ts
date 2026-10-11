// HTTP tests of the Worker: the real fetch handler in Node against SQLite with all migrations applied. Outbound calls
// (Twitch, TMDB, Pointauc) are faked and recorded.
//
// The database is Node's built-in SQLite (./sqlite-d1.ts). `TEST_D1=workerd npm test` runs the same tests against a
// real local D1 (workerd, in memory) from wrangler's getPlatformProxy — worth it after a new migration. It is not the
// default: Node 24 on Windows dies at random (0xC0000409, no report) talking to workerd, up to every other run.
import { readdirSync, readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';

import worker from '../src/index';
import { signJwt } from '../src/jwt';
import { sqliteD1 } from './sqlite-d1';

// Public test values of `npm run dev:ext` (with TEST_D1=workerd, worker/.dev.vars is read but not used).
export const SECRET = 'ZGV2LXNlY3JldA==';
export const ENCRYPTION_KEY = 'ZGV2LXRva2VuLWtleS0wMTIzNDU2Nzg5YWJjZGVmMDE=';
export const OWNER_ID = '1';
export const CLIENT_ID = 'test-client';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export type Lot = { id: string; name: string; amount: number };
export type Outbound = {
  kind: 'twitch-config' | 'twitch-pubsub' | 'pointauc' | 'tmdb';
  url: string;
  body?: any;
  auth?: string;
  redirect?: RequestRedirect;
  /** Whether the call can time out. */
  signal?: boolean;
};
export type TmdbHandler = (url: URL) => Response | Promise<Response>;

/** TMDB by default knows every title for sure: one movie named exactly like the query, 500 votes. */
export const tmdbKnowsEverything: TmdbHandler = (url) => {
  if (/\/(movie|tv)\/\d+$/.test(url.pathname)) return Response.json({ id: Number(url.pathname.split('/').pop()), title: 'Film', vote_count: 5 });
  const query = url.searchParams.get('query') ?? '';
  return Response.json({
    results: [{ id: 1000 + query.length, media_type: 'movie', title: query, release_date: '2000-01-01', vote_count: 500, poster_path: '/p.jpg' }],
  });
};

export const startWorker = async () => {
  // persist: false — never the developer's seeded local DB; remoteBindings: false — never the production D1.
  const proxy =
    process.env.TEST_D1 === 'workerd'
      ? await getPlatformProxy<{ DB: D1Database }>({ configPath: 'wrangler.jsonc', persist: false, remoteBindings: false })
      : null;
  const db = proxy?.env.DB ?? sqliteD1();
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8').replace(/--.*$/gm, '');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const env = { DB: db, EXTENSION_SECRET: SECRET, CLIENT_ID, OWNER_ID, TMDB_API_KEY: 'test-tmdb-key', TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY };

  const outbound: Outbound[] = [];
  /** Lots Pointauc answers per token, or the whole answer; an unknown token gets 500 (Pointauc's closed tab). */
  const pointauc = new Map<string, Lot[] | (() => Response)>();
  const fake = { tmdb: tmdbKnowsEverything, twitchStatus: 204 };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'api.twitch.tv') {
      const body = JSON.parse(String(init?.body));
      const auth = (init?.headers as Record<string, string>).Authorization.replace('Bearer ', '');
      outbound.push({ kind: url.pathname.endsWith('/pubsub') ? 'twitch-pubsub' : 'twitch-config', url: url.href, body, auth });
      return new Response(fake.twitchStatus === 204 ? null : 'error', { status: fake.twitchStatus });
    }
    if (url.hostname === 'pointauc.com') {
      const auth = (init?.headers as Record<string, string>).Authorization.replace('Bearer ', '');
      outbound.push({ kind: 'pointauc', url: url.href, auth, signal: !!init?.signal });
      const lots = pointauc.get(auth);
      if (typeof lots === 'function') return lots();
      return lots ? Response.json({ lots: lots.map((lot) => ({ ...lot, investors: [] })) }) : new Response('nope', { status: 500 });
    }
    if (url.hostname === 'api.themoviedb.org') {
      outbound.push({ kind: 'tmdb', url: url.href, redirect: init?.redirect, signal: !!init?.signal });
      return fake.tmdb(url);
    }
    throw new Error(`Unexpected outbound fetch: ${url.href}`);
  });

  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => waits.push(promise), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

  const token = (channel: string, role = 'broadcaster', extra: object = {}) =>
    signJwt({ exp: Math.floor(Date.now() / 1000) + 3600, channel_id: channel, role, user_id: 'u1', ...extra }, SECRET);

  type CallOptions = { channel?: string; role?: string; body?: unknown; auth?: string | null };
  /** One request through the Worker; waits for its waitUntil work (the snapshot publish) before returning. */
  /**
   * Virtual time: every request and cron run starts a minute after the previous one, so the Worker's own pacing
   * (sync passes, snapshot publishes) never holds a test up. A test that needs requests close together sets
   * `clock.auto = false` and moves `clock.now` itself.
   */
  const clock = { now: Date.now(), auto: true };
  const realNow = Date.now;
  Date.now = () => clock.now;
  const tick = () => {
    if (clock.auto) clock.now += 60_000;
  };

  const call = async (method: string, path: string, { channel = 'c1', role = 'broadcaster', body, auth }: CallOptions = {}) => {
    tick();
    const start = outbound.length;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth === undefined) headers.Authorization = `Bearer ${await token(channel, role)}`;
    else if (auth !== null) headers.Authorization = auth;
    const response = await worker.fetch(
      new Request(`https://worker.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }) as any,
      env as any,
      ctx,
    );
    await Promise.allSettled(waits.splice(0));
    const text = await response.text();
    const out = outbound.slice(start);
    return {
      status: response.status,
      headers: response.headers,
      text,
      data: text ? JSON.parse(text) : null,
      out,
      /** Snapshots published to Twitch by this request (config segment PUTs). */
      published: out.filter((call) => call.kind === 'twitch-config').map((call) => JSON.parse(call.body.content)),
    };
  };

  const scheduled = async () => {
    tick();
    const start = outbound.length;
    await worker.scheduled({} as ScheduledController, env as any, ctx);
    await Promise.allSettled(waits.splice(0));
    return outbound.slice(start);
  };

  const all = async <T = any>(sql: string, ...params: unknown[]) => (await db.prepare(sql).bind(...params).all<T>()).results;
  /** Every row of every table, to prove a request changed nothing. */
  const dump = async () => ({
    lists: await all('SELECT * FROM lists ORDER BY id'),
    items: await all('SELECT * FROM items ORDER BY id'),
    pending: await all('SELECT * FROM pending_lots ORDER BY id'),
    channels: await all('SELECT * FROM channels ORDER BY channel_id'),
  });

  /** A list with items written straight to D1 (`position` in the given order, `watched_at` for watched ones). */
  const seedList = async (channel: string, kind: 'movies' | 'games' | 'custom', items: Partial<Record<string, unknown>>[] = []) => {
    const list = (await call('POST', '/api/lists', { channel, body: { title: `${channel} ${kind}`, kind } })).data;
    const ids: number[] = [];
    for (const [index, item] of items.entries()) {
      const row = { title: `Item ${index + 1}`, status: 'queue', position: index + 1, added_at: 1000, ...item };
      const columns = Object.keys(row);
      ids.push(
        (await db
          .prepare(`INSERT INTO items (list_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')}) RETURNING id`)
          .bind(list.id, ...Object.values(row))
          .first<number>('id'))!,
      );
    }
    return { list, ids };
  };

  /** Connects Pointauc (the token is checked against the fake) and switches the automatic sync on for a list. */
  const connectPointauc = async (channel: string, listId: number, pointaucToken: string, lots: Lot[] = []) => {
    pointauc.set(pointaucToken, lots);
    await call('PUT', '/api/pointauc/token', { channel, body: { token: pointaucToken } });
    return call('PUT', '/api/pointauc/sync', { channel, body: { list_id: listId } });
  };

  const dispose = async () => {
    Date.now = realNow;
    vi.unstubAllGlobals();
    await proxy?.dispose();
  };

  return { env, db, outbound, pointauc, fake, clock, token, call, scheduled, all, dump, seedList, connectPointauc, dispose };
};

export type TestWorker = Awaited<ReturnType<typeof startWorker>>;
