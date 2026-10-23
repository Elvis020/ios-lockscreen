# Architecture and security

Calendar Lockscreen runs as Vercel Edge functions and uses Redis as the shared source of truth for accounts, settings, events, Telegram links, OAuth state, and cached Google events.

## Data flow

1. The dashboard, Telegram bot, or Google sync updates the user's Redis record.
2. The wallpaper endpoint reads that shared record.
3. The renderer creates the selected time range and presentation inside a calibrated lock-screen content band.
4. An iOS Shortcut fetches the image and applies it to the phone.

The application cannot force iOS to refresh a wallpaper. Run the Shortcut manually or with an iOS automation after changing settings.

## Tokens and URLs

- The management token can change account data and must remain private.
- The wallpaper key is read-only and is intended for the iOS Shortcut URL.
- Legacy `token` wallpaper URLs remain supported.
- Management APIs prefer `Authorization: Bearer <management-token>` while retaining query-token compatibility for existing clients.
- Existing browser storage migrates from `quarterProgressToken` to `calendarLockscreenManagementToken`.

## Concurrency and compatibility

Existing user records preserve their stored week, month, or quarter and normalize to the calendar presentation with the standard lock-screen profile. New accounts start with the month-and-next-events hybrid preset. A read-only wallpaper key is created when a legacy account next uses a management API; existing Redis keys are not renamed.

The schema stores `timeRange`, `presentation`, and `lockScreenProfile` separately. The nine named presets are shared mappings over those dimensions, so users may start from a preset and still tune range or presentation independently. Legacy `viewMode` settings and `/view` clients remain accepted at the API boundary.

Per-user mutations use short-lived owner locks with atomic commit-time lease fencing. An expired lock holder therefore cannot overwrite a newer update from the dashboard, Telegram, or Google Calendar.

## Security boundaries

- All credentials come from environment variables.
- Google refresh tokens are encrypted with AES-GCM before Redis storage.
- OAuth state uses a short-lived, secure, HttpOnly, SameSite cookie.
- Telegram link codes and OAuth state expire after ten minutes.
- Personalized wallpaper responses are private and not cached.
- The public fallback wallpaper may use a one-hour CDN cache.
- Errors returned to clients avoid exposing internal details.

## Lock-screen layout calibration

Wallpaper generation remains fixed at 1284×2778 for compatibility. The standard profile reserves roughly the top third for the clock and widgets and the bottom quarter for notifications. The large-clock profile moves the content start lower while retaining the same conservative bottom boundary.

These positions are calibration defaults, not device detection or universal safe-area claims. iOS can crop or zoom a wallpaper after download, and clock, widget, text-size, and notification choices vary. Use the generated mock-overlay previews as a first check, then verify the raw PNG on the actual target lock screen. Wallpaper settings also appear only after the iOS Shortcut fetches a fresh image; the application cannot force that refresh.

The temporary invite-admin endpoint remains available for initial setup. Keep `ADMIN_INVITE_SECRET` private and remove the endpoint when setup is complete.
