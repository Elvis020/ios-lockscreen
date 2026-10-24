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

  it('normalizes pre-step create drafts on read without extending their expiry', async () => {
    const { getTelegramDraft } = await import('../lib/telegramDrafts');
    const expiresAt = Date.now() + 60_000;

    await redis.set('telegram:draft:42', {
      id: 'legacy-draft',
      revision: 'legacy-revision',
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
      date: '2026-11-01',
      createdAt: Date.now(),
      expiresAt,
    });

    await expect(getTelegramDraft('42')).resolves.toMatchObject({
      operation: 'create',
      step: 'review',
      expiresAt,
    });
  });

  it('preserves edit expiry through name and date transitions while rejecting stale revisions', async () => {
    let now = Date.parse('2026-10-24T12:00:00.000Z');

    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const {
      clearTelegramDraftDate,
      createTelegramDraft,
      updateTelegramDraftDate,
      updateTelegramDraftName,
      updateTelegramDraftStep,
    } = await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
      date: '2026-11-01',
      operation: 'edit',
      step: 'review',
      original: {
        id: 'dentist',
        name: 'Dentist',
        date: '2026-11-01',
        source: 'manual',
        createdAt: '2026-10-23T00:00:00.000Z',
      },
    });

    now += 5 * 60 * 1000;
    const nameStep = await updateTelegramDraftStep(
      '42',
      draft.id,
      draft.revision,
      'name',
    );
    const named = await updateTelegramDraftName(
      '42',
      draft.id,
      'Annual checkup',
      nameStep!.revision,
    );
    const dateStep = await clearTelegramDraftDate('42', draft.id, named!.revision);
    const dated = await updateTelegramDraftDate(
      '42',
      draft.id,
      '2026-11-02',
      dateStep!.revision,
    );

    expect(
      [nameStep, named, dateStep, dated].map((transition) => transition?.expiresAt),
    ).toEqual([draft.expiresAt, draft.expiresAt, draft.expiresAt, draft.expiresAt]);
    await expect(
      updateTelegramDraftName('42', draft.id, 'Stale', nameStep!.revision),
    ).resolves.toBeNull();
  });
});
