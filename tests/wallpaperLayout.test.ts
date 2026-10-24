import { describe, expect, it } from 'vitest';
import { LOCK_SCREEN_PROFILES, PRESENTATIONS, TIME_RANGES } from '../lib/preferences';
import {
  getCalendarComposition,
  getCalendarRequiredHeight,
  getMonthGroupHeight,
  getWallpaperEventLayout,
  getWallpaperLayoutBounds,
  LOCK_SCREEN_CONTENT_BANDS,
} from '../lib/wallpaperLayout';
import { buildWallpaperModel } from '../lib/wallpaperModel';

const date = new Date('2026-10-24T12:00:00Z');

describe('grouped calendar composition', () => {
  it('centers the supported twelve compositions within the existing safe bands', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of ['week', 'month', 'quarter'] as const) {
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
          expect(composition.calendarHeight).toBe(required);
          expect(composition.eventsHeight).toBe(204);
          expect(composition.eventsTop - (composition.calendarTop + required)).toBe(
            lockScreenProfile === 'large-clock' ? 48 : 64,
          );
          expect(composition.calendarTop).toBe(composition.top + 72);
          expect(composition.top).toBeGreaterThanOrEqual(band.top);
          expect(composition.top + composition.height).toBeLessThanOrEqual(band.bottom);
          expect(composition.top - band.top).toBeCloseTo(
            band.bottom - (composition.top + composition.height),
          );
          expect(bounds).toMatchObject({
            calendarTop: composition.calendarTop,
            calendarBottom: composition.calendarTop + required,
            eventsTop: composition.eventsTop,
            eventsBottom: composition.eventsTop + 204,
          });
          expect(getWallpaperEventLayout(model).limit).toBe(2);
        }
      }
    }
  });

  it('fits the enlarged quarter grid and tightest large-clock month deterministically', () => {
    expect(getMonthGroupHeight('medium', true)).toBeCloseTo(379.8);
    const quarter = getCalendarComposition(
      buildWallpaperModel({ date, timeRange: 'quarter' }),
    )!;
    const month = getCalendarComposition(
      buildWallpaperModel({ date, timeRange: 'month', lockScreenProfile: 'large-clock' }),
    )!;

    expect(quarter).toMatchObject({
      top: 1140,
      height: 720,
      calendarTop: 1212,
      calendarHeight: 380,
      eventsTop: 1656,
    });
    expect(month).toMatchObject({
      top: 1176,
      height: 848,
      calendarHeight: 524,
      eventsTop: 1820,
    });
  });

  it('does not opt unrelated ranges or presentations into the new composition', () => {
    for (const timeRange of TIME_RANGES) {
      for (const presentation of PRESENTATIONS) {
        if (
          ['week', 'month', 'quarter'].includes(timeRange) &&
          ['calendar', 'hybrid'].includes(presentation)
        ) {
          continue;
        }

        expect(
          getCalendarComposition(buildWallpaperModel({ date, timeRange, presentation })),
        ).toBeNull();
      }
    }

    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of ['rolling14', 'year'] as const) {
        for (const presentation of ['calendar', 'hybrid'] as const) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
          });
          const bounds = getWallpaperLayoutBounds(model);
          const layout = getWallpaperEventLayout(model);
          const slotHeight =
            presentation === 'calendar' && lockScreenProfile === 'standard' ? 250 : 216;
          const band = LOCK_SCREEN_CONTENT_BANDS[lockScreenProfile];

          expect(layout.slotHeight).toBe(slotHeight);
          expect(bounds.eventsTop).toBe(band.bottom - slotHeight - layout.lift);
          expect(bounds.calendarBottom).toBe(bounds.eventsTop! - layout.sectionGap);
        }
      }
    }
  });
});
