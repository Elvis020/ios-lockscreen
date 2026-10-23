import {
  isLockScreenProfile,
  isPresentation,
  isTimeRange,
  isWallpaperPreset,
  WALLPAPER_PRESETS,
  type LockScreenProfile,
  type Presentation,
  type TimeRange,
} from '../lib/preferences';
import { isRedisConfigurationError } from '../lib/redis';
import { getUser, getUserByWallpaperKey } from '../lib/tokenManager';
import { isValidDateString } from '../lib/validation';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import { createWallpaperImageResponse } from '../lib/wallpaperRenderer';

export const config = {
  runtime: 'edge',
};

interface PublicEvent {
  name: string;
  date: string;
}

export default async function handler(req: Request) {
  try {
    const url = new URL(req.url);
    const wallpaperKey = url.searchParams.get('wallpaperKey');
    const legacyToken = url.searchParams.get('token');
    const personalized = Boolean(wallpaperKey || legacyToken);
    const user = wallpaperKey
      ? await getUserByWallpaperKey(wallpaperKey)
      : legacyToken
        ? await getUser(legacyToken)
        : null;

    if (personalized && !user) {
      return new Response('Invalid wallpaper credential', {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const selection = resolvePublicSelection(url);
    const dayValue = url.searchParams.get('day');
    const dayOverride = dayValue ? Number(dayValue) : undefined;
    const model = buildWallpaperModel({
      user,
      ...selection,
      themeId: url.searchParams.get('theme') ?? 'default',
      timeZone: 'UTC',
      publicEvents: parsePublicEvents(url.searchParams.get('events')),
      dayOverride,
    });
    const response = createWallpaperImageResponse(model, {
      title: url.searchParams.get('title')?.slice(0, 40),
    });

    setCacheHeaders(response, personalized);

    return response;
  } catch (error) {
    console.error('Error generating wallpaper:', error);

    if (isRedisConfigurationError(error)) {
      return new Response('Personalized wallpapers are temporarily unavailable', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return new Response('Error generating wallpaper', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function resolvePublicSelection(url: URL): {
  timeRange: TimeRange;
  presentation: Presentation;
  lockScreenProfile: LockScreenProfile;
} {
  const viewValue = url.searchParams.get('preset') ?? url.searchParams.get('view');
  const preset = isWallpaperPreset(viewValue)
    ? WALLPAPER_PRESETS[viewValue]
    : WALLPAPER_PRESETS.quarter;
  const rangeValue = url.searchParams.get('range');
  const presentationValue = url.searchParams.get('presentation');
  const profileValue = url.searchParams.get('profile');

  return {
    timeRange: isTimeRange(rangeValue) ? rangeValue : preset.timeRange,
    presentation: isPresentation(presentationValue)
      ? presentationValue
      : preset.presentation,
    lockScreenProfile: isLockScreenProfile(profileValue) ? profileValue : 'standard',
  };
}

function parsePublicEvents(value: string | null): PublicEvent[] {
  if (!value) {
    return [];
  }

  return value.split(',').flatMap((pair) => {
    const separator = pair.lastIndexOf(':');

    if (separator <= 0) {
      return [];
    }

    const encodedName = pair.slice(0, separator).trim();
    const date = pair.slice(separator + 1).trim();

    if (!encodedName || !isValidDateString(date)) {
      return [];
    }

    try {
      return [{ name: decodeURIComponent(encodedName).slice(0, 50), date }];
    } catch {
      return [{ name: encodedName.slice(0, 50), date }];
    }
  });
}

function setCacheHeaders(response: Response, personalized: boolean): void {
  if (personalized) {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('CDN-Cache-Control', 'private, no-store');
    response.headers.set('Vercel-CDN-Cache-Control', 'private, no-store');

    return;
  }

  response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  response.headers.set('CDN-Cache-Control', 'public, s-maxage=3600');
  response.headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=3600');
}
