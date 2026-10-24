import { describe, expect, it } from 'vitest';
import { LOCK_SCREEN_PROFILES, PRESENTATIONS, TIME_RANGES } from '../lib/preferences';
import {
  getCalendarComposition,
  getCalendarRequiredHeight,
  getMonthGeometry,
  getMonthGroupHeight,
  getMonthCollectionLayout,
  getWallpaperEventLayout,
  getWallpaperLayoutBounds,
  LOCK_SCREEN_CONTENT_BANDS,
} from '../lib/wallpaperLayout';
import { buildWallpaperModel } from '../lib/wallpaperModel';

const date = new Date('2026-10-24T12:00:00Z');

describe('grouped calendar composition', () => {
  it('anchors every calendar range below the clock and positions events independently', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of TIME_RANGES) {
        for (const presentation of ['calendar', 'hybrid'] as const) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
          });
          const composition = getCalendarComposition(model)!;
          const bounds = getWallpaperLayoutBounds(model);
          const band = LOCK_SCREEN_CONTENT_BANDS[lockScreenProfile];
          const required = getCalendarRequiredHeight(model, presentation === 'hybrid');

          expect(composition.headerHeight).toBe(64);
          expect(composition.headerGap).toBe(8);
          expect(composition.calendarHeight).toBeGreaterThanOrEqual(required);
          expect(composition.eventsHeight).toBe(204);
          expect(composition.eventGap).toBe(24);
          expect(composition.calendarTop).toBe(composition.top + 72);
          expect(composition.top).toBe(band.top);
          expect(composition.top + composition.height).toBeLessThanOrEqual(band.bottom);
          expect(bounds).toMatchObject({
            calendarTop: composition.calendarTop,
            calendarBottom: composition.calendarTop + composition.calendarHeight,
            eventsTop: composition.eventsTop,
            eventsBottom: composition.eventsTop + 204,
          });
          expect(getWallpaperEventLayout(model).limit).toBe(2);
        }
      }
    }
  });

  it('fits the enlarged quarter grid and tightest large-clock month deterministically', () => {
    expect(getMonthGroupHeight('medium', true, true)).toBeCloseTo(427.8);
    const quarter = getCalendarComposition(
      buildWallpaperModel({ date, timeRange: 'quarter' }),
    )!;
    const month = getCalendarComposition(
      buildWallpaperModel({ date, timeRange: 'month', lockScreenProfile: 'large-clock' }),
    )!;

    expect(quarter).toMatchObject({
      top: 920,
      height: 964,
      calendarTop: 992,
      calendarHeight: 664,
      eventsTop: 1680,
    });
    expect(month).toMatchObject({
      top: 1120,
      height: 896,
      calendarHeight: 596,
      eventsTop: 1812,
    });
    const model = buildWallpaperModel({ date, timeRange: 'quarter' });

    expect(
      getMonthCollectionLayout(model, quarter.calendarHeight).geometry.cellHeight,
    ).toBe(72);
  });

  it('adds vertical breathing room only to the grouped month and quarter grids', () => {
    for (const [scale, roomyHeight, legacyHeight] of [
      ['large', 100, 88],
      ['large-compact', 90, 78],
      ['medium', 52, 44],
      ['dots', 24, 24],
      ['dots-compact', 22, 22],
    ] as const) {
      expect(getMonthGeometry(scale, true).cellHeight).toBe(roomyHeight);
      expect(getMonthGeometry(scale).cellHeight).toBe(legacyHeight);
      expect(getMonthGeometry(scale, true).dot).toEqual(getMonthGeometry(scale).dot);
    }
  });

  it('uses calendar composition only for calendar and hybrid presentations', () => {
    for (const timeRange of TIME_RANGES) {
      for (const presentation of PRESENTATIONS) {
        if (['calendar', 'hybrid'].includes(presentation)) {
          continue;
        }

        expect(
          getCalendarComposition(buildWallpaperModel({ date, timeRange, presentation })),
        ).toBeNull();
      }
    }

    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of TIME_RANGES) {
        for (const presentation of ['calendar', 'hybrid', 'progress'] as const) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
          });
          const bounds = getWallpaperLayoutBounds(model);
          const layout = getWallpaperEventLayout(model);
          const band = LOCK_SCREEN_CONTENT_BANDS[lockScreenProfile];

          expect(
            getCalendarRequiredHeight(model, presentation === 'hybrid'),
          ).toBeLessThanOrEqual(bounds.calendarBottom! - bounds.calendarTop!);

          if (presentation !== 'progress') {
            expect(layout.slotHeight).toBe(204);
            expect(bounds.eventsBottom).toBeLessThanOrEqual(band.bottom);
            expect(bounds.eventsTop! - bounds.calendarBottom!).toBe(24);
          }
        }
      }
    }
  });
});
