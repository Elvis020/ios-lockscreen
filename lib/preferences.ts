export const VIEW_MODES = ['week', 'month', 'quarter'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

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
  minimal: {
    id: 'minimal',
    background: '#1C1C1C',
    passed: '#E0E0E0',
    weekend: '#BDBDBD',
    current: '#FF6B35',
    future: '#505050',
    text: '#E5E5E5',
    subtext: '#A1A1A1',
  },
};

export const MAX_CUSTOM_THEMES = 5;

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && VIEW_MODES.includes(value as ViewMode);
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

export function listAvailableThemeIds(customThemes: WallpaperTheme[] = []): string[] {
  return [...Object.keys(BUILT_IN_THEMES), ...customThemes.map(({ id }) => id)];
}
