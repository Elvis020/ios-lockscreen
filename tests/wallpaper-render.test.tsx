import { describe, expect, it } from 'vitest';
import {
  LOCK_SCREEN_PROFILES,
  PRESENTATIONS,
  TIME_RANGES,
  WALLPAPER_PRESET_IDS,
  WALLPAPER_PRESETS,
} from '../lib/preferences';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import {
  CALENDAR_DOT_GEOMETRY,
  createWallpaperImageResponse,
  getCalendarRequiredHeight,
  getWallpaperHeaderCopy,
  getWallpaperLayoutBounds,
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
} from '../lib/wallpaperRenderer';

const date = new Date('2026-10-23T12:00:00Z');
const events = [
  { name: 'Today event', date: '2026-10-23' },
  { name: 'Tomorrow event', date: '2026-10-24' },
  { name: 'Design critique', date: '2026-10-27' },
  { name: 'Quarterly check-in', date: '2026-11-12' },
  { name: 'Team offsite', date: '2026-12-04' },
  { name: 'Annual planning', date: '2027-01-08' },
  { name: 'Strategy review', date: '2027-02-02' },
];

describe('wallpaper renderer', () => {
  it('materializes native-size PNGs for all nine presets and both profiles', async () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const presetId of WALLPAPER_PRESET_IDS) {
        const preset = WALLPAPER_PRESETS[presetId];
        const model = buildWallpaperModel({
          date,
          timeRange: preset.timeRange,
          presentation: preset.presentation,
          lockScreenProfile,
          publicEvents: events,
        });
        const response = createWallpaperImageResponse(model);
        const bytes = new Uint8Array(await response.arrayBuffer());

        expect(response.headers.get('content-type')).toContain('image/png');
        expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(readPngDimension(bytes, 16)).toBe(WALLPAPER_WIDTH);
        expect(readPngDimension(bytes, 20)).toBe(WALLPAPER_HEIGHT);
        expect(bytes.length).toBeGreaterThan(10_000);
      }
    }
  }, 60_000);

  it('builds every range and presentation combination', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of TIME_RANGES) {
        for (const presentation of PRESENTATIONS) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
            publicEvents: events,
          });

          expect(model.timeRange).toBe(timeRange);
          expect(model.presentation).toBe(presentation);
          expect(model.cells.length).toBeGreaterThan(0);

          const bounds = getWallpaperLayoutBounds(model);
          const profileBand = LOCK_SCREEN_CONTENT_BANDS[lockScreenProfile];

          expect(bounds.contentTop).toBeGreaterThanOrEqual(profileBand.top);
          expect(bounds.contentBottom).toBeLessThanOrEqual(profileBand.bottom);
          expect(bounds.presentationTop).toBeGreaterThanOrEqual(profileBand.top);
          expect(bounds.presentationBottom).toBeLessThanOrEqual(profileBand.bottom);

          if (bounds.calendarTop !== undefined && bounds.calendarBottom !== undefined) {
            const compact = presentation === 'hybrid';
            const availableHeight = bounds.calendarBottom - bounds.calendarTop;

            expect(getCalendarRequiredHeight(model, compact)).toBeLessThanOrEqual(
              availableHeight,
            );
          }

          if (bounds.eventsTop !== undefined && bounds.eventsBottom !== undefined) {
            expect(bounds.eventsTop).toBeGreaterThanOrEqual(profileBand.top);
            expect(bounds.eventsBottom).toBeLessThanOrEqual(profileBand.bottom);
          }
        }
      }
    }
  });

  it('uses crisp integer circle geometry and visible event rings at every scale', () => {
    expect(CALENDAR_DOT_GEOMETRY.shape).toBe('circle');

    for (const geometry of [
      CALENDAR_DOT_GEOMETRY.week,
      CALENDAR_DOT_GEOMETRY.month,
      CALENDAR_DOT_GEOMETRY.quarter,
      CALENDAR_DOT_GEOMETRY.year,
    ]) {
      expect(Number.isInteger(geometry.size)).toBe(true);
      expect(Number.isInteger(geometry.eventRingGap)).toBe(true);
      expect(geometry.eventRingWidth).toBeGreaterThanOrEqual(2);
    }

    expect(CALENDAR_DOT_GEOMETRY.quarter.size).toBeGreaterThanOrEqual(26);
    expect(CALENDAR_DOT_GEOMETRY.year.size).toBeGreaterThanOrEqual(14);
  });

  it('uses presentation-aware header copy without repeating progress metrics', () => {
    const progress = buildWallpaperModel({
      date,
      timeRange: 'year',
      presentation: 'progress',
    });
    const minimal = buildWallpaperModel({
      date,
      timeRange: 'month',
      presentation: 'minimal',
    });
    const countdown = buildWallpaperModel({
      date,
      timeRange: 'year',
      presentation: 'countdown',
    });

    expect(getWallpaperHeaderCopy(progress).subtitle).not.toMatch(/%|days? left/);
    expect(getWallpaperHeaderCopy(minimal).subtitle).not.toMatch(/%|days? left/);
    expect(getWallpaperHeaderCopy(countdown)).toEqual({
      title: 'Next event',
      subtitle: 'As of Oct 23, 2026',
    });
    expect(getWallpaperHeaderCopy(countdown, 'Launch focus').title).toBe('Launch focus');
  });

  it('keeps calibrated content bands above the notification region', () => {
    expect(LOCK_SCREEN_CONTENT_BANDS.standard).toEqual({ top: 920, bottom: 2080 });
    expect(LOCK_SCREEN_CONTENT_BANDS['large-clock']).toEqual({
      top: 1120,
      bottom: 2080,
    });
  });
});

function readPngDimension(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}
