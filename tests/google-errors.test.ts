import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyGoogleResponse,
  googleSyncErrorMessage,
} from '../lib/calendar/googleErrors';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Google sync errors', () => {
  it.each([
    [403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }, 'api_disabled'],
    [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 'api_disabled'],
    [
      403,
      { error: { message: 'SERVICE_DISABLED', errors: [{ reason: 'forbidden' }] } },
      'unknown',
    ],
    [401, {}, 'reconnect'],
    [429, {}, 'rate_limited'],
    [503, {}, 'unavailable'],
  ] as const)(
    'classifies status %s with structured indicators',
    (status, payload, kind) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = classifyGoogleResponse('list_calendars', status, payload);

      expect(error.kind).toBe(kind);
      expect(googleSyncErrorMessage(error)).toBeTruthy();
    },
  );

  it('logs only allowlisted fields and recognizes invalid grant during refresh', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = classifyGoogleResponse('refresh_token', 400, {
      error: 'invalid_grant',
      error_description: 'secret token and user@example.com',
    });

    expect(error.kind).toBe('reconnect');
    expect(log).toHaveBeenCalledWith('Google sync failure', {
      operation: 'refresh_token',
      classification: 'reconnect',
      status: 400,
      reason: 'invalid_grant',
    });
  });
});
