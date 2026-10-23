import { getManagementToken } from '../lib/auth';
import { apiErrorResponse, jsonResponse } from '../lib/http';
import { isViewMode, listAvailableThemeIds } from '../lib/preferences';
import { ensureWallpaperKey, updatePreferences } from '../lib/tokenManager';
import { isValidTimeZone } from '../lib/validation';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const token = getManagementToken(req);

  if (!token) {
    return jsonResponse({ error: 'Management token is required' }, 401);
  }

  try {
    if (req.method === 'GET') {
      const result = await ensureWallpaperKey(token);

      if (!result) {
        return jsonResponse({ error: 'Invalid management token' }, 401);
      }

      return jsonResponse({
        theme: result.user.theme,
        viewMode: result.user.viewMode,
        timeZone: result.user.timeZone,
        themes: listAvailableThemeIds(result.user.customThemes),
        customThemes: result.user.customThemes,
        wallpaperKey: result.wallpaperKey,
        wallpaperUrl: wallpaperUrl(req, result.wallpaperKey),
        telegramLinked: Boolean(result.user.telegram),
      });
    }

    if (req.method === 'PATCH') {
      const body = (await req.json()) as Record<string, unknown>;
      const result = await ensureWallpaperKey(token);

      if (!result) {
        return jsonResponse({ error: 'Invalid management token' }, 401);
      }

      const preferences: {
        theme?: string;
        viewMode?: 'week' | 'month' | 'quarter';
        timeZone?: string;
      } = {};

      if (body.theme !== undefined) {
        if (
          typeof body.theme !== 'string' ||
          !listAvailableThemeIds(result.user.customThemes).includes(body.theme)
        ) {
          return jsonResponse({ error: 'Unknown theme' }, 400);
        }

        preferences.theme = body.theme;
      }

      if (body.viewMode !== undefined) {
        if (!isViewMode(body.viewMode)) {
          return jsonResponse({ error: 'View must be week, month, or quarter' }, 400);
        }

        preferences.viewMode = body.viewMode;
      }

      if (body.timeZone !== undefined) {
        if (!isValidTimeZone(body.timeZone)) {
          return jsonResponse({ error: 'Invalid IANA time zone' }, 400);
        }

        preferences.timeZone = body.timeZone;
      }

      const user = await updatePreferences(token, preferences);

      return jsonResponse({
        theme: user?.theme,
        viewMode: user?.viewMode,
        timeZone: user?.timeZone,
        wallpaperUrl: wallpaperUrl(req, result.wallpaperKey),
      });
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    return apiErrorResponse(error, 'Settings request failed');
  }
}

function wallpaperUrl(req: Request, wallpaperKey: string): string {
  return `${new URL(req.url).origin}/api/wallpaper?wallpaperKey=${encodeURIComponent(wallpaperKey)}`;
}
