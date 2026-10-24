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
        theme: 'default',
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
      schemaVersion: 5,
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

  it('makes legacy manual categories and recurrence explicit', () => {
    const user = normalizeUserData(
      { events: [{ name: 'Payday', date: '2026-12-01' }] },
      'owner',
    );

    expect(user?.events[0]).toMatchObject({ category: 'general', recurrence: 'none' });
  });

  it('preserves a custom profile theme while leaving absent slots unset', () => {
    const user = normalizeUserData(
      {
        customThemes: [
          {
            id: 'my-theme',
            background: '#101010',
            passed: '#111111',
            weekend: '#222222',
            current: '#333333',
            future: '#444444',
            text: '#eeeeee',
            subtext: '#aaaaaa',
          },
        ],
        automaticProfiles: { enabled: true, day: { enabled: true, theme: 'my-theme' } },
      },
      'owner',
    );

    expect(user?.automaticProfiles?.day).toMatchObject({ theme: 'my-theme' });
    expect(user?.automaticProfiles?.day.livingOverlay).toBeUndefined();
    expect(user?.automaticProfiles?.day.milestoneRingStyle).toBeUndefined();
  });

  it('keeps explicit profile living and ring choices', () => {
    const user = normalizeUserData(
      {
        automaticProfiles: {
          enabled: true,
          evening: { enabled: true, livingOverlay: 'stars', milestoneRingStyle: 'halo' },
        },
      },
      'owner',
    );

    expect(user?.automaticProfiles?.evening).toMatchObject({
      livingOverlay: 'stars',
      milestoneRingStyle: 'halo',
    });
  });

  it('falls back from an invalid optional profile theme', () => {
    const user = normalizeUserData(
      { automaticProfiles: { enabled: true, day: { enabled: true, theme: 'gone' } } },
      'owner',
    );

    expect(user?.automaticProfiles?.day.theme).toBeUndefined();
  });

  it('normalizes malformed manual category and recurrence independently', () => {
    const user = normalizeUserData(
      {
        events: [
          { name: 'Trip', date: '2026-12-01', category: 'bad', recurrence: 'weekly' },
        ],
      },
      'owner',
    );

    expect(user?.events[0]).toMatchObject({ category: 'general', recurrence: 'weekly' });
  });

  it('preserves a legacy custom theme that now collides with a built-in', () => {
    const user = normalizeUserData(
      {
        schemaVersion: 3,
        theme: 'midnight',
        customThemes: [
          {
            id: 'midnight',
            background: '#010203',
            passed: '#111111',
            weekend: '#222222',
            current: '#333333',
            future: '#444444',
            text: '#EEEEEE',
            subtext: '#999999',
          },
        ],
      },
      'owner',
    );

    expect(user?.schemaVersion).toBe(5);
    expect(user?.theme).toBe('midnight-custom');
    expect(user?.customThemes).toEqual([
      expect.objectContaining({ id: 'midnight-custom', background: '#010203' }),
    ]);
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
