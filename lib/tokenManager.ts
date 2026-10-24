import {
  MAX_CUSTOM_THEMES,
  DEFAULT_EVENT_COUNT,
  isEventCount,
  isReservedThemeId,
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
  type EventCategory,
  type EventRecurrence,
  type SharedCountdown,
  type TelegramLink,
  type UserData,
} from './userSchema';
import {
  draftKey,
  normalizeTelegramDraft,
  type TelegramEventDraft,
} from './telegramDrafts';
import { nextOccurrenceOnOrAfter } from './eventTimeline';

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
      schemaVersion: 5,
      token,
      wallpaperKey,
      name: name.trim(),
      theme: 'default',
      timeRange: 'month',
      presentation: 'hybrid',
      lockScreenProfile: 'standard',
      eventCount: DEFAULT_EVENT_COUNT,
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
  event: Pick<ManualEvent, 'name' | 'date'> &
    Partial<Pick<ManualEvent, 'category' | 'recurrence'>>,
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
        category: event.category ?? 'general',
        recurrence: event.recurrence ?? 'none',
      });
    },
    completion,
  );
}

export async function saveTelegramDraftEvent(
  token: string,
  draft: Pick<TelegramEventDraft, 'id' | 'revision' | 'userId' | 'name' | 'date'>,
  completion?: MutationCompletion,
): Promise<'saved' | 'already-saved' | 'stale' | 'limit'> {
  const redis = getRedis();
  const saveKey = `telegram:draft:completion:${draft.id}:${draft.revision}`;

  return withRedisLocks(
    redis,
    [`user:${token}`, draftKey(draft.userId)],
    async (leases) => {
      if (await redis.get(saveKey)) {
        if (completion) {
          await commitIfLeasesOwned(redis, leases, [
            {
              key: completion.key,
              value: 'done',
              ttlSeconds: completion.ttlSeconds,
            },
          ]);
        }

        return 'already-saved';
      }

      const stored = await redis.get<TelegramEventDraft>(draftKey(draft.userId));
      const active = stored ? normalizeTelegramDraft(stored) : null;

      if (
        !active ||
        active.id !== draft.id ||
        active.revision !== draft.revision ||
        active.userId !== draft.userId ||
        active.token !== token ||
        active.step !== 'review' ||
        typeof active.expiresAt !== 'number' ||
        active.expiresAt <= Date.now() ||
        !active.date
      ) {
        return 'stale';
      }

      const user = await readUser(redis, token);

      if (!user) {
        throw new Error('Linked account no longer exists');
      }

      if (
        user.telegram?.userId !== active.userId ||
        user.telegram.chatId !== active.chatId
      ) {
        return 'stale';
      }

      if (user.events.length + user.selectedEventIds.length >= 7) {
        return 'limit';
      }

      user.events.push({
        id: generateUUID(),
        name: active.name,
        date: active.date,
        source: 'manual',
        createdAt: new Date().toISOString(),
        category: 'general',
        recurrence: 'none',
      });

      const wallpaperKey = user.wallpaperKey ?? generateUUID();

      user.wallpaperKey = wallpaperKey;
      const sets: RedisFencedSet[] = [
        { key: `user:${token}`, value: user },
        { key: `wallpaper:${wallpaperKey}`, value: token },
        { key: saveKey, value: 'done', ttlSeconds: 86_400 },
      ];

      if (completion) {
        sets.push({
          key: completion.key,
          value: 'done',
          ttlSeconds: completion.ttlSeconds,
        });
      }

      await commitIfLeasesOwned(redis, leases, sets, [draftKey(draft.userId)]);

      return 'saved';
    },
  );
}

