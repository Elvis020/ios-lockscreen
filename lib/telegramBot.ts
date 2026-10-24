import { syncGoogleEvents } from './calendar/service';
import {
  isEventCount,
  isLockScreenProfile,
  isPresentation,
  isTimeRange,
  isWallpaperPreset,
  isReservedThemeId,
  listAvailableThemeIds,
  resolveTheme,
  PRESENTATIONS,
  WALLPAPER_PRESET_IDS,
  WALLPAPER_PRESETS,
} from './preferences';
import { createThemePreviewImageResponse } from './themePreviewRenderer';
import { getRedis } from './redis';
import { deleteRedisKeyIfValue } from './redisLock';
import {
  addCustomTheme,
  addManualEvent,
  deleteCustomTheme,
  deleteManualEventAtIndex,
  ensureWallpaperKey,
  getUser,
  linkTelegramIdentity,
  updatePreferences,
  type MutationCompletion,
} from './tokenManager';
import {
  createCustomTheme,
  isValidDateString,
  isValidTimeZone,
  normalizeEventName,
} from './validation';

const WALLPAPER_REFRESH_NOTE = 'Changes appear on the next iOS wallpaper refresh.';

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; username?: string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number; username?: string };
    message?: { message_id?: number; chat?: { id?: number; type?: string } };
  };
}

export interface TelegramProcessingResult {
  completionCommitted: boolean;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
}

