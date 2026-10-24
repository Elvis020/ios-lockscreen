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
  week: { size: 100, compactSize: 92, eventRingGap: 5, eventRingWidth: 3 },
  month: { size: 92, eventRingGap: 4, eventRingWidth: 3 },
  quarter: { size: 64, eventRingGap: 3, eventRingWidth: 2 },
  year: { size: 24, eventRingGap: 2, eventRingWidth: 2 },
} as const;

// Calibration targets, not device detection. Keep both profiles above notifications.
export const FIRST_DOT_TOP = { standard: 800, 'large-clock': 1000 } as const;

export function getContinuousDotGridLayout(model: WallpaperModel) {
  const largeClock = model.lockScreenProfile === 'large-clock';
  const range = model.timeRange;
  const geometry =
    range === 'year'
      ? { ...CALENDAR_DOT_GEOMETRY.year, columns: 20, pitchX: 54, pitchY: 38 }
      : range === 'quarter'
        ? {
            ...CALENDAR_DOT_GEOMETRY.quarter,
            size: largeClock ? 52 : 64,
            columns: 10,
            pitchX: 109,
            pitchY: largeClock ? 72 : 88,
          }
        : range === 'month'
          ? {
              ...CALENDAR_DOT_GEOMETRY.month,
              size: largeClock ? 80 : 92,
              columns: 7,
              pitchX: 159,
              pitchY: largeClock ? 112 : 128,
            }
          : { ...CALENDAR_DOT_GEOMETRY.week, columns: 7, pitchX: 157, pitchY: 144 };
  const rows = Math.ceil(model.cells.length / geometry.columns);
  const ringOutset = geometry.eventRingGap + geometry.eventRingWidth;
  const width = (geometry.columns - 1) * geometry.pitchX + geometry.size + ringOutset * 2;
  const left =
    Math.floor((WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT - width) / 2) + ringOutset;
  const top = FIRST_DOT_TOP[model.lockScreenProfile] - 8;
  const height = 16 + Math.max(0, rows - 1) * geometry.pitchY + geometry.size;

  return {
    ...geometry,
    rows,
    top,
    width,
    height,
    positions: model.cells.map((_, index) => ({
      x: left + (index % geometry.columns) * geometry.pitchX,
      y: 8 + Math.floor(index / geometry.columns) * geometry.pitchY,
    })),
  };
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
  const largeClock = model.lockScreenProfile === 'large-clock';
  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const compact = model.presentation !== 'agenda' && model.presentation !== 'minimal';
  const limit = model.eventCount;
  const startIndex = model.presentation === 'countdown' ? 1 : 0;
  const visibleCount = Math.max(0, Math.min(limit, model.events.length) - startIndex);
  const overflow = Math.max(0, model.events.length - limit);
  const listHeight = (height: number, gap: number) =>
    visibleCount * height + Math.max(0, visibleCount - 1) * gap + (overflow ? 32 : 0);
  const grid = getContinuousDotGridLayout(model);
  const availableHeight = isGroupedCalendarLayout(model)
    ? band.bottom - grid.top - grid.height - 24
    : band.bottom - band.top - HEADER_HEIGHT - HEADER_TO_PRESENTATION_GAP - 240 - 28;
  const snug = compact && visibleCount > 2 && listHeight(76, 20) > availableHeight;
  const dense = snug && listHeight(68, 14) > availableHeight;
  const columns = dense ? 2 : 1;
  const rowHeight = dense ? 52 : snug ? 68 : compact ? 76 : 144;
  const rowGap = dense ? 6 : snug ? 14 : compact ? 20 : 40;
  const overflowHeight = dense ? 26 : compact ? 32 : 40;
  const rows = Math.ceil(visibleCount / columns);
  const contentHeight =
    rows * rowHeight + Math.max(0, rows - 1) * rowGap + (overflow ? overflowHeight : 0);
  const columnGap = 28;

  return {
    limit,
    compact,
    rowHeight,
    rowGap,
    overflowHeight,
    slotHeight: Math.max(204, contentHeight),
    sectionGap: largeClock && model.presentation === 'calendar' ? 16 : 24,
    lift: model.presentation === 'calendar' ? (largeClock ? 48 : 32) : 0,
    columns,
    columnGap,
    cellWidth:
      (WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT - (columns - 1) * columnGap) /
      columns,
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

  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const headerHeight = 64;
  const headerGap = 8;
  const grid = getContinuousDotGridLayout(model);
  const requiredHeight = grid.height;
  const calendarTop = grid.top;
  const top = calendarTop - headerHeight - headerGap;
  const eventGap = 24;
  const preferredEventsTop = model.lockScreenProfile === 'large-clock' ? 1772 : 1680;
  const eventsHeight = getWallpaperEventLayout(model).slotHeight;
  const eventsTop = Math.max(
    Math.min(preferredEventsTop, band.bottom - eventsHeight),
    calendarTop + requiredHeight + eventGap,
  );
  const calendarHeight = eventsTop - eventGap - calendarTop;
  const height = eventsTop + eventsHeight - top;

  return {
    top,
    height,
    headerHeight,
    headerGap,
    calendarTop,
    calendarHeight,
    eventGap,
    eventsTop,
    eventsHeight,
  };
}

export function getWallpaperHeaderCopy(
  model: WallpaperModel,
  title?: string,
): { title: string | null; subtitle?: string } {
  if (model.presentation === 'countdown') {
    return { title: title || 'Next event' };
  }

  if (!title && model.presentation === 'progress') {
    return {
      title: null,
      subtitle:
        model.period.kind === 'rolling'
          ? '14-day outlook'
          : `${model.period.percentComplete}% complete · ${formatPeriodRemaining(model.period.daysLeft)}`,
    };
  }

  if (
    !title &&
    ['quarter', 'year'].includes(model.timeRange) &&
    isGroupedCalendarLayout(model)
  ) {
    return {
      title: null,
      subtitle: `${model.period.percentComplete}% complete · ${formatPeriodRemaining(model.period.daysLeft)}`,
    };
  }

  return {
    title: title || (model.timeRange === 'quarter' ? null : model.period.title),
  };
}
