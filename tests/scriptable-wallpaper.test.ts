import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildNativeWallpaperScene } from '../lib/nativeWallpaperScene';
import { buildWallpaperModel } from '../lib/wallpaperModel';
import {
  EVENT_COUNTS,
  LOCK_SCREEN_PROFILES,
  PRESENTATIONS,
  TIME_RANGES,
} from '../lib/preferences';

const source = readFileSync(
  new URL('../scripts/scriptable/render-wallpaper.js', import.meta.url),
  'utf8',
);

function scene() {
  return buildNativeWallpaperScene(
    buildWallpaperModel({
      date: new Date('2026-10-24T12:00:00Z'),
      publicEvents: [
        {
          name: 'A long project milestone name that should truncate',
          date: '2026-11-14',
        },
      ],
    }),
  );
}

function runtime(input: unknown, { disableSegmenter = false } = {}) {
  const draw = {
    setFillColor: vi.fn(),
    fillRect: vi.fn(),
    fillEllipse: vi.fn(),
    setFont: vi.fn(),
    setTextColor: vi.fn(),
    setTextAlignedCenter: vi.fn(),
    setTextAlignedLeft: vi.fn(),
    setTextAlignedRight: vi.fn(),
    drawTextInRect: vi.fn(),
    addPath: vi.fn(),
    fillPath: vi.fn(),
    getImage: vi.fn(() => ({ syntheticImage: true })),
    size: {} as { width: number; height: number },
    respectScreenScale: true,
    opaque: false,
  };
  const createContext = vi.fn(function () {
    return draw;
  });
  const output = vi.fn();
  const complete = vi.fn();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const nativeGlobals = {
    args: { shortcutParameter: input },
    DrawContext: createContext,
    Size: function (width: number, height: number) {
      return { width, height };
    },
    Rect: function (x: number, y: number, width: number, height: number) {
      return { x, y, width, height };
    },
    Color: function (value: string) {
      return { value };
    },
    Path: function () {
      return { addRoundedRect: vi.fn() };
    },
    Font: {
      systemFont: vi.fn((size) => ({ kind: 'native-system', size })),
      mediumSystemFont: vi.fn((size) => ({ kind: 'native-medium', size })),
      semiboldSystemFont: vi.fn((size) => ({ kind: 'native-semibold', size })),
    },
    Data: { fromPNG: vi.fn(() => ({ toBase64String: () => png.toString('base64') })) },
    Script: { setShortcutOutput: output, complete },
  };

  if (disableSegmenter) {
    Object.assign(nativeGlobals, { Intl: {} });
  }

  return {
    draw,
    createContext,
    output,
    complete,
    nativeGlobals,
    run: () =>
      runInNewContext(source, nativeGlobals, {
        timeout: 2000,
        contextCodeGeneration: { strings: false, wasm: false },
      }),
  };
}

function textScene({
  value,
  width,
  size,
  truncate = true,
}: {
  value: string;
  width: number;
  size: number;
  truncate?: boolean;
}) {
  return {
    version: 1,
    width: 1284,
    height: 2778,
    background: '#1c1c1c',
    commands: [
      {
        kind: 'text',
        x: 112,
        y: 1200,
        width,
        height: Math.ceil(size * 1.2),
        value,
        color: '#e5e5e5',
        size,
        font: 'medium',
        align: 'left',
        truncate,
      },
    ],
  };
}

function renderedText(harness: ReturnType<typeof runtime>): string {
  harness.run();

  return harness.draw.drawTextInRect.mock.calls[0][0];
}

