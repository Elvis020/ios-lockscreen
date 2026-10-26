import { syncGoogleEvents, type GoogleSyncResult } from './calendar/service';
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
  BUILT_IN_THEMES,
} from './preferences';
import { createThemePreviewImageResponse } from './themePreviewRenderer';
import { getRedis } from './redis';
import { resolveReadTimeAppearance } from './profileResolver';
import { deleteRedisKeyIfValue } from './redisLock';
import {
  addCustomTheme,
  deleteCustomTheme,
  deleteManualEventAtIndex,
  ensureWallpaperKey,
  getUser,
  linkTelegramIdentity,
  provisionTelegramAccount,
  updatePreferences,
  saveTelegramDraftEvent,
  saveTelegramEditDraft,
  createSharedCountdown,
  revokeSharedCountdown,
  setEventCategory,
  setFocusEvent,
  setManualEventRecurrence,
  type MutationCompletion,
} from './tokenManager';
import {
  cancelTelegramDraft,
  clearTelegramDraftDate,
  createTelegramDraft,
  createTelegramEditMenu,
  consumeTelegramEditMenuAndCreateDraft,
  formatTelegramEventDate,
  getTelegramDraft,
  getTelegramEditMenu,
  parseTelegramEventInput,
  updateTelegramDraftDate,
  updateTelegramDraftName,
  updateTelegramDraftStep,
  type TelegramEventDraft,
} from './telegramDrafts';
import {
  createCustomTheme,
  isValidDateString,
  isValidTimeZone,
  normalizeEventName,
} from './validation';
import { buildEventTimeline } from './eventTimeline';
import type { UserData } from './userSchema';
import {
  createStudioDraft,
  finalizeStudioDraft,
  getStudioDraft,
  getStudioOutcome,
  type TelegramStudioDraft,
} from './telegramStudioDrafts';
import {
  createColorTheme,
  createMoodTheme,
  isStudioMood,
  type StudioMood,
} from './studioThemes';