export interface TelegramReply {
  text: string;
  parseMode?: 'HTML';
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramMessageOptions {
  parseMode?: 'HTML';
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

interface LinkedCommandResult extends TelegramProcessingResult {
  reply: TelegramReply;
  themeSelector?: { themes: import('./preferences').WallpaperTheme[] };
}

export async function processTelegramUpdate(
  update: TelegramUpdate,
  origin: string,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  if (update.callback_query) {
    return processThemeCallback(update.callback_query, completion);
  }

  const chatIdValue = update.message?.chat?.id;
  const userIdValue = update.message?.from?.id;
  const text = update.message?.text?.trim();

  if (
    update.message?.chat?.type !== 'private' ||
    chatIdValue === undefined ||
    userIdValue === undefined ||
    !text
  ) {
    return { completionCommitted: false };
  }

  const chatId = String(chatIdValue);
  const userId = String(userIdValue);
  const [commandWithBot, ...args] = text.split(/\s+/);
  const command = commandWithBot.toLowerCase().split('@')[0];

  try {
    if (command === '/start') {
      await linkChat(userId, chatId, args[0], update.message?.from?.username, completion);
      await sendTelegramReply(
        chatId,
        htmlReply(
          [
            '✓ <b>Telegram linked</b>',
            'Use <code>/help</code> to manage your wallpaper.',
            WALLPAPER_REFRESH_NOTE,
          ].join('\n'),
        ),
      );

      return { completionCommitted: Boolean(completion) };
    }

    const redis = getRedis();
    let token = await redis.get<string>(`telegram:user:${userId}`);

    if (!token) {
      token = await migrateLegacyPrivateLink(userId, chatId);
    }

    if (!token) {
      await sendTelegramReply(chatId, unlinkedReply());

      return { completionCommitted: false };
    }

    const user = await getUser(token);

    if (!user || user.telegram?.userId !== userId) {
      await deleteRedisKeyIfValue(redis, `telegram:user:${userId}`, token);
      await sendTelegramReply(chatId, unlinkedReply());

      return { completionCommitted: false };
    }

    const result = await runLinkedTelegramCommand(
      token,
      command,
      args,
      origin,
      completion,
    );

    if (result.themeSelector) {
      await sendTelegramThemeSelector(chatId, result.reply, result.themeSelector);
    } else {
      await sendTelegramReply(chatId, result.reply);
    }

    return { completionCommitted: result.completionCommitted };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reply = expectedCommandErrorReply(message);

    if (reply) {
      await sendTelegramReply(chatId, reply);

      return { completionCommitted: false };
    }

    throw error;
  }
}

async function processThemeCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  const chatId = callback.message?.chat?.id;
  const userId = callback.from?.id;
  const callbackId = callback.id;
  const themeId = callback.data?.startsWith('theme:')
    ? callback.data.slice('theme:'.length)
    : undefined;

  let acknowledgement = 'This selection is not available.';

  try {
    if (
      callback.message?.chat?.type !== 'private' ||
      chatId === undefined ||
      userId === undefined ||
      !themeId
    ) {
      return { completionCommitted: false };
    }

    const chat = String(chatId);
    const telegramUserId = String(userId);
    const redis = getRedis();
    const token = await redis.get<string>(`telegram:user:${telegramUserId}`);

    if (!token) {
      acknowledgement = 'Link Telegram in the dashboard first.';

      return { completionCommitted: false };
    }

    const user = await getUser(token);

    if (
      !user ||
      user.telegram?.userId !== telegramUserId ||
      user.telegram.chatId !== chat ||
      !listAvailableThemeIds(user.customThemes).includes(themeId)
    ) {
      return { completionCommitted: false };
    }

    if (themeId === user.theme) {
      acknowledgement = `Already using ${themeId}.`;

      return { completionCommitted: false };
    }

    const updatedUser = await updatePreferences(token, { theme: themeId }, completion);

    if (!updatedUser) {
      throw new Error('Linked account no longer exists');
    }

    if (typeof callback.message?.message_id === 'number') {
      const selector = createThemeSelector(updatedUser);

      try {
        await editTelegramThemeSelector(
          chat,
          callback.message.message_id,
          selector.reply,
        );
      } catch (error) {
        console.error('Telegram theme selector edit failed:', error);
        await sendTelegramReply(chat, selector.reply);
      }
    }

    acknowledgement = `Theme set to ${themeId}.`;

    return { completionCommitted: Boolean(completion) };
  } catch (error) {
    acknowledgement = 'Could not update the theme. Please try again.';

    throw error;
  } finally {
    if (callbackId) {
      await answerTelegramCallback(callbackId, acknowledgement);
    }
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: TelegramMessageOptions = {},
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('Telegram bot is not configured');
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  if (options.replyMarkup) {
    payload.reply_markup = options.replyMarkup;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Telegram message delivery failed');
  }
}

async function sendTelegramReply(chatId: string, reply: TelegramReply): Promise<void> {
  try {
    await sendTelegramMessage(chatId, reply.text, {
      parseMode: reply.parseMode,
      replyMarkup: reply.replyMarkup,
    });
  } catch (error) {
    console.error('Telegram reply delivery failed:', error);
  }
}

async function sendTelegramThemeSelector(
  chatId: string,
  reply: TelegramReply,
  selector: NonNullable<LinkedCommandResult['themeSelector']>,
): Promise<void> {
  try {
    const image = createThemePreviewImageResponse(selector.themes);
    const form = new FormData();

    form.set('chat_id', chatId);
    form.set('photo', await image.blob(), 'theme-selector.png');
    form.set('caption', reply.text);
    form.set('parse_mode', reply.parseMode ?? 'HTML');
    form.set('reply_markup', JSON.stringify(reply.replyMarkup));

    const response = await telegramFetch('sendPhoto', { method: 'POST', body: form });

    if (!response.ok) {
      throw new Error('Telegram photo delivery failed');
    }
  } catch (error) {
    console.error('Telegram theme preview delivery failed:', error);
    await sendTelegramReply(chatId, reply);
  }
}

async function answerTelegramCallback(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  try {
    const response = await telegramFetch('answerCallbackQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });

    if (!response.ok) {
      throw new Error('Telegram callback acknowledgement failed');
    }
  } catch (error) {
    console.error('Telegram callback acknowledgement failed:', error);
  }
}

async function editTelegramThemeSelector(
  chatId: string,
  messageId: number,
  reply: TelegramReply,
): Promise<void> {
  const response = await telegramFetch('editMessageCaption', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      caption: reply.text,
      parse_mode: reply.parseMode,
      reply_markup: reply.replyMarkup,
    }),
  });

  if (!response.ok) {
    throw new Error('Telegram theme selector update failed');
  }
}

async function telegramFetch(path: string, init: RequestInit): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('Telegram bot is not configured');
  }

  return fetch(`https://api.telegram.org/bot${botToken}/${path}`, init);
}