export async function saveTelegramEditDraft(
  token: string,
  draft: Pick<
    TelegramEventDraft,
    'id' | 'revision' | 'userId' | 'name' | 'date' | 'original'
  >,
  completion?: MutationCompletion,
): Promise<'saved' | 'already-saved' | 'stale' | 'conflict'> {
  const redis = getRedis();
  const saveKey = `telegram:draft:completion:${draft.id}:${draft.revision}`;

  return withRedisLocks(
    redis,
    [`user:${token}`, draftKey(draft.userId)],
    async (leases) => {
      if (await redis.get(saveKey)) {
        if (completion) {
          await commitIfLeasesOwned(redis, leases, [
            { key: completion.key, value: 'done', ttlSeconds: completion.ttlSeconds },
          ]);
        }

        return 'already-saved';
      }

      const stored = await redis.get<TelegramEventDraft>(draftKey(draft.userId));
      const active = stored ? normalizeTelegramDraft(stored) : null;

      if (
        !active ||
        active.id !== draft.id ||
        active.revision !== draft.revision ||
        active.userId !== draft.userId ||
        active.token !== token ||
        active.operation !== 'edit' ||
        active.step !== 'review' ||
        !active.original ||
        !active.date ||
        active.expiresAt <= Date.now()
      ) {
        return 'stale';
      }

      const original = active.original;

      const user = await readUser(redis, token);

      if (
        !user ||
        user.telegram?.userId !== active.userId ||
        user.telegram.chatId !== active.chatId
      ) {
        return 'stale';
      }

      const eventIndex = user.events.findIndex(({ id }) => id === original.id);
      const current = user.events[eventIndex];

      if (
        !current ||
        current.name !== original.name ||
        current.date !== original.date ||
        current.source !== original.source ||
        current.createdAt !== original.createdAt
      ) {
        const sets: RedisFencedSet[] = [];

        if (completion) {
          sets.push({
            key: completion.key,
            value: 'done',
            ttlSeconds: completion.ttlSeconds,
          });
        }

        await commitIfLeasesOwned(redis, leases, sets, [draftKey(draft.userId)]);

        return 'conflict';
      }

      user.events[eventIndex] = { ...current, name: active.name, date: active.date };
      const wallpaperKey = user.wallpaperKey ?? generateUUID();

      user.wallpaperKey = wallpaperKey;
      const sets: RedisFencedSet[] = [
        { key: `user:${token}`, value: user },
        { key: `wallpaper:${wallpaperKey}`, value: token },
        { key: saveKey, value: 'done', ttlSeconds: 86_400 },
      ];

      if (completion) {
        sets.push({
          key: completion.key,
          value: 'done',
          ttlSeconds: completion.ttlSeconds,
        });
      }

      await commitIfLeasesOwned(redis, leases, sets, [draftKey(draft.userId)]);

      return 'saved';
    },
  );
}

export async function replaceManualEvents(
  token: string,
  events: Array<
    Pick<ManualEvent, 'name' | 'date'> &
      Partial<Pick<ManualEvent, 'category' | 'recurrence'>>
  >,
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
      category: event.category ?? 'general',
      recurrence: event.recurrence ?? 'none',
    }));

    return pruneEventMetadata(user);
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

    return pruneEventMetadata(user);
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

      return pruneEventMetadata(user);
    },
    completion,
  );
}

export async function updatePreferences(
  token: string,
  preferences: Partial<
    Pick<
      UserData,
      | 'theme'
      | 'timeRange'
      | 'presentation'
      | 'lockScreenProfile'
      | 'timeZone'
      | 'eventCount'
      | 'focusEventId'
      | 'livingOverlay'
      | 'milestoneRingStyle'
      | 'automaticProfiles'
    >
  >,
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

      if (preferences.timeRange) {
        user.timeRange = preferences.timeRange;
      }

      if (preferences.presentation) {
        user.presentation = preferences.presentation;
      }

      if (preferences.lockScreenProfile) {
        user.lockScreenProfile = preferences.lockScreenProfile;
      }

      if (preferences.timeZone) {
        user.timeZone = preferences.timeZone;
      }

      if (preferences.eventCount !== undefined) {
        if (!isEventCount(preferences.eventCount)) {
          throw new Error('Event count must be a whole number from 1 to 5');
        }

        user.eventCount = preferences.eventCount;
      }

      if (preferences.focusEventId !== undefined) {
        if (
          ![...user.events.map(({ id }) => id), ...user.selectedEventIds].includes(
            preferences.focusEventId,
          )
        ) {
          throw new Error('Focus event is unavailable');
        }

        user.focusEventId = preferences.focusEventId;
      }

      if (preferences.livingOverlay !== undefined)
        user.livingOverlay = preferences.livingOverlay;
      if (preferences.milestoneRingStyle !== undefined)
        user.milestoneRingStyle = preferences.milestoneRingStyle;
      if (preferences.automaticProfiles !== undefined)
        user.automaticProfiles = preferences.automaticProfiles;
    },
    completion,
  );
}

export async function setManualEventRecurrence(
  token: string,
  eventId: string,
  recurrence: EventRecurrence,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      const event = user.events.find(({ id }) => id === eventId);

      if (!event) throw new Error('Event not found');
      event.recurrence = recurrence;
    },
    completion,
  );
}

export async function setEventCategory(
  token: string,
  eventId: string,
  category: EventCategory,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      const manual = user.events.find(({ id }) => id === eventId);

      if (manual) {
        manual.category = category;

        return;
      }
      if (!user.selectedEventIds.includes(eventId))
        throw new Error('Event is unavailable');
      user.googleCategoryOverrides = {
        ...(user.googleCategoryOverrides ?? {}),
        [eventId]: category,
      };
    },
    completion,
  );
}

export async function setFocusEvent(
  token: string,
  eventId?: string,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (
        eventId &&
        ![...user.events.map(({ id }) => id), ...user.selectedEventIds].includes(eventId)
      ) {
        throw new Error('Focus event is unavailable');
      }
      user.focusEventId = eventId;
    },
    completion,
  );
}

