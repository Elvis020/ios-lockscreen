import { apiErrorResponse, jsonResponse } from '../../lib/http';
import { getRedis } from '../../lib/redis';
import { commitIfLeasesOwned, deleteRedisKeyIfValue } from '../../lib/redisLock';
import { escapeTelegramHtml, sendTelegramMessage } from '../../lib/telegramBot';
import {
  formatTelegramEventDate,
  getTelegramDraft,
  updateTelegramDraftDate,
} from '../../lib/telegramDrafts';
import { verifyTelegramInitData } from '../../lib/telegramMiniAppAuth';
import { getUser } from '../../lib/tokenManager';
import { isValidDateString } from '../../lib/validation';

export const config = { runtime: 'edge' };

const MAX_BODY_BYTES = 8192;
const PROCESSING_LEASE_SECONDS = 30;
const DONE_TTL_SECONDS = 600;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const nonce = contentSecurityNonce();

    return new Response(calendarPage(nonce), {
      headers: calendarHeaders(nonce),
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415);
  }

  const contentLength = Number(req.headers.get('content-length') ?? 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Calendar request is too large' }, 413);
  }

  try {
    const body = await parseCalendarRequest(req);

    if (body === 'too-large') {
      return jsonResponse({ error: 'Calendar request is too large' }, 413);
    }

    if (!body) {
      return jsonResponse({ error: 'Invalid calendar request' }, 400);
    }

    const verified = await verifyTelegramInitData(body.initData);

    if (!verified) {
      return jsonResponse({ error: 'Telegram authorization failed' }, 401);
    }

    const redis = getRedis();
    const token = await redis.get<string>(`telegram:user:${verified.userId}`);
    const draft = await getTelegramDraft(verified.userId);

    if (!token || !draft || draft.id !== body.draftId || draft.token !== token) {
      return jsonResponse({ error: 'Event draft is unavailable' }, 409);
    }

    const user = await getUser(token);

    if (
      !user?.telegram ||
      user.telegram.userId !== verified.userId ||
      user.telegram.chatId !== draft.chatId
    ) {
      return jsonResponse({ error: 'Telegram link is unavailable' }, 401);
    }

    if (body.action === 'bootstrap') {
      if (!isActiveDateStep(draft)) {
        return jsonResponse({ error: 'Event draft is unavailable' }, 409);
      }

      return jsonResponse({ timeZone: user.timeZone });
    }

    const requestKey = `telegram:calendar:request:${verified.userId}:${body.requestId}`;
    const requestState = await redis.get<string>(requestKey);

    if (requestState === 'done') {
      return jsonResponse({ ok: true, duplicate: true });
    }

    if (requestState) {
      return jsonResponse({ error: 'Calendar request is still processing' }, 409);
    }

    if (!isActiveDateStep(draft)) {
      return jsonResponse({ error: 'Event draft is unavailable' }, 409);
    }

    const requestLease = crypto.randomUUID();
    const acquired = await redis.set(requestKey, requestLease, {
      nx: true,
      ex: PROCESSING_LEASE_SECONDS,
    });

    if (!acquired) {
      const currentState = await redis.get<string>(requestKey);

      return currentState === 'done'
        ? jsonResponse({ ok: true, duplicate: true })
        : jsonResponse({ error: 'Calendar request is still processing' }, 409);
    }

    try {
      const rateKey = `telegram:calendar:rate:${verified.userId}`;
      const rateLease = await redis.set(rateKey, body.requestId, { nx: true, ex: 2 });

      if (!rateLease) {
        await deleteRedisKeyIfValue(redis, requestKey, requestLease);

        return jsonResponse({ error: 'Please wait before choosing another date' }, 429);
      }

      const updated = await updateTelegramDraftDate(
        verified.userId,
        draft.id,
        body.date,
        draft.revision,
      );

      if (!updated) {
        await deleteRedisKeyIfValue(redis, requestKey, requestLease);

        return jsonResponse({ error: 'Event draft expired' }, 409);
      }

      const prefix = `ev:${updated.id}:${updated.revision}:`;
      const editing = updated.operation === 'edit';

      await sendTelegramMessage(
        updated.chatId,
        [
          `<b>${editing ? 'Review changes' : 'Save this event?'}</b>`,
          `Event: <b>${escapeTelegramHtml(updated.name)}</b>`,
          `Date: <b>${escapeTelegramHtml(formatTelegramEventDate(body.date))}</b>`,
        ].join('\n'),
        {
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [
              [
                {
                  text: editing ? 'Save changes' : 'Save event',
                  callback_data: `${prefix}save`,
                },
              ],
              ...(editing
                ? [[{ text: 'Change name', callback_data: `${prefix}name` }]]
                : []),
              [{ text: 'Change date', callback_data: `${prefix}date` }],
              [{ text: 'Cancel', callback_data: `${prefix}cancel` }],
            ],
          },
        },
      );

      await commitIfLeasesOwned(
        redis,
        [{ key: requestKey, owner: requestLease }],
        [{ key: requestKey, value: 'done', ttlSeconds: DONE_TTL_SECONDS }],
      );

      return jsonResponse({ ok: true });
    } catch (error) {
      await deleteRedisKeyIfValue(redis, requestKey, requestLease);

      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error, 'Telegram calendar request failed');
  }
}

