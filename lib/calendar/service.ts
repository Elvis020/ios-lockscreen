import { getRedis } from '../redis';
import {
  addGoogleAccount,
  googleAccountRevision,
  getUser,
  removeGoogleAccount,
  updateCachedCalEvents,
  type MutationCompletion,
} from '../tokenManager';
import { GoogleCalendarProvider } from './googleProvider';
import { hashGoogleBrowserNonce, securelyEqual } from './oauthSession';
import type { OAuthState } from './types';

const provider = new GoogleCalendarProvider();

export type GoogleSyncStatus =
  'not_connected' | 'no_calendars' | 'empty_window' | 'needs_selection' | 'ready';

export interface GoogleSyncResult {
  accountCount: number;
  calendarCount: number;
  fetchedEventCount: number;
  status: GoogleSyncStatus;
  trackedEventCount: number;
  upcomingTrackedEvents: Array<{ date: string; name: string }>;
  windowEnd: string;
  windowStart: string;
}

export class GoogleAuthorizationError extends Error {
  constructor(
    message: string,
    readonly returnOrigin: string,
  ) {
    super(message);
    this.name = 'GoogleAuthorizationError';
  }
}

export async function createGoogleAuthorization(
  token: string,
  returnOrigin: string,
  browserNonce: string,
): Promise<string> {
  if (!(await getUser(token))) {
    throw new Error('Invalid management token');
  }

  const state = crypto.randomUUID();
  const codeVerifier = randomVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const browserNonceHash = await hashGoogleBrowserNonce(browserNonce);
  const oauthState: OAuthState = {
    token,
    codeVerifier,
    returnOrigin,
    browserNonceHash,
  };

  await getRedis().set(`oauth:google:state:${state}`, oauthState, { ex: 600 });

  return provider.createAuthorizationUrl(state, codeChallenge);
}

export async function completeGoogleAuthorization(
  state: string,
  code: string,
  browserNonce: string,
): Promise<string> {
  const oauthState = await consumeGoogleAuthorizationState(state, browserNonce);

  try {
    const connected = await provider.exchangeCode(code, oauthState.codeVerifier);

    await addGoogleAccount(oauthState.token, {
      id: crypto.randomUUID(),
      email: connected.email,
      encryptedRefreshToken: connected.encryptedRefreshToken,
      connectedAt: new Date().toISOString(),
    });
  } catch (error) {
    throw new GoogleAuthorizationError(
      error instanceof Error ? error.message : 'Google authorization failed',
      oauthState.returnOrigin,
    );
  }

  return oauthState.returnOrigin;
}

export async function cancelGoogleAuthorization(
  state: string,
  browserNonce: string,
): Promise<string> {
  const oauthState = await consumeGoogleAuthorizationState(state, browserNonce);

  return oauthState.returnOrigin;
}

async function consumeGoogleAuthorizationState(
  state: string,
  browserNonce: string,
): Promise<OAuthState> {
  const redis = getRedis();
  const stateKey = `oauth:google:state:${state}`;
  const candidate = await redis.get<OAuthState>(stateKey);

  if (!candidate) {
    throw new Error('Google authorization expired or is invalid');
  }

  if (!candidate.browserNonceHash) {
    throw new Error('Google authorization browser session is invalid');
  }

  const browserNonceHash = await hashGoogleBrowserNonce(browserNonce);

  if (!securelyEqual(candidate.browserNonceHash, browserNonceHash)) {
    throw new Error('Google authorization browser session is invalid');
  }

  const oauthState = await redis.getdel<OAuthState>(stateKey);

  if (!oauthState || !securelyEqual(oauthState.browserNonceHash, browserNonceHash)) {
    throw new Error('Google authorization expired or is invalid');
  }

  return oauthState;
}

export async function syncGoogleEvents(
  token: string,
  completion?: MutationCompletion,
): Promise<GoogleSyncResult> {
  const user = await getUser(token);

  if (!user) {
    throw new Error('Invalid management token');
  }

  const now = new Date();
  const end = new Date(now);

  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const windowStart = now.toISOString().slice(0, 10);
  const windowEnd = end.toISOString().slice(0, 10);

  if (!user.googleAccounts.length) {
    return {
      accountCount: 0,
      calendarCount: 0,
      fetchedEventCount: 0,
      status: 'not_connected',
      trackedEventCount: 0,
      upcomingTrackedEvents: [],
      windowEnd,
      windowStart,
    };
  }

  const events = [];
  let calendarCount = 0;
  const accountRevision = googleAccountRevision(user.googleAccounts);

  for (const account of user.googleAccounts) {
    if (!account.encryptedRefreshToken) {
      throw new Error('Google account must be reconnected');
    }

    const batch = await provider.listEvents(
      account.encryptedRefreshToken,
      account.id,
      account.email,
      user.timeZone,
    );

    calendarCount += batch.calendarCount;
    events.push(...batch.events);
  }

  await updateCachedCalEvents(token, events, accountRevision, completion);

  const updated = await getUser(token);

  if (!updated) {
    throw new Error('Invalid management token');
  }

  const cached = new Map(updated.cachedCalEvents.map((event) => [event.id, event]));
  const tracked = updated.selectedEventIds.flatMap((id) => {
    const event = cached.get(id);

    return event ? [event] : [];
  });
  const status: GoogleSyncStatus = !calendarCount
    ? 'no_calendars'
    : !events.length
      ? 'empty_window'
      : !tracked.length
        ? 'needs_selection'
        : 'ready';

  return {
    accountCount: updated.googleAccounts.length,
    calendarCount,
    fetchedEventCount: events.length,
    status,
    trackedEventCount: tracked.length,
    upcomingTrackedEvents: tracked
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.name.localeCompare(right.name),
      )
      .slice(0, 3)
      .map(({ date, name }) => ({ date, name })),
    windowEnd,
    windowStart,
  };
}

export async function disconnectGoogleAccount(
  token: string,
  accountId: string,
): Promise<void> {
  await removeGoogleAccount(token, accountId);
}

function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));

  return toBase64Url(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );

  return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
