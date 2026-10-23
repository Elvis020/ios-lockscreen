import { ImageResponse } from '@vercel/og';
import { isViewMode } from '../lib/preferences';
import { isRedisConfigurationError } from '../lib/redis';
import { getUser, getUserByWallpaperKey } from '../lib/tokenManager';
import { isValidDateString } from '../lib/validation';
import { buildWallpaperModel } from '../lib/wallpaperModel';

export const config = {
  runtime: 'edge',
};

const WIDTH = 1284;
const HEIGHT = 2778;

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

    const viewValue = url.searchParams.get('view');
    const dayValue = url.searchParams.get('day');
    const dayOverride = dayValue ? Number(dayValue) : undefined;
    const model = buildWallpaperModel({
      user,
      viewMode: isViewMode(viewValue) ? viewValue : 'quarter',
      themeId: url.searchParams.get('theme') ?? 'default',
      timeZone: 'UTC',
      publicEvents: parsePublicEvents(url.searchParams.get('events')),
      dayOverride,
    });
    const { period, theme, cells, events, columns } = model;
    const rows = Math.ceil(cells.length / columns);
    const dotSize = Math.min(
      period.mode === 'quarter' ? 72 : period.mode === 'month' ? 92 : 112,
      Math.floor((WIDTH - 240) / columns) - 22,
      Math.floor(980 / rows) - 22,
    );
    const spacing = period.mode === 'quarter' ? 28 : 34;
    const gridWidth = columns * dotSize + (columns - 1) * spacing;
    const gridHeight = rows * dotSize + (rows - 1) * spacing;
    const gridY = events.length > 3 ? 560 : 650;
    const eventTop = gridY + gridHeight + 110;
    const dots = cells.map((cell, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const centerX = column * (dotSize + spacing) + dotSize / 2 + 12;
      const centerY = row * (dotSize + spacing) + dotSize / 2 + 12;
      const fill = cell.current
        ? theme.current
        : cell.passed
          ? cell.weekend
            ? theme.weekend
            : theme.passed
          : theme.future;

      return (
        <g key={cell.date}>
          {cell.event && !cell.current ? (
            <circle
              cx={centerX}
              cy={centerY}
              r={dotSize / 2 + 7}
              fill="transparent"
              stroke={theme.current}
              strokeWidth={4}
            />
          ) : null}
          <circle cx={centerX} cy={centerY} r={dotSize / 2} fill={fill} />
        </g>
      );
    });
    const title = url.searchParams.get('title')?.slice(0, 40) || period.title;
    const response = new ImageResponse(
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          backgroundColor: theme.background,
          color: theme.text,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: gridY - 150,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 600 }}>{title}</div>
          <div style={{ display: 'flex', fontSize: 28, color: theme.subtext }}>
            {period.percentComplete}% complete · {period.daysLeft} days left
          </div>
        </div>

        <svg
          width={gridWidth + 24}
          height={gridHeight + 24}
          viewBox={`0 0 ${gridWidth + 24} ${gridHeight + 24}`}
          style={{ position: 'absolute', top: gridY, overflow: 'visible' }}
        >
          {dots}
        </svg>

        {events.length ? (
          <div
            style={{
              position: 'absolute',
              top: eventTop,
              width: Math.min(gridWidth, 960),
              display: 'flex',
              flexDirection: 'column',
              gap: events.length > 3 ? 20 : 28,
            }}
          >
            {events.map((event) => (
              <div
                key={event.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 20,
                    fontSize: events.length > 3 ? 28 : 32,
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      maxWidth: gridWidth - 120,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {event.name}
                  </span>
                  <span style={{ display: 'flex', color: theme.subtext }}>
                    {event.daysLeft}d
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    width: '100%',
                    height: 10,
                    borderRadius: 6,
                    backgroundColor: theme.future,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      width: `${event.progressPercent}%`,
                      height: '100%',
                      backgroundColor: theme.current,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>,
      { width: WIDTH, height: HEIGHT },
    );

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
