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

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DisplayEvent {
  id: string;
  name: string;
  date: string;
  daysLeft: number;
  countdownLabel: string;
  progressPercent: number;
  source: 'manual' | 'google';
}

export interface WallpaperCell {
  day: number;
  date: string;
  weekdayLabel: string;
  passed: boolean;
  current: boolean;
  weekend: boolean;
  event: boolean;
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
  const timeRange = user?.timeRange ?? options.timeRange ?? 'quarter';
  const presentation = user?.presentation ?? options.presentation ?? 'calendar';
  const lockScreenProfile =
    user?.lockScreenProfile ?? options.lockScreenProfile ?? 'standard';
  const timeZone = user?.timeZone ?? options.timeZone ?? 'UTC';
  const themeId = user?.theme ?? options.themeId ?? 'default';
  const period = getPeriodInfo(options.date, timeRange, timeZone);
  const effectiveDay = clampDay(options.dayOverride, period.currentDay, period.totalDays);
  const currentDate = dateAtPeriodDay(period.startDate, effectiveDay);
  const selectedGoogle = new Set(user?.selectedEventIds ?? []);
  const sourceEvents = user
    ? [
        ...user.events.map((event) => ({ ...event, source: 'manual' as const })),
        ...user.cachedCalEvents
          .filter(({ id }) => selectedGoogle.has(id))
          .map((event) => ({ ...event, source: 'google' as const })),
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
      };
    })
    .filter(
      ({ date, daysLeft }) =>
        daysLeft >= 0 && (presentation !== 'agenda' || date <= period.endDate),
    )
    .sort((left, right) => {
      const dateOrder = left.daysLeft - right.daysLeft;

      return dateOrder || left.name.localeCompare(right.name);
    });
  const eventDates = new Set(events.map(({ date }) => date));
  const cells = Array.from({ length: period.totalDays }, (_, index) =>
    buildCell(dateAtPeriodDay(period.startDate, index + 1), currentDate, eventDates),
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
    eventCount: isEventCount(user?.eventCount ?? options.eventCount)
      ? (user?.eventCount ?? options.eventCount)!
      : DEFAULT_EVENT_COUNT,
    cells,
    monthGroups: buildMonthGroups(effectivePeriod, currentDate, eventDates),
    events,
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

      cells.push(buildCell(date, currentDate, eventDates));
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
