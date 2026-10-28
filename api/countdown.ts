import { buildCountdown } from '../lib/countdown';
import { isRedisConfigurationError } from '../lib/redis';
import { getUserByWallpaperKey } from '../lib/tokenManager';

export const config = { runtime: 'edge' };

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'CDN-Cache-Control': 'private, no-store',
      'Vercel-CDN-Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET')
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });

  const url = new URL(req.url);

  if (url.searchParams.has('token')) return json({ error: 'invalid_request' }, 400);
  const keys = url.searchParams.getAll('wallpaperKey');

  if (
    keys.length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keys[0])
  ) {
    return json({ error: 'invalid_credential' }, 401);
  }

  try {
    const user = await getUserByWallpaperKey(keys[0]);

    return user ? json(buildCountdown(user)) : json({ error: 'invalid_credential' }, 401);
  } catch (error) {
    return json({ error: 'unavailable' }, isRedisConfigurationError(error) ? 503 : 500);
  }
}
