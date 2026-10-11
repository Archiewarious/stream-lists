// TMDB search results for the "add a movie" suggestions — shared with the extension, so no Workers-only APIs here.

export interface TmdbResult {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  type: 'movie' | 'tv';
  /** Title in the original language — a lot may be named the English way. */
  original_title: string | null;
  /** How many people rated it: junk entries with a movie-like name have none. */
  votes: number;
}

interface TmdbRawResult {
  original_title?: string;
  original_name?: string;
  vote_count?: number;
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

const MAX_RESULTS = 6;
// Same shape the items API accepts, so a picked suggestion always saves.
export const POSTER_PATH = /^\/[\w-]{1,64}\.(jpg|png)$/;

export const toTmdbResults = (data: { results?: TmdbRawResult[] }): TmdbResult[] =>
  (data.results ?? [])
    .filter((raw) => (raw.media_type === 'movie' || raw.media_type === 'tv') && Number.isInteger(raw.id))
    .map((raw) => ({
      tmdb_id: raw.id!,
      title: (raw.title ?? raw.name ?? '').trim(),
      year: Number.parseInt((raw.release_date ?? raw.first_air_date ?? '').slice(0, 4)) || null,
      poster_path: raw.poster_path && POSTER_PATH.test(raw.poster_path) ? raw.poster_path : null,
      type: raw.media_type as TmdbResult['type'],
      original_title: (raw.original_title ?? raw.original_name ?? '').trim() || null,
      votes: raw.vote_count ?? 0,
    }))
    .filter((result) => result.title)
    .slice(0, MAX_RESULTS);

/** What the viewer's details card shows. */
export interface MovieDetails {
  title: string;
  year: number | null;
  tagline: string | null;
  overview: string | null;
  genres: string[];
  /** Minutes (an episode for a show). */
  runtime: number | null;
  seasons: number | null;
  /** TMDB users' average, 0–10. */
  rating: number | null;
  votes: number;
  poster_path: string | null;
}

interface TmdbRawDetails {
  id?: number;
  title?: string;
  name?: string;
  tagline?: string;
  overview?: string;
  genres?: { name?: string }[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

export const toMovieDetails = (data: TmdbRawDetails, type: 'movie' | 'tv'): MovieDetails => ({
  title: (data.title ?? data.name ?? '').trim(),
  year: Number.parseInt((data.release_date ?? data.first_air_date ?? '').slice(0, 4)) || null,
  tagline: data.tagline?.trim() || null,
  overview: data.overview?.trim() || null,
  genres: (data.genres ?? []).map((genre) => genre.name ?? '').filter(Boolean),
  runtime: (type === 'movie' ? data.runtime : data.episode_run_time?.[0]) || null,
  seasons: type === 'tv' ? data.number_of_seasons || null : null,
  rating: data.vote_count ? Math.round((data.vote_average ?? 0) * 10) / 10 : null,
  votes: data.vote_count ?? 0,
  poster_path: data.poster_path && POSTER_PATH.test(data.poster_path) ? data.poster_path : null,
});

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const PAREN_YEAR = /^(.*?)\s*\((\d{4})\)\s*$/; // "Дюна (1984)"
const BARE_YEAR = /^(.+?)\s+(\d{4})$/; // "Интерстеллар 2014" — but "Бегущий по лезвию 2049" is a name

/** [name, year] readings of a title, most literal first. */
const readings = (title: string): [string, number | null][] => {
  const paren = title.match(PAREN_YEAR);
  if (paren) return [[paren[1], Number(paren[2])]];
  const bare = title.match(BARE_YEAR);
  return bare ? [[title, null], [bare[1], Number(bare[2])]] : [[title, null]];
};

/** What to type into the TMDB search for this title, in order (a trailing year may be part of the name or not). */
export const searchQueries = (title: string) => readings(title).map(([name]) => name.trim()).filter(Boolean);

/**
 * The search result that is certainly this title: the same name (ignoring case, punctuation, ё) in the shown
 * or the original language, and the same year if the title carries one. Otherwise null — no poster
 * is better than somebody else's.
 */
export const pickMatch = (title: string, results: TmdbResult[]): TmdbResult | null => {
  for (const [text, year] of readings(title)) {
    const name = normalize(text);
    if (!name) continue;
    const hit = results.find(
      (result) =>
        (normalize(result.title) === name || (!!result.original_title && normalize(result.original_title) === name)) &&
        (year === null || result.year === year),
    );
    if (hit) return hit;
  }
  return null;
};
