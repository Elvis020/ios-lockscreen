import { formatPeriodRemaining, type WallpaperModel } from './wallpaperModel';

export const WALLPAPER_WIDTH = 1284;
export const WALLPAPER_HEIGHT = 2778;
export const CONTENT_LEFT = 112;
export const CONTENT_RIGHT = 112;
export const HEADER_HEIGHT = 80;
export const HEADER_TO_PRESENTATION_GAP = 28;
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const LOCK_SCREEN_CONTENT_BANDS = {
  standard: { top: 920, bottom: 2080 },
  'large-clock': { top: 1120, bottom: 2080 },
} as const;

export const CALENDAR_DOT_GEOMETRY = {
  shape: 'circle',
  week: { size: 100, compactSize: 92, eventRingGap: 5, eventRingWidth: 3 },
  month: { size: 68, eventRingGap: 4, eventRingWidth: 3 },
  quarter: { size: 32, eventRingGap: 3, eventRingWidth: 2 },
  year: { size: 16, eventRingGap: 2, eventRingWidth: 2 },
} as const;

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

export type MonthScale = 'large' | 'large-compact' | 'medium' | 'dots' | 'dots-compact';

export function isGroupedCalendarLayout(model: WallpaperModel): boolean {
  return (
    ['week', 'month', 'quarter'].includes(model.timeRange) &&
    ['calendar', 'hybrid'].includes(model.presentation)
  );
}

export function getWallpaperEventLayout(model: WallpaperModel): WallpaperEventLayout {
  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const largeClock = model.lockScreenProfile === 'large-clock';
  const compact = model.presentation === 'calendar' || model.presentation === 'hybrid';
  const slotHeight = isGroupedCalendarLayout(model)
    ? 204
    : model.presentation === 'calendar'
      ? largeClock
        ? 216
        : 250
      : model.presentation === 'hybrid'
        ? 216
        : band.bottom - band.top - HEADER_HEIGHT - HEADER_TO_PRESENTATION_GAP;
  const rowHeight = compact ? 76 : 144;
  const rowGap = compact ? 20 : 40;
  const overflowHeight = compact ? 32 : 40;
  const capacity = Math.max(
    0,
    Math.floor((slotHeight - overflowHeight + rowGap) / (rowHeight + rowGap)),
  );
  const limit =
    model.presentation === 'progress'
      ? 0
      : model.presentation === 'countdown' || model.presentation === 'minimal'
        ? 1
        : compact
          ? Math.min(2, capacity)
          : capacity;

  return {
    limit,
    compact,
    rowHeight,
    rowGap,
    overflowHeight,
    slotHeight,
    sectionGap: largeClock && model.presentation === 'calendar' ? 16 : 24,
    lift: model.presentation === 'calendar' ? (largeClock ? 48 : 32) : 0,
  };
}

