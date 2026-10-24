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
  it('packs Year into three columns and four fixed-gap quarter rows across calendar alignments', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (let year = 2020; year <= 2040; year += 1) {
        const model = buildWallpaperModel({
          date: new Date(`${year}-01-01T12:00:00Z`),
          timeRange: 'year',
          lockScreenProfile,
          eventCount: 5,
          publicEvents: Array.from({ length: 7 }, (_, index) => ({
            name: `Year milestone ${index}`,
            date: `${year}-12-25`,
          })),
        });
        const composition = getCalendarComposition(model)!;
        const layout = getMonthCollectionLayout(model, composition.calendarHeight);
        const stretched = getMonthCollectionLayout(
          model,
          composition.calendarHeight + 500,
        );

        expect(layout.columns).toBe(3);
        expect(layout.rows).toBe(4);
        expect(layout.geometry.dot.size).toBe(
          lockScreenProfile === 'large-clock' ? 14 : 16,
        );
        expect(layout.rowGap).toBe(lockScreenProfile === 'large-clock' ? 6 : 10);
        expect(stretched.rowLayouts).toEqual(layout.rowLayouts);
        for (const [index, row] of layout.rowLayouts.entries()) {
          expect(row.weeks).toBeGreaterThanOrEqual(5);
          expect(row.weeks).toBeLessThanOrEqual(6);
          if (index > 0) {
            const previous = layout.rowLayouts[index - 1];

            expect(row.top - previous.top - previous.height).toBeCloseTo(layout.rowGap);
          }
        }
        expect(composition.eventsTop + composition.eventsHeight).toBeLessThanOrEqual(
          LOCK_SCREEN_CONTENT_BANDS[lockScreenProfile].bottom,
        );
      }
    }
  });

  it('uses spare vertical room before choosing dense two-column events', () => {
    const publicEvents = Array.from({ length: 7 }, (_, index) => ({
      name: `Milestone ${index}`,
      date: '2026-12-25',
    }));
    const quarter = buildWallpaperModel({
      date,
      timeRange: 'quarter',
      eventCount: 3,
      publicEvents,
    });
    const crowdedQuarter = buildWallpaperModel({
      date,
      timeRange: 'quarter',
      eventCount: 5,
      publicEvents,
      lockScreenProfile: 'large-clock',
    });
    const crowdedYear = buildWallpaperModel({
      date,
      timeRange: 'year',
      eventCount: 5,
      publicEvents,
      lockScreenProfile: 'large-clock',
    });

    expect(getWallpaperEventLayout(quarter)).toMatchObject({
      limit: 3,
      columns: 1,
      rowHeight: 76,
      rowGap: 20,
      slotHeight: 300,
    });
    expect(getWallpaperEventLayout(crowdedQuarter)).toMatchObject({
      limit: 5,
      columns: 1,
      rowHeight: 68,
      rowGap: 14,
      slotHeight: 428,
    });
    expect(getWallpaperEventLayout(crowdedYear)).toMatchObject({
      limit: 5,
      columns: 2,
      rowHeight: 52,
      rowGap: 6,
      slotHeight: 204,
    });
    expect(getCalendarComposition(quarter)?.eventsTop).toBe(1680);
    expect(getCalendarComposition(crowdedQuarter)?.eventsTop).toBe(1652);
  });

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

  it('uses calendar composition for Calendar, Hybrid and Progress presentations', () => {
    for (const timeRange of TIME_RANGES) {
      for (const presentation of PRESENTATIONS) {
        if (['calendar', 'hybrid', 'progress'].includes(presentation)) {
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

          expect(layout.slotHeight).toBe(204);
          expect(bounds.eventsBottom).toBeLessThanOrEqual(band.bottom);
          expect(bounds.eventsTop! - bounds.calendarBottom!).toBe(24);
        }
      }
    }
  });
});