describe('Scriptable native wallpaper adapter (simulated runtime)', () => {
  it.each(['dictionary', 'text'])(
    'accepts %s input, uses native fonts and outputs PNG base64',
    (kind) => {
      const data = scene();
      const harness = runtime(kind === 'text' ? JSON.stringify(data) : data);

      harness.run();

      expect(harness.draw.size).toEqual({ width: 1284, height: 2778 });
      expect(harness.draw.respectScreenScale).toBe(false);
      expect(harness.draw.opaque).toBe(true);
      expect(harness.nativeGlobals.Font.systemFont).toHaveBeenCalled();
      expect(harness.nativeGlobals.Font.mediumSystemFont).toHaveBeenCalled();
      expect(harness.draw.fillEllipse).toHaveBeenCalled();
      expect(harness.draw.fillPath).toHaveBeenCalled();
      expect(harness.output).toHaveBeenCalledExactlyOnceWith('iVBORw==');
      expect(harness.complete).toHaveBeenCalledOnce();
    },
  );

  it('uses the full one-column name frame before truncating event text', () => {
    const value = 'Optometrist appointment and prescription review';
    const harness = runtime(textScene({ value, width: 886, size: 34 }));

    expect(renderedText(harness)).toBe(value);
  });

  it.each([
    ['one-column', 886, 34],
    ['dense two-column', 377, 24],
  ])('truncates near the edge of a %s name frame', (_layout, width, size) => {
    const value =
      'Quarterly international partnership planning workshop in Accra and Kumasi';
    const harness = runtime(textScene({ value, width, size }));
    const rendered = renderedText(harness);
    const oldCharacterLimit = Math.floor(width / size);

    expect(rendered.endsWith('…')).toBe(true);
    expect(value.startsWith(rendered.slice(0, -1))).toBe(true);
    expect(Array.from(rendered).length).toBeGreaterThan(oldCharacterLimit);
  });

  it.each([false, true])(
    'keeps emoji sequences intact when text must be truncated (fallback: %s)',
    (disableSegmenter) => {
      const value = 'Team 👩🏽‍💻 planning in Ghana 🇬🇭 with regional partners';
      const harness = runtime(textScene({ value, width: 360, size: 34 }), {
        disableSegmenter,
      });
      const rendered = renderedText(harness);

      expect(rendered.endsWith('…')).toBe(true);
      expect(rendered.includes('👩🏽‍💻')).toBe(true);
      expect(
        ['\u200d', '\ufe0e', '\ufe0f'].some((suffix) => rendered.endsWith(`${suffix}…`)),
      ).toBe(false);
    },
  );

  it.each([
    ['Indic conjuncts', 'Update क्षक्षक्ष planning with regional partners'],
    ['Hangul Jamo', 'Update 한글 planning with regional partners'],
  ])('uses safe word boundaries for %s without Intl.Segmenter', (_script, value) => {
    const harness = runtime(textScene({ value, width: 220, size: 34 }), {
      disableSegmenter: true,
    });

    expect(renderedText(harness)).toBe('Update…');
  });

  it('leaves non-truncating text commands unchanged', () => {
    const value = 'A deliberately long centered heading that may exceed its frame';
    const harness = runtime(textScene({ value, width: 260, size: 34, truncate: false }));

    expect(renderedText(harness)).toBe(value);
  });

  it.each(EVENT_COUNTS)(
    'runs all active scenes with event count %i through the unchanged adapter',
    (eventCount) => {
      for (const lockScreenProfile of LOCK_SCREEN_PROFILES) {
        for (const timeRange of TIME_RANGES) {
          for (const presentation of PRESENTATIONS) {
            const data = buildNativeWallpaperScene(
              buildWallpaperModel({
                date: new Date('2026-10-24T12:00:00Z'),
                eventCount,
                publicEvents: Array.from({ length: 7 }, (_, index) => ({
                  name: `Adapter milestone ${index}`,
                  date: '2026-11-14',
                })),
                timeRange,
                presentation,
                lockScreenProfile,
              }),
            );
            const harness = runtime(data);

            harness.run();

            expect(harness.output).toHaveBeenCalledOnce();
            if (presentation === 'countdown') {
              expect(harness.nativeGlobals.Font.semiboldSystemFont).toHaveBeenCalled();
            }

            const empty = runtime(
              buildNativeWallpaperScene(
                buildWallpaperModel({
                  date: new Date('2028-01-01T12:00:00Z'),
                  eventCount,
                  timeRange,
                  presentation,
                  lockScreenProfile,
                }),
              ),
            );

            expect(
              () => empty.run(),
              `${timeRange}/${presentation}/${lockScreenProfile} empty`,
            ).not.toThrow();
            expect(empty.output).toHaveBeenCalledOnce();
          }
        }
      }
    },
  );

  it('accepts a one-percent progress fill at the start of a quarter', () => {
    const model = buildWallpaperModel({
      date: new Date('2028-01-01T12:00:00Z'),
      timeRange: 'quarter',
      presentation: 'progress',
    });
    const data = buildNativeWallpaperScene(model);
    const harness = runtime(data);

    expect(model.period.percentComplete).toBe(1);
    expect(() => harness.run()).not.toThrow();
    expect(harness.output).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    '<html>not JSON</html>',
    'x'.repeat(200001),
    { ...scene(), version: 2 },
    { ...scene(), width: 50000 },
    { ...scene(), commands: Array(601).fill(scene().commands[0]) },
    { ...scene(), credentials: 'must-not-be-needed' },
    { ...scene(), commands: [{ kind: 'eval', value: 'remote code' }] },
    {
      ...scene(),
      commands: [{ kind: 'circle', x: NaN, y: 0, diameter: 1, fill: '#000000' }],
    },
    {
      ...scene(),
      commands: [{ kind: 'circle', x: 1284, y: 0, diameter: 100, fill: '#000000' }],
    },
    {
      ...scene(),
      commands: [
        {
          kind: 'circle',
          x: 0,
          y: 0,
          diameter: 10,
          fill: 'url(https://invalid.example)',
        },
      ],
    },
  ])('rejects malformed input without allocating or replacing wallpaper', (input) => {
    const harness = runtime(input);

    expect(() => harness.run()).toThrow();
    expect(harness.createContext).not.toHaveBeenCalled();
    expect(harness.output).not.toHaveBeenCalled();
  });

  it('validates the last operation before drawing any earlier valid operations', () => {
    const data = scene();
    const harness = runtime({
      ...data,
      commands: [...data.commands, { kind: 'unknown' }],
    });

    expect(() => harness.run()).toThrow('Invalid wallpaper drawing operation');
    expect(harness.createContext).not.toHaveBeenCalled();
  });

  it('does not expose network, files, photo-library or dynamic-code APIs', () => {
    expect(source).not.toMatch(
      /\b(?:fetch|Request|FileManager|Photos|eval|Function|importModule)\s*[.(]/,
    );
    expect(source).not.toContain('SFNS.ttf');
  });
});
