import { isValidElement, type CSSProperties, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  EVENT_COUNTS,
  LOCK_SCREEN_PROFILES,
  PRESENTATIONS,
  TIME_RANGES,
} from '../lib/preferences';
import { normalizeUserData } from '../lib/userSchema';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import { getContinuousDotGridLayout, FIRST_DOT_TOP } from '../lib/wallpaperLayout';
import {
  CALENDAR_DOT_GEOMETRY,
  createWallpaperImageResponse,
  getCalendarRequiredHeight,
  getWallpaperHeaderCopy,
  getWallpaperEventLayout,
  getWallpaperLayoutBounds,
  LOCK_SCREEN_CONTENT_BANDS,
  WALLPAPER_HEIGHT,
  WALLPAPER_WIDTH,
  WallpaperCanvas,
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
  it.each([2, 5])(
    'materializes native-size PNGs for every active layout with event count %i',
    async (eventCount) => {
      for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
        for (const timeRange of TIME_RANGES) {
          for (const presentation of PRESENTATIONS) {
            const model = buildWallpaperModel({
              date,
              timeRange,
              presentation,
              lockScreenProfile,
              eventCount,
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
      }
    },
    60_000,
  );

  it.each(EVENT_COUNTS)(
    'shows exactly the chosen %i events and overflow in every PNG layout',
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
              publicEvents: events,
            });
            const { text, styles } = inspectCanvas(WallpaperCanvas({ model }));

            for (const [index, event] of model.events.entries()) {
              expect(
                text.includes(event.name),
                `${timeRange}/${presentation}/${lockScreenProfile}/${eventCount}/${event.name}`,
              ).toBe(index < eventCount);
            }
            expect(text).toContain(`+${events.length - eventCount} more`);
            const rowCount = eventCount - (presentation === 'countdown' ? 1 : 0);

            expect(
              styles.filter(
                ({ height, overflow }) => height === 3 && overflow === 'hidden',
              ),
            ).toHaveLength(rowCount);
            const layout = getWallpaperEventLayout(model);

            expect(layout.contentHeight).toBeLessThanOrEqual(layout.slotHeight);
          }
        }
      }
    },
  );

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

          const expectedTop =
            presentation === 'countdown'
              ? profileBand.top
              : FIRST_DOT_TOP[lockScreenProfile] -
                getContinuousDotGridLayout(model).eventRingGap -
                getContinuousDotGridLayout(model).eventRingWidth -
                84;

          expect(bounds.contentTop).toBe(expectedTop);
          expect(bounds.contentBottom).toBeLessThanOrEqual(profileBand.bottom);
          expect(bounds.presentationTop).toBeGreaterThanOrEqual(expectedTop);
          expect(bounds.presentationBottom).toBeLessThanOrEqual(profileBand.bottom);

          if (bounds.calendarTop !== undefined && bounds.calendarBottom !== undefined) {
            const availableHeight = bounds.calendarBottom - bounds.calendarTop;

            expect(getCalendarRequiredHeight(model)).toBeLessThanOrEqual(availableHeight);
          }

          if (bounds.eventsTop !== undefined && bounds.eventsBottom !== undefined) {
            expect(bounds.eventsTop).toBeGreaterThanOrEqual(profileBand.top);
            expect(bounds.eventsBottom).toBeLessThanOrEqual(profileBand.bottom);
            expect(bounds.calendarBottom).toBeLessThanOrEqual(bounds.eventsTop);
          }

          const eventLayout = getWallpaperEventLayout(model);

          expect(eventLayout.contentHeight).toBeLessThanOrEqual(eventLayout.slotHeight);
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

    expect(CALENDAR_DOT_GEOMETRY.quarter.size).toBe(72);
    expect(CALENDAR_DOT_GEOMETRY.year.size).toBe(32);
  });

  it('uses the grouped spacing and clearer small text while preserving thin event tracks', () => {
    const model = buildWallpaperModel({
      date,
      timeRange: 'quarter',
      publicEvents: [
        { name: 'Launch', date: '2026-11-14' },
        { name: 'Offsite', date: '2026-12-19' },
      ],
    });
    const { text, styles } = inspectCanvas(WallpaperCanvas({ model }));

    expect(styles.some(({ marginTop }) => marginTop === 20)).toBe(true);
    expect(styles.some(({ marginTop }) => marginTop === 80)).toBe(true);
    expect(styles.some(({ fontSize }) => fontSize === 34)).toBe(true);
    expect(
      styles.some(({ fontSize, color }) => fontSize === 30 && color === model.theme.text),
    ).toBe(true);
    expect(
      styles.filter(({ height, overflow }) => height === 3 && overflow === 'hidden'),
    ).toHaveLength(2);
    expect(text).not.toContain('Q4 2026');
  });

  it.each(['calendar', 'hybrid', 'progress'] as const)(
    'constrains the %s PNG event rail to the dot outer-ring envelope',
    (presentation) => {
      const model = buildWallpaperModel({
        date,
        presentation,
        timeRange: 'quarter',
        eventCount: 1,
        publicEvents: events,
      });
      const layout = getWallpaperEventLayout(model);
      const { styles } = inspectCanvas(WallpaperCanvas({ model }));

      expect(
        styles.some(
          ({ width, marginLeft }) =>
            width === layout.railWidth && marginLeft === layout.railLeft,
        ),
      ).toBe(true);
    },
  );

  it('constrains the grouped PNG empty state to the dot outer-ring envelope', () => {
    const model = buildWallpaperModel({ date, timeRange: 'month' });
    const layout = getWallpaperEventLayout(model);
    const { styles } = inspectCanvas(WallpaperCanvas({ model }));

    expect(
      styles.some(
        ({ width, marginLeft }) =>
          width === layout.railWidth && marginLeft === layout.railLeft,
      ),
    ).toBe(true);
  });

  it('places every PNG dot using the shared continuous sequence without blank day cells', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const timeRange of ['month', 'quarter'] as const) {
        for (const presentation of ['calendar', 'hybrid', 'progress'] as const) {
          const model = buildWallpaperModel({
            date,
            timeRange,
            presentation,
            lockScreenProfile,
          });
          const grid = getContinuousDotGridLayout(model);
          const { styles } = inspectCanvas(WallpaperCanvas({ model }));
          const positions = styles.filter(
            ({ position, left, top }) =>
              position === 'absolute' &&
              grid.positions.some((point) => point.x === left && point.y === top),
          );

          expect(positions.map(({ left, top }) => ({ x: left, y: top }))).toEqual(
            grid.positions,
          );
          expect(positions).toHaveLength(model.cells.length);
        }
      }
    }
  });

  it('uses minimal header copy and removes the quarter heading', () => {
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

    const quarter = buildWallpaperModel({ date, timeRange: 'quarter' });

    expect(getWallpaperHeaderCopy(progress)).toEqual({
      title: null,
      subtitle: 'October · 19% left · 69 days left',
    });
    expect(getWallpaperHeaderCopy(minimal)).toEqual({ title: 'October 2026' });
    expect(getWallpaperHeaderCopy(countdown)).toEqual({ title: 'Next event' });
    expect(getWallpaperHeaderCopy(quarter)).toEqual({
      title: null,
      subtitle: 'October · 75% left · 69 days left',
    });
    expect(getWallpaperHeaderCopy(quarter, 'Custom title')).toEqual({
      title: 'Custom title',
    });
    expect(getWallpaperHeaderCopy(countdown, 'Launch focus').title).toBe('Launch focus');
  });

  it('defaults to two events independently of presentation and clock profile', () => {
    for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
      for (const presentation of PRESENTATIONS) {
        const model = buildWallpaperModel({ date, presentation, lockScreenProfile });

        expect(getWallpaperEventLayout(model).limit).toBe(2);
      }
    }
  });

  it('renders compact countdown rows and accurate overflow without dates', () => {
    const manyEvents = Array.from({ length: 10 }, (_, index) => ({
      name: `Upcoming event ${index + 1}`,
      date: `2026-10-${String(index + 22).padStart(2, '0')}`,
    }));
    const model = buildWallpaperModel({
      date,
      timeRange: 'quarter',
      publicEvents: manyEvents,
    });
    const { text, styles } = inspectCanvas(WallpaperCanvas({ model }));

    expect(text).toContain('Upcoming event 2');
    expect(text).toContain('Upcoming event 3');
    expect(text).not.toContain('Upcoming event 4');
    expect(text).toContain('Today');
    expect(text).toContain('Tomorrow');
    expect(text).toContain('+7 more');
    expect(text).not.toContain('Q4 2026');
    expect(text).not.toMatch(/Oct 2[3-9]/);
    expect(text).toContain('October · 75% left · 69 days left');
    expect(
      styles.filter(({ height, overflow }) => height === 3 && overflow === 'hidden'),
    ).toHaveLength(2);
    expect(styles.some(({ width }) => width === '100%')).toBe(true);
  });

  it('keeps thin lines on event rows but not the large countdown display', () => {
    for (const presentation of ['countdown', 'minimal'] as const) {
      const model = buildWallpaperModel({
        date,
        presentation,
        publicEvents: [{ name: 'Next milestone', date: '2026-11-14' }],
      });
      const { text, styles } = inspectCanvas(WallpaperCanvas({ model }));

      expect(text).toContain('Next milestone');
      expect(text).not.toContain('Nov 14');
      expect(
        styles.filter(({ height, overflow }) => height === 3 && overflow === 'hidden'),
      ).toHaveLength(presentation === 'minimal' ? 1 : 0);
      expect(styles.some(({ width }) => width === '51%')).toBe(
        presentation === 'minimal',
      );
    }
  });

  it('uses Tomorrow without a secondary day-away line in the countdown hero', () => {
    const model = buildWallpaperModel({
      date,
      presentation: 'countdown',
      publicEvents: [{ name: 'Launch', date: '2026-10-24' }],
    });
    const { text } = inspectCanvas(WallpaperCanvas({ model }));

    expect(text).toContain('Tomorrow');
    expect(text).not.toContain('day away');
  });

  it('keeps the centered quarter summary without weekday labels', () => {
    const model = buildWallpaperModel({
      date: new Date('2026-10-24T12:00:00Z'),
      timeRange: 'quarter',
    });
    const { text, styles } = inspectCanvas(WallpaperCanvas({ model }));

    expect(text).toContain('October · 74% left · 68 days left');
    expect(text).not.toMatch(/S M T W T F S/);
    expect(text).not.toContain('Q4 2026');
    expect(
      styles.some(
        ({ width, textAlign, justifyContent }) =>
          width === '100%' && textAlign === 'center' && justifyContent === 'center',
      ),
    ).toBe(true);
  });

  it('matches native event colors for a non-default accent and explicit category', () => {
    const user = normalizeUserData(
      {
        token: 'owner',
        name: 'Ada',
        theme: 'frost',
        timeRange: 'month',
        presentation: 'calendar',
        lockScreenProfile: 'standard',
        timeZone: 'UTC',
        events: [
          { name: 'Today', date: '2026-10-24', category: 'general' },
          { name: 'General', date: '2026-10-25', category: 'general' },
          { name: 'Work', date: '2026-10-26', category: 'work' },
        ],
      },
      'owner',
    )!;
    const model = buildWallpaperModel({ date: new Date('2026-10-24T12:00:00Z'), user });
    const grid = getContinuousDotGridLayout(model);
    const { styles } = inspectCanvas(WallpaperCanvas({ model }));

    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          border: `${grid.eventRingWidth}px solid ${model.theme.text}`,
        }),
        expect.objectContaining({
          border: `${grid.eventRingWidth}px solid ${model.theme.current}`,
        }),
        expect.objectContaining({ border: `${grid.eventRingWidth}px solid #5D7FA3` }),
      ]),
    );
  });

  it('removes month panels and begins the flat dots directly below the clock', () => {
    const model = buildWallpaperModel({ date, timeRange: 'quarter' });
    const { text } = inspectCanvas(WallpaperCanvas({ model }));

    expect(text).toContain('October · 75% left · 69 days left');
    expect(text).not.toContain('November');
    expect(text).not.toContain('December');
    const grid = getContinuousDotGridLayout(model);

    expect(grid.top + grid.positions[0].y).toBe(FIRST_DOT_TOP.standard);
  });

  it('matches the mock iOS date to the generated calendar date', () => {
    const model = buildWallpaperModel({
      date: new Date('2026-10-24T12:00:00Z'),
      timeRange: 'quarter',
    });
    const { text } = inspectCanvas(
      WallpaperCanvas({ model, options: { mockIosOverlay: true } }),
    );

    expect(text).toContain('Saturday, October 24');
    expect(text).not.toContain('Friday, October 23');
  });

  it('keeps calibrated content bands above the notification region', () => {
    expect(LOCK_SCREEN_CONTENT_BANDS.standard).toEqual({ top: 920, bottom: 2080 });
    expect(LOCK_SCREEN_CONTENT_BANDS['large-clock']).toEqual({
      top: 1120,
      bottom: 2080,
    });
  });
});

function inspectCanvas(node: ReactNode): { text: string; styles: CSSProperties[] } {
  const text: string[] = [];
  const styles: CSSProperties[] = [];

  function visit(child: ReactNode): void {
    if (typeof child === 'string' || typeof child === 'number') {
      text.push(String(child));

      return;
    }

    if (Array.isArray(child)) {
      child.forEach(visit);

      return;
    }

    if (!isValidElement<{ children?: ReactNode; style?: CSSProperties }>(child)) {
      return;
    }

    if (typeof child.type === 'function') {
      const component = child.type as (props: unknown) => ReactNode;

      visit(component(child.props));

      return;
    }

    if (child.props.style) {
      styles.push(child.props.style);
    }

    visit(child.props.children);
  }

  visit(node);

  return { text: text.join(' '), styles };
}

function readPngDimension(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}
