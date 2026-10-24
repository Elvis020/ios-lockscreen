import { formatPeriodRemaining, type WallpaperModel } from './wallpaperModel';

export const WALLPAPER_WIDTH = 1284;
export const WALLPAPER_HEIGHT = 2778;
export const CONTENT_LEFT = 112;
export const CONTENT_RIGHT = 112;
export const HEADER_HEIGHT = 80;
export const HEADER_TO_PRESENTATION_GAP = 28;

export const LOCK_SCREEN_CONTENT_BANDS = {
  standard: { top: 920, bottom: 2080 },
  'large-clock': { top: 1120, bottom: 2080 },
} as const;

export const CALENDAR_DOT_GEOMETRY = {
  shape: 'circle',
  week: {
    size: 124,
    minSize: 112,
    columns: 7,
    gapX: [28, 40],
    gapY: [44, 64],
    eventRingGap: 5,
    eventRingWidth: 3,
  },
  month: {
    size: 108,
    minSize: 96,
    columns: 7,
    gapX: [38, 48],
    gapY: [28, 38],
    eventRingGap: 4,
    eventRingWidth: 3,
  },
  quarter: {
    size: 72,
    minSize: 56,
    columns: 10,
    gapX: [26, 36],
    gapY: [16, 26],
    eventRingGap: 3,
    eventRingWidth: 2,
  },
  year: {
    size: 32,
    minSize: 30,
    columns: 22,
    gapX: [12, 16],
    gapY: [10, 12],
    eventRingGap: 2,
    eventRingWidth: 2,
  },
} as const;

// Calibration targets, not device detection. Keep both profiles above notifications.
export const FIRST_DOT_TOP = { standard: 832, 'large-clock': 1032 } as const;
export const DOT_EVENTS_GAP = 80;
export const MAX_DOT_EVENTS_GAP = 240;

export function getContinuousDotGridLayout(model: WallpaperModel) {
  return solveDotComposition(model).grid;
}

export interface WallpaperLayoutBounds {
  contentTop: number;
  contentBottom: number;
  presentationTop: number;
  presentationBottom: number;
  calendarTop?: number;
  calendarBottom?: number;
  eventsTop?: number;
  eventsBottom?: number;
}

export interface WallpaperEventLayout {
  limit: number;
  compact: boolean;
  rowHeight: number;
  rowGap: number;
  overflowHeight: number;
  slotHeight: number;
  sectionGap: number;
  lift: number;
  columns: number;
  columnGap: number;
  cellWidth: number;
  railLeft: number;
  railWidth: number;
  rows: number;
  nameSize: number;
  countdownSize: number;
  timerGap: number;
  startIndex: number;
  visibleCount: number;
  overflow: number;
  contentHeight: number;
}

export interface CalendarComposition {
  top: number;
  height: number;
  headerHeight: number;
  headerGap: number;
  calendarTop: number;
  calendarHeight: number;
  eventGap: number;
  eventsTop: number;
  eventsHeight: number;
}

export function isGroupedCalendarLayout(model: WallpaperModel): boolean {
  return ['calendar', 'hybrid', 'progress'].includes(model.presentation);
}

export function getWallpaperEventLayout(model: WallpaperModel): WallpaperEventLayout {
  if (isGroupedCalendarLayout(model)) {
    return solveDotComposition(model).events;
  }

  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const availableHeight =
    band.bottom - band.top - HEADER_HEIGHT - HEADER_TO_PRESENTATION_GAP - 240 - 28;
  const normal = createEventLayout(model, 'normal');

  if (normal.visibleCount <= 2 || normal.contentHeight <= availableHeight) {
    return normal;
  }

  const snug = createEventLayout(model, 'snug');

  return snug.contentHeight <= availableHeight ? snug : createEventLayout(model, 'dense');
}

type EventDensity = 'normal' | 'snug' | 'dense';

