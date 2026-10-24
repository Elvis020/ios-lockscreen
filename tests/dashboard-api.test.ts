import { describe, expect, it } from 'vitest';
import handler from '../api/index';
import { WALLPAPER_PRESETS } from '../lib/preferences';

function createElementStub() {
  const classes = new Set<string>();

  return {
    textContent: '',
    value: '',
    innerHTML: '',
    disabled: false,
    children: [{ textContent: '' }, { textContent: '' }],
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      toggle: (name: string, force?: boolean) => {
        if (force ?? !classes.has(name)) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
    addEventListener: () => {},
    append: () => {},
    appendChild: () => {},
    querySelectorAll: () => [],
  };
}

async function createDashboardHarness(fetchImplementation: typeof fetch) {
  const html = await handler().text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const elements = new Map<string, ReturnType<typeof createElementStub>>();
  const documentListeners = new Map<string, () => void>();
  const storage = new Map<string, string>();
  const openedUrls: string[] = [];

  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    elements.set(id, createElementStub());
  }

  const documentStub = {
    visibilityState: 'visible',
    getElementById: (id: string) => {
      if (!elements.has(id)) {
        elements.set(id, createElementStub());
      }

      return elements.get(id);
    },
    createElement: () => createElementStub(),
    addEventListener: (name: string, listener: () => void) => {
      documentListeners.set(name, listener);
    },
  };
  const localStorageStub = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const execute = new Function(
    'window',
    'document',
    'localStorage',
    'fetch',
    'navigator',
    'URLSearchParams',
    'setTimeout',
    'clearTimeout',
    `${script}
      return {
        setTokenForTest(value) {
          token = value;
          authSessionId += 1;
        },
        loadDashboard,
        renderWallpaperOptions,
        applyPresetSelection,
        syncPresetSelection,
        saveSettings,
        refreshTelegramStatus,
        linkTelegram,
        logout,
        pollTelegramStatusForTest() {
          telegramPollDeadline = Date.now() + TELEGRAM_POLL_TIMEOUT_MS;
          return pollTelegramStatus();
        },
      };
    `,
  );
  const controls = execute(
    {
      location: { search: '', assign: () => {} },
      open: (url: string) => openedUrls.push(url),
    },
    documentStub,
    localStorageStub,
    fetchImplementation,
    { clipboard: { writeText: () => Promise.resolve() } },
    URLSearchParams,
    setTimeout,
    clearTimeout,
  ) as {
    setTokenForTest: (value: string) => void;
    loadDashboard: () => Promise<void>;
    renderWallpaperOptions: (settings: Record<string, unknown>) => void;
    applyPresetSelection: () => void;
    syncPresetSelection: () => void;
    saveSettings: () => Promise<void>;
    refreshTelegramStatus: () => Promise<boolean | null>;
    linkTelegram: () => Promise<void>;
    logout: (message: string) => void;
    pollTelegramStatusForTest: () => Promise<void>;
  };

  return { controls, elements, openedUrls };
}

