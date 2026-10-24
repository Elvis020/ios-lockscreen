import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';
import {
  WALLPAPER_PRESET_IDS,
  LOCK_SCREEN_PROFILES,
  TIME_RANGES,
  PRESENTATIONS,
} from '../lib/preferences';
import { dateAtPeriodDay } from '../lib/periodCalculator';

let redis: InMemoryRedis;

describe('native wallpaper API', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    vi.resetModules();
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns public drawing data without PNG caching', async () => {
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request('https://example.com/api/wallpaper?view=quarter&format=native'),
    );
    const scene = await response.json();

    expect(response.status).toBe(200);
    expect(scene).toMatchObject({ version: 1, width: 1284, height: 2778 });
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('cdn-cache-control')).toBe('private, no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('uses saved settings and selected Google events without exposing account data', async () => {
    await seedUser();
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request(
        'https://example.com/api/wallpaper?format=native&wallpaperKey=read-only-test&view=week&theme=default',
      ),
    );
    const body = await response.text();
    const scene = JSON.parse(body);
    const text = scene.commands
      .filter((command: { kind: string }) => command.kind === 'text')
      .map((command: { value: string }) => command.value);

    expect(response.status).toBe(200);
    expect(scene.background).toBe('#172330');
    expect(
      scene.commands.filter(
        (command: { kind: string; diameter: number }) =>
          command.kind === 'circle' && command.diameter === 72,
      ),
    ).toHaveLength(92);
    expect(text).toContain('Manual milestone');
    expect(text).toContain('Google milestone');

    for (const privateValue of [
      'read-only-test',
      'private-owner-token',
      'private@example.com',
      'encrypted-test-refresh',
      'unselected-private-event',
      'private-chat-id',
    ]) {
      expect(body).not.toContain(privateValue);
    }

    expect(Object.keys(scene).sort()).toEqual([
      'background',
      'commands',
      'height',
      'version',
      'width',
    ]);
  });

  it('does not fall back to public data for an invalid key', async () => {
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request('https://example.com/api/wallpaper?format=native&wallpaperKey=invalid'),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid wallpaper credential' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('honors a saved native Year view instead of contradictory public query settings', async () => {
    await seedUser({
      timeRange: 'year',
      presentation: 'progress',
      lockScreenProfile: 'large-clock',
    });
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request(
        'https://example.com/api/wallpaper?format=native&wallpaperKey=read-only-test&view=quarter&profile=standard',
      ),
    );
    const body = await response.text();
    const scene = JSON.parse(body);

    expect(response.status).toBe(200);
    expect(
      scene.commands.filter(
        (command: { kind: string; diameter: number }) =>
          command.kind === 'circle' && command.diameter === 32,
      ),
    ).toHaveLength(365);
    expect(body).not.toContain('January');
    expect(body).not.toContain('December');
    expect(body).not.toContain('private-owner-token');
    expect(body).not.toContain('read-only-test');
    expect(response.headers.get('cache-control')).toContain('private, no-store');
  });

  it('does not treat an explicitly empty wallpaper key as a public request', async () => {
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request('https://example.com/api/wallpaper?format=native&wallpaperKey='),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid wallpaper credential' });
  });

  it('requires a read-only key instead of the legacy management credential', async () => {
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request(
        'https://example.com/api/wallpaper?format=native&token=private-owner-token',
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-owner-token');
  });

  it.each(['token=', 'token=private-owner-token'])(
    'rejects mixed credentials even with a valid wallpaper key (%s)',
    async (legacyQuery) => {
      await seedUser();
      const { default: handler } = await import('../api/wallpaper');
      const response = await handler(
        new Request(
          `https://example.com/api/wallpaper?format=native&wallpaperKey=read-only-test&${legacyQuery}`,
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('private-owner-token');
    },
  );

  it('supports every exposed preset and all configurable native layouts without caching', async () => {
    const { default: handler } = await import('../api/wallpaper');

    for (const profile of LOCK_SCREEN_PROFILES) {
      const queries = [
        ...WALLPAPER_PRESET_IDS.map((view) => new URLSearchParams({ view, profile })),
        ...TIME_RANGES.flatMap((range) =>
          PRESENTATIONS.map(
            (presentation) => new URLSearchParams({ range, presentation, profile }),
          ),
        ),
      ];

      for (const query of queries) {
        query.set('format', 'native');
        const response = await handler(
          new Request(`https://example.com/api/wallpaper?${query}`),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          version: 1,
          width: 1284,
          height: 2778,
        });
        expect(response.headers.get('cache-control')).toBe(
          'private, no-store, max-age=0',
        );
      }
    }
  });

  it('returns a bounded non-cacheable error for an oversized public scene', async () => {
    vi.setSystemTime(new Date('2028-01-01T12:00:00Z'));
    const { default: handler } = await import('../api/wallpaper');
    const events = Array.from(
      { length: 366 },
      (_, index) => `Event${index}:${dateAtPeriodDay('2028-01-01', index + 1)}`,
    ).join(',');
    const query = new URLSearchParams({ view: 'year', format: 'native', events });
    const response = await handler(
      new Request(`https://example.com/api/wallpaper?${query}`),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'native_scene_too_large' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects non-GET native requests before reading storage', async () => {
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request('https://example.com/api/wallpaper?format=native', { method: 'POST' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('keeps failed storage responses generic and non-cacheable', async () => {
    vi.doMock('../lib/redis', () => ({
      getRedis: () => {
        throw new Error('private-upstream-error');
      },
      isRedisConfigurationError: () => true,
    }));
    const { default: handler } = await import('../api/wallpaper');
    const response = await handler(
      new Request('https://example.com/api/wallpaper?format=native&wallpaperKey=invalid'),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-upstream-error');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});

async function seedUser(selection: Record<string, string> = {}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await redis.set('wallpaper:read-only-test', 'private-owner-token');
  await redis.set('user:private-owner-token', {
    schemaVersion: 3,
    token: 'private-owner-token',
    wallpaperKey: 'read-only-test',
    name: 'Private account',
    theme: 'ocean',
    timeRange: 'quarter',
    presentation: 'calendar',
    lockScreenProfile: 'standard',
    timeZone: 'UTC',
    customThemes: [],
    events: [
      {
        id: 'manual',
        name: 'Manual milestone',
        date: today,
        source: 'manual',
        createdAt: today,
      },
    ],
    googleAccounts: [
      {
        id: 'google',
        email: 'private@example.com',
        encryptedRefreshToken: 'encrypted-test-refresh',
        connectedAt: today,
      },
    ],
    selectedEventIds: ['selected'],
    cachedCalEvents: [
      {
        id: 'selected',
        name: 'Google milestone',
        date: today,
        accountEmail: 'private@example.com',
      },
      {
        id: 'unselected',
        name: 'unselected-private-event',
        date: today,
        accountEmail: 'private@example.com',
      },
    ],
    cachedCalAt: Date.now(),
    telegram: { chatId: 'private-chat-id', linkedAt: today },
    ...selection,
  });
}