function createEventLayout(
  model: WallpaperModel,
  density: EventDensity,
): WallpaperEventLayout {
  const largeClock = model.lockScreenProfile === 'large-clock';
  const compact = model.presentation !== 'agenda' && model.presentation !== 'minimal';
  const limit = model.eventCount;
  const startIndex = model.presentation === 'countdown' ? 1 : 0;
  const visibleCount = Math.max(0, Math.min(limit, model.events.length) - startIndex);
  const overflow = Math.max(0, model.events.length - limit);
  const snug = compact && density === 'snug';
  const dense = compact && density === 'dense';
  const columns = dense ? 2 : 1;
  const rowHeight = dense ? 52 : snug ? 68 : compact ? 76 : 144;
  const rowGap = dense ? 6 : snug ? 14 : compact ? 20 : 40;
  const overflowHeight = dense ? 26 : compact ? 32 : 40;
  const rows = Math.ceil(visibleCount / columns);
  const contentHeight =
    rows * rowHeight + Math.max(0, rows - 1) * rowGap + (overflow ? overflowHeight : 0);
  const columnGap = 28;
  const railWidth = WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT;

  return {
    limit,
    compact,
    rowHeight,
    rowGap,
    overflowHeight,
    slotHeight: Math.max(isGroupedCalendarLayout(model) ? 76 : 204, contentHeight),
    sectionGap: largeClock && model.presentation === 'calendar' ? 16 : 24,
    lift: model.presentation === 'calendar' ? (largeClock ? 48 : 32) : 0,
    columns,
    columnGap,
    cellWidth: (railWidth - (columns - 1) * columnGap) / columns,
    railLeft: 0,
    railWidth,
    rows,
    nameSize: dense ? 24 : compact ? 34 : 40,
    countdownSize: dense ? 22 : compact ? 30 : 32,
    timerGap: dense ? 6 : compact ? 12 : 18,
    startIndex,
    visibleCount,
    overflow,
    contentHeight,
  };
}

function constrainEventRail(
  events: WallpaperEventLayout,
  railLeft: number,
  railWidth: number,
): WallpaperEventLayout {
  return {
    ...events,
    railLeft,
    railWidth,
    cellWidth: (railWidth - (events.columns - 1) * events.columnGap) / events.columns,
  };
}

function fitDotGrid(model: WallpaperModel, events: WallpaperEventLayout) {
  const geometry =
    CALENDAR_DOT_GEOMETRY[model.timeRange === 'rolling14' ? 'week' : model.timeRange];
  const { columns, eventRingGap, eventRingWidth } = geometry;
  const rows = Math.ceil(model.cells.length / columns);
  const ringOutset =
    eventRingGap +
    eventRingWidth +
    (model.milestoneRingStyle === 'halo'
      ? 10
      : model.milestoneRingStyle === 'double'
        ? 7
        : 0);
  const top = FIRST_DOT_TOP[model.lockScreenProfile] - ringOutset;
  const contentWidth = WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT;
  const availableHeight =
    LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile].bottom -
    top -
    DOT_EVENTS_GAP -
    events.slotHeight;
  const widthLimit =
    (contentWidth - ringOutset * 2 - (columns - 1) * geometry.gapX[0]) / columns;
  const heightLimit =
    (availableHeight - ringOutset * 2 - (rows - 1) * geometry.gapY[0]) / rows;
  const size = Math.floor(Math.min(geometry.size, widthLimit, heightLimit) / 2) * 2;

  if (size < geometry.minSize) {
    return null;
  }

  // Bounded gaps use available space without stretching sparse views to fill it.
  const gapX = Math.min(
    geometry.gapX[1],
    Math.floor((contentWidth - ringOutset * 2 - columns * size) / (columns - 1)),
  );
  const gapY =
    rows === 1
      ? geometry.gapY[0]
      : Math.min(
          geometry.gapY[1],
          Math.floor((availableHeight - ringOutset * 2 - rows * size) / (rows - 1)),
        );
  const pitchX = size + gapX;
  const pitchY = size + gapY;
  const width = (columns - 1) * pitchX + size + ringOutset * 2;
  const height = (rows - 1) * pitchY + size + ringOutset * 2;
  const left = Math.floor((contentWidth - width) / 2) + ringOutset;

  return {
    size,
    columns,
    rows,
    pitchX,
    pitchY,
    eventRingGap,
    eventRingWidth,
    top,
    width,
    height,
    positions: model.cells.map((_, index) => ({
      x: left + (index % columns) * pitchX,
      y: ringOutset + Math.floor(index / columns) * pitchY,
    })),
  };
}

