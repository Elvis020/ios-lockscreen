import { getManagementToken } from '../../lib/auth';
import { isGoogleConfigured } from '../../lib/calendar/googleProvider';
import { apiErrorResponse, jsonResponse } from '../../lib/http';
import { getUser } from '../../lib/tokenManager';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = getManagementToken(req);

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  try {
    const user = await getUser(token);

    if (!user) {
      return jsonResponse({ error: 'Invalid management token' }, 401);
    }

    return jsonResponse({
      configured: isGoogleConfigured(),
      accounts: user.googleAccounts.map(({ id, email, connectedAt }) => ({
        id,
        email,
        connectedAt,
      })),
      cachedAt: user.cachedCalAt || null,
      cachedEvents: user.cachedCalEvents.length,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Google status failed');
  }
}
