import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/calendar/service', () => ({
  completeGoogleAuthorization: vi.fn(),
}));

import handler from '../api/google/callback';
import { completeGoogleAuthorization } from '../lib/calendar/service';

const completeAuthorization = vi.mocked(completeGoogleAuthorization);

afterEach(() => {
  vi.restoreAllMocks();
  completeAuthorization.mockReset();
});

describe('Google OAuth callback', () => {
  it('returns a successful connection to the public /app dashboard route', async () => {
    completeAuthorization.mockResolvedValue('https://example.com');

    const response = await handler(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://example.com/app?google=connected',
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('returns a failed connection to the public /app dashboard route', async () => {
    completeAuthorization.mockRejectedValue(new Error('OAuth failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handler(callbackRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/app?google=error');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

function callbackRequest(): Request {
  return new Request(
    'https://example.com/api/google/callback?state=state-value&code=code-value',
    {
      headers: { Cookie: 'calendar_google_oauth=browser-nonce' },
    },
  );
}
