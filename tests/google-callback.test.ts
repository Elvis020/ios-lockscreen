import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/calendar/service', () => ({
  cancelGoogleAuthorization: vi.fn(),
  completeGoogleAuthorization: vi.fn(),
  GoogleAuthorizationError: class GoogleAuthorizationError extends Error {
    constructor(
      message: string,
      readonly returnOrigin: string,
    ) {
      super(message);
    }
  },
}));

import handler from '../api/google/callback';
import {
  cancelGoogleAuthorization,
  completeGoogleAuthorization,
  GoogleAuthorizationError,
} from '../lib/calendar/service';

const completeAuthorization = vi.mocked(completeGoogleAuthorization);
const cancelAuthorization = vi.mocked(cancelGoogleAuthorization);

afterEach(() => {
  vi.restoreAllMocks();
  completeAuthorization.mockReset();
  cancelAuthorization.mockReset();
});

describe('Google OAuth callback', () => {
  it('returns a successful connection to the public /app dashboard route', async () => {
    completeAuthorization.mockResolvedValue('https://example.com');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await handler(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://example.com/app?google=connected',
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(warning).not.toHaveBeenCalled();
  });

  it('returns a failed connection to the public /app dashboard route', async () => {
    completeAuthorization.mockRejectedValue(new Error('OAuth failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handler(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/app?google=error');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('returns a Telegram-started failure to the Telegram control panel', async () => {
    completeAuthorization.mockRejectedValue(
      new GoogleAuthorizationError(
        'OAuth failed',
        'https://example.com/api/telegram/app',
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handler(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://example.com/api/telegram/app?google=error',
    );
  });

  it('consumes a nonce-bound cancelled authorization and returns to Telegram', async () => {
    cancelAuthorization.mockResolvedValue('https://example.com/api/telegram/app');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await handler(
      callbackRequest('?state=state-value&error=access_denied'),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://example.com/api/telegram/app?google=error',
    );
    expect(cancelAuthorization).toHaveBeenCalledWith('state-value', 'browser-nonce');
    expect(completeAuthorization).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([
    {
      query: '?state=secret-state&code=secret-code',
      cookie: '',
      reason: 'missing_browser_nonce',
      flags: [true, true, false, false],
    },
    {
      query: '?state=secret-state',
      cookie: 'calendar_google_oauth=secret-nonce',
      reason: 'missing_code',
      flags: [true, false, false, true],
    },
    {
      query: '?code=secret-code&error=secret-error',
      cookie: 'calendar_google_oauth=secret-nonce',
      reason: 'missing_state',
      flags: [false, true, true, true],
    },
    {
      query: '',
      cookie: '',
      reason: 'missing_state',
      flags: [false, false, false, false],
    },
  ])('logs only presence flags for $reason', async ({ query, cookie, reason, flags }) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const request = new Request(`https://example.com/api/google/callback${query}`, {
      headers: { Cookie: cookie },
    });
    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith({
      event: 'google_oauth_callback_rejected',
      reason,
      hasState: flags[0],
      hasCode: flags[1],
      hasProviderError: flags[2],
      hasBrowserNonce: flags[3],
    });
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/secret-|example\.com/);
    expect(completeAuthorization).not.toHaveBeenCalled();
    expect(cancelAuthorization).not.toHaveBeenCalled();
  });
});

function callbackRequest(query = '?state=state-value&code=code-value'): Request {
  return new Request(`https://example.com/api/google/callback${query}`, {
    headers: { Cookie: 'calendar_google_oauth=browser-nonce' },
  });
}
