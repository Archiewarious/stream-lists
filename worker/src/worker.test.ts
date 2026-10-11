import { describe, expect, it } from 'vitest';

import { signJwt, verifyJwt } from './jwt';
import { buildSnapshot, getByteSize, SNAPSHOT_LIMIT_BYTES, type ChannelList, type ItemRow } from './snapshot';
import { decryptText, encryptText } from './crypto';
import { matchLots, planLotSync, toPointaucLots } from './pointauc';
import { parseTheme } from './theme';
import { pickMatch, searchQueries, toTmdbResults, type TmdbResult } from './tmdb';

const secret = btoa('test-extension-secret-0123456789');
const exp = Math.floor(Date.now() / 1000) + 60;
const claims = { exp, channel_id: '123', role: 'broadcaster', opaque_user_id: 'U123' };

describe('verifyJwt', () => {
  it('accepts a token signed with the extension secret', async () => {
    expect(await verifyJwt(await signJwt(claims, secret), secret)).toEqual(claims);
  });

  it('rejects a wrong secret, a forged payload, expiry, alg none and garbage', async () => {
    const token = await signJwt(claims, secret);
    const [header, , signature] = token.split('.');
    const forgedPayload = btoa(JSON.stringify({ ...claims, channel_id: '999' })).replace(/=+$/, '');
    const noneHeader = btoa(JSON.stringify({ alg: 'none' })).replace(/=+$/, '');

    expect(await verifyJwt(token, btoa('another-secret'))).toBeNull();
    expect(await verifyJwt(`${header}.${forgedPayload}.${signature}`, secret)).toBeNull();
    expect(await verifyJwt(token, secret, (exp + 1) * 1000)).toBeNull();
    expect(await verifyJwt(`${noneHeader}.${token.split('.')[1]}.`, secret)).toBeNull();
    expect(await verifyJwt('not.a.jwt!', secret)).toBeNull();
    expect(await verifyJwt('', secret)).toBeNull();
  });
});

describe('buildSnapshot', () => {
  const makeItem = (id: number, status: ItemRow['status']): ItemRow => ({
    id,
    list_id: 1,
    title: `Очень длинное русское название фильма номер ${id}`,
    year: 2000 + (id % 25),
    poster_path: `/poster${id}abcdefghijklmnopqrstuv.jpg`,
    tmdb_id: id,
    status,
    position: id,
    added_at: 0,
    watched_at: status === 'watched' ? 1_700_000_000_000 - id : null,
    source: 'manual',
    points: null,
    lot_id: null,
    rating: null,
    tmdb_type: null,
  });
  const list = (items: ItemRow[]): ChannelList => ({ id: 1, channel_id: '123', title: 'Фильмы', kind: 'movies', created_at: 0, items });

  it('keeps a small list whole and in order', () => {
    const snapshot = JSON.parse(buildSnapshot([list([makeItem(1, 'queue'), makeItem(2, 'queue'), makeItem(3, 'watched')])]));
    expect(snapshot.lists[0]).toMatchObject({ qn: 2, wn: 1, q: [{ i: 1 }, { i: 2 }], w: [{ i: 3, d: 1_700_000_000_000 - 3 }] });
    expect(snapshot.lists[0].q[0].d).toBeUndefined();
  });

  it('trims 60+ long titles to fit 5 KB but keeps the counts', () => {
    const items = Array.from({ length: 80 }, (_, index) => makeItem(index + 1, index < 40 ? 'queue' : 'watched'));
    const content = buildSnapshot([list(items)]);
    const snapshot = JSON.parse(content);

    expect(getByteSize(content)).toBeLessThanOrEqual(SNAPSHOT_LIMIT_BYTES);
    expect(snapshot.lists[0]).toMatchObject({ qn: 40, wn: 40 });
    expect(snapshot.lists[0].q.length).toBeGreaterThan(0);
    expect(snapshot.lists[0].q[0].i).toBe(1);
  });
});

describe('toTmdbResults', () => {
  it('keeps movies and shows, takes the year from either date, drops odd poster paths', () => {
    const results = toTmdbResults({
      results: [
        { id: 693134, media_type: 'movie', title: 'Дюна: Часть вторая', release_date: '2024-02-27', poster_path: '/abc.jpg' },
        { id: 94605, media_type: 'tv', name: 'Аркейн', first_air_date: '2021-11-06', poster_path: '/../evil.jpg' },
        { id: 1, media_type: 'person', name: 'Тимоти Шаламе' },
        { id: 2, media_type: 'movie', title: 'Без даты', release_date: '' },
      ],
    });
    expect(results).toEqual([
      { tmdb_id: 693134, title: 'Дюна: Часть вторая', year: 2024, poster_path: '/abc.jpg', type: 'movie', original_title: null },
      { tmdb_id: 94605, title: 'Аркейн', year: 2021, poster_path: null, type: 'tv', original_title: null },
      { tmdb_id: 2, title: 'Без даты', year: null, poster_path: null, type: 'movie', original_title: null },
    ]);
  });
});

