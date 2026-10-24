import { describe, expect, it } from 'vitest';
import { eventCategoryColor } from '../lib/preferences';

describe('eventCategoryColor', () => {
  it('uses the active theme accent for general, missing, and unknown categories', () => {
    const accent = '#76F0D0';

    expect(eventCategoryColor('general', accent)).toBe(accent);
    expect(eventCategoryColor(undefined, accent)).toBe(accent);
    expect(eventCategoryColor('unknown', accent)).toBe(accent);
  });

  it.each([
    ['work', '#5D7FA3'],
    ['personal', '#8B6B8F'],
    ['health', '#5F907B'],
    ['travel', '#A68155'],
  ])('keeps the %s category color fixed', (category, expectedColor) => {
    expect(eventCategoryColor(category, '#76F0D0')).toBe(expectedColor);
  });
});
