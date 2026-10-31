import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarProvider } from '../lib/calendar/googleProvider';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
});

describe('GoogleCalendarProvider', () => {
  it('builds an OAuth URL with readonly calendar scope and PKCE', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const url = new URL(
      new GoogleCalendarProvider().createAuthorizationUrl('state', 'challenge'),
    );

    expect(url.searchParams.get('state')).toBe('state');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
  });

  it('follows Google event pagination without truncating the cache input', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'initial-access',
          refresh_token: 'refresh-token',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ email: 'ada@example.com' }));

    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleCalendarProvider();
    const connected = await provider.exchangeCode('code', 'verifier');

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'refreshed-access' }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'primary@example.com', summary: 'Primary', primary: true }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'first', summary: 'First', start: { date: '2026-11-01' } }],
          nextPageToken: 'page-two',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'second', summary: 'Second', start: { date: '2026-11-02' } }],
        }),
      );

    const result = await provider.listEvents(
      connected.encryptedRefreshToken,
      'stable-account',
      connected.email,
      'UTC',
    );

    expect(result.events.map(({ id }) => id)).toEqual([
      expect.stringMatching(/^g2:stable-account:[a-f0-9]{16}:event:[a-f0-9]{16}$/),
      expect.stringMatching(/^g2:stable-account:[a-f0-9]{16}:event:[a-f0-9]{16}$/),
    ]);
    expect(result.calendarCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain('pageToken=page-two');
  });

  it('collapses recurring instances across pages into the next selectable series', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'initial-access', refresh_token: 'refresh-token' }),
      )
      .mockResolvedValueOnce(jsonResponse({ email: 'ada@example.com' }));

    vi.stubGlobal('fetch', fetchMock);
    const provider = new GoogleCalendarProvider();
    const connected = await provider.exchangeCode('code', 'verifier');

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'refreshed-access' }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'primary@example.com', summary: 'Primary', primary: true }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 'instance-later',
              recurringEventId: 'series-1',
              summary: 'Standup',
              start: { date: '2026-12-02' },
            },
          ],
          nextPageToken: 'page-two',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 'instance-next',
              recurringEventId: 'series-1',
              summary: 'Standup moved',
              start: { date: '2026-11-02' },
            },
            { id: 'one-off', summary: 'Launch', start: { date: '2026-11-03' } },
          ],
        }),
      );

    const result = await provider.listEvents(
      connected.encryptedRefreshToken,
      'stable-account',
      connected.email,
      'UTC',
      ['stable-account:instance-next'],
    );

    expect(result.events).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^g2:stable-account:[a-f0-9]{16}:series:[a-f0-9]{16}$/),
        name: 'Standup moved',
        date: '2026-11-02',
        recurring: true,
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^g2:stable-account:[a-f0-9]{16}:event:[a-f0-9]{16}$/),
        name: 'Launch',
        recurring: false,
      }),
    ]);
    expect(result.idAliases).toEqual({
      'stable-account:instance-next': result.events[0]?.id,
    });

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'refreshed-access' }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'primary@example.com', summary: 'Primary', primary: true }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 'instance-after-advance',
              recurringEventId: 'series-1',
              summary: 'Standup',
              start: { date: '2026-12-09' },
            },
          ],
        }),
      );

    const afterAdvance = await provider.listEvents(
      connected.encryptedRefreshToken,
      'stable-account',
      connected.email,
      'UTC',
    );

    expect(afterAdvance.events[0]?.id).toBe(result.events[0]?.id);
  });

  it('syncs primary and visible secondary calendars with stable namespaced IDs', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'initial-access', refresh_token: 'refresh-token' }),
      )
      .mockResolvedValueOnce(jsonResponse({ email: 'ada@example.com' }));

    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleCalendarProvider();
    const connected = await provider.exchangeCode('code', 'verifier');

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'refreshed-access' }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            { id: 'primary@example.com', summary: 'Primary', primary: true },
            {
              id: 'shared calendar@example.com',
              summary: 'Family plans',
              selected: true,
            },
            { id: 'hidden@example.com', summary: 'Hidden', selected: false },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ id: 'trip', summary: 'Family trip', start: { date: '2026-11-04' } }],
        }),
      );

    const result = await provider.listEvents(
      connected.encryptedRefreshToken,
      'stable-account',
      'ada@example.com',
      'UTC',
    );

    expect(result.calendarCount).toBe(2);
    expect(result.events).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^g2:stable-account:[a-f0-9]{16}:event:[a-f0-9]{16}$/),
        name: 'Family trip',
        calendarName: 'Family plans',
      }),
    ]);
    expect(String(fetchMock.mock.calls[3][0])).toContain(
      'calendars/shared%20calendar%40example.com/events',
    );
  });

  it('asks the user to reconnect when Google revokes refresh access', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.com/api/google/callback';
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'initial-access', refresh_token: 'refresh-token' }),
      )
      .mockResolvedValueOnce(jsonResponse({ email: 'ada@example.com' }));

    vi.stubGlobal('fetch', fetchMock);

    const provider = new GoogleCalendarProvider();
    const connected = await provider.exchangeCode('code', 'verifier');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));

    await expect(
      provider.listEvents(
        connected.encryptedRefreshToken,
        'stable-account',
        connected.email,
        'UTC',
      ),
    ).rejects.toThrow('Google account must be reconnected');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
