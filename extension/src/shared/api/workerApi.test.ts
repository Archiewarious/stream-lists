import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initI18n } from '@assets/i18n/initI18n';

// workerApi talks to Twitch through the dev imitation outside an iframe: a window that is its own top, test token.
const page = { location: { search: '?language=ru' } } as Record<string, unknown>;
page.self = page;
page.top = page;
vi.stubGlobal('window', page);
vi.stubGlobal('navigator', { language: 'ru' });
vi.stubGlobal('document', { documentElement: {} });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });

const { callWorker, WorkerError } = await import('./workerApi');

const answer = (body: string, status = 200) => vi.fn(async () => new Response(body, { status }));
/** The error a call ends with. */
const failure = (method: string, path: string) =>
  callWorker(method, path).then(
    () => Promise.reject(new Error('resolved')),
    (error: InstanceType<typeof WorkerError>) => error,
  );

beforeAll(() => initI18n());
afterAll(() => vi.unstubAllGlobals());

describe('callWorker', () => {
  it('sends the Twitch token and returns the JSON', async () => {
    const fetch = answer('{"ok":true}');
    vi.stubGlobal('fetch', fetch);
    expect(await callWorker('GET', '/api/channel')).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/api/channel');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer \S+\.\S+\.\S+$/);
    expect(init.signal).toBeInstanceOf(AbortSignal); // a request that hangs ends
  });

  it("turns the Worker's errors into texts for the streamer, keeping the reason", async () => {
    vi.stubGlobal('fetch', answer('{"error":"At most 2000 items"}', 409));
    const error = await failure('POST', '/api/items');
    expect(error).toBeInstanceOf(WorkerError);
    expect([error.message, error.status, error.reason]).toEqual(['В списке может быть не больше 2000 элементов', 409, 'At most 2000 items']);

    vi.stubGlobal('fetch', answer('{"error":"Pointauc 500"}', 502));
    expect((await failure('GET', '/api/pointauc/lots')).message).toMatch(/^Pointauc не ответил/);
    vi.stubGlobal('fetch', answer('oops', 500));
    expect((await failure('GET', '/x')).message).toBe('Ошибка на сервере (500)');
  });

  it('does not take a page without JSON for an answer', async () => {
    vi.stubGlobal('fetch', answer('<html>proxy</html>'));
    expect((await failure('GET', '/api/movie/1')).message).toBe('Сервер ответил что-то непонятное');
  });

  it('says so when the server cannot be reached or does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect((await failure('GET', '/x')).message).toBe('Нет связи с сервером');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('slow', 'TimeoutError'))));
    expect((await failure('GET', '/x')).message).toBe('Сервер не ответил вовремя');
  });
});