const WALLPAPER_REFRESH_NOTE = 'Changes appear on the next iOS wallpaper refresh.';

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; username?: string; first_name?: string };
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
  inline_keyboard: Array<
    Array<{
      text: string;
      url?: string;
      callback_data?: string;
      web_app?: { url: string };
    }>
  >;
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
    return processTelegramCallback(update.callback_query, origin, completion);
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
      const setup = !args[0] || args[0].toLowerCase() === 'setup';
      let created = false;

      if (setup) {
        const result = await provisionTelegramAccount(
          {
            userId,
            chatId,
            username: update.message?.from?.username,
            linkedAt: new Date().toISOString(),
          },
          update.message?.from?.first_name ?? update.message?.from?.username ?? 'You',
          'UTC',
          completion,
        );

        created = result.created;
      } else {
        await linkChat(
          userId,
          chatId,
          args[0],
          update.message?.from?.username,
          completion,
        );
      }

      await sendTelegramReply(chatId, onboardingReply(origin, created));

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

    const user = token ? await getUser(token) : null;

    if (!user || user.telegram?.userId !== userId || user.telegram.chatId !== chatId) {
      await deleteRedisKeyIfValue(redis, `telegram:user:${userId}`, token);
      await sendTelegramReply(chatId, unlinkedReply());

      return { completionCommitted: false };
    }

    if (!command.startsWith('/')) {
      const draft = await getTelegramDraft(userId);

      if (draft?.token === token && draft.chatId === chatId) {
        if (draft.operation === 'edit' && draft.step === 'name') {
          const name = normalizeEventName(text);

          if (!name) {
            await sendTelegramReply(
              chatId,
              htmlReply('<b>Event name needed</b>\nUse 1–50 characters.'),
            );

            return { completionCommitted: false };
          }

          const updated = await updateTelegramDraftName(
            userId,
            draft.id,
            name,
            draft.revision,
            completion,
          );

          if (updated) {
            await sendTelegramReply(chatId, draftReply(updated, origin));

            return { completionCommitted: Boolean(completion) };
          }
        }

        if (draft.name) {
          await sendTelegramReply(chatId, draftReply(draft, origin));

          return { completionCommitted: false };
        }

        const parsed = parseTelegramEventInput(text, user.timeZone);

        if (!parsed.name || parsed.error) {
          await sendTelegramReply(
            chatId,
            htmlReply(
              '<b>Event name needed</b>\nUse 1–50 characters, then choose a date.',
            ),
          );

          return { completionCommitted: false };
        }

        const replacement = await createTelegramDraft(
          {
            token,
            userId,
            chatId,
            name: parsed.name,
            date: parsed.date,
          },
          completion,
        );

        await sendTelegramReply(chatId, draftReply(replacement, origin));

        return { completionCommitted: Boolean(completion) };
      }
    }

    const result = await runLinkedTelegramCommand(
      token,
      command,
      args,
      origin,
      completion,
      { userId, chatId, timeZone: user.timeZone },
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
  const page =
    callback.data === 'theme-page:custom'
      ? 'custom'
      : callback.data === 'theme-page:builtins'
        ? 'builtins'
        : undefined;

  let acknowledgement = 'This selection is not available.';

  try {
    if (
      callback.message?.chat?.type !== 'private' ||
      chatId === undefined ||
      userId === undefined ||
      (!themeId && !page)
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
      (themeId && !listAvailableThemeIds(user.customThemes).includes(themeId))
    ) {
      return { completionCommitted: false };
    }

    if (page) {
      const selector = createThemeSelector(user, page);

      if (selector.themeSelector) {
        await sendTelegramThemeSelector(chat, selector.reply, selector.themeSelector);
      } else {
        await sendTelegramReply(chat, selector.reply);
      }

      acknowledgement = page === 'custom' ? 'Custom themes.' : 'Built-in themes.';

      return { completionCommitted: false };
    }

    if (themeId === user.theme) {
      acknowledgement = `Already using ${themeId}.`;

      return { completionCommitted: false };
    }

    if (!themeId) {
      return { completionCommitted: false };
    }

    const updatedUser = await updatePreferences(token, { theme: themeId }, completion);

    if (!updatedUser) {
      throw new Error('Linked account no longer exists');
    }

    if (typeof callback.message?.message_id === 'number') {
      const selector = createThemeSelector(
        updatedUser,
        BUILT_IN_THEMES[themeId] ? 'builtins' : 'custom',
      );

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

async function processTelegramCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  origin: string,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  if (callback.data?.startsWith('ee:')) {
    return processEditMenuCallback(callback, origin, completion);
  }

  if (callback.data?.startsWith('ev:')) {
    return processEventCallback(callback, origin, completion);
  }

  if (callback.data?.startsWith('studio:')) {
    return processStudioCallback(callback, completion);
  }

  if (callback.data?.startsWith('studio-mood:')) {
    return processStudioMoodCallback(callback, origin, completion);
  }

  return processThemeCallback(callback, completion);
}

async function processStudioMoodCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  origin: string,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  const mood = callback.data?.slice('studio-mood:'.length);
  const userId = callback.from?.id;
  const chatId = callback.message?.chat?.id;
  let acknowledgement = 'This mood is not available.';

  try {
    if (
      callback.message?.chat?.type !== 'private' ||
      userId === undefined ||
      chatId === undefined ||
      !isStudioMood(mood)
    ) {
      return { completionCommitted: false };
    }

    const redis = getRedis();
    const telegramUserId = String(userId);
    const chat = String(chatId);
    const token = await redis.get<string>(`telegram:user:${telegramUserId}`);
    const user = token ? await getUser(token) : null;

    if (
      !token ||
      !user ||
      user.telegram?.userId !== telegramUserId ||
      user.telegram.chatId !== chat
    ) {
      acknowledgement = 'Link Telegram in the dashboard first.';

      return { completionCommitted: false };
    }

    const result = await runLinkedTelegramCommand(
      token,
      '/studio',
      [mood],
      origin,
      completion,
      { userId: telegramUserId, chatId: chat, timeZone: user.timeZone },
    );

    if (result.themeSelector) {
      await sendTelegramThemeSelector(chat, result.reply, result.themeSelector);
    } else {
      await sendTelegramReply(chat, result.reply);
    }

    acknowledgement = `${mood[0].toUpperCase()}${mood.slice(1)} preview ready.`;

    return { completionCommitted: result.completionCommitted };
  } finally {
    if (callback.id) await answerTelegramCallback(callback.id, acknowledgement);
  }
}

async function processStudioCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  const match = callback.data?.match(
    /^studio:([a-z0-9]{16}):([a-z0-9]{10}):(save|cancel)$/,
  );
  const userId = callback.from?.id;
  const chatId = callback.message?.chat?.id;
  let acknowledgement = 'Studio draft expired.';

  try {
    if (
      !match ||
      callback.message?.chat?.type !== 'private' ||
      userId === undefined ||
      chatId === undefined
    )
      return { completionCommitted: false };
    const telegramUserId = String(userId);
    const chat = String(chatId);
    const draft = await getStudioDraft(telegramUserId);

    if (
      !draft ||
      draft.id !== match[1] ||
      draft.revision !== match[2] ||
      draft.chatId !== chat
    ) {
      const outcome = await getStudioOutcome(telegramUserId, chat, match[1], match[2]);

      if (outcome) {
        acknowledgement = outcome === 'save' ? 'Already saved.' : 'Already cancelled.';
      }

      return { completionCommitted: false };
    }
    if (match[3] === 'cancel') {
      const outcome = await finalizeStudioDraft(draft, 'cancel', completion);

      if (outcome === 'stale') return { completionCommitted: false };
      acknowledgement = outcome === 'save' ? 'Already saved.' : 'Studio draft cancelled.';

      if (outcome === 'save') return { completionCommitted: Boolean(completion) };
      await sendTelegramReply(
        chat,
        htmlReply('<b>Studio draft cancelled</b>\nNothing was saved.'),
      );

      return { completionCommitted: Boolean(completion) };
    }
    const outcome = await finalizeStudioDraft(draft, 'save', completion);

    if (outcome === 'stale') return { completionCommitted: false };

    if (outcome === 'cancel') {
      acknowledgement = 'Already cancelled.';

      return { completionCommitted: Boolean(completion) };
    }

    acknowledgement = 'Theme saved.';
    await sendTelegramReply(
      chat,
      htmlReply(
        `✓ <b>Studio theme saved</b>\n${escapeTelegramHtml(draft.theme.id)}\n${WALLPAPER_REFRESH_NOTE}`,
      ),
    );

    return { completionCommitted: Boolean(completion) };
  } finally {
    if (callback.id) await answerTelegramCallback(callback.id, acknowledgement);
  }
}

