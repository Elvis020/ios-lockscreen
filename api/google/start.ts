import { getManagementToken } from '../../lib/auth';
import {
  createGoogleBrowserNonce,
  googleOAuthCookie,
} from '../../lib/calendar/oauthSession';
import { createGoogleAuthorization } from '../../lib/calendar/service';
import { apiErrorResponse, jsonResponse } from '../../lib/http';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = getManagementToken(req);

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  try {
    const browserNonce = createGoogleBrowserNonce();
    const origin = new URL(req.url).origin;
    const authorizationUrl = await createGoogleAuthorization(
      token,
      `${origin}/app`,
      browserNonce,
    );
    const response = jsonResponse({ authorizationUrl });

    response.headers.set('Set-Cookie', googleOAuthCookie(browserNonce));

    return response;
  } catch (error) {
    return apiErrorResponse(error, 'Google authorization start failed');
  }
}
