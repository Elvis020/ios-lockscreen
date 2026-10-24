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
  CALENDAR_DOT_GEOMETRY,
  DOT_EVENTS_GAP,
  MAX_DOT_EVENTS_GAP,
  FIRST_DOT_TOP,
  getCalendarComposition,
  getCalendarRequiredHeight,
  getContinuousDotGridLayout,
  getWallpaperEventLayout,
  getWallpaperHeaderCopy,
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
    ['year', '2026-10-24', 365, 22],
    ['year', '2028-10-24', 366, 22],
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

  it.each([0, 1, 7])(
    'fits bounded dots and selected rows with %i actual events',
    (actualCount) => {
      for (const timeRange of TIME_RANGES) {
        for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
          for (const eventCount of EVENT_COUNTS) {
            const options = {
              date,
              timeRange,
              lockScreenProfile,
              eventCount,
              publicEvents: publicEvents.slice(0, actualCount),
            };
            const expected = getContinuousDotGridLayout(buildWallpaperModel(options));

            for (const presentation of ['calendar', 'hybrid', 'progress'] as const) {
              const model = buildWallpaperModel({ ...options, presentation });
              const grid = getContinuousDotGridLayout(model);
              const composition = getCalendarComposition(model)!;
              const bounds = getWallpaperLayoutBounds(model);
              const events = getWallpaperEventLayout(model);
              const geometry =
                CALENDAR_DOT_GEOMETRY[timeRange === 'rolling14' ? 'week' : timeRange];
              const outset = grid.eventRingGap + grid.eventRingWidth;

              expect(grid).toEqual(expected);
              expect(grid.size).toBeGreaterThanOrEqual(geometry.minSize);
              expect(grid.size).toBeLessThanOrEqual(geometry.size);
              expect(grid.size % 2).toBe(0);
              expect(grid.pitchX - grid.size).toBeGreaterThanOrEqual(geometry.gapX[0]);
              expect(grid.pitchX - grid.size).toBeLessThanOrEqual(geometry.gapX[1]);
              expect(grid.pitchY - grid.size).toBeGreaterThanOrEqual(geometry.gapY[0]);
              expect(grid.pitchY - grid.size).toBeLessThanOrEqual(geometry.gapY[1]);
              expect(grid.pitchX).toBeGreaterThan(grid.size + 2 * outset);
              expect(grid.pitchY).toBeGreaterThan(grid.size + 2 * outset);
              expect(grid.width).toBeGreaterThanOrEqual(890);
              expect(grid.width).toBeLessThanOrEqual(1060);
              expect(composition.calendarTop).toBe(grid.top);
              expect(getCalendarRequiredHeight(model)).toBe(grid.height);
              expect(composition.calendarHeight).toBeGreaterThanOrEqual(grid.height);
              expect(grid.top + grid.positions[0].y).toBe(
                FIRST_DOT_TOP[lockScreenProfile],
              );
              expect(composition.top).toBe(
                grid.top - composition.headerHeight - composition.headerGap,
              );
              expect(
                composition.eventsTop - grid.top - grid.height,
              ).toBeGreaterThanOrEqual(DOT_EVENTS_GAP);
              expect(composition.eventsTop - grid.top - grid.height).toBeLessThanOrEqual(
                MAX_DOT_EVENTS_GAP,
              );
              expect(
                composition.eventsTop + composition.eventsHeight,
              ).toBeLessThanOrEqual(2080);
              expect(events.limit).toBe(eventCount);
              expect(events.visibleCount).toBe(Math.min(actualCount, eventCount));
              expect(events.overflow).toBe(Math.max(0, actualCount - eventCount));
              expect(events.contentHeight).toBeLessThanOrEqual(events.slotHeight);
              expect(bounds.contentTop).toBe(composition.top);
              for (const position of grid.positions) {
                expect([position.x, position.y, grid.size].every(Number.isInteger)).toBe(
                  true,
                );
                expect(position.x - outset).toBeGreaterThanOrEqual(0);
                expect(position.x + grid.size + outset).toBeLessThanOrEqual(1060);
                expect(position.y - outset).toBeGreaterThanOrEqual(0);
                expect(position.y + grid.size + outset).toBeLessThanOrEqual(grid.height);
              }
            }
          }
        }
      }
    },
  );

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
      slotHeight: 194,
    });
  });

  it('adapts Quarter to the actual rail while making Year larger and less horizontally airy', () => {
    const options = {
      date,
      timeRange: 'quarter' as const,
      lockScreenProfile: 'large-clock' as const,
      publicEvents,
    };
    const single = getContinuousDotGridLayout(
      buildWallpaperModel({ ...options, eventCount: 1 }),
    );
    const five = getContinuousDotGridLayout(
      buildWallpaperModel({ ...options, eventCount: 5 }),
    );
    const year = getContinuousDotGridLayout(
      buildWallpaperModel({ ...options, timeRange: 'year', eventCount: 5 }),
    );

    expect(single.size).toBeGreaterThan(five.size);
    expect(year).toMatchObject({
      columns: 22,
      rows: 17,
      size: 32,
      pitchX: 48,
      pitchY: 44,
    });
    expect(year.pitchX - year.size).toBeLessThan(30);
    expect(FIRST_DOT_TOP).toEqual({ standard: 832, 'large-clock': 1032 });
  });

  it.each([
    ['week', '2026-10-24T12:00:00Z', 'October · 0% left · 0 days left'],
    ['month', '2026-10-24T12:00:00Z', 'October · 23% left · 7 days left'],
    ['quarter', '2026-10-24T12:00:00Z', 'October · 74% left · 68 days left'],
    ['year', '2026-10-24T12:00:00Z', 'October · 19% left · 68 days left'],
    ['rolling14', '2026-12-25T12:00:00Z', 'December · 93% left · 13 days left'],
    ['month', '2026-10-30T12:00:00Z', 'October · 3% left · 1 day left'],
    ['month', '2026-10-31T12:00:00Z', 'October · 0% left · 0 days left'],
    ['month', '2028-02-28T12:00:00Z', 'February · 3% left · 1 day left'],
    ['quarter', '2026-11-30T12:00:00Z', 'November · 34% left · 31 days left'],
  ] as const)(
    'centers month-first remaining copy for %s on %s',
    (timeRange, instant, subtitle) => {
      for (const presentation of ['calendar', 'hybrid', 'progress'] as const) {
        const model = buildWallpaperModel({
          date: new Date(instant),
          timeRange,
          presentation,
        });

        expect(getWallpaperHeaderCopy(model)).toEqual({ title: null, subtitle });
        expect(getWallpaperHeaderCopy(model, 'Custom title')).toEqual({
          title: 'Custom title',
        });
      }
    },
  );

  it('uses the account-local month, not the UTC or period-start month', () => {
    const model = buildWallpaperModel({
      date: new Date('2026-11-01T00:30:00Z'),
      timeRange: 'year',
      timeZone: 'America/Los_Angeles',
    });

    expect(getWallpaperHeaderCopy(model).subtitle).toMatch(/^October ·/);
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