export async function createSharedCountdown(
  token: string,
  eventId: string,
  completion?: MutationCompletion,
): Promise<SharedCountdown | null> {
  const redis = getRedis();

  return withRedisLock(redis, `user:${token}`, async (lease) => {
    const user = await readUser(redis, token);

    if (!user) return null;
    if (completion && (await redis.get(completion.key))) {
      return user.sharedCountdowns?.find(({ eventId: id }) => id === eventId) ?? null;
    }
    const manual = user.events.find(({ id }) => id === eventId);
    const google = user.cachedCalEvents.find(({ id }) => id === eventId);

    if (!manual && !google) throw new Error('Event not found');
    if (!manual && !user.selectedEventIds.includes(eventId))
      throw new Error('Event is unavailable');
    const today = currentCivilDate(user.timeZone);
    const nextDate = manual ? nextOccurrenceOnOrAfter(manual, today) : google!.date;

    if (!nextDate || nextDate < today) throw new Error('Event is not upcoming');
    const existing = user.sharedCountdowns?.find(({ eventId: id }) => id === eventId);

    if (existing) {
      if (completion) {
        await commitIfLeasesOwned(
          redis,
          [lease],
          [{ key: completion.key, value: 'done', ttlSeconds: completion.ttlSeconds }],
        );
      }

      return existing;
    }
    if ((user.sharedCountdowns ?? []).length >= 5)
      throw new Error('Maximum 5 shared countdowns allowed');
    const share: SharedCountdown = {
      id: generateUUID(),
      eventId,
      key: generateUUID(),
      createdAt: new Date().toISOString(),
    };

    user.sharedCountdowns = [...(user.sharedCountdowns ?? []), share];
    const wallpaperKey = user.wallpaperKey ?? generateUUID();

    user.wallpaperKey = wallpaperKey;
    await commitIfLeasesOwned(
      redis,
      [lease],
      [
        { key: `user:${token}`, value: user },
        { key: `wallpaper:${wallpaperKey}`, value: token },
        { key: `share:${share.key}`, value: { token, shareId: share.id } },
        ...(completion
          ? [{ key: completion.key, value: 'done', ttlSeconds: completion.ttlSeconds }]
          : []),
      ],
    );

    return share;
  });
}

function currentCivilDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function revokeSharedCountdown(
  token: string,
  id: string,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  const redis = getRedis();

  return withRedisLock(redis, `user:${token}`, async (lease) => {
    const user = await readUser(redis, token);

    if (!user) return null;
    if (completion && (await redis.get(completion.key))) return user;
    const share = user.sharedCountdowns?.find((candidate) => candidate.id === id);

    if (!share) throw new Error('Shared countdown not found');
    user.sharedCountdowns = user.sharedCountdowns?.filter(
      (candidate) => candidate.id !== id,
    );
    await commitIfLeasesOwned(
      redis,
      [lease],
      [
        { key: `user:${token}`, value: user },
        ...(completion
          ? [{ key: completion.key, value: 'done', ttlSeconds: completion.ttlSeconds }]
          : []),
      ],
      [`share:${share.key}`],
    );

    return user;
  });
}

export async function addCustomTheme(
  token: string,
  theme: WallpaperTheme,
  completion?: MutationCompletion,
): Promise<UserData | null> {
  return mutateUser(
    token,
    (user) => {
      if (isReservedThemeId(theme.id)) {
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

      if (user.automaticProfiles) {
        (['day', 'evening', 'night'] as const).forEach((slot) => {
          if (user.automaticProfiles?.[slot].theme === themeId) {
            user.automaticProfiles[slot].theme = undefined;
          }
        });
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

      return pruneEventMetadata(user);
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

      return pruneEventMetadata(user);
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

    return pruneEventMetadata(user);
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
  mutation: (user: UserData) => void | string[],
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
    const deletes = mutation(user) ?? [];

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

    await commitIfLeasesOwned(redis, [lease], sets, deletes);

    return user;
  });
}

/** Removes metadata that could otherwise point at deleted/deselected events. */
function pruneEventMetadata(user: UserData): string[] {
  const validIds = new Set([
    ...user.events.map(({ id }) => id),
    ...user.selectedEventIds,
  ]);

  if (user.focusEventId && !validIds.has(user.focusEventId)) delete user.focusEventId;
  user.googleCategoryOverrides = Object.fromEntries(
    Object.entries(user.googleCategoryOverrides ?? {}).filter(([id]) => validIds.has(id)),
  );
  const staleShares = (user.sharedCountdowns ?? []).filter(
    ({ eventId }) => !validIds.has(eventId),
  );

  user.sharedCountdowns = (user.sharedCountdowns ?? []).filter(({ eventId }) =>
    validIds.has(eventId),
  );

  return staleShares.map(({ key }) => `share:${key}`);
}

async function readUser(
  redis: ReturnType<typeof getRedis>,
  token: string,
): Promise<UserData | null> {
  const raw = await redis.get<unknown>(`user:${token}`);

  return normalizeUserData(raw, token);
}
