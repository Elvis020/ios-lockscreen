export type GoogleSyncErrorKind =
  'api_disabled' | 'reconnect' | 'rate_limited' | 'unavailable' | 'unknown';

type GoogleOperation = 'refresh_token' | 'list_calendars' | 'list_events';
type GoogleReason = 'accessNotConfigured' | 'SERVICE_DISABLED' | 'invalid_grant';

export class GoogleSyncError extends Error {
  constructor(readonly kind: GoogleSyncErrorKind) {
    super(
      kind === 'reconnect'
        ? 'Google account must be reconnected'
        : 'Google Calendar sync failed',
    );
    this.name = 'GoogleSyncError';
  }
}

export function googleSyncErrorMessage(error: GoogleSyncError): string {
  switch (error.kind) {
    case 'api_disabled':
      return "Google Calendar API is disabled. Enable it in this app's Google Cloud project, then try again.";
    case 'reconnect':
      return 'Reconnect your Google account from the control panel, then try again.';
    case 'rate_limited':
      return 'Google Calendar is receiving too many requests. Wait a moment, then try again.';
    case 'unavailable':
      return 'Google Calendar is temporarily unavailable. Please try again later.';
    case 'unknown':
      return 'Google Calendar could not finish syncing. Please try again or contact support.';
  }
}

export function classifyGoogleResponse(
  operation: GoogleOperation,
  status: number,
  payload: unknown,
): GoogleSyncError {
  const reason = structuredReason(payload);
  let kind: GoogleSyncErrorKind = 'unknown';

  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    kind = 'api_disabled';
  } else if (
    status === 401 ||
    (operation === 'refresh_token' && reason === 'invalid_grant')
  ) {
    kind = 'reconnect';
  } else if (status === 429) {
    kind = 'rate_limited';
  } else if (status >= 500 && status <= 599) {
    kind = 'unavailable';
  }

  console.error('Google sync failure', {
    operation,
    classification: kind,
    status,
    reason,
  });

  return new GoogleSyncError(kind);
}

function structuredReason(payload: unknown): GoogleReason | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const error = (payload as { error?: unknown }).error;

  if (error === 'invalid_grant') {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const details = error as { errors?: unknown; details?: unknown };
  const entries = [
    ...(Array.isArray(details.errors) ? details.errors : []),
    ...(Array.isArray(details.details) ? details.details : []),
  ];

  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      const reason = (entry as { reason?: unknown }).reason;

      if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
        return reason;
      }
    }
  }

  return undefined;
}
