import { describe, expect, it } from 'vitest';
import {
  EVENT_COUNTS,
  LOCK_SCREEN_PROFILES,
  PRESENTATIONS,
  TIME_RANGES,
} from '../lib/preferences';
import { dateAtPeriodDay } from '../lib/periodCalculator';
import {
  CONTENT_LEFT,
  CONTENT_RIGHT,
  FIRST_DOT_TOP,
  getCalendarComposition,
  getCalendarRequiredHeight,
  getContinuousDotGridLayout,
  getWallpaperEventLayout,
  getWallpaperLayoutBounds,
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_WIDTH,
} from '../lib/wallpaperLayout';
import { buildWallpaperModel } from '../lib/wallpaperModel';

const date = new Date('2026-10-24T12:00:00Z');
const publicEvents = Array.from({ length: 7 }, (_, index) => ({
  name: `Milestone ${index}`,
  date: '2026-12-25',
}));

describe('continuous dot progress layout', () => {
  it.each([
    ['week', '2026-10-24', 7, 7],
    ['rolling14', '2026-12-25', 14, 7],
    ['month', '2026-02-15', 28, 7],
    ['month', '2028-02-15', 29, 7],
    ['month', '2026-04-15', 30, 7],
    ['month', '2026-10-24', 31, 7],
    ['quarter', '2026-01-15', 90, 10],
    ['quarter', '2026-04-15', 91, 10],
    ['quarter', '2026-10-24', 92, 10],
    ['year', '2026-10-24', 365, 20],
    ['year', '2028-10-24', 366, 20],
  ] as const)(
    'draws exactly the %s period length for %s',
    (timeRange, day, count, columns) => {
      for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
        const model = buildWallpaperModel({
          date: new Date(`${day}T12:00:00Z`),
          timeRange,
          lockScreenProfile,
        });
        const grid = getContinuousDotGridLayout(model);

        expect(model.cells).toHaveLength(count);
        expect(grid.positions).toHaveLength(count);
        expect(grid.columns).toBe(columns);
        expect(grid.rows).toBe(Math.ceil(count / columns));
        expect(grid.top + grid.positions[0].y).toBe(FIRST_DOT_TOP[lockScreenProfile]);
        for (const [index, cell] of model.cells.entries()) {
          expect(cell.date).toBe(dateAtPeriodDay(model.period.startDate, index + 1));
          expect(grid.positions[index]).toEqual({
            x: grid.positions[0].x + (index % columns) * grid.pitchX,
            y: grid.positions[0].y + Math.floor(index / columns) * grid.pitchY,
          });
        }
        // The last partial row starts at column zero, not a weekday/month offset.
        expect(grid.positions[Math.floor((count - 1) / columns) * columns].x).toBe(
          grid.positions[0].x,
        );
      }
    },
  );

  it('keeps pixel-aligned dots and event-ring envelopes inside the grid with visible separation', () => {
    for (const timeRange of TIME_RANGES) {
      for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
        const model = buildWallpaperModel({ date, timeRange, lockScreenProfile });
        const grid = getContinuousDotGridLayout(model);
        const outset = grid.eventRingGap + grid.eventRingWidth;
        const diameter = grid.size + outset * 2;

        expect(grid.pitchX).toBeGreaterThan(diameter);
        expect(grid.pitchY).toBeGreaterThan(diameter);
        for (const position of grid.positions) {
          expect([position.x, position.y, grid.size].every(Number.isInteger)).toBe(true);
          expect(position.x - outset).toBeGreaterThanOrEqual(0);
          expect(position.x + grid.size + outset).toBeLessThanOrEqual(
            WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT,
          );
          expect(position.y - outset).toBeGreaterThanOrEqual(0);
          expect(position.y + grid.size + outset).toBeLessThanOrEqual(grid.height);
        }
      }
    }
  });

  it('does not shrink or reposition the dot matrix when event count or presentation changes', () => {
    for (const timeRange of TIME_RANGES) {
      for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
        const expected = getContinuousDotGridLayout(
          buildWallpaperModel({ date, timeRange, lockScreenProfile }),
        );

        for (const presentation of ['calendar', 'hybrid', 'progress'] as const) {
          for (const eventCount of EVENT_COUNTS) {
            const model = buildWallpaperModel({
              date,
              timeRange,
              lockScreenProfile,
              presentation,
              eventCount,
              publicEvents,
            });
            const grid = getContinuousDotGridLayout(model);
            const composition = getCalendarComposition(model)!;
            const bounds = getWallpaperLayoutBounds(model);
            const events = getWallpaperEventLayout(model);

            expect(grid).toEqual(expected);
            expect(composition.calendarTop).toBe(grid.top);
            expect(getCalendarRequiredHeight(model)).toBe(grid.height);
            expect(composition.calendarHeight).toBeGreaterThanOrEqual(grid.height);
            expect(composition.top).toBe(FIRST_DOT_TOP[lockScreenProfile] - 80);
            expect(composition.eventsTop).toBeGreaterThanOrEqual(
              grid.top + grid.height + 24,
            );
            expect(composition.eventsTop + composition.eventsHeight).toBeLessThanOrEqual(
              2080,
            );
            expect(events.limit).toBe(eventCount);
            expect(events.contentHeight).toBeLessThanOrEqual(events.slotHeight);
            expect(bounds.contentTop).toBe(composition.top);
          }
        }
      }
    }
  });

  it('preserves full-width rows when possible and uses dense event rows only when needed', () => {
    const options = {
      date,
      publicEvents,
      eventCount: 5,
      lockScreenProfile: 'large-clock' as const,
    };
    const week = buildWallpaperModel({ ...options, timeRange: 'week' });
    const quarter = buildWallpaperModel({ ...options, timeRange: 'quarter' });

    expect(getWallpaperEventLayout(week)).toMatchObject({ columns: 1, rowHeight: 76 });
    expect(getWallpaperEventLayout(quarter)).toMatchObject({
      columns: 2,
      rowHeight: 52,
      slotHeight: 204,
    });
  });

  it('retains Countdown and legacy presentation bands without adding a dot grid', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const presentation of PRESENTATIONS) {
        if (presentation !== 'countdown') {
          continue;
        }

        const model = buildWallpaperModel({ date, lockScreenProfile, presentation });

        expect(getCalendarComposition(model)).toBeNull();
        expect(getWallpaperLayoutBounds(model).contentTop).toBe(
          LOCK_SCREEN_CONTENT_BANDS[lockScreenProfile].top,
        );
      }
    }
  });
});
