import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(
  new URL('../scripts/scriptable/countdown-widget.js', import.meta.url),
  'utf8',
);
const endpoint =
  'https://example.com/api/countdown?wallpaperKey=12345678-1234-1234-1234-123456789abc';

async function run(
  payload: unknown,
  options: {
    interactive?: boolean;
    stored?: string;
    fail?: boolean;
    family?: string;
  } = {},
) {
  const texts: string[] = [];
  const timer = vi.fn();
  const set = vi.fn();
  const request = vi.fn(function () {
    return {
      loadJSON: async () => {
        if (options.fail) throw new Error('secret');

        return payload;
      },
    };
  });
  const widget = {
    addText: (text: string) => texts.push(text),
    addDate: () => ({ applyTimerStyle: timer }),
    presentAccessoryRectangular: async () => {},
  };
  const alert = {
    title: '',
    message: '',
    addTextField: () => {},
    addAction: () => {},
    addCancelAction: () => {},
    presentAlert: async () => 0,
    textFieldValue: () => endpoint.replace('/api/countdown?', '/api/wallpaper?'),
  };
  const context = {
    config: {
      runsInWidget: !options.interactive,
      widgetFamily: options.family ?? 'accessoryRectangular',
    },
    ListWidget: function () {
      return widget;
    },
    Alert: function () {
      return alert;
    },
    Request: request,
    Keychain: { contains: () => Boolean(options.stored), get: () => options.stored, set },
    Script: { setWidget: () => {}, complete: () => {} },
  };

  await runInNewContext(`(async () => { ${source} })()`, context);

  return { texts, timer, set, request };
}

describe('Scriptable countdown widget', () => {
  it('stores a transformed read-only endpoint during setup', async () => {
    const result = await run(null, { interactive: true });

    expect(result.set).toHaveBeenCalledWith(
      'calendar-lockscreen-countdown-endpoint-v1',
      endpoint,
    );
  });

  it('uses a timer for an imminent event and a static label for a distant event', async () => {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      refreshAfter: new Date(Date.now() + 3600000).toISOString(),
      nextEvent: {
        name: 'Launch',
        date: '2026-10-29',
        targetAt: new Date(Date.now() + 3600000).toISOString(),
        daysLeft: 1,
        countdownLabel: 'Tomorrow',
      },
    };
    const imminent = await run(payload, { stored: endpoint });
    const distant = await run(
      {
        ...payload,
        nextEvent: {
          ...payload.nextEvent,
          targetAt: new Date(Date.now() + 172800000).toISOString(),
          daysLeft: 2,
          countdownLabel: '2d',
        },
      },
      { stored: endpoint },
    );

    expect(imminent.timer).toHaveBeenCalled();
    expect(imminent.texts).toContain('Launch');
    expect(distant.texts).toContain('2d');
    expect(distant.timer).not.toHaveBeenCalled();
  });

  it('keeps inline and circular widgets focused on the countdown', async () => {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      refreshAfter: new Date(Date.now() + 3600000).toISOString(),
      nextEvent: {
        name: 'Launch',
        date: '2026-10-29',
        targetAt: new Date(Date.now() + 3600000).toISOString(),
        daysLeft: 1,
        countdownLabel: 'Tomorrow',
      },
    };

    for (const family of ['accessoryInline', 'accessoryCircular']) {
      const result = await run(payload, { stored: endpoint, family });

      expect(result.texts).not.toContain('Launch');
      expect(result.timer).toHaveBeenCalled();
    }
  });

  it('shows generic errors without requesting invalid stored URLs', async () => {
    const invalid = await run(null, { stored: 'https://evil.test/' });
    const failure = await run(null, { stored: endpoint, fail: true });

    expect(invalid.request).not.toHaveBeenCalled();
    expect(invalid.texts).toEqual(['Open Scriptable to set up']);
    expect(failure.texts).toEqual(['Countdown unavailable']);
  });
});
