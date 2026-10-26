import {
  createGoogleBrowserNonce,
  readCookie,
  TELEGRAM_APP_SESSION_COOKIE,
  TELEGRAM_APP_SESSION_SECONDS,
} from '../../lib/calendar/oauthSession';
import { createGoogleAuthorization, syncGoogleEvents } from '../../lib/calendar/service';
import { apiErrorResponse, jsonResponse } from '../../lib/http';
import {
  EVENT_COUNTS,
  findWallpaperPreset,
  isEventCount,
  isWallpaperPreset,
  listAvailableThemeIds,
  WALLPAPER_PRESETS,
} from '../../lib/preferences';
import { getRedis } from '../../lib/redis';
import { verifyTelegramInitData } from '../../lib/telegramMiniAppAuth';
import {
  addManualEvent,
  deleteManualEvent,
  getUser,
  updatePreferences,
  updateSelectedEvents,
  type UserData,
} from '../../lib/tokenManager';
import {
  isValidDateString,
  isValidTimeZone,
  normalizeEventName,
} from '../../lib/validation';

export const config = { runtime: 'edge' };

const MAX_BODY_BYTES = 16_384;
const MUTATION_RATE_SECONDS = 1;
const PREVIEW_RATE_SECONDS = 3;
const SYNC_RATE_SECONDS = 5;
const GOOGLE_LAUNCH_CAPABILITY_BYTES = 32;

class ActionRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Please wait before trying that again');
    this.name = 'ActionRateLimitError';
  }
}

interface AppRequestBody {
  action: string;
  initData: string;
  payload?: Record<string, unknown>;
}

interface TelegramAccount {
  token: string;
  user: UserData;
  userId: string;
}

interface TelegramAppSession {
  token: string;
  userId: string;
}

interface TelegramGoogleLaunch {
  authorizationUrl: string;
  browserNonce: string;
  sessionId: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const nonce = contentSecurityNonce();

