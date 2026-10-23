import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
let redis: InMemoryRedis;

describe('Telegram mutation idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not duplicate an add when the former outer done write would fail', async () => {
    await seedLinkedUser();
    const doneKey = 'telegram:update:done:501';

    redis.failDirectSetKeys.add(doneKey);

    const { default: handler } = await import('../api/telegram/webhook');
    const update = telegramUpdate(501, '/add 2026-11-01 Launch');

    expect((await handler(request(update))).status).toBe(200);
    expect((await handler(request(update))).status).toBe(200);

    const user = await redis.get<{ events: Array<{ name: string }> }>('user:owner');

    expect(user?.events.map(({ name }) => name)).toEqual(['Launch']);
    expect(await redis.get(doneKey)).toBe('done');
    expect(redis.directSetAttempts.get(doneKey)).toBeUndefined();
  });

  it('does not retarget a numbered delete when Telegram retries', async () => {
    await seedLinkedUser([
      manualEvent('first', 'First'),
      manualEvent('second', 'Second'),
    ]);
    const doneKey = 'telegram:update:done:502';

    redis.failDirectSetKeys.add(doneKey);

    const { default: handler } = await import('../api/telegram/webhook');
    const update = telegramUpdate(502, '/delete 1');

    expect((await handler(request(update))).status).toBe(200);
    expect((await handler(request(update))).status).toBe(200);

    const user = await redis.get<{ events: Array<{ id: string }> }>('user:owner');

    expect(user?.events.map(({ id }) => id)).toEqual(['second']);
    expect(await redis.get(doneKey)).toBe('done');
    expect(redis.directSetAttempts.get(doneKey)).toBeUndefined();
  });

  it('atomically completes account linking with the one-time code', async () => {
    await redis.set('user:owner', userRecord([]));
    await redis.set('telegram:link:single-use', 'owner');
    const doneKey = 'telegram:update:done:503';

    redis.failDirectSetKeys.add(doneKey);

    const { default: handler } = await import('../api/telegram/webhook');
    const update = telegramUpdate(503, '/start single-use');

    expect((await handler(request(update))).status).toBe(200);
    expect((await handler(request(update))).status).toBe(200);

    expect(await redis.get('telegram:link:single-use')).toBeNull();
    expect(await redis.get('telegram:user:42')).toBe('owner');
    expect(await redis.get(doneKey)).toBe('done');
  });
});

async function seedLinkedUser(events: unknown[] = []): Promise<void> {
  await redis.set('user:owner', {
    ...userRecord(events),
    telegram: {
      userId: '42',
      chatId: '42',
      linkedAt: '2026-10-23T00:00:00.000Z',
    },
  });
  await redis.set('telegram:user:42', 'owner');
}

function userRecord(events: unknown[]) {
  return {
    schemaVersion: 2,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    viewMode: 'quarter',
    timeZone: 'UTC',
    customThemes: [],
    events,
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
  };
}

function manualEvent(id: string, name: string) {
  return {
    id,
    name,
    date: '2026-11-01',
    source: 'manual',
    createdAt: '2026-10-23T00:00:00.000Z',
  };
}

function telegramUpdate(updateId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      text,
      chat: { id: 42, type: 'private' },
      from: { id: 42, username: 'ada' },
    },
  };
}

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
