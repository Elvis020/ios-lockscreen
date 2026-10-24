import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildNativeWallpaperScene } from '../lib/nativeWallpaperScene';
import { buildWallpaperModel } from '../lib/wallpaperModel';

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

function runtime(input: unknown) {
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
      expect(harness.nativeGlobals.Font.semiboldSystemFont).toHaveBeenCalled();
      expect(harness.draw.fillEllipse).toHaveBeenCalled();
      expect(harness.draw.fillPath).toHaveBeenCalled();
      expect(
        harness.draw.drawTextInRect.mock.calls.some(([value]) => value.endsWith('…')),
      ).toBe(true);
      expect(harness.output).toHaveBeenCalledExactlyOnceWith('iVBORw==');
      expect(harness.complete).toHaveBeenCalledOnce();
    },
  );

  it('runs all twelve supported range/presentation/profile scenes through validation', () => {
    for (const lockScreenProfile of ['standard', 'large-clock'] as const) {
      for (const timeRange of ['week', 'month', 'quarter'] as const) {
        for (const presentation of ['calendar', 'hybrid'] as const) {
          const data = buildNativeWallpaperScene(
            buildWallpaperModel({
              date: new Date('2026-10-24T12:00:00Z'),
              timeRange,
              presentation,
              lockScreenProfile,
              publicEvents: [{ name: 'Réunion 🎉', date: '2026-11-14' }],
            }),
          );
          const harness = runtime(data);

          harness.run();

          expect(harness.output).toHaveBeenCalledOnce();
        }
      }
    }
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
