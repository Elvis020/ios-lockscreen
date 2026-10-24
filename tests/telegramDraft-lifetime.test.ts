import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

let redis: InMemoryRedis;

describe('Telegram event draft lifetime', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an absolute 15-minute expiry and rejects stale revisions', async () => {
    let now = Date.parse('2026-10-24T12:00:00.000Z');

    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const { createTelegramDraft, getTelegramDraft, updateTelegramDraftDate } =
      await import('../lib/telegramDrafts');
    const first = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
    });

    now += 14 * 60 * 1000;

    const updated = await updateTelegramDraftDate(
      '42',
      first.id,
      '2026-11-01',
      first.revision,
    );

    expect(updated?.expiresAt).toBe(first.expiresAt);
    await expect(
      updateTelegramDraftDate('42', first.id, '2026-11-02', first.revision),
    ).resolves.toBeNull();

    now += 61 * 1000;

    await expect(getTelegramDraft('42')).resolves.toBeNull();
  });
});
