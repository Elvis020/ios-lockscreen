import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

let redis: InMemoryRedis;

describe('settings API', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  it('returns normalized wallpaper settings and shared option metadata', async () => {
    await seedLegacyUser();
    const { default: handler } = await import('../api/settings');
    const response = await handler(request('GET'));
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      timeRange: 'month',
      presentation: 'calendar',
      lockScreenProfile: 'standard',
      viewMode: 'month',
    });
    expect(body.wallpaperOptions.timeRanges).toContain('year');
    expect(body.wallpaperOptions.presentations).toContain('hybrid');
    expect(body.wallpaperOptions.presets).toHaveLength(9);
  });

  it('updates arbitrary dimensions and accepts a shared preset', async () => {
    await seedLegacyUser();
    const { default: handler } = await import('../api/settings');
    const { getUser } = await import('../lib/tokenManager');

    const arbitrary = await handler(
      request('PATCH', {
        timeRange: 'year',
        presentation: 'agenda',
        lockScreenProfile: 'large-clock',
      }),
    );

    expect(arbitrary.status).toBe(200);
    expect(await getUser('owner')).toMatchObject({
      timeRange: 'year',
      presentation: 'agenda',
      lockScreenProfile: 'large-clock',
    });

    const preset = await handler(request('PATCH', { preset: 'hybrid' }));

    expect(preset.status).toBe(200);
    expect(await getUser('owner')).toMatchObject({
      timeRange: 'month',
      presentation: 'hybrid',
      lockScreenProfile: 'large-clock',
    });
  });
});

async function seedLegacyUser(): Promise<void> {
  await redis.set('user:owner', {
    schemaVersion: 2,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    viewMode: 'month',
    timeZone: 'UTC',
    customThemes: [],
    events: [],
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
  });
}

function request(method: string, body?: Record<string, unknown>): Request {
  return new Request('https://example.com/api/settings', {
    method,
    headers: {
      Authorization: 'Bearer owner',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
