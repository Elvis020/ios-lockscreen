import {
  formatPeriodRemaining,
  type WallpaperModel,
  type WallpaperMonthGroup,
} from './wallpaperModel';

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

export type MonthScale = 'large' | 'large-compact' | 'medium' | 'dots' | 'dots-compact';

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
  const calendarTop = band.top + 72;
  const availableHeight = isGroupedCalendarLayout(model)
    ? band.bottom -
      calendarTop -
      getCalendarRequiredHeight(model, model.presentation === 'hybrid') -
      24
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

  return bounds;
}

export function getCalendarRequiredHeight(
  model: WallpaperModel,
  compact = false,
): number {
  if (model.timeRange === 'week' || model.timeRange === 'rolling14') {
    const rows = Math.ceil(model.cells.length / 7);
    const { height, gap } = getDayCardGeometry(compact);

    return rows * height + Math.max(0, rows - 1) * gap;
  }

  return Math.ceil(getMonthCollectionLayout(model).requiredHeight);
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
  const requiredHeight = getCalendarRequiredHeight(
    model,
    model.presentation === 'hybrid',
  );
  const calendarTop = band.top + headerHeight + headerGap;
  const eventGap = 24;
  const preferredEventsTop = model.lockScreenProfile === 'large-clock' ? 1772 : 1680;
  const eventsHeight = getWallpaperEventLayout(model).slotHeight;
  const eventsTop = Math.max(
    Math.min(preferredEventsTop, band.bottom - eventsHeight),
    calendarTop + requiredHeight + eventGap,
  );
  const calendarHeight = eventsTop - eventGap - calendarTop;
  const height = eventsTop + eventsHeight - band.top;

  return {
    top: band.top,
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
  const year = model.timeRange === 'year';
  const columns = groupCount === 1 ? 1 : year || groupCount <= 3 ? 3 : 4;
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
    widthPercent: year
      ? ((WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT - 24) /
          3 /
          (WALLPAPER_WIDTH - CONTENT_LEFT - CONTENT_RIGHT)) *
        100
      : 100 / columns - (columns > 1 ? 2 : 0),
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

export function getMonthCollectionLayout(
  model: WallpaperModel,
  availableHeight?: number,
) {
  const collection = getMonthCollectionGeometry(model);
  const year = model.timeRange === 'year';
  const largeClock = model.lockScreenProfile === 'large-clock';
  const roomy = isGroupedCalendarLayout(model);
  const base = {
    ...getMonthGeometry(collection.scale, roomy),
    ...(year
      ? {
          paddingY: 0,
          paddingX: 6,
          labelSize: largeClock ? 22 : 28,
          labelGap: largeClock ? 2 : 4,
        }
      : {}),
  };
  const labelHeight =
    model.monthGroups.length > 1 ? base.labelSize * 1.2 + base.labelGap : 0;
  const metadataHeight =
    base.paddingY * 2 +
    labelHeight +
    (base.showWeekdays ? base.weekdaySize * 1.2 + 7 : 0);
  const rowWeeks = Array.from({ length: collection.rows }, (_, row) =>
    year
      ? Math.max(
          ...model.monthGroups
            .slice(row * collection.columns, (row + 1) * collection.columns)
            .map(visibleMonthWeeks),
        )
      : 6,
  );
  const minimumGap = year
    ? largeClock
      ? 6
      : 10
    : model.presentation === 'hybrid'
      ? 10
      : 14;
  const requiredHeight =
    rowWeeks.reduce((sum, weeks) => sum + metadataHeight + weeks * base.cellHeight, 0) +
    Math.max(0, collection.rows - 1) * minimumGap;
  const height = Math.max(requiredHeight, availableHeight ?? requiredHeight);
  const extraCellSpace = Math.floor((height - requiredHeight) / (collection.rows * 6));
  const cellHeight =
    roomy && collection.scale === 'medium'
      ? Math.min(72, base.cellHeight + extraCellSpace)
      : base.cellHeight;
  const rowHeights = rowWeeks.map((weeks) => metadataHeight + weeks * cellHeight);
  const rowGap = year
    ? minimumGap
    : collection.rows > 1
      ? (height - rowHeights.reduce((sum, value) => sum + value, 0)) /
        (collection.rows - 1)
      : 0;
  let top = 0;
  const rowLayouts = rowHeights.map((rowHeight, row) => {
    const result = { top, height: rowHeight, weeks: rowWeeks[row] };

    top += rowHeight + rowGap;

    return result;
  });

  return {
    ...collection,
    geometry: { ...base, cellHeight },
    rowLayouts,
    rowGap,
    requiredHeight,
  };
}

function visibleMonthWeeks(group: WallpaperMonthGroup): number {
  let count = group.cells.length;

  while (count > 0 && group.cells[count - 1] === null) {
    count -= 1;
  }

  return Math.ceil(count / 7);
}

export function getDayRowsLayout(
  model: WallpaperModel,
  availableHeight?: number,
  compact = model.presentation === 'hybrid',
) {
  const geometry = getDayCardGeometry(compact);
  const rows = Math.ceil(model.cells.length / 7);
  const requiredHeight = rows * geometry.height + Math.max(0, rows - 1) * geometry.gap;
  const rowGap =
    rows > 1 && availableHeight !== undefined
      ? Math.min(
          96,
          Math.max(geometry.gap, (availableHeight - rows * geometry.height) / (rows - 1)),
        )
      : geometry.gap;

  return { geometry, rows, rowGap, requiredHeight };
}
