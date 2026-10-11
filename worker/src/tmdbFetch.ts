// TMDB requests from the Worker (the key stays here; the browser only sees the results).

import { MAX_TMDB_LOOKUPS, OUTSIDE_TIMEOUT_MS, SUBREQUEST_LIMIT, type Env } from './config';
import { HttpError } from './http';
import type { ItemRow, ListRow } from './snapshot';
import { pickMatch, searchQueries, toTmdbResults, type TmdbResult } from './tmdb';

/** Movies and shows; `language` like "ru-RU". Accepts a v3 API key or a v4 read access token (JWT, "eyJ…"). */
export const tmdbRequest = async (path: string, params: Record<string, string>, apiKey: string) => {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = {};
  if (apiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${apiKey}`;
  else url.searchParams.set('api_key', apiKey);

  // Same request → same answer for a day; saves TMDB requests (typing, many viewers opening one film).
  // The URL may carry the key, so neither a redirect nor a fetch error (whose text may quote it) goes anywhere.
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(OUTSIDE_TIMEOUT_MS),
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
  } catch {
    throw new HttpError(502, 'TMDB request failed');
  }
  if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 502, `TMDB ${response.status}`);
  return response.json<any>(); // shaped by toTmdbResults / toMovieDetails, which drop everything unexpected
};

export const searchTmdb = async (query: string, language: string, apiKey: string) =>
  toTmdbResults(await tmdbRequest('search/multi', { query, language, include_adult: 'false' }, apiKey));

export type TmdbFields = Pick<ItemRow, 'tmdb_id' | 'year' | 'poster_path' | 'tmdb_type'>;

/** Subrequests to the outside this invocation may still make (see SUBREQUEST_LIMIT). */
export type Budget = { left: number };
/** For a request: the rest after Pointauc and the snapshot publish. */
export const requestBudget = (): Budget => ({ left: SUBREQUEST_LIMIT - 3 });

/**
 * Poster, year and TMDB id for the titles TMDB knows for sure (`found`). The rest were looked up and not found,
 * or the lookup `failed` (TMDB down or rate-limited — worth another try), or were `unchecked`: past
 * MAX_TMDB_LOOKUPS titles or past the subrequest `budget` (each search takes one).
 */
export const matchTitles = async (env: Env, titles: string[], budget: Budget, minVotes = 0) => {
  const found = new Map<string, TmdbFields>();
  const failed = new Set<string>();
  const unchecked = titles.slice(MAX_TMDB_LOOKUPS);
  const apiKey = env.TMDB_API_KEY;
  if (!apiKey) return { found, failed, unchecked: titles };
  await Promise.all(
    titles.slice(0, MAX_TMDB_LOOKUPS).map(async (title) => {
      try {
        let match: TmdbResult | null = null;
        for (const query of searchQueries(title)) {
          if (budget.left < 1) return unchecked.push(title);
          budget.left -= 1;
          match = pickMatch(title, await searchTmdb(query.slice(0, 100), 'ru-RU', apiKey));
          if (match) break;
        }
        if (match && match.votes >= minVotes) {
          found.set(title, { tmdb_id: match.tmdb_id, year: match.year, poster_path: match.poster_path, tmdb_type: match.type });
        }
      } catch (error) {
        failed.add(title);
        console.error('TMDB lookup failed', error); // not the title: viewers write lot names
      }
    }),
  );
  return { found, failed, unchecked };
};

/** A movie title typed without picking a suggestion (no tmdb_id in the body): what TMDB knows about it for sure. */
export const lookUpTyped = async (env: Env, list: ListRow, title: string, body: Record<string, unknown>) =>
  list.kind === 'movies' && !('tmdb_id' in body) ? (await matchTitles(env, [title], requestBudget())).found.get(title) : undefined;
