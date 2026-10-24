import { describe, expect, it } from 'vitest';
import { normalizeUserData } from '../lib/userSchema';

describe('normalizeUserData', () => {
  it.each([undefined, null, '5', 0, 6, -1, 2.5, Infinity])(
    'defaults missing or invalid event count %s to two',
    (eventCount) => {
      expect(normalizeUserData({ eventCount }, 'owner')?.eventCount).toBe(2);
    },
  );

  it.each([1, 2, 3, 4, 5])('preserves supported event count %s', (eventCount) => {
    expect(normalizeUserData({ eventCount }, 'owner')?.eventCount).toBe(eventCount);
  });
  it.each(['agenda', 'minimal'])(
    'falls back from retired %s presentation without losing data',
    (presentation) => {
      const raw = {
        token: 'owner',
        wallpaperKey: 'read-only',
        timeRange: 'year',
        presentation,
        theme: 'minimal',
        events: [{ name: 'Launch', date: '2026-12-01' }],
        selectedEventIds: ['google-one'],
      };
      const before = structuredClone(raw);
      const user = normalizeUserData(raw, 'owner');

      expect(user).toMatchObject({
        wallpaperKey: 'read-only',
        timeRange: 'year',
        presentation: 'calendar',
        theme: 'minimal',
        selectedEventIds: ['google-one'],
      });
      expect(user?.events[0].name).toBe('Launch');
      expect(raw).toEqual(before);
    },
  );

  it('normalizes legacy users without destructive migration', () => {
    const user = normalizeUserData(
      {
        token: 'legacy-token',
        name: 'Ada',
        theme: 'default',
        events: [{ name: '100% review: phase, two', date: '2026-12-01' }],
      },
      'legacy-token',
    );

    expect(user).toMatchObject({
      schemaVersion: 3,
      token: 'legacy-token',
      timeRange: 'quarter',
      presentation: 'calendar',
      lockScreenProfile: 'standard',
      timeZone: 'UTC',
      wallpaperKey: undefined,
    });
    expect(user?.events[0]).toMatchObject({
      id: 'legacy-0-2026-12-01',
      name: '100% review: phase, two',
      source: 'manual',
    });
    expect(user?.selectedEventIds).toEqual([]);
    expect(user?.customThemes).toEqual([]);
  });

  it('preserves a legacy account period while accepting v3 wallpaper settings', () => {
    expect(
      normalizeUserData(
        {
          token: 'legacy-month',
          viewMode: 'month',
        },
        'legacy-month',
      ),
    ).toMatchObject({
      timeRange: 'month',
      presentation: 'calendar',
      lockScreenProfile: 'standard',
    });

    expect(
      normalizeUserData(
        {
          token: 'current',
          timeRange: 'year',
          presentation: 'progress',
          lockScreenProfile: 'large-clock',
        },
        'current',
      ),
    ).toMatchObject({
      timeRange: 'year',
      presentation: 'progress',
      lockScreenProfile: 'large-clock',
    });
  });
});
