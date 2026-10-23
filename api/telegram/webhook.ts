import { apiErrorResponse, jsonResponse } from '../../lib/http';
import { getRedis } from '../../lib/redis';
import { withRedisLock } from '../../lib/redisLock';
import { processTelegramUpdate, type TelegramUpdate } from '../../lib/telegramBot';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (
    !webhookSecret ||
    req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret
  ) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const update = (await req.json()) as TelegramUpdate;
    let duplicate = false;

    if (typeof update.update_id === 'number') {
      const redis = getRedis();
      const doneKey = `telegram:update:done:${update.update_id}`;

      await withRedisLock(
        redis,
        `telegram:update:${update.update_id}`,
        async () => {
          if (await redis.get(doneKey)) {
            duplicate = true;

            return;
          }

          const result = await processTelegramUpdate(update, new URL(req.url).origin, {
            key: doneKey,
            ttlSeconds: 86_400,
          });

          if (!result.completionCommitted) {
            await redis.set(doneKey, 'done', { ex: 86_400 });
          }
        },
        { attempts: 3, ttlMs: 60_000 },
      );
    } else {
      await processTelegramUpdate(update, new URL(req.url).origin);
    }

    return jsonResponse({ ok: true, ...(duplicate ? { duplicate: true } : {}) });
  } catch (error) {
    return apiErrorResponse(error, 'Telegram webhook failed');
  }
}
