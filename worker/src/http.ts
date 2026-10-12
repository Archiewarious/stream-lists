// HTTP plumbing and the checks every request body goes through.

import { ITEM_STATUSES, MAX_QUERY_LENGTH, TMDB_TYPES } from './config';
import type { ItemRow } from './snapshot';
import { POSTER_PATH } from './tmdb';

// The token travels in a header, not a cookie, so any origin is fine.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS_HEADERS });

export const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  return body as Record<string, unknown>;
};

export const readTitle = (value: unknown, maxLength: number) => {
  // Control characters are dropped: JSON escapes each as 6 bytes and could push the snapshot past 5 KB.
  const title = typeof value === 'string' ? value.replace(/\p{Cc}/gu, '').trim() : '';
  if (!title || title.length > maxLength) throw new HttpError(400, `Title must be 1–${maxLength} characters`);
  return title;
};

/** The search text in `?q=`. */
export const readQuery = (params: URLSearchParams) => {
  const query = params.get('q')?.trim() ?? '';
  if (!query || query.length > MAX_QUERY_LENGTH) throw new HttpError(400, `q must be 1–${MAX_QUERY_LENGTH} characters`);
  return query;
};

/** TMDB's language for the panel's `?lang=`. */
export const tmdbLanguage = (params: URLSearchParams) => (params.get('lang') === 'ru' ? 'ru-RU' : 'en-US');

export const readEnum = <T extends string>(value: unknown, allowed: string[], field: string) => {
  if (!allowed.includes(value as string)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value as T;
};

/** An item status; none given means the queue. */
export const readStatus = (value: unknown) => (value === undefined ? 'queue' : readEnum<ItemRow['status']>(value, ITEM_STATUSES, 'status'));

export const readOptionalInt = (value: unknown, field: string, min: number, max: number) => {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new HttpError(400, `${field} must be an integer ${min}–${max}`);
  }
  return value as number;
};

// TMDB poster path, rendered as an image URL on the panel — so only the TMDB shape is accepted.
const readPosterPath = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !POSTER_PATH.test(value)) throw new HttpError(400, 'Invalid poster_path');
  return value;
};

/** Optional movie details (filled from TMDB). Only keys present in the body are returned. */
export const readMovieFields = (body: Record<string, unknown>) => {
  const fields: Partial<Pick<ItemRow, 'year' | 'tmdb_id' | 'poster_path' | 'tmdb_type'>> = {};
  if ('tmdb_type' in body) {
    fields.tmdb_type = body.tmdb_type === null ? null : readEnum<'movie' | 'tv'>(body.tmdb_type, TMDB_TYPES, 'tmdb_type');
  }
  if ('year' in body) fields.year = readOptionalInt(body.year, 'year', 1870, 2100);
  if ('tmdb_id' in body) fields.tmdb_id = readOptionalInt(body.tmdb_id, 'tmdb_id', 1, 2 ** 31);
  if ('poster_path' in body) fields.poster_path = readPosterPath(body.poster_path);
  return fields;
};