function isActiveDateStep(draft: Awaited<ReturnType<typeof getTelegramDraft>>): boolean {
  return Boolean(draft && (draft.step === 'date' || (!draft.operation && !draft.date)));
}

interface CalendarDateRequestBody {
  action?: undefined;
  draftId: string;
  date: string;
  requestId: string;
  initData: string;
}

interface CalendarBootstrapRequestBody {
  action: 'bootstrap';
  draftId: string;
  initData: string;
}

type CalendarRequestBody = CalendarDateRequestBody | CalendarBootstrapRequestBody;

async function parseCalendarRequest(
  req: Request,
): Promise<CalendarRequestBody | 'too-large' | null> {
  let body: Record<string, unknown>;
  const bytes = await readCalendarRequestBytes(req);

  if (bytes === 'too-large') {
    return 'too-large';
  }

  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (key) => !['action', 'draftId', 'date', 'requestId', 'initData'].includes(key),
    )
  ) {
    return null;
  }

  const draftId = typeof body.draftId === 'string' ? body.draftId : '';
  const initData = typeof body.initData === 'string' ? body.initData : '';

  if (
    (body.action !== undefined && body.action !== 'bootstrap') ||
    !/^[A-Za-z0-9_-]{12,32}$/.test(draftId) ||
    !initData ||
    initData.length > 4096
  ) {
    return null;
  }

  if (body.action === 'bootstrap') {
    if (body.date !== undefined || body.requestId !== undefined) {
      return null;
    }

    return { action: 'bootstrap', draftId, initData };
  }

  const date = typeof body.date === 'string' ? body.date : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';

  if (!isValidDateString(date) || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
    return null;
  }

  return { draftId, date, requestId, initData };
}

