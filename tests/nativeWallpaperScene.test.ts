import { describe, expect, it } from 'vitest';
import {
  buildNativeWallpaperScene,
  UnsupportedNativeLayoutError,
} from '../lib/nativeWallpaperScene';
import { LOCK_SCREEN_PROFILES, PRESENTATIONS, TIME_RANGES } from '../lib/preferences';
import {
  CALENDAR_DOT_GEOMETRY,
  getCalendarComposition,
  getMonthGeometry,
  getWallpaperLayoutBounds,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
} from '../lib/wallpaperLayout';
import { buildWallpaperModel } from '../lib/wallpaperModel';

const date = new Date('2026-10-24T12:00:00Z');
const publicEvents = [
  { name: 'Réunion 🎉', date: '2026-10-24' },
  { name: 'Product launch', date: '2026-11-14' },
  { name: 'Team offsite', date: '2026-12-19' },
];

describe('native wallpaper scene', () => {
  it('builds each supported layout inside the shared clock-safe band', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of ['week', 'month', 'quarter'] as const) {
        for (const presentation of ['calendar', 'hybrid'] as const) {
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
          expect(text.map(({ value }) => value)).toContain('Réunion 🎉');
          expect(text.map(({ value }) => value)).toContain('Product launch');
          expect(text.map(({ value }) => value)).not.toContain('Team offsite');
          expect(text.map(({ value }) => value)).toContain('+1 more');

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
              expect(command.y).toBeGreaterThanOrEqual(bounds.calendarTop as number);
              expect(command.y + height).toBeLessThanOrEqual(
                bounds.calendarBottom as number,
              );
            }
          }

          const timers = scene.commands.filter((command) => command.kind === 'roundRect');

          expect(timers).toHaveLength(4);
          expect(
            timers.every(({ height, radius }) => height === 3 && radius === 1.5),
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
    expect(getMonthGeometry('medium').cellHeight).toBe(44);
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

    expect(outerDiameter).toBeLessThan(getMonthGeometry('medium').cellHeight);
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

  it('rejects every unsupported combination instead of silently changing the saved view', () => {
    for (const timeRange of TIME_RANGES) {
      for (const presentation of PRESENTATIONS) {
        if (
          ['week', 'month', 'quarter'].includes(timeRange) &&
          ['calendar', 'hybrid'].includes(presentation)
        ) {
          continue;
        }

        const model = buildWallpaperModel({ date, timeRange, presentation });

        expect(() => buildNativeWallpaperScene(model)).toThrow(
          UnsupportedNativeLayoutError,
        );
      }
    }
  });
});
