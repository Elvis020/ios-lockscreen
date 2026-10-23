import { getManagementToken } from '../../lib/auth';
import { disconnectGoogleAccount } from '../../lib/calendar/service';
import { apiErrorResponse, jsonResponse } from '../../lib/http';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const token = getManagementToken(req);
  const accountId = new URL(req.url).searchParams.get('id');

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  if (!accountId) {
    return jsonResponse({ error: 'Google account ID is required' }, 400);
  }

  try {
    await disconnectGoogleAccount(token, accountId);

    return jsonResponse({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Google disconnect failed');
  }
}