async function readCalendarRequestBytes(req: Request): Promise<Uint8Array | 'too-large'> {
  const reader = req.body?.getReader();

  if (!reader) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
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
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function calendarHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://telegram.org`,
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      'img-src data:',
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
    ].join('; '),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function contentSecurityNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let value = '';

  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }

  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function calendarPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Choose date</title>
    <script src="https://telegram.org/js/telegram-web-app.js?64"></script>
    <style>
      :root { color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #1C1C1C; color: #E5E5E5; }
      button { font: inherit; }
      main { width: min(100%, 440px); margin: 0 auto; padding: 20px 16px calc(24px + env(safe-area-inset-bottom)); }
      .eyebrow { margin: 0 0 6px; color: #A1A1A1; font-size: 13px; font-weight: 600; }
      h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -0.15px; }
      .calendar { margin-top: 20px; padding: 14px; border: 1px solid #343434; border-radius: 12px; background: #232323; }
      .toolbar { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; gap: 8px; }
      .month { text-align: center; font-size: 16px; font-weight: 700; }
      .icon { width: 40px; height: 40px; border: 1px solid #3C3C3C; border-radius: 8px; background: #2A2A2A; color: #E5E5E5; font-size: 22px; }
      .weekdays, .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
      .weekdays { margin-top: 16px; color: #8F8F8F; font-size: 11px; font-weight: 700; text-align: center; }
      .days { margin-top: 8px; }
      .day { aspect-ratio: 1; border: 0; border-radius: 8px; background: transparent; color: #E5E5E5; }
      .day:hover { background: #303030; }
      .day.today { box-shadow: inset 0 0 0 1px #646464; }
      .day.selected { background: #E5E5E5; color: #1C1C1C; font-weight: 800; }
      .day.blank { pointer-events: none; }
      .selection { min-height: 22px; margin: 16px 2px 0; color: #A1A1A1; font-size: 14px; }
      .primary { width: 100%; margin-top: 12px; padding: 13px 16px; border: 0; border-radius: 8px; background: #E5E5E5; color: #1C1C1C; font-weight: 800; }
      .primary:disabled { opacity: 0.42; }
      .status { min-height: 20px; margin: 10px 2px 0; color: #A1A1A1; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Calendar Lockscreen</p>
      <h1>Choose a date</h1>
      <section class="calendar" aria-label="Date picker">
        <div class="toolbar">
          <button class="icon" id="previous" type="button" aria-label="Previous month">‹</button>
          <div class="month" id="month" aria-live="polite"></div>
          <button class="icon" id="next" type="button" aria-label="Next month">›</button>
        </div>
        <div class="weekdays" aria-hidden="true">
          <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
        </div>
        <div class="days" id="days"></div>
        <p class="selection" id="selection">Select a day to continue.</p>
        <button class="primary" id="choose" type="button" disabled>Choose date</button>
        <p class="status" id="status" role="status" aria-live="polite"></p>
      </section>
    </main>
    <script nonce="${nonce}">
      const telegram = window.Telegram && window.Telegram.WebApp;
      const draftId = new URLSearchParams(window.location.search).get('draft');
      const monthLabel = document.querySelector('#month');
      const days = document.querySelector('#days');
      const selection = document.querySelector('#selection');
      const status = document.querySelector('#status');
      const choose = document.querySelector('#choose');
      let today = null;
      let displayed = null;
      let selectedDate = '';
      let selectionRequestId = '';

      if (telegram) {
        telegram.ready();
        telegram.expand();
        telegram.setHeaderColor('#1C1C1C');
        telegram.setBackgroundColor('#1C1C1C');
      }

      function pad(value) {
        return String(value).padStart(2, '0');
      }

      function isoDate(year, month, day) {
        return year + '-' + pad(month + 1) + '-' + pad(day);
      }

      function calendarLabel(year, month, day) {
        return new Intl.DateTimeFormat(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        }).format(new Date(Date.UTC(year, month, day)));
      }

      function localToday(timeZone) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(new Date());
        const value = function (type) {
          const part = parts.find(function (candidate) { return candidate.type === type; });
          return part ? Number(part.value) : 0;
        };

        return { year: value('year'), month: value('month') - 1, day: value('day') };
      }

      function render() {
        if (!today || !displayed) {
          return;
        }

        const year = displayed.year;
        const month = displayed.month;
        const firstWeekday = new Date(year, month, 1).getDay();
        const dayCount = new Date(year, month + 1, 0).getDate();

        monthLabel.textContent = new Intl.DateTimeFormat(undefined, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        }).format(new Date(Date.UTC(year, month, 1)));
        days.replaceChildren();

        for (let index = 0; index < firstWeekday; index += 1) {
          const blank = document.createElement('span');
          blank.className = 'day blank';
          days.append(blank);
        }

        for (let day = 1; day <= dayCount; day += 1) {
          const value = isoDate(year, month, day);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'day';
          button.textContent = String(day);
          button.setAttribute('aria-label', calendarLabel(year, month, day));

          if (value === isoDate(today.year, today.month, today.day)) {
            button.classList.add('today');
          }

          if (value === selectedDate) {
            button.classList.add('selected');
          }

          button.addEventListener('click', function () {
            if (selectedDate !== value) {
              selectedDate = value;
              selectionRequestId = createRequestId();
            }

            selection.textContent = button.getAttribute('aria-label');
            choose.disabled = false;
            render();
          });
          days.append(button);
        }
      }

      document.querySelector('#previous').addEventListener('click', function () {
        if (!displayed) {
          return;
        }

        displayed = new Date(Date.UTC(displayed.year, displayed.month - 1, 1));
        displayed = { year: displayed.getUTCFullYear(), month: displayed.getUTCMonth() };
        render();
      });

      document.querySelector('#next').addEventListener('click', function () {
        if (!displayed) {
          return;
        }

        displayed = new Date(Date.UTC(displayed.year, displayed.month + 1, 1));
        displayed = { year: displayed.getUTCFullYear(), month: displayed.getUTCMonth() };
        render();
      });

      choose.addEventListener('click', async function () {
        if (!draftId || !selectedDate || !telegram || !telegram.initData) {
          status.textContent = 'Open this calendar from the Telegram event buttons.';
          return;
        }

        choose.disabled = true;
        status.textContent = 'Sending date…';

        const requestId = selectionRequestId;

        try {
          const response = await fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              draftId: draftId,
              date: selectedDate,
              requestId: requestId,
              initData: telegram.initData
            })
          });

          if (!response.ok) {
            const payload = await response.json().catch(function () { return {}; });
            throw new Error(payload.error || 'Could not send that date.');
          }

          status.textContent = 'Date sent. Confirm the event in chat.';
          window.setTimeout(function () { telegram.close(); }, 250);
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'Could not send that date.';
          choose.disabled = false;
        }
      });

      async function initializeCalendar() {
        if (!draftId || !telegram || !telegram.initData) {
          status.textContent = 'Open this calendar from the Telegram event buttons.';
          return;
        }

        try {
          const response = await fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'bootstrap',
              draftId: draftId,
              initData: telegram.initData
            })
          });
          const payload = await response.json().catch(function () { return {}; });

          if (!response.ok || typeof payload.timeZone !== 'string') {
            throw new Error(payload.error || 'Could not open the calendar.');
          }

          today = localToday(payload.timeZone);
          displayed = { year: today.year, month: today.month };
          render();
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'Could not open the calendar.';
        }
      }

      function createRequestId() {
        return window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()) + Math.random().toString(36).slice(2);
      }

      initializeCalendar();
    </script>
  </body>
</html>`;
}
