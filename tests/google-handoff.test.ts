import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
let redis: InMemoryRedis;

describe('Google OAuth external-browser handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  it('serves a static no-store handoff page with a restrictive CSP', async () => {
    const { default: handler } = await import('../api/google/handoff');
    const response = await handler(new Request('https://example.com/api/google/handoff'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(html).toContain('window.location.hash.slice(1)');
    expect(html).not.toContain('accounts.google.com');
  });

  it('rejects missing and invalid capabilities without issuing cookies', async () => {
    const { default: handler } = await import('../api/google/handoff');

    const missing = await handler(postHandoff({}));
    const invalid = await handler(postHandoff({ capability: 'not-a-capability' }));

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(missing.headers.get('set-cookie')).toBeNull();
    await expect(missing.json()).resolves.toEqual({
      error: 'Google authorization launch is invalid or expired',
    });
  });

  it('atomically consumes a launch and sets both external-browser session cookies', async () => {
    const capability = 'a'.repeat(43);
    const authorizationUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?state=state-id';

    await redis.set(`telegram:google:launch:${capability}`, {
      authorizationUrl,
      browserNonce: 'b'.repeat(43),
      sessionId: '12345678-1234-4234-8234-123456789abc',
    });

    const { default: handler } = await import('../api/google/handoff');

    const first = await handler(postHandoff({ capability }));
    const replay = await handler(postHandoff({ capability }));

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ authorizationUrl });
    expect(first.headers.get('set-cookie')).toContain(
      'calendar_google_oauth=' + 'b'.repeat(43),
    );
    expect(first.headers.get('set-cookie')).toContain(
      'calendar_telegram_app=12345678-1234-4234-8234-123456789abc',
    );
    expect(first.headers.get('set-cookie')).toContain('HttpOnly');
    expect(first.headers.get('set-cookie')).toContain('Secure');
    expect(first.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(replay.status).toBe(400);
    expect(await redis.get(`telegram:google:launch:${capability}`)).toBeNull();
  });

  it('requires a same-origin POST before consuming a launch', async () => {
    const capability = 'c'.repeat(43);

    await redis.set(`telegram:google:launch:${capability}`, validLaunch());

    const { default: handler } = await import('../api/google/handoff');
    const request = postHandoff({ capability });

    request.headers.set('Origin', 'https://evil.example');

    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(await redis.get(`telegram:google:launch:${capability}`)).not.toBeNull();
  });
});

function postHandoff(body: unknown): Request {
  return new Request('https://example.com/api/google/handoff', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://example.com',
    },
    body: JSON.stringify(body),
  });
}

function validLaunch() {
  return {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-id',
    browserNonce: 'b'.repeat(43),
    sessionId: '12345678-1234-4234-8234-123456789abc',
  };
}
