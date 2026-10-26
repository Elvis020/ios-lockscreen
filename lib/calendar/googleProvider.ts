import type { CalendarEvent } from '../userSchema';
import type {
  CalendarProvider,
  CalendarSyncBatch,
  ConnectedGoogleAccount,
} from './types';

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  email?: string;
}

interface GoogleEventsResponse {
  nextPageToken?: string;
  items?: Array<{
    id?: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    organizer?: { displayName?: string };
  }>;
}

interface GoogleCalendarListResponse {
  nextPageToken?: string;
  items?: GoogleCalendarListEntry[];
}

interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

const MAX_EVENT_PAGES = 20;
const MAX_CALENDAR_PAGES = 10;
const MAX_VISIBLE_CALENDARS = 20;

export class GoogleCalendarProvider implements CalendarProvider {
  createAuthorizationUrl(state: string, codeChallenge: string): string {
    const config = getGoogleConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.readonly',
      ].join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<ConnectedGoogleAccount> {
    const config = getGoogleConfig();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    const tokens = (await response.json()) as GoogleTokenResponse;

    if (!response.ok || !tokens.access_token || !tokens.refresh_token) {
      throw new Error(tokens.error_description ?? 'Google authorization failed');
    }

    const userInfoResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;

    if (!userInfoResponse.ok || !userInfo.email) {
      throw new Error('Google account email was unavailable');
    }

    return {
      email: userInfo.email,
      encryptedRefreshToken: await encryptSecret(tokens.refresh_token),
    };
  }

  async listEvents(
    encryptedRefreshToken: string,
    accountId: string,
    accountEmail: string,
    timeZone: string,
  ): Promise<CalendarSyncBatch> {
    const accessToken = await refreshAccessToken(encryptedRefreshToken);
    const now = new Date();
    const end = new Date(now);

    end.setUTCFullYear(end.getUTCFullYear() + 1);
    const calendars = await listVisibleCalendars(accessToken);
    const events: CalendarEvent[] = [];

    for (const calendar of calendars) {
      events.push(
        ...(await listCalendarEvents({
          accessToken,
          accountEmail,
          accountId,
          calendar,
          end,
          now,
          timeZone,
        })),
      );
    }

    events.sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.name.localeCompare(right.name),
    );

    return {
      calendarCount: calendars.length,
      events,
      windowStart: now.toISOString().slice(0, 10),
      windowEnd: end.toISOString().slice(0, 10),
    };
  }
}

async function listVisibleCalendars(
  accessToken: string,
): Promise<Array<GoogleCalendarListEntry & { id: string }>> {
  const calendars: Array<GoogleCalendarListEntry & { id: string }> = [];
  const params = new URLSearchParams({
    maxResults: '250',
    minAccessRole: 'reader',
    showDeleted: 'false',
    showHidden: 'false',
  });
  let nextPageToken: string | undefined;

  for (let page = 0; page < MAX_CALENDAR_PAGES; page += 1) {
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    } else {
      params.delete('pageToken');
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const payload = (await response.json()) as GoogleCalendarListResponse;

    if (!response.ok) {
      throw new Error('Unable to list Google calendars');
    }

    calendars.push(
      ...(payload.items ?? []).flatMap((calendar) =>
        calendar.id &&
        !calendar.deleted &&
        !calendar.hidden &&
        (calendar.primary || calendar.selected)
          ? [{ ...calendar, id: calendar.id }]
          : [],
      ),
    );

    if (calendars.length > MAX_VISIBLE_CALENDARS) {
      throw new Error('Too many visible Google calendars');
    }

    nextPageToken = payload.nextPageToken;

    if (!nextPageToken) {
      return calendars;
    }
  }

  throw new Error('Google Calendar returned too many calendar pages');
}

async function listCalendarEvents(options: {
  accessToken: string;
  accountEmail: string;
  accountId: string;
  calendar: GoogleCalendarListEntry & { id: string };
  end: Date;
  now: Date;
  timeZone: string;
}): Promise<CalendarEvent[]> {
  const { accessToken, accountEmail, accountId, calendar, end, now, timeZone } = options;
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    timeZone,
  });
  const events: CalendarEvent[] = [];
  const calendarKey = calendar.primary ? null : await shortHash(calendar.id);
  const calendarName = (
    calendar.summaryOverride ??
    calendar.summary ??
    (calendar.primary ? 'Primary' : 'Calendar')
  ).slice(0, 80);
  let nextPageToken: string | undefined;

  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    } else {
      params.delete('pageToken');
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const payload = (await response.json()) as GoogleEventsResponse;

    if (!response.ok) {
      throw new Error('Unable to sync Google Calendar');
    }

    events.push(
      ...(payload.items ?? []).flatMap((event) => {
        const date = event.start?.date ?? event.start?.dateTime?.slice(0, 10);

        if (!event.id || !date) {
          return [];
        }

        return [
          {
            id: calendarKey
              ? `${accountId}:${calendarKey}:${event.id}`
              : `${accountId}:${event.id}`,
            name: (event.summary ?? 'Untitled event').slice(0, 50),
            date,
            accountEmail,
            calendarName,
          },
        ];
      }),
    );

    nextPageToken = payload.nextPageToken;

    if (!nextPageToken) {
      return events;
    }
  }

  throw new Error('Google Calendar returned too many event pages');
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI &&
    process.env.GOOGLE_OAUTH_ENCRYPTION_KEY,
  );
}

async function refreshAccessToken(encryptedRefreshToken: string): Promise<string> {
  const config = getGoogleConfig();
  const refreshToken = await decryptSecret(encryptedRefreshToken);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !tokens.access_token) {
    if (
      response.status === 400 ||
      response.status === 401 ||
      tokens.error === 'invalid_grant'
    ) {
      throw new Error('Google account must be reconnected');
    }

    throw new Error('Unable to refresh Google access');
  }

  return tokens.access_token;
}

function getGoogleConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (!isGoogleConfigured()) {
    throw new Error('Google Calendar is not configured');
  }

  return {
    clientId: process.env.GOOGLE_CLIENT_ID as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    redirectUri: process.env.GOOGLE_REDIRECT_URI as string,
  };
}

async function encryptSecret(value: string): Promise<string> {
  const key = await importEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );

  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

async function decryptSecret(value: string): Promise<string> {
  const [ivValue, ciphertextValue] = value.split('.');

  if (!ivValue || !ciphertextValue) {
    throw new Error('Google account must be reconnected');
  }

  const key = await importEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(ciphertextValue),
  );

  return new TextDecoder().decode(decrypted);
}

async function importEncryptionKey(): Promise<CryptoKey> {
  const encoded = process.env.GOOGLE_OAUTH_ENCRYPTION_KEY;

  if (!encoded) {
    throw new Error('Google Calendar is not configured');
  }

  const bytes = fromBase64Url(encoded);

  if (bytes.byteLength !== 32) {
    throw new Error('Google Calendar is not configured');
  }

  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
}
