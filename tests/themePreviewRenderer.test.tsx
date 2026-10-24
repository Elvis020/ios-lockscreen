import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, type WallpaperTheme } from '../lib/preferences';
import { createThemePreviewImageResponse } from '../lib/themePreviewRenderer';

describe('theme preview renderer', () => {
  it('fits eight built-ins and five custom themes without truncation', async () => {
    const themes = [
      ...Object.values(BUILT_IN_THEMES),
      ...Array.from({ length: 5 }, (_, index) => customTheme(index)),
    ];
    const response = createThemePreviewImageResponse(themes);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(response.headers.get('content-type')).toContain('image/png');
    expect(readPngDimension(view, 16)).toBe(900);
    expect(readPngDimension(view, 20)).toBe(1546);
  });
});

function customTheme(index: number): WallpaperTheme {
  return {
    ...BUILT_IN_THEMES.default,
    id: `custom-${index}`,
  };
}

function readPngDimension(view: DataView, offset: number): number {
  return view.getUint32(offset);
}
