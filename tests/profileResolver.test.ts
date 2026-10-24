import { describe, expect, it } from 'vitest';
import { resolveReadTimeAppearance } from '../lib/profileResolver';
import { normalizeUserData } from '../lib/userSchema';

describe('automatic profile resolver', () => {
  it.each([
    ['2026-10-24T05:59:00Z', 'night'],
    ['2026-10-24T06:00:00Z', 'day'],
    ['2026-10-24T17:59:00Z', 'day'],
    ['2026-10-24T18:00:00Z', 'evening'],
    ['2026-10-24T22:00:00Z', 'night'],
  ] as const)('selects the fixed account-time slot at %s', (time, slot) => {
    const user = normalizedUser();

    expect(resolveReadTimeAppearance(user, new Date(time)).slot).toBe(slot);
  });

  it('falls back to the base appearance when the matching slot is disabled', () => {
    const user = normalizedUser();

    user.automaticProfiles!.day.enabled = false;
    const appearance = resolveReadTimeAppearance(user, new Date('2026-10-24T12:00:00Z'));

    expect(appearance).toMatchObject({ slot: null, theme: 'default' });
  });
});

function normalizedUser() {
  const user = normalizeUserData(
    {
      schemaVersion: 5,
      token: 'owner',
      name: 'Ada',
      theme: 'default',
      viewMode: 'quarter',
      timeRange: 'quarter',
      presentation: 'calendar',
      lockScreenProfile: 'standard',
      eventCount: 2,
      timeZone: 'UTC',
      customThemes: [],
      events: [],
      googleAccounts: [],
      selectedEventIds: [],
      cachedCalEvents: [],
      cachedCalAt: 0,
      automaticProfiles: {
        enabled: true,
        day: { enabled: true, theme: 'ocean' },
        evening: { enabled: true, theme: 'sunset' },
        night: { enabled: true, theme: 'midnight' },
      },
    },
    'owner',
  );

  if (!user) throw new Error('Expected valid test user');

  return user;
}
