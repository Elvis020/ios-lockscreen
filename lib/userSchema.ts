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
  category: EventCategory;
  recurrence: EventRecurrence;
}

export const EVENT_CATEGORIES = [
  'general',
  'work',
  'personal',
  'health',
  'travel',
] as const;
export const EVENT_RECURRENCES = ['none', 'weekly', 'monthly', 'yearly'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type EventRecurrence = (typeof EVENT_RECURRENCES)[number];
export type MilestoneRingStyle = 'single' | 'double' | 'halo';
export type LivingOverlay =
  'none' | 'snow' | 'rain' | 'stars' | 'haze' | 'sunset' | 'seasonal';

export interface ProfileSlot {
  enabled: boolean;
  /** Retained for legacy Telegram profile messages; rendering uses fixed named slots. */
  startHour?: number;
  endHour?: number;
  theme?: string;
  timeRange?: TimeRange;
  presentation?: Presentation;
  lockScreenProfile?: LockScreenProfile;
  eventCount?: number;
  livingOverlay?: LivingOverlay;
  milestoneRingStyle?: MilestoneRingStyle;
}

export interface AutomaticProfiles {
  enabled: boolean;
  day: ProfileSlot;
  evening: ProfileSlot;
  night: ProfileSlot;
}

export interface SharedCountdown {
  id: string;
  eventId: string;
  key: string;
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
  schemaVersion: 5;
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
  focusEventId?: string;
  googleCategoryOverrides?: Record<string, EventCategory>;
  livingOverlay?: LivingOverlay;
  milestoneRingStyle?: MilestoneRingStyle;
  automaticProfiles?: AutomaticProfiles;
  sharedCountdowns?: SharedCountdown[];
  [key: string]: unknown;
}

type UnknownRecord = Record<string, unknown>;

export function normalizeUserData(raw: unknown, token: string): UserData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as UnknownRecord;
  const { customThemes, renamedThemeIds } = normalizeCustomThemes(
    record.customThemes,
    record.schemaVersion,
  );
  const selectedTheme =
    typeof record.theme === 'string'
      ? (renamedThemeIds.get(record.theme) ?? record.theme)
      : record.theme;
  const theme = normalizeTheme(selectedTheme, customThemes);

  return {
    ...record,
    schemaVersion: 5,
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
    focusEventId:
      typeof record.focusEventId === 'string' ? record.focusEventId : undefined,
    googleCategoryOverrides: normalizeCategoryOverrides(record.googleCategoryOverrides),
    livingOverlay: normalizeLivingOverlay(record.livingOverlay),
    milestoneRingStyle: normalizeRingStyle(record.milestoneRingStyle),
    automaticProfiles: normalizeAutomaticProfiles(record.automaticProfiles, customThemes),
    sharedCountdowns: normalizeSharedCountdowns(record.sharedCountdowns),
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
        category: normalizeEventCategory(event.category),
        recurrence: normalizeEventRecurrence(event.recurrence),
      },
    ];
  });
}

function normalizeEventCategory(value: unknown): EventCategory {
  return EVENT_CATEGORIES.includes(value as EventCategory)
    ? (value as EventCategory)
    : 'general';
}

function normalizeEventRecurrence(value: unknown): EventRecurrence {
  return EVENT_RECURRENCES.includes(value as EventRecurrence)
    ? (value as EventRecurrence)
    : 'none';
}

function normalizeLivingOverlay(value: unknown): LivingOverlay {
  return ['none', 'snow', 'rain', 'stars', 'haze', 'sunset', 'seasonal'].includes(
    String(value),
  )
    ? (value as LivingOverlay)
    : 'none';
}

function normalizeRingStyle(value: unknown): MilestoneRingStyle {
  return ['single', 'double', 'halo'].includes(String(value))
    ? (value as MilestoneRingStyle)
    : 'single';
}

