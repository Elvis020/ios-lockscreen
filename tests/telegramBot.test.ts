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

  it('provisions Telegram-first setup once and reopens the same account', async () => {
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/start'), 'https://example.com');

    const token = await redis.get<string>('telegram:user:42');
    const user = token ? await redis.get<UserData>(`user:${token}`) : null;

    expect(token).toBeTruthy();
    expect(user).toMatchObject({
      name: 'ada',
      theme: 'default',
      timeRange: 'month',
      presentation: 'hybrid',
      telegram: { userId: '42', chatId: '42', username: 'ada' },
    });
    expect(await redis.get(`wallpaper:${user?.wallpaperKey}`)).toBe(token);
    expect(deliveryBody(0)).toMatchObject({
      text: expect.stringContaining('Your wallpaper is ready to shape'),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Open Calendar Lockscreen',
              web_app: { url: 'https://example.com/api/telegram/app' },
            },
          ],
        ],
      },
    });

    fetchMock.mockClear();
    await processTelegramUpdate(telegramUpdate('/start setup'), 'https://example.com');

    expect(await redis.get('telegram:user:42')).toBe(token);
    expect(deliveryBody(0).text).toContain('Welcome back');
  });

  it('opens the visual control panel from the app command', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/app'), 'https://example.com');

    expect(deliveryBody(0).reply_markup.inline_keyboard[0][0]).toEqual({
      text: 'Open Calendar Lockscreen',
      web_app: { url: 'https://example.com/api/telegram/app' },
    });
  });

  it('explains how to connect Google instead of reporting zero cached events', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    const result = await processTelegramUpdate(
      telegramUpdate('/sync'),
      'https://example.com',
      { key: 'telegram:update:done:123', ttlSeconds: 86_400 },
    );

    expect(deliveryBody(0)).toMatchObject({
      text: expect.stringContaining('Google Calendar is not connected'),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Connect Google Calendar',
              web_app: { url: 'https://example.com/api/telegram/app' },
            },
          ],
        ],
      },
    });
    expect(deliveryBody(0).text).not.toContain('0 cached events');
    expect(result.completionCommitted).toBe(false);
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
    expect(form.get('caption')).toContain('Current: <b>Ocean</b>');
    expect(form.get('caption')).not.toContain('wallpaper-key');
    expect(form.get('photo')).toBeInstanceOf(Blob);
    const buttons = JSON.parse(String(form.get('reply_markup'))).inline_keyboard.flat();

    expect(buttons).toEqual([
      { text: 'Default', callback_data: 'theme:default' },
      { text: '✓ Ocean', callback_data: 'theme:ocean' },
      { text: 'Sunset', callback_data: 'theme:sunset' },
      { text: 'Forest', callback_data: 'theme:forest' },
      { text: 'Midnight', callback_data: 'theme:midnight' },
      { text: 'Frost', callback_data: 'theme:frost' },
      { text: 'Espresso', callback_data: 'theme:espresso' },
      { text: 'Rosewood', callback_data: 'theme:rosewood' },
      { text: 'Custom themes (0)', callback_data: 'theme-page:custom' },
    ]);
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

  it('opens custom themes as a separate visual page without hiding them', async () => {
    await seedLinkedUser({
      customThemes: [
        {
          ...themeRecord('starlight'),
          background: '#101522',
        },
      ],
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(themePageCallback('custom'), 'https://example.com');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = init.body as FormData;
    const buttons = JSON.parse(String(form.get('reply_markup'))).inline_keyboard.flat();

    expect(url).toContain('/sendPhoto');
    expect(form.get('caption')).toContain('<b>Custom themes</b>');
    expect(buttons).toEqual([
      { text: 'Starlight', callback_data: 'theme:starlight' },
      { text: 'Back to built-ins', callback_data: 'theme-page:builtins' },
    ]);
    expect(fetchMock.mock.calls[1][0]).toContain('/answerCallbackQuery');
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
    expect(deliveryBody(0)).toMatchObject({
      chat_id: '42',
      message_id: 77,
      caption: expect.stringContaining('Current: <b>Ocean</b>'),
      parse_mode: 'HTML',
    });
    expect(deliveryBody(0).reply_markup.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        { text: '✓ Ocean', callback_data: 'theme:ocean' },
        { text: 'Midnight', callback_data: 'theme:midnight' },
        { text: 'Rosewood', callback_data: 'theme:rosewood' },
      ]),
    );
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
      text: expect.stringContaining('Current: <b>Ocean</b>'),
      reply_markup: expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ text: '✓ Ocean' })]),
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

  it('reports the effective automatic profile rather than stale base settings', async () => {
    const slot = {
      enabled: true,
      theme: 'ocean',
      timeRange: 'year' as const,
      presentation: 'countdown' as const,
      lockScreenProfile: 'large-clock' as const,
      eventCount: 5,
      livingOverlay: 'stars' as const,
      milestoneRingStyle: 'halo' as const,
    };

    await seedLinkedUser({
      automaticProfiles: {
        enabled: true,
        day: slot,
        evening: slot,
        night: slot,
      },
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/status'), 'https://example.com');

    expect(deliveryBody(0).text).toContain('Range: <b>year</b>');
    expect(deliveryBody(0).text).toContain('Layout: <b>countdown</b>');
    expect(deliveryBody(0).text).toContain('Theme now: <b>ocean</b>');
    expect(deliveryBody(0).text).toContain('Living: <b>stars</b>');
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
    const saveCallback = deliveryBody(0).reply_markup.inline_keyboard[0][0].callback_data;

    await processTelegramUpdate(eventCallback(saveCallback), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('/events'), 'https://example.com');

    const addBody = deliveryBody(0);
    const listBody = deliveryBody(3);
    const escapedName = '&lt;b&gt;A&amp;B&lt;/b&gt; &quot;Q&quot; &#39;R&#39;';

    expect(addBody.parse_mode).toBe('HTML');
    expect(addBody.text).toContain(escapedName);
    expect(listBody.parse_mode).toBe('HTML');
    expect(listBody.text).toContain(escapedName);
    expect(listBody.text).not.toContain('<b>A&B</b>');
  });

  it('guides event names through quick dates and an in-Telegram calendar', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    await processTelegramUpdate(telegramUpdate('/add'), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('Dentist'), 'https://example.com');

    const dateChoice = deliveryBody(1);
    const buttons = dateChoice.reply_markup.inline_keyboard.flat();
    const today = buttons.find(({ text }: { text: string }) => text === 'Today');
    const calendar = buttons.find(({ text }: { text: string }) => text === 'Choose date');

    expect(deliveryBody(0).text).toContain('What should we call it?');
    expect(dateChoice.text).toContain('When is Dentist?');
    expect(calendar.web_app.url).toMatch(
      /^https:\/\/example\.com\/api\/telegram\/calendar\?draft=/,
    );
    expect(today.callback_data.length).toBeLessThanOrEqual(64);
    expect(calendar.web_app.url).not.toContain('owner');

    await processTelegramUpdate(
      eventCallback(today.callback_data),
      'https://example.com',
    );

    expect(deliveryBody(2).text).toContain('<b>Save this event?</b>');
    expect(deliveryBody(2).text).toMatch(/Date: <b>.+ \d{4}<\/b>/);
    expect((await getUser('owner'))?.events).toEqual([]);
  });

  it('edits a snapshot-selected event safely after the event list is reordered', async () => {
    const first = manualEvent('first', 'First');
    const second = { ...manualEvent('second', 'Second'), date: '2026-12-02' };

    await seedLinkedUser({ events: [first, second] });
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');

    await processTelegramUpdate(telegramUpdate('/edit'), 'https://example.com');
    const select = deliveryBody(0).reply_markup.inline_keyboard[1][0].callback_data;

    expect(select).toMatch(/^ee:[A-Za-z0-9_-]{12,32}:1$/);
    expect(select).not.toContain('second');
    expect(select.length).toBeLessThanOrEqual(64);

    await redis.set('user:owner', { ...userRecord(), events: [second, first] });
    await processTelegramUpdate(eventCallback(select), 'https://example.com');

    const review = deliveryBody(1);
    const changeName = review.reply_markup.inline_keyboard[0][1].callback_data;

    await processTelegramUpdate(
      eventCallback(changeName, 'edit-name'),
      'https://example.com',
    );
    await processTelegramUpdate(telegramUpdate('Renamed'), 'https://example.com');

    const save = deliveryBody(5).reply_markup.inline_keyboard[0][0].callback_data;

    await processTelegramUpdate(eventCallback(save, 'edit-save'), 'https://example.com');

    expect((await getUser('owner'))?.events).toEqual([
      { ...second, name: 'Renamed' },
      first,
    ]);
    expect(deliveryBody(6).text).toContain('Event updated');
  });

  it('explains empty and invalid numbered edit commands without opening a draft', async () => {
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getTelegramDraft } = await import('../lib/telegramDrafts');

    await seedLinkedUser();
    await processTelegramUpdate(telegramUpdate('/edit'), 'https://example.com');

    expect(deliveryBody(0).text).toContain('No manual events');

    await seedLinkedUser({ events: [manualEvent('first', 'First')] });

    for (const command of ['/edit 0', '/edit 2', '/edit one', '/edit 1 extra']) {
      await processTelegramUpdate(telegramUpdate(command), 'https://example.com');
    }

    expect(await getTelegramDraft('42')).toBeNull();
    expect(
      fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init.body)).text),
    ).toEqual(
      Array(4).fill(
        '<b>Choose an event to edit</b>\nUse <code>/edit</code>, or <code>/edit NUMBER</code> from <code>/events</code>.',
      ),
    );
  });

  it('reviews a numbered edit, discards it without changing the event, and permits an edit at the event limit', async () => {
    const events = Array.from({ length: 7 }, (_, index) =>
      manualEvent(`event-${index}`, `Event ${index + 1}`),
    );

    await seedLinkedUser({ events });
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getUser } = await import('../lib/tokenManager');
    const before = structuredClone((await getUser('owner'))!.events);

    await processTelegramUpdate(telegramUpdate('/edit 1'), 'https://example.com');
    const review = deliveryBody(0);
    const cancel = review.reply_markup.inline_keyboard[2][0].callback_data;

    expect(review.text).toContain('Review changes');
    expect(
      review.reply_markup.inline_keyboard
        .flat()
        .map(({ callback_data }: any) => callback_data.length),
    ).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(
      review.reply_markup.inline_keyboard
        .flat()
        .every(({ callback_data }: any) => callback_data.length <= 64),
    ).toBe(true);

    await processTelegramUpdate(eventCallback(cancel, 'discard'), 'https://example.com');

    expect((await getUser('owner'))?.events).toEqual(before);
    expect(deliveryBody(1).text).toContain('Changes discarded');
    expect(deliveryBody(1).text).toContain('unchanged');

    await processTelegramUpdate(telegramUpdate('/edit 1'), 'https://example.com');
    const save = deliveryBody(3).reply_markup.inline_keyboard[0][0].callback_data;

    await processTelegramUpdate(
      eventCallback(save, 'save-at-limit'),
      'https://example.com',
    );

    expect((await getUser('owner'))?.events).toHaveLength(7);
    expect(deliveryBody(4).text).toContain('Event updated');
  });

  it('rejects malformed, stale, and unauthorized edit callbacks without creating a draft', async () => {
    await seedLinkedUser({ events: [manualEvent('first', 'First')] });
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getTelegramDraft } = await import('../lib/telegramDrafts');

    await processTelegramUpdate(telegramUpdate('/edit'), 'https://example.com');
    const firstMenu = deliveryBody(0).reply_markup.inline_keyboard[0][0].callback_data;

    await processTelegramUpdate(telegramUpdate('/edit'), 'https://example.com');
    const currentMenu = deliveryBody(1).reply_markup.inline_keyboard[0][0].callback_data;

    for (const data of [
      `${currentMenu}:extra`,
      currentMenu.replace(/:0$/, ':6'),
      'ee:abcdefghijklmnop:0:extra',
      'ev:abcdefghijklmnop:abcdefghijk:unknown',
      firstMenu,
    ]) {
      await processTelegramUpdate(
        eventCallback(data, `invalid-${data.length}`),
        'https://example.com',
      );
    }

    await processTelegramUpdate(
      callbackWithIdentity(currentMenu, 99, 42, 'private'),
      'https://example.com',
    );
    await processTelegramUpdate(
      callbackWithIdentity(currentMenu, 42, 99, 'private'),
      'https://example.com',
    );
    await processTelegramUpdate(
      callbackWithIdentity(currentMenu, 42, 42, 'group'),
      'https://example.com',
    );

    expect(await getTelegramDraft('42')).toBeNull();

    await processTelegramUpdate(
      eventCallback(currentMenu, 'selected-menu'),
      'https://example.com',
    );
    const selected = await getTelegramDraft('42');

    await processTelegramUpdate(
      eventCallback(currentMenu, 'replayed-menu'),
      'https://example.com',
    );

    expect(selected).toMatchObject({ operation: 'edit', original: { id: 'first' } });
    expect(await getTelegramDraft('42')).toEqual(selected);
  });

  it('gates edit actions by draft step, including quick-date buttons', async () => {
    await seedLinkedUser({ events: [manualEvent('first', 'First')] });
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const { getTelegramDraft } = await import('../lib/telegramDrafts');
    const { getUser } = await import('../lib/tokenManager');

    await processTelegramUpdate(telegramUpdate('/edit 1'), 'https://example.com');
    let draft = (await getTelegramDraft('42'))!;
    const name = `ev:${draft.id}:${draft.revision}:name`;

    await processTelegramUpdate(
      eventCallback(name, 'change-name'),
      'https://example.com',
    );
    draft = (await getTelegramDraft('42'))!;
    await processTelegramUpdate(
      eventCallback(`ev:${draft.id}:${draft.revision}:save`, 'save-during-name'),
      'https://example.com',
    );
    await processTelegramUpdate(
      eventCallback(`ev:${draft.id}:${draft.revision}:today`, 'today-during-name'),
      'https://example.com',
    );

    expect((await getUser('owner'))?.events[0].name).toBe('First');
    expect(await getTelegramDraft('42')).toMatchObject({
      step: 'name',
      date: '2026-11-01',
    });

    await processTelegramUpdate(telegramUpdate('Renamed'), 'https://example.com');
    draft = (await getTelegramDraft('42'))!;
    await processTelegramUpdate(
      eventCallback(`ev:${draft.id}:${draft.revision}:date`),
      'https://example.com',
    );
    draft = (await getTelegramDraft('42'))!;
    await processTelegramUpdate(
      eventCallback(`ev:${draft.id}:${draft.revision}:save`, 'save-during-date'),
      'https://example.com',
    );

    expect((await getUser('owner'))?.events[0].name).toBe('First');
    expect(await getTelegramDraft('42')).toMatchObject({ step: 'date' });
    expect((await getTelegramDraft('42'))?.date).toBeUndefined();
  });

  it('does not mark a cancellation complete when its revision changes before the locked read', async () => {
    await seedLinkedUser({ events: [manualEvent('first', 'First')] });
    const { createTelegramDraft, getTelegramDraft } =
      await import('../lib/telegramDrafts');
    const { processTelegramUpdate } = await import('../lib/telegramBot');
    const draft = await createTelegramDraft({
      token: 'owner',
      userId: '42',
      chatId: '42',
      name: 'First',
      date: '2026-11-01',
      operation: 'edit',
      step: 'review',
      original: manualEvent('first', 'First'),
    });
    const originalGet = redis.get.bind(redis);
    let draftReads = 0;

    vi.spyOn(redis, 'get').mockImplementation(async (key) => {
      if (key === 'telegram:draft:42') {
        draftReads += 1;

        if (draftReads === 2) {
          const current = await originalGet<Record<string, unknown>>(key);

          redis.store.set(key, { ...current, revision: 'changed-revision' });
        }
      }

      return originalGet(key);
    });

    const completion = { key: 'telegram:update:done:cancel-race', ttlSeconds: 86_400 };
    const result = await processTelegramUpdate(
      eventCallback(`ev:${draft.id}:${draft.revision}:cancel`, 'cancel-race'),
      'https://example.com',
      completion,
    );

    expect(result.completionCommitted).toBe(false);
    expect(await redis.get(completion.key)).toBeNull();
    expect(await getTelegramDraft('42')).toMatchObject({ revision: 'changed-revision' });
  });

  it('uses calm, consistent copy for empty, usage, and unknown responses', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/events'), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('/add tomorrow'), 'https://example.com');
    await processTelegramUpdate(telegramUpdate('/something'), 'https://example.com');

    expect(deliveryBody(0).text).toBe(
      '<b>No manual events</b>\nAdd one with <code>/add Event name</code>.',
    );
    expect(deliveryBody(1).text).toContain('<b>Try a name and date</b>');
    expect(deliveryBody(2).text).toBe(
      '<b>Command not recognised</b>\nUse <code>/help</code> to see available commands.',
    );
  });

  it('uses the same recovery message when Telegram is not linked', async () => {
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/status'), 'https://example.com');

    expect(deliveryBody(0)).toMatchObject({
      text: '<b>Telegram isn’t linked</b>\nSend <code>/start</code> to create or reconnect your wallpaper.',
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
    const saveCallback = deliveryBody(0).reply_markup.inline_keyboard[0][0].callback_data;

    await processTelegramUpdate(eventCallback(saveCallback), 'https://example.com');

    expect(deliveryBody(1).text).toBe(
      '<b>Event limit reached</b>\nKeep up to 7 tracked events. Delete one before adding another.',
    );
    expect(deliveryBody(1).text).not.toContain('Maximum 7 tracked events allowed');
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
          id: 'moody',
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
      telegramUpdate('/theme custom delete moody'),
      'https://example.com',
      completion,
    );
    const replay = await processTelegramUpdate(
      telegramUpdate('/theme custom delete moody'),
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

  it('opens Theme Studio as a one-tap mood picker', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/studio'), 'https://example.com');

    expect(deliveryBody(0)).toMatchObject({
      chat_id: '42',
      text: expect.stringContaining('<b>Theme Studio</b>'),
    });
    expect(deliveryBody(0).reply_markup.inline_keyboard.flat()).toEqual([
      { text: 'Calm', callback_data: 'studio-mood:calm' },
      { text: 'Warm', callback_data: 'studio-mood:warm' },
      { text: 'Focus', callback_data: 'studio-mood:focus' },
      { text: 'Night', callback_data: 'studio-mood:night' },
      { text: 'Fresh', callback_data: 'studio-mood:fresh' },
    ]);
  });

  it('previews and saves a mood with its matching living effect', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(
      callbackWithIdentity('studio-mood:fresh', 42, 42, 'private'),
      'https://example.com',
    );

    const draft = await redis.get<{
      id: string;
      revision: string;
      livingOverlay: string;
      theme: { id: string };
    }>('telegram:studio:42');

    expect(draft).toMatchObject({ livingOverlay: 'rain', theme: { id: 'fresh' } });
    expect(fetchMock.mock.calls[0][0]).toContain('/sendPhoto');
    expect(fetchMock.mock.calls[1][0]).toContain('/answerCallbackQuery');

    fetchMock.mockClear();
    await processTelegramUpdate(
      callbackWithIdentity(
        `studio:${draft!.id}:${draft!.revision}:save`,
        42,
        42,
        'private',
      ),
      'https://example.com',
    );

    const user = await redis.get<UserData>('user:owner');

    expect(user).toMatchObject({ theme: 'fresh', livingOverlay: 'rain' });
    expect(user?.customThemes).toEqual([
      expect.objectContaining({ id: 'fresh', background: '#203A36' }),
    ]);
    expect(await redis.get('telegram:studio:42')).toBeNull();
  });

  it('preserves the winning Studio action when save and cancel callbacks race', async () => {
    await seedLinkedUser();
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/studio night'), 'https://example.com');
    const draft = await redis.get<{ id: string; revision: string }>('telegram:studio:42');
    const prefix = `studio:${draft!.id}:${draft!.revision}:`;

    fetchMock.mockClear();
    await processTelegramUpdate(
      callbackWithIdentity(`${prefix}cancel`, 42, 42, 'private'),
      'https://example.com',
    );

    fetchMock.mockClear();
    await processTelegramUpdate(
      callbackWithIdentity(`${prefix}save`, 42, 42, 'private'),
      'https://example.com',
    );

    expect((await redis.get<UserData>('user:owner'))?.theme).toBe('default');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deliveryBody(0)).toMatchObject({ text: 'Already cancelled.' });
  });

  it('uses one canonical Google reference order across event lists and sharing', async () => {
    await seedLinkedUser({
      selectedEventIds: ['first', 'second'],
      cachedCalEvents: [googleEvent('second'), googleEvent('first')],
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/events'), 'https://example.com');

    expect(deliveryBody(0).text).toContain('G1. <b>2026-11-02</b> · Google first');
    expect(deliveryBody(0).text).toContain('G2. <b>2026-11-02</b> · Google second');

    fetchMock.mockClear();
    await processTelegramUpdate(telegramUpdate('/share G1'), 'https://example.com');

    const user = await redis.get<UserData>('user:owner');

    expect(user?.sharedCountdowns?.[0]).toMatchObject({ eventId: 'first' });
  });

  it('refuses to create a share link that would already be expired', async () => {
    await seedLinkedUser({
      events: [{ ...manualEvent('past', 'Past event'), date: '2000-01-01' }],
    });
    const { processTelegramUpdate } = await import('../lib/telegramBot');

    await processTelegramUpdate(telegramUpdate('/share M1'), 'https://example.com');

    expect(deliveryBody(0).text).toContain('<b>Countdown already passed</b>');
    expect((await redis.get<UserData>('user:owner'))?.sharedCountdowns).toBeUndefined();
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
    schemaVersion: 5,
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
    category: 'general' as const,
    recurrence: 'none' as const,
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

function themePageCallback(page: 'custom' | 'builtins') {
  return {
    callback_query: {
      id: 'callback-page',
      data: `theme-page:${page}`,
      from: { id: 42 },
      message: { message_id: 77, chat: { id: 42, type: 'private' } },
    },
  };
}

function eventCallback(data: string, callbackId = 'event-callback') {
  return {
    callback_query: {
      id: callbackId,
      data,
      from: { id: 42 },
      message: { message_id: 88, chat: { id: 42, type: 'private' } },
    },
  };
}

function callbackWithIdentity(
  data: string,
  fromId: number,
  chatId: number,
  chatType: 'private' | 'group',
) {
  return {
    callback_query: {
      id: `callback-${fromId}-${chatId}-${chatType}`,
      data,
      from: { id: fromId },
      message: { message_id: 88, chat: { id: chatId, type: chatType } },
    },
  };
}

function themeRecord(id: string) {
  return {
    id,
    background: '#111111',
    passed: '#222222',
    weekend: '#333333',
    current: '#444444',
    future: '#555555',
    text: '#E5E5E5',
    subtext: '#A1A1A1',
  };
}

function deliveryBody(callIndex: number): Record<string, any> {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;

  return JSON.parse(String(init.body)) as Record<string, any>;
}
