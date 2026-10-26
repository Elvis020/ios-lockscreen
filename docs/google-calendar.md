# Google Calendar setup

Google Calendar support uses direct OAuth and read-only Calendar API access. Selected events are normalized, cached in Redis, and included in the generated wallpaper.

## 1. Create Google credentials

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
3. Configure the OAuth consent screen.
4. Create an OAuth client with the **Web application** type.
5. Add your callback URL as an authorized redirect URI.

```text
https://YOUR-DOMAIN/api/google/callback
```

## 2. Configure the environment

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://YOUR-DOMAIN/api/google/callback
GOOGLE_OAUTH_ENCRYPTION_KEY=
```

`GOOGLE_OAUTH_ENCRYPTION_KEY` must be a base64url-encoded 32-byte AES-GCM key. Generate one locally with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## How syncing works

- The app requests read-only calendar access.
- A sync first reads Google Calendar's visible calendar list, then fetches the primary
  calendar and every other calendar marked as selected there.
- Paginated results from each calendar are normalized, labeled with their calendar name,
  merged, sorted, and cached in Redis. Sync is bounded to twenty visible calendars and a
  one-year upcoming window.
- Only events selected in the web dashboard or Telegram control panel appear on the
  wallpaper.
- `/sync` refreshes the cache from Telegram and reports the useful outcome rather than
  only a raw cache count. If events were found but none are tracked, its **Choose events**
  button opens the signed control panel.
- Refresh tokens are encrypted before storage.
- OAuth state expires after ten minutes and is bound to the initiating browser session.
- When Google OAuth starts from the Telegram control panel, the app opens a same-origin
  external-browser handoff. Its one-time capability stays in the URL fragment, is consumed
  by a no-store same-origin POST, and then establishes the browser-bound OAuth and Telegram
  continuation cookies before navigating to Google's stored authorization URL.
- OAuth success and failure return to the surface that started the connection, including
  the Telegram control panel.
- Stale sync results cannot overwrite a newly connected Google account.

Google push notification channels are intentionally out of scope. Without valid Google credentials, the rest of the dashboard remains available and the Google connection controls are disabled.

See Google's [OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) and [Calendar API documentation](https://developers.google.com/calendar/api) for provider-side configuration.
