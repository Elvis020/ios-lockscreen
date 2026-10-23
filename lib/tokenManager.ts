import {
  MAX_CUSTOM_THEMES,
  listAvailableThemeIds,
  type WallpaperTheme,
} from './preferences';
import { getRedis } from './redis';
import {
  commitIfLeasesOwned,
  withRedisLock,
  withRedisLocks,
  type RedisFencedSet,
} from './redisLock';
import {
  normalizeUserData,
  type CalendarEvent,
  type GoogleAccount,
  type ManualEvent,
  type TelegramLink,
  type UserData,
} from './userSchema';

export type { CalendarEvent, GoogleAccount, ManualEvent, UserData } from './userSchema';

export interface InviteCode {
  code: string;
  maxUses: number;
  usedBy: string[];
  createdAt: string;
}

export interface MutationCompletion {
  key: string;
  ttlSeconds: number;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

export async function createUser(
  inviteCode: string,
  name: string,
  timeZone = 'UTC',
): Promise<{ token: string; wallpaperKey: string } | { error: string }> {
  const redis = getRedis();

  return withRedisLock(redis, `invite:${inviteCode}`, async (lease) => {
    const invite = await redis.get<InviteCode>(`invite:${inviteCode}`);

    if (!invite) {
      return { error: 'Invalid invite code' };
    }

    if (invite.usedBy.length >= invite.maxUses) {
      return { error: 'Invite code has reached maximum uses' };
    }

    const token = generateUUID();
    const wallpaperKey = generateUUID();
    const userData: UserData = {
      schemaVersion: 2,
      token,
      wallpaperKey,
      name: name.trim(),
      theme: 'default',
      viewMode: 'quarter',
      timeZone,
      customThemes: [],
      events: [],
      googleAccounts: [],
      selectedEventIds: [],
      cachedCalEvents: [],
      cachedCalAt: 0,
    };

    invite.usedBy.push(token);

    await commitIfLeasesOwned(
      redis,
      [lease],
      [
        { key: `user:${token}`, value: userData },
        { key: `wallpaper:${wallpaperKey}`, value: token },
        { key: `invite:${inviteCode}`, value: invite },
      ],
    );

    return { token, wallpaperKey };
  });
}

export async function getUser(token: string): Promise<UserData | null> {
  return readUser(getRedis(), token);
}

export async function getUserByWallpaperKey(
  wallpaperKey: string,
): Promise<UserData | null> {
  const token = await getRedis().get<string>(`wallpaper:${wallpaperKey}`);

  return token ? getUser(token) : null;
}

export async function ensureWallpaperKey(
  token: string,
): Promise<{ user: UserData; wallpaperKey: string } | null> {
  const redis = getRedis();

  return withRedisLock(redis, `user:${token}`, async (lease) => {
    const user = await readUser(redis, token);

    if (!user) {
      return null;
    }

    const wallpaperKey = user.wallpaperKey ?? generateUUID();

    user.wallpaperKey = wallpaperKey;

    await commitIfLeasesOwned(
      redis,
      [lease],
      [
        { key: `user:${token}`, value: user },
        { key: `wallpaper:${wallpaperKey}`, value: token },
      ],
    );

    return { user, wallpaperKey };
  });
}

export async function addManualEvent(
  token: string,
  event: Pick<ManualEvent, 'name' | 'date'>,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (user.events.length + user.selectedEventIds.length >= 7) {
        throw new Error('Maximum 7 tracked events allowed');
      }

      user.events.push({
        ...event,
        id: generateUUID(),
        source: 'manual',
        createdAt: new Date().toISOString(),
      });
    },
    completion,
  );
}

export async function replaceManualEvents(
  token: string,
  events: Array<Pick<ManualEvent, 'name' | 'date'>>,
): Promise<UserData | null> {
  return mutateUser(token, (user) => {
    if (events.length + user.selectedEventIds.length > 7) {
      throw new Error('Maximum 7 tracked events allowed');
    }

    user.events = events.map((event) => ({
      ...event,
      id: generateUUID(),
      source: 'manual',
      createdAt: new Date().toISOString(),
    }));
  });
}

export async function deleteManualEvent(
  token: string,
  eventId: string,
): Promise<UserData | null> {
  return mutateUser(token, (user) => {
    const originalLength = user.events.length;

    user.events = user.events.filter(({ id }) => id !== eventId);

    if (user.events.length === originalLength) {
      throw new Error('Event not found');
    }
  });
}

