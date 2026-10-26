import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserData } from '../lib/userSchema';
import { InMemoryRedis } from './helpers/inMemoryRedis';

let redis: InMemoryRedis;
let batch: {
  calendarCount: number;
  events: UserData['cachedCalEvents'];
  windowEnd: string;
  windowStart: string;
};

describe('Google sync status', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    batch = {
      calendarCount: 2,
      events: [],
      windowStart: '2026-10-26',
      windowEnd: '2027-10-26',
    };

    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
    vi.doMock('../lib/calendar/googleProvider', () => ({
      GoogleCalendarProvider: class {
        async listEvents() {
          return batch;
        }
      },
    }));
  });

  it('distinguishes an unconnected account from an empty calendar', async () => {
    await redis.set('user:owner', userRecord());
    const { syncGoogleEvents } = await import('../lib/calendar/service');

    const result = await syncGoogleEvents('owner');

    expect(result).toMatchObject({
      status: 'not_connected',
      accountCount: 0,
      calendarCount: 0,
      fetchedEventCount: 0,
      trackedEventCount: 0,
    });
  });

  it('reports found events that still need to be selected', async () => {
    const event = googleEvent('account:event');

    batch.events = [event];
    await redis.set('user:owner', userRecord({ googleAccounts: [googleAccount()] }));
    const { syncGoogleEvents } = await import('../lib/calendar/service');

    const result = await syncGoogleEvents('owner');

    expect(result).toMatchObject({
      status: 'needs_selection',
      accountCount: 1,
      calendarCount: 2,
      fetchedEventCount: 1,
      trackedEventCount: 0,
    });
    expect((await redis.get<UserData>('user:owner'))?.cachedCalEvents).toEqual([event]);
  });

  it('summarizes the next tracked events after a successful sync', async () => {
    const event = googleEvent('account:event');

    batch.events = [event];
    await redis.set(
      'user:owner',
      userRecord({
        googleAccounts: [googleAccount()],
        selectedEventIds: [event.id],
        cachedCalEvents: [event],
      }),
    );
    const { syncGoogleEvents } = await import('../lib/calendar/service');

    const result = await syncGoogleEvents('owner');

    expect(result).toMatchObject({
      status: 'ready',
      trackedEventCount: 1,
      upcomingTrackedEvents: [{ date: '2026-11-02', name: 'Design review' }],
    });
  });
});

function userRecord(overrides: Partial<UserData> = {}): UserData {
  return {
    schemaVersion: 5,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    timeRange: 'month',
    presentation: 'hybrid',
    lockScreenProfile: 'standard',
    eventCount: 2,
    timeZone: 'UTC',
    customThemes: [],
    events: [],
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
    ...overrides,
  };
}

function googleAccount(): UserData['googleAccounts'][number] {
  return {
    id: 'account',
    email: 'ada@example.com',
    encryptedRefreshToken: 'encrypted',
    connectedAt: '2026-10-26T00:00:00.000Z',
  };
}

function googleEvent(id: string): UserData['cachedCalEvents'][number] {
  return {
    id,
    name: 'Design review',
    date: '2026-11-02',
    accountEmail: 'ada@example.com',
    calendarName: 'Work',
  };
}