describe('dashboard API', () => {
  it('returns browser JavaScript that parses successfully', async () => {
    const response = handler();
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    expect(response.status).toBe(200);
    expect(script).toBeTruthy();
    expect(() => new Function(script as string)).not.toThrow();
  });

  it('migrates the legacy token key and exposes an explicit recovery copy action', async () => {
    const html = await handler().text();

    expect(html).toContain("const LEGACY_TOKEN_KEY = 'quarterProgressToken'");
    expect(html).toContain('localStorage.setItem(TOKEN_KEY, legacyToken)');
    expect(html).toContain('id="managementToken"');
    expect(html).toContain('id="copyTokenButton"');
    expect(html).toContain('Management token copied. Keep it private.');
  });

  it('renders Telegram connection status and refreshes it after external linking', async () => {
    const html = await handler().text();

    expect(html).toContain('id="telegramStatus"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('renderTelegramStatus(settings.telegramLinked)');
    expect(html).toContain(
      "button.textContent = telegramLinked ? 'Relink Telegram' : 'Link Telegram'",
    );
    expect(html).toContain('const TELEGRAM_POLL_TIMEOUT_MS = 60_000');
    expect(html).toContain("document.addEventListener('visibilitychange'");
  });

  it('exposes presets, independent wallpaper dimensions, and calibration guidance', async () => {
    const html = await handler().text();

    expect(html).toContain('id="wallpaperPreset"');
    expect(html).toContain('id="timeRange"');
    expect(html).toContain('id="presentation"');
    expect(html).toContain('id="lockScreenProfile"');
    expect(html).toContain('Lock screens vary. Preview on your phone');
    expect(html).toContain("timeRange: byId('timeRange').value");
    expect(html).toContain("presentation: byId('presentation').value");
  });

  it('applies a preset and saves independent dimensions with the selected profile', async () => {
    let savedBody: Record<string, unknown> | undefined;
    const fetchImplementation = async (_input: RequestInfo | URL, init?: RequestInit) => {
      savedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return Response.json({});
    };
    const { controls, elements } = await createDashboardHarness(fetchImplementation);

    controls.setTokenForTest('current-token');
    controls.renderWallpaperOptions({
      timeRange: 'quarter',
      presentation: 'calendar',
      lockScreenProfile: 'large-clock',
      wallpaperOptions: {
        timeRanges: ['week', 'month', 'quarter', 'rolling14', 'year'],
        presentations: ['calendar', 'countdown', 'progress', 'hybrid'],
        lockScreenProfiles: ['standard', 'large-clock'],
        presets: Object.values(WALLPAPER_PRESETS),
      },
    });
    elements.get('wallpaperPreset')!.value = 'hybrid';
    elements.get('theme')!.value = 'default';
    elements.get('timeZone')!.value = 'Africa/Accra';
    controls.applyPresetSelection();
    elements.get('eventCount')!.value = '5';
    await controls.saveSettings();

    expect(savedBody).toEqual({
      timeRange: 'month',
      presentation: 'hybrid',
      lockScreenProfile: 'large-clock',
      eventCount: 5,
      theme: 'default',
      timeZone: 'Africa/Accra',
    });

    elements.get('timeRange')!.value = 'year';
    elements.get('presentation')!.value = 'hybrid';
    controls.syncPresetSelection();

    expect(elements.get('wallpaperPreset')!.value).toBe('custom');
    expect(elements.get('eventCount')!.value).toBe('5');
  });

  it('renders a linked Telegram account during the initial dashboard load', async () => {
    const fetchImplementation = async (input: RequestInfo | URL) => {
      const responses: Record<string, unknown> = {
        '/api/settings': {
          timeRange: 'month',
          presentation: 'hybrid',
          lockScreenProfile: 'large-clock',
          timeZone: 'UTC',
          themes: ['midnight'],
          theme: 'midnight',
          wallpaperUrl: 'https://example.com/wallpaper',
          telegramLinked: true,
        },
        '/api/events': { events: [] },
        '/api/google/status': { configured: false, accounts: [] },
        '/api/google/events': { events: [], selectedEventIds: [] },
      };

      return new Response(JSON.stringify(responses[String(input)]), {
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const { controls, elements } = await createDashboardHarness(fetchImplementation);

    controls.setTokenForTest('current-token');

    await controls.loadDashboard();

    expect(elements.get('telegramButton')?.textContent).toBe('Relink Telegram');
    expect(elements.get('telegramStatus')?.textContent).toContain('Connected.');
    expect(elements.get('timeRange')?.value).toBe('month');
    expect(elements.get('presentation')?.value).toBe('hybrid');
    expect(elements.get('lockScreenProfile')?.value).toBe('large-clock');
    expect(elements.get('eventCount')?.value).toBe('2');
  });

  it('discards an initial dashboard response after switching accounts', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImplementation = () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    const { controls, elements } = await createDashboardHarness(fetchImplementation);

    controls.setTokenForTest('old-token');

    const pendingLoad = controls.loadDashboard();

    controls.setTokenForTest('new-token');
    resolveFetch?.(
      new Response(JSON.stringify({ telegramLinked: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await pendingLoad;

    expect(elements.get('telegramButton')?.textContent).not.toBe('Relink Telegram');
    expect(elements.get('telegramStatus')?.textContent ?? '').not.toContain('Connected.');
  });

  it('discards an in-flight Telegram status response after logout', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImplementation = () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    const { controls, elements } = await createDashboardHarness(fetchImplementation);

    controls.setTokenForTest('old-token');

    const pendingPoll = controls.pollTelegramStatusForTest();

    controls.logout('Logged out from this browser.');
    resolveFetch?.(
      new Response(JSON.stringify({ telegramLinked: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await pendingPoll;

    expect(elements.get('telegramButton')?.textContent).toBe('Link Telegram');
    expect(elements.get('telegramStatus')?.textContent).not.toContain('Connected.');
    expect(elements.get('notice')?.textContent).toBe('Logged out from this browser.');
  });

  it('discards an in-flight Telegram link after switching accounts', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImplementation = () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    const { controls, elements, openedUrls } =
      await createDashboardHarness(fetchImplementation);

    controls.setTokenForTest('old-token');

    const pendingLink = controls.linkTelegram();

    controls.setTokenForTest('new-token');
    resolveFetch?.(
      new Response(
        JSON.stringify({ linkUrl: 'https://t.me/example?start=old-account' }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    await pendingLink;

    expect(openedUrls).toEqual([]);
    expect(elements.get('notice')?.textContent ?? '').toBe('');
  });
});
