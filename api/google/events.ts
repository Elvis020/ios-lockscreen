import { getManagementToken } from '../../lib/auth';
import { syncGoogleEvents } from '../../lib/calendar/service';
import { apiErrorResponse, jsonResponse } from '../../lib/http';
import { getUser, updateSelectedEvents } from '../../lib/tokenManager';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const token = getManagementToken(req);

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  try {
    if (req.method === 'POST') {
      const sync = await syncGoogleEvents(token);

      return jsonResponse({ success: true, count: sync.fetchedEventCount, sync });
    }

    if (req.method === 'PATCH') {
      const body = (await req.json()) as { selectedEventIds?: unknown };

      if (
        !Array.isArray(body.selectedEventIds) ||
        !body.selectedEventIds.every((id) => typeof id === 'string')
      ) {
        return jsonResponse({ error: 'selectedEventIds must be a string array' }, 400);
      }

      await updateSelectedEvents(token, body.selectedEventIds);
    } else if (req.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const user = await getUser(token);

    if (!user) {
      return jsonResponse({ error: 'Invalid management token' }, 401);
    }

    return jsonResponse({
      events: user.cachedCalEvents,
      selectedEventIds: user.selectedEventIds,
      cachedAt: user.cachedCalAt || null,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Google events request failed');
  }
}