function normalizeAutomaticProfiles(
  value: unknown,
  customThemes: WallpaperTheme[],
): AutomaticProfiles {
  const defaults: AutomaticProfiles = {
    enabled: false,
    day: { enabled: true },
    evening: { enabled: true },
    night: { enabled: true },
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const input = value as UnknownRecord;
  const slot = (candidate: unknown, fallback: ProfileSlot): ProfileSlot => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return fallback;
    const record = candidate as UnknownRecord;

    return {
      enabled: record.enabled !== false,
      startHour:
        typeof record.startHour === 'number' && Number.isInteger(record.startHour)
          ? record.startHour
          : undefined,
      endHour:
        typeof record.endHour === 'number' && Number.isInteger(record.endHour)
          ? record.endHour
          : undefined,
      theme: normalizeOptionalTheme(record.theme, customThemes),
      timeRange: isTimeRange(record.timeRange) ? record.timeRange : undefined,
      presentation: isPresentation(record.presentation) ? record.presentation : undefined,
      lockScreenProfile: isLockScreenProfile(record.lockScreenProfile)
        ? record.lockScreenProfile
        : undefined,
      eventCount: isEventCount(record.eventCount) ? record.eventCount : undefined,
      livingOverlay:
        record.livingOverlay === undefined
          ? undefined
          : normalizeLivingOverlay(record.livingOverlay),
      milestoneRingStyle:
        record.milestoneRingStyle === undefined
          ? undefined
          : normalizeRingStyle(record.milestoneRingStyle),
    };
  };

  return {
    enabled: input.enabled === true,
    day: slot(input.day, defaults.day),
    evening: slot(input.evening, defaults.evening),
    night: slot(input.night, defaults.night),
  };
}

function normalizeOptionalTheme(
  value: unknown,
  customThemes: WallpaperTheme[],
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const theme = normalizeTheme(value, customThemes);

  return theme === 'default' && value !== 'default' ? undefined : theme;
}

function normalizeCategoryOverrides(value: unknown): Record<string, EventCategory> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as UnknownRecord).flatMap(([id, category]) =>
      typeof id === 'string' && EVENT_CATEGORIES.includes(category as EventCategory)
        ? [[id, category as EventCategory]]
        : [],
    ),
  );
}

function normalizeSharedCountdowns(value: unknown): SharedCountdown[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        return [];
      const item = candidate as UnknownRecord;

      return typeof item.id === 'string' &&
        typeof item.eventId === 'string' &&
        typeof item.key === 'string' &&
        typeof item.createdAt === 'string'
        ? [
            {
              id: item.id,
              eventId: item.eventId,
              key: item.key,
              createdAt: item.createdAt,
            },
          ]
        : [];
    })
    .slice(0, 5);
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

const NEW_BUILT_IN_THEME_IDS = new Set(['midnight', 'frost', 'espresso', 'rosewood']);

function normalizeCustomThemes(
  value: unknown,
  schemaVersion: unknown,
): {
  customThemes: WallpaperTheme[];
  renamedThemeIds: Map<string, string>;
} {
  if (!Array.isArray(value)) {
    return { customThemes: [], renamedThemeIds: new Map() };
  }

  const renamedThemeIds = new Map<string, string>();
  const validThemes = value.filter((theme): theme is WallpaperTheme => {
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
      return false;
    }

    const candidate = theme as UnknownRecord;

    return (
      typeof candidate.id === 'string' &&
      typeof candidate.background === 'string' &&
      typeof candidate.passed === 'string' &&
      typeof candidate.weekend === 'string' &&
      typeof candidate.current === 'string' &&
      typeof candidate.future === 'string' &&
      typeof candidate.text === 'string' &&
      typeof candidate.subtext === 'string'
    );
  });
  const customThemes: WallpaperTheme[] = [];
  const usedIds = new Set(validThemes.map(({ id }) => id));

  for (const theme of validThemes) {
    if (!isReservedThemeId(theme.id)) {
      customThemes.push(theme);

      if (customThemes.length === 5) {
        break;
      }

      continue;
    }

    if (schemaVersion === 4 || !NEW_BUILT_IN_THEME_IDS.has(theme.id)) {
      continue;
    }

    let id = `${theme.id}-custom`;
    let suffix = 2;

    while (isReservedThemeId(id) || usedIds.has(id)) {
      id = `${theme.id}-custom-${suffix++}`;
    }

    if (!renamedThemeIds.has(theme.id)) {
      renamedThemeIds.set(theme.id, id);
    }
    usedIds.add(id);

    customThemes.push({ ...theme, id });

    if (customThemes.length === 5) {
      break;
    }
  }

  return { customThemes, renamedThemeIds };
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
