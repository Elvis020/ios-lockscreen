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

interface LinkedCommandResult extends TelegramProcessingResult {
  reply: string;
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
        'Linked. Use /help to manage the wallpaper. Changes appear on the next iOS wallpaper fetch.',
      );

      return { completionCommitted: Boolean(completion) };
    }

    const redis = getRedis();
    let token = await redis.get<string>(`telegram:user:${userId}`);

    if (!token) {
      token = await migrateLegacyPrivateLink(userId, chatId);
    }

    if (!token) {
      await sendTelegramReply(chatId, 'Open the web dashboard and link Telegram first.');

      return { completionCommitted: false };
    }

    const user = await getUser(token);

    if (!user || user.telegram?.userId !== userId) {
      await deleteRedisKeyIfValue(redis, `telegram:user:${userId}`, token);
      await sendTelegramReply(chatId, 'Open the web dashboard and link Telegram first.');

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
    const message = error instanceof Error ? error.message : 'Command failed';

    if (isExpectedCommandError(message)) {
      await sendTelegramReply(chatId, `Unable to complete command: ${message}`);

      return { completionCommitted: false };
    }

    throw error;
  }
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('Telegram bot is not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });

  if (!response.ok) {
    throw new Error('Telegram message delivery failed');
  }
}

async function sendTelegramReply(chatId: string, text: string): Promise<void> {
  try {
    await sendTelegramMessage(chatId, text);
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

  return result.reply;
}

async function runLinkedTelegramCommand(
  token: string,
  command: string,
  args: string[],
  origin: string,
  completion?: MutationCompletion,
): Promise<LinkedCommandResult> {
  if (command === '/help') {
    return { reply: helpText(), completionCommitted: false };
  }

  if (command === '/status' || command === '/url') {
    const result = await ensureWallpaperKey(token);

    if (!result) {
      throw new Error('Linked account no longer exists');
    }

    const url = `${origin}/api/wallpaper?wallpaperKey=${result.wallpaperKey}`;

    if (command === '/url') {
      return {
        reply: `Wallpaper URL:\n${url}`,
        completionCommitted: false,
      };
    }

    return {
      reply: [
        `View: ${result.user.viewMode}`,
        `Theme: ${result.user.theme}`,
        `Time zone: ${result.user.timeZone}`,
        `Manual events: ${result.user.events.length}`,
        `Google events cached: ${result.user.cachedCalEvents.length}`,
        `Wallpaper: ${url}`,
        'Settings apply on the next iOS wallpaper fetch.',
      ].join('\n'),
      completionCommitted: false,
    };
  }

  if (command === '/add') {
    const [date, ...nameParts] = args;
    const name = normalizeEventName(nameParts.join(' '));

    if (!isValidDateString(date) || !name) {
      return {
        reply: 'Usage: /add YYYY-MM-DD Event name',
        completionCommitted: false,
      };
    }

    await addManualEvent(token, { name, date }, completion);

    return {
      reply: `Added “${name}” on ${date}. It appears on the next wallpaper fetch.`,
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/events') {
    const user = await getUser(token);

    if (!user?.events.length) {
      return {
        reply: 'No manual events yet. Use /add YYYY-MM-DD Event name.',
        completionCommitted: false,
      };
    }

    return {
      reply: user.events
        .map((event, index) => `${index + 1}. ${event.date} — ${event.name}`)
        .join('\n'),
      completionCommitted: false,
    };
  }

  if (command === '/delete') {
    const index = Number(args[0]) - 1;

    if (!Number.isInteger(index) || index < 0) {
      return {
        reply: 'Usage: /delete NUMBER from /events',
        completionCommitted: false,
      };
    }

    try {
      await deleteManualEventAtIndex(token, index, completion);
    } catch (error) {
      if (error instanceof Error && error.message === 'Event not found') {
        return {
          reply: 'Usage: /delete NUMBER from /events',
          completionCommitted: false,
        };
      }

      throw error;
    }

    return {
      reply: 'Event deleted.',
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/view') {
    if (!isViewMode(args[0])) {
      return {
        reply: 'Usage: /view week|month|quarter',
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { viewMode: args[0] }, completion);

    return {
      reply: `View changed to ${args[0]}. It applies on the next wallpaper fetch.`,
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/timezone') {
    if (!isValidTimeZone(args[0])) {
      return {
        reply: 'Usage: /timezone Area/City (example: /timezone Africa/Accra)',
        completionCommitted: false,
      };
    }

    await updatePreferences(token, { timeZone: args[0] }, completion);

    return {
      reply: `Time zone changed to ${args[0]}.`,
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/theme') {
    return runThemeCommand(token, args, completion);
  }

  if (command === '/sync') {
    const count = await syncGoogleEvents(token, completion);

    return {
      reply: `Google Calendar synced: ${count} cached event${count === 1 ? '' : 's'}.`,
      completionCommitted: Boolean(completion),
    };
  }

  return { reply: helpText(), completionCommitted: false };
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
      reply: `Themes: ${listAvailableThemeIds(user.customThemes).join(', ')}\nCurrent: ${user.theme}`,
      completionCommitted: false,
    };
  }

  if (args[0] === 'custom' && args[1] === 'add') {
    const theme = createCustomTheme(args[2], args.slice(3));

    if (!theme) {
      return {
        reply:
          'Usage: /theme custom add name #BACKGROUND #PASSED #WEEKEND #CURRENT #FUTURE',
        completionCommitted: false,
      };
    }

    if (BUILT_IN_THEMES[theme.id]) {
      return {
        reply: 'Built-in theme names are reserved.',
        completionCommitted: false,
      };
    }

    await addCustomTheme(token, theme, completion);

    return {
      reply: `Custom theme “${theme.id}” saved. Use /theme ${theme.id} to select it.`,
      completionCommitted: Boolean(completion),
    };
  }

  if (args[0] === 'custom' && args[1] === 'delete') {
    if (!args[2]) {
      return {
        reply: 'Usage: /theme custom delete name',
        completionCommitted: false,
      };
    }

    await deleteCustomTheme(token, args[2].toLowerCase(), completion);

    return {
      reply: `Custom theme “${args[2].toLowerCase()}” deleted.`,
      completionCommitted: Boolean(completion),
    };
  }

  const themeId = args[0].toLowerCase();

  if (!listAvailableThemeIds(user.customThemes).includes(themeId)) {
    return {
      reply: 'Unknown theme. Use /theme list.',
      completionCommitted: false,
    };
  }

  await updatePreferences(token, { theme: themeId }, completion);

  return {
    reply: `Theme changed to ${themeId}. It applies on the next wallpaper fetch.`,
    completionCommitted: Boolean(completion),
  };
}

function helpText(): string {
  return [
    '/status — current settings and wallpaper URL',
    '/url — wallpaper URL',
    '/add YYYY-MM-DD Name',
    '/events',
    '/delete NUMBER',
    '/view week|month|quarter',
    '/timezone Area/City',
    '/theme list',
    '/theme NAME',
    '/theme custom add name #BG #PASSED #WEEKEND #CURRENT #FUTURE',
    '/theme custom delete name',
    '/sync — refresh Google cached events',
  ].join('\n');
}

function isExpectedCommandError(message: string): boolean {
  return (
    message === 'Link code is required' ||
    message === 'Link code is invalid or expired' ||
    message === 'Linked account no longer exists' ||
    message === 'Event not found' ||
    message === 'Unknown theme' ||
    message === 'Built-in theme names are reserved' ||
    message === 'One or more calendar events are unavailable' ||
    message.startsWith('Maximum ')
  );
}
