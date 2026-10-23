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
    expect(help).toContain('/view week|month|quarter');
    expect(help).toContain('/timezone Area/City');
    expect(help).toContain('/theme custom add');
    expect(help).toContain('/sync');
  });

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
    schemaVersion: 2,
    token: 'owner',
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

function deliveryBody(callIndex: number): Record<string, any> {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;

  return JSON.parse(String(init.body)) as Record<string, any>;
}
