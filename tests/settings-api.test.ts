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
      eventCount: 2,
    });
    expect(body.wallpaperOptions.timeRanges).toContain('year');
    expect(body.wallpaperOptions.presentations).toContain('hybrid');
    expect(body.wallpaperOptions.presets).toHaveLength(7);
    expect(body.wallpaperOptions.presentations).not.toContain('agenda');
    expect(body.wallpaperOptions.presentations).not.toContain('minimal');
    expect(body.themes).toEqual([
      'default',
      'ocean',
      'sunset',
      'forest',
      'midnight',
      'frost',
      'espresso',
      'rosewood',
    ]);
    expect(body.themes).not.toContain('minimal');
    expect(body.wallpaperOptions.eventCounts).toEqual([1, 2, 3, 4, 5]);
  });

  it('updates arbitrary dimensions and accepts a shared preset', async () => {
    await seedLegacyUser();
    const { default: handler } = await import('../api/settings');
    const { getUser } = await import('../lib/tokenManager');

    const arbitrary = await handler(
      request('PATCH', {
        timeRange: 'year',
        presentation: 'hybrid',
        lockScreenProfile: 'large-clock',
        eventCount: 5,
      }),
    );

    expect(arbitrary.status).toBe(200);
    expect(await getUser('owner')).toMatchObject({
      timeRange: 'year',
      presentation: 'hybrid',
      lockScreenProfile: 'large-clock',
      eventCount: 5,
    });

    const preset = await handler(request('PATCH', { preset: 'hybrid' }));

    expect(preset.status).toBe(200);
    expect(await getUser('owner')).toMatchObject({
      timeRange: 'month',
      presentation: 'hybrid',
      lockScreenProfile: 'large-clock',
      eventCount: 5,
    });
  });

  it.each([0, 6, -1, 2.5, '3', null, [], {}])(
    'rejects invalid event count %j atomically',
    async (eventCount) => {
      await seedLegacyUser();
      const { default: handler } = await import('../api/settings');
      const { getUser } = await import('../lib/tokenManager');

      await handler(request('GET'));
      const before = await getUser('owner');
      const response = await handler(
        request('PATCH', { eventCount, theme: 'ocean', preset: 'year' }),
      );

      expect(response.status).toBe(400);
      expect(await getUser('owner')).toEqual(before);
    },
  );

  it('shares a dashboard count with Telegram and native wallpaper fetches', async () => {
    await seedLegacyUser();
    const raw = await redis.get<Record<string, unknown>>('user:owner');

    await redis.set('user:owner', {
      ...raw,
      events: Array.from({ length: 7 }, (_, index) => ({
        name: `Shared event ${index + 1}`,
        date: '2099-12-01',
      })),
    });
    const { default: handler } = await import('../api/settings');
    const { handleLinkedTelegramCommand } = await import('../lib/telegramBot');
    const { default: wallpaper } = await import('../api/wallpaper');

    expect((await handler(request('PATCH', { eventCount: 5 }))).status).toBe(200);
    await handleLinkedTelegramCommand('owner', '/view', ['year'], 'https://example.com');
    const settings = await (await handler(request('GET'))).json();
    const response = await wallpaper(
      new Request(`${settings.wallpaperUrl}&format=native&eventCount=1`),
    );
    const scene = await response.json();
    const values = scene.commands
      .filter((command: { kind: string }) => command.kind === 'text')
      .map((command: { value: string }) => command.value);

    expect(settings.eventCount).toBe(5);
    expect(response.status).toBe(200);
    expect(
      values.filter((value: string) => value.startsWith('Shared event')),
    ).toHaveLength(5);
    expect(values).toContain('+2 more');
    expect(scene.version).toBe(1);
    expect(Object.keys(scene).sort()).toEqual([
      'background',
      'commands',
      'height',
      'version',
      'width',
    ]);
  });

  it.each(['agenda', 'minimal'])(
    'rejects the retired %s view without changing preferences',
    async (retired) => {
      await seedLegacyUser();
      const { default: handler } = await import('../api/settings');
      const { getUser } = await import('../lib/tokenManager');

      await handler(request('GET'));
      const before = await getUser('owner');

      for (const field of ['preset', 'presentation']) {
        const response = await handler(request('PATCH', { [field]: retired }));

        expect(response.status).toBe(400);
        expect(await getUser('owner')).toEqual(before);
      }
    },
  );

  it('normalizes a saved retired theme and rejects selecting it again', async () => {
    await seedLegacyUser();
    const raw = await redis.get<Record<string, unknown>>('user:owner');

    await redis.set('user:owner', { ...raw, theme: 'minimal' });
    const { default: handler } = await import('../api/settings');
    const { getUser } = await import('../lib/tokenManager');

    const settings = await handler(request('GET'));
    const update = await handler(request('PATCH', { theme: 'minimal' }));

    expect((await settings.json()).theme).toBe('default');
    expect(update.status).toBe(400);
    expect((await getUser('owner'))?.theme).toBe('default');
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
