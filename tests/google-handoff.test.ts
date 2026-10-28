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
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('content-security-policy')).toContain(
      "form-action 'self' https://accounts.google.com",
    );
    expect(html).toContain('window.location.hash.slice(1)');
    expect(html).toContain('form.submit()');
    expect(html).not.toContain('accounts.google.com');
    expect(html).not.toContain('a'.repeat(43));
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

    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(authorizationUrl);
    expect(first.headers.get('location')).not.toContain(capability);
    expect(first.headers.get('cache-control')).toContain('no-store');
    expect(first.headers.get('referrer-policy')).toBe('no-referrer');
    const cookies = first.headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('calendar_google_oauth=' + 'b'.repeat(43));
    expect(cookies[1]).toContain(
      'calendar_telegram_app=12345678-1234-4234-8234-123456789abc',
    );
    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    }
    expect(replay.status).toBe(400);
    expect(await redis.get(`telegram:google:launch:${capability}`)).toBeNull();
  });

  it('requires a same-origin POST before consuming a launch', async () => {
    const capability = 'c'.repeat(43);

    await redis.set(`telegram:google:launch:${capability}`, validLaunch());

    const { default: handler } = await import('../api/google/handoff');

    for (const origin of ['https://evil.example', 'null']) {
      const request = postHandoff({ capability });

      request.headers.set('Origin', origin);

      const response = await handler(request);

      expect(response.status).toBe(400);
    }
    expect(await redis.get(`telegram:google:launch:${capability}`)).not.toBeNull();
  });

  it('rejects unsafe or malformed configured callback URLs', async () => {
    const { getGoogleCallbackOrigin } = await import('../lib/calendar/googleProvider');

    for (const redirectUri of [
      'not-a-url',
      'http://example.com/api/google/callback',
      'https://user@example.com/api/google/callback',
      'https://example.com/api/google/callback?extra=1',
      'https://example.com/api/google/callback#fragment',
    ]) {
      process.env.GOOGLE_REDIRECT_URI = redirectUri;
      expect(() => getGoogleCallbackOrigin()).toThrow('Google redirect URI is invalid');
    }
  });
});

function postHandoff(body: Record<string, string>): Request {
  return new Request('https://example.com/api/google/handoff', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://example.com',
    },
    body: new URLSearchParams(body),
  });
}

function validLaunch() {
  return {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-id',
    browserNonce: 'b'.repeat(43),
    sessionId: '12345678-1234-4234-8234-123456789abc',
  };
}
