import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';
import type * as TokenManager from '../lib/tokenManager';

let redis: InMemoryRedis;
let tokenManager: typeof TokenManager;

describe('token manager serialization', () => {
  beforeEach(async () => {
    vi.resetModules();
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
    tokenManager = await import('../lib/tokenManager');
  });

  it('retains both concurrent user mutations and one wallpaper key', async () => {
    await redis.set('user:owner', userRecord('owner'));

    await Promise.all([
      tokenManager.addManualEvent('owner', {
        name: 'First',
        date: '2026-11-01',
      }),
      tokenManager.addManualEvent('owner', {
        name: 'Second',
        date: '2026-11-02',
      }),
    ]);

    const user = await tokenManager.getUser('owner');

    expect(user?.events.map(({ name }) => name).sort()).toEqual(['First', 'Second']);
    expect(user?.wallpaperKey).toBeTruthy();
    expect(await redis.get(`wallpaper:${user?.wallpaperKey}`)).toBe('owner');
  });

  it('retries from fresh state when the original lease is lost before commit', async () => {
    const delayedRedis = new DelayedUserReadRedis('user:owner');

    redis = delayedRedis;
    await redis.set('user:owner', userRecord('owner'));

    const firstMutation = tokenManager.addManualEvent('owner', {
      name: 'First',
      date: '2026-11-01',
    });

    await delayedRedis.readStarted;
    redis.store.delete('lock:user:owner');

    await tokenManager.addManualEvent('owner', {
      name: 'Second',
      date: '2026-11-02',
    });

    delayedRedis.releaseRead();
    await firstMutation;

    expect(
      (await tokenManager.getUser('owner'))?.events.map(({ name }) => name).sort(),
    ).toEqual(['First', 'Second']);
  });

  it('serializes invite redemption at the maximum-use boundary', async () => {
    await redis.set('invite:single', {
      code: 'single',
      maxUses: 1,
      usedBy: [],
      createdAt: '2026-10-23T00:00:00.000Z',
    });

    const results = await Promise.all([
      tokenManager.createUser('single', 'Ada'),
      tokenManager.createUser('single', 'Grace'),
    ]);

    expect(results.filter((result) => 'token' in result)).toHaveLength(1);
    expect(results.filter((result) => 'error' in result)).toEqual([
      { error: 'Invite code has reached maximum uses' },
    ]);
  });

  it('keeps the stable account id when Google credentials are refreshed', async () => {
    await redis.set('user:owner', {
      ...userRecord('owner'),
      googleAccounts: [
        {
          id: 'stable-account',
          email: 'ada@example.com',
          encryptedRefreshToken: 'old',
          connectedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    });

    await tokenManager.addGoogleAccount('owner', {
      id: 'replacement-id',
      email: 'ada@example.com',
      encryptedRefreshToken: 'new',
      connectedAt: '2026-10-23T00:00:00.000Z',
    });

    expect((await tokenManager.getUser('owner'))?.googleAccounts[0]).toMatchObject({
      id: 'stable-account',
      encryptedRefreshToken: 'new',
    });
  });

  it('revokes stale Telegram mappings when an identity is relinked', async () => {
    await redis.set('user:first', {
      ...userRecord('first'),
      telegram: {
        userId: '1',
        chatId: '1',
        linkedAt: '2026-10-01T00:00:00.000Z',
      },
    });
    await redis.set('user:second', {
      ...userRecord('second'),
      telegram: {
        userId: '2',
        chatId: '2',
        linkedAt: '2026-10-02T00:00:00.000Z',
      },
    });
    await redis.set('telegram:user:1', 'first');
    await redis.set('telegram:user:2', 'second');

    await tokenManager.linkTelegramIdentity('first', {
      userId: '2',
      chatId: '2',
      linkedAt: '2026-10-23T00:00:00.000Z',
    });

    expect(await redis.get('telegram:user:1')).toBeNull();
    expect(await redis.get('telegram:user:2')).toBe('first');
    expect((await tokenManager.getUser('first'))?.telegram?.userId).toBe('2');
    expect((await tokenManager.getUser('second'))?.telegram).toBeUndefined();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(
      {
        message: {
          text: '/add 2026-11-01 Revoked identity event',
          chat: { id: 1, type: 'private' },
          from: { id: 1 },
        },
      },
      'https://example.com',
    );

    expect((await tokenManager.getUser('first'))?.events).toEqual([]);
    errorSpy.mockRestore();
  });

  it('ignores Telegram commands outside private chats', async () => {
    await redis.set('user:owner', userRecord('owner'));
    await redis.set('telegram:user:42', 'owner');
    await redis.set('telegram:link:group-code', 'owner');
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(
      {
        message: {
          text: '/start group-code',
          chat: { id: -100, type: 'supergroup' },
          from: { id: 42 },
        },
      },
      'https://example.com',
    );
    await processTelegramUpdate(
      {
        message: {
          text: '/add 2026-11-01 Group event',
          chat: { id: -100, type: 'supergroup' },
          from: { id: 42 },
        },
      },
      'https://example.com',
    );

    expect((await tokenManager.getUser('owner'))?.events).toEqual([]);
    expect(await redis.get('telegram:link:group-code')).toBe('owner');
  });

  it('rejects a stale sync snapshot after account credentials change', async () => {
    const originalAccount = {
      id: 'stable-account',
      email: 'ada@example.com',
      encryptedRefreshToken: 'old',
      connectedAt: '2026-10-01T00:00:00.000Z',
    };

    await redis.set('user:owner', {
      ...userRecord('owner'),
      googleAccounts: [originalAccount],
      cachedCalEvents: [
        {
          id: 'stable-account:existing',
          name: 'Existing',
          date: '2026-11-02',
          accountEmail: 'ada@example.com',
        },
      ],
    });

    const snapshot = tokenManager.googleAccountRevision([originalAccount]);

    await tokenManager.addGoogleAccount('owner', {
      ...originalAccount,
      encryptedRefreshToken: 'new',
    });

    await expect(
      tokenManager.updateCachedCalEvents(
        'owner',
        [
          {
            id: 'stable-account:stale',
            name: 'Stale',
            date: '2026-11-03',
            accountEmail: 'ada@example.com',
          },
        ],
        snapshot,
      ),
    ).rejects.toThrow('Google accounts changed during sync; please retry');

    expect((await tokenManager.getUser('owner'))?.cachedCalEvents[0]?.name).toBe(
      'Existing',
    );
  });

  it('commits a Google sync cache and completion marker only once', async () => {
    const account = {
      id: 'stable-account',
      email: 'ada@example.com',
      encryptedRefreshToken: 'encrypted',
      connectedAt: '2026-10-01T00:00:00.000Z',
    };
    const completion = {
      key: 'telegram:update:done:sync',
      ttlSeconds: 86_400,
    };

    await redis.set('user:owner', {
      ...userRecord('owner'),
      googleAccounts: [account],
    });

    const revision = tokenManager.googleAccountRevision([account]);

    await tokenManager.updateCachedCalEvents(
      'owner',
      [calendarEvent('first')],
      revision,
      completion,
    );
    await tokenManager.updateCachedCalEvents(
      'owner',
      [calendarEvent('retry')],
      revision,
      completion,
    );

    expect((await tokenManager.getUser('owner'))?.cachedCalEvents).toEqual([
      calendarEvent('first'),
    ]);
    expect(await redis.get(completion.key)).toBe('done');
  });
});

class DelayedUserReadRedis extends InMemoryRedis {
  readonly readStarted: Promise<void>;
  private delayed = true;
  private readonly notifyReadStarted: () => void;
  private readonly readReleased: Promise<void>;
  private readonly notifyReadReleased: () => void;

  constructor(private readonly delayedKey: string) {
    super();

    let notifyReadStarted: () => void = () => undefined;
    let notifyReadReleased: () => void = () => undefined;

    this.readStarted = new Promise((resolve) => {
      notifyReadStarted = resolve;
    });
    this.readReleased = new Promise((resolve) => {
      notifyReadReleased = resolve;
    });
    this.notifyReadStarted = notifyReadStarted;
    this.notifyReadReleased = notifyReadReleased;
  }

  override async get<T>(key: string): Promise<T | null> {
    const value = await super.get<T>(key);

    if (key === this.delayedKey && this.delayed) {
      this.delayed = false;
      this.notifyReadStarted();
      await this.readReleased;
    }

    return value;
  }

  releaseRead(): void {
    this.notifyReadReleased();
  }
}

function calendarEvent(suffix: string) {
  return {
    id: `stable-account:${suffix}`,
    name: suffix,
    date: '2026-11-03',
    accountEmail: 'ada@example.com',
  };
}

function userRecord(token: string) {
  return {
    schemaVersion: 2,
    token,
    name: 'Ada',
    theme: 'default',
    viewMode: 'quarter',
    timeZone: 'UTC',
    customThemes: [],
    events: [],
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
  };
}
