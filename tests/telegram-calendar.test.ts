import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
let redis: InMemoryRedis;
let fetchMock: ReturnType<typeof vi.fn>;

describe('Telegram calendar Mini App', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    process.env.TELEGRAM_BOT_TOKEN = '123456:test-token';
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../lib/redis', () => ({
      getRedis: () => redis,
      isRedisConfigurationError: () => false,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serves a private, CSP-protected month grid with the Telegram bridge', async () => {
    const { default: handler } = await import('../api/telegram/calendar');
    const response = await handler(
      new Request('https://example.com/api/telegram/calendar?draft=opaque-draft'),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain(
      "script-src 'nonce-",
    );
    expect(response.headers.get('content-security-policy')).toContain(
      'https://telegram.org',
    );
    expect(html).toContain('telegram-web-app.js');
    expect(html).toContain('class="days"');
    expect(html).toContain("action: 'bootstrap'");
    expect(html).toContain('today = localToday(payload.timeZone)');
    expect(html).toContain("let selectionRequestId = ''");
    expect(html).toContain('if (selectedDate !== value)');
    expect(html).toContain('selectionRequestId = createRequestId()');
    expect(html).toContain('const requestId = selectionRequestId');
    expect(html).not.toContain('opaque-draft');
  });

  it('accepts a verified linked user, updates only the draft, and sends confirmation', async () => {
    await seedLinkedUser();
    const { createTelegramDraft, getTelegramDraft } =
      await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
    });
    const initData = await signedInitData(42);
    const { default: handler } = await import('../api/telegram/calendar');
    const requestBody = {
      draftId: draft.id,
      date: '2026-11-01',
      requestId: 'request-123',
      initData,
    };

    const response = await handler(postRequest(requestBody));
    const retry = await handler(postRequest(requestBody));
    const user = await redis.get<{ events: unknown[] }>('user:owner');
    const updatedDraft = await getTelegramDraft('42');

    expect(response.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, duplicate: true });
    expect(user?.events).toEqual([]);
    expect(updatedDraft?.date).toBe('2026-11-01');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await redis.get('telegram:calendar:request:42:request-123')).toBe('done');
    expect(telegramDeliveryBody()).toMatchObject({
      chat_id: '42',
      text: expect.stringContaining('Sunday, 1 November 2026'),
      parse_mode: 'HTML',
    });
  });

  it('rejects invalid input and a signed but unlinked Telegram identity', async () => {
    await seedLinkedUser();
    const { createTelegramDraft } = await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
    });
    const { default: handler } = await import('../api/telegram/calendar');

    const invalidDate = await handler(
      postRequest({
        draftId: draft.id,
        date: '2026-02-31',
        requestId: 'request-bad-date',
        initData: await signedInitData(42),
      }),
    );
    const wrongUser = await handler(
      postRequest({
        draftId: draft.id,
        date: '2026-11-01',
        requestId: 'request-wrong-user',
        initData: await signedInitData(99),
      }),
    );

    expect(invalidDate.status).toBe(400);
    expect(wrongUser.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the linked account timezone only after signed draft authorization', async () => {
    await seedLinkedUser('Pacific/Kiritimati');
    const { createTelegramDraft } = await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
    });
    const { default: handler } = await import('../api/telegram/calendar');

    const authorized = await handler(
      postRequest({
        action: 'bootstrap',
        draftId: draft.id,
        initData: await signedInitData(42),
      }),
    );
    const unauthorized = await handler(
      postRequest({
        action: 'bootstrap',
        draftId: draft.id,
        initData: await signedInitData(99),
      }),
    );

    expect(await authorized.json()).toEqual({ timeZone: 'Pacific/Kiritimati' });
    expect(unauthorized.status).toBe(409);
    expect(await unauthorized.text()).not.toContain('Pacific/Kiritimati');
  });

  it('accepts only an edit draft in its date step and sends the edit review controls', async () => {
    await seedLinkedUser();
    const { createTelegramDraft, getTelegramDraft, updateTelegramDraftStep } =
      await import('../lib/telegramDrafts');
    const { default: handler } = await import('../api/telegram/calendar');
    const initData = await signedInitData(42);
    const review = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
      date: '2026-11-01',
      operation: 'edit',
      step: 'review',
      original: manualEvent('dentist', 'Dentist'),
    });

    const reviewBootstrap = await handler(
      postRequest({ action: 'bootstrap', draftId: review.id, initData }),
    );
    const nameDraft = await updateTelegramDraftStep(
      '42',
      review.id,
      review.revision,
      'name',
    );
    const nameBootstrap = await handler(
      postRequest({ action: 'bootstrap', draftId: review.id, initData }),
    );

    expect(reviewBootstrap.status).toBe(409);
    expect(nameDraft).toMatchObject({ step: 'name' });
    expect(nameBootstrap.status).toBe(409);

    const dateDraft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
      operation: 'edit',
      step: 'date',
      original: manualEvent('dentist', 'Dentist'),
    });
    const bootstrap = await handler(
      postRequest({ action: 'bootstrap', draftId: dateDraft.id, initData }),
    );
    const posted = await handler(
      postRequest({
        draftId: dateDraft.id,
        date: '2026-11-02',
        requestId: 'edit-date-request',
        initData,
      }),
    );
    const updated = await getTelegramDraft('42');
    const body = telegramDeliveryBody();
    const buttons = (
      body.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }
    ).inline_keyboard
      .flat()
      .map(({ text }) => text);

    expect(await bootstrap.json()).toEqual({ timeZone: 'UTC' });
    expect(posted.status).toBe(200);
    expect(updated).toMatchObject({
      operation: 'edit',
      step: 'review',
      date: '2026-11-02',
    });
    expect((await redis.get<{ events: unknown[] }>('user:owner'))?.events).toEqual([]);
    expect(body.text).toContain('Review changes');
    expect(buttons).toEqual(
      expect.arrayContaining(['Save changes', 'Change name', 'Change date']),
    );
  });

  it('returns a processing conflict rather than duplicate success until the request is done', async () => {
    await seedLinkedUser();
    const { createTelegramDraft } = await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
    });
    const requestBody = {
      draftId: draft.id,
      date: '2026-11-01',
      requestId: 'request-processing',
      initData: await signedInitData(42),
    };
    const requestKey = 'telegram:calendar:request:42:request-processing';
    const { default: handler } = await import('../api/telegram/calendar');

    await redis.set(requestKey, 'active-lease');
    const processing = await handler(postRequest(requestBody));

    await redis.set(requestKey, 'done');
    const completed = await handler(postRequest(requestBody));

    expect(processing.status).toBe(409);
    expect(await processing.json()).toEqual({
      error: 'Calendar request is still processing',
    });
    expect(await completed.json()).toEqual({ ok: true, duplicate: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the body limit from received bytes without Content-Length', async () => {
    const { default: handler } = await import('../api/telegram/calendar');
    const oversizedJson = JSON.stringify({
      draftId: 'valid-draft-id',
      date: '2026-11-01',
      requestId: 'request-too-large',
      initData: 'x'.repeat(8192),
    });
    const request = new Request('https://example.com/api/telegram/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedJson,
    });

    request.headers.delete('content-length');

    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Calendar request is too large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the processing lease when Telegram delivery fails', async () => {
    await seedLinkedUser();
    fetchMock.mockRejectedValueOnce(new Error('Telegram unavailable'));
    const { createTelegramDraft } = await import('../lib/telegramDrafts');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'Dentist',
    });
    const { default: handler } = await import('../api/telegram/calendar');

    const response = await handler(
      postRequest({
        draftId: draft.id,
        date: '2026-11-01',
        requestId: 'request-delivery-failure',
        initData: await signedInitData(42),
      }),
    );

    expect(response.status).toBe(500);
    expect(
      await redis.get('telegram:calendar:request:42:request-delivery-failure'),
    ).toBeNull();
  });
});