async function linkChat(
  userId: string,
  chatId: string,
  code: string | undefined,
  username: string | undefined,
  completion?: MutationCompletion,
): Promise<void> {
  if (!code) {
    throw new Error('Link code is required');
  }

  const redis = getRedis();
  const linkCodeKey = `telegram:link:${code}`;
  const token = await redis.get<string>(linkCodeKey);

  if (!token) {
    throw new Error('Link code is invalid or expired');
  }

  const user = await linkTelegramIdentity(
    token,
    {
      userId,
      chatId,
      username,
      linkedAt: new Date().toISOString(),
    },
    completion,
    linkCodeKey,
  );

  if (!user) {
    throw new Error('Linked account no longer exists');
  }
}

async function migrateLegacyPrivateLink(
  userId: string,
  chatId: string,
): Promise<string | null> {
  const redis = getRedis();
  const token = await redis.get<string>(`telegram:chat:${chatId}`);

  if (!token) {
    return null;
  }

  const user = await getUser(token);

  if (!user?.telegram || user.telegram.chatId !== chatId || user.telegram.userId) {
    await deleteRedisKeyIfValue(redis, `telegram:chat:${chatId}`, token);

    return null;
  }

  await linkTelegramIdentity(token, {
    ...user.telegram,
    userId,
    chatId,
  });

  return token;
}

export async function handleLinkedTelegramCommand(
  token: string,
  command: string,
  args: string[],
  origin: string,
): Promise<string> {
  const result = await runLinkedTelegramCommand(token, command, args, origin);

  return result.reply.text;
}

