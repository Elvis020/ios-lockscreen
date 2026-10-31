import type { CalendarEvent } from '../userSchema';

export interface OAuthState {
  token: string;
  codeVerifier: string;
  returnOrigin: string;
  browserNonceHash: string;
}

export interface ConnectedGoogleAccount {
  email: string;
  encryptedRefreshToken: string;
}

export interface CalendarSyncBatch {
  calendarCount: number;
  events: CalendarEvent[];
  /** Selected legacy occurrence IDs that can be safely migrated in this window. */
  idAliases: Record<string, string>;
  windowEnd: string;
  windowStart: string;
}

export interface CalendarProvider {
  createAuthorizationUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<ConnectedGoogleAccount>;
  listEvents(
    encryptedRefreshToken: string,
    accountId: string,
    accountEmail: string,
    timeZone: string,
    selectedEventIds?: string[],
  ): Promise<CalendarSyncBatch>;
}
