import type { WallpaperTheme } from './preferences';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const THEME_ID_PATTERN = /^[a-z][a-z0-9-]{0,19}$/;

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();

    return true;
  } catch {
    return false;
  }
}

export function normalizeEventName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const name = value.trim().replace(/\s+/g, ' ');

  if (!name || name.length > 50) {
    return null;
  }

  return name;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeThemeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const id = value.trim().toLowerCase();

  return THEME_ID_PATTERN.test(id) ? id : null;
}

export function createCustomTheme(
  idValue: unknown,
  colors: unknown[],
): WallpaperTheme | null {
  const id = normalizeThemeId(idValue);

  if (!id || colors.length !== 5 || !colors.every(isHexColor)) {
    return null;
  }

  const [background, passed, weekend, current, future] = colors.map((color) =>
    String(color).toUpperCase(),
  );
  const text = readableTextColor(background);

  return {
    id,
    background,
    passed,
    weekend,
    current,
    future,
    text,
    subtext: text === '#E5E5E5' ? '#A1A1A1' : '#606060',
  };
}

function readableTextColor(background: string): '#1C1C1C' | '#E5E5E5' {
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  return luminance > 0.55 ? '#1C1C1C' : '#E5E5E5';
}
