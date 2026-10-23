import { getManagementToken } from '../lib/auth';
import { apiErrorResponse, jsonResponse } from '../lib/http';
import {
  addManualEvent,
  deleteManualEvent,
  ensureWallpaperKey,
  replaceManualEvents,
} from '../lib/tokenManager';
import { isValidDateString, normalizeEventName } from '../lib/validation';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const token = getManagementToken(req);

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  try {
    const result = await ensureWallpaperKey(token);

    if (!result) {
      return jsonResponse({ error: 'Invalid management token' }, 401);
    }

    if (req.method === 'GET') {
      return jsonResponse({
        events: result.user.events,
        selectedEventIds: result.user.selectedEventIds,
        totalEvents: result.user.events.length + result.user.selectedEventIds.length,
        maximumEvents: 7,
      });
    }

    if (req.method === 'POST') {
      const body = (await req.json()) as Record<string, unknown>;

      if (Array.isArray(body.events)) {
        const events = [];

        for (const candidate of body.events) {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return jsonResponse({ error: 'Each event must be an object' }, 400);
          }

          const event = candidate as Record<string, unknown>;
          const name = normalizeEventName(event.name);

          if (!name || !isValidDateString(event.date)) {
            return jsonResponse(
              { error: 'Each event needs a valid name and YYYY-MM-DD date' },
              400,
            );
          }

          events.push({ name, date: event.date });
        }

        const user = await replaceManualEvents(token, events);

        return jsonResponse({ success: true, events: user?.events ?? [] });
      }

      const name = normalizeEventName(body.name);

      if (!name || !isValidDateString(body.date)) {
        return jsonResponse(
          { error: 'A valid name and YYYY-MM-DD date are required' },
          400,
        );
      }

      const user = await addManualEvent(token, { name, date: body.date });

      return jsonResponse({ success: true, events: user?.events ?? [] }, 201);
    }

    if (req.method === 'DELETE') {
      const eventId = new URL(req.url).searchParams.get('id');

      if (!eventId) {
        return jsonResponse({ error: 'Event ID is required' }, 400);
      }

      const user = await deleteManualEvent(token, eventId);

      return jsonResponse({ success: true, events: user?.events ?? [] });
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return apiErrorResponse(error, 'Events request failed');
  }
}
