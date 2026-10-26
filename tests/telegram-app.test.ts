import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserData } from '../lib/userSchema';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
let redis: InMemoryRedis;

describe('Telegram control panel', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
    delete process.env.PUBLIC_SHORTCUT_INSTALL_URL;
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  it('serves a no-store progressive control surface without credentials', async () => {
    const { default: handler } = await import('../api/telegram/app');
    const response = await handler(new Request('https://example.com/api/telegram/app'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-security-policy')).toContain(
      'frame-ancestors https://web.telegram.org https://*.telegram.org',
    );
    expect(html).toContain('Add your first event');
    expect(html).toContain('Change the look');
    expect(html).not.toContain('wallpaperKey');
    expect(html).not.toContain('managementToken');
  });

  it('rejects requests without valid Telegram launch data', async () => {
    const { default: handler } = await import('../api/telegram/app');
    const response = await handler(appRequest({ action: 'bootstrap', initData: '' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Open this control panel from Telegram',
    });
  });

  it('returns a secret-free account state and adds an event', async () => {
    await seedLinkedUser();
    const initData = await signedInitData(42);
    const { default: handler } = await import('../api/telegram/app');
    const bootstrap = await handler(appRequest({ action: 'bootstrap', initData }));
    const initial = (await bootstrap.json()) as Record<string, unknown>;

    expect(bootstrap.status).toBe(200);
    expect(initial).toMatchObject({
      name: 'Ada',
      google: { connected: false, events: [], trackedCount: 0 },
      setup: { hasEvents: false, shortcutConfigured: false },
      shortcut: { available: false },
    });
    expect(JSON.stringify(initial)).not.toContain('owner');
    expect(JSON.stringify(initial)).not.toContain('wallpaper-key');
    expect(JSON.stringify(initial)).not.toContain('ada@example.com');

    const added = await handler(
      appRequest({
        action: 'add-event',
        initData,
        payload: { name: '  Dentist  ', date: '2026-11-10' },
      }),
    );
    const state = (await added.json()) as {
      manualEvents: Array<{ name: string; date: string }>;
      setup: { hasEvents: boolean };
    };

    expect(added.status).toBe(200);
    expect(state.manualEvents).toEqual([
      expect.objectContaining({ name: 'Dentist', date: '2026-11-10' }),
    ]);
    expect(state.setup.hasEvents).toBe(true);
  });

  it('rejects cross-origin mutations before reading Telegram data', async () => {
    const { default: handler } = await import('../api/telegram/app');
    const request = appRequest({ action: 'bootstrap', initData: 'forged' });

    request.headers.set('Origin', 'https://evil.example');
    const response = await handler(request);

    expect(response.status).toBe(403);
  });

  it('stops reading an oversized body even when Content-Length is absent', async () => {
    const { default: handler } = await import('../api/telegram/app');
    const request = new Request('https://example.com/api/telegram/app', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://example.com',
      },
      body: JSON.stringify({
        action: 'bootstrap',
        initData: '',
        payload: { padding: 'x'.repeat(20_000) },
      }),
    });

    expect(request.headers.get('content-length')).toBeNull();

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request is too large' });
  });

  it('rate-limits authenticated wallpaper previews before rendering again', async () => {
    await seedLinkedUser();
    vi.doMock('../lib/wallpaperModel', () => ({
      buildWallpaperModel: vi.fn(() => ({ model: true })),
    }));
    vi.doMock('../lib/wallpaperRenderer', () => ({
      createWallpaperImageResponse: vi.fn(
        () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'Content-Type': 'image/png' },
          }),
      ),
    }));
    const initData = await signedInitData(42);
    const { default: handler } = await import('../api/telegram/app');

    const first = await handler(appRequest({ action: 'preview', initData }));
    const second = await handler(appRequest({ action: 'preview', initData }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBe('3');
    expect(await second.json()).toEqual({
      error: 'Please wait before trying that again',
    });
  });

  it('keeps a successful mutation independent from a rate-limited preview refresh', async () => {
    await seedLinkedUser();
    vi.doMock('../lib/wallpaperModel', () => ({
      buildWallpaperModel: vi.fn(() => ({ model: true })),
    }));
    vi.doMock('../lib/wallpaperRenderer', () => ({
      createWallpaperImageResponse: vi.fn(() => new Response(new Uint8Array([1]))),
    }));
    const initData = await signedInitData(42);
    const { default: handler } = await import('../api/telegram/app');

    await handler(appRequest({ action: 'preview', initData }));
    const mutation = await handler(
      appRequest({
        action: 'add-event',
        initData,
        payload: { name: 'Dentist', date: '2026-11-10' },
      }),
    );
    const preview = await handler(appRequest({ action: 'preview', initData }));

    expect(mutation.status).toBe(200);
    await expect(mutation.json()).resolves.toMatchObject({
      manualEvents: [{ name: 'Dentist', date: '2026-11-10' }],
    });
    expect(preview.status).toBe(429);
    expect(preview.headers.get('retry-after')).toBe('3');
  });

  it('opens Google OAuth through a fragment-only external-browser handoff', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await seedLinkedUser();
    const initData = await signedInitData(42);
    const { default: handler } = await import('../api/telegram/app');

    const started = await handler(appRequest({ action: 'start-google', initData }));
    const result = (await started.json()) as { handoffUrl: string };
    const handoffUrl = new URL(result.handoffUrl);
    const capability = handoffUrl.hash.slice(1);

    expect(started.status).toBe(200);
    expect(handoffUrl.pathname).toBe('/api/google/handoff');
    expect(handoffUrl.search).toBe('');
    expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(result)).not.toContain('accounts.google.com');

    const launch = await redis.get<{
      authorizationUrl: string;
      browserNonce: string;
      sessionId: string;
    }>(`telegram:google:launch:${capability}`);

    expect(launch).toMatchObject({
      authorizationUrl: expect.stringContaining('https://accounts.google.com/'),
      browserNonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(JSON.stringify(launch)).not.toContain('owner');
  });

  it('only resets the event form after a successful add-event mutation', async () => {
    const { default: handler } = await import('../api/telegram/app');
    const response = await handler(new Request('https://example.com/api/telegram/app'));
    const html = await response.text();

    expect(html).toContain('return false;');
    expect(html).toContain("if (added) byId('eventForm').reset();");
    expect(html).toContain('telegram.openLink(result.handoffUrl)');
  });
});

async function seedLinkedUser(): Promise<void> {
  await redis.set('user:owner', userRecord());
  await redis.set('telegram:user:42', 'owner');
}

function userRecord(): UserData {
  return {
    schemaVersion: 5,
    token: 'owner',
    wallpaperKey: 'wallpaper-key',
    name: 'Ada',
    theme: 'default',
    timeRange: 'month',
    presentation: 'hybrid',
    lockScreenProfile: 'standard',
    eventCount: 2,
    timeZone: 'UTC',
    customThemes: [],
    events: [],
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
    telegram: {
      userId: '42',
      chatId: '42',
      username: 'ada',
      linkedAt: '2026-10-26T00:00:00.000Z',
    },
  };
}

function appRequest(body: unknown): Request {
  return new Request('https://example.com/api/telegram/app', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://example.com',
    },
    body: JSON.stringify(body),
  });
}

async function signedInitData(userId: number): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `query-${userId}`,
    user: JSON.stringify({ id: userId }),
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const encoder = new TextEncoder();
  const firstKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign(
    'HMAC',
    firstKey,
    encoder.encode('123456:test-token'),
  );
  const secondKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', secondKey, encoder.encode(dataCheckString)),
  );

  params.set(
    'hash',
    [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  );

  return params.toString();
}
