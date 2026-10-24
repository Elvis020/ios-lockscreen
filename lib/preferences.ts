export const VIEW_MODES = ['week', 'month', 'quarter'] as const;
export const TIME_RANGES = [...VIEW_MODES, 'rolling14', 'year'] as const;
export const PRESENTATIONS = ['calendar', 'countdown', 'progress', 'hybrid'] as const;
export const LEGACY_PRESENTATIONS = ['agenda', 'minimal'] as const;
export const LOCK_SCREEN_PROFILES = ['standard', 'large-clock'] as const;
export const DEFAULT_EVENT_COUNT = 2;
export const EVENT_COUNTS = [1, 2, 3, 4, 5] as const;

export type ViewMode = (typeof VIEW_MODES)[number];
export type TimeRange = (typeof TIME_RANGES)[number];
export type ActivePresentation = (typeof PRESENTATIONS)[number];
export type Presentation = ActivePresentation | (typeof LEGACY_PRESENTATIONS)[number];
export type LockScreenProfile = (typeof LOCK_SCREEN_PROFILES)[number];

export interface WallpaperPreset {
  id: WallpaperPresetId;
  label: string;
  timeRange: TimeRange;
  presentation: Presentation;
}

export const WALLPAPER_PRESET_IDS = [
  'week',
  'month',
  'quarter',
  'rolling14',
  'countdown',
  'year',
  'hybrid',
] as const;

export type WallpaperPresetId = (typeof WALLPAPER_PRESET_IDS)[number];

export const WALLPAPER_PRESETS: Record<WallpaperPresetId, WallpaperPreset> = {
  week: {
    id: 'week',
    label: 'Week',
    timeRange: 'week',
    presentation: 'calendar',
  },
  month: {
    id: 'month',
    label: 'Month',
    timeRange: 'month',
    presentation: 'calendar',
  },
  quarter: {
    id: 'quarter',
    label: 'Quarter',
    timeRange: 'quarter',
    presentation: 'calendar',
  },
  rolling14: {
    id: 'rolling14',
    label: 'Rolling 14 days',
    timeRange: 'rolling14',
    presentation: 'calendar',
  },
  countdown: {
    id: 'countdown',
    label: 'Countdown',
    timeRange: 'year',
    presentation: 'countdown',
  },
  year: {
    id: 'year',
    label: 'Year',
    timeRange: 'year',
    presentation: 'calendar',
  },
  hybrid: {
    id: 'hybrid',
    label: 'Month + next events',
    timeRange: 'month',
    presentation: 'hybrid',
  },
};

export interface WallpaperTheme {
  id: string;
  background: string;
  passed: string;
  weekend: string;
  current: string;
  future: string;
  text: string;
  subtext: string;
}

export const BUILT_IN_THEMES: Record<string, WallpaperTheme> = {
  default: {
    id: 'default',
    background: '#1C1C1C',
    passed: '#E5E5E5',
    weekend: '#90CAF9',
    current: '#FF6B35',
    future: '#4A4A4A',
    text: '#E5E5E5',
    subtext: '#A1A1A1',
  },
  ocean: {
    id: 'ocean',
    background: '#172330',
    passed: '#4FC3F7',
    weekend: '#29B6F6',
    current: '#FF6B35',
    future: '#415162',
    text: '#E5F7FF',
    subtext: '#8AA8B8',
  },
  sunset: {
    id: 'sunset',
    background: '#2D2020',
    passed: '#FFB74D',
    weekend: '#FFA726',
    current: '#FF5722',
    future: '#574040',
    text: '#FFF0E5',
    subtext: '#B99A88',
  },
  forest: {
    id: 'forest',
    background: '#192819',
    passed: '#81C784',
    weekend: '#66BB6A',
    current: '#FF6B35',
    future: '#3E543E',
    text: '#E7F5E7',
    subtext: '#94AE94',
  },
  midnight: {
    id: 'midnight',
    background: '#151827',
    passed: '#AEB8FF',
    weekend: '#7C8CFF',
    current: '#FF8A5B',
    future: '#34384F',
    text: '#F1F3FF',
    subtext: '#969CB8',
  },
  frost: {
    id: 'frost',
    background: '#15212B',
    passed: '#C7E9F7',
    weekend: '#7CC6E8',
    current: '#76F0D0',
    future: '#3A4D5B',
    text: '#F2FBFF',
    subtext: '#91A9B5',
  },
  espresso: {
    id: 'espresso',
    background: '#241B16',
    passed: '#D7B58A',
    weekend: '#C08A5A',
    current: '#FFB347',
    future: '#4D3A2E',
    text: '#FFF2E6',
    subtext: '#B99E88',
  },
  rosewood: {
    id: 'rosewood',
    background: '#28191E',
    passed: '#E7A6B2',
    weekend: '#CC7F91',
    current: '#FFB35C',
    future: '#553740',
    text: '#FFF0F3',
    subtext: '#BB929B',
  },
};

export const MAX_CUSTOM_THEMES = 5;
export const RETIRED_THEME_IDS = ['minimal'] as const;

export function isEventCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    EVENT_COUNTS.includes(value as (typeof EVENT_COUNTS)[number])
  );
}

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && VIEW_MODES.includes(value as ViewMode);
}

export function isTimeRange(value: unknown): value is TimeRange {
  return typeof value === 'string' && TIME_RANGES.includes(value as TimeRange);
}

export function isPresentation(value: unknown): value is ActivePresentation {
  return typeof value === 'string' && PRESENTATIONS.includes(value as ActivePresentation);
}

export function isLockScreenProfile(value: unknown): value is LockScreenProfile {
  return (
    typeof value === 'string' && LOCK_SCREEN_PROFILES.includes(value as LockScreenProfile)
  );
}

export function isWallpaperPreset(value: unknown): value is WallpaperPresetId {
  return (
    typeof value === 'string' && WALLPAPER_PRESET_IDS.includes(value as WallpaperPresetId)
  );
}

export function findWallpaperPreset(
  timeRange: TimeRange,
  presentation: Presentation,
): WallpaperPresetId | null {
  if (timeRange === 'year' && presentation === 'progress') {
    return 'year';
  }

  return (
    WALLPAPER_PRESET_IDS.find((id) => {
      const preset = WALLPAPER_PRESETS[id];

      return preset.timeRange === timeRange && preset.presentation === presentation;
    }) ?? null
  );
}

export function resolveTheme(
  themeId: string,
  customThemes: WallpaperTheme[] = [],
): WallpaperTheme {
  return (
    BUILT_IN_THEMES[themeId] ??
    customThemes.find((theme) => theme.id === themeId) ??
    BUILT_IN_THEMES.default
  );
}

export function isReservedThemeId(themeId: string): boolean {
  return Boolean(BUILT_IN_THEMES[themeId]) || isRetiredThemeId(themeId);
}

export function isRetiredThemeId(themeId: string): boolean {
  return RETIRED_THEME_IDS.includes(themeId as 'minimal');
}

export function listAvailableThemeIds(customThemes: WallpaperTheme[] = []): string[] {
  return [
    ...Object.keys(BUILT_IN_THEMES),
    ...customThemes.filter(({ id }) => !isReservedThemeId(id)).map(({ id }) => id),
  ];
}
