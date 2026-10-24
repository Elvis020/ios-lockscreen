import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserData } from '../lib/tokenManager';
import { InMemoryRedis } from './helpers/inMemoryRedis';

const originalEnvironment = { ...process.env };
let redis: InMemoryRedis;
let fetchMock: ReturnType<typeof vi.fn>;

describe('Telegram commands', () => {
  beforeEach(() => {
    vi.resetModules();
    redis = new InMemoryRedis();
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
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

  it('keeps the linked command compatibility API returning a string', async () => {
    const { handleLinkedTelegramCommand } = await import('../lib/telegramBot');
    const help = await handleLinkedTelegramCommand(
      'token',
      '/help',
      [],
      'https://example.com',
    );

    expect(typeof help).toBe('string');
    expect(help).toContain('<b>Calendar Lockscreen</b>');
    expect(help).toContain('<b>Wallpaper</b>');
    expect(help).toContain('<b>Events</b>');
    expect(help).toContain('<b>Appearance</b>');
    expect(help).toContain('<b>Calendar</b>');
    expect(help).toContain('/view week|month|quarter|rolling14');
    expect(help).toContain('/range week|month|quarter|rolling14|year');
    expect(help).toContain('/layout calendar|countdown|progress|hybrid');
    expect(help).toContain('/profile standard|large-clock');
    expect(help).toContain('/timezone Area/City');
    expect(help).toContain('/theme custom add');
    expect(help).toContain('/sync');
  });

  it.each(['agenda', 'minimal'])(
    'does not offer or select retired %s views',
    async (retired) => {
      await seedLinkedUser();
      const { handleLinkedTelegramCommand } = await import('../lib/telegramBot');
      const { getUser } = await import('../lib/tokenManager');
      const before = await getUser('owner');

      for (const command of ['/view', '/layout']) {
        const reply = await handleLinkedTelegramCommand(
          'owner',
          command,
          [retired],
          'https://example.com',
        );

        expect(reply).toContain(command);
        expect(reply).not.toContain(`|${retired}`);
        expect(await getUser('owner')).toEqual(before);
      }
    },
  );

  it('sends HTML and inline keyboard options in the Telegram delivery payload', async () => {
    const { sendTelegramMessage } = await import('../lib/telegramBot');
    const replyMarkup = {
      inline_keyboard: [
        [{ text: 'Open wallpaper', url: 'https://example.com/wallpaper' }],
      ],
    };

    await sendTelegramMessage('42', '<b>Status</b>', {
      parseMode: 'HTML',
      replyMarkup,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deliveryBody(0)).toEqual({
      chat_id: '42',
      text: '<b>Status</b>',
      disable_web_page_preview: true,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  });

  it('sends a visual theme contact sheet with a two-column selection keyboard', async () => {
    await seedLinkedUser({ theme: 'ocean' });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/theme list'), 'https://example.com');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;

    expect(url).toContain('/sendPhoto');
    expect(form.get('caption')).toContain('Current: <b>ocean</b>');
    expect(form.get('caption')).not.toContain('wallpaper-key');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    expect(JSON.parse(String(form.get('reply_markup')))).toEqual({
      inline_keyboard: [
        [
          { text: 'default', callback_data: 'theme:default' },
          { text: '✓ ocean', callback_data: 'theme:ocean' },
        ],
        [
          { text: 'sunset', callback_data: 'theme:sunset' },
          { text: 'forest', callback_data: 'theme:forest' },
        ],
      ],
    });
  });

  it('falls back to the text selector when the preview photo cannot be delivered', async () => {
    await seedLinkedUser();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/theme'), 'https://example.com');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deliveryBody(1)).toMatchObject({
      chat_id: '42',
      text: expect.stringContaining('Tap a button below'),
    });
  });

  it('authorizes a theme callback, refreshes the selector, and acknowledges it', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');
    const completion = { key: 'telegram:update:done:theme-callback', ttlSeconds: 86_400 };

    const result = await processTelegramUpdate(
      themeCallback('ocean'),
      'https://example.com',
      completion,
    );

    expect(result.completionCommitted).toBe(true);
    expect((await getUser('owner'))?.theme).toBe('ocean');
    expect(fetchMock.mock.calls[0][0]).toContain('/editMessageCaption');
    expect(deliveryBody(0)).toEqual({
      chat_id: '42',
      message_id: 77,
      caption: expect.stringContaining('Current: <b>ocean</b>'),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'default', callback_data: 'theme:default' },
            { text: '✓ ocean', callback_data: 'theme:ocean' },
          ],
          [
            { text: 'sunset', callback_data: 'theme:sunset' },
            { text: 'forest', callback_data: 'theme:forest' },
          ],
        ],
      },
    });
    expect(fetchMock.mock.calls[1][0]).toContain('/answerCallbackQuery');
    expect(deliveryBody(1)).toEqual({
      callback_query_id: 'callback-1',
      text: 'Theme set to ocean.',
    });
  });

  it('acknowledges an already selected theme without mutating or editing the selector', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    const result = await processTelegramUpdate(
      themeCallback('default'),
      'https://example.com',
    );

    expect(result.completionCommitted).toBe(false);
    expect((await getUser('owner'))?.theme).toBe('default');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/answerCallbackQuery');
    expect(deliveryBody(0)).toEqual({
      callback_query_id: 'callback-1',
      text: 'Already using default.',
    });
  });

  it('preserves a selected theme when Telegram cannot edit the prior selector', async () => {
    await seedLinkedUser();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    const result = await processTelegramUpdate(
      themeCallback('ocean'),
      'https://example.com',
    );

    expect(result.completionCommitted).toBe(false);
    expect((await getUser('owner'))?.theme).toBe('ocean');
    expect(fetchMock.mock.calls[0][0]).toContain('/editMessageCaption');
    expect(deliveryBody(1)).toMatchObject({
      chat_id: '42',
      text: expect.stringContaining('Current: <b>ocean</b>'),
      reply_markup: expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ text: '✓ ocean' })]),
        ]),
      }),
    });
    expect(fetchMock.mock.calls[2][0]).toContain('/answerCallbackQuery');
  });

  it('rejects a callback from an unlinked Telegram user without changing the theme', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    await processTelegramUpdate(themeCallback('ocean', 9), 'https://example.com');

    expect((await getUser('owner'))?.theme).toBe('default');
    expect(deliveryBody(0)).toEqual({
      callback_query_id: 'callback-1',
      text: 'Link Telegram in the dashboard first.',
    });
  });

  it('acknowledges malformed callbacks with an id', async () => {
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(
      { callback_query: { id: 'callback-2', data: 'unexpected' } },
      'https://example.com',
    );

    expect(deliveryBody(0)).toEqual({
      callback_query_id: 'callback-2',
      text: 'This selection is not available.',
    });
  });

  it('acknowledges callback failures before preserving the webhook retry error', async () => {
    await seedLinkedUser();
    vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('storage unavailable'));
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await expect(
      processTelegramUpdate(themeCallback('ocean'), 'https://example.com'),
    ).rejects.toThrow('storage unavailable');

    expect(deliveryBody(0)).toEqual({
      callback_query_id: 'callback-1',
      text: 'Could not update the theme. Please try again.',
    });
  });

  it('does not allow the retired minimal theme through Telegram commands or custom themes', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    await processTelegramUpdate(telegramUpdate('/theme minimal'), 'https://example.com');
    await processTelegramUpdate(
      telegramUpdate('/theme custom add minimal #111111 #222222 #333333 #444444 #555555'),
      'https://example.com',
    );

    expect(deliveryBody(0).text).toContain('Theme not found');
    expect(deliveryBody(1).text).toContain('Name reserved');
    expect((await getUser('owner'))?.customThemes).toEqual([]);
  });

  it('sends status as HTML with one wallpaper button and no raw URL in the text', async () => {
    await seedLinkedUser({
      wallpaperKey: 'wallpaper-key',
      events: [manualEvent('launch', 'Launch')],
      cachedCalEvents: [googleEvent('one'), googleEvent('two')],
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/status'), 'https://example.com');

    const body = deliveryBody(0);
    const wallpaperUrl = 'https://example.com/api/wallpaper?wallpaperKey=wallpaper-key';

    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('<b>Wallpaper status</b>');
    expect(body.text).toContain('Range: <b>quarter</b>');
    expect(body.text).toContain('Layout: <b>calendar</b>');
    expect(body.text).toContain('Lock-screen fit: <b>standard</b>');
    expect(body.text).toContain('Events: <b>1 manual</b> · <b>2 Google cached</b>');
    expect(body.text).not.toContain(wallpaperUrl);
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Open wallpaper', url: wallpaperUrl }]],
    });
  });

  it('keeps the URL command plain and directly copyable', async () => {
    await seedLinkedUser({ wallpaperKey: 'wallpaper-key' });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/url'), 'https://example.com');

    expect(deliveryBody(0)).toEqual({
      chat_id: '42',
      text: 'Wallpaper URL\nhttps://example.com/api/wallpaper?wallpaperKey=wallpaper-key',
      disable_web_page_preview: true,
    });
  });

  it('escapes event names before sending HTML replies', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(
      telegramUpdate(`/add 2026-11-01 <b>A&B</b> "Q" 'R'`),
      'https://example.com',
    );
    await processTelegramUpdate(telegramUpdate('/events'), 'https://example.com');

    const addBody = deliveryBody(0);
    const listBody = deliveryBody(1);
    const escapedName = '&lt;b&gt;A&amp;B&lt;/b&gt; &quot;Q&quot; &#39;R&#39;';

    expect(addBody.parse_mode).toBe('HTML');
    expect(addBody.text).toContain(escapedName);
    expect(listBody.parse_mode).toBe('HTML');
    expect(listBody.text).toContain(escapedName);
    expect(listBody.text).not.toContain('<b>A&B</b>');
  });

  it('uses calm, consistent copy for empty, usage, and unknown responses', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/events'), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('/add tomorrow'), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('/something'), 'https://example.com');

    expect(deliveryBody(0).text).toBe(
      '<b>No manual events</b>\nAdd one with <code>/add YYYY-MM-DD Event name</code>.',
    );
    expect(deliveryBody(1).text).toBe(
      '<b>Add an event</b>\n<code>/add YYYY-MM-DD Event name</code>',
    );
    expect(deliveryBody(2).text).toBe(
      '<b>Command not recognised</b>\nUse <code>/help</code> to see available commands.',
    );
  });

  it('uses the same recovery message when Telegram is not linked', async () => {
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/status'), 'https://example.com');

    expect(deliveryBody(0)).toMatchObject({
      text: '<b>Telegram isn’t linked</b>\nOpen the web dashboard and link Telegram to continue.',
      parse_mode: 'HTML',
    });
  });

  it('maps expected command errors without exposing internal error text', async () => {
    await seedLinkedUser({
      events: Array.from({ length: 7 }, (_, index) =>
        manualEvent(`event-${index}`, `Event ${index + 1}`),
      ),
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(
      telegramUpdate('/add 2026-11-01 Eighth event'),
      'https://example.com',
    );

    expect(deliveryBody(0).text).toBe(
      '<b>Event limit reached</b>\nKeep up to 7 tracked events. Delete one before adding another.',
    );
    expect(deliveryBody(0).text).not.toContain('Maximum 7 tracked events allowed');
  });

  it('updates presets and independent wallpaper dimensions', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    await processTelegramUpdate(telegramUpdate('/eventcount 5'), 'https://example.com');

    await processTelegramUpdate(telegramUpdate('/view hybrid'), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('/range year'), 'https://example.com');
    await processTelegramUpdate(
      telegramUpdate('/layout progress'),
      'https://example.com',
    );
    await processTelegramUpdate(
      telegramUpdate('/profile large-clock'),
      'https://example.com',
    );

    expect(await getUser('owner')).toMatchObject({
      timeRange: 'year',
      presentation: 'progress',
      lockScreenProfile: 'large-clock',
      eventCount: 5,
    });
    expect(deliveryBody(0).text).toContain('Event count updated');
    expect(deliveryBody(1).text).toContain('Preset updated');
    expect(deliveryBody(4).text).toContain('Preview it on your phone');
  });

  it.each(['', '0', '6', '-1', '2.5', '3junk', '3 4', '03'])(
    'rejects invalid event counts (%s) without mutating settings',
    async (argument) => {
      await seedLinkedUser();
      const { processTelegramUpdate } = await import('../lib/telegramBot');
      const { getUser } = await import('../lib/tokenManager');
      const before = await getUser('owner');

      await processTelegramUpdate(
        telegramUpdate(`/eventcount ${argument}`),
        'https://example.com',
      );

      expect(deliveryBody(0).text).toContain('/eventcount 1|2|3|4|5');
      expect(await getUser('owner')).toEqual(before);
    },
  );

  it('keeps a completed custom theme deletion idempotent on replay', async () => {
    await seedLinkedUser({
      customThemes: [
        {
          id: 'midnight',
          background: '#111111',
          passed: '#222222',
          weekend: '#333333',
          current: '#444444',
          future: '#555555',
          text: '#E5E5E5',
          subtext: '#A1A1A1',
        },
      ],
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const completion = {
      key: 'telegram:update:done:theme-delete',
      ttlSeconds: 86_400,
    };

    const first = await processTelegramUpdate(
      telegramUpdate('/theme custom delete midnight'),
      'https://example.com',
      completion,
    );
    const replay = await processTelegramUpdate(
      telegramUpdate('/theme custom delete midnight'),
      'https://example.com',
      completion,
    );

    expect(first.completionCommitted).toBe(true);
    expect(replay.completionCommitted).toBe(true);
    expect(deliveryBody(1).text).toBe(deliveryBody(0).text);
    expect(deliveryBody(1).text).toContain('✓ <b>Custom theme deleted</b>');
  });

  it('still throws unexpected command errors', async () => {
    vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('storage unavailable'));
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await expect(
      processTelegramUpdate(telegramUpdate('/status'), 'https://example.com'),
    ).rejects.toThrow('storage unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function seedLinkedUser(overrides: Partial<UserData> = {}): Promise<void> {
  await redis.set('user:owner', {
    ...userRecord(),
    ...overrides,
  });
  await redis.set('telegram:user:42', 'owner');
}

function userRecord(): UserData {
  return {
    schemaVersion: 3,
    token: 'owner',
    name: 'Ada',
    theme: 'default',
    timeRange: 'quarter',
    presentation: 'calendar',
    lockScreenProfile: 'standard',
    timeZone: 'UTC',
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
  };
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

function googleEvent(id: string) {
  return {
    id,
    name: `Google ${id}`,
    date: '2026-11-02',
    accountEmail: 'ada@example.com',
  };
}

function telegramUpdate(text: string) {
  return {
    message: {
      text,
      chat: { id: 42, type: 'private' },
      from: { id: 42, username: 'ada' },
    },
  };
}

function themeCallback(themeId: string, userId = 42) {
  return {
    callback_query: {
      id: 'callback-1',
      data: `theme:${themeId}`,
      from: { id: userId },
      message: { message_id: 77, chat: { id: 42, type: 'private' } },
    },
  };
}

function deliveryBody(callIndex: number): Record<string, any> {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;

  return JSON.parse(String(init.body)) as Record<string, any>;
}