export function getWallpaperLayoutBounds(model: WallpaperModel): WallpaperLayoutBounds {
  const band = LOCK_SCREEN_CONTENT_BANDS[model.lockScreenProfile];
  const composition = getCalendarComposition(model);
  const presentationTop = band.top + HEADER_HEIGHT + HEADER_TO_PRESENTATION_GAP;
  const bounds: WallpaperLayoutBounds = {
    contentTop: band.top,
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

  if (model.presentation === 'calendar' || model.presentation === 'hybrid') {
    const layout = getWallpaperEventLayout(model);

    return {
      ...bounds,
      calendarTop: presentationTop,
      calendarBottom: band.bottom - layout.slotHeight - layout.sectionGap - layout.lift,
      eventsTop: band.bottom - layout.slotHeight - layout.lift,
      eventsBottom: band.bottom - layout.lift,
    };
  }

  if (model.presentation === 'progress') {
    return {
      ...bounds,
      calendarTop: presentationTop + 144,
      calendarBottom: band.bottom,
    };
  }

  return bounds;
}

export function getCalendarRequiredHeight(
  model: WallpaperModel,
  compact = false,
): number {
  if (isGroupedCalendarLayout(model) && model.timeRange !== 'week') {
    const { scale } = getMonthCollectionGeometry(model);

    return Math.ceil(getMonthGroupHeight(scale, model.monthGroups.length > 1, true));
  }

  if (model.timeRange === 'week' || model.timeRange === 'rolling14') {
    const rows = Math.ceil(model.cells.length / 7);
    const { height, gap } = getDayCardGeometry(compact);

    return rows * height + Math.max(0, rows - 1) * gap;
  }

  const { rows, scale } = getMonthCollectionGeometry(model);
  const groupHeight = {
    large: 666,
    'large-compact': 568,
    medium: 346,
    'dots-compact': 182,
    dots: 210,
  }[scale];
  const gap = scale === 'dots-compact' ? 10 : compact ? 10 : 14;

  return rows * groupHeight + Math.max(0, rows - 1) * gap;
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
  const calendarHeight = getCalendarRequiredHeight(
    model,
    model.presentation === 'hybrid',
  );
  const eventGap = model.lockScreenProfile === 'large-clock' ? 48 : 64;
  const eventsHeight = getWallpaperEventLayout(model).slotHeight;
  const height = headerHeight + headerGap + calendarHeight + eventGap + eventsHeight;
  const top = band.top + (band.bottom - band.top - height) / 2;
  const calendarTop = top + headerHeight + headerGap;

  return {
    top,
    height,
    headerHeight,
    headerGap,
    calendarTop,
    calendarHeight,
    eventGap,
    eventsTop: calendarTop + calendarHeight + eventGap,
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

  if (
    !title &&
    model.timeRange === 'quarter' &&
    (model.presentation === 'calendar' || model.presentation === 'hybrid')
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

export function getDayCardGeometry(compact: boolean) {
  return {
    width: 132,
    height: compact ? 158 : 164,
    gap: compact ? 20 : 30,
    labelSize: 24,
    labelGap: 12,
    ...CALENDAR_DOT_GEOMETRY.week,
    size: compact
      ? CALENDAR_DOT_GEOMETRY.week.compactSize
      : CALENDAR_DOT_GEOMETRY.week.size,
  };
}

export function getMonthCollectionGeometry(model: WallpaperModel) {
  const groupCount = model.monthGroups.length;
  const columns = groupCount === 1 ? 1 : groupCount <= 3 ? 3 : 4;
  const scale: MonthScale =
    groupCount === 1
      ? model.lockScreenProfile === 'large-clock'
        ? 'large-compact'
        : 'large'
      : groupCount <= 3
        ? 'medium'
        : model.lockScreenProfile === 'large-clock'
          ? 'dots-compact'
          : 'dots';

  return {
    columns,
    rows: Math.ceil(groupCount / columns),
    widthPercent: 100 / columns - (columns > 1 ? 2 : 0),
    scale,
  };
}

export function getMonthGeometry(scale: MonthScale, roomy = false) {
  const large = scale === 'large';
  const largeCompact = scale === 'large-compact';
  const dots = scale === 'dots' || scale === 'dots-compact';
  const dotsCompact = scale === 'dots-compact';
  const dot = large
    ? CALENDAR_DOT_GEOMETRY.month
    : largeCompact
      ? { ...CALENDAR_DOT_GEOMETRY.month, size: 64 }
      : dots
        ? {
            ...CALENDAR_DOT_GEOMETRY.year,
            size: dotsCompact ? 14 : CALENDAR_DOT_GEOMETRY.year.size,
          }
        : CALENDAR_DOT_GEOMETRY.quarter;
  const baseCellHeight = large
    ? 88
    : largeCompact
      ? 78
      : dotsCompact
        ? 22
        : dots
          ? 24
          : 44;
  const extraRowSpacing = roomy && !dots ? (large || largeCompact ? 12 : 8) : 0;

  return {
    dot,
    cellHeight: baseCellHeight + extraRowSpacing,
    paddingY: large ? 22 : largeCompact ? 10 : dotsCompact ? 6 : dots ? 12 : 16,
    paddingX: large ? 20 : largeCompact ? 16 : dotsCompact ? 8 : dots ? 10 : 12,
    labelGap: large ? 16 : largeCompact ? 8 : dotsCompact ? 4 : dots ? 8 : 12,
    labelSize: large ? 34 : largeCompact ? 32 : dots ? 28 : 32,
    weekdaySize: large ? 25 : largeCompact ? 24 : 22,
    showWeekdays: !dots,
  };
}

export function getMonthGroupHeight(
  scale: MonthScale,
  showLabel: boolean,
  roomy = false,
): number {
  const geometry = getMonthGeometry(scale, roomy);
  const labelHeight = showLabel ? geometry.labelSize * 1.2 + geometry.labelGap : 0;
  const weekdayHeight = geometry.showWeekdays ? geometry.weekdaySize * 1.2 + 7 : 0;

  return geometry.paddingY * 2 + labelHeight + weekdayHeight + 6 * geometry.cellHeight;
}
