import {
  clearGoogleOAuthCookie,
  GOOGLE_OAUTH_COOKIE,
  readCookie,
} from '../../lib/calendar/oauthSession';
import {
  cancelGoogleAuthorization,
  completeGoogleAuthorization,
  GoogleAuthorizationError,
} from '../../lib/calendar/service';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');
  const browserNonce = readCookie(req, GOOGLE_OAUTH_COOKIE);

  if (!state || !browserNonce) {
    return responseWithClearedCookie(
      'Google authorization parameters or browser session are missing',
      400,
    );
  }

  if (providerError && !code) {
    try {
      const returnUrl = await cancelGoogleAuthorization(state, browserNonce);

      return redirectWithClearedCookie(googleReturnUrl(returnUrl, 'error'));
    } catch (error) {
      console.error('Google authorization cancellation callback failed:', error);

      return redirectWithClearedCookie(`${url.origin}/app?google=error`);
    }
  }

  if (!code) {
    return responseWithClearedCookie(
      'Google authorization parameters or browser session are missing',
      400,
    );
  }

  try {
    const returnUrl = await completeGoogleAuthorization(state, code, browserNonce);

    return redirectWithClearedCookie(googleReturnUrl(returnUrl, 'connected'));
  } catch (error) {
    console.error('Google authorization callback failed:', error);

    if (error instanceof GoogleAuthorizationError) {
      return redirectWithClearedCookie(googleReturnUrl(error.returnOrigin, 'error'));
    }

    return redirectWithClearedCookie(`${url.origin}/app?google=error`);
  }
}

function googleReturnUrl(value: string, status: 'connected' | 'error'): string {
  const url = new URL(value);

  if (url.pathname === '/') {
    url.pathname = '/app';
  }

  url.searchParams.set('google', status);

  return url.toString();
}

function redirectWithClearedCookie(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Set-Cookie': clearGoogleOAuthCookie(),
    },
  });
}

function responseWithClearedCookie(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Set-Cookie': clearGoogleOAuthCookie() },
  });
}
