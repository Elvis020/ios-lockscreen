import { getRedis } from './redis';
import { commitIfLeasesOwned, withRedisLocks, type RedisFencedSet } from './redisLock';
import type { MutationCompletion } from './tokenManager';
import { isReservedThemeId, MAX_CUSTOM_THEMES, type WallpaperTheme } from './preferences';
import { normalizeUserData, type LivingOverlay } from './userSchema';

export interface TelegramStudioDraft {
  id: string;
  revision: string;
  token: string;
  userId: string;
  chatId: string;
  theme: WallpaperTheme;
  livingOverlay: LivingOverlay;
  expiresAt: number;
}

const TTL = 15 * 60;
const key = (userId: string) => `telegram:studio:${userId}`;
const doneKey = (draft: TelegramStudioDraft) =>
  `telegram:studio:done:${draft.id}:${draft.revision}`;

export async function createStudioDraft(
  input: Omit<TelegramStudioDraft, 'id' | 'revision' | 'expiresAt'>,
  completion?: MutationCompletion,
): Promise<TelegramStudioDraft> {
  const draft: TelegramStudioDraft = {
    ...input,
    id: crypto.randomUUID().replaceAll('-', '').slice(0, 16),
    revision: crypto.randomUUID().replaceAll('-', '').slice(0, 10),
    expiresAt: Date.now() + TTL * 1000,
  };
  const redis = getRedis();

  await withRedisLocks(
    redis,
    [`user:${input.token}`, key(input.userId)],
    async (leases) => {
      const user = normalizeUserData(await redis.get(`user:${input.token}`), input.token);

      if (
        !user ||
        user.telegram?.userId !== input.userId ||
        user.telegram.chatId !== input.chatId
      ) {
        throw new Error('Linked account no longer exists');
      }

      await commitIfLeasesOwned(redis, leases, [
        { key: key(input.userId), value: draft, ttlSeconds: TTL },
        ...(completion
          ? [{ key: completion.key, value: 'done', ttlSeconds: completion.ttlSeconds }]
          : []),
      ]);
    },
  );

  return draft;
}

export async function getStudioDraft(
  userId: string,
): Promise<TelegramStudioDraft | null> {
  const draft = await getRedis().get<TelegramStudioDraft>(key(userId));

  return draft && draft.expiresAt > Date.now() ? draft : null;
}

/** Commits the user mutation, draft removal, studio marker and webhook marker together. */
export async function finalizeStudioDraft(
  draft: TelegramStudioDraft,
  action: 'save' | 'cancel',
  completion?: MutationCompletion,
): Promise<'save' | 'cancel' | 'stale'> {
  const redis = getRedis();

  return withRedisLocks(
    redis,
    [`user:${draft.token}`, key(draft.userId)],
    async (leases) => {
      const completionSet = completion
        ? [{ key: completion.key, value: 'done', ttlSeconds: completion.ttlSeconds }]
        : [];

      const completed = await redis.get<{
        action: 'save' | 'cancel';
        userId: string;
        chatId: string;
      }>(doneKey(draft));

      if (
        completed &&
        completed.userId === draft.userId &&
        completed.chatId === draft.chatId
      ) {
        if (completionSet.length) await commitIfLeasesOwned(redis, leases, completionSet);

        return completed.action;
      }
      const active = await getStudioDraft(draft.userId);
      const user = normalizeUserData(await redis.get(`user:${draft.token}`), draft.token);

      if (
        !active ||
        active.id !== draft.id ||
        active.revision !== draft.revision ||
        active.token !== draft.token ||
        active.chatId !== draft.chatId ||
        user?.telegram?.userId !== draft.userId ||
        user.telegram.chatId !== draft.chatId
      )
        return 'stale';

      const sets: RedisFencedSet[] = [
        {
          key: doneKey(draft),
          value: { action, userId: draft.userId, chatId: draft.chatId },
          ttlSeconds: 86_400,
        },
        ...completionSet,
      ];

      if (action === 'save') {
        if (isReservedThemeId(draft.theme.id))
          throw new Error('Built-in theme names are reserved');
        const existing = user.customThemes.findIndex(({ id }) => id === draft.theme.id);

        if (existing >= 0) user.customThemes[existing] = draft.theme;
        else {
          if (user.customThemes.length >= MAX_CUSTOM_THEMES)
            throw new Error(`Maximum ${MAX_CUSTOM_THEMES} custom themes allowed`);
          user.customThemes.push(draft.theme);
        }
        user.theme = draft.theme.id;
        user.livingOverlay = draft.livingOverlay;
        const wallpaperKey = user.wallpaperKey ?? crypto.randomUUID();

        user.wallpaperKey = wallpaperKey;
        sets.push(
          { key: `user:${draft.token}`, value: user },
          { key: `wallpaper:${wallpaperKey}`, value: draft.token },
        );
      }
      await commitIfLeasesOwned(redis, leases, sets, [key(draft.userId)]);

      return action;
    },
  );
}

export async function getStudioOutcome(
  userId: string,
  chatId: string,
  id: string,
  revision: string,
): Promise<'save' | 'cancel' | null> {
  const completed = await getRedis().get<{
    action: 'save' | 'cancel';
    userId: string;
    chatId: string;
  }>(`telegram:studio:done:${id}:${revision}`);

  return completed?.userId === userId && completed.chatId === chatId
    ? completed.action
    : null;
}
