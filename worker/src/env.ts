// The Worker's bindings and secrets (wrangler.jsonc, .dev.vars, `wrangler secret put`).

export interface Env {
  DB: D1Database;
  EXTENSION_SECRET: string;
  /** The secret before a rotation, accepted until every viewer has a token signed with the new one. */
  EXTENSION_SECRET_PREVIOUS?: string;
  CLIENT_ID: string;
  OWNER_ID: string;
  TMDB_API_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}