    return new Response(appPage(nonce), {
      headers: appHeaders(nonce),
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!isSameOrigin(req)) {
    return jsonResponse({ error: 'Invalid request origin' }, 403);
  }

  try {
    const body = await parseAppRequest(req);

    if (body === 'too-large') {
      return jsonResponse({ error: 'Request is too large' }, 413);
    }

    if (!body) {
      return jsonResponse({ error: 'Invalid app request' }, 400);
    }

    const account = await resolveTelegramAccount(req, body.initData);

    if (!account) {
      return jsonResponse({ error: 'Open this control panel from Telegram' }, 401);
    }

    if (body.action === 'preview') {
      await enforceActionRate(account.userId, body.action);
      const [{ buildWallpaperModel }, { createWallpaperImageResponse }] =
        await Promise.all([
          import('../../lib/wallpaperModel'),
          import('../../lib/wallpaperRenderer'),
        ]);
      const response = createWallpaperImageResponse(
        buildWallpaperModel({ user: account.user }),
      );

      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('CDN-Cache-Control', 'private, no-store');
      response.headers.set('Vercel-CDN-Cache-Control', 'private, no-store');

      return response;
    }

    if (body.action === 'bootstrap') {
      return jsonResponse(appState(account.user));
    }

    await enforceActionRate(account.userId, body.action);

    if (body.action === 'add-event') {
      const name = normalizeEventName(body.payload?.name);
      const date = body.payload?.date;

      if (!name || typeof date !== 'string' || !isValidDateString(date)) {
        return jsonResponse({ error: 'Enter an event name and valid date' }, 400);
      }

      await addManualEvent(account.token, { name, date });

      return refreshedState(account.token);
    }

    if (body.action === 'delete-event') {
      const eventId = body.payload?.eventId;

      if (typeof eventId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(eventId)) {
        return jsonResponse({ error: 'Invalid event' }, 400);
      }

      await deleteManualEvent(account.token, eventId);

      return refreshedState(account.token);
    }

    if (body.action === 'sync-google') {
      const sync = await syncGoogleEvents(account.token);
      const state = await readRefreshedState(account.token);

      return jsonResponse({ ...state, sync });
    }

    if (body.action === 'select-google') {
      const eventIds = body.payload?.eventIds;

      if (
        !Array.isArray(eventIds) ||
        eventIds.length > 7 ||
        !eventIds.every((eventId) => typeof eventId === 'string' && eventId.length <= 160)
      ) {
        return jsonResponse({ error: 'Choose up to seven Google events' }, 400);
      }

      await updateSelectedEvents(account.token, eventIds);

      return refreshedState(account.token);
    }

    if (body.action === 'save-appearance') {
      const preset = body.payload?.preset;
      const theme = body.payload?.theme;
      const eventCount = body.payload?.eventCount;
      const timeZone = body.payload?.timeZone;

      if (
        !isWallpaperPreset(preset) ||
        typeof theme !== 'string' ||
        !listAvailableThemeIds(account.user.customThemes).includes(theme) ||
        !isEventCount(eventCount) ||
        typeof timeZone !== 'string' ||
        !isValidTimeZone(timeZone)
      ) {
        return jsonResponse(
          { error: 'Check the appearance settings and try again' },
          400,
        );
      }

      const selectedPreset = WALLPAPER_PRESETS[preset];

      await updatePreferences(account.token, {
        theme,
        timeRange: selectedPreset.timeRange,
        presentation: selectedPreset.presentation,
        eventCount,
        timeZone,
      });

      return refreshedState(account.token);
    }

    if (body.action === 'start-google') {
      const browserNonce = createGoogleBrowserNonce();
      const returnUrl = `${new URL(req.url).origin}/api/telegram/app`;
      const authorizationUrl = await createGoogleAuthorization(
        account.token,
        returnUrl,
        browserNonce,
      );
      const sessionId = crypto.randomUUID();
      const capability = createGoogleLaunchCapability();

      await getRedis().set<TelegramAppSession>(
        `telegram:app:session:${sessionId}`,
        { token: account.token, userId: account.userId },
        { ex: TELEGRAM_APP_SESSION_SECONDS },
      );

      await getRedis().set<TelegramGoogleLaunch>(
        `telegram:google:launch:${capability}`,
        {
          authorizationUrl,
          browserNonce,
          sessionId,
        },
        { ex: TELEGRAM_APP_SESSION_SECONDS },
      );

      return jsonResponse({
        handoffUrl: `${new URL(req.url).origin}/api/google/handoff#${capability}`,
      });
    }

    return jsonResponse({ error: 'Unknown app action' }, 400);
  } catch (error) {
    if (error instanceof ActionRateLimitError) {
      const response = jsonResponse({ error: error.message }, 429);

      response.headers.set('Retry-After', String(error.retryAfterSeconds));

      return response;
    }

    if (
      error instanceof Error &&
      [
        'Unable to list Google calendars',
        'Unable to sync Google Calendar',
        'Too many visible Google calendars',
        'Google Calendar returned too many calendar pages',
        'Google Calendar returned too many event pages',
      ].includes(error.message)
    ) {
      return jsonResponse(
        { error: 'Google Calendar could not finish syncing. Please try again.' },
        502,
      );
    }

    return apiErrorResponse(error, 'Telegram control panel request failed');
  }
}

async function resolveTelegramAccount(
  req: Request,
  initData: string,
): Promise<TelegramAccount | null> {
  const redis = getRedis();
  const verified = initData ? await verifyTelegramInitData(initData) : null;
  let token: string | null = null;
  let userId: string | null = null;

  if (verified) {
    userId = verified.userId;
    token = await redis.get<string>(`telegram:user:${userId}`);
  } else {
    const sessionId = readCookie(req, TELEGRAM_APP_SESSION_COOKIE);

    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      return null;
    }

    const session = await redis.get<TelegramAppSession>(
      `telegram:app:session:${sessionId}`,
    );

    if (!session) {
      return null;
    }

    userId = session.userId;
    token = session.token;
  }

  const user = token ? await getUser(token) : null;
  const mappedToken = userId ? await redis.get<string>(`telegram:user:${userId}`) : null;

  if (
    !token ||
    !userId ||
    mappedToken !== token ||
    !user?.telegram ||
    user.telegram.userId !== userId
  ) {
    return null;
  }

  return { token, user, userId };
}

