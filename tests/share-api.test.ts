import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
const shareKey = '11111111-1111-4111-8111-111111111111';
let redis: InMemoryRedis;

describe('shared countdown endpoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'));
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the next recurrence using civil calendar days and escapes the name', async () => {
    await seedShare({
      id: 'manual',
      name: '<Trip & friends>',
      date: '2026-01-31',
      source: 'manual',
      createdAt: '2026-01-01T00:00:00.000Z',
      category: 'travel',
      recurrence: 'monthly',
    });
    const { default: handler } = await import('../api/share');
    const response = await handler(request());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(html).toContain('&lt;Trip &amp; friends&gt;');
    expect(html).toContain('58 days');
    expect(html).toContain('2026-03-31');
  });

  it('expires a selected Google countdown after its date passes', async () => {
    await seedShare({
      id: 'google',
      name: 'Old appointment',
      date: '2026-01-31',
      accountEmail: 'ada@example.com',
    });
    const user = await redis.get<Record<string, unknown>>('user:owner');

    await redis.set('user:owner', {
      ...user,
      events: [],
      selectedEventIds: ['google'],
      cachedCalEvents: [
        {
          id: 'google',
          name: 'Old appointment',
          date: '2026-01-31',
          accountEmail: 'ada@example.com',
        },
      ],
    });
    const { default: handler } = await import('../api/share');
    const response = await handler(request());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });

  it('uses a generic 404 for invalid methods and missing bearer keys', async () => {
    const { default: handler } = await import('../api/share');

    expect((await handler(new Request('https://example.com/api/share'))).status).toBe(
      404,
    );
    expect((await handler(request('POST'))).status).toBe(404);
  });
});

async function seedShare(event: Record<string, unknown>): Promise<void> {
  await redis.set('user:owner', {
    schemaVersion: 5,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    timeRange: 'quarter',
    presentation: 'calendar',
    lockScreenProfile: 'standard',
    eventCount: 2,
    timeZone: 'UTC',
    customThemes: [],
    events: event.source === 'manual' ? [event] : [],
    googleAccounts: [],
    selectedEventIds: event.source === 'manual' ? [] : [event.id],
    cachedCalEvents: event.source === 'manual' ? [] : [event],
    cachedCalAt: 0,
    sharedCountdowns: [
      {
        id: 'share-id',
        eventId: event.id,
        key: shareKey,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  await redis.set(`share:${shareKey}`, { token: 'owner', shareId: 'share-id' });
}

function request(method = 'GET'): Request {
  return new Request(`https://example.com/api/share?key=${shareKey}`, { method });
}
