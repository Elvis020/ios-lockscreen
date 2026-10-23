import { createUser } from '../../lib/tokenManager';
import { apiErrorResponse, jsonResponse } from '../../lib/http';
import { isValidTimeZone } from '../../lib/validation';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const { inviteCode, name, timeZone } = body;

    // Validate inputs
    if (!inviteCode || typeof inviteCode !== 'string') {
      return jsonResponse({ error: 'Invite code is required' }, 400);
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return jsonResponse({ error: 'Name is required' }, 400);
    }

    if (name.trim().length > 50) {
      return jsonResponse({ error: 'Name must be 50 characters or less' }, 400);
    }

    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      return jsonResponse({ error: 'Invalid IANA time zone' }, 400);
    }

    const result = await createUser(inviteCode.trim(), name.trim(), timeZone ?? 'UTC');

    if ('error' in result) {
      return jsonResponse({ error: result.error }, 400);
    }

    // Generate wallpaper URL with token
    const url = new URL(req.url);
    const wallpaperUrl = `${url.origin}/api/wallpaper?wallpaperKey=${result.wallpaperKey}`;
    const legacyWallpaperUrl = `${url.origin}/api/wallpaper?token=${result.token}`;

    return jsonResponse({
      token: result.token,
      wallpaperKey: result.wallpaperKey,
      wallpaperUrl,
      legacyWallpaperUrl,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Registration failed');
  }
}