async function runLinkedTelegramCommand(
  token: string,
  command: string,
  args: string[],
  origin: string,
  completion?: MutationCompletion,
): Promise<LinkedCommandResult> {
  if (command === '/help') {
    return { reply: htmlReply(helpText()), completionCommitted: false };
  }

  if (command === '/status' || command === '/url') {
    const result = await ensureWallpaperKey(token);

    if (!result) {
      throw new Error('Linked account no longer exists');
    }

    const url = `${origin}/api/wallpaper?wallpaperKey=${result.wallpaperKey}`;

    if (command === '/url') {
      return {
        reply: { text: `Wallpaper URL\n${url}` },
        completionCommitted: false,
      };
    }

    return {
      reply: {
        ...htmlReply(
          [
            '<b>Wallpaper status</b>',
            '',
            `Range: <b>${escapeTelegramHtml(result.user.timeRange)}</b>`,
            `Layout: <b>${escapeTelegramHtml(result.user.presentation)}</b>`,
            `Lock-screen fit: <b>${escapeTelegramHtml(result.user.lockScreenProfile)}</b>`,
            `Events shown: <b>${result.user.eventCount}</b>`,
            `Theme: <b>${escapeTelegramHtml(result.user.theme)}</b>`,
            `Time zone: <b>${escapeTelegramHtml(result.user.timeZone)}</b>`,
            `Events: <b>${result.user.events.length} manual</b> · <b>${result.user.cachedCalEvents.length} Google cached</b>`,
            '',
            WALLPAPER_REFRESH_NOTE,
          ].join('\n'),
        ),
        replyMarkup: {
          inline_keyboard: [[{ text: 'Open wallpaper', url }]],
        },
      },
      completionCommitted: false,
    };
  }

  if (command === '/add') {
    const [date, ...nameParts] = args;
    const name = normalizeEventName(nameParts.join(' '));

    if (!isValidDateString(date) || !name) {
      return {
        reply: usageReply('Add an event', '/add YYYY-MM-DD Event name'),
        completionCommitted: false,
      };
    }

    await addManualEvent(token, { name, date }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Event added</b>',
          `${escapeTelegramHtml(name)} · ${escapeTelegramHtml(date)}`,
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/events') {
    const user = await getUser(token);

    if (!user?.events.length) {
      return {
        reply: htmlReply(
          [
            '<b>No manual events</b>',
            'Add one with <code>/add YYYY-MM-DD Event name</code>.',
          ].join('\n'),
        ),
        completionCommitted: false,
      };
    }

    return {
      reply: htmlReply(
        [
          '<b>Manual events</b>',
          '',
          ...user.events.map(
            (event, index) =>
              `${index + 1}. <b>${escapeTelegramHtml(event.date)}</b> · ${escapeTelegramHtml(event.name)}`,
          ),
          '',
          'Delete one with <code>/delete NUMBER</code>.',
        ].join('\n'),
      ),
      completionCommitted: false,
    };
  }

  if (command === '/delete') {
    const index = Number(args[0]) - 1;

    if (!Number.isInteger(index) || index < 0) {
      return {
        reply: deleteUsageReply(),
        completionCommitted: false,
      };
    }

    try {
      await deleteManualEventAtIndex(token, index, completion);
    } catch (error) {
      if (error instanceof Error && error.message === 'Event not found') {
        return {
          reply: deleteUsageReply(),
          completionCommitted: false,
        };
      }

      throw error;
    }

    return {
      reply: htmlReply(['✓ <b>Event deleted</b>', WALLPAPER_REFRESH_NOTE].join('\n')),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/view') {
    if (!isWallpaperPreset(args[0])) {
      return {
        reply: usageReply('Choose a preset', `/view ${WALLPAPER_PRESET_IDS.join('|')}`),
        completionCommitted: false,
      };
    }

    const preset = WALLPAPER_PRESETS[args[0]];

    await updatePreferences(
      token,
      {
        timeRange: preset.timeRange,
        presentation: preset.presentation,
      },
      completion,
    );

    return {
      reply: htmlReply(
        [
          '✓ <b>Preset updated</b>',
          escapeTelegramHtml(preset.label),
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/eventcount') {
    const count = Number(args[0]);

    if (args.length !== 1 || !/^[1-5]$/.test(args[0]) || !isEventCount(count)) {
      return {
        reply: usageReply('Choose how many events to show', '/eventcount 1|2|3|4|5'),
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { eventCount: count }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Event count updated</b>',
          `Show up to <b>${count}</b> ${count === 1 ? 'event' : 'events'} in every view.`,
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/range') {
    if (!isTimeRange(args[0])) {
      return {
        reply: usageReply(
          'Choose a time range',
          '/range week|month|quarter|rolling14|year',
        ),
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { timeRange: args[0] }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Time range updated</b>',
          escapeTelegramHtml(args[0]),
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/layout') {
    if (!isPresentation(args[0])) {
      return {
        reply: usageReply('Choose a presentation', `/layout ${PRESENTATIONS.join('|')}`),
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { presentation: args[0] }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Presentation updated</b>',
          escapeTelegramHtml(args[0]),
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/profile') {
    if (!isLockScreenProfile(args[0])) {
      return {
        reply: usageReply('Choose a lock-screen fit', '/profile standard|large-clock'),
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { lockScreenProfile: args[0] }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Lock-screen fit updated</b>',
          escapeTelegramHtml(args[0]),
          'Preview it on your phone; iOS lock-screen spacing varies.',
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/timezone') {
    if (!isValidTimeZone(args[0])) {
      return {
        reply: htmlReply(
          [
            '<b>Set a time zone</b>',
            '<code>/timezone Area/City</code>',
            'Example: <code>/timezone Africa/Accra</code>',
          ].join('\n'),
        ),
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { timeZone: args[0] }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Time zone updated</b>',
          escapeTelegramHtml(args[0]),
          WALLPAPER_REFRESH_NOTE,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/theme') {
    return runThemeCommand(token, args, completion);
  }

  if (command === '/sync') {
    const count = await syncGoogleEvents(token, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Google Calendar synced</b>',
          `${count} cached event${count === 1 ? '' : 's'}.`,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  return {
    reply: htmlReply(
      [
        '<b>Command not recognised</b>',
        'Use <code>/help</code> to see available commands.',
      ].join('\n'),
    ),
    completionCommitted: false,
  };
}

async function runThemeCommand(
  token: string,
  args: string[],
  completion?: MutationCompletion,
): Promise<LinkedCommandResult> {
  const user = await getUser(token);

  if (!user) {
    throw new Error('Linked account no longer exists');
  }

  if (!args.length || args[0] === 'list') {
    return {
      ...createThemeSelector(user),
      completionCommitted: false,
    };
  }

  if (args[0] === 'custom' && args[1] === 'add') {
    const theme = createCustomTheme(args[2], args.slice(3));

    if (!theme) {
      return {
        reply: usageReply(
          'Save a custom theme',
          '/theme custom add name #BACKGROUND #PASSED #WEEKEND #CURRENT #FUTURE',
        ),
        completionCommitted: false,
      };
    }

    if (isReservedThemeId(theme.id)) {
      return {
        reply: htmlReply(
          [
            '<b>Name reserved</b>',
            'Choose a name that is not reserved by a built-in or retired theme.',
          ].join('\n'),
        ),
        completionCommitted: false,
      };
    }

    await addCustomTheme(token, theme, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>Custom theme saved</b>',
          escapeTelegramHtml(theme.id),
          `Select it with <code>/theme ${escapeTelegramHtml(theme.id)}</code>.`,
        ].join('\n'),
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (args[0] === 'custom' && args[1] === 'delete') {
    if (!args[2]) {
      return {
        reply: usageReply('Delete a custom theme', '/theme custom delete name'),
        completionCommitted: false,
      };
    }

    const themeId = args[2].toLowerCase();

    if (!user.customThemes.some(({ id }) => id === themeId)) {
      if (completion && (await getRedis().get(completion.key))) {
        return {
          reply: customThemeDeletedReply(themeId),
          completionCommitted: true,
        };
      }

      return {
        reply: htmlReply(
          [
            '<b>Custom theme not found</b>',
            'Use <code>/theme list</code> to see your saved themes.',
          ].join('\n'),
        ),
        completionCommitted: false,
      };
    }

    await deleteCustomTheme(token, themeId, completion);

    return {
      reply: customThemeDeletedReply(themeId),
      completionCommitted: Boolean(completion),
    };
  }

  const themeId = args[0].toLowerCase();

  if (!listAvailableThemeIds(user.customThemes).includes(themeId)) {
    return {
      reply: htmlReply(
        [
          '<b>Theme not found</b>',
          'Use <code>/theme list</code> to see available themes.',
        ].join('\n'),
      ),
      completionCommitted: false,
    };
  }

  await updatePreferences(token, { theme: themeId }, completion);

  return {
    reply: htmlReply(
      [
        '✓ <b>Theme updated</b>',
        escapeTelegramHtml(themeId),
        WALLPAPER_REFRESH_NOTE,
      ].join('\n'),
    ),
    completionCommitted: Boolean(completion),
  };
}

function availableThemes(
  customThemes: import('./preferences').WallpaperTheme[],
): string[] {
  return listAvailableThemeIds(customThemes).slice(0, 9);
}

function createThemeSelector(
  user: Pick<import('./userSchema').UserData, 'theme' | 'customThemes'>,
): Pick<LinkedCommandResult, 'reply' | 'themeSelector'> {
  const themes = availableThemes(user.customThemes);

  return {
    reply: htmlReply(
      [
        '<b>Choose a theme</b>',
        '',
        `Current: <b>${escapeTelegramHtml(user.theme)}</b>`,
        `Available: ${themes.map(escapeTelegramHtml).join(' · ')}`,
        '',
        'Tap a button below, or use <code>/theme NAME</code>.',
      ].join('\n'),
      themeKeyboard(themes, user.theme),
    ),
    themeSelector: {
      themes: themes.map((id) => resolveTheme(id, user.customThemes)),
    },
  };
}

function themeKeyboard(
  themeIds: string[],
  currentThemeId: string,
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: themeIds.reduce<
      Array<Array<{ text: string; callback_data: string }>>
    >((rows, themeId, index) => {
      if (index % 2 === 0) {
        rows.push([]);
      }

      rows.at(-1)?.push({
        text: themeId === currentThemeId ? `✓ ${themeId}` : themeId,
        callback_data: `theme:${themeId}`,
      });

      return rows;
    }, []),
  };
}

function helpText(): string {
  return [
    '<b>Calendar Lockscreen</b>',
    '',
    '<b>Wallpaper</b>',
    '<code>/status</code>  Current setup',
    '<code>/url</code>  Copy wallpaper URL',
    '',
    '<b>Events</b>',
    '<code>/add YYYY-MM-DD Event name</code>',
    '<code>/events</code>',
    '<code>/eventcount 1|2|3|4|5</code>  Events shown (default 2)',
    '<code>/delete NUMBER</code>',
    '',
    '<b>Appearance</b>',
    `<code>/view ${WALLPAPER_PRESET_IDS.join('|')}</code>`,
    '<code>/range week|month|quarter|rolling14|year</code>',
    `<code>/layout ${PRESENTATIONS.join('|')}</code>`,
    '<code>/profile standard|large-clock</code>',
    '<code>/timezone Area/City</code>',
    '<code>/theme list</code>',
    '<code>/theme NAME</code>',
    '<code>/theme custom add name #BG #PASSED #WEEKEND #CURRENT #FUTURE</code>',
    '<code>/theme custom delete name</code>',
    '',
    '<b>Calendar</b>',
    '<code>/sync</code>  Refresh Google events',
  ].join('\n');
}

function htmlReply(
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): TelegramReply {
  return { text, parseMode: 'HTML', replyMarkup };
}

function usageReply(title: string, command: string): TelegramReply {
  return htmlReply(
    [
      `<b>${escapeTelegramHtml(title)}</b>`,
      `<code>${escapeTelegramHtml(command)}</code>`,
    ].join('\n'),
  );
}

function deleteUsageReply(): TelegramReply {
  return htmlReply(
    [
      '<b>Choose an event to delete</b>',
      'Open <code>/events</code>, then use <code>/delete NUMBER</code>.',
    ].join('\n'),
  );
}

function customThemeDeletedReply(themeId: string): TelegramReply {
  return htmlReply(
    [
      '✓ <b>Custom theme deleted</b>',
      escapeTelegramHtml(themeId),
      WALLPAPER_REFRESH_NOTE,
    ].join('\n'),
  );
}

function unlinkedReply(): TelegramReply {
  return htmlReply(
    [
      '<b>Telegram isn’t linked</b>',
      'Open the web dashboard and link Telegram to continue.',
    ].join('\n'),
  );
}

function expectedCommandErrorReply(message: string): TelegramReply | null {
  if (message === 'Link code is required') {
    return htmlReply(
      [
        '<b>Link code required</b>',
        'Open the Telegram link from the web dashboard to connect your account.',
      ].join('\n'),
    );
  }

  if (message === 'Link code is invalid or expired') {
    return htmlReply(
      [
        '<b>Link expired</b>',
        'Return to the web dashboard and create a new Telegram link.',
      ].join('\n'),
    );
  }

  if (
    message === 'Linked account no longer exists' ||
    message === 'Invalid management token'
  ) {
    return unlinkedReply();
  }

  if (message === 'Event not found') {
    return deleteUsageReply();
  }

  if (message === 'Maximum 7 tracked events allowed') {
    return htmlReply(
      [
        '<b>Event limit reached</b>',
        'Keep up to 7 tracked events. Delete one before adding another.',
      ].join('\n'),
    );
  }

  if (message === 'One or more calendar events are unavailable') {
    return htmlReply(
      ['<b>Calendar events changed</b>', 'Refresh your events and try again.'].join('\n'),
    );
  }

  if (message === 'Unknown theme') {
    return htmlReply(
      [
        '<b>Theme not found</b>',
        'Use <code>/theme list</code> to see available themes.',
      ].join('\n'),
    );
  }

  if (message === 'Built-in theme names are reserved') {
    return htmlReply(
      [
        '<b>Name reserved</b>',
        'Choose a name that is not used by a built-in theme.',
      ].join('\n'),
    );
  }

  if (message === 'Maximum 5 custom themes allowed') {
    return htmlReply(
      ['<b>Theme limit reached</b>', 'Delete a custom theme before saving another.'].join(
        '\n',
      ),
    );
  }

  if (message === 'Google account must be reconnected') {
    return htmlReply(
      [
        '<b>Google Calendar needs attention</b>',
        'Reconnect your Google account from the web dashboard, then try again.',
      ].join('\n'),
    );
  }

  if (message === 'Google accounts changed during sync; please retry') {
    return htmlReply(
      ['<b>Calendar account changed</b>', 'Run <code>/sync</code> again.'].join('\n'),
    );
  }

  return null;
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
