import { getRedis } from './redis';
import { commitIfLeasesOwned, withRedisLock, type RedisFencedSet } from './redisLock';
import { isValidDateString, normalizeEventName } from './validation';

export interface TelegramEventDraft {
  id: string;
  revision: string;
  token: string;
  userId: string;
  chatId: string;
  name: string;
  date?: string;
  createdAt: number;
  expiresAt: number;
}

const DRAFT_TTL_SECONDS = 15 * 60;

interface DraftCompletion {
  key: string;
  ttlSeconds: number;
}
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export function draftKey(userId: string): string {
  return `telegram:draft:${userId}`;
}

export async function createTelegramDraft(
  draft: Omit<TelegramEventDraft, 'id' | 'revision' | 'createdAt' | 'expiresAt'>,
  completion?: DraftCompletion,
): Promise<TelegramEventDraft> {
  const redis = getRedis();
  const createdAt = Date.now();
  const result: TelegramEventDraft = {
    ...draft,
    id: opaqueId(12),
    revision: opaqueId(8),
    createdAt,
    expiresAt: createdAt + DRAFT_TTL_SECONDS * 1000,
  };

  await withRedisLock(redis, draftKey(draft.userId), async (lease) => {
    const sets: RedisFencedSet[] = [
      {
        key: draftKey(draft.userId),
        value: result,
        ttlSeconds: DRAFT_TTL_SECONDS,
      },
    ];

    addCompletionSet(sets, completion);
    await commitIfLeasesOwned(redis, [lease], sets);
  });

  return result;
}

export async function getTelegramDraft(
  userId: string,
): Promise<TelegramEventDraft | null> {
  const redis = getRedis();
  const draft = await redis.get<TelegramEventDraft>(draftKey(userId));

  if (!draft || draft.expiresAt <= Date.now()) {
    return null;
  }

  return draft;
}

export async function updateTelegramDraftDate(
  userId: string,
  id: string,
  date: string,
  revision?: string,
  completion?: DraftCompletion,
): Promise<TelegramEventDraft | null> {
  const redis = getRedis();

  return withRedisLock(redis, draftKey(userId), async (lease) => {
    const current = await getTelegramDraft(userId);

    if (
      !current ||
      current.id !== id ||
      (revision !== undefined && current.revision !== revision)
    ) {
      return null;
    }

    const updated = { ...current, date, revision: opaqueId(8) };
    const ttlSeconds = remainingDraftTtl(current);

    if (!ttlSeconds) {
      await commitIfLeasesOwned(redis, [lease], [], [draftKey(userId)]);

      return null;
    }

    const sets: RedisFencedSet[] = [
      {
        key: draftKey(userId),
        value: updated,
        ttlSeconds,
      },
    ];

    addCompletionSet(sets, completion);
    await commitIfLeasesOwned(redis, [lease], sets);

    return updated;
  });
}

export async function clearTelegramDraftDate(
  userId: string,
  id: string,
  revision: string,
  completion?: DraftCompletion,
): Promise<TelegramEventDraft | null> {
  const redis = getRedis();

  return withRedisLock(redis, draftKey(userId), async (lease) => {
    const current = await getTelegramDraft(userId);

    if (!current || current.id !== id || current.revision !== revision) {
      return null;
    }

    const updated = { ...current, date: undefined, revision: opaqueId(8) };
    const ttlSeconds = remainingDraftTtl(current);

    if (!ttlSeconds) {
      await commitIfLeasesOwned(redis, [lease], [], [draftKey(userId)]);

      return null;
    }

    const sets: RedisFencedSet[] = [
      {
        key: draftKey(userId),
        value: updated,
        ttlSeconds,
      },
    ];

    addCompletionSet(sets, completion);
    await commitIfLeasesOwned(redis, [lease], sets);

    return updated;
  });
}

