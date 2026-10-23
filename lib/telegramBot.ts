import { syncGoogleEvents } from './calendar/service';
import { BUILT_IN_THEMES, isViewMode, listAvailableThemeIds } from './preferences';
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
}

export interface TelegramProcessingResult {
  completionCommitted: boolean;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; url: string }>>;
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
}

export async function processTelegramUpdate(
  update: TelegramUpdate,
  origin: string,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
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

    await sendTelegramReply(chatId, result.reply);

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
            `View: <b>${escapeTelegramHtml(result.user.viewMode)}</b>`,
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
    if (!isViewMode(args[0])) {
      return {
        reply: usageReply('Choose a view', '/view week|month|quarter'),
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { viewMode: args[0] }, completion);

    return {
      reply: htmlReply(
        [
          '✓ <b>View updated</b>',
          escapeTelegramHtml(args[0]),
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
      reply: htmlReply(
        [
          '<b>Themes</b>',
          '',
          `Current: <b>${escapeTelegramHtml(user.theme)}</b>`,
          `Available: ${listAvailableThemeIds(user.customThemes)
            .map(escapeTelegramHtml)
            .join(' · ')}`,
          '',
          'Select with <code>/theme NAME</code>.',
        ].join('\n'),
      ),
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

    if (BUILT_IN_THEMES[theme.id]) {
      return {
        reply: htmlReply(
          [
            '<b>Name reserved</b>',
            'Choose a name that is not used by a built-in theme.',
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
    '<code>/delete NUMBER</code>',
    '',
    '<b>Appearance</b>',
    '<code>/view week|month|quarter</code>',
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

function htmlReply(text: string): TelegramReply {
  return { text, parseMode: 'HTML' };
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
