import { getManagementToken } from '../lib/auth';
import { apiErrorResponse, jsonResponse } from '../lib/http';
import {
  findWallpaperPreset,
  isEventCount,
  EVENT_COUNTS,
  isLockScreenProfile,
  isPresentation,
  isTimeRange,
  isWallpaperPreset,
  listAvailableThemeIds,
  LOCK_SCREEN_PROFILES,
  PRESENTATIONS,
  TIME_RANGES,
  WALLPAPER_PRESET_IDS,
  WALLPAPER_PRESETS,
  type LockScreenProfile,
  type Presentation,
  type TimeRange,
} from '../lib/preferences';
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
        timeRange: result.user.timeRange,
        presentation: result.user.presentation,
        lockScreenProfile: result.user.lockScreenProfile,
        eventCount: result.user.eventCount,
        preset: findWallpaperPreset(result.user.timeRange, result.user.presentation),
        viewMode: result.user.timeRange,
        timeZone: result.user.timeZone,
        themes: listAvailableThemeIds(result.user.customThemes),
        customThemes: result.user.customThemes,
        wallpaperOptions: {
          timeRanges: TIME_RANGES,
          presentations: PRESENTATIONS,
          lockScreenProfiles: LOCK_SCREEN_PROFILES,
          eventCounts: EVENT_COUNTS,
          presets: WALLPAPER_PRESET_IDS.map((id) => WALLPAPER_PRESETS[id]),
        },
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
        timeRange?: TimeRange;
        presentation?: Presentation;
        lockScreenProfile?: LockScreenProfile;
        timeZone?: string;
        eventCount?: number;
      } = {};

      if (body.preset !== undefined) {
        if (!isWallpaperPreset(body.preset)) {
          return jsonResponse({ error: 'Unknown wallpaper preset' }, 400);
        }

        const preset = WALLPAPER_PRESETS[body.preset];

        preferences.timeRange = preset.timeRange;
        preferences.presentation = preset.presentation;
      }

      if (body.theme !== undefined) {
        if (
          typeof body.theme !== 'string' ||
          !listAvailableThemeIds(result.user.customThemes).includes(body.theme)
        ) {
          return jsonResponse({ error: 'Unknown theme' }, 400);
        }

        preferences.theme = body.theme;
      }

      const rangeValue = body.timeRange ?? body.viewMode;

      if (rangeValue !== undefined) {
        if (!isTimeRange(rangeValue)) {
          return jsonResponse(
            { error: 'Range must be week, month, quarter, rolling14, or year' },
            400,
          );
        }

        preferences.timeRange = rangeValue;
      }

      if (body.presentation !== undefined) {
        if (!isPresentation(body.presentation)) {
          return jsonResponse({ error: 'Unknown wallpaper presentation' }, 400);
        }

        preferences.presentation = body.presentation;
      }

      if (body.lockScreenProfile !== undefined) {
        if (!isLockScreenProfile(body.lockScreenProfile)) {
          return jsonResponse({ error: 'Unknown lock-screen profile' }, 400);
        }

        preferences.lockScreenProfile = body.lockScreenProfile;
      }

      if (body.timeZone !== undefined) {
        if (!isValidTimeZone(body.timeZone)) {
          return jsonResponse({ error: 'Invalid IANA time zone' }, 400);
        }

        preferences.timeZone = body.timeZone;
      }

      if (body.eventCount !== undefined) {
        if (!isEventCount(body.eventCount)) {
          return jsonResponse(
            { error: 'Event count must be a whole number from 1 to 5' },
            400,
          );
        }

        preferences.eventCount = body.eventCount;
      }

      const user = await updatePreferences(token, preferences);

      return jsonResponse({
        theme: user?.theme,
        timeRange: user?.timeRange,
        presentation: user?.presentation,
        lockScreenProfile: user?.lockScreenProfile,
        eventCount: user?.eventCount,
        preset: user ? findWallpaperPreset(user.timeRange, user.presentation) : null,
        viewMode: user?.timeRange,
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
