import { isRedisConfigurationError } from './redis';
import { RedisLockTimeoutError } from './redisLock';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function apiErrorResponse(error: unknown, context: string): Response {
  if (isRedisConfigurationError(error)) {
    return jsonResponse({ error: 'Service storage is not configured' }, 503);
  }

  if (error instanceof RedisLockTimeoutError) {
    return jsonResponse({ error: error.message }, 409);
  }

  if (
    error instanceof Error &&
    error.message === 'Google accounts changed during sync; please retry'
  ) {
    return jsonResponse({ error: error.message }, 409);
  }

  if (error instanceof Error && error.message === 'Invalid management token') {
    return jsonResponse({ error: error.message }, 401);
  }

  if (
    error instanceof Error &&
    (error.message === 'Google Calendar is not configured' ||
      error.message === 'Telegram bot is not configured')
  ) {
    return jsonResponse({ error: error.message }, 503);
  }

  if (error instanceof Error && isSafeClientError(error.message)) {
    return jsonResponse({ error: error.message }, 400);
  }

  console.error(`${context}:`, error);

  return jsonResponse({ error: 'Internal server error' }, 500);
}

function isSafeClientError(message: string): boolean {
  return (
    message.startsWith('Maximum ') ||
    message === 'Event not found' ||
    message === 'Unknown theme' ||
    message === 'Built-in theme names are reserved' ||
    message === 'One or more calendar events are unavailable' ||
    message === 'Google account must be reconnected' ||
    message === 'Google authorization expired or is invalid' ||
    message === 'Google authorization browser session is invalid'
  );
}
