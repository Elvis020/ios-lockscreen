import { describe, expect, it } from 'vitest';
import { normalizeUserData } from '../lib/userSchema';
import { buildWallpaperModel } from '../lib/wallpaperModel';

describe('buildWallpaperModel', () => {
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
});
