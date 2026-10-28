import { describe, expect, it } from 'vitest';
import { normalizeUserData } from '../lib/userSchema';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import { dateAtPeriodDay } from '../lib/periodCalculator';

describe('buildWallpaperModel', () => {
  it.each(['week', 'month', 'quarter', 'rolling14', 'year'] as const)(
    'keeps %s cells consecutive from day one without calendar spacer cells',
    (timeRange) => {
      const model = buildWallpaperModel({
        date: new Date('2028-02-15T12:00:00Z'),
        timeRange,
      });

      expect(model.cells).toHaveLength(model.period.totalDays);
      expect(model.cells[0].date).toBe(model.period.startDate);
      expect(model.cells.at(-1)?.date).toBe(model.period.endDate);
      expect(model.cells.map(({ date }) => date)).toEqual(
        Array.from({ length: model.period.totalDays }, (_, index) =>
          dateAtPeriodDay(model.period.startDate, index + 1),
        ),
      );
    },
  );
  it('uses structured event names without delimiter parsing', () => {
    const user = normalizeUserData(
      {
        token: 'token',
        name: 'Ada',
        theme: 'default',
        viewMode: 'month',
        timeZone: 'UTC',
        events: [{ name: '100% review: phase, two', date: '2026-10-30' }],
      },
      'token',
    );
    const model = buildWallpaperModel({
      user,
      date: new Date('2026-10-23T12:00:00Z'),
    });

    expect(model.events[0]?.name).toBe('100% review: phase, two');
    expect(model.cells.find(({ date }) => date === '2026-10-30')?.event).toBe(true);
  });

  it('shows only selected cached Google events', () => {
    const user = normalizeUserData(
      {
        token: 'token',
        name: 'Ada',
        theme: 'default',
        viewMode: 'month',
        timeZone: 'UTC',
        events: [],
        selectedEventIds: ['google:1'],
        cachedCalEvents: [
          {
            id: 'google:1',
            name: 'Selected',
            date: '2026-10-25',
            accountEmail: 'a@example.com',
          },
          {
            id: 'google:2',
            name: 'Hidden',
            date: '2026-10-26',
            accountEmail: 'a@example.com',
          },
        ],
      },
      'token',
    );
    const model = buildWallpaperModel({
      user,
      date: new Date('2026-10-23T12:00:00Z'),
    });

    expect(model.events.map(({ name }) => name)).toEqual(['Selected']);
  });

  it('aligns calendar months and keeps today distinct from an event marker', () => {
    const model = buildWallpaperModel({
      date: new Date('2026-10-23T12:00:00Z'),
      timeRange: 'month',
      publicEvents: [{ name: 'Today', date: '2026-10-23' }],
    });
    const october = model.monthGroups[0];
    const today = model.cells.find(({ date }) => date === '2026-10-23');

    expect(october.cells.slice(0, 4)).toEqual([null, null, null, null]);
    expect(today).toMatchObject({ current: true, event: true, day: 23 });
    expect(model.events[0]).toMatchObject({ countdownLabel: 'Today' });
  });

  it('builds labeled quarter and year month groups with singular countdown copy', () => {
    const quarter = buildWallpaperModel({
      date: new Date('2026-10-23T12:00:00Z'),
      timeRange: 'quarter',
      publicEvents: [{ name: 'Tomorrow', date: '2026-10-24' }],
    });
    const year = buildWallpaperModel({
      date: new Date('2026-10-23T12:00:00Z'),
      timeRange: 'year',
    });

    expect(quarter.monthGroups.map(({ label }) => label)).toEqual([
      'October',
      'November',
      'December',
    ]);
    expect(quarter.events[0]?.countdownLabel).toBe('Tomorrow');
    expect(year.monthGroups).toHaveLength(12);
  });

  it('limits agenda events to its period without narrowing other presentations', () => {
    const publicEvents = [
      { name: 'Last agenda day', date: '2026-11-05' },
      { name: 'Just outside agenda', date: '2026-11-06' },
      { name: 'Later global event', date: '2026-11-12' },
    ];
    const agenda = buildWallpaperModel({
      date: new Date('2026-10-23T12:00:00Z'),
      timeRange: 'rolling14',
      presentation: 'agenda',
      publicEvents,
    });
    const calendar = buildWallpaperModel({
      date: new Date('2026-10-23T12:00:00Z'),
      timeRange: 'rolling14',
      presentation: 'calendar',
      publicEvents,
    });

    expect(agenda.period.endDate).toBe('2026-11-05');
    expect(agenda.events.map(({ name }) => name)).toEqual(['Last agenda day']);
    expect(calendar.events.map(({ name }) => name)).toContain('Later global event');
  });

  it('keeps every upcoming event for accurate overflow and calendar markers', () => {
    const publicEvents = Array.from({ length: 10 }, (_, index) => ({
      name: `Event ${index + 1}`,
      date: `2026-10-${String(index + 22).padStart(2, '0')}`,
    })).reverse();
    const model = buildWallpaperModel({
      date: new Date('2026-10-23T12:00:00Z'),
      timeRange: 'month',
      publicEvents,
    });

    expect(model.events).toHaveLength(9);
    expect(model.events[0]).toMatchObject({ name: 'Event 2', countdownLabel: 'Today' });
    expect(model.events.at(-1)).toMatchObject({
      name: 'Event 10',
      countdownLabel: '8d',
    });
    expect(model.cells.find(({ date }) => date === '2026-10-31')?.event).toBe(true);
    expect(
      model.monthGroups[0].cells.find((cell) => cell?.date === '2026-10-31')?.event,
    ).toBe(true);
  });

  it('keeps countdown lines meaningful beyond the visible month or year', () => {
    for (const timeRange of ['month', 'year'] as const) {
      const model = buildWallpaperModel({
        date: new Date('2026-10-23T12:00:00Z'),
        timeRange,
        publicEvents: [
          { name: 'Today', date: '2026-10-23' },
          { name: 'Next year', date: '2027-01-08' },
        ],
      });

      expect(model.events[0].progressPercent).toBe(100);
      expect(model.events[1].progressPercent).toBeGreaterThan(0);
      expect(model.events[1].progressPercent).toBeLessThan(100);
      expect(model.events[1].countdownLabel).toBe('77d');
      expect(model.events[1]).not.toHaveProperty('dateLabel');
      expect(model.events[1].date).toBe('2027-01-08');
    }
  });

  it('starts a period-to-event timer at its inclusive first day', () => {
    const model = buildWallpaperModel({
      date: new Date('2026-10-01T12:00:00Z'),
      timeRange: 'month',
      publicEvents: [{ name: 'Tomorrow', date: '2026-10-02' }],
    });

    expect(model.events[0]).toMatchObject({
      countdownLabel: 'Tomorrow',
      progressPercent: 50,
    });
  });
});
