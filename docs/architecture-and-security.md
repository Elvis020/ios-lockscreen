# Architecture and security

Calendar Lockscreen runs as Vercel Edge functions and uses Redis as the shared source of truth for accounts, settings, events, Telegram links, OAuth state, and cached Google events.

## Data flow

1. The dashboard, Telegram bot, or Google sync updates the user's Redis record.
2. The wallpaper endpoint reads that shared record.
3. The renderer creates the current week, month, or quarter image.
4. An iOS Shortcut fetches the image and applies it to the phone.

The application cannot force iOS to refresh a wallpaper. Run the Shortcut manually or with an iOS automation after changing settings.

## Tokens and URLs

- The management token can change account data and must remain private.
- The wallpaper key is read-only and is intended for the iOS Shortcut URL.
- Legacy `token` wallpaper URLs remain supported.
- Management APIs prefer `Authorization: Bearer <management-token>` while retaining query-token compatibility for existing clients.
- Existing browser storage migrates from `quarterProgressToken` to `calendarLockscreenManagementToken`.

## Concurrency and compatibility

Existing user records normalize to quarter view, the default theme, and `UTC`. A read-only wallpaper key is created when a legacy account next uses a management API; existing Redis keys are not renamed.

Per-user mutations use short-lived owner locks with atomic commit-time lease fencing. An expired lock holder therefore cannot overwrite a newer update from the dashboard, Telegram, or Google Calendar.

## Security boundaries

- All credentials come from environment variables.
- Google refresh tokens are encrypted with AES-GCM before Redis storage.
- OAuth state uses a short-lived, secure, HttpOnly, SameSite cookie.
- Telegram link codes and OAuth state expire after ten minutes.
- Personalized wallpaper responses are private and not cached.
- The public fallback wallpaper may use a one-hour CDN cache.
- Errors returned to clients avoid exposing internal details.

The temporary invite-admin endpoint remains available for initial setup. Keep `ADMIN_INVITE_SECRET` private and remove the endpoint when setup is complete.
