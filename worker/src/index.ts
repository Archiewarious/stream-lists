// Stream Lists Worker: the extension's API (routes.ts), snapshots for viewers (publish.ts) and the automatic
// Pointauc sync (sync.ts, cron once a minute).

import type { Env } from './config';
import { CORS_HEADERS, HttpError, json } from './http';
import { verifyJwt } from './jwt';
import { publishSnapshot } from './publish';
import { routes } from './routes';
import { runAutoSync } from './sync';

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runAutoSync(env));
  },

  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      const secrets = [env.EXTENSION_SECRET, env.EXTENSION_SECRET_PREVIOUS].filter((secret): secret is string => !!secret);
      const claims = await verifyJwt(token, secrets);
      if (!claims) throw new HttpError(401, 'Invalid Twitch token');

      const { pathname } = new URL(request.url);
      const route = routes[`${request.method} ${pathname.replace(/\/\d+(?=\/|$)/, '/:id')}`];
      const id = Number(pathname.match(/\/(\d+)(?=\/|$)/)?.[1]);
      if (!route?.viewer && claims.role !== 'broadcaster') throw new HttpError(403, 'Only the broadcaster can edit lists');
      if (!route) throw new HttpError(404, 'Not found');

      const data = await route.handle({ request, env, db: env.DB, channelId: claims.channel_id, id, now: Date.now() });
      const publishes = typeof route.publishes === 'function' ? route.publishes(data) : route.publishes;
      if (publishes) {
        // The lists changed: the next sync pass looks at them again even if Pointauc answers the same lots.
        await env.DB.prepare('UPDATE channels SET pointauc_lots_hash = NULL WHERE channel_id = ? AND pointauc_lots_hash IS NOT NULL').bind(claims.channel_id).run();
        ctx.waitUntil(publishSnapshot(env, claims.channel_id));
      }
      return json(data);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: 'Internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
