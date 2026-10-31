import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserData } from '../lib/userSchema';
import { InMemoryRedis } from './helpers/inMemoryRedis';

let redis: InMemoryRedis;
let failure: Error | undefined;
let batch: {
  calendarCount: number;
  events: UserData['cachedCalEvents'];
  idAliases: Record<string, string>;
  windowEnd: string;
  windowStart: string;
};

describe('Google sync status', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    failure = undefined;
    batch = {
      calendarCount: 2,
      events: [],
      idAliases: {},
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
          if (failure) {
            throw failure;
          }

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

  it('preserves cached and selected events when the provider fails', async () => {
    const event = googleEvent('account:event');
    const original = userRecord({
      googleAccounts: [googleAccount()],
      selectedEventIds: [event.id],
      cachedCalEvents: [event],
    });

    await redis.set('user:owner', original);
    failure = new Error('Provider failure');
    const { syncGoogleEvents } = await import('../lib/calendar/service');

    await expect(syncGoogleEvents('owner')).rejects.toThrow('Provider failure');
    expect(await redis.get<UserData>('user:owner')).toEqual(original);
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

  it('migrates selected Google occurrence metadata to the current series ID', async () => {
    const legacyId = 'account:instance-1';
    const stableId = 'g2:account:calendar:series:stable';
    const event = googleEvent(stableId);

    batch.events = [event];
    batch.idAliases = { [legacyId]: stableId };
    await redis.set(
      'user:owner',
      userRecord({
        googleAccounts: [googleAccount()],
        selectedEventIds: [legacyId, legacyId],
        focusEventId: legacyId,
        googleCategoryOverrides: { [legacyId]: 'work' },
        sharedCountdowns: [
          {
            id: 'share',
            eventId: legacyId,
            key: 'share-key',
            createdAt: '2026-10-26T00:00:00.000Z',
          },
        ],
      }),
    );
    const { syncGoogleEvents } = await import('../lib/calendar/service');

    await expect(syncGoogleEvents('owner')).resolves.toMatchObject({ status: 'ready' });

    const updated = await redis.get<UserData>('user:owner');

    expect(updated).toMatchObject({
      selectedEventIds: [stableId],
      focusEventId: stableId,
      googleCategoryOverrides: { [stableId]: 'work' },
    });
    expect(updated?.sharedCountdowns?.[0]?.eventId).toBe(stableId);
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
