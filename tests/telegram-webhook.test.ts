import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
let redis: InMemoryRedis;
let processUpdate: ReturnType<typeof vi.fn>;

describe('Telegram webhook delivery state', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    processUpdate = vi.fn();
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
    vi.doMock('../lib/telegramBot', () => ({
      processTelegramUpdate: processUpdate,
    }));
  });

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
    } else {
      process.env.TELEGRAM_WEBHOOK_SECRET = originalWebhookSecret;
    }

    vi.restoreAllMocks();
  });

  it('marks done only after success so a failed update can retry', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: handler } = await import('../api/telegram/webhook');
    const update = {
      update_id: 123,
      message: {
        text: '/status',
        chat: { id: 42, type: 'private' },
        from: { id: 42 },
      },
    };

    processUpdate.mockRejectedValueOnce(new Error('temporary Redis failure'));

    const failed = await handler(request(update));

    expect(failed.status).toBe(500);
    expect(await redis.get('telegram:update:done:123')).toBeNull();
    expect(await redis.get('lock:telegram:update:123')).toBeNull();

    processUpdate.mockResolvedValueOnce({ completionCommitted: false });

    const retried = await handler(request(update));

    expect(retried.status).toBe(200);
    expect(await redis.get('telegram:update:done:123')).toBe('done');
    expect(processUpdate).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

function request(update: unknown): Request {
  return new Request('https://example.com/api/telegram/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret',
    },
    body: JSON.stringify(update),
  });
}
