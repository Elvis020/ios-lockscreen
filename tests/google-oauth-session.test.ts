import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
let redis: InMemoryRedis;

describe('Google OAuth browser session', () => {
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

  it('does not consume OAuth state until the initiating browser nonce matches', async () => {
    const { hashGoogleBrowserNonce } = await import('../lib/calendar/oauthSession');
    const { GoogleCalendarProvider } = await import('../lib/calendar/googleProvider');

    vi.spyOn(GoogleCalendarProvider.prototype, 'exchangeCode').mockResolvedValue({
      email: 'ada@example.com',
      encryptedRefreshToken: 'encrypted',
    });
    await redis.set('user:owner', userRecord());
    await redis.set('oauth:google:state:state-id', {
      token: 'owner',
      codeVerifier: 'verifier',
      returnOrigin: 'https://example.com',
      browserNonceHash: await hashGoogleBrowserNonce('right-browser'),
    });
    const { completeGoogleAuthorization } = await import('../lib/calendar/service');

    await expect(
      completeGoogleAuthorization('state-id', 'code', 'wrong-browser'),
    ).rejects.toThrow('Google authorization browser session is invalid');
    expect(await redis.get('oauth:google:state:state-id')).not.toBeNull();

    await expect(
      completeGoogleAuthorization('state-id', 'code', 'right-browser'),
    ).resolves.toBe('https://example.com');
    expect(await redis.get('oauth:google:state:state-id')).toBeNull();
  });

  it('sets a short-lived secure HttpOnly cookie when OAuth starts', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await redis.set('user:owner', userRecord());
    const { default: handler } = await import('../api/google/start');

    const response = await handler(
      new Request('https://example.com/api/google/start', {
        method: 'POST',
        headers: { Authorization: 'Bearer owner' },
      }),
    );
    const cookie = response.headers.get('set-cookie');

    expect(response.status).toBe(200);
    expect(cookie).toContain('calendar_google_oauth=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=600');
  });
});

function userRecord() {
  return {
    schemaVersion: 2,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    viewMode: 'quarter',
    timeZone: 'UTC',
    customThemes: [],
    events: [],
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
  };
}