async function enforceActionRate(userId: string, action: string): Promise<void> {
  const seconds =
    action === 'sync-google'
      ? SYNC_RATE_SECONDS
      : action === 'preview'
        ? PREVIEW_RATE_SECONDS
        : MUTATION_RATE_SECONDS;
  const acquired = await getRedis().set(
    `telegram:app:rate:${userId}:${action}`,
    crypto.randomUUID(),
    { nx: true, ex: seconds },
  );

  if (!acquired) {
    throw new ActionRateLimitError(seconds);
  }
}

async function refreshedState(token: string): Promise<Response> {
  return jsonResponse(await readRefreshedState(token));
}

async function readRefreshedState(token: string): Promise<ReturnType<typeof appState>> {
  const user = await getUser(token);

  if (!user) {
    throw new Error('Linked account no longer exists');
  }

  return appState(user);
}

function appState(user: UserData) {
  const selected = new Set(user.selectedEventIds);
  const shortcutUrl = publicShortcutUrl();

  return {
    name: user.name || 'Your wallpaper',
    appearance: {
      eventCount: user.eventCount,
      eventCounts: EVENT_COUNTS,
      preset: findWallpaperPreset(user.timeRange, user.presentation),
      presets: Object.values(WALLPAPER_PRESETS).map(({ id, label }) => ({ id, label })),
      theme: user.theme,
      themes: listAvailableThemeIds(user.customThemes),
      timeZone: user.timeZone,
    },
    google: {
      cachedAt: user.cachedCalAt || null,
      connected: user.googleAccounts.length > 0,
      events: user.cachedCalEvents.map((event) => ({
        calendarName: event.calendarName ?? 'Calendar',
        date: event.date,
        id: event.id,
        name: event.name,
        selected: selected.has(event.id),
      })),
      trackedCount: user.selectedEventIds.length,
    },
    manualEvents: user.events.map(({ id, name, date }) => ({ id, name, date })),
    setup: {
      hasEvents: user.events.length + user.selectedEventIds.length > 0,
      shortcutConfigured: Boolean(shortcutUrl),
    },
    shortcut: shortcutUrl ? { available: true, url: shortcutUrl } : { available: false },
  };
}

function publicShortcutUrl(): string | null {
  const value = process.env.PUBLIC_SHORTCUT_INSTALL_URL?.trim();

  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function parseAppRequest(
  req: Request,
): Promise<AppRequestBody | 'too-large' | null> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return null;
  }

  const length = Number(req.headers.get('content-length') ?? 0);

  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return 'too-large';
  }

  const bytes = await readBoundedBody(req);

  if (bytes === 'too-large') {
    return 'too-large';
  }

  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const body = value as Record<string, unknown>;

  if (
    Object.keys(body).some((key) => !['action', 'initData', 'payload'].includes(key)) ||
    typeof body.action !== 'string' ||
    !/^[a-z-]{1,32}$/.test(body.action) ||
    typeof body.initData !== 'string' ||
    body.initData.length > 4096 ||
    (body.payload !== undefined &&
      (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)))
  ) {
    return null;
  }

  return {
    action: body.action,
    initData: body.initData,
    payload: body.payload as Record<string, unknown> | undefined,
  };
}