async function seedLinkedUser(timeZone = 'UTC'): Promise<void> {
  await redis.set('user:owner', {
    schemaVersion: 4,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    timeRange: 'quarter',
    presentation: 'calendar',
    lockScreenProfile: 'standard',
    eventCount: 2,
    timeZone,
    customThemes: [],
    events: [],
    googleAccounts: [],
    selectedEventIds: [],
    cachedCalEvents: [],
    cachedCalAt: 0,
    telegram: {
      userId: '42',
      chatId: '42',
      linkedAt: '2026-10-23T00:00:00.000Z',
    },
  });
  await redis.set('telegram:user:42', 'owner');
}

function manualEvent(id: string, name: string) {
  return {
    id,
    name,
    date: '2026-11-01',
    source: 'manual' as const,
    createdAt: '2026-10-23T00:00:00.000Z',
  };
}

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/telegram/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function telegramDeliveryBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;

  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

async function signedInitData(userId: number): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `query-${userId}`,
    user: JSON.stringify({ id: userId }),
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const encoder = new TextEncoder();
  const firstKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secret = await crypto.subtle.sign(
    'HMAC',
    firstKey,
    encoder.encode('123456:test-token'),
  );
  const secondKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', secondKey, encoder.encode(dataCheckString)),
  );

  params.set(
    'hash',
    [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  );

  return params.toString();
}