export async function cancelTelegramDraft(
  userId: string,
  id: string,
  revision?: string,
  completion?: DraftCompletion,
): Promise<boolean> {
  const redis = getRedis();

  return withRedisLock(redis, draftKey(userId), async (lease) => {
    const current = await getTelegramDraft(userId);

    if (
      !current ||
      current.id !== id ||
      (revision !== undefined && current.revision !== revision)
    ) {
      return false;
    }

    const sets: RedisFencedSet[] = [];

    addCompletionSet(sets, completion);
    await commitIfLeasesOwned(redis, [lease], sets, [draftKey(userId)]);

    return true;
  });
}

export function parseTelegramEventInput(
  input: string,
  timeZone: string,
  now = new Date(),
): { name: string; date?: string; error?: string } {
  const exact = input.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);

  if (exact) {
    const name = normalizeEventName(exact[2]);

    if (!isValidDateString(exact[1])) {
      return { name: name ?? '', error: 'That date does not exist.' };
    }

    return name
      ? { name, date: exact[1] }
      : { name: '', error: 'Use an event name with 1–50 characters.' };
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(input) ||
    /^(?:today|tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))$/i.test(
      input,
    ) ||
    /^\d{1,2}\s+[a-z]+(?:\s+\d{4})?$/i.test(input)
  ) {
    return { name: '', error: 'Add an event name before the date.' };
  }

  if (/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(input)) {
    return { name: '', error: 'Use a month name, for example 14 November.' };
  }

  const localToday = localDate(now, timeZone);
  const relative = input.match(
    /^(.+?)\s+(today|tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))$/i,
  );

  if (relative) {
    const name = normalizeEventName(relative[1]) ?? '';
    const phrase = relative[2].toLowerCase();

    if (!name || containsNaturalDatePhrase(name)) {
      return { name, error: 'Use one date phrase at a time.' };
    }

    const offset =
      phrase === 'today'
        ? 0
        : phrase === 'tomorrow'
          ? 1
          : daysUntilNext(localToday, phrase.slice(5));

    return { name, date: addDays(localToday, offset) };
  }

  const monthDate = input.match(/^(.+?)\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);

  if (monthDate) {
    const name = normalizeEventName(monthDate[1]) ?? '';
    const month = MONTHS.indexOf(monthDate[3].toLowerCase());
    const day = Number(monthDate[2]);

    if (!name || containsNaturalDatePhrase(name)) {
      return { name, error: 'Use one date phrase at a time.' };
    }

    if (month < 0) {
      return { name, error: 'Use a full month name, for example 14 November.' };
    }

    const baseYear = Number(localToday.slice(0, 4));
    const explicitYear = monthDate[4] ? Number(monthDate[4]) : null;

    if (explicitYear !== null) {
      const date = makeDate(explicitYear, month, day);

      return date ? { name, date } : { name, error: 'That date does not exist.' };
    }

    for (let year = baseYear; year <= baseYear + 8; year += 1) {
      const date = makeDate(year, month, day);

      if (date && date >= localToday) {
        return { name, date };
      }
    }

    return { name, error: 'That date does not exist.' };
  }

  const name = normalizeEventName(input);

  return name ? { name } : { name: '', error: 'Use an event name with 1–50 characters.' };
}

export function formatTelegramEventDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;

  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);

  value.setUTCDate(value.getUTCDate() + amount);

  return value.toISOString().slice(0, 10);
}

function daysUntilNext(date: string, weekday: string): number {
  const target = WEEKDAYS.indexOf(weekday);
  const current = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const delta = (target - current + 7) % 7;

  return delta || 7;
}

function makeDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function containsNaturalDatePhrase(value: string): boolean {
  return /\b(?:today|tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)\b/i.test(
    value,
  );
}

function opaqueId(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let value = '';

  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }

  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function remainingDraftTtl(draft: TelegramEventDraft): number {
  return Math.max(0, Math.ceil((draft.expiresAt - Date.now()) / 1000));
}

function addCompletionSet(
  sets: RedisFencedSet[],
  completion: DraftCompletion | undefined,
): void {
  if (completion) {
    sets.push({
      key: completion.key,
      value: 'done',
      ttlSeconds: completion.ttlSeconds,
    });
  }
}