async function readBoundedBody(req: Request): Promise<Uint8Array | 'too-large'> {
  if (!req.body) {
    return new Uint8Array();
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();

      return 'too-large';
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');

  return !origin || origin === new URL(req.url).origin;
}

function contentSecurityNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

function createGoogleLaunchCapability(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GOOGLE_LAUNCH_CAPABILITY_BYTES));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function appHeaders(nonce: string): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://telegram.org`,
      `style-src 'nonce-${nonce}'`,
      "img-src 'self' blob: data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      'frame-ancestors https://web.telegram.org https://*.telegram.org',
    ].join('; '),
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function appPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1C1C1C">
  <title>Calendar Lockscreen</title>
  <script nonce="${nonce}" src="https://telegram.org/js/telegram-web-app.js"></script>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; }
    :root {
      color-scheme: dark;
      --bg: #1C1C1C;
      --panel: #232323;
      --raised: #2A2A2A;
      --border: #383838;
      --text: #E5E5E5;
      --muted: #A1A1A1;
      --accent: #FF6B35;
      --telegram: #82BFE8;
      --danger: #FF8787;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
    }
    html { background: var(--bg); scroll-behavior: smooth; }
    body {
      margin: 0;
      min-width: 320px;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      font-family: "Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .shell { width: min(100% - 28px, 720px); margin: 0 auto; padding: 20px 0 calc(48px + env(safe-area-inset-bottom)); }
    .topbar { display: flex; align-items: center; justify-content: space-between; min-height: 44px; margin-bottom: 18px; }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; }
    .mark { display: grid; width: 26px; height: 26px; grid-template-columns: repeat(3, 4px); place-content: center; gap: 3px; border: 1px solid #484848; border-radius: 8px; }
    .mark i { width: 4px; height: 4px; border-radius: 50%; background: #8A8A8A; }
    .mark i:nth-child(-n+4) { background: var(--text); }
    .mark i:nth-child(5) { background: var(--accent); }
    .eyebrow { margin: 0; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 10px; font-size: clamp(30px, 9vw, 46px); font-weight: 550; letter-spacing: -.025em; line-height: 1.02; }
    h2 { margin-bottom: 6px; font-size: 20px; font-weight: 650; }
    h3 { margin-bottom: 4px; font-size: 15px; }
    .muted { color: var(--muted); font-size: 14px; }
    .hero { margin-bottom: 18px; }
    .preview { position: relative; min-height: 300px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: #151515; }
    .preview img { display: block; width: 100%; aspect-ratio: 1284 / 1800; object-fit: cover; object-position: top center; opacity: 0; transform: scale(.985); transition: opacity 350ms var(--ease), transform 450ms var(--ease); }
    .preview img.ready { opacity: 1; transform: scale(1); }
    .preview-state { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 13px; }
    .stack { display: grid; gap: 12px; margin-top: 12px; }
    .card { padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
    .card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .progress { display: flex; gap: 5px; margin-top: 14px; }
    .progress span { height: 3px; flex: 1; border-radius: 999px; background: #484848; transition: background 260ms var(--ease); }
    .progress span.done { background: var(--accent); }
    .button { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); color: #171717; font-weight: 750; transition: transform 120ms cubic-bezier(.2,0,0,1), background 120ms cubic-bezier(.2,0,0,1); }
    .button:active { transform: scale(.985); }
    .button.secondary { border-color: var(--border); background: var(--raised); color: var(--text); }
    .button.quiet { min-height: 36px; padding: 0 12px; border-color: transparent; background: transparent; color: var(--telegram); }
    .button.danger { border-color: transparent; background: transparent; color: var(--danger); }
    .button:disabled { cursor: default; opacity: .45; transform: none; }
    .primary { width: 100%; margin-top: 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .row > * { flex: 1 1 150px; }
    label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 650; }
    input, select { width: 100%; min-height: 46px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; outline: none; background: #1D1D1D; color: var(--text); }
    input:focus, select:focus { border-color: #6A6A6A; box-shadow: 0 0 0 3px rgb(255 255 255 / 5%); }
    details { border-top: 1px solid var(--border); }
    summary { display: flex; min-height: 52px; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; font-weight: 700; }
    summary::-webkit-details-marker { display: none; }
    summary::after { content: '›'; color: var(--muted); font-size: 20px; transform: rotate(90deg); transition: transform 220ms var(--ease); }
    details[open] summary::after { transform: rotate(-90deg); }
    .details-body { padding: 0 0 18px; animation: enter 320ms var(--ease) both; }
    .event-list { display: grid; gap: 8px; margin: 14px 0 0; }
    .event { display: flex; min-height: 52px; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: #202020; }
    .event-copy { min-width: 0; flex: 1; }
    .event-copy strong, .event-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-copy span { color: var(--muted); font-size: 12px; }
    .check { display: flex; align-items: center; gap: 10px; }
    .check input { width: 20px; min-height: 20px; flex: 0 0 auto; accent-color: var(--accent); }
    .status { min-height: 20px; margin: 10px 0 0; color: var(--muted); font-size: 13px; transition: color 180ms var(--ease); }
    .status.error { color: var(--danger); }
    .hidden { display: none !important; }
    @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar">
      <div class="brand"><span class="mark" aria-hidden="true">${'<i></i>'.repeat(9)}</span>Calendar Lockscreen</div>
      <button id="closeButton" class="button quiet" type="button">Done</button>
    </div>

    <section class="hero">
      <p class="eyebrow">Your time, at a glance</p>
      <h1 id="greeting">Setting up your wallpaper</h1>
      <p id="heroCopy" class="muted">Loading your private preview…</p>
    </section>

    <section class="preview" aria-label="Current wallpaper preview">
      <div id="previewState" class="preview-state">Preparing preview…</div>
      <img id="previewImage" alt="Your current Calendar Lockscreen wallpaper preview">
    </section>

    <div class="stack">
      <section class="card">
        <div class="card-head">
          <div><h2>Make it yours</h2><p id="setupCopy" class="muted">One useful date is enough to begin.</p></div>
          <span id="setupCount" class="eyebrow">0 / 2</span>
        </div>
        <div class="progress" aria-hidden="true"><span id="eventProgress"></span><span id="shortcutProgress"></span></div>
        <button id="primaryButton" class="button primary" type="button">Add your first event</button>
      </section>

      <section class="card">
        <details id="eventsPanel">
          <summary>Events</summary>
          <div class="details-body">
            <form id="eventForm">
              <div class="row">
                <label>Event name<input id="eventName" maxlength="50" autocomplete="off" placeholder="Trip to Cape Town" required></label>
                <label>Date<input id="eventDate" type="date" required></label>
              </div>
              <button class="button primary" type="submit">Add event</button>
            </form>
            <div id="manualEvents" class="event-list"></div>
          </div>
        </details>

        <details id="googlePanel">
          <summary>Google Calendar</summary>
          <div class="details-body">
            <p id="googleSummary" class="muted">Checking connection…</p>
            <div class="row">
              <button id="googleConnect" class="button secondary" type="button">Connect Google</button>
              <button id="googleSync" class="button secondary" type="button">Sync now</button>
            </div>
            <div id="googleEvents" class="event-list"></div>
            <button id="saveGoogle" class="button primary hidden" type="button">Use selected events</button>
          </div>
        </details>

        <details id="lookPanel">
          <summary>Change the look</summary>
          <div class="details-body">
            <div class="row">
              <label>Style<select id="preset"></select></label>
              <label>Theme<select id="theme"></select></label>
            </div>
            <div class="row">
              <label>Events shown<select id="eventCount"></select></label>
              <label>Time zone<input id="timeZone" autocomplete="off"></label>
            </div>
            <button id="saveAppearance" class="button primary" type="button">Update preview</button>
          </div>
        </details>
      </section>

      <section class="card">
        <h2>Put it on your iPhone</h2>
        <p id="shortcutCopy" class="muted">The shared Shortcut is being prepared.</p>
        <button id="installShortcut" class="button primary" type="button" disabled>Shortcut coming soon</button>
      </section>

      <p id="status" class="status" role="status" aria-live="polite"></p>
    </div>
  </main>

  <script nonce="${nonce}">
    (() => {
      const telegram = window.Telegram && window.Telegram.WebApp;
      const initData = telegram ? telegram.initData : '';
      let state = null;
      let previewUrl = null;
      let previewRetryTimer = null;
      const byId = (id) => document.getElementById(id);

      if (telegram) {
        telegram.ready();
        telegram.expand();
        telegram.setHeaderColor('#1C1C1C');
        telegram.setBackgroundColor('#1C1C1C');
      }

      byId('closeButton').addEventListener('click', () => telegram ? telegram.close() : window.close());

      async function request(action, payload) {
        const response = await fetch('/api/telegram/app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, initData, payload }),
        });
        const data = await response.json().catch(() => ({ error: 'Unexpected response' }));

        if (!response.ok) throw new Error(data.error || 'Request failed');

        return data;
      }

      async function loadPreview() {
        if (!previewUrl) {
          byId('previewState').textContent = 'Updating preview…';
          byId('previewState').classList.remove('hidden');
        }

        const response = await fetch('/api/telegram/app', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview', initData }),
        });

        if (response.status === 429) {
          schedulePreviewRetry(response.headers.get('Retry-After'));

          return false;
        }

        if (!response.ok) throw new Error('Could not load the wallpaper preview');
        if (previewUrl) URL.revokeObjectURL(previewUrl);

        previewUrl = URL.createObjectURL(await response.blob());
        byId('previewImage').src = previewUrl;
        byId('previewImage').onload = () => {
          byId('previewImage').classList.add('ready');
          byId('previewState').classList.add('hidden');
        };

        return true;
      }

      function schedulePreviewRetry(retryAfter) {
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3000;

        if (previewRetryTimer) window.clearTimeout(previewRetryTimer);

        previewRetryTimer = window.setTimeout(() => {
          previewRetryTimer = null;
          loadPreview().catch(() => {
            if (!previewUrl) byId('previewState').textContent = 'Preview will update shortly.';
          });
        }, delay);
      }

      function setStatus(message, error = false) {
        byId('status').textContent = message;
        byId('status').classList.toggle('error', error);
      }

      function fillSelect(select, options, value) {
        select.replaceChildren();
        options.forEach((option) => {
          const element = document.createElement('option');
          const item = typeof option === 'string' ? { id: option, label: title(option) } : option;

          element.value = item.id;
          element.textContent = item.label;
          element.selected = item.id === value;
          select.appendChild(element);
        });
      }

      function title(value) {
        return value.replace(/-/g, ' ').replace(/\\b\\w/g, (letter) => letter.toUpperCase());
      }

      function render(next) {
        state = next;
        const complete = Number(next.setup.hasEvents) + Number(next.setup.shortcutConfigured);

        byId('greeting').textContent = next.setup.hasEvents ? 'Your wallpaper is taking shape.' : 'Start with one important date.';
        byId('heroCopy').textContent = next.setup.hasEvents ? 'Every change appears in the preview before it reaches your Lock Screen.' : 'Add an event or connect Google Calendar. Everything else can wait.';
        byId('setupCount').textContent = complete + ' / 2';
        byId('eventProgress').classList.toggle('done', next.setup.hasEvents);
        byId('shortcutProgress').classList.toggle('done', next.setup.shortcutConfigured);
        byId('setupCopy').textContent = next.setup.hasEvents ? (next.setup.shortcutConfigured ? 'Ready for your next wallpaper refresh.' : 'Your calendar is ready. Install the Shortcut next.') : 'One useful date is enough to begin.';
        byId('primaryButton').textContent = next.setup.hasEvents ? (next.shortcut.available ? 'Install the iPhone Shortcut' : 'Preview your events') : 'Add your first event';

        renderManualEvents(next.manualEvents);
        renderGoogle(next.google);
        fillSelect(byId('preset'), next.appearance.presets, next.appearance.preset);
        fillSelect(byId('theme'), next.appearance.themes, next.appearance.theme);
        fillSelect(byId('eventCount'), next.appearance.eventCounts.map((value) => ({ id: String(value), label: String(value) })), String(next.appearance.eventCount));
        byId('timeZone').value = next.appearance.timeZone;

        const install = byId('installShortcut');
        install.disabled = !next.shortcut.available;
        install.textContent = next.shortcut.available ? 'Install iPhone Shortcut' : 'Shortcut coming soon';
        byId('shortcutCopy').textContent = next.shortcut.available ? 'Install once, run a test refresh, then optionally add a daily automation.' : 'Your wallpaper is usable now; the shared one-step installer has not been published on this deployment yet.';
      }

      function renderManualEvents(events) {
        const list = byId('manualEvents');
        list.replaceChildren();

        events.forEach((event) => {
          const row = document.createElement('div');
          row.className = 'event';
          const copy = document.createElement('div');
          copy.className = 'event-copy';
          const name = document.createElement('strong');
          const date = document.createElement('span');
          const remove = document.createElement('button');

          name.textContent = event.name;
          date.textContent = event.date;
          remove.className = 'button danger';
          remove.type = 'button';
          remove.textContent = 'Remove';
          remove.addEventListener('click', () => mutate('delete-event', { eventId: event.id }, 'Event removed.'));
          copy.append(name, date);
          row.append(copy, remove);
          list.appendChild(row);
        });
      }

      function renderGoogle(google) {
        byId('googleConnect').classList.toggle('hidden', google.connected);
        byId('googleSync').classList.toggle('hidden', !google.connected);
        byId('googleSummary').textContent = google.connected ? (google.events.length ? google.events.length + ' upcoming events found. Choose what belongs on the wallpaper.' : 'Connected. Sync to look for upcoming events across your visible calendars.') : 'Connect Google Calendar after your first preview, or keep adding events manually.';
        const list = byId('googleEvents');
        list.replaceChildren();

        google.events.forEach((event) => {
          const label = document.createElement('label');
          label.className = 'event check';
          const input = document.createElement('input');
          const copy = document.createElement('span');
          copy.className = 'event-copy';
          const name = document.createElement('strong');
          const meta = document.createElement('span');

          input.type = 'checkbox';
          input.value = event.id;
          input.checked = event.selected;
          name.textContent = event.name;
          meta.textContent = event.date + ' · ' + event.calendarName;
          copy.append(name, meta);
          label.append(input, copy);
          list.appendChild(label);
        });

        byId('saveGoogle').classList.toggle('hidden', !google.events.length);
      }

      async function mutate(action, payload, success) {
        let next;

        try {
          setStatus('Saving…');
          next = await request(action, payload);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Could not save the change', true);

          return false;
        }

        render(next);

        try {
          const previewUpdated = await loadPreview();
          setStatus(previewUpdated ? success : success + ' Preview will update shortly.');
        } catch {
          setStatus(success + ' The preview will catch up in a moment.');
        }

        return true;
      }

      byId('primaryButton').addEventListener('click', () => {
        if (state && state.setup.hasEvents && state.shortcut.available) return openShortcut();
        byId('eventsPanel').open = true;
        byId('eventsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        byId('eventName').focus();
      });

      byId('eventForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const added = await mutate('add-event', { name: byId('eventName').value, date: byId('eventDate').value }, 'Event added. Your preview is updated.');

        if (added) byId('eventForm').reset();
      });

      byId('googleSync').addEventListener('click', async () => {
        try {
          setStatus('Checking your visible Google calendars…');
          const next = await request('sync-google');
          render(next);
          byId('googlePanel').open = true;
          setStatus(syncMessage(next.sync));
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Google Calendar could not sync', true);
        }
      });

      byId('googleConnect').addEventListener('click', async () => {
        try {
          setStatus('Opening Google…');
          const result = await request('start-google');
          if (telegram && telegram.openLink) telegram.openLink(result.handoffUrl);
          else window.location.assign(result.handoffUrl);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Could not open Google', true);
        }
      });

      byId('saveGoogle').addEventListener('click', () => {
        const eventIds = Array.from(byId('googleEvents').querySelectorAll('input:checked')).map((input) => input.value);
        mutate('select-google', { eventIds }, 'Google events updated on your wallpaper.');
      });

      byId('saveAppearance').addEventListener('click', () => mutate('save-appearance', {
        preset: byId('preset').value,
        theme: byId('theme').value,
        eventCount: Number(byId('eventCount').value),
        timeZone: byId('timeZone').value.trim(),
      }, 'Look updated.'));

      function syncMessage(sync) {
        if (sync.status === 'empty_window') return 'No upcoming events were found in the next year.';
        if (sync.status === 'no_calendars') return 'No visible Google calendars were found.';
        if (sync.status === 'needs_selection') return sync.fetchedEventCount + ' events found. Choose the ones you want to track.';
        if (sync.status === 'not_connected') return 'Connect Google Calendar first.';
        return sync.fetchedEventCount + ' events found · ' + sync.trackedEventCount + ' tracked.';
      }

      function openShortcut() {
        if (!state || !state.shortcut.available) return;
        if (telegram && telegram.openLink) telegram.openLink(state.shortcut.url);
        else window.location.assign(state.shortcut.url);
      }

      byId('installShortcut').addEventListener('click', openShortcut);

      request('bootstrap')
        .then(async (initial) => {
          render(initial);
          await loadPreview();

          if (new URLSearchParams(window.location.search).get('google') === 'connected') {
            byId('googlePanel').open = true;
            setStatus('Google Calendar connected. Tap Sync now to choose events.');
          } else if (new URLSearchParams(window.location.search).get('google') === 'error') {
            byId('googlePanel').open = true;
            setStatus('Google Calendar could not connect. Please try again.', true);
          }
        })
        .catch((error) => {
          if (!initData) {
            byId('previewState').textContent = 'Open this control panel from the Telegram bot.';
            byId('heroCopy').textContent = 'Telegram securely identifies your account without exposing a password or wallpaper key.';
            byId('primaryButton').disabled = true;
          }

          setStatus(error instanceof Error ? error.message : 'Could not open the control panel', true);
        });
    })();
  </script>
</body>
</html>`;
}
