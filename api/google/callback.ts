import {
  clearGoogleOAuthCookie,
  GOOGLE_OAUTH_COOKIE,
  readCookie,
} from '../../lib/calendar/oauthSession';
import { completeGoogleAuthorization } from '../../lib/calendar/service';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const browserNonce = readCookie(req, GOOGLE_OAUTH_COOKIE);

  if (!state || !code || !browserNonce) {
    return responseWithClearedCookie(
      'Google authorization parameters or browser session are missing',
      400,
    );
  }

  try {
    const returnOrigin = await completeGoogleAuthorization(state, code, browserNonce);

    return redirectWithClearedCookie(`${returnOrigin}/app?google=connected`);
  } catch (error) {
    console.error('Google authorization callback failed:', error);

    return redirectWithClearedCookie(`${url.origin}/app?google=error`);
  }
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