async function processEditMenuCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  origin: string,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  const callbackId = callback.id;
  let acknowledgement = 'That edit menu has expired. Open /edit again.';

  try {
    const match = callback.data?.match(/^ee:([A-Za-z0-9_-]{16}):([0-6])$/);
    const [, menuId, indexText] = match ?? [];
    const chatId = callback.message?.chat?.id;
    const userId = callback.from?.id;

    if (
      !match ||
      callback.message?.chat?.type !== 'private' ||
      chatId === undefined ||
      userId === undefined
    ) {
      return { completionCommitted: false };
    }

    const telegramUserId = String(userId);
    const chat = String(chatId);
    const redis = getRedis();
    const token = await redis.get<string>(`telegram:user:${telegramUserId}`);
    const menu = await getTelegramEditMenu(telegramUserId, menuId!);

    if (!token || !menu || menu.token !== token || menu.chatId !== chat) {
      return { completionCommitted: false };
    }

    const eventId = menu.eventIds[Number(indexText)];
    const user = eventId ? await getUser(token) : null;
    const event = user?.events.find(({ id }) => id === eventId);

    if (!user || !event || event.source !== 'manual') {
      acknowledgement = 'That event changed. Open /edit again.';

      return { completionCommitted: false };
    }

    if (user.telegram?.userId !== telegramUserId || user.telegram.chatId !== chat) {
      return { completionCommitted: false };
    }

    const draft = await consumeTelegramEditMenuAndCreateDraft(
      telegramUserId,
      menuId!,
      {
        token,
        userId: telegramUserId,
        chatId: chat,
        name: event.name,
        date: event.date,
        operation: 'edit',
        step: 'review',
        original: {
          id: event.id,
          name: event.name,
          date: event.date,
          source: event.source,
          createdAt: event.createdAt,
        },
      },
      completion,
    );

    if (!draft) {
      return { completionCommitted: false };
    }

    acknowledgement = 'Edit event.';
    await sendTelegramReply(chat, draftReply(draft, origin));

    return { completionCommitted: Boolean(completion) };
  } finally {
    if (callbackId) {
      await answerTelegramCallback(callbackId, acknowledgement);
    }
  }
}