export async function deleteManualEventAtIndex(
  token: string,
  index: number,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (!Number.isInteger(index) || index < 0 || index >= user.events.length) {
        throw new Error('Event not found');
      }

      user.events.splice(index, 1);
    },
    completion,
  );
}

export async function updatePreferences(
  token: string,
  preferences: Partial<Pick<UserData, 'theme' | 'viewMode' | 'timeZone'>>,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (preferences.theme) {
        if (!listAvailableThemeIds(user.customThemes).includes(preferences.theme)) {
          throw new Error('Unknown theme');
        }

        user.theme = preferences.theme;
      }

      if (preferences.viewMode) {
        user.viewMode = preferences.viewMode;
      }

      if (preferences.timeZone) {
        user.timeZone = preferences.timeZone;
      }
    },
    completion,
  );
}

export async function addCustomTheme(
  token: string,
  theme: WallpaperTheme,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (listAvailableThemeIds().includes(theme.id)) {
        throw new Error('Built-in theme names are reserved');
      }

      const existingIndex = user.customThemes.findIndex(({ id }) => id === theme.id);

      if (existingIndex >= 0) {
        user.customThemes[existingIndex] = theme;

        return;
      }

      if (user.customThemes.length >= MAX_CUSTOM_THEMES) {
        throw new Error(`Maximum ${MAX_CUSTOM_THEMES} custom themes allowed`);
      }

      user.customThemes.push(theme);
    },
    completion,
  );
}

export async function deleteCustomTheme(
  token: string,
  themeId: string,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      user.customThemes = user.customThemes.filter(({ id }) => id !== themeId);

      if (user.theme === themeId) {
        user.theme = 'default';
      }
    },
    completion,
  );
}

export async function linkTelegramIdentity(
  token: string,
  telegram: TelegramLink & { userId: string },
  completion?: MutationCompletion,
  linkCodeKey?: string,
): Promise<UserData | null> {
  const redis = getRedis();

  return withRedisLock(redis, 'telegram:links', async (telegramLease) => {
    if (completion && (await redis.get(completion.key))) {
      return readUser(redis, token);
    }

    if (linkCodeKey && (await redis.get<string>(linkCodeKey)) !== token) {
      throw new Error('Link code is invalid or expired');
    }

    const linkedToken = await redis.get<string>(`telegram:user:${telegram.userId}`);
    const resources = [`user:${token}`];

    if (linkedToken && linkedToken !== token) {
      resources.push(`user:${linkedToken}`);
    }

    return withRedisLocks(redis, resources, async (userLeases) => {
      const user = await readUser(redis, token);

      if (!user) {
        return null;
      }

      const previouslyLinkedUser =
        linkedToken && linkedToken !== token ? await readUser(redis, linkedToken) : null;
      const previousIdentity = user.telegram?.userId ?? user.telegram?.chatId;
      const previousChatId = user.telegram?.chatId;
      const sets: RedisFencedSet[] = [];
      const deletes: string[] = [];

      if (
        previouslyLinkedUser?.telegram &&
        (previouslyLinkedUser.telegram.userId === telegram.userId ||
          previouslyLinkedUser.telegram.chatId === telegram.userId)
      ) {
        delete previouslyLinkedUser.telegram;
        sets.push({
          key: `user:${previouslyLinkedUser.token}`,
          value: previouslyLinkedUser,
        });
      }

      if (previousIdentity && previousIdentity !== telegram.userId) {
        const previousMapping = await redis.get<string>(
          `telegram:user:${previousIdentity}`,
        );

        if (previousMapping === token) {
          deletes.push(`telegram:user:${previousIdentity}`);
        }
      }

      if (previousChatId) {
        const legacyMapping = await redis.get<string>(`telegram:chat:${previousChatId}`);

        if (legacyMapping === token) {
          deletes.push(`telegram:chat:${previousChatId}`);
        }
      }

      user.telegram = telegram;

      sets.push(
        { key: `user:${token}`, value: user },
        { key: `telegram:user:${telegram.userId}`, value: token },
      );

      if (linkCodeKey) {
        deletes.push(linkCodeKey);
      }

      if (completion) {
        sets.push({
          key: completion.key,
          value: 'done',
          ttlSeconds: completion.ttlSeconds,
        });
      }

      await commitIfLeasesOwned(redis, [telegramLease, ...userLeases], sets, deletes);

      return user;
    });
  });
}

