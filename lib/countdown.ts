import { nextOccurrenceOnOrAfter } from './eventTimeline';
import { getPeriodInfo } from './periodCalculator';
import type { UserData } from './userSchema';
import { formatCountdown } from './wallpaperModel';

const DAY = 86_400_000;

/** Resolve the first real instant in a civil date, including skipped local midnight. */
function midnight(date: string, timeZone: string): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'iso8601',
    numberingSystem: 'latn',
  });
  const localDate = (instant: number): string => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
    );

    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (localDate(middle) < date) low = middle + 1;
    else high = middle;
  }

  return new Date(low);
}

export function buildCountdown(user: UserData, now = new Date()) {
  const today = getPeriodInfo(now, 'week', user.timeZone).currentDate;
  const candidates = [
    ...user.events.flatMap((event) => {
      const date = nextOccurrenceOnOrAfter(event, today);

      return date ? [{ name: event.name, date }] : [];
    }),
    ...user.cachedCalEvents
      .filter((event) => user.selectedEventIds.includes(event.id) && event.date >= today)
      .map(({ name, date }) => ({ name, date })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const event = candidates[0];
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY)
    .toISOString()
    .slice(0, 10);

  if (!event) {
    return {
      version: 1,
      generatedAt: now.toISOString(),
      refreshAfter: midnight(tomorrow, user.timeZone).toISOString(),
      nextEvent: null,
    };
  }

  const daysLeft = Math.round(
    (Date.parse(`${event.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY,
  );
  const targetAt = midnight(event.date, user.timeZone).toISOString();
  const nextMidnight = midnight(tomorrow, user.timeZone);
  const timerStart = new Date(Date.parse(targetAt) - DAY);
  const refreshAfter =
    timerStart > now && timerStart < nextMidnight ? timerStart : nextMidnight;

  return {
    version: 1,
    generatedAt: now.toISOString(),
    refreshAfter: refreshAfter.toISOString(),
    nextEvent: {
      name: event.name,
      date: event.date,
      targetAt,
      daysLeft,
      countdownLabel: formatCountdown(daysLeft),
    },
  };
}
