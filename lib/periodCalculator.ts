import type { TimeRange } from './preferences';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodInfo {
  mode: TimeRange;
  kind: 'fixed' | 'rolling';
  title: string;
  startDate: string;
  endDate: string;
  currentDate: string;
  currentDay: number;
  totalDays: number;
  daysLeft: number;
  percentComplete: number;
}

export function getPeriodInfo(
  date: Date = new Date(),
  mode: TimeRange = 'quarter',
  timeZone = 'UTC',
): PeriodInfo {
  const current = getZonedDate(date, timeZone);
  const currentUtc = civilToUtc(current.year, current.month, current.day);
  let startUtc: Date;
  let endUtc: Date;
  let title: string;

  if (mode === 'week') {
    startUtc = addDays(currentUtc, -current.weekday);
    endUtc = addDays(startUtc, 6);
    title = `Week of ${formatTitleDate(startUtc)}`;
  } else if (mode === 'month') {
    startUtc = civilToUtc(current.year, current.month, 1);
    endUtc = civilToUtc(current.year, current.month + 1, 0);
    title = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(startUtc);
  } else if (mode === 'quarter') {
    const quarter = Math.floor((current.month - 1) / 3) + 1;
    const startMonth = (quarter - 1) * 3 + 1;

    startUtc = civilToUtc(current.year, startMonth, 1);
    endUtc = civilToUtc(current.year, startMonth + 3, 0);
    title = `Q${quarter} ${current.year}`;
  } else if (mode === 'rolling14') {
    startUtc = currentUtc;
    endUtc = addDays(startUtc, 13);
    title = 'Next 14 days';
  } else {
    startUtc = civilToUtc(current.year, 1, 1);
    endUtc = civilToUtc(current.year, 12, 31);
    title = String(current.year);
  }

  const totalDays = diffDays(startUtc, endUtc) + 1;
  const currentDay = diffDays(startUtc, currentUtc) + 1;

  return {
    mode,
    kind: mode === 'rolling14' ? 'rolling' : 'fixed',
    title,
    startDate: formatDate(startUtc),
    endDate: formatDate(endUtc),
    currentDate: formatDate(currentUtc),
    currentDay,
    totalDays,
    daysLeft: totalDays - currentDay,
    percentComplete:
      mode === 'rolling14' ? 0 : Math.round((currentDay / totalDays) * 100),
  };
}

export function dateAtPeriodDay(startDate: string, day: number): string {
  const [year, month, date] = startDate.split('-').map(Number);

  return formatDate(addDays(civilToUtc(year, month, date), day - 1));
}

export function dayInPeriod(date: string, period: PeriodInfo): number | null {
  const target = parseDate(date);
  const start = parseDate(period.startDate);
  const end = parseDate(period.endDate);

  if (target < start || target > end) {
    return null;
  }

  return diffDays(start, target) + 1;
}

export function isWeekendDate(date: string): boolean {
  const weekday = parseDate(date).getUTCDay();

  return weekday === 0 || weekday === 6;
}

function getZonedDate(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekdays[values.weekday] ?? 0,
  };
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);

  return civilToUtc(year, month, day);
}

function civilToUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function diffDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTitleDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
