import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';
import type * as TokenManager from '../lib/tokenManager';

let redis: InMemoryRedis;
let manager: typeof TokenManager;

const account = {
  id: 'account',
  email: 'ada@example.com',
  connectedAt: '2026-01-01T00:00:00Z',
};
const event = (id: string, date: string, recurrence = 'none') => ({
  id,
  name: id,
  date,
  recurrence,
  source: 'manual',
  createdAt: '2026-01-01T00:00:00Z',
});
const google = (id: string, date: string) => ({
  id,
  name: id,
  date,
  accountEmail: account.email,
});
const user = () => ({
  token: 'owner',
  name: 'Ada',
  timeZone: 'America/Los_Angeles',
  theme: 'default',
  events: [
    event('past', '2026-10-30'),
    event('today', '2026-10-31'),
    event('repeat', '2026-10-01', 'weekly'),
  ],
  googleAccounts: [account],
  cachedCalEvents: [
    google('expired', '2026-10-30'),
    google('current', '2026-10-31'),
    { ...google('recurring-google', '2026-10-30'), recurring: true },
  ],
  selectedEventIds: ['expired', 'missing', 'current', 'recurring-google'],
  googleSelectionRevision: 4,
  focusEventId: 'past',
  googleCategoryOverrides: {
    expired: 'work',
    missing: 'travel',
    current: 'health',
    'recurring-google': 'personal',
  },
  sharedCountdowns: [
    { id: 'share', eventId: 'past', key: 'secret', createdAt: '2026-01-01T00:00:00Z' },
  ],
});

describe('event cleanup', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T00:30:00Z'));
    vi.resetModules();
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
    manager = await import('../lib/tokenManager');
    await redis.set('user:owner', user());
    await redis.set('share:secret', { token: 'owner', shareId: 'share' });
  });

  afterEach(() => vi.useRealTimers());

  it('retains today and recurring anchors, persists cleanup and removes orphan metadata', async () => {
    const cleaned = await manager.getUser('owner');

    expect(cleaned?.events.map(({ id }) => id)).toEqual(['today', 'repeat']);
    expect(cleaned?.cachedCalEvents.map(({ id }) => id)).toEqual([
      'current',
      'recurring-google',
    ]);
    expect(cleaned?.selectedEventIds).toEqual(['missing', 'current', 'recurring-google']);
    expect(cleaned?.googleSelectionRevision).toBe(5);
    expect(cleaned?.focusEventId).toBeUndefined();
    expect(cleaned?.googleCategoryOverrides).toEqual({
      missing: 'travel',
      current: 'health',
      'recurring-google': 'personal',
    });
    expect(cleaned?.sharedCountdowns).toEqual([]);
    expect(await redis.get('share:secret')).toBeNull();
    expect(await manager.getUser('owner')).toEqual(cleaned);
    expect(
      (await redis.get<{ googleSelectionRevision: number }>('user:owner'))
        ?.googleSelectionRevision,
    ).toBe(5);

    vi.setSystemTime(new Date('2026-11-01T08:00:00Z'));
    expect((await manager.getUser('owner'))?.events.map(({ id }) => id)).toEqual([
      'repeat',
    ]);
    expect((await manager.getUser('owner'))?.selectedEventIds).toEqual([
      'missing',
      'recurring-google',
    ]);
  });

  it('applies cleanup after changing timezone or disabling recurrence', async () => {
    await manager.updatePreferences('owner', { timeZone: 'UTC' });
    expect((await manager.getUser('owner'))?.events.map(({ id }) => id)).toEqual([
      'repeat',
    ]);
    await manager.setManualEventRecurrence('owner', 'repeat', 'none');
    expect((await manager.getUser('owner'))?.events).toEqual([]);
  });

  it('cleans a past draft save and persists cleanup on replay', async () => {
    await redis.set('user:owner', {
      ...user(),
      telegram: { userId: '42', chatId: '42' },
    });
    const { createTelegramDraft } = await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Old draft',
      date: '2026-10-01',
      operation: 'create',
      step: 'review',
    });

    expect(await manager.saveTelegramDraftEvent('owner', draft)).toBe('saved');
    expect(await manager.saveTelegramDraftEvent('owner', draft)).toBe('already-saved');
    expect((await manager.getUser('owner'))?.events.map(({ id }) => id)).toEqual([
      'today',
      'repeat',
    ]);
    expect(await redis.get('share:secret')).toBeNull();
  });

  it('fences a sync started before expiry and cleans newly added past entries', async () => {
    await expect(
      manager.updateCachedCalEvents(
        'owner',
        [google('expired', '2026-10-30')],
        manager.googleAccountRevision([account]),
        4,
      ),
    ).rejects.toThrow('Google selections changed during sync');
    expect((await manager.getUser('owner'))?.selectedEventIds).toEqual([
      'missing',
      'current',
      'recurring-google',
    ]);
    await manager.addManualEvent('owner', { name: 'Old', date: '2026-10-01' });
    expect(
      (await manager.getUser('owner'))?.events.some(({ name }) => name === 'Old'),
    ).toBe(false);
    await manager.updateCachedCalEvents(
      'owner',
      [google('old-new', '2026-10-01'), google('new', '2026-11-02')],
      manager.googleAccountRevision([account]),
      5,
    );
    expect((await manager.getUser('owner'))?.cachedCalEvents.map(({ id }) => id)).toEqual(
      ['new'],
    );
  });
});
