// TMDB search results for the "add a movie" suggestions — shared with the extension, so no Workers-only APIs here.

export interface TmdbResult {
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  type: 'movie' | 'tv';
}

interface TmdbRawResult {
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
    }))
    .filter((result) => result.title)
    .slice(0, MAX_RESULTS);
