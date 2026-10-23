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

  const connected = await provider.exchangeCode(code, oauthState.codeVerifier);

  await addGoogleAccount(oauthState.token, {
    id: crypto.randomUUID(),
    email: connected.email,
    encryptedRefreshToken: connected.encryptedRefreshToken,
    connectedAt: new Date().toISOString(),
  });

  return oauthState.returnOrigin;
}

export async function syncGoogleEvents(
  token: string,
  completion?: MutationCompletion,
): Promise<number> {
  const user = await getUser(token);

  if (!user) {
    throw new Error('Invalid management token');
  }

  const events = [];
  const accountRevision = googleAccountRevision(user.googleAccounts);

  for (const account of user.googleAccounts) {
    if (!account.encryptedRefreshToken) {
      throw new Error('Google account must be reconnected');
    }

    events.push(
      ...(await provider.listEvents(
        account.encryptedRefreshToken,
        account.id,
        account.email,
        user.timeZone,
      )),
    );
  }

  await updateCachedCalEvents(token, events, accountRevision, completion);

  return events.length;
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