export async function addGoogleAccount(
  token: string,
  account: GoogleAccount,
): Promise<UserData | null> {
  return mutateUser(token, (user) => {
    const existingIndex = user.googleAccounts.findIndex(
      ({ email }) => email === account.email,
    );

    if (existingIndex >= 0) {
      user.googleAccounts[existingIndex] = {
        ...account,
        id: user.googleAccounts[existingIndex].id,
      };

      return;
    }

    if (user.googleAccounts.length >= 2) {
      throw new Error('Maximum 2 Google accounts allowed');
    }

    user.googleAccounts.push(account);
  });
}

export async function removeGoogleAccount(
  token: string,
  accountId: string,
): Promise<UserData | null> {
  return mutateUser(token, (user) => {
    const account = user.googleAccounts.find(({ id }) => id === accountId);

    user.googleAccounts = user.googleAccounts.filter(({ id }) => id !== accountId);

    if (account) {
      const removedIds = new Set(
        user.cachedCalEvents
          .filter(({ accountEmail }) => accountEmail === account.email)
          .map(({ id }) => id),
      );

      user.cachedCalEvents = user.cachedCalEvents.filter(
        ({ accountEmail }) => accountEmail !== account.email,
      );
      user.selectedEventIds = user.selectedEventIds.filter((id) => !removedIds.has(id));
    }
  });
}

export async function updateCachedCalEvents(
  token: string,
  events: CalendarEvent[],
  expectedGoogleAccountRevision: string,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (googleAccountRevision(user.googleAccounts) !== expectedGoogleAccountRevision) {
        throw new Error('Google accounts changed during sync; please retry');
      }

      const accountEmails = new Set(user.googleAccounts.map(({ email }) => email));
      const availableEvents = events.filter(({ accountEmail }) =>
        accountEmails.has(accountEmail),
      );

      user.cachedCalEvents = availableEvents;
      user.cachedCalAt = Date.now();
      const availableIds = new Set(availableEvents.map(({ id }) => id));

      user.selectedEventIds = user.selectedEventIds.filter((id) => availableIds.has(id));
    },
    completion,
  );
}

export function googleAccountRevision(accounts: GoogleAccount[]): string {
  return JSON.stringify(
    accounts
      .map(({ id, encryptedRefreshToken }) => [id, encryptedRefreshToken ?? ''])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export async function updateSelectedEvents(
  token: string,
  eventIds: string[],
): Promise<UserData | null> {
  return mutateUser(token, (user) => {
    const availableIds = new Set(user.cachedCalEvents.map(({ id }) => id));

    if (eventIds.some((id) => !availableIds.has(id))) {
      throw new Error('One or more calendar events are unavailable');
    }

    if (user.events.length + eventIds.length > 7) {
      throw new Error('Maximum 7 tracked events allowed');
    }

    user.selectedEventIds = [...new Set(eventIds)];
  });
}

export async function createInviteCode(code: string, maxUses = 10): Promise<void> {
  const invite: InviteCode = {
    code,
    maxUses,
    usedBy: [],
    createdAt: new Date().toISOString(),
  };

  await getRedis().set(`invite:${code}`, invite);
}

async function mutateUser(
  token: string,
  mutation: (user: UserData) => void,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  const redis = getRedis();

  return withRedisLock(redis, `user:${token}`, async (lease) => {
    const user = await readUser(redis, token);

    if (!user) {
      return null;
    }

    if (completion && (await redis.get(completion.key))) {
      return user;
    }

    const wallpaperKey = user.wallpaperKey ?? generateUUID();

    user.wallpaperKey = wallpaperKey;
    mutation(user);

    const sets: RedisFencedSet[] = [
      { key: `user:${token}`, value: user },
      { key: `wallpaper:${wallpaperKey}`, value: token },
    ];

    if (completion) {
      sets.push({
        key: completion.key,
        value: 'done',
        ttlSeconds: completion.ttlSeconds,
      });
    }

    await commitIfLeasesOwned(redis, [lease], sets);

    return user;
  });
}

async function readUser(
  redis: ReturnType<typeof getRedis>,
  token: string,
): Promise<UserData | null> {
  const raw = await redis.get<unknown>(`user:${token}`);

  return normalizeUserData(raw, token);
}
