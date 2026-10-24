import { describe, expect, it } from 'vitest';
import {
  buildNativeWallpaperScene,
  NativeSceneBudgetError,
} from '../lib/nativeWallpaperScene';
import {
  EVENT_COUNTS,
  LOCK_SCREEN_PROFILES,
  PRESENTATIONS,
  TIME_RANGES,
} from '../lib/preferences';
import {
  getCalendarComposition,
  getContinuousDotGridLayout,
  FIRST_DOT_TOP,
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
  it.each(EVENT_COUNTS)(
    'honors event count %i across every layout inside the clock-safe band',
    (eventCount) => {
      for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
        for (const timeRange of TIME_RANGES) {
          for (const presentation of PRESENTATIONS) {
            const model = buildWallpaperModel({
              date,
              timeRange,
              presentation,
              lockScreenProfile,
              eventCount,
              publicEvents: [
                ...publicEvents,
                ...Array.from({ length: 4 }, (_, index) => ({
                  name: `Extra milestone ${index}`,
                  date: '2026-12-25',
                })),
              ],
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
            expect(visible).toHaveLength(eventCount);
            expect(text.map(({ value }) => value)).toContain(`+${7 - eventCount} more`);
            for (const event of model.events.slice(eventCount)) {
              expect(text.map(({ value }) => value)).not.toContain(event.name);
            }

            for (const command of scene.commands) {
              const width = command.kind === 'circle' ? command.diameter : command.width;
              const height =
                command.kind === 'circle' ? command.diameter : command.height;

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
              (visible.length - (presentation === 'countdown' ? 1 : 0)) * 2,
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
    },
  );

  it('renders saved Year/progress exactly like the compact Year calendar', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      const options = {
        date,
        timeRange: 'year' as const,
        lockScreenProfile,
        publicEvents,
      };
      const calendar = buildNativeWallpaperScene(buildWallpaperModel(options));
      const legacy = buildNativeWallpaperScene(
        buildWallpaperModel({ ...options, presentation: 'progress' }),
      );

      expect(legacy).toEqual(calendar);
      expect(
        calendar.commands.some(
          (command) => command.kind === 'text' && command.value === '2026',
        ),
      ).toBe(false);
      expect(
        calendar.commands.some(
          (command) => command.kind === 'roundRect' && command.height > 3,
        ),
      ).toBe(false);
      expect(calendar.commands).toContainEqual(
        expect.objectContaining({ kind: 'text', value: 'Réunion 🎉' }),
      );
    }
  });

  it('retains every calendar dot, current-day fill and event-marker ring', () => {
    const model = buildWallpaperModel({ date, timeRange: 'quarter', publicEvents });
    const scene = buildNativeWallpaperScene(model);
    const circles = scene.commands.filter((command) => command.kind === 'circle');
    const grid = getContinuousDotGridLayout(model);
    const outerDiameter = grid.size + 2 * (grid.eventRingGap + grid.eventRingWidth);
    const innerDiameter = grid.size + 2 * grid.eventRingGap;
    const dots = circles.filter(({ diameter }) => diameter === grid.size);

    expect(dots).toHaveLength(92);
    expect(dots.filter(({ fill }) => fill === model.theme.current)).toHaveLength(1);
    expect(circles.filter(({ diameter }) => diameter === outerDiameter)).toHaveLength(3);
    expect(circles.filter(({ diameter }) => diameter === innerDiameter)).toHaveLength(3);
  });

  it('keeps a centered summary above the first dot with no generated calendar labels', () => {
    const model = buildWallpaperModel({ date, timeRange: 'quarter', publicEvents });
    const scene = buildNativeWallpaperScene(model);
    const composition = getCalendarComposition(model)!;
    const text = scene.commands.filter((command) => command.kind === 'text');
    const summary = text.find(
      ({ value }) => value === 'October · 74% left · 68 days left',
    )!;
    const weekdays = text.filter(({ value }) =>
      ['S', 'M', 'T', 'W', 'F'].includes(value),
    );
    const countdown = text.find(({ value }) => value === '21d')!;

    const firstDot = scene.commands.find(
      (command) =>
        command.kind === 'circle' &&
        command.diameter === getContinuousDotGridLayout(model).size,
    )!;

    expect(firstDot.y).toBe(FIRST_DOT_TOP.standard);
    expect(summary.y + summary.height).toBeLessThan(firstDot.y);
    expect(composition.eventsTop).toBeGreaterThanOrEqual(
      composition.calendarTop + getContinuousDotGridLayout(model).height + 80,
    );
    expect(summary).toMatchObject({ size: 30, align: 'center' });
    expect(weekdays).toHaveLength(0);
    expect(countdown).toMatchObject({
      size: 30,
      color: model.theme.text,
      align: 'right',
    });
  });

  it('uses the same flat grid positions and dot sizes across all dot-bearing presentations', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of TIME_RANGES) {
        for (const presentation of ['calendar', 'hybrid', 'progress'] as const) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
          });
          const grid = getContinuousDotGridLayout(model);
          const composition = getCalendarComposition(model)!;

          const dots = buildNativeWallpaperScene(model).commands.filter(
            (command) => command.kind === 'circle' && command.diameter === grid.size,
          );
          const rows = [...new Set(dots.map(({ y }) => y))].sort((a, b) => a - b);

          expect(dots).toHaveLength(model.cells.length);
          expect(rows).toHaveLength(grid.rows);
          expect(dots.map(({ x, y }) => ({ x, y }))).toEqual(
            grid.positions.map(({ x, y }) => ({
              x: 112 + x,
              y: composition.calendarTop + y,
            })),
          );

          for (let index = 1; index < rows.length; index += 1) {
            expect(rows[index] - rows[index - 1]).toBe(grid.pitchY);
          }
        }
      }
    }
  });

  it('keeps both pixel-aligned event rings concentric with their dot', () => {
    const model = buildWallpaperModel({ date, publicEvents });
    const grid = getContinuousDotGridLayout(model);
    const diameter = grid.size + 2 * (grid.eventRingGap + grid.eventRingWidth);
    const scene = buildNativeWallpaperScene(model);
    const index = scene.commands.findIndex(
      (command) => command.kind === 'circle' && command.diameter === diameter,
    );
    const layers = scene.commands
      .slice(index, index + 3)
      .filter((command) => command.kind === 'circle');

    expect(layers.map(({ diameter }) => diameter)).toEqual([
      diameter,
      grid.size + 2 * grid.eventRingGap,
      grid.size,
    ]);
    const center = { x: layers[0].x + diameter / 2, y: layers[0].y + diameter / 2 };

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
    const { size, eventRingGap, eventRingWidth } = getContinuousDotGridLayout(model);
    const outerDiameter = size + 2 * (eventRingGap + eventRingWidth);
    const scene = buildNativeWallpaperScene(model);
    const rings = scene.commands.filter(
      (command) => command.kind === 'circle' && command.diameter === outerDiameter,
    );

    expect(outerDiameter).toBeLessThan(getContinuousDotGridLayout(model).pitchY);
    expect(rings).toHaveLength(2);
    expect(rings[0].y).toBe(rings[1].y);
    expect(Math.abs(rings[1].x - rings[0].x)).toBeGreaterThan(outerDiameter);
  });

  it('keeps only the centered quarter summary and event copy, not month or weekday labels', () => {
    const scene = buildNativeWallpaperScene(buildWallpaperModel({ date, publicEvents }));
    const text = scene.commands.filter((command) => command.kind === 'text');
    const values = text.map(({ value }) => value);

    expect(values).not.toContain('October');
    expect(values).not.toContain('November');
    expect(values).not.toContain('December');
    expect(values).not.toContain('Oct');
    expect(values).not.toContain('Q4 2026');
    expect(
      text.find(({ value }) => value === 'October · 74% left · 68 days left')?.align,
    ).toBe('center');
    expect(values.filter((value) => value === 'S')).toHaveLength(0);
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

    expect(values).toContain('October · 23% left · 7 days left');
    expect(values).not.toContain('October 2026');
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

  it('draws regular and leap years as a single 22-column field without losing tracked markers', () => {
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
      const grid = getContinuousDotGridLayout(model);
      const dots = scene.commands.filter(
        (command) => command.kind === 'circle' && command.diameter === grid.size,
      );
      const monthLabels = scene.commands.filter(
        (command) =>
          command.kind === 'text' &&
          model.monthGroups.some(({ label }) => label === command.value),
      );

      expect(dots).toHaveLength(days);
      expect(monthLabels).toHaveLength(0);
      expect(new Set(dots.map(({ x }) => x)).size).toBe(22);
      expect(new Set(dots.map(({ y }) => y)).size).toBe(17);
      expect(
        scene.commands.filter(
          (command) => command.kind === 'circle' && command.diameter === grid.size + 8,
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
    const grid = getContinuousDotGridLayout(model);
    const dots = scene.commands.filter(
      (command) => command.kind === 'circle' && command.diameter === grid.size,
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
        ).toHaveLength((visible - (presentation === 'countdown' ? 1 : 0)) * 2);
        expect(values.join(' ')).not.toMatch(/2026-10-\d{2}|Oct \d/);

        expect(values).toContain(`+${7 - visible} more`);
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
