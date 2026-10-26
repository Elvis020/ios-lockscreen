export const GOOGLE_OAUTH_COOKIE = 'calendar_google_oauth';
export const GOOGLE_OAUTH_MAX_AGE_SECONDS = 600;
export const TELEGRAM_APP_SESSION_COOKIE = 'calendar_telegram_app';
export const TELEGRAM_APP_SESSION_SECONDS = 600;

export function createGoogleBrowserNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return toBase64Url(bytes);
}

export async function hashGoogleBrowserNonce(nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));

  return toBase64Url(new Uint8Array(digest));
}

export function securelyEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [candidateName, ...valueParts] = part.trim().split('=');

    if (candidateName === name) {
      return valueParts.join('=') || null;
    }
  }

  return null;
}

export function googleOAuthCookie(nonce: string): string {
  return `${GOOGLE_OAUTH_COOKIE}=${nonce}; Path=/api/google/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${GOOGLE_OAUTH_MAX_AGE_SECONDS}`;
}

export function telegramAppSessionCookie(sessionId: string): string {
  return `${TELEGRAM_APP_SESSION_COOKIE}=${sessionId}; Path=/api/telegram/app; HttpOnly; Secure; SameSite=Lax; Max-Age=${TELEGRAM_APP_SESSION_SECONDS}`;
}

export function clearGoogleOAuthCookie(): string {
  return `${GOOGLE_OAUTH_COOKIE}=; Path=/api/google/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
