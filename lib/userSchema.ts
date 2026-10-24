import {
  BUILT_IN_THEMES,
  DEFAULT_EVENT_COUNT,
  isEventCount,
  isLockScreenProfile,
  isPresentation,
  isRetiredThemeId,
  isReservedThemeId,
  isTimeRange,
  isViewMode,
  type LockScreenProfile,
  type Presentation,
  type TimeRange,
  type WallpaperTheme,
} from './preferences';
import { isValidDateString, isValidTimeZone } from './validation';

export interface ManualEvent {
  id: string;
  name: string;
  date: string;
  source: 'manual';
  createdAt: string;
}

export interface GoogleAccount {
  id: string;
  email: string;
  encryptedRefreshToken?: string;
  connectedAt: string;
}

export interface CalendarEvent {
  id: string;
  name: string;
  date: string;
  accountEmail: string;
  calendarName?: string;
}

export interface TelegramLink {
  userId?: string;
  chatId: string;
  username?: string;
  linkedAt: string;
}

export interface UserData {
  schemaVersion: 3;
  token: string;
  wallpaperKey?: string;
  name: string;
  theme: string;
  timeRange: TimeRange;
  presentation: Presentation;
  lockScreenProfile: LockScreenProfile;
  eventCount?: number;
  timeZone: string;
  customThemes: WallpaperTheme[];
  events: ManualEvent[];
  googleAccounts: GoogleAccount[];
  selectedEventIds: string[];
  cachedCalEvents: CalendarEvent[];
  cachedCalAt: number;
  telegram?: TelegramLink;
  [key: string]: unknown;
}

type UnknownRecord = Record<string, unknown>;

export function normalizeUserData(raw: unknown, token: string): UserData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as UnknownRecord;
  const customThemes = normalizeCustomThemes(record.customThemes);
  const theme = normalizeTheme(record.theme, customThemes);

  return {
    ...record,
    schemaVersion: 3,
    token: typeof record.token === 'string' ? record.token : token,
    wallpaperKey:
      typeof record.wallpaperKey === 'string' && record.wallpaperKey
        ? record.wallpaperKey
        : undefined,
    name: typeof record.name === 'string' ? record.name : '',
    theme,
    timeRange: normalizeTimeRange(record),
    presentation: isPresentation(record.presentation) ? record.presentation : 'calendar',
    eventCount: isEventCount(record.eventCount) ? record.eventCount : DEFAULT_EVENT_COUNT,
    lockScreenProfile: isLockScreenProfile(record.lockScreenProfile)
      ? record.lockScreenProfile
      : 'standard',
    timeZone: isValidTimeZone(record.timeZone) ? record.timeZone : 'UTC',
    customThemes,
    events: normalizeManualEvents(record.events),
    googleAccounts: normalizeGoogleAccounts(record.googleAccounts),
    selectedEventIds: normalizeStringArray(record.selectedEventIds),
    cachedCalEvents: normalizeCalendarEvents(record.cachedCalEvents),
    cachedCalAt:
      typeof record.cachedCalAt === 'number' && Number.isFinite(record.cachedCalAt)
        ? record.cachedCalAt
        : 0,
    telegram: normalizeTelegram(record.telegram),
  };
}

function normalizeTimeRange(record: UnknownRecord): TimeRange {
  if (isTimeRange(record.timeRange)) {
    return record.timeRange;
  }

  if (isViewMode(record.viewMode)) {
    return record.viewMode;
  }

  return 'quarter';
}

function normalizeTheme(value: unknown, customThemes: WallpaperTheme[]): string {
  if (typeof value !== 'string') {
    return 'default';
  }

  if (
    !isRetiredThemeId(value) &&
    (BUILT_IN_THEMES[value] || customThemes.some(({ id }) => id === value))
  ) {
    return value;
  }

  return 'default';
}

function normalizeManualEvents(value: unknown): ManualEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }

    const event = candidate as UnknownRecord;

    if (typeof event.name !== 'string' || !isValidDateString(event.date)) {
      return [];
    }

    return [
      {
        id:
          typeof event.id === 'string' && event.id
            ? event.id
            : `legacy-${index}-${event.date}`,
        name: event.name.trim().slice(0, 50),
        date: event.date,
        source: 'manual' as const,
        createdAt:
          typeof event.createdAt === 'string'
            ? event.createdAt
            : '1970-01-01T00:00:00.000Z',
      },
    ];
  });
}

function normalizeGoogleAccounts(value: unknown): GoogleAccount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }

    const account = candidate as UnknownRecord;

    if (typeof account.email !== 'string') {
      return [];
    }

    return [
      {
        id:
          typeof account.id === 'string' && account.id
            ? account.id
            : `legacy-google-${index}`,
        email: account.email,
        encryptedRefreshToken:
          typeof account.encryptedRefreshToken === 'string'
            ? account.encryptedRefreshToken
            : undefined,
        connectedAt:
          typeof account.connectedAt === 'string'
            ? account.connectedAt
            : '1970-01-01T00:00:00.000Z',
      },
    ];
  });
}

function normalizeCalendarEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }

    const event = candidate as UnknownRecord;

    if (
      typeof event.id !== 'string' ||
      typeof event.name !== 'string' ||
      typeof event.accountEmail !== 'string' ||
      !isValidDateString(event.date)
    ) {
      return [];
    }

    return [
      {
        id: event.id,
        name: event.name,
        date: event.date,
        accountEmail: event.accountEmail,
        calendarName:
          typeof event.calendarName === 'string' ? event.calendarName : undefined,
      },
    ];
  });
}

function normalizeCustomThemes(value: unknown): WallpaperTheme[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((theme): theme is WallpaperTheme => {
      if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
        return false;
      }

      const candidate = theme as UnknownRecord;

      return (
        typeof candidate.id === 'string' &&
        !isReservedThemeId(candidate.id) &&
        typeof candidate.background === 'string' &&
        typeof candidate.passed === 'string' &&
        typeof candidate.weekend === 'string' &&
        typeof candidate.current === 'string' &&
        typeof candidate.future === 'string' &&
        typeof candidate.text === 'string' &&
        typeof candidate.subtext === 'string'
      );
    })
    .slice(0, 5);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeTelegram(value: unknown): TelegramLink | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const telegram = value as UnknownRecord;

  if (typeof telegram.chatId !== 'string') {
    return undefined;
  }

  return {
    userId: typeof telegram.userId === 'string' ? telegram.userId : undefined,
    chatId: telegram.chatId,
    username: typeof telegram.username === 'string' ? telegram.username : undefined,
    linkedAt:
      typeof telegram.linkedAt === 'string'
        ? telegram.linkedAt
        : '1970-01-01T00:00:00.000Z',
  };
}
