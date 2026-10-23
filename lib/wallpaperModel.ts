import {
  dateAtPeriodDay,
  dayInPeriod,
  getPeriodInfo,
  isWeekendDate,
  type PeriodInfo,
} from './periodCalculator';
import { resolveTheme, type ViewMode, type WallpaperTheme } from './preferences';
import type { UserData } from './userSchema';

export interface DisplayEvent {
  id: string;
  name: string;
  date: string;
  daysLeft: number;
  progressPercent: number;
  source: 'manual' | 'google';
}

export interface WallpaperCell {
  day: number;
  date: string;
  passed: boolean;
  current: boolean;
  weekend: boolean;
  event: boolean;
}

export interface WallpaperModel {
  period: PeriodInfo;
  theme: WallpaperTheme;
  columns: number;
  cells: WallpaperCell[];
  events: DisplayEvent[];
}

export function buildWallpaperModel(options: {
  date?: Date;
  user?: UserData | null;
  viewMode?: ViewMode;
  themeId?: string;
  timeZone?: string;
  publicEvents?: Array<{ name: string; date: string }>;
  dayOverride?: number;
}): WallpaperModel {
  const user = options.user;
  const viewMode = user?.viewMode ?? options.viewMode ?? 'quarter';
  const timeZone = user?.timeZone ?? options.timeZone ?? 'UTC';
  const themeId = user?.theme ?? options.themeId ?? 'default';
  const period = getPeriodInfo(options.date, viewMode, timeZone);
  const effectiveDay = clampDay(options.dayOverride, period.currentDay, period.totalDays);
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
  const currentDate = dateAtPeriodDay(period.startDate, effectiveDay);
  const events = sourceEvents
    .map((event) => {
      const eventDay = dayInPeriod(event.date, period);
      const daysLeft = diffDateStrings(currentDate, event.date);

      return {
        id: event.id,
        name: event.name,
        date: event.date,
        daysLeft,
        progressPercent:
          eventDay === null
            ? 0
            : Math.round(Math.min(100, Math.max(0, (effectiveDay / eventDay) * 100))),
        source: event.source,
      };
    })
    .filter(({ daysLeft }) => daysLeft >= 0)
    .sort((left, right) => left.daysLeft - right.daysLeft)
    .slice(0, 7);
  const eventDates = new Set(events.map(({ date }) => date));
  const cells = Array.from({ length: period.totalDays }, (_, index) => {
    const day = index + 1;
    const date = dateAtPeriodDay(period.startDate, day);

    return {
      day,
      date,
      passed: day < effectiveDay,
      current: day === effectiveDay,
      weekend: isWeekendDate(date),
      event: eventDates.has(date),
    };
  });

  return {
    period: {
      ...period,
      currentDay: effectiveDay,
      currentDate,
      daysLeft: period.totalDays - effectiveDay,
      percentComplete: Math.round((effectiveDay / period.totalDays) * 100),
    },
    theme: resolveTheme(themeId, user?.customThemes),
    columns: viewMode === 'quarter' ? 10 : 7,
    cells,
    events,
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
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);

  return Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
}