describe('parseTheme', () => {
  it('accepts a preset or two hex colors, nothing else', () => {
    expect(parseTheme({ preset: 'mint' })).toEqual({ preset: 'mint' });
    expect(parseTheme({ primary: '#C650F4', accent: '#ff7ac1' })).toEqual({ primary: '#c650f4', accent: '#ff7ac1' });
    expect(parseTheme({ preset: 'neon' })).toBeNull();
    expect(parseTheme({ primary: 'red', accent: '#ff7ac1' })).toBeNull();
    expect(parseTheme({ primary: '#c650f4', accent: 'url(javascript:1)' })).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });
});

describe('Pointauc', () => {
  it('reads lots and matches them to the list by title', () => {
    const lots = toPointaucLots({
      lots: [
        { fastId: 1, id: 'a', name: ' Матрица ', amount: 540, investors: [] },
        { fastId: 2, id: 'b', name: 'Терминатор 2', amount: 760 },
        { fastId: 3, id: 'c', name: 'Бегущий по лезвию 2049', amount: 1250 },
        { id: 'd', amount: 10 }, // no name — skipped
        { fastId: 4, id: 'e', name: 'Без ставок', amount: null }, // a lot nobody bid on yet
      ],
    });
    const items = [
      { title: 'Интерстеллар', status: 'queue' as const, watched_at: null },
      { title: 'бегущий по лезвию 2049', status: 'queue' as const, watched_at: null },
      { title: 'Матрица', status: 'watched' as const, watched_at: 1789689600000 },
    ];
    expect(matchLots(lots, items)).toEqual([
      { id: 'c', name: 'Бегущий по лезвию 2049', amount: 1250, status: 'queue', position: 2 },
      { id: 'b', name: 'Терминатор 2', amount: 760, status: 'new' },
      { id: 'a', name: 'Матрица', amount: 540, status: 'watched', watched_at: 1789689600000 },
      { id: 'e', name: 'Без ставок', amount: 0, status: 'new' },
    ]);
    expect(toPointaucLots({ error: 'no tab' })).toEqual([]);
    expect(toPointaucLots([{ id: 'x', name: 'old array shape' }])).toEqual([]);
  });

  it('encrypts the token so only the key opens it', async () => {
    const key = btoa('k'.repeat(32));
    const stored = await encryptText('pointauc-token', key);
    expect(stored).not.toContain('pointauc-token');
    expect(await decryptText(stored, key)).toBe('pointauc-token');
    await expect(decryptText(stored, btoa('x'.repeat(32)))).rejects.toThrow();
  });
});

describe('pickMatch', () => {
  const result = (title: string, year: number | null, original: string | null = null): TmdbResult => ({
    tmdb_id: 1,
    title,
    year,
    poster_path: '/p.jpg',
    type: 'movie',
    original_title: original,
  });

  it('takes only a certain match: same name ignoring case, punctuation and ё', () => {
    expect(pickMatch('матрица', [result('Матрица: Перезагрузка', 2003), result('Матрица', 1999)])?.year).toBe(1999);
    expect(pickMatch('Зелёная миля', [result('Зеленая миля', 1999)])?.year).toBe(1999);
    expect(pickMatch('Матрица 2', [result('Матрица: Перезагрузка', 2003)])).toBeNull();
    expect(pickMatch('хуй пизда', [result('Пизда', 2010)])).toBeNull();
    expect(pickMatch('', [result('', null)])).toBeNull();
  });

  it('knows the original title and a year in brackets', () => {
    expect(pickMatch('Interstellar', [result('Интерстеллар', 2014, 'Interstellar')])?.year).toBe(2014);
    expect(pickMatch('Дюна (1984)', [result('Дюна', 2021), result('Дюна', 1984)])?.year).toBe(1984);
  });

  it('reads a bare trailing year, but a year that is part of the name wins', () => {
    expect(pickMatch('Интерстеллар 2014', [result('Интерстеллар', 2014)])?.year).toBe(2014);
    expect(pickMatch('Интерстеллар 2019', [result('Интерстеллар', 2014)])).toBeNull();
    expect(pickMatch('Бегущий по лезвию 2049', [result('Бегущий по лезвию', 1982), result('Бегущий по лезвию 2049', 2017)])?.year).toBe(2017);
    expect(searchQueries('Интерстеллар 2014')).toEqual(['Интерстеллар 2014', 'Интерстеллар']);
    expect(searchQueries('Дюна (1984)')).toEqual(['Дюна']);
    expect(searchQueries('Матрица')).toEqual(['Матрица']);
  });
});

describe('planLotSync', () => {
  const lots = [
    { id: 'a', name: 'Матрица', amount: 540 },
    { id: 'b', name: 'Терминатор 2', amount: 760 },
    { id: 'c', name: 'терминатор 2', amount: 10 }, // the same title again
    { id: 'd', name: 'Чужой', amount: 0 },
  ];
  const items = [
    { id: 7, title: 'Матрица', points: null, lot_id: null },
    { id: 8, title: 'Чужой', points: 0, lot_id: 'd' },
  ];

  it('refreshes bids of known titles and adds only the chosen new lots, each title once', () => {
    const plan = planLotSync(lots, items, new Set(['b', 'c']));
    expect(plan.toUpdate).toEqual([{ id: 7, points: 540, lot_id: 'a' }]);
    expect(plan.toAdd.map((lot) => lot.id)).toEqual(['b']);
  });

  it('adds nothing without chosen ids', () => {
    expect(planLotSync(lots, items, null).toAdd).toEqual([]);
  });
});
