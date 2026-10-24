import {
  dateAtPeriodDay,
  getPeriodInfo,
  isWeekendDate,
  type PeriodInfo,
} from './periodCalculator';
import {
  resolveTheme,
  DEFAULT_EVENT_COUNT,
  isEventCount,
  type LockScreenProfile,
  type Presentation,
  type TimeRange,
  type WallpaperTheme,
} from './preferences';
import type { UserData } from './userSchema';
import { nextOccurrenceOnOrAfter } from './eventTimeline';
import { resolveReadTimeAppearance } from './profileResolver';
import type { LivingOverlay, MilestoneRingStyle } from './userSchema';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DisplayEvent {
  id: string;
  name: string;
  date: string;
  daysLeft: number;
  countdownLabel: string;
  progressPercent: number;
  source: 'manual' | 'google';
  stableRef?: string;
  category?: string;
  focused?: boolean;
}

export interface WallpaperCell {
  day: number;
  date: string;
  weekdayLabel: string;
  passed: boolean;
  current: boolean;
  weekend: boolean;
  event: boolean;
  category?: string;
}

export interface WallpaperMonthGroup {
  id: string;
  label: string;
  cells: Array<WallpaperCell | null>;
}

export interface WallpaperModel {
  period: PeriodInfo;
  theme: WallpaperTheme;
  timeRange: TimeRange;
  presentation: Presentation;
  lockScreenProfile: LockScreenProfile;
  eventCount: number;
  cells: WallpaperCell[];
  monthGroups: WallpaperMonthGroup[];
  events: DisplayEvent[];
  livingOverlay: LivingOverlay;
  milestoneRingStyle: MilestoneRingStyle;
  accountSeed: string;
}

