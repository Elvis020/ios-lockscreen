import type { WallpaperTheme } from './preferences';
import type { LivingOverlay } from './userSchema';
import { createCustomTheme } from './validation';

export const STUDIO_MOODS = {
  calm: {
    background: '#243040',
    passed: '#D8E5F0',
    weekend: '#7FC8F8',
    current: '#FFAA64',
    overlay: 'haze',
  },
  warm: {
    background: '#3B2520',
    passed: '#F3D5C8',
    weekend: '#E6A57E',
    current: '#FFD166',
    overlay: 'sunset',
  },
  focus: {
    background: '#1D3026',
    passed: '#D6E8DB',
    weekend: '#73C5A1',
    current: '#F4B942',
    overlay: 'none',
  },
  night: {
    background: '#2B243B',
    passed: '#DDD6F1',
    weekend: '#9F8FEF',
    current: '#FF9E73',
    overlay: 'stars',
  },
  fresh: {
    background: '#203A36',
    passed: '#D7ECE7',
    weekend: '#72D7C3',
    current: '#FFB35C',
    overlay: 'rain',
  },
} as const satisfies Record<
  string,
  {
    background: string;
    passed: string;
    weekend: string;
    current: string;
    overlay: LivingOverlay;
  }
>;

export type StudioMood = keyof typeof STUDIO_MOODS;

export function isStudioMood(value: string | undefined): value is StudioMood {
  return Boolean(value && value in STUDIO_MOODS);
}

export function createMoodTheme(mood: StudioMood): {
  theme: WallpaperTheme;
  overlay: LivingOverlay;
} {
  const definition = STUDIO_MOODS[mood];
  const created = createCustomTheme(mood, [
    definition.background,
    definition.passed,
    definition.weekend,
    definition.current,
    subduedColor(definition.background),
  ]);

  if (!created) throw new Error('Invalid studio theme');
  const theme = withReadableText(created);

  return { theme, overlay: definition.overlay };
}

export function createColorTheme(
  name: string,
  background: string,
): { theme: WallpaperTheme; overlay: LivingOverlay } | null {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return null;
  const dark = relativeLuminance(background) < 0.35;
  const created = createCustomTheme(name, [
    background,
    dark ? '#E5E5E5' : '#1C1C1C',
    accessibleAccent(background, dark ? ['#90CAF9', '#185A78'] : ['#185A78', '#90CAF9']),
    accessibleAccent(background, dark ? ['#FF8A5B', '#9A3412'] : ['#9A3412', '#FF8A5B']),
    subduedColor(background),
  ]);

  return created
    ? { theme: withReadableText(created), overlay: dark ? 'stars' : 'haze' }
    : null;
}

function accessibleAccent(background: string, candidates: string[]): string {
  return (
    candidates.find((candidate) => contrastRatio(background, candidate) >= 3) ??
    highContrastText(background)
  );
}

function withReadableText(theme: WallpaperTheme): WallpaperTheme {
  const text = highContrastText(theme.background);
  const preferredSubtext =
    text === '#E5E5E5' || text === '#FFFFFF' ? '#A1A1A1' : '#606060';

  return {
    ...theme,
    text,
    subtext: accessibleAccent(theme.background, [preferredSubtext, text]),
  };
}

function highContrastText(
  background: string,
): '#000000' | '#1C1C1C' | '#E5E5E5' | '#FFFFFF' {
  const preferred = ['#1C1C1C', '#E5E5E5'] as const;
  const readablePreferred = preferred.find(
    (candidate) => contrastRatio(background, candidate) >= 4.5,
  );

  if (readablePreferred) return readablePreferred;

  return contrastRatio(background, '#000000') >= contrastRatio(background, '#FFFFFF')
    ? '#000000'
    : '#FFFFFF';
}

function subduedColor(background: string): string {
  const toward = relativeLuminance(background) < 0.35 ? 255 : 0;
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(background.slice(index, index + 2), 16),
  );

  return `#${channels
    .map((channel) =>
      Math.round(channel + (toward - channel) * 0.24)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

function contrastRatio(first: string, second: string): number {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));

  return (light + 0.05) / (dark + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
