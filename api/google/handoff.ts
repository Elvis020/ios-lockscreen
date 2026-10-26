import {
  googleOAuthCookie,
  telegramAppSessionCookie,
} from '../../lib/calendar/oauthSession';
import { jsonResponse } from '../../lib/http';
import { getRedis } from '../../lib/redis';

export const config = { runtime: 'edge' };

const MAX_BODY_BYTES = 512;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface TelegramGoogleLaunch {
  authorizationUrl: string;
  browserNonce: string;
  sessionId: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const nonce = contentSecurityNonce();

    return new Response(handoffPage(nonce), {
      headers: handoffHeaders(nonce),
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (req.headers.get('Origin') !== new URL(req.url).origin) {
    return invalidLaunchResponse();
  }

  const capability = await parseCapability(req);

  if (!capability) {
    return invalidLaunchResponse();
  }

  const launch = await getRedis().getdel<TelegramGoogleLaunch>(
    `telegram:google:launch:${capability}`,
  );

  if (!isValidLaunch(launch)) {
    return invalidLaunchResponse();
  }

  const response = jsonResponse({ authorizationUrl: launch.authorizationUrl });

  response.headers.append('Set-Cookie', googleOAuthCookie(launch.browserNonce));
  response.headers.append('Set-Cookie', telegramAppSessionCookie(launch.sessionId));

  return response;
}

async function parseCapability(req: Request): Promise<string | null> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return null;
  }

  const length = Number(req.headers.get('content-length') ?? 0);

  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return null;
  }

  const bytes = await readBoundedBody(req);

  if (!bytes) {
    return null;
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
    Object.keys(body).length !== 1 ||
    !CAPABILITY_PATTERN.test(String(body.capability))
  ) {
    return null;
  }

  return typeof body.capability === 'string' ? body.capability : null;
}

async function readBoundedBody(req: Request): Promise<Uint8Array | null> {
  if (!req.body) {
    return null;
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    length += value.byteLength;

    if (length > MAX_BODY_BYTES) {
      await reader.cancel();

      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

function isValidLaunch(
  launch: TelegramGoogleLaunch | null,
): launch is TelegramGoogleLaunch {
  if (
    !launch ||
    typeof launch.browserNonce !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(launch.browserNonce) ||
    typeof launch.sessionId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(launch.sessionId) ||
    typeof launch.authorizationUrl !== 'string'
  ) {
    return false;
  }

  try {
    const authorizationUrl = new URL(launch.authorizationUrl);

    return authorizationUrl.origin === 'https://accounts.google.com';
  } catch {
    return false;
  }
}

function invalidLaunchResponse(): Response {
  return jsonResponse(
    { error: 'Google authorization launch is invalid or expired' },
    400,
  );
}

function contentSecurityNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

function handoffHeaders(nonce: string): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function handoffPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connecting Google Calendar</title>
</head>
<body>
  <p id="status">Opening Google Calendar…</p>
  <script nonce="${nonce}">
    (() => {
      const status = document.getElementById('status');
      const capability = window.location.hash.slice(1);

      window.history.replaceState(null, '', window.location.pathname);

      fetch('/api/google/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability }),
      })
        .then(async (response) => {
          const result = await response.json().catch(() => null);

          if (!response.ok || !result || typeof result.authorizationUrl !== 'string') {
            throw new Error('invalid launch');
          }

          window.location.replace(result.authorizationUrl);
        })
        .catch(() => {
          status.textContent = 'This Google connection link is invalid or has expired. Return to Telegram and try again.';
        });
    })();
  </script>
</body>
</html>`;
}