async function processEventCallback(
  callback: NonNullable<TelegramUpdate['callback_query']>,
  origin: string,
  completion?: MutationCompletion,
): Promise<TelegramProcessingResult> {
  const callbackId = callback.id;
  let acknowledgement = 'That event draft has expired. Start again with /add.';

  try {
    const chatId = callback.message?.chat?.id;
    const userId = callback.from?.id;
    const match = callback.data?.match(
      /^ev:([A-Za-z0-9_-]{16}):([A-Za-z0-9_-]{11}):(save|name|date|today|tomorrow|monday|cancel)$/,
    );
    const [, id, revision, action] = match ?? [];

    if (
      !match ||
      chatId === undefined ||
      userId === undefined ||
      callback.message?.chat?.type !== 'private'
    ) {
      return { completionCommitted: false };
    }

    const chat = String(chatId);
    const telegramUserId = String(userId);
    const token = await getRedis().get<string>(`telegram:user:${telegramUserId}`);
    const draft = await getTelegramDraft(telegramUserId);

    const user = token ? await getUser(token) : null;

    if (
      !token ||
      !user ||
      user.telegram?.userId !== telegramUserId ||
      user.telegram.chatId !== chat ||
      !draft ||
      draft.id !== id ||
      draft.revision !== revision ||
      draft.token !== token ||
      draft.chatId !== chat
    ) {
      return { completionCommitted: false };
    }

    if (action === 'cancel') {
      const cancelled = await cancelTelegramDraft(
        telegramUserId,
        id,
        revision,
        completion,
      );

      if (!cancelled) {
        return { completionCommitted: false };
      }

      acknowledgement = 'Draft cancelled.';
      await sendTelegramReply(
        chat,
        htmlReply(
          draft.operation === 'edit'
            ? '<b>Changes discarded</b>\nThe event is unchanged.'
            : '<b>Event cancelled</b>\nNothing was saved.',
        ),
      );

      return { completionCommitted: Boolean(completion) };
    }

    if (action === 'name' && draft.operation === 'edit' && draft.step === 'review') {
      const updated = await updateTelegramDraftStep(
        telegramUserId,
        id,
        revision,
        'name',
        completion,
      );

      if (!updated) {
        return { completionCommitted: false };
      }

      acknowledgement = 'Send a new name.';
      await sendTelegramReply(
        chat,
        htmlReply('<b>Change event name</b>\nSend the new name only.'),
      );

      return { completionCommitted: Boolean(completion) };
    }

    if (action === 'date' && draft.step === 'review') {
      const updated = await clearTelegramDraftDate(
        telegramUserId,
        id,
        revision,
        completion,
      );

      if (!updated) {
        return { completionCommitted: false };
      }

      acknowledgement = 'Choose a new date.';
      await sendTelegramReply(chat, draftReply(updated, origin));

      return { completionCommitted: Boolean(completion) };
    }

    if (
      draft.step === 'date' &&
      (action === 'today' || action === 'tomorrow' || action === 'monday')
    ) {
      const user = await getUser(token);

      if (!user) {
        return { completionCommitted: false };
      }

      const parsed = parseTelegramEventInput(
        `${draft.name} ${action === 'monday' ? 'next monday' : action}`,
        user.timeZone,
      );

      if (!parsed.date) {
        return { completionCommitted: false };
      }

      const updated = await updateTelegramDraftDate(
        telegramUserId,
        id,
        parsed.date,
        revision,
        completion,
      );

      if (!updated) {
        return { completionCommitted: false };
      }

      acknowledgement = 'Date selected.';
      await sendTelegramReply(chat, draftReply(updated, origin));

      return { completionCommitted: Boolean(completion) };
    }

    if (action === 'save' && draft.step === 'review' && draft.date) {
      const outcome =
        draft.operation === 'edit'
          ? await saveTelegramEditDraft(token, draft, completion)
          : await saveTelegramDraftEvent(token, draft, completion);

      if (outcome === 'limit') {
        acknowledgement = 'Event limit reached.';
        await sendTelegramReply(
          chat,
          expectedCommandErrorReply('Maximum 7 tracked events allowed')!,
        );

        return { completionCommitted: false };
      }

      if (outcome === 'stale') {
        return { completionCommitted: false };
      }

      if (outcome === 'conflict') {
        acknowledgement = 'Event changed elsewhere.';
        await sendTelegramReply(
          chat,
          htmlReply(
            '<b>Event changed</b>\nIt was updated or removed elsewhere. Open <code>/edit</code> and try again.',
          ),
        );

        return { completionCommitted: Boolean(completion) };
      }

      acknowledgement = outcome === 'already-saved' ? 'Already saved.' : 'Event saved.';
      await sendTelegramReply(
        chat,
        htmlReply(
          `✓ <b>Event ${draft.operation === 'edit' ? 'updated' : 'saved'}</b>\n${escapeTelegramHtml(draft.name)} · ${escapeTelegramHtml(formatTelegramEventDate(draft.date))}\n${WALLPAPER_REFRESH_NOTE}`,
        ),
      );

      return { completionCommitted: Boolean(completion) };
    }

    return { completionCommitted: false };
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
  context?: { userId: string; chatId: string; timeZone: string },
): Promise<LinkedCommandResult> {
  if (command === '/help') {
    return { reply: htmlReply(helpText()), completionCommitted: false };
  }

  if (command === '/app') {
    return { reply: onboardingReply(origin, false), completionCommitted: false };
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
    const appearance = resolveReadTimeAppearance(result.user);

    return {
      reply: {
        ...htmlReply(
          [
            '<b>Wallpaper status</b>',
            '',
            `Range: <b>${escapeTelegramHtml(appearance.timeRange)}</b>`,
            `Layout: <b>${escapeTelegramHtml(appearance.presentation)}</b>`,
            `Lock-screen fit: <b>${escapeTelegramHtml(appearance.lockScreenProfile)}</b>`,
            `Events shown: <b>${appearance.eventCount}</b>`,
            `Theme now: <b>${escapeTelegramHtml(appearance.theme)}</b>`,
            `Living: <b>${escapeTelegramHtml(appearance.livingOverlay)}</b> · Rings: <b>${escapeTelegramHtml(appearance.milestoneRingStyle)}</b>`,
            `Auto profiles: <b>${result.user.automaticProfiles?.enabled ? 'on' : 'off'}</b> · active: <b>${escapeTelegramHtml(appearance.slot ?? 'base')}</b>`,
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
    if (!context) {
      return {
        reply: usageReply('Add an event', '/add Event name'),
        completionCommitted: false,
      };
    }

    if (!args.length) {
      await createTelegramDraft(
        {
          token,
          userId: context.userId,
          chatId: context.chatId,
          name: '',
        },
        completion,
      );

      return {
        reply: htmlReply('<b>Add an event</b>\nWhat should we call it?'),
        completionCommitted: Boolean(completion),
      };
    }

    const parsed = parseTelegramEventInput(args.join(' '), context.timeZone);

    if (
      !parsed.name ||
      parsed.error ||
      (parsed.date && !isValidDateString(parsed.date))
    ) {
      return {
        reply: htmlReply(
          '<b>Try a name and date</b>\nExamples: <code>Dentist tomorrow</code>, <code>Mum’s birthday 14 November</code>, or <code>Conference next Friday</code>.',
        ),
        completionCommitted: false,
      };
    }

    const draft = await createTelegramDraft(
      {
        token,
        userId: context.userId,
        chatId: context.chatId,
        name: parsed.name,
        date: parsed.date,
      },
      completion,
    );

    return {
      reply: draftReply(draft, origin),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/events') {
    const user = await getUser(token);

    if (!user?.events.length && !user?.selectedEventIds.length) {
      return {
        reply: htmlReply(
          ['<b>No manual events</b>', 'Add one with <code>/add Event name</code>.'].join(
            '\n',
          ),
        ),
        completionCommitted: false,
      };
    }

    return {
      reply: htmlReply(
        [
          '<b>Tracked events</b>',
          '',
          ...user.events.map(
            (event, index) =>
              `M${index + 1}. <b>${escapeTelegramHtml(event.date)}</b> · ${escapeTelegramHtml(event.name)} <i>${escapeTelegramHtml(event.category ?? 'general')}</i>${event.recurrence && event.recurrence !== 'none' ? ` · ${event.recurrence}` : ''}`,
          ),
          ...selectedGoogleEvents(user).map(
            (event, index) =>
              `G${index + 1}. <b>${escapeTelegramHtml(event.date)}</b> · ${escapeTelegramHtml(event.name)} <i>${escapeTelegramHtml(user.googleCategoryOverrides?.[event.id] ?? 'general')}</i>`,
          ),
          '',
          'Edit one with <code>/edit</code> or delete one with <code>/delete NUMBER</code>.',
        ].join('\n'),
      ),
      completionCommitted: false,
    };
  }

  if (command === '/today' || command === '/week') {
    const user = await getUser(token);

    if (!user) throw new Error('Linked account no longer exists');
    const start = localDate(user.timeZone);
    const endDate = new Date(`${start}T00:00:00Z`);

    endDate.setUTCDate(endDate.getUTCDate() + (command === '/week' ? 6 : 0));
    const events = buildEventTimeline(
      user.events,
      selectedGoogleEvents(user).map((event) => ({
        ...event,
        category: user.googleCategoryOverrides?.[event.id] ?? 'general',
      })),
      user.selectedEventIds,
      start,
      endDate.toISOString().slice(0, 10),
    );

    return {
      reply: htmlReply(
        [
          `<b>${command === '/today' ? 'Today' : 'This week'}</b>`,
          '',
          ...(events.length
            ? events.map(
                (event) =>
                  `${event.stableRef} · <b>${escapeTelegramHtml(event.date)}</b> · ${escapeTelegramHtml(event.name)}`,
              )
            : ['No tracked events.']),
        ].join('\n'),
      ),
      completionCommitted: false,
    };
  }

  if (command === '/focus') {
    const user = await getUser(token);
    const ref = args[0]?.toUpperCase();

    if (ref === 'OFF') {
      if (!user)
        return {
          reply: usageReply('Choose a focus event', '/focus M1|G1|off'),
          completionCommitted: false,
        };
      await setFocusEvent(token, undefined, completion);

      return {
        reply: htmlReply(`✓ <b>Focus cleared</b>\n${WALLPAPER_REFRESH_NOTE}`),
        completionCommitted: Boolean(completion),
      };
    }
    const match = ref?.match(/^([MG])(\d+)$/);

    if (!user || !match)
      return {
        reply: usageReply('Choose a focus event', '/focus M1|G1|off'),
        completionCommitted: false,
      };
    const source = match[1] === 'M' ? user.events : selectedGoogleEvents(user);
    const event = source[Number(match[2]) - 1];

    if (!event)
      return {
        reply: usageReply('Choose a focus event', '/focus M1|G1|off'),
        completionCommitted: false,
      };
    await setFocusEvent(token, event.id, completion);

    return {
      reply: htmlReply(
        `✓ <b>Focus event set</b>\n${escapeTelegramHtml(event.name)}\n${WALLPAPER_REFRESH_NOTE}`,
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/repeat' || command === '/category') {
    const user = await getUser(token);
    const match = args[0]?.toUpperCase().match(/^([MG])(\d+)$/);
    const value = args[1]?.toLowerCase();
    const allowed =
      command === '/repeat'
        ? ['off', 'weekly', 'monthly', 'yearly']
        : ['general', 'work', 'personal', 'health', 'travel'];

    if (!user || !match || !value || !allowed.includes(value)) {
      return {
        reply: usageReply(
          command === '/repeat' ? 'Set recurrence' : 'Set category',
          command === '/repeat'
            ? '/repeat M1 off|weekly|monthly|yearly'
            : '/category M1|G1 general|work|personal|health|travel',
        ),
        completionCommitted: false,
      };
    }
    const list = match[1] === 'M' ? user.events : selectedGoogleEvents(user);
    const event = list[Number(match[2]) - 1];

    if (!event || (command === '/repeat' && match[1] !== 'M')) {
      return {
        reply: usageReply(
          command === '/repeat' ? 'Only manual events repeat' : 'Choose a tracked event',
          command === '/repeat'
            ? '/repeat M1 off|weekly|monthly|yearly'
            : '/category M1|G1 general|work|personal|health|travel',
        ),
        completionCommitted: false,
      };
    }
    if (command === '/repeat')
      await setManualEventRecurrence(
        token,
        event.id,
        value === 'off' ? 'none' : (value as import('./userSchema').EventRecurrence),
        completion,
      );
    else
      await setEventCategory(
        token,
        event.id,
        value as import('./userSchema').EventCategory,
        completion,
      );

    return {
      reply: htmlReply(
        `✓ <b>${command === '/repeat' ? 'Recurrence' : 'Category'} updated</b>\n${escapeTelegramHtml(event.name)} · ${escapeTelegramHtml(value)}\n${WALLPAPER_REFRESH_NOTE}`,
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/overlay' || command === '/living') {
    const overlay = args[0];

    if (
      !['none', 'snow', 'rain', 'stars', 'haze', 'sunset', 'seasonal'].includes(
        String(overlay),
      )
    )
      return {
        reply: usageReply(
          'Choose a static living overlay',
          '/living none|snow|rain|stars|haze|sunset|seasonal',
        ),
        completionCommitted: false,
      };
    await updatePreferences(
      token,
      { livingOverlay: overlay as import('./userSchema').LivingOverlay },
      completion,
    );

    return {
      reply: htmlReply(
        `✓ <b>Living overlay updated</b>\n${escapeTelegramHtml(overlay!)} · static per fetch, not live weather.\n${WALLPAPER_REFRESH_NOTE}`,
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/ring' || command === '/rings') {
    const style = args[0];

    if (!['single', 'double', 'halo'].includes(String(style)))
      return {
        reply: usageReply('Choose a milestone ring', '/rings single|double|halo'),
        completionCommitted: false,
      };
    await updatePreferences(
      token,
      { milestoneRingStyle: style as import('./userSchema').MilestoneRingStyle },
      completion,
    );

    return {
      reply: htmlReply(
        `✓ <b>Milestone ring updated</b>\n${escapeTelegramHtml(style!)}\n${WALLPAPER_REFRESH_NOTE}`,
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/studio') {
    if (!context)
      return {
        reply: usageReply('Theme studio', '/studio mood|color #RRGGBB [name]'),
        completionCommitted: false,
      };
    const mood = args[0]?.toLowerCase();

    if (!mood) {
      return { reply: studioMoodPickerReply(), completionCommitted: false };
    }

    const name = (mood === 'color' ? args[2] : mood) ?? 'studio';
    const selection = isStudioMood(mood)
      ? createMoodTheme(mood)
      : mood === 'color' && args[1]
        ? createColorTheme(name, args[1])
        : null;

    if (!selection)
      return {
        reply: usageReply(
          'Theme studio',
          '/studio calm|warm|focus|night|fresh or /studio color #RRGGBB [name]',
        ),
        completionCommitted: false,
      };
    const { theme, overlay } = selection;

    if (isReservedThemeId(theme.id))
      return {
        reply: htmlReply(
          '<b>Choose another name</b>\nBuilt-in names are reserved; names use lowercase letters, numbers, and hyphens.',
        ),
        completionCommitted: false,
      };
    const user = await getUser(token);

    if (
      !user ||
      (user.customThemes.length >= 5 &&
        !user.customThemes.some((candidate) => candidate.id === theme.id))
    )
      return {
        reply: htmlReply(
          '<b>Theme limit reached</b>\nDelete a custom theme before saving another.',
        ),
        completionCommitted: false,
      };
    const draft = await createStudioDraft(
      {
        token,
        userId: context.userId,
        chatId: context.chatId,
        theme,
        livingOverlay: overlay,
      },
      completion,
    );

    return {
      reply: studioReply(draft),
      themeSelector: { themes: [theme] },
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/autoprofile') {
    const user = await getUser(token);

    if (!user) throw new Error('Linked account no longer exists');
    const profiles = user.automaticProfiles!;
    const action = args[0];

    if (!action || action === 'status')
      return { reply: htmlReply(autoProfileText(profiles)), completionCommitted: false };
    if (action === 'on' || action === 'off') {
      await updatePreferences(
        token,
        { automaticProfiles: { ...profiles, enabled: action === 'on' } },
        completion,
      );

      return {
        reply: htmlReply(
          `✓ <b>Automatic profiles ${action}</b>\n${WALLPAPER_REFRESH_NOTE}`,
        ),
        completionCommitted: Boolean(completion),
      };
    }
    const slotName = action === 'save' ? args[1] : action;

    if (!['day', 'evening', 'night'].includes(String(slotName)))
      return {
        reply: usageReply(
          'Automatic profiles',
          '/autoprofile status|on|off|save day|evening|night',
        ),
        completionCommitted: false,
      };
    const name = slotName as 'day' | 'evening' | 'night';
    const ranges = { day: [6, 18], evening: [18, 22], night: [22, 6] } as const;
    const slot = profiles[name];

    await updatePreferences(
      token,
      {
        automaticProfiles: {
          ...profiles,
          [name]: {
            ...slot,
            enabled: true,
            startHour: ranges[name][0],
            endHour: ranges[name][1],
            theme: user.theme,
            timeRange: user.timeRange,
            presentation: user.presentation,
            lockScreenProfile: user.lockScreenProfile,
            eventCount: user.eventCount,
            livingOverlay: user.livingOverlay,
            milestoneRingStyle: user.milestoneRingStyle,
          },
        },
      },
      completion,
    );

    return {
      reply: htmlReply(
        `✓ <b>${escapeTelegramHtml(name)} slot saved</b>\nUses ${ranges[name][0]}:00–${ranges[name][1]}:00 at read time.`,
      ),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/share') {
    const user = await getUser(token);
    const match = args[0]?.toUpperCase().match(/^([MG])(\d+)$/);

    if (!user || !match)
      return {
        reply: usageReply('Share a countdown', '/share M1|G1'),
        completionCommitted: false,
      };
    const list = match[1] === 'M' ? user.events : selectedGoogleEvents(user);
    const event = list[Number(match[2]) - 1];

    if (!event)
      return {
        reply: usageReply('Share a countdown', '/share M1|G1'),
        completionCommitted: false,
      };
    const share = await createSharedCountdown(token, event.id, completion);

    return {
      reply: {
        text: `✓ Shared read-only countdown\n${origin}/api/share?key=${share?.key}`,
      },
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/shares') {
    const user = await getUser(token);
    const shares = user?.sharedCountdowns ?? [];

    return {
      reply: htmlReply(
        shares.length
          ? [
              '<b>Shared countdowns</b>',
              '',
              ...shares.map(
                (share, index) =>
                  `${index + 1}. ${escapeTelegramHtml([...user!.events, ...user!.cachedCalEvents].find((event) => event.id === share.eventId)?.name ?? 'Removed event')}\n<code>${escapeTelegramHtml(`${origin}/api/share?key=${share.key}`)}</code>`,
              ),
              '',
              'Revoke with <code>/unshare NUMBER</code>.',
            ].join('\n')
          : '<b>No shared countdowns</b>',
      ),
      completionCommitted: false,
    };
  }

  if (command === '/unshare') {
    const user = await getUser(token);
    const index = Number(args[0]) - 1;
    const share = user?.sharedCountdowns?.[index];

    if (!share)
      return {
        reply: usageReply('Revoke a shared countdown', '/unshare NUMBER'),
        completionCommitted: false,
      };
    await revokeSharedCountdown(token, share.id, completion);

    return {
      reply: htmlReply('✓ <b>Shared countdown revoked</b>'),
      completionCommitted: Boolean(completion),
    };
  }

  if (command === '/edit') {
    if (!context) {
      return { reply: usageReply('Edit an event', '/edit'), completionCommitted: false };
    }

    const user = await getUser(token);

    if (!user?.events.length) {
      return {
        reply: htmlReply(
          '<b>No manual events</b>\nAdd one with <code>/add Event name</code>.',
        ),
        completionCommitted: false,
      };
    }

    const requestedIndex = args.length === 1 ? Number(args[0]) - 1 : undefined;

    if (
      args.length > 1 ||
      (args.length === 1 &&
        (!Number.isInteger(requestedIndex) ||
          requestedIndex! < 0 ||
          requestedIndex! >= user.events.length))
    ) {
      return {
        reply: htmlReply(
          '<b>Choose an event to edit</b>\nUse <code>/edit</code>, or <code>/edit NUMBER</code> from <code>/events</code>.',
        ),
        completionCommitted: false,
      };
    }

    if (requestedIndex !== undefined) {
      const event = user.events[requestedIndex];
      const draft = await createTelegramDraft(
        {
          token,
          userId: context.userId,
          chatId: context.chatId,
          name: event.name,
          date: event.date,
          operation: 'edit',
          step: 'review',
          original: {
            id: event.id,
            name: event.name,
            date: event.date,
            source: event.source,
            createdAt: event.createdAt,
          },
        },
        completion,
      );

      return {
        reply: draftReply(draft, origin),
        completionCommitted: Boolean(completion),
      };
    }

    const menu = await createTelegramEditMenu(
      {
        userId: context.userId,
        token,
        chatId: context.chatId,
        eventIds: user.events.map(({ id }) => id),
      },
      completion,
    );
    const buttons = user.events.map((event, index) => [
      {
        text: `${index + 1}. ${event.name} · ${event.date}`.slice(0, 64),
        callback_data: `ee:${menu.id}:${index}`,
      },
    ]);

    return {
      reply: htmlReply(
        '<b>Edit an event</b>\nChoose one to review your changes before saving.',
        { inline_keyboard: buttons },
      ),
      completionCommitted: Boolean(completion),
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
    const result = await syncGoogleEvents(token, completion);

    return {
      reply: googleSyncReply(result, origin),
      completionCommitted: Boolean(completion) && result.status !== 'not_connected',
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

function createThemeSelector(
  user: Pick<import('./userSchema').UserData, 'theme' | 'customThemes'>,
  page: 'builtins' | 'custom' = 'builtins',
): Pick<LinkedCommandResult, 'reply' | 'themeSelector'> {
  const themes =
    page === 'custom'
      ? user.customThemes.map(({ id }) => id)
      : Object.keys(BUILT_IN_THEMES);
  const label = page === 'custom' ? 'Custom themes' : 'Choose a theme';
  const navigation =
    page === 'custom'
      ? [{ text: 'Back to built-ins', callback_data: 'theme-page:builtins' }]
      : [
          {
            text: `Custom themes (${user.customThemes.length})`,
            callback_data: 'theme-page:custom',
          },
        ];

  return {
    reply: htmlReply(
      [
        `<b>${label}</b>`,
        '',
        `Current: <b>${escapeTelegramHtml(titleCase(user.theme))}</b>`,
        themes.length
          ? `Available: ${themes.map((theme) => escapeTelegramHtml(titleCase(theme))).join(' · ')}`
          : 'No custom themes saved yet.',
        '',
        page === 'custom' && !themes.length
          ? 'Create one with <code>/theme custom add</code>, or go back to the built-ins.'
          : 'Tap a button below, or use <code>/theme NAME</code>.',
      ].join('\n'),
      themeKeyboard(themes, user.theme, navigation),
    ),
    ...(themes.length
      ? {
          themeSelector: {
            themes: themes.map((id) => resolveTheme(id, user.customThemes)),
          },
        }
      : {}),
  };
}

function draftReply(draft: TelegramEventDraft, origin: string): TelegramReply {
  if (!draft.name) {
    return htmlReply('<b>Add an event</b>\nWhat should we call it?');
  }

  const prefix = `ev:${draft.id}:${draft.revision}:`;

  if (draft.date) {
    const editing = draft.operation === 'edit';

    return htmlReply(
      `<b>${editing ? 'Review changes' : 'Save this event?'}</b>\nEvent: <b>${escapeTelegramHtml(draft.name)}</b>\nDate: <b>${escapeTelegramHtml(formatTelegramEventDate(draft.date))}</b>\n${editing ? 'Nothing changes until you save.' : ''}`,
      {
        inline_keyboard: [
          [
            {
              text: editing ? 'Save changes' : 'Save event',
              callback_data: `${prefix}save`,
            },
            ...(editing ? [{ text: 'Change name', callback_data: `${prefix}name` }] : []),
          ],
          [{ text: 'Change date', callback_data: `${prefix}date` }],
          [{ text: 'Cancel', callback_data: `${prefix}cancel` }],
        ],
      },
    );
  }

  const calendarUrl = `${calendarOrigin(origin)}/api/telegram/calendar?draft=${encodeURIComponent(draft.id)}`;

  return htmlReply(
    `<b>When is ${escapeTelegramHtml(draft.name)}?</b>\nNothing is ${draft.operation === 'edit' ? 'changed' : 'saved'} until you confirm.`,
    {
      inline_keyboard: [
        [
          { text: 'Today', callback_data: `${prefix}today` },
          { text: 'Tomorrow', callback_data: `${prefix}tomorrow` },
        ],
        [
          { text: 'Next Monday', callback_data: `${prefix}monday` },
          { text: 'Choose date', web_app: { url: calendarUrl } },
        ],
        [{ text: 'Cancel', callback_data: `${prefix}cancel` }],
      ],
    },
  );
}

function calendarOrigin(fallback: string): string {
  const configured =
    process.env.PUBLIC_APP_ORIGIN ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;

  for (const candidate of [
    configured
      ? configured.startsWith('http')
        ? configured
        : `https://${configured}`
      : undefined,
    fallback,
  ]) {
    if (!candidate) {
      continue;
    }

    try {
      const url = new URL(candidate);

      if (url.protocol === 'https:' || url.hostname === 'localhost') {
        return url.origin;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Telegram Mini App origin is invalid');
}

function themeKeyboard(
  themeIds: string[],
  currentThemeId: string,
  navigation: { text: string; callback_data: string }[],
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: themeIds
      .reduce<Array<Array<{ text: string; callback_data: string }>>>(
        (rows, themeId, index) => {
          if (index % 2 === 0) {
            rows.push([]);
          }

          rows.at(-1)?.push({
            text:
              themeId === currentThemeId ? `✓ ${titleCase(themeId)}` : titleCase(themeId),
            callback_data: `theme:${themeId}`,
          });

          return rows;
        },
        [],
      )
      .concat([navigation]),
  };
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Stable G references follow the user's selection order, not cache arrival order. */
function selectedGoogleEvents(user: UserData): UserData['cachedCalEvents'] {
  const cached = new Map(user.cachedCalEvents.map((event) => [event.id, event]));

  return user.selectedEventIds.flatMap((id) => {
    const event = cached.get(id);

    return event ? [event] : [];
  });
}

function onboardingReply(origin: string, created: boolean): TelegramReply {
  return htmlReply(
    [
      created ? '✓ <b>Your wallpaper is ready to shape</b>' : '<b>Welcome back</b>',
      created
        ? 'Start with a live preview, then add one important date or connect Google Calendar.'
        : 'Open your control panel to preview or change the wallpaper.',
    ].join('\n'),
    {
      inline_keyboard: [
        [
          {
            text: 'Open Calendar Lockscreen',
            web_app: { url: `${calendarOrigin(origin)}/api/telegram/app` },
          },
        ],
      ],
    },
  );
}

function googleSyncReply(result: GoogleSyncResult, origin: string): TelegramReply {
  const appUrl = `${calendarOrigin(origin)}/api/telegram/app`;
  const button = (text: string): TelegramInlineKeyboardMarkup => ({
    inline_keyboard: [[{ text, web_app: { url: appUrl } }]],
  });

  if (result.status === 'not_connected') {
    return htmlReply(
      [
        '<b>Google Calendar is not connected</b>',
        'Connect it from the control panel, then sync again.',
      ].join('\n'),
      button('Connect Google Calendar'),
    );
  }

  if (result.status === 'no_calendars') {
    return htmlReply(
      [
        '<b>No visible Google calendars found</b>',
        'Show at least one calendar in Google Calendar, or reconnect the account.',
      ].join('\n'),
      button('Open control panel'),
    );
  }

  if (result.status === 'empty_window') {
    return htmlReply(
      [
        '✓ <b>Google Calendar checked</b>',
        `No upcoming events from <b>${escapeTelegramHtml(result.windowStart)}</b> to <b>${escapeTelegramHtml(result.windowEnd)}</b>.`,
        `${result.calendarCount} visible calendar${result.calendarCount === 1 ? '' : 's'} checked.`,
      ].join('\n'),
      button('Open control panel'),
    );
  }

  if (result.status === 'needs_selection') {
    return htmlReply(
      [
        '✓ <b>Google Calendar synced</b>',
        `${result.fetchedEventCount} upcoming event${result.fetchedEventCount === 1 ? '' : 's'} found across ${result.calendarCount} calendar${result.calendarCount === 1 ? '' : 's'}.`,
        'Choose which events should appear on your wallpaper.',
      ].join('\n'),
      button('Choose events'),
    );
  }

  const upcoming = result.upcomingTrackedEvents.map(
    ({ date, name }) =>
      `• <b>${escapeTelegramHtml(formatTelegramEventDate(date))}</b> · ${escapeTelegramHtml(name)}`,
  );

  return htmlReply(
    [
      '✓ <b>Google Calendar synced</b>',
      `${result.fetchedEventCount} found · ${result.trackedEventCount} tracked`,
      ...(upcoming.length ? ['', '<b>Next on your wallpaper</b>', ...upcoming] : []),
      '',
      WALLPAPER_REFRESH_NOTE,
    ].join('\n'),
    button('Open control panel'),
  );
}

function helpText(): string {
  return [
    '<b>Calendar Lockscreen</b>',
    '',
    '<b>Wallpaper</b>',
    '<code>/app</code>  Open the visual control panel',
    '<code>/status</code>  Current setup',
    '<code>/url</code>  Copy wallpaper URL',
    '',
    '<b>Events</b>',
    '<code>/add Event name</code>  Guided date picker',
    '<code>/add Dentist tomorrow</code>  Natural dates work too',
    '<code>/events</code>',
    '<code>/today</code> or <code>/week</code>  Upcoming tracked events',
    '<code>/focus M1|G1|off</code>  Pin or clear a countdown event',
    '<code>/repeat M1 off|weekly|monthly|yearly</code>',
    '<code>/category M1|G1 general|work|personal|health|travel</code>',
    '<code>/edit</code> or <code>/edit NUMBER</code>  Review an event before saving',
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
    '<code>/living none|snow|rain|stars|haze|sunset|seasonal</code>  Static visual overlay, never live weather',
    '<code>/rings single|double|halo</code>',
    '<code>/studio</code>  Pick and preview a mood, or use <code>/studio color #RRGGBB name</code>',
    '<code>/autoprofile status|on|off|save day|evening|night</code>',
    '<code>/share M1|G1</code> · <code>/shares</code> · <code>/unshare NUMBER</code>',
    '',
    '<b>Calendar</b>',
    '<code>/sync</code>  Refresh Google events',
  ].join('\n');
}

function studioReply(draft: TelegramStudioDraft): TelegramReply {
  const prefix = `studio:${draft.id}:${draft.revision}:`;

  return htmlReply(
    `<b>Preview studio theme</b>\n${escapeTelegramHtml(draft.theme.id)}\nSave this palette?`,
    {
      inline_keyboard: [
        [
          { text: 'Save theme', callback_data: `${prefix}save` },
          { text: 'Cancel', callback_data: `${prefix}cancel` },
        ],
      ],
    },
  );
}

function studioMoodPickerReply(): TelegramReply {
  const button = (label: string, mood: StudioMood) => ({
    text: label,
    callback_data: `studio-mood:${mood}`,
  });

  return htmlReply(
    [
      '<b>Theme Studio</b>',
      'Choose a mood to see its actual palette before saving.',
      'Each mood also chooses a matching static living effect.',
    ].join('\n'),
    {
      inline_keyboard: [
        [button('Calm', 'calm'), button('Warm', 'warm')],
        [button('Focus', 'focus'), button('Night', 'night')],
        [button('Fresh', 'fresh')],
      ],
    },
  );
}

function autoProfileText(profiles: import('./userSchema').AutomaticProfiles): string {
  return [
    '<b>Automatic profiles</b>',
    `Status: <b>${profiles.enabled ? 'on' : 'off'}</b>`,
    ...(['day', 'evening', 'night'] as const).map((name) => {
      const slot = profiles[name];

      const ranges = { day: '06:00–18:00', evening: '18:00–22:00', night: '22:00–06:00' };

      return `${name}: ${slot.enabled ? 'on' : 'off'} · ${ranges[name]} · ${escapeTelegramHtml(slot.theme ?? 'current theme')}`;
    }),
  ].join('\n');
}

function localDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
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
      'Send <code>/start</code> to create or reconnect your wallpaper.',
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

  if (message === 'Event is not upcoming') {
    return htmlReply(
      '<b>Countdown already passed</b>\nChoose a current or future event to share.',
    );
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
        'Reconnect your Google account from the control panel, then try again.',
      ].join('\n'),
    );
  }

  if (
    message === 'Unable to list Google calendars' ||
    message === 'Unable to sync Google Calendar' ||
    message === 'Too many visible Google calendars' ||
    message === 'Google Calendar returned too many calendar pages' ||
    message === 'Google Calendar returned too many event pages'
  ) {
    return htmlReply(
      [
        '<b>Google Calendar could not finish syncing</b>',
        'Check which calendars are visible in Google Calendar, then try <code>/sync</code> again.',
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
