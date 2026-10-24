import type { CalendarEvent, ManualEvent } from './userSchema';

export interface TimelineEvent {
  id: string;
  stableRef: string;
  name: string;
  date: string;
  source: 'manual' | 'google';
  category: string;
}

/** Expands manual recurrence deterministically without mutating stored definitions. */
export function buildEventTimeline(
  manual: ManualEvent[],
  google: CalendarEvent[],
  selectedGoogleIds: string[],
  from: string,
  to: string,
): TimelineEvent[] {
  const selected = new Set(selectedGoogleIds);
  const output: TimelineEvent[] = manual.flatMap((event, index) =>
    expandManualEvent(event, from, to).map((date) => ({
      id: event.id,
      stableRef: `M${index + 1}`,
      name: event.name,
      date,
      source: 'manual' as const,
      category: event.category ?? 'general',
    })),
  );

  google.forEach((event) => {
    const selectedGoogleIndex = selectedGoogleIds.indexOf(event.id);

    if (!selected.has(event.id)) return;
    if (event.date >= from && event.date <= to) {
      output.push({
        id: event.id,
        stableRef: `G${selectedGoogleIndex + 1}`,
        name: event.name,
        date: event.date,
        source: 'google',
        category: (event as CalendarEvent & { category?: string }).category ?? 'general',
      });
    }
  });

  return output.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

/** The sole occurrence used by wallpaper markers and event rows. */
export function nextOccurrenceOnOrAfter(event: ManualEvent, from: string): string | null {
  return expandManualEvent(event, from, '2100-12-31')[0] ?? null;
}

export function expandManualEvent(
  event: ManualEvent,
  from: string,
  to: string,
): string[] {
  const recurrence = event.recurrence ?? 'none';

  if (recurrence === 'none')
    return event.date >= from && event.date <= to ? [event.date] : [];
  const dates: string[] = [];
  const [anchorYear, anchorMonth, anchorDay] = event.date.split('-').map(Number);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  if (recurrence === 'weekly') {
    for (
      let cursor = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay));
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 7)
    ) {
      if (cursor >= start) dates.push(cursor.toISOString().slice(0, 10));
    }

    return dates;
  }

  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  for (let year = Math.max(anchorYear, startYear - 1); year <= endYear; year += 1) {
    const months =
      recurrence === 'monthly'
        ? Array.from({ length: 12 }, (_, index) => index + 1)
        : [anchorMonth];

    for (const month of months) {
      if (
        year === anchorYear &&
        (month < anchorMonth || (month === anchorMonth && anchorDay < 1))
      )
        continue;
      const candidate = exactDate(year, month, anchorDay);

      if (candidate && candidate >= start && candidate <= end)
        dates.push(candidate.toISOString().slice(0, 10));
    }
  }

  return dates;
}

function exactDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 ? date : null;
}