export function buildWallpaperModel(options: {
  date?: Date;
  user?: UserData | null;
  timeRange?: TimeRange;
  presentation?: Presentation;
  lockScreenProfile?: LockScreenProfile;
  eventCount?: number;
  themeId?: string;
  timeZone?: string;
  publicEvents?: Array<{ name: string; date: string }>;
  dayOverride?: number;
}): WallpaperModel {
  const user = options.user;
  const appearance = user ? resolveReadTimeAppearance(user, options.date) : null;
  const timeRange =
    appearance?.timeRange ?? user?.timeRange ?? options.timeRange ?? 'quarter';
  const presentation =
    appearance?.presentation ?? user?.presentation ?? options.presentation ?? 'calendar';
  const lockScreenProfile =
    appearance?.lockScreenProfile ??
    user?.lockScreenProfile ??
    options.lockScreenProfile ??
    'standard';
  const timeZone = user?.timeZone ?? options.timeZone ?? 'UTC';
  const themeId = appearance?.theme ?? user?.theme ?? options.themeId ?? 'default';
  const period = getPeriodInfo(options.date, timeRange, timeZone);
  const effectiveDay = clampDay(options.dayOverride, period.currentDay, period.totalDays);
  const currentDate = dateAtPeriodDay(period.startDate, effectiveDay);
  const sourceEvents = user
    ? [
        ...user.events.flatMap((event, index) => {
          const date = nextOccurrenceOnOrAfter(event, currentDate);

          return date
            ? [
                {
                  ...event,
                  date,
                  stableRef: `M${index + 1}`,
                  source: 'manual' as const,
                  category: event.category ?? 'general',
                },
              ]
            : [];
        }),
        ...user.selectedEventIds.flatMap((id, index) => {
          const event = user.cachedCalEvents.find((candidate) => candidate.id === id);

          return event && event.date >= currentDate
            ? [
                {
                  ...event,
                  stableRef: `G${index + 1}`,
                  source: 'google' as const,
                  category: user.googleCategoryOverrides?.[id] ?? 'general',
                },
              ]
            : [];
        }),
      ]
    : (options.publicEvents ?? []).map((event, index) => ({
        ...event,
        id: `public-${index}`,
        source: 'manual' as const,
      }));
  const events = sourceEvents
    .map((event) => {
      const eventDay = diffDateStrings(period.startDate, event.date) + 1;
      const daysLeft = diffDateStrings(currentDate, event.date);

      return {
        id: event.id,
        name: event.name,
        date: event.date,
        daysLeft,
        countdownLabel: formatCountdown(daysLeft),
        progressPercent: Math.round(
          Math.min(100, Math.max(0, (effectiveDay / eventDay) * 100)),
        ),
        source: event.source,
        stableRef: 'stableRef' in event ? event.stableRef : undefined,
        category: 'category' in event ? event.category : 'general',
        focused: user?.focusEventId === event.id,
      };
    })
    .filter(
      ({ date, daysLeft }) =>
        daysLeft >= 0 && (presentation !== 'agenda' || date <= period.endDate),
    )
    .sort((left, right) => {
      if (user?.focusEventId === left.id && user?.focusEventId !== right.id) return -1;
      if (user?.focusEventId === right.id && user?.focusEventId !== left.id) return 1;
      const dateOrder = left.daysLeft - right.daysLeft;

      return dateOrder || left.name.localeCompare(right.name);
    });
  const eventDates = new Set(events.map(({ date }) => date));
  // Rows are focus-first, then deterministic date/name order. Keep the first marker
  // category for a civil day instead of letting a later map entry overwrite it.
  const eventCategories = new Map<string, string>();

  events.forEach(({ date, category }) => {
    if (!eventCategories.has(date)) eventCategories.set(date, category ?? 'general');
  });
  const cells = Array.from({ length: period.totalDays }, (_, index) =>
    buildCell(
      dateAtPeriodDay(period.startDate, index + 1),
      currentDate,
      eventDates,
      eventCategories,
    ),
  );
  const effectivePeriod = {
    ...period,
    currentDay: effectiveDay,
    currentDate,
    daysLeft: period.totalDays - effectiveDay,
    percentComplete:
      period.kind === 'rolling' ? 0 : Math.round((effectiveDay / period.totalDays) * 100),
  };

  return {
    period: effectivePeriod,
    theme: resolveTheme(themeId, user?.customThemes),
    timeRange,
    presentation,
    lockScreenProfile,
    eventCount: isEventCount(
      appearance?.eventCount ?? user?.eventCount ?? options.eventCount,
    )
      ? (appearance?.eventCount ?? user?.eventCount ?? options.eventCount)!
      : DEFAULT_EVENT_COUNT,
    cells,
    monthGroups: buildMonthGroups(
      effectivePeriod,
      currentDate,
      eventDates,
      eventCategories,
    ),
    events,
    livingOverlay: appearance?.livingOverlay ?? user?.livingOverlay ?? 'none',
    milestoneRingStyle:
      appearance?.milestoneRingStyle ?? user?.milestoneRingStyle ?? 'single',
    accountSeed: user?.token ?? 'public',
  };
}

export function formatCountdown(daysLeft: number): string {
  if (daysLeft === 0) {
    return 'Today';
  }

  return `${daysLeft}d`;
}

export function formatPeriodRemaining(daysLeft: number): string {
  return daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
}

function buildMonthGroups(
  period: PeriodInfo,
  currentDate: string,
  eventDates: Set<string>,
  eventCategories: Map<string, string>,
): WallpaperMonthGroup[] {
  const start = parseDate(period.startDate);
  const end = parseDate(period.endDate);
  const groups: WallpaperMonthGroup[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const leading = cursor.getUTCDay();
    const cells: Array<WallpaperCell | null> = Array.from(
      { length: leading },
      () => null,
    );

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = formatDate(new Date(Date.UTC(year, month, day)));

      cells.push(buildCell(date, currentDate, eventDates, eventCategories));
    }

    while (cells.length < 42) {
      cells.push(null);
    }

    groups.push({
      id: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en-US', {
        month: 'long',
        timeZone: 'UTC',
      }).format(cursor),
      cells,
    });
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  return groups;
}

function buildCell(
  date: string,
  currentDate: string,
  eventDates: Set<string>,
  eventCategories: Map<string, string>,
): WallpaperCell {
  const parsed = parseDate(date);

  return {
    day: parsed.getUTCDate(),
    date,
    weekdayLabel: new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(parsed),
    passed: date < currentDate,
    current: date === currentDate,
    weekend: isWeekendDate(date),
    event: eventDates.has(date),
    category: eventCategories.get(date),
  };
}

function clampDay(
  value: number | undefined,
  fallback: number,
  totalDays: number,
): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(totalDays, value as number));
}

function diffDateStrings(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
