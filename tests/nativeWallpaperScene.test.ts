import { describe, expect, it } from 'vitest';
import {
  buildNativeWallpaperScene,
  NativeSceneBudgetError,
} from '../lib/nativeWallpaperScene';
import { LOCK_SCREEN_PROFILES, PRESENTATIONS, TIME_RANGES } from '../lib/preferences';
import {
  CALENDAR_DOT_GEOMETRY,
  getCalendarComposition,
  getMonthGeometry,
  getMonthCollectionLayout,
  getWallpaperEventLayout,
  getWallpaperLayoutBounds,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
} from '../lib/wallpaperLayout';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import { dateAtPeriodDay } from '../lib/periodCalculator';

const date = new Date('2026-10-24T12:00:00Z');
const publicEvents = [
  { name: 'Réunion 🎉', date: '2026-10-24' },
  { name: 'Product launch', date: '2026-11-14' },
  { name: 'Team offsite', date: '2026-12-19' },
];

describe('native wallpaper scene', () => {
  it('builds all sixty range, presentation and profile combinations inside the clock-safe band', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of TIME_RANGES) {
        for (const presentation of PRESENTATIONS) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
            publicEvents,
          });
          const scene = buildNativeWallpaperScene(model);
          const bounds = getWallpaperLayoutBounds(model);
          const text = scene.commands.filter((command) => command.kind === 'text');

          expect(scene).toMatchObject({
            version: 1,
            width: WALLPAPER_WIDTH,
            height: WALLPAPER_HEIGHT,
          });
          expect(scene.commands.length).toBeLessThan(600);
          const visible = model.events.slice(0, getWallpaperEventLayout(model).limit);

          for (const event of visible) {
            expect(text.map(({ value }) => value)).toContain(event.name);
          }

          for (const command of scene.commands) {
            const width = command.kind === 'circle' ? command.diameter : command.width;
            const height = command.kind === 'circle' ? command.diameter : command.height;

            expect([command.x, command.y, width, height].every(Number.isFinite)).toBe(
              true,
            );
            expect(command.x).toBeGreaterThanOrEqual(0);
            expect(command.x + width).toBeLessThanOrEqual(scene.width);
            expect(command.y).toBeGreaterThanOrEqual(bounds.contentTop);
            expect(command.y + height).toBeLessThanOrEqual(bounds.contentBottom);

            if (command.kind === 'circle') {
              expect(
                [command.x, command.y, command.diameter].every(Number.isInteger),
              ).toBe(true);
              expect(command.y).toBeGreaterThanOrEqual(bounds.calendarTop as number);
              expect(command.y + height).toBeLessThanOrEqual(
                bounds.calendarBottom as number,
              );
            }
          }

          const timers = scene.commands.filter(
            (command) => command.kind === 'roundRect' && command.height === 3,
          );

          expect(timers).toHaveLength(
            presentation === 'countdown' ? 0 : visible.length * 2,
          );
          expect(
            timers.every(
              (command) =>
                command.kind === 'roundRect' &&
                command.height === 3 &&
                command.radius === 1.5,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it('retains every calendar dot, current-day fill and event-marker ring', () => {
    const model = buildWallpaperModel({ date, timeRange: 'quarter', publicEvents });
    const scene = buildNativeWallpaperScene(model);
    const circles = scene.commands.filter((command) => command.kind === 'circle');
    const dots = circles.filter(({ diameter }) => diameter === 32);

    expect(CALENDAR_DOT_GEOMETRY.quarter.size).toBe(32);
    expect(dots).toHaveLength(92);
    expect(dots.filter(({ fill }) => fill === model.theme.current)).toHaveLength(1);
    expect(circles.filter(({ diameter }) => diameter === 42)).toHaveLength(3);
    expect(circles.filter(({ diameter }) => diameter === 38)).toHaveLength(3);
  });

  it('groups the summary and calendar, lifts the event block, and clarifies small labels', () => {
    const model = buildWallpaperModel({ date, timeRange: 'quarter', publicEvents });
    const scene = buildNativeWallpaperScene(model);
    const composition = getCalendarComposition(model)!;
    const text = scene.commands.filter((command) => command.kind === 'text');
    const summary = text.find(({ value }) => value === '26% complete · 68 days left')!;
    const october = text.find(({ value }) => value === 'October')!;
    const weekdays = text.filter(({ value }) =>
      ['S', 'M', 'T', 'W', 'F'].includes(value),
    );
    const countdown = text.find(({ value }) => value === '21d')!;

    expect(october.y - (summary.y + summary.height)).toBeLessThan(40);
    expect(composition.eventsTop).toBeLessThan(1798);
    expect(summary).toMatchObject({ size: 30, align: 'center' });
    expect(
      weekdays.every(({ size, color }) => size === 22 && color === model.theme.text),
    ).toBe(true);
    expect(countdown).toMatchObject({
      size: 30,
      color: model.theme.text,
      align: 'right',
    });
    expect(getMonthGeometry('medium', true).cellHeight).toBe(52);
  });

  it('uses the roomier row pitch without changing dot size', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of ['month', 'quarter'] as const) {
        for (const presentation of ['calendar', 'hybrid'] as const) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
          });
          const size =
            timeRange === 'quarter' ? 32 : lockScreenProfile === 'standard' ? 68 : 64;
          const pitch =
            timeRange === 'quarter' ? 72 : lockScreenProfile === 'standard' ? 100 : 90;
          const composition = getCalendarComposition(model)!;

          expect(
            getMonthCollectionLayout(model, composition.calendarHeight).geometry
              .cellHeight,
          ).toBe(pitch);
          const dots = buildNativeWallpaperScene(model).commands.filter(
            (command) => command.kind === 'circle' && command.diameter === size,
          );
          const rows = [...new Set(dots.map(({ y }) => y))].sort((a, b) => a - b);

          expect(dots).toHaveLength(timeRange === 'quarter' ? 92 : 31);
          expect(rows.length).toBeGreaterThan(1);

          for (let index = 1; index < rows.length; index += 1) {
            expect(rows[index] - rows[index - 1]).toBe(pitch);
          }
        }
      }
    }
  });

  it('keeps both pixel-aligned event rings concentric with their dot', () => {
    const scene = buildNativeWallpaperScene(buildWallpaperModel({ date, publicEvents }));
    const index = scene.commands.findIndex(
      (command) => command.kind === 'circle' && command.diameter === 42,
    );
    const layers = scene.commands
      .slice(index, index + 3)
      .filter((command) => command.kind === 'circle');

    expect(layers.map(({ diameter }) => diameter)).toEqual([42, 38, 32]);
    const center = { x: layers[0].x + 21, y: layers[0].y + 21 };

    for (const layer of layers) {
      expect({
        x: layer.x + layer.diameter / 2,
        y: layer.y + layer.diameter / 2,
      }).toEqual(center);
    }
  });

  it('keeps event markers separated even on adjacent event days', () => {
    const model = buildWallpaperModel({
      date,
      publicEvents: [
        { name: 'First event', date: '2026-11-12' },
        { name: 'Second event', date: '2026-11-13' },
      ],
    });
    const { size, eventRingGap, eventRingWidth } = CALENDAR_DOT_GEOMETRY.quarter;
    const outerDiameter = size + 2 * (eventRingGap + eventRingWidth);
    const scene = buildNativeWallpaperScene(model);
    const rings = scene.commands.filter(
      (command) => command.kind === 'circle' && command.diameter === outerDiameter,
    );

    expect(outerDiameter).toBeLessThan(getMonthGeometry('medium', true).cellHeight);
    expect(rings).toHaveLength(2);
    expect(rings[0].y).toBe(rings[1].y);
    expect(Math.abs(rings[1].x - rings[0].x)).toBeGreaterThan(outerDiameter);
  });

  it('keeps full month names, weekdays and the centered quarter summary without dates', () => {
    const scene = buildNativeWallpaperScene(buildWallpaperModel({ date, publicEvents }));
    const text = scene.commands.filter((command) => command.kind === 'text');
    const values = text.map(({ value }) => value);

    expect(values).toEqual(expect.arrayContaining(['October', 'November', 'December']));
    expect(values).not.toContain('Oct');
    expect(values).not.toContain('Q4 2026');
    expect(text.find(({ value }) => value === '26% complete · 68 days left')?.align).toBe(
      'center',
    );
    expect(values.filter((value) => value === 'S')).toHaveLength(6);
    expect(values.join(' ')).not.toMatch(/2026-\d{2}-\d{2}|Nov 14|Dec 19/);
    expect(Object.keys(scene).sort()).toEqual([
      'background',
      'commands',
      'height',
      'version',
      'width',
    ]);
  });

  it('does not duplicate the single-month label and handles empty events', () => {
    const scene = buildNativeWallpaperScene(
      buildWallpaperModel({ date, timeRange: 'month' }),
    );
    const values = scene.commands.flatMap((command) =>
      command.kind === 'text' ? [command.value] : [],
    );

    expect(values).toContain('October 2026');
    expect(values).not.toContain('October');
    expect(values).toContain('No upcoming events');
    expect(scene.commands.some((command) => command.kind === 'roundRect')).toBe(false);
  });

  it('supports theme colors and sanitizes control characters in text', () => {
    const model = buildWallpaperModel({
      date,
      themeId: 'ocean',
      publicEvents: [{ name: 'Launch\nreview', date: '2026-11-14' }],
    });
    const scene = buildNativeWallpaperScene(model);

    expect(scene.background).toBe(model.theme.background);
    expect(scene.commands).toContainEqual(
      expect.objectContaining({ value: 'Launch review' }),
    );
  });

  it('draws the year and leap year as twelve month grids without losing tracked markers', () => {
    for (const [year, days] of [
      [2026, 365],
      [2028, 366],
    ]) {
      const events = Array.from({ length: 7 }, (_, index) => ({
        name: `Milestone ${index + 1}`,
        date: dateAtPeriodDay(`${year}-01-01`, index + 10),
      }));
      const model = buildWallpaperModel({
        date: new Date(`${year}-01-01T12:00:00Z`),
        timeRange: 'year',
        publicEvents: events,
      });
      const scene = buildNativeWallpaperScene(model);
      const dots = scene.commands.filter(
        (command) => command.kind === 'circle' && command.diameter === 16,
      );
      const monthLabels = scene.commands.filter(
        (command) =>
          command.kind === 'text' &&
          model.monthGroups.some(({ label }) => label === command.value),
      );

      expect(dots).toHaveLength(days);
      expect(monthLabels).toHaveLength(12);
      expect(new Set(monthLabels.map(({ x }) => x)).size).toBe(4);
      expect(new Set(monthLabels.map(({ y }) => y)).size).toBe(3);
      expect(
        scene.commands.filter(
          (command) => command.kind === 'circle' && command.diameter === 24,
        ),
      ).toHaveLength(7);
      expect(scene.commands.length).toBeLessThanOrEqual(600);
    }
  });

  it('keeps rolling fourteen days in two rows of seven across the year boundary', () => {
    const model = buildWallpaperModel({
      date: new Date('2026-12-25T12:00:00Z'),
      timeRange: 'rolling14',
    });
    const scene = buildNativeWallpaperScene(model);
    const dots = scene.commands.filter(
      (command) => command.kind === 'circle' && command.diameter === 100,
    );

    expect(dots).toHaveLength(14);
    expect(new Set(dots.map(({ y }) => y)).size).toBe(2);
    expect(new Set(dots.map(({ x }) => x)).size).toBe(7);
    expect(model.cells.at(-1)?.date).toBe('2027-01-07');
  });

  it('uses the configured list caps and presentation-specific event timers', () => {
    const publicEvents = Array.from({ length: 7 }, (_, index) => ({
      name: `Event ${index + 1}`,
      date: `2026-10-${index + 25}`,
    }));

    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const presentation of PRESENTATIONS) {
        const model = buildWallpaperModel({
          date,
          timeRange: 'rolling14',
          presentation,
          lockScreenProfile,
          publicEvents,
        });
        const scene = buildNativeWallpaperScene(model);
        const values = scene.commands
          .filter((command) => command.kind === 'text')
          .map(({ value }) => value);
        const visible = getWallpaperEventLayout(model).limit;

        expect(values.filter((value) => /^Event \d/.test(value))).toHaveLength(visible);
        expect(
          scene.commands.filter(
            (command) => command.kind === 'roundRect' && command.height === 3,
          ),
        ).toHaveLength(presentation === 'countdown' ? 0 : visible * 2);
        expect(values.join(' ')).not.toMatch(/2026-10-\d{2}|Oct \d/);

        if (['calendar', 'hybrid', 'agenda'].includes(presentation)) {
          expect(values).toContain(`+${7 - visible} more`);
        } else {
          expect(values.some((value) => /^\+\d/.test(value))).toBe(false);
        }
      }
    }
  });

  it('rejects oversized public marker scenes explicitly instead of dropping rings', () => {
    const model = buildWallpaperModel({
      date: new Date('2028-01-01T12:00:00Z'),
      timeRange: 'year',
      publicEvents: Array.from({ length: 366 }, (_, index) => ({
        name: `Event ${index}`,
        date: dateAtPeriodDay('2028-01-01', index + 1),
      })),
    });

    expect(() => buildNativeWallpaperScene(model)).toThrow(NativeSceneBudgetError);
  });
});