function solveDotComposition(model: WallpaperModel) {
  // Candidates are independent of the grid: never recurse between grid and rail sizing.
  const densities: EventDensity[] = ['normal', 'snug', 'dense'];

  for (const density of densities) {
    const events = createEventLayout(model, density);
    const grid = fitDotGrid(model, events);

    if (!grid) {
      continue;
    }

    const ringOutset = grid.eventRingGap + grid.eventRingWidth;
    const constrainedEvents = constrainEventRail(
      events,
      grid.positions[0].x - ringOutset,
      grid.width,
    );

    const bottom = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile].bottom;
    const preferredEventsTop = model.lockScreenProfile === 'large-clock' ? 1812 : 1720;
    const eventsTop = Math.max(
      Math.min(
        preferredEventsTop,
        grid.top + grid.height + MAX_DOT_EVENTS_GAP,
        bottom - constrainedEvents.slotHeight,
      ),
      grid.top + grid.height + DOT_EVENTS_GAP,
    );
    const headerHeight = 64;
    const headerGap = 20;
    const top = grid.top - headerHeight - headerGap;
    const composition: CalendarComposition = {
      top,
      height: eventsTop + constrainedEvents.slotHeight - top,
      headerHeight,
      headerGap,
      calendarTop: grid.top,
      calendarHeight: eventsTop - DOT_EVENTS_GAP - grid.top,
      eventGap: DOT_EVENTS_GAP,
      eventsTop,
      eventsHeight: constrainedEvents.slotHeight,
    };

    return { grid, events: constrainedEvents, composition };
  }

  throw new Error('Unable to fit the dot field and selected events in the content band');
}

export function getCountdownComposition(model: WallpaperModel) {
  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const availableTop = band.top + HEADER_HEIGHT + HEADER_TO_PRESENTATION_GAP;
  const layout = getWallpaperEventLayout(model);
  const heroHeight = model.events[0]?.daysLeft === 0 ? 196 : 240;
  const hasRail = layout.visibleCount > 0 || layout.overflow > 0;
  const height = heroHeight + (hasRail ? 28 + layout.contentHeight : 0);
  const top = availableTop + (band.bottom - availableTop - height) / 2;

  return {
    top,
    height,
    heroHeight,
    eventsTop: top + heroHeight + 28,
    eventsHeight: hasRail ? layout.contentHeight : 0,
  };
}

export function getWallpaperLayoutBounds(model: WallpaperModel): WallpaperLayoutBounds {
  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const composition = getCalendarComposition(model);
  const contentTop = composition?.top ?? band.top;
  const presentationTop =
    composition?.calendarTop ?? band.top + HEADER_HEIGHT + HEADER_TO_PRESENTATION_GAP;
  const bounds: WallpaperLayoutBounds = {
    contentTop,
    contentBottom: band.bottom,
    presentationTop,
    presentationBottom: band.bottom,
  };

  if (composition) {
    return {
      ...bounds,
      calendarTop: composition.calendarTop,
      calendarBottom: composition.calendarTop + composition.calendarHeight,
      eventsTop: composition.eventsTop,
      eventsBottom: composition.eventsTop + composition.eventsHeight,
    };
  }

  return bounds;
}

export function getCalendarRequiredHeight(model: WallpaperModel): number {
  return getContinuousDotGridLayout(model).height;
}

export function getCalendarComposition(
  model: WallpaperModel,
): CalendarComposition | null {
  if (!isGroupedCalendarLayout(model)) {
    return null;
  }

  return solveDotComposition(model).composition;
}

export function getWallpaperHeaderCopy(
  model: WallpaperModel,
  title?: string,
): { title: string | null; subtitle?: string } {
  if (model.presentation === 'countdown') {
    return { title: title || 'Next event' };
  }

  if (!title && isGroupedCalendarLayout(model)) {
    const month = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${model.period.currentDate}T12:00:00Z`));
    const percentLeft = Math.round(
      (model.period.daysLeft / model.period.totalDays) * 100,
    );

    return {
      title: null,
      subtitle: `${month} · ${percentLeft}% left · ${formatPeriodRemaining(model.period.daysLeft)}`,
    };
  }

  return {
    title: title || (model.timeRange === 'quarter' ? null : model.period.title),
  };
}
