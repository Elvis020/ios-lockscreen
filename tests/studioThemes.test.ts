import { describe, expect, it } from 'vitest';
import { createColorTheme, createMoodTheme, STUDIO_MOODS } from '../lib/studioThemes';

describe('Theme Studio palettes', () => {
  it.each(Object.keys(STUDIO_MOODS) as Array<keyof typeof STUDIO_MOODS>)(
    'creates a complete deterministic %s palette and matching overlay',
    (mood) => {
      const first = createMoodTheme(mood);

      expect(createMoodTheme(mood)).toEqual(first);
      expect(first.theme.id).toBe(mood);
      expect(first.overlay).toBe(STUDIO_MOODS[mood].overlay);
      expect(Object.values(first.theme).slice(1)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^#[0-9A-F]{6}$/)]),
      );
      expect(contrast(first.theme.background, first.theme.text)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(first.theme.background, first.theme.passed)).toBeGreaterThanOrEqual(
        3,
      );
      expect(
        contrast(first.theme.background, first.theme.weekend),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(first.theme.background, first.theme.current),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(['#050505', '#777777', '#888888', '#F5F5F5'])(
    'derives readable custom accents on %s',
    (background) => {
      const result = createColorTheme('custom', background);

      expect(result).not.toBeNull();
      expect(contrast(background, result!.theme.text)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(background, result!.theme.subtext)).toBeGreaterThanOrEqual(3);
      expect(contrast(background, result!.theme.weekend)).toBeGreaterThanOrEqual(3);
      expect(contrast(background, result!.theme.current)).toBeGreaterThanOrEqual(3);
    },
  );
});

function contrast(first: string, second: string): number {
  const luminance = (color: string) => {
    const values = [1, 3, 5].map((index) => {
      const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255;

      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
  };
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));

  return (light + 0.05) / (dark + 0.05);
}
